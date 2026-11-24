import { and, desc, eq, gte, like } from 'drizzle-orm';
import type {
  AuditLogEntry,
  AutomationActionResult,
  AutomationActionType,
  AutomationDashboardSummary,
  EmailAutomationAnalysis,
  PendingApprovalEntry,
  PipelineStatus,
} from './emailAutomationTypes.js';
import type { Db } from '../db/index.js';
import {
  applications,
  communications,
  contacts,
  emailApplicationLinks,
  emailAutomationAuditLog,
  emailAutomationPendingApprovals,
  inboundEmails,
  interviews,
  users,
} from '../db/schema.js';
import { isLlmConfigured } from './llmClient.js';
import {
  generateReplyDraft,
  templateReplyDraft,
  type ReplyDraftApplication,
  type ReplyDraftInput,
  type ReplyDraftResult,
} from './replyDraftGenerator.js';
import {
  findDuplicateApplication,
  matchEmailToApplications,
  roleMatchScore,
} from './emailApplicationMatcher.js';
import { buildDraftReply, generateNextActions } from './emailNextActions.js';
import {
  QUOTED_HISTORY,
  classificationInputFromEmail,
  forwardedMessageRecipients,
} from './emailForwardedParser.js';
import { isBulkResendNotReply, isOutboundDecline } from './pingRecruiterSignals.js';
import {
  buildPipelineUpdateProposal,
  isForwardTransition,
  pipelineStatusLabel,
} from './emailPipelineAutomation.js';
import { appendStageChangeNote, buildStageChangeNote } from './stageChangeNote.js';
import {
  hasIdentifiedCompany,
  hasIdentifiedCompanyAndRole,
  isLikelyDomainCompany,
  isMeaningfulContactNextAction,
  isUnknownRole,
  resolveEmployerCompany,
  resolveRoleTitle,
} from './emailAutomationMessages.js';
import {
  approvalReasonFromLegacyRow,
  buildApprovalReason,
  serializeApprovalReasonDetails,
  type ApprovalReasonDetails,
} from './approvalReason.js';
import { formatAutomationActionMessage } from './automationOutcomeMessages.js';
import {
  emailAddressesIn,
  getUserEmailContext,
  inboundEmailBelongsToUser,
  isInboundEmailDeleted,
} from './inboundEmailService.js';
import { createId, nowIso } from './id.js';
import { pacificDay } from './aiSpend.js';
import { parseSenderSignature } from './emailSignature.js';

// The calendar day an ISO timestamp falls on in server local time (Pacific in
// prod), so an evening application counts toward that day's goal.
function localDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const CREATE_APPLICATION_CLASSIFICATIONS = new Set([
  'Recruiter Outreach',
  'Application Confirmation',
  'Interview Request',
  'Scheduling',
]);

function getEmailForUser(db: Db, userId: string, emailId: string) {
  const { userEmail, contactEmails, otherUserEmails } = getUserEmailContext(db, userId);
  const rows = db
    .select()
    .from(inboundEmails)
    .where(eq(inboundEmails.id, emailId))
    .limit(1)
    .all();
  const row = rows[0];
  if (
    !row ||
    isInboundEmailDeleted(row) ||
    !inboundEmailBelongsToUser(row, userEmail, contactEmails, otherUserEmails)
  ) {
    return null;
  }
  return row;
}

// Link an inbound email to one of the user's applications, replacing any
// earlier link, or unlink it (applicationId null). Returns false, storing
// nothing, when the user does not own the email or the application. Runs no
// automation and changes nothing on the application.
export function setEmailApplicationLink(
  db: Db,
  userId: string,
  emailId: string,
  applicationId: string | null,
): boolean {
  if (!getEmailForUser(db, userId, emailId)) return false;
  if (applicationId !== null) {
    const owned = db
      .select({ id: applications.id })
      .from(applications)
      .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
      .all()[0];
    if (!owned) return false;
  }
  db.delete(emailApplicationLinks)
    .where(
      and(
        eq(emailApplicationLinks.userId, userId),
        eq(emailApplicationLinks.inboundEmailId, emailId),
      ),
    )
    .run();
  if (applicationId !== null) {
    db.insert(emailApplicationLinks)
      .values({
        id: createId(),
        userId,
        inboundEmailId: emailId,
        applicationId,
        createdAt: nowIso(),
      })
      .run();
  }
  return true;
}

export function recordEmailAutomationAudit(
  // Db or a transaction on it; only insert is used.
  db: Pick<Db, 'insert'>,
  input: {
    userId: string;
    inboundEmailId: string;
    actionType: AutomationActionType;
    confidence: number | null;
    status?: string;
    details?: Record<string, unknown>;
    resultingChanges?: Record<string, unknown>;
  },
): string {
  const id = createId();
  const timestamp = nowIso();
  db.insert(emailAutomationAuditLog)
    .values({
      id,
      userId: input.userId,
      inboundEmailId: input.inboundEmailId,
      actionType: input.actionType,
      confidence: input.confidence,
      status: input.status ?? 'completed',
      detailsJson: JSON.stringify(input.details ?? {}),
      resultingChangesJson: JSON.stringify(input.resultingChanges ?? {}),
      createdAt: timestamp,
    })
    .run();
  return id;
}

function recordAuditLog(
  db: Db,
  input: Parameters<typeof recordEmailAutomationAudit>[1],
): string {
  return recordEmailAutomationAudit(db, input);
}

export function hasCompletedAutomationAction(
  db: Db,
  inboundEmailId: string,
  actionType: AutomationActionType,
): boolean {
  const rows = db
    .select()
    .from(emailAutomationAuditLog)
    .where(eq(emailAutomationAuditLog.inboundEmailId, inboundEmailId))
    .all();
  return rows.some(
    (row) => row.actionType === actionType && row.status === 'completed',
  );
}

export function queueProcessingApproval(
  db: Db,
  input: {
    userId: string;
    inboundEmailId: string;
    approvalType: string;
    applicationId?: string | null;
    proposedStatus: string;
    currentStatus?: string | null;
    confidence: number;
    reason: string;
    reasonCodes?: string[];
    suggestedAction?: string;
    candidateMatches?: ApprovalReasonDetails['candidateMatches'];
    autoApprovalThreshold?: number;
  },
): string {
  const approvalDetails = buildApprovalReason({
    legacyApprovalType: input.approvalType,
    reasonCodes: input.reasonCodes ?? input.reason.split(',').map((p) => p.trim()).filter(Boolean),
    reasonText: input.reason.includes('_') ? undefined : input.reason,
    aiConfidence: input.confidence,
    suggestedAction:
      input.suggestedAction ?? 'Review the suggested action and approve or reject.',
    candidateMatches: input.candidateMatches,
    autoApprovalThreshold: input.autoApprovalThreshold,
  });

  const approvalId = createId();
  const timestamp = nowIso();
  db.insert(emailAutomationPendingApprovals)
    .values({
      id: approvalId,
      userId: input.userId,
      inboundEmailId: input.inboundEmailId,
      approvalType: input.approvalType,
      applicationId: input.applicationId ?? null,
      proposedStatus: input.proposedStatus,
      currentStatus: input.currentStatus ?? null,
      confidence: input.confidence,
      reason: approvalDetails.reasonMessage,
      suggestedAction: approvalDetails.suggestedAction,
      detailsJson: serializeApprovalReasonDetails(approvalDetails),
      status: 'pending',
      createdAt: timestamp,
    })
    .run();
  return approvalId;
}

function extractTextBody(payloadJson: string): string {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    return typeof payload.TextBody === 'string' ? payload.TextBody : '';
  } catch {
    return '';
  }
}

// Postmark's display name for the sender (the forwarder, for a forward).
function extractFromName(payloadJson: string): string | null {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    return typeof payload.FromName === 'string' && payload.FromName.trim()
      ? payload.FromName
      : null;
  } catch {
    return null;
  }
}

function initialStatusFromClassification(classification: string | null): PipelineStatus {
  switch (classification) {
    case 'Application Confirmation':
      return 'applied';
    case 'Recruiter Outreach':
      return 'recruiter_screen';
    case 'Interview Request':
    case 'Scheduling':
      return 'interviewing';
    case 'Offer':
      return 'offer';
    case 'Rejection':
      return 'rejected';
    default:
      return 'saved';
  }
}

export function analyzeEmailAutomation(
  db: Db,
  userId: string,
  emailId: string,
): EmailAutomationAnalysis | null {
  const row = getEmailForUser(db, userId, emailId);
  if (!row) return null;

  const effectiveFromEmail = row.originalSenderEmail ?? row.fromEmail;
  const effectiveSubject = row.originalSubject ?? row.subject;
  const effectiveCompany =
    resolveEmployerCompany({
      companyName: row.companyName,
      originalCompany: row.originalCompany,
      subject: effectiveSubject,
      senderEmail: effectiveFromEmail,
    }) ?? row.companyName;
  const effectiveRole =
    resolveRoleTitle({
      positionTitle: row.positionTitle,
      subject: effectiveSubject,
    }) ?? row.positionTitle;

  const matches = matchEmailToApplications(db, userId, {
    inboundEmailId: row.id,
    fromEmail: effectiveFromEmail,
    companyName: effectiveCompany,
    positionTitle: effectiveRole,
    recruiterName: row.recruiterName ?? row.originalSenderName,
    classification: row.classification,
    subject: effectiveSubject,
    ownEmails: [getUserEmailContext(db, userId).userEmail, row.isForwarded ? row.fromEmail : '']
      .filter(Boolean),
    ownName: row.isForwarded ? extractFromName(row.payload) : null,
  });

  const duplicateApplicationId = findDuplicateApplication(
    db,
    userId,
    effectiveCompany,
    effectiveRole,
  );

  const isCreatableClassification =
    CREATE_APPLICATION_CLASSIFICATIONS.has(row.classification ?? '') &&
    !matches.bestMatch &&
    !duplicateApplicationId;

  // Strict: drives AUTOMATIC creation (company AND role) — anti-junk guard.
  const canCreateApplication =
    isCreatableClassification &&
    hasIdentifiedCompanyAndRole({
      companyName: effectiveCompany,
      originalCompany: row.originalCompany,
      positionTitle: effectiveRole,
      subject: effectiveSubject,
      senderEmail: effectiveFromEmail,
    });

  // Relaxed: drives the HUMAN-confirmed "Create application" offer (company
  // identified; role optional, filled in on creation as "Unknown role").
  const canOfferApplicationCreation =
    isCreatableClassification &&
    hasIdentifiedCompany({
      companyName: effectiveCompany,
      originalCompany: row.originalCompany,
      subject: effectiveSubject,
      senderEmail: effectiveFromEmail,
    });

  let pipelineProposal = null;
  const targetAppId =
    matches.bestMatch?.applicationId ?? duplicateApplicationId ?? null;
  if (targetAppId) {
    const appRows = db
      .select()
      .from(applications)
      .where(and(eq(applications.id, targetAppId), eq(applications.userId, userId)))
      .all();
    const app = appRows[0];
    if (app) {
      pipelineProposal = buildPipelineUpdateProposal({
        applicationId: app.id,
        currentStatus: app.status as PipelineStatus,
        classification: row.classification,
        classificationConfidence: row.classificationConfidence,
        interviewDetected: row.interviewDetected ?? false,
        emailText: emailTextForStage(row),
      });
    }
  }

  const writtenByYou = isWrittenByYou(row);

  const nextActions = generateNextActions({
    writtenByYou,
    classification: row.classification,
    requiresResponse: row.requiresResponse,
    interviewDetected: row.interviewDetected,
    suggestedAction: row.suggestedAction,
    matches,
    pipelineProposal,
    canOfferApplicationCreation,
    company: effectiveCompany,
  });

  return {
    emailId,
    matches,
    nextActions,
    pipelineProposal,
    canCreateApplication,
    canOfferApplicationCreation,
    duplicateApplicationId,
  };
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// The newest message's subject and text, used to tell a recruiter screen from
// an interview. Quoted history is left out: a later round quotes the screening
// request it follows.
function emailTextForStage(row: typeof inboundEmails.$inferSelect): string {
  const { subject, textBody } = classificationInputFromEmail({
    subject: row.subject,
    fromEmail: row.fromEmail,
    fromName: extractFromName(row.payload),
    textBody: extractTextBody(row.payload),
  });
  const cut = textBody.search(QUOTED_HISTORY);
  const newest = cut > 0 ? textBody.slice(0, cut) : textBody;
  return `${subject}\n${newest}`;
}

// The job seeker wrote this email's top message (a forwarded thread they
// replied to last). Not stored on the row; recomputed from the stored text,
// as classification does.
function isWrittenByYou(row: typeof inboundEmails.$inferSelect): boolean {
  return classificationInputFromEmail({
    subject: row.subject,
    fromEmail: row.fromEmail,
    fromName: extractFromName(row.payload),
    textBody: extractTextBody(row.payload),
  }).forwardMetadata.topMessageFromForwarder;
}

export function createApplicationFromEmail(
  db: Db,
  userId: string,
  emailId: string,
  options: { applicationId?: string; allowMissingRole?: boolean } = {},
): AutomationActionResult | null {
  const row = getEmailForUser(db, userId, emailId);
  if (!row) return null;

  // Human-confirmed creation (allowMissingRole) needs only a real company —
  // the role is stored as "Unknown role" and the user fills it in. Automatic
  // creation stays strict (company AND role) to avoid junk applications.
  const creationIdentified = options.allowMissingRole
    ? hasIdentifiedCompany({
        companyName: row.companyName,
        originalCompany: row.originalCompany,
        subject: row.originalSubject ?? row.subject,
        senderEmail: row.originalSenderEmail ?? row.fromEmail,
      })
    : hasIdentifiedCompanyAndRole({
        companyName: row.companyName,
        originalCompany: row.originalCompany,
        positionTitle: row.positionTitle,
        subject: row.originalSubject ?? row.subject,
        senderEmail: row.originalSenderEmail ?? row.fromEmail,
      });

  if (!options.applicationId && !creationIdentified) {
    return {
      success: false,
      actionType: 'create_application',
      confidence: row.classificationConfidence,
      auditLogId: recordAuditLog(db, {
        userId,
        inboundEmailId: emailId,
        actionType: 'create_application',
        confidence: row.classificationConfidence,
        status: 'rejected',
        details: { reason: 'insufficient_company_role_extraction' },
      }),
      changes: {},
      message: formatAutomationActionMessage({
        actionType: 'create_application',
        success: false,
        detail: options.allowMissingRole
          ? 'company must be identified'
          : 'company and role must be identified',
      }),
    };
  }

  const duplicateId = findDuplicateApplication(
    db,
    userId,
    row.companyName,
    row.positionTitle,
  );
  if (duplicateId && !options.applicationId) {
    const dupRows = db
      .select()
      .from(applications)
      .where(and(eq(applications.id, duplicateId), eq(applications.userId, userId)))
      .all();
    const dup = dupRows[0];
    return {
      success: false,
      actionType: 'create_application',
      confidence: row.classificationConfidence,
      auditLogId: recordAuditLog(db, {
        userId,
        inboundEmailId: emailId,
        actionType: 'create_application',
        confidence: row.classificationConfidence,
        status: 'rejected',
        details: { reason: 'duplicate_detected', duplicateApplicationId: duplicateId },
      }),
      changes: { duplicateApplicationId: duplicateId },
      message: formatAutomationActionMessage({
        actionType: 'create_application',
        success: false,
        detail: dup
          ? `duplicate found (${dup.company} / ${dup.roleTitle})`
          : 'duplicate found',
      }),
    };
  }

  const timestamp = nowIso();
  const appId = createId();
  const effectiveSubject = row.originalSubject ?? row.subject;
  const effectiveFromEmail = row.originalSenderEmail ?? row.fromEmail;
  const company =
    resolveEmployerCompany({
      companyName: row.companyName,
      originalCompany: row.originalCompany,
      subject: effectiveSubject,
      senderEmail: effectiveFromEmail,
    }) ??
    (row.companyName?.trim() ||
      row.originalCompany?.trim() ||
      'Unknown');
  const resolvedRole =
    resolveRoleTitle({
      positionTitle: row.positionTitle,
      subject: effectiveSubject,
    }) ?? row.positionTitle;
  const roleTitle = isUnknownRole(resolvedRole)
    ? 'Unknown role'
    : resolvedRole?.trim() || 'Unknown role';
  const status = initialStatusFromClassification(row.classification);
  // A forwarded confirmation is dated by when the employer sent it, not when
  // it was forwarded to us (a batch of old confirmations is not "today").
  const dateApplied =
    row.classification === 'Application Confirmation'
      ? localDateKey(row.originalSentAt ?? row.receivedAt)
      : null;

  db.insert(applications)
    .values({
      id: appId,
      userId,
      company,
      roleTitle,
      jobUrl: '',
      workLocationType: 'remote',
      location: '',
      salaryMin: null,
      salaryMax: null,
      dateApplied,
      status,
      notes: row.aiSummary ? `Created from inbound email: ${row.aiSummary}` : '',
      interviewDate: row.interviewDatetime?.slice(0, 10) ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  const auditLogId = recordAuditLog(db, {
    userId,
    inboundEmailId: emailId,
    actionType: 'create_application',
    confidence: row.classificationConfidence,
    resultingChanges: {
      applicationId: appId,
      company,
      roleTitle,
      status,
    },
  });

  return {
    success: true,
    actionType: 'create_application',
    confidence: row.classificationConfidence,
    auditLogId,
    changes: { applicationId: appId, company, roleTitle, status },
    message: formatAutomationActionMessage({
      actionType: 'create_application',
      success: true,
      detail: `${company} / ${roleTitle}`,
    }),
  };
}

/**
 * Who wrote a stored email, and whether its "Ping recruiter" effects were
 * already applied. "You" is the account holder forwarding their own message: a
 * recruiter who is a saved contact can forward their own message too.
 */
function threadSignals(db: Db, userId: string, row: typeof inboundEmails.$inferSelect) {
  const { forwardMetadata } = classificationInputFromEmail({
    subject: row.subject,
    fromEmail: row.fromEmail,
    fromName: extractFromName(row.payload),
    textBody: extractTextBody(row.payload),
  });
  const { userEmail } = getUserEmailContext(db, userId);
  const writtenByYou = forwardMetadata.topMessageFromForwarder;
  const byAccountHolder =
    writtenByYou && userEmail !== '' && row.fromEmail.trim().toLowerCase() === userEmail;

  const audits = db
    .select()
    .from(emailAutomationAuditLog)
    .where(
      and(
        eq(emailAutomationAuditLog.userId, userId),
        eq(emailAutomationAuditLog.inboundEmailId, row.id),
        eq(emailAutomationAuditLog.status, 'completed'),
      ),
    )
    .all()
    .filter((a) => a.actionType === 'create_contact' || a.actionType === 'record_communication')
    .map((a) => ({
      type: a.actionType,
      details: JSON.parse(a.detailsJson) as { threadSignals?: boolean; via?: string },
      changes: JSON.parse(a.resultingChangesJson) as { communicationId?: string },
    }));
  return {
    writtenByYou,
    byAccountHolder,
    declined:
      byAccountHolder &&
      isOutboundDecline({
        topMessage: forwardMetadata.originalBody ?? '',
        classification: row.classification,
      }),
    counterparty: forwardMetadata.originalSenderEmail?.trim().toLowerCase() ?? '',
    alreadyApplied: audits.some((a) => a.details.threadSignals === true),
    alreadyLogged: audits.some((a) => a.type === 'create_contact' || a.details.via === 'own_outbound'),
    loggedCommunicationId:
      audits.find((a) => a.details.via === 'own_outbound')?.changes.communicationId ?? null,
  };
}

function isBulkResend(
  db: Db,
  userId: string,
  row: typeof inboundEmails.$inferSelect,
  contactId: string,
): boolean {
  if (!row.isForwarded) return false;
  return isBulkResendNotReply({
    forwarded: forwardedMessageRecipients(extractTextBody(row.payload)),
    senderEmail: row.originalSenderEmail ?? '',
    ownAddresses: [getUserEmailContext(db, userId).userEmail, row.fromEmail],
    subject: row.subject,
    earlierSubjects: db
      .select({ subject: communications.subject })
      .from(communications)
      .where(and(eq(communications.userId, userId), eq(communications.contactId, contactId)))
      .all()
      .map((c) => c.subject),
  });
}

/**
 * A recruiter's own message sent after you closed the thread reopens it, but
 * only one that needs your reply: "noted, thanks" must not bring the nudge back.
 */
function reopenChange(
  contact: typeof contacts.$inferSelect,
  row: typeof inboundEmails.$inferSelect,
  writtenByYou: boolean,
): { threadClosedAt: null; declineDetectedAt: null; threadKeptOpenAt: string } | null {
  if (writtenByYou || !contact.threadClosedAt || !row.requiresResponse) return null;
  if ((row.originalSentAt ?? row.receivedAt) <= contact.threadClosedAt) return null;
  return { threadClosedAt: null, declineDetectedAt: null, threadKeptOpenAt: row.receivedAt };
}

/** The user's contact this mail belongs to, or null rather than a guess. */
function threadContact(
  db: Db,
  userId: string,
  row: typeof inboundEmails.$inferSelect,
  address: string,
) {
  if (!address) return null;
  const rows = db
    .select({ contact: contacts, roleTitle: applications.roleTitle })
    .from(contacts)
    .innerJoin(applications, eq(applications.id, contacts.applicationId))
    .where(and(eq(contacts.userId, userId), eq(applications.userId, userId)))
    .all()
    .filter((r) => r.contact.email.trim().toLowerCase() === address);
  const matches = analyzeEmailAutomation(db, userId, row.id)?.matches;
  // The application you linked by hand wins.
  if (matches?.linkedApplicationId) {
    return rows.find((r) => r.contact.applicationId === matches.linkedApplicationId)?.contact ?? null;
  }
  const role = row.positionTitle;
  const candidates = rows.filter(
    (r) =>
      !role || isUnknownRole(role) || isUnknownRole(r.roleTitle) || roleMatchScore(role, r.roleTitle) > 0,
  );
  if (candidates.length === 1) return candidates[0].contact;
  if (!matches?.bestMatch || matches.requiresManualSelection) return null;
  return candidates.find((r) => r.contact.applicationId === matches.bestMatch?.applicationId)?.contact ?? null;
}

/**
 * "Ping recruiter" effects of a processed email on an EXISTING contact, whatever
 * the classification or confidence. Your own forwarded mail is logged outbound,
 * restarts the clock and, when it declines, suggests closing the thread. A
 * recruiter's message after a close reopens the thread. Creates no contact or
 * application, and applies once per email.
 */
export function applyThreadSignals(
  db: Db,
  userId: string,
  emailId: string,
): AutomationActionResult | null {
  const row = getEmailForUser(db, userId, emailId);
  if (!row) return null;
  const signals = threadSignals(db, userId, row);
  const timestamp = nowIso();
  const day = pacificDay(new Date(row.receivedAt));
  const laterDay = (c: typeof contacts.$inferSelect) =>
    c.lastContactDate && c.lastContactDate.slice(0, 10) >= day ? c.lastContactDate : day;

  if (!signals.writtenByYou) {
    const sender = (row.originalSenderEmail ?? row.fromEmail).trim().toLowerCase();
    const contact = threadContact(db, userId, row, sender);
    const reopen = contact && reopenChange(contact, row, false);
    if (contact && reopen && !isBulkResend(db, userId, row, contact.id)) {
      db.update(contacts)
        .set({ ...reopen, lastContactDate: laterDay(contact), updatedAt: timestamp })
        .where(and(eq(contacts.id, contact.id), eq(contacts.userId, userId)))
        .run();
    }
    return null;
  }

  if (!signals.byAccountHolder || signals.alreadyApplied) return null;
  const contact = threadContact(db, userId, row, signals.counterparty);
  if (!contact?.applicationId) return null;
  const applicationId = contact.applicationId;

  return db.transaction((tx): AutomationActionResult => {
    // An earlier "create contact" already logged this email.
    const communicationId = signals.alreadyLogged ? null : createId();
    if (communicationId) {
      tx.insert(communications)
        .values({
          id: communicationId,
          userId,
          applicationId,
          contactId: contact.id,
          channel: 'email',
          direction: 'outbound',
          subject: row.subject,
          body: extractTextBody(row.payload).slice(0, 5000),
          occurredAt: row.receivedAt,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .run();
    }
    tx.update(contacts)
      .set({
        lastContactDate: laterDay(contact),
        ...(signals.declined && { declineDetectedAt: row.receivedAt }),
        updatedAt: timestamp,
      })
      .where(and(eq(contacts.id, contact.id), eq(contacts.userId, userId)))
      .run();
    const changes = {
      contactId: contact.id,
      applicationId,
      ...(communicationId && { communicationId }),
      declined: signals.declined,
    };
    const auditLogId = recordEmailAutomationAudit(tx, {
      userId,
      inboundEmailId: emailId,
      actionType: 'record_communication',
      confidence: row.classificationConfidence,
      details: { threadSignals: true, ...(communicationId && { via: 'own_outbound' }) },
      resultingChanges: changes,
    });
    return {
      success: true,
      actionType: 'record_communication',
      confidence: row.classificationConfidence,
      auditLogId,
      changes,
      message: `Logged your message to ${contact.name}`,
    };
  });
}

export function createContactFromEmail(
  db: Db,
  userId: string,
  emailId: string,
  applicationId: string,
): AutomationActionResult | null {
  const row = getEmailForUser(db, userId, emailId);
  if (!row) return null;

  const appRows = db
    .select()
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .all();
  if (appRows.length === 0) return null;

  const fromEmail = (row.originalSenderEmail ?? row.fromEmail).trim().toLowerCase();
  // Never save the job seeker's own address as a contact. That happens when
  // the original sender of a forward did not parse and the forwarding
  // address is used instead. Skip the whole action (no contact, no logged
  // communication) and record it as rejected, not completed, so a later
  // Re-analyze that parses the real sender still creates the right contact.
  const { userEmail } = getUserEmailContext(db, userId);
  const ownAddresses = new Set(
    [userEmail, row.isForwarded ? row.fromEmail : null]
      .filter((v): v is string => Boolean(v))
      .map((v) => v.trim().toLowerCase()),
  );
  if (ownAddresses.has(fromEmail)) {
    return {
      success: false,
      actionType: 'create_contact',
      confidence: row.classificationConfidence,
      auditLogId: recordAuditLog(db, {
        userId,
        inboundEmailId: emailId,
        actionType: 'create_contact',
        confidence: row.classificationConfidence,
        status: 'rejected',
        details: { reason: 'own_address' },
      }),
      changes: {},
      message: "Skipped contact: the sender is your own address",
    };
  }
  const existingContacts = db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, userId))
    .all();

  // The same person on this application: by address, or by full name when
  // they write from another address (a recruiter's firm vs. the employer).
  const senderName = normalizeName(row.originalSenderName ?? row.recruiterName);
  const existing =
    existingContacts.find(
      (c) => c.applicationId === applicationId && c.email.trim().toLowerCase() === fromEmail,
    ) ??
    (senderName.split(' ').length >= 2
      ? existingContacts.find(
          (c) => c.applicationId === applicationId && normalizeName(c.name) === senderName,
        )
      : undefined);

  const timestamp = nowIso();
  let contactId: string;
  let merged = false;
  let resolvedNextAction = '';
  if (row.classification === 'Scheduling') {
    resolvedNextAction = row.suggestedAction ?? '';
  } else if (
    row.classification !== 'Application Confirmation' &&
    isMeaningfulContactNextAction(row.suggestedAction ?? '')
  ) {
    resolvedNextAction = row.suggestedAction ?? '';
  }

  // A second vendor on a role the job seeker is already submitted to: keep
  // the recruiter for other roles, note that they are not the vendor of
  // record, and leave no next action.
  let vendorNote: string | null = null;
  if (row.classification === 'Already Submitted Elsewhere') {
    resolvedNextAction = '';
    const agency = appRows[0]?.agency?.trim();
    vendorNote = `Secondary vendor: you are already submitted for this role ${
      agency ? `via ${agency}` : 'through another vendor'
    }. Saved for other roles.`;
  }
  const signature = parseSenderSignature(extractTextBody(row.payload), {
    email: fromEmail,
    name: row.originalSenderName ?? row.recruiterName,
    wholeBody: !row.isForwarded,
  });
  const dated = (note: string) => `[${row.receivedAt.slice(0, 10)}] ${note}`;

  // "Ping recruiter" (see pingRecruiterSignals): a decline you sent suggests
  // closing this thread; a bulk re-send with you in Bcc is not a reply. Signals
  // apply once per email, so a re-run can't undo "Keep open".
  const signals = threadSignals(db, userId, row);
  const declined = signals.declined && !signals.alreadyApplied;
  const bulkResend = !!existing && isBulkResend(db, userId, row, existing.id);

  if (existing) {
    contactId = existing.id;
    merged = true;
    const name = row.recruiterName?.trim() || existing.name;
    db.update(contacts)
      .set({
        name,
        // A bulk re-send is logged below but does not restart the clock, and a
        // re-run on an older email never moves the date backwards (that would
        // undo "I followed up" and bring the nudge straight back).
        lastContactDate:
          bulkResend ||
          (existing.lastContactDate && existing.lastContactDate.slice(0, 10) >= row.receivedAt.slice(0, 10))
            ? existing.lastContactDate
            : row.receivedAt.slice(0, 10),
        declineDetectedAt: declined ? row.receivedAt : existing.declineDetectedAt,
        ...(bulkResend ? {} : reopenChange(existing, row, signals.writtenByYou)),
        messageNotes: [
          existing.messageNotes,
          ...[vendorNote, row.aiSummary].filter((n): n is string => Boolean(n)).map(dated),
        ]
          .join('\n')
          .trim(),
        // Signature details fill only what is empty; never what was typed.
        phone: existing.phone ?? signature.phone,
        title: existing.title ?? signature.title,
        linkedIn: existing.linkedIn.trim() ? existing.linkedIn : signature.linkedIn ?? '',
        nextAction: isMeaningfulContactNextAction(resolvedNextAction)
          ? resolvedNextAction
          : existing.nextAction,
        updatedAt: timestamp,
      })
      .where(eq(contacts.id, existing.id))
      .run();
  } else {
    contactId = createId();
    const name =
      row.recruiterName?.trim() ||
      row.originalSenderName?.trim() ||
      row.fromEmail.split('@')[0].replace(/[._]/g, ' ') ||
      'Recruiter';
    const extractedCompany =
      resolveEmployerCompany({
        companyName: row.companyName,
        originalCompany: row.originalCompany,
        subject: row.originalSubject ?? row.subject,
        senderEmail: row.originalSenderEmail ?? row.fromEmail,
      }) ?? '';
    // A second vendor works for the vendor, not the application's client.
    const company =
      row.classification === 'Already Submitted Elsewhere'
        ? row.originalCompany?.trim() ?? ''
        : isLikelyDomainCompany(extractedCompany)
          ? (appRows[0]?.company ?? '')
          : extractedCompany || appRows[0]?.company || '';
    db.insert(contacts)
      .values({
        id: contactId,
        userId,
        applicationId,
        name,
        email: row.originalSenderEmail ?? row.fromEmail,
        linkedIn: signature.linkedIn ?? '',
        phone: signature.phone,
        title: signature.title,
        company,
        source: row.fromEmail.includes('linkedin') ? 'linkedin' : 'email',
        lastContactDate: row.receivedAt.slice(0, 10),
        declineDetectedAt: declined ? row.receivedAt : null,
        messageNotes: [vendorNote, row.aiSummary].filter(Boolean).join('\n'),
        nextAction: resolvedNextAction,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }

  const textBody = extractTextBody(row.payload);
  const commId = signals.loggedCommunicationId ?? createId();
  // Your own mail may already be logged by automatic processing.
  if (!signals.loggedCommunicationId) {
    db.insert(communications)
      .values({
        id: commId,
        userId,
        applicationId,
        contactId,
        channel: 'email',
        direction: signals.writtenByYou ? 'outbound' : 'inbound',
        subject: row.subject,
        body: textBody.slice(0, 5000),
        occurredAt: row.receivedAt,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }

  const auditLogId = recordAuditLog(db, {
    userId,
    inboundEmailId: emailId,
    actionType: 'create_contact',
    confidence: row.classificationConfidence,
    details: { threadSignals: true },
    resultingChanges: {
      contactId,
      applicationId,
      communicationId: commId,
      merged,
    },
  });

  return {
    success: true,
    actionType: 'create_contact',
    confidence: row.classificationConfidence,
    auditLogId,
    changes: { contactId, applicationId, communicationId: commId, merged },
    message: merged
      ? 'Updated existing contact and logged communication'
      : 'Created recruiter contact and logged communication',
  };
}

export function updatePipelineFromEmail(
  db: Db,
  userId: string,
  emailId: string,
  input: {
    applicationId: string;
    status?: PipelineStatus;
    force?: boolean;
    /** Only a person's manual choice may move an application to an earlier stage. */
    allowBackward?: boolean;
  },
): AutomationActionResult | null {
  const row = getEmailForUser(db, userId, emailId);
  if (!row) return null;

  const appRows = db
    .select()
    .from(applications)
    .where(and(eq(applications.id, input.applicationId), eq(applications.userId, userId)))
    .all();
  const app = appRows[0];
  if (!app) return null;

  const proposal = buildPipelineUpdateProposal({
    applicationId: app.id,
    currentStatus: app.status as PipelineStatus,
    classification: row.classification,
    classificationConfidence: row.classificationConfidence,
    interviewDetected: row.interviewDetected ?? false,
    emailText: emailTextForStage(row),
  });

  const targetStatus = input.status ?? proposal?.proposedStatus;
  if (
    input.status &&
    !input.allowBackward &&
    !isForwardTransition(app.status as PipelineStatus, input.status)
  ) {
    return {
      success: false,
      actionType: 'update_pipeline',
      confidence: row.classificationConfidence,
      auditLogId: recordAuditLog(db, {
        userId,
        inboundEmailId: emailId,
        actionType: 'update_pipeline',
        confidence: row.classificationConfidence,
        status: 'rejected',
        details: {
          reason: 'backward_move',
          currentStatus: app.status,
          proposedStatus: input.status,
        },
      }),
      changes: {},
      message: `Kept ${app.company} at ${pipelineStatusLabel(app.status)}: an email can't move it back to ${pipelineStatusLabel(input.status)}`,
    };
  }
  if (!targetStatus) {
    return {
      success: false,
      actionType: 'update_pipeline',
      confidence: row.classificationConfidence,
      auditLogId: recordAuditLog(db, {
        userId,
        inboundEmailId: emailId,
        actionType: 'update_pipeline',
        confidence: row.classificationConfidence,
        status: 'rejected',
        details: { reason: 'no_proposed_status' },
      }),
      changes: {},
      message: formatAutomationActionMessage({
        actionType: 'update_pipeline',
        success: false,
        detail: `${app.company} stays at ${pipelineStatusLabel(app.status)}`,
      }),
    };
  }

  const confidence = row.classificationConfidence ?? 50;
  const requiresApproval =
    proposal?.requiresApproval && !input.force && confidence < 75;

  if (requiresApproval) {
    const approvalId = queueProcessingApproval(db, {
      userId,
      inboundEmailId: emailId,
      approvalType: 'pipeline_update',
      applicationId: app.id,
      proposedStatus: targetStatus,
      currentStatus: app.status,
      confidence,
      reason: proposal?.reason ?? 'pipeline_update_low_confidence',
      reasonCodes: ['pipeline_update_low_confidence', 'low_confidence_classification'],
      suggestedAction: `Approve pipeline update to ${targetStatus.replace(/_/g, ' ')}`,
    });

    const auditLogId = recordAuditLog(db, {
      userId,
      inboundEmailId: emailId,
      actionType: 'update_pipeline',
      confidence,
      status: 'pending',
      details: {
        pendingApprovalId: approvalId,
        proposedStatus: targetStatus,
        reason: proposal?.reason ?? 'Low-confidence pipeline update',
        suggestedAction: `Approve pipeline update to ${targetStatus.replace(/_/g, ' ')}`,
      },
    });

    return {
      success: true,
      actionType: 'update_pipeline',
      confidence,
      auditLogId,
      pendingApprovalId: approvalId,
      changes: { pendingApprovalId: approvalId, proposedStatus: targetStatus },
      message: formatAutomationActionMessage({
        actionType: 'update_pipeline',
        success: true,
        pendingApprovalId: approvalId,
        detail: `low confidence (${targetStatus.replace(/_/g, ' ')})`,
      }),
    };
  }

  const timestamp = nowIso();
  const updates: Partial<typeof applications.$inferInsert> = {
    status: targetStatus,
    updatedAt: timestamp,
  };
  if (row.interviewDatetime && (targetStatus === 'interviewing' || targetStatus === 'final_round')) {
    updates.interviewDate = row.interviewDatetime.slice(0, 10);
  }
  if (targetStatus === 'applied' && !app.dateApplied) {
    updates.dateApplied = localDateKey(row.originalSentAt ?? row.receivedAt);
  }

  db.update(applications)
    .set(updates)
    .where(eq(applications.id, app.id))
    .run();

  const auditLogId = recordAuditLog(db, {
    userId,
    inboundEmailId: emailId,
    actionType: 'update_pipeline',
    confidence,
    resultingChanges: {
      applicationId: app.id,
      previousStatus: app.status,
      newStatus: targetStatus,
    },
  });

  return {
    success: true,
    actionType: 'update_pipeline',
    confidence,
    auditLogId,
    changes: {
      applicationId: app.id,
      previousStatus: app.status,
      newStatus: targetStatus,
    },
    message: formatAutomationActionMessage({
      actionType: 'update_pipeline',
      success: true,
      detail: `${app.company} / ${app.roleTitle} to ${targetStatus.replace(/_/g, ' ')}`,
    }),
  };
}

export function upsertInterviewFromEmail(
  db: Db,
  userId: string,
  emailId: string,
  applicationId: string,
): AutomationActionResult | null {
  const row = getEmailForUser(db, userId, emailId);
  if (!row?.interviewDatetime) return null;

  const appRows = db
    .select()
    .from(applications)
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .all();
  if (appRows.length === 0) return null;

  const scheduledAt = row.interviewDatetime;
  const scheduledDay = scheduledAt.slice(0, 10);
  const existingInterviews = db
    .select()
    .from(interviews)
    .where(and(eq(interviews.userId, userId), eq(interviews.applicationId, applicationId)))
    .all();

  const existing = existingInterviews.find(
    (interview) => interview.scheduledAt.slice(0, 10) === scheduledDay,
  );

  const timestamp = nowIso();
  const notes = row.aiSummary?.trim() || 'Interview confirmed via inbound email';
  const recruiterLabel = row.recruiterName ?? row.originalSenderName;
  const location = recruiterLabel ? `With ${recruiterLabel}` : '';

  // Keep the application's denormalized interviewDate (read by the Today
  // dashboard) in sync whenever an interview record is written, independent
  // of whether a pipeline status transition happens in the same pass.
  // updatePipelineFromEmail only backfills this field on a transition to
  // interviewing/final_round, so an application already at that status --
  // e.g. on a reanalysis where the pipeline update itself is skipped --
  // would otherwise keep showing "date pending" despite a correct interview
  // record existing underneath it. See issue #13.
  db.update(applications)
    .set({ interviewDate: scheduledDay, updatedAt: timestamp })
    .where(eq(applications.id, applicationId))
    .run();

  if (existing) {
    db.update(interviews)
      .set({
        scheduledAt,
        location: location || existing.location,
        notes,
        updatedAt: timestamp,
      })
      .where(eq(interviews.id, existing.id))
      .run();

    const auditLogId = recordAuditLog(db, {
      userId,
      inboundEmailId: emailId,
      actionType: 'create_interview',
      confidence: row.classificationConfidence,
      resultingChanges: {
        interviewId: existing.id,
        applicationId,
        scheduledAt,
        updated: true,
      },
    });

    return {
      success: true,
      actionType: 'create_interview',
      confidence: row.classificationConfidence,
      auditLogId,
      changes: {
        interviewId: existing.id,
        applicationId,
        scheduledAt,
        updated: true,
      },
      message: formatAutomationActionMessage({
        actionType: 'create_interview',
        success: true,
        detail: `Updated interview on ${scheduledDay}`,
      }),
    };
  }

  const interviewId = createId();
  db.insert(interviews)
    .values({
      id: interviewId,
      userId,
      applicationId,
      scheduledAt,
      type: 'video',
      location,
      notes,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  const auditLogId = recordAuditLog(db, {
    userId,
    inboundEmailId: emailId,
    actionType: 'create_interview',
    confidence: row.classificationConfidence,
    resultingChanges: {
      interviewId,
      applicationId,
      scheduledAt,
    },
  });

  return {
    success: true,
    actionType: 'create_interview',
    confidence: row.classificationConfidence,
    auditLogId,
    changes: { interviewId, applicationId, scheduledAt },
    message: formatAutomationActionMessage({
      actionType: 'create_interview',
      success: true,
      detail: `Scheduled for ${scheduledDay}`,
    }),
  };
}

export function draftReplyFromEmail(
  db: Db,
  userId: string,
  emailId: string,
): { draft: string; auditLogId: string } | null {
  const row = getEmailForUser(db, userId, emailId);
  if (!row) return null;

  const draft = buildDraftReply({
    classification: row.classification,
    recruiterName: row.recruiterName,
    companyName: row.companyName,
    positionTitle: row.positionTitle,
    subject: row.subject,
  });

  const auditLogId = recordAuditLog(db, {
    userId,
    inboundEmailId: emailId,
    actionType: 'draft_reply',
    confidence: row.classificationConfidence,
    resultingChanges: { draftLength: draft.length },
  });

  return { draft, auditLogId };
}

// AI drafts one user may ask for in any 24 hours. The AI budget is shared by
// every user, so one user (or a script) can't spend it on drafts alone.
export const AI_DRAFTS_PER_USER_PER_DAY = 20;

// Marks audit rows for an AI attempt, so the limit counts only those.
const AI_DRAFT_MARKER = 'ai_draft_button';

function aiDraftsInLastDay(db: Db, userId: string, now: Date): number {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  return db
    .select({ id: emailAutomationAuditLog.id })
    .from(emailAutomationAuditLog)
    .where(
      and(
        eq(emailAutomationAuditLog.userId, userId),
        eq(emailAutomationAuditLog.actionType, 'draft_reply'),
        gte(emailAutomationAuditLog.createdAt, since),
        like(emailAutomationAuditLog.detailsJson, `%${AI_DRAFT_MARKER}%`),
      ),
    )
    .all().length;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function dayOrNull(value: string | null): string | null {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : pacificDay(new Date(at));
}

// Where the email's linked application stands now, for the reply draft. Only
// an explicit link (the user's choice), never a fuzzy match. Dates only: no
// notes, salary or contacts go to the AI provider.
export function linkedApplicationForDraft(
  db: Db,
  userId: string,
  emailId: string,
  now: Date,
  emailDate: string | null,
): ReplyDraftApplication | null {
  const app = db
    .select({
      id: applications.id,
      status: applications.status,
      agency: applications.agency,
      submittedDate: applications.submittedDate,
      dateApplied: applications.dateApplied,
      interviewDate: applications.interviewDate,
    })
    .from(emailApplicationLinks)
    .innerJoin(applications, eq(applications.id, emailApplicationLinks.applicationId))
    .where(
      and(
        eq(emailApplicationLinks.userId, userId),
        eq(emailApplicationLinks.inboundEmailId, emailId),
        eq(applications.userId, userId),
      ),
    )
    .get();
  if (!app) return null;

  const today = pacificDay(now);
  const rows = db
    .select({ scheduledAt: interviews.scheduledAt, type: interviews.type })
    .from(interviews)
    .where(and(eq(interviews.applicationId, app.id), eq(interviews.userId, userId)))
    .all()
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const list = rows.map((row) => {
    // A date-only value (manual entry) is a calendar day, not UTC midnight.
    const at = DATE_ONLY.test(row.scheduledAt) ? Number.NaN : Date.parse(row.scheduledAt);
    const past = Number.isNaN(at) ? row.scheduledAt.slice(0, 10) < today : at < now.getTime();
    const date = Number.isNaN(at) ? row.scheduledAt.slice(0, 10) : pacificDay(new Date(at));
    return { date, type: row.type, past };
  });
  // Older rows can carry only the denormalized date. Day-level only: an
  // interview earlier today reads as upcoming until tomorrow (known limit).
  if (list.length === 0 && app.interviewDate) {
    const date = app.interviewDate.slice(0, 10);
    list.push({ date, type: 'interview', past: date < today });
  }

  const submittedDate = app.submittedDate?.slice(0, 10) ?? null;
  // Decided here, not left to the model: something happened after the email
  // was sent, so its ask is likely stale. Strictly after, so an email sent
  // the day of a screen ("great chat, let's book round two") stays current.
  // Known limits: an event the same day as the email reads as current, and
  // a forward whose original date didn't parse is dated by the forward.
  const movedOnSinceEmail = Boolean(
    emailDate &&
      (list.some((i) => i.past && i.date > emailDate) ||
        (submittedDate !== null && submittedDate > emailDate && submittedDate <= today)),
  );

  return {
    stage: pipelineStatusLabel(app.status),
    agency: app.agency?.trim() || null,
    submittedDate,
    dateApplied: app.dateApplied?.slice(0, 10) ?? null,
    interviews: list,
    movedOnSinceEmail,
  };
}

// The Draft reply button: an AI-written draft, falling back to the template
// above. The approval queue still uses the synchronous template version.
export async function aiDraftReplyFromEmail(
  db: Db,
  userId: string,
  emailId: string,
  now: Date = new Date(),
): Promise<
  | {
      draft: string;
      source: ReplyDraftResult['source'];
      pausedReason?: ReplyDraftResult['pausedReason'];
      auditLogId: string;
      // Who the reply goes to and its subject, for "Open in Outlook".
      replyTo: { name: string | null; email: string | null };
      replySubject: string;
    }
  | null
> {
  const row = getEmailForUser(db, userId, emailId);
  if (!row) return null;

  let textBody = '';
  let fromName: string | null = null;
  try {
    const payload = JSON.parse(row.payload) as Record<string, unknown>;
    textBody = typeof payload.TextBody === 'string' ? payload.TextBody : '';
    fromName =
      typeof payload.FromName === 'string' && payload.FromName.trim() ? payload.FromName : null;
  } catch {
    // Unparseable payload: draft from the stored fields alone.
  }
  const { forwardMetadata: fwd } = classificationInputFromEmail({
    subject: row.subject,
    fromEmail: row.fromEmail,
    fromName,
    textBody,
  });
  const user = db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  // Who the draft goes to. The parser marks any body that quotes a From:
  // block as "forwarded", including a recruiter's reply or forward. Only an
  // email the user sent is the user's forward; anything else is answered to
  // its sender.
  const userEmail = user?.email?.trim().toLowerCase() ?? '';
  const sender = emailAddressesIn(row.fromEmail)[0] ?? '';
  const isUserForward = fwd.isForwarded && Boolean(userEmail) && sender === userEmail;
  const selfEmails = new Set(
    [userEmail, isUserForward ? emailAddressesIn(row.fromEmail)[0] : '']
      .filter((e): e is string => Boolean(e)),
  );
  // The app's inbound address is never someone to write to.
  const notRecipients = new Set([...selfEmails, ...emailAddressesIn(row.toEmail)]);

  let recipientName: string | null;
  let recipientEmail: string | null;
  let lastMessageFromUser: boolean;
  if (!isUserForward) {
    recipientName = fromName;
    recipientEmail = emailAddressesIn(row.fromEmail)[0] ?? null;
    lastMessageFromUser = Boolean(recipientEmail && selfEmails.has(recipientEmail));
  } else {
    recipientName = fwd.originalSenderName;
    // One clean address: the header can hold a name only, several
    // addresses, or junk around the address.
    const raw = fwd.originalSenderEmail?.trim() ?? '';
    recipientEmail = emailAddressesIn(raw)[0] ?? null;
    lastMessageFromUser = fwd.topMessageFromForwarder;
    if (!recipientEmail && raw) {
      recipientName = recipientName ?? raw;
    }
  }
  if (recipientEmail && selfEmails.has(recipientEmail)) {
    // The user wrote the message: write to the person they wrote to, as a
    // follow-up. originalRecipient can be a name only, or several addresses.
    const to = fwd.originalRecipient ?? '';
    recipientEmail = emailAddressesIn(to).find((a) => !notRecipients.has(a)) ?? null;
    recipientName = recipientEmail || !to.trim() || to.includes('@') ? null : to.trim();
    lastMessageFromUser = true;
  } else if (recipientEmail && notRecipients.has(recipientEmail)) {
    recipientEmail = null;
    recipientName = null;
  }

  // A recruiter's reply that quotes the thread also parses as "forwarded";
  // only the user's own forward carries an older original date.
  const emailDate =
    (isUserForward ? dayOrNull(row.originalSentAt) : null) ?? dayOrNull(row.receivedAt);

  const input: ReplyDraftInput = {
    userName: user?.name ?? null,
    classification: row.classification,
    recruiterName: row.recruiterName,
    recipientName,
    recipientEmail,
    companyName: row.companyName ?? row.originalCompany,
    positionTitle: row.positionTitle,
    subject: fwd.originalSubject ?? row.subject,
    // The whole forward, quoted thread included, so the draft has context.
    textBody,
    lastMessageFromUser,
    today: pacificDay(now),
    emailDate,
    application: linkedApplicationForDraft(db, userId, emailId, now, emailDate),
  };

  // Reserve the AI attempt before awaiting, so parallel clicks see each
  // other: SQLite writes here are synchronous, so the count and the insert
  // can't interleave with another request. Only AI attempts carry the marker.
  const attemptAi =
    isLlmConfigured() && aiDraftsInLastDay(db, userId, now) < AI_DRAFTS_PER_USER_PER_DAY;
  const auditLogId = recordAuditLog(db, {
    userId,
    inboundEmailId: emailId,
    actionType: 'draft_reply',
    confidence: row.classificationConfidence,
    details: attemptAi ? { via: AI_DRAFT_MARKER } : { via: 'draft_button' },
    resultingChanges: {},
  });

  let result: ReplyDraftResult;
  if (attemptAi) {
    result = await generateReplyDraft(input);
  } else {
    const draft = templateReplyDraft(input);
    result = { draft, source: isLlmConfigured() ? 'limited' : 'template' };
  }

  db.update(emailAutomationAuditLog)
    .set({
      resultingChangesJson: JSON.stringify({
        draftLength: result.draft.length,
        source: result.source,
      }),
    })
    .where(eq(emailAutomationAuditLog.id, auditLogId))
    .run();

  return {
    draft: result.draft,
    source: result.source,
    ...(result.pausedReason ? { pausedReason: result.pausedReason } : {}),
    auditLogId,
    replyTo: { name: recipientName, email: recipientEmail },
    replySubject: replySubjectFor(input.subject),
  };
}

// "Re: <subject>", without stacking a second Re: or keeping a forward's Fw:.
export function replySubjectFor(subject: string): string {
  const base = subject.replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '').trim();
  return base ? `Re: ${base}` : 'Re:';
}

export type MarkReplySentResult =
  | { status: 'not_found' }
  | { status: 'invalid_draft' }
  | { status: 'no_application' }
  | {
      status: 'logged' | 'already_logged';
      communicationId: string;
      applicationId: string;
      contactId: string | null;
      auditLogId: string;
    };

const MAX_SENT_SUBJECT = 500;
const MAX_SENT_BODY = 5000;

// "Mark as sent" (#131): the user says the drafted reply went out, so log it
// as an outbound email on the linked application and restart the contact's
// follow-up clock. Nothing touches the mailbox; the click is the record.
// Logged once per draft: a second click for the same draft returns the first
// entry. Synchronous throughout, so two clicks can't both log.
// Known limit: the logged body is the draft, not any edits made in Outlook.
export function markReplySent(
  db: Db,
  userId: string,
  emailId: string,
  input: { draftAuditLogId: string; subject: string; body: string; to: string | null },
  now: Date = new Date(),
): MarkReplySentResult {
  const row = getEmailForUser(db, userId, emailId);
  if (!row) return { status: 'not_found' };

  // The draft must be one this user made for this email.
  const draft = db
    .select({ id: emailAutomationAuditLog.id })
    .from(emailAutomationAuditLog)
    .where(
      and(
        eq(emailAutomationAuditLog.id, input.draftAuditLogId),
        eq(emailAutomationAuditLog.userId, userId),
        eq(emailAutomationAuditLog.inboundEmailId, emailId),
        eq(emailAutomationAuditLog.actionType, 'draft_reply'),
      ),
    )
    .get();
  if (!draft) return { status: 'invalid_draft' };

  // One transaction: the check for an earlier log and the three writes
  // land together, so a failed audit write can't leave an unlogged row that
  // a retry would duplicate.
  return db.transaction((tx): MarkReplySentResult => {
    const earlier = tx
      .select()
      .from(emailAutomationAuditLog)
      .where(
        and(
          eq(emailAutomationAuditLog.userId, userId),
          eq(emailAutomationAuditLog.inboundEmailId, emailId),
          eq(emailAutomationAuditLog.actionType, 'record_communication'),
        ),
      )
      .all()
      .find((r) => {
        try {
          return (JSON.parse(r.detailsJson) as { draftAuditLogId?: string }).draftAuditLogId === draft.id;
        } catch {
          return false;
        }
      });
    if (earlier) {
      const changes = JSON.parse(earlier.resultingChangesJson) as {
        communicationId: string;
        applicationId: string;
        contactId: string | null;
      };
      return { status: 'already_logged', ...changes, auditLogId: earlier.id };
    }

    // Only the user's explicit link, never a fuzzy match.
    const app = tx
      .select({ id: applications.id })
      .from(emailApplicationLinks)
      .innerJoin(applications, eq(applications.id, emailApplicationLinks.applicationId))
      .where(
        and(
          eq(emailApplicationLinks.userId, userId),
          eq(emailApplicationLinks.inboundEmailId, emailId),
          eq(applications.userId, userId),
        ),
      )
      .get();
    if (!app) return { status: 'no_application' };

    // The contact on this application with the address the reply went to.
    // Failing that, the contact this email created or merged into (a
    // recruiter writing from a second address keeps their first one).
    // Known limit: a reply sent to someone else on the thread (a hiring
    // manager, say) then restarts that contact's clock too.
    const appContacts = tx
      .select({ id: contacts.id, email: contacts.email, lastContactDate: contacts.lastContactDate })
      .from(contacts)
      .where(and(eq(contacts.userId, userId), eq(contacts.applicationId, app.id)))
      .all();
    const to = emailAddressesIn(input.to ?? '')[0] ?? null;
    const createdIds = tx
      .select({ resultingChangesJson: emailAutomationAuditLog.resultingChangesJson })
      .from(emailAutomationAuditLog)
      .where(
        and(
          eq(emailAutomationAuditLog.userId, userId),
          eq(emailAutomationAuditLog.inboundEmailId, emailId),
          eq(emailAutomationAuditLog.actionType, 'create_contact'),
          eq(emailAutomationAuditLog.status, 'completed'),
        ),
      )
      .all()
      .map((r) => {
        try {
          return (JSON.parse(r.resultingChangesJson) as { contactId?: string }).contactId ?? null;
        } catch {
          return null;
        }
      });
    const contact =
      (to ? appContacts.find((c) => c.email.trim().toLowerCase() === to) : undefined) ??
      appContacts.find((c) => createdIds.includes(c.id));

    const timestamp = now.toISOString();
    const communicationId = createId();
    tx.insert(communications)
      .values({
        id: communicationId,
        userId,
        applicationId: app.id,
        contactId: contact?.id ?? null,
        channel: 'email',
        direction: 'outbound',
        subject: (input.subject.trim() || replySubjectFor(row.subject)).slice(0, MAX_SENT_SUBJECT),
        body: input.body.slice(0, MAX_SENT_BODY),
        occurredAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    // Never move the date backwards: inbound emails store a UTC day, which
    // can be a day ahead of the Pacific day in the evening, and a manually
    // entered later date stays.
    const today = pacificDay(now);
    if (contact && !(contact.lastContactDate && contact.lastContactDate.slice(0, 10) >= today)) {
      tx.update(contacts)
        .set({ lastContactDate: today, updatedAt: timestamp })
        .where(and(eq(contacts.id, contact.id), eq(contacts.userId, userId)))
        .run();
    }

    const auditLogId = recordEmailAutomationAudit(tx, {
      userId,
      inboundEmailId: emailId,
      actionType: 'record_communication',
      confidence: null,
      details: { via: 'mark_sent', draftAuditLogId: draft.id },
      resultingChanges: {
        communicationId,
        applicationId: app.id,
        contactId: contact?.id ?? null,
      },
    });

    return {
      status: 'logged',
      communicationId,
      applicationId: app.id,
      contactId: contact?.id ?? null,
      auditLogId,
    };
  });
}

export function runEmailAutomation(
  db: Db,
  userId: string,
  emailId: string,
  options: { applicationId?: string; force?: boolean } = {},
): {
  analysis: EmailAutomationAnalysis;
  results: AutomationActionResult[];
} | null {
  const analysis = analyzeEmailAutomation(db, userId, emailId);
  if (!analysis) return null;

  const results: AutomationActionResult[] = [];
  const applicationId =
    options.applicationId ??
    analysis.matches.bestMatch?.applicationId ??
    analysis.duplicateApplicationId ??
    undefined;

  // "Run all" is a deliberate human confirmation, so it may create from a
  // confidently-identified company even when the role is missing (stored as
  // "Unknown role"). Background auto-creation elsewhere still uses the strict
  // canCreateApplication (company AND role) — this path does not weaken it.
  if (analysis.canOfferApplicationCreation && !applicationId) {
    const createResult = createApplicationFromEmail(db, userId, emailId, {
      allowMissingRole: true,
    });
    if (createResult) {
      results.push(createResult);
      if (createResult.success && createResult.changes.applicationId) {
        const emailRow = getEmailForUser(db, userId, emailId);
        if (emailRow?.classification !== 'Application Confirmation') {
          const contactResult = createContactFromEmail(
            db,
            userId,
            emailId,
            String(createResult.changes.applicationId),
          );
          if (contactResult) results.push(contactResult);
        }

        const pipelineResult = updatePipelineFromEmail(db, userId, emailId, {
          applicationId: String(createResult.changes.applicationId),
          force: options.force,
        });
        if (pipelineResult) results.push(pipelineResult);
      }
    }
  } else if (applicationId) {
    const contactResult = createContactFromEmail(db, userId, emailId, applicationId);
    if (contactResult) results.push(contactResult);

    const pipelineResult = updatePipelineFromEmail(db, userId, emailId, {
      applicationId,
      force: options.force,
    });
    if (pipelineResult) results.push(pipelineResult);
  }

  recordAuditLog(db, {
    userId,
    inboundEmailId: emailId,
    actionType: 'run_automation',
    confidence: null,
    details: { resultCount: results.length },
    resultingChanges: {
      actions: results.map((r) => r.actionType),
    },
  });

  return { analysis, results };
}

export function listAuditLogForInboundEmail(
  db: Db,
  userId: string,
  inboundEmailId: string,
  options: { limit?: number } = {},
): AuditLogEntry[] {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const rows = db
    .select()
    .from(emailAutomationAuditLog)
    .where(
      and(
        eq(emailAutomationAuditLog.userId, userId),
        eq(emailAutomationAuditLog.inboundEmailId, inboundEmailId),
      ),
    )
    .orderBy(desc(emailAutomationAuditLog.createdAt))
    .limit(limit)
    .all();

  return rows.map((row) => ({
    id: row.id,
    inboundEmailId: row.inboundEmailId,
    actionType: row.actionType as AutomationActionType,
    confidence: row.confidence,
    status: row.status,
    details: JSON.parse(row.detailsJson) as Record<string, unknown>,
    resultingChanges: JSON.parse(row.resultingChangesJson) as Record<string, unknown>,
    createdAt: row.createdAt,
  }));
}

export function listAuditLogForUser(
  db: Db,
  userId: string,
  options: { limit?: number } = {},
): AuditLogEntry[] {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const rows = db
    .select()
    .from(emailAutomationAuditLog)
    .where(eq(emailAutomationAuditLog.userId, userId))
    .orderBy(desc(emailAutomationAuditLog.createdAt))
    .limit(limit)
    .all();

  return rows.map((row) => {
    const emailRows = db
      .select({ subject: inboundEmails.subject })
      .from(inboundEmails)
      .where(eq(inboundEmails.id, row.inboundEmailId))
      .all();
    return {
      id: row.id,
      inboundEmailId: row.inboundEmailId,
      actionType: row.actionType as AutomationActionType,
      confidence: row.confidence,
      status: row.status,
      details: JSON.parse(row.detailsJson) as Record<string, unknown>,
      resultingChanges: JSON.parse(row.resultingChangesJson) as Record<string, unknown>,
      createdAt: row.createdAt,
      emailSubject: emailRows[0]?.subject,
    };
  });
}

function pendingApprovalToEntry(
  db: Db,
  row: typeof emailAutomationPendingApprovals.$inferSelect,
): PendingApprovalEntry {
  const emailRows = db
    .select({ subject: inboundEmails.subject, suggestedAction: inboundEmails.suggestedAction })
    .from(inboundEmails)
    .where(eq(inboundEmails.id, row.inboundEmailId))
    .all();
  let company: string | undefined;
  let roleTitle: string | undefined;
  if (row.applicationId) {
    const appRows = db
      .select({ company: applications.company, roleTitle: applications.roleTitle })
      .from(applications)
      .where(eq(applications.id, row.applicationId))
      .all();
    company = appRows[0]?.company;
    roleTitle = appRows[0]?.roleTitle;
  }
  const details = approvalReasonFromLegacyRow({
    approvalType: row.approvalType,
    reason: row.reason,
    confidence: row.confidence,
    suggestedAction: row.suggestedAction || emailRows[0]?.suggestedAction,
    detailsJson: row.detailsJson,
  });
  return {
    id: row.id,
    inboundEmailId: row.inboundEmailId,
    approvalType: details.approvalType,
    applicationId: row.applicationId,
    proposedStatus: row.proposedStatus,
    currentStatus: row.currentStatus,
    confidence: row.confidence,
    reason: row.reason,
    reasonCode: details.reasonCode,
    reasonMessage: details.reasonMessage,
    suggestedAction: details.suggestedAction,
    autoApprovalThreshold: details.autoApprovalThreshold,
    stopReason: details.stopReason,
    candidateMatches: details.candidateMatches ?? [],
    status: row.status,
    createdAt: row.createdAt,
    emailSubject: emailRows[0]?.subject,
    company,
    roleTitle,
  };
}

export function listPendingApprovalsForUser(
  db: Db,
  userId: string,
): PendingApprovalEntry[] {
  const rows = db
    .select()
    .from(emailAutomationPendingApprovals)
    .where(
      and(
        eq(emailAutomationPendingApprovals.userId, userId),
        eq(emailAutomationPendingApprovals.status, 'pending'),
      ),
    )
    .orderBy(desc(emailAutomationPendingApprovals.createdAt))
    .all();

  return rows.map((row) => pendingApprovalToEntry(db, row));
}

// The audit action an approval stands for, so a declined draft reply is not
// logged as a pipeline update.
function actionTypeForApproval(approvalType: string): AutomationActionType {
  switch (approvalType) {
    case 'draft_reply':
      return 'draft_reply';
    case 'create_contact':
      return 'create_contact';
    case 'link_application':
      return 'match_applications';
    case 'create_application_suggestion':
      return 'create_application';
    default:
      return 'update_pipeline';
  }
}

export function resolvePendingApproval(
  db: Db,
  userId: string,
  approvalId: string,
  decision: 'approved' | 'rejected',
): AutomationActionResult | null {
  const rows = db
    .select()
    .from(emailAutomationPendingApprovals)
    .where(
      and(
        eq(emailAutomationPendingApprovals.id, approvalId),
        eq(emailAutomationPendingApprovals.userId, userId),
        eq(emailAutomationPendingApprovals.status, 'pending'),
      ),
    )
    .all();
  const approval = rows[0];
  if (!approval) return null;

  const approvalDetails = approvalReasonFromLegacyRow({
    approvalType: approval.approvalType,
    reason: approval.reason,
    confidence: approval.confidence,
    suggestedAction: approval.suggestedAction,
    detailsJson: approval.detailsJson,
  });

  const timestamp = nowIso();
  db.update(emailAutomationPendingApprovals)
    .set({ status: decision, resolvedAt: timestamp })
    .where(eq(emailAutomationPendingApprovals.id, approvalId))
    .run();

  const auditDetails = {
    pendingApprovalId: approvalId,
    approvalType: approval.approvalType,
    reasonCode: approvalDetails.reasonCode,
    reasonMessage: approvalDetails.reasonMessage,
    confidence: approval.confidence,
    suggestedAction: approvalDetails.suggestedAction,
    userDecision: decision,
    stopReason: approvalDetails.stopReason,
  };

  if (decision === 'rejected') {
    const actionType = actionTypeForApproval(approval.approvalType);
    const auditLogId = recordAuditLog(db, {
      userId,
      inboundEmailId: approval.inboundEmailId,
      actionType,
      confidence: approval.confidence,
      status: 'rejected',
      details: auditDetails,
    });
    return {
      success: false,
      actionType,
      confidence: approval.confidence,
      auditLogId,
      changes: {},
      message: `Rejected: ${approvalDetails.reasonMessage}`,
    };
  }

  if (approval.approvalType === 'create_application_suggestion') {
    const createResult = createApplicationFromEmail(db, userId, approval.inboundEmailId, {
      allowMissingRole: true,
    });
    if (!createResult) return null;
    recordAuditLog(db, {
      userId,
      inboundEmailId: approval.inboundEmailId,
      actionType: 'create_application',
      confidence: approval.confidence,
      status: 'completed',
      details: { ...auditDetails, approvedFromPending: approvalId },
      resultingChanges: createResult.changes,
    });
    return createResult;
  }

  if (approval.approvalType === 'link_application' && approval.applicationId) {
    const contactResult = createContactFromEmail(
      db,
      userId,
      approval.inboundEmailId,
      approval.applicationId,
    );
    const pipelineResult = updatePipelineFromEmail(db, userId, approval.inboundEmailId, {
      applicationId: approval.applicationId,
      status: approval.proposedStatus as PipelineStatus,
      force: true,
    });
    const auditLogId = recordAuditLog(db, {
      userId,
      inboundEmailId: approval.inboundEmailId,
      actionType: 'match_applications',
      confidence: approval.confidence,
      status: 'completed',
      details: { ...auditDetails, approvedFromPending: approvalId },
      resultingChanges: {
        contact: contactResult?.changes,
        pipeline: pipelineResult?.changes,
      },
    });
    return (
      pipelineResult ?? {
        success: true,
        actionType: 'match_applications',
        confidence: approval.confidence,
        auditLogId,
        changes: contactResult?.changes ?? {},
        message: formatAutomationActionMessage({
          actionType: 'match_applications',
          success: true,
          detail: 'Linked email to existing application',
        }),
      }
    );
  }

  if (approval.approvalType === 'create_contact' && approval.applicationId) {
    const contactResult = createContactFromEmail(
      db,
      userId,
      approval.inboundEmailId,
      approval.applicationId,
    );
    if (!contactResult) return null;
    recordAuditLog(db, {
      userId,
      inboundEmailId: approval.inboundEmailId,
      actionType: 'create_contact',
      confidence: approval.confidence,
      status: 'completed',
      details: { ...auditDetails, approvedFromPending: approvalId },
      resultingChanges: contactResult.changes,
    });
    return contactResult;
  }

  if (approval.approvalType === 'draft_reply') {
    const draftResult = draftReplyFromEmail(db, userId, approval.inboundEmailId);
    if (!draftResult) return null;
    const auditLogId = recordAuditLog(db, {
      userId,
      inboundEmailId: approval.inboundEmailId,
      actionType: 'draft_reply',
      confidence: approval.confidence,
      status: 'completed',
      details: { ...auditDetails, approvedFromPending: approvalId },
      resultingChanges: { draftLength: draftResult.draft.length },
    });
    return {
      success: true,
      actionType: 'draft_reply',
      confidence: approval.confidence,
      auditLogId,
      changes: { draft: draftResult.draft },
      message: 'Draft reply ready for review',
    };
  }

  if (!approval.applicationId) return null;

  const app = db
    .select()
    .from(applications)
    .where(and(eq(applications.id, approval.applicationId), eq(applications.userId, userId)))
    .all()[0];
  if (!app) return null;

  // The application may have moved on since this was queued.
  if (!isForwardTransition(app.status as PipelineStatus, approval.proposedStatus as PipelineStatus)) {
    const auditLogId = recordAuditLog(db, {
      userId,
      inboundEmailId: approval.inboundEmailId,
      actionType: 'update_pipeline',
      confidence: approval.confidence,
      status: 'rejected',
      details: {
        ...auditDetails,
        approvedFromPending: approvalId,
        reason: 'stage_already_past',
        currentStatus: app.status,
      },
    });
    return {
      success: false,
      actionType: 'update_pipeline',
      confidence: approval.confidence,
      auditLogId,
      changes: {},
      message: `${app.company} is already at ${pipelineStatusLabel(app.status)}, so it stays there`,
    };
  }

  const email = getEmailForUser(db, userId, approval.inboundEmailId);
  const notes = email
    ? appendStageChangeNote(
        app.notes,
        buildStageChangeNote({
          date: localDateKey(timestamp),
          status: approval.proposedStatus,
          senderName: email.originalSenderName ?? email.recruiterName,
          company: app.company,
          text: emailTextForStage(email),
        }),
      )
    : app.notes;

  db.update(applications)
    .set({
      status: approval.proposedStatus,
      notes,
      updatedAt: timestamp,
    })
    .where(eq(applications.id, approval.applicationId))
    .run();

  const auditLogId = recordAuditLog(db, {
    userId,
    inboundEmailId: approval.inboundEmailId,
    actionType: 'update_pipeline',
    confidence: approval.confidence,
    status: 'completed',
    details: { ...auditDetails, approvedFromPending: approvalId },
    resultingChanges: {
      applicationId: approval.applicationId,
      previousStatus: approval.currentStatus,
      newStatus: approval.proposedStatus,
    },
  });

  return {
    success: true,
    actionType: 'update_pipeline',
    confidence: approval.confidence,
    auditLogId,
    changes: {
      applicationId: approval.applicationId,
      newStatus: approval.proposedStatus,
    },
    message: formatAutomationActionMessage({
      actionType: 'update_pipeline',
      success: true,
      detail: `Approved pipeline update to ${pipelineStatusLabel(approval.proposedStatus)}`,
    }),
  };
}

const RECENT_ACTIVITY_MS = 3 * 24 * 60 * 60 * 1000;

export function getAutomationDashboardSummary(
  db: Db,
  userId: string,
): AutomationDashboardSummary {
  const recentActions = listAuditLogForUser(db, userId, { limit: 10 });
  const pendingApprovals = listPendingApprovalsForUser(db, userId);

  const apps = db
    .select()
    .from(applications)
    .where(eq(applications.userId, userId))
    .all();

  const attentionApplications = pendingApprovals
    .filter((a) => a.applicationId)
    .map((a) => ({
      applicationId: a.applicationId!,
      company: a.company ?? 'Unknown',
      roleTitle: a.roleTitle ?? '',
      status: a.currentStatus ?? 'unknown',
      reason: a.reason,
    }));

  // Active applications with recruiter activity in the last 3 days are
  // already being worked; the generic reminder is for quiet ones.
  const recentCutoff = new Date(Date.now() - RECENT_ACTIVITY_MS).toISOString();
  const recentlyActive = new Set(
    db
      .select({ applicationId: communications.applicationId })
      .from(communications)
      .where(and(eq(communications.userId, userId), gte(communications.occurredAt, recentCutoff)))
      .all()
      .map((c) => c.applicationId),
  );

  for (const app of apps) {
    if (app.status === 'recruiter_screen' || app.status === 'interviewing') {
      const alreadyListed = attentionApplications.some(
        (a) => a.applicationId === app.id,
      );
      if (!alreadyListed && !recentlyActive.has(app.id)) {
        attentionApplications.push({
          applicationId: app.id,
          company: app.company,
          roleTitle: app.roleTitle,
          status: app.status,
          reason: 'Active pipeline stage — check for recent recruiter emails',
        });
      }
    }
  }

  return {
    recentActions: recentActions.slice(0, 5),
    pendingApprovals,
    attentionApplications: attentionApplications.slice(0, 8),
  };
}
