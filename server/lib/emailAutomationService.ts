import { and, desc, eq } from 'drizzle-orm';
import type { PipelineStatus } from './emailAutomationTypes.js';
import type { Db } from '../db/index.js';
import {
  applications,
  communications,
  contacts,
  emailAutomationAuditLog,
  emailAutomationPendingApprovals,
  inboundEmails,
  interviews,
} from '../db/schema.js';
import {
  findDuplicateApplication,
  matchEmailToApplications,
} from './emailApplicationMatcher.js';
import { buildDraftReply, generateNextActions } from './emailNextActions.js';
import type {
  AuditLogEntry,
  AutomationActionResult,
  AutomationDashboardSummary,
  EmailAutomationAnalysis,
  PendingApprovalEntry,
} from './emailAutomationTypes.js';
import type { AutomationActionType } from './emailAutomationTypes.js';
import { buildPipelineUpdateProposal } from './emailPipelineAutomation.js';
import {
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
  getUserEmailContext,
  inboundEmailBelongsToUser,
  isInboundEmailDeleted,
} from './inboundEmailService.js';
import { createId, nowIso } from './id.js';

const CREATE_APPLICATION_CLASSIFICATIONS = new Set([
  'Recruiter Outreach',
  'Application Confirmation',
  'Interview Request',
  'Scheduling',
]);

function getEmailForUser(db: Db, userId: string, emailId: string) {
  const { userEmail, contactEmails } = getUserEmailContext(db, userId);
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
    !inboundEmailBelongsToUser(row, userEmail, contactEmails)
  ) {
    return null;
  }
  return row;
}

export function recordEmailAutomationAudit(
  db: Db,
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
    fromEmail: effectiveFromEmail,
    companyName: effectiveCompany,
    positionTitle: effectiveRole,
    recruiterName: row.recruiterName ?? row.originalSenderName,
  });

  const duplicateApplicationId = findDuplicateApplication(
    db,
    userId,
    effectiveCompany,
    effectiveRole,
  );

  const canCreateApplication =
    CREATE_APPLICATION_CLASSIFICATIONS.has(row.classification ?? '') &&
    !matches.bestMatch &&
    !duplicateApplicationId &&
    hasIdentifiedCompanyAndRole({
      companyName: effectiveCompany,
      originalCompany: row.originalCompany,
      positionTitle: effectiveRole,
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
      });
    }
  }

  const nextActions = generateNextActions({
    classification: row.classification,
    requiresResponse: row.requiresResponse,
    interviewDetected: row.interviewDetected,
    suggestedAction: row.suggestedAction,
    matches,
    pipelineProposal,
    canCreateApplication,
  });

  return {
    emailId,
    matches,
    nextActions,
    pipelineProposal,
    canCreateApplication,
    duplicateApplicationId,
  };
}

export function createApplicationFromEmail(
  db: Db,
  userId: string,
  emailId: string,
  options: { applicationId?: string } = {},
): AutomationActionResult | null {
  const row = getEmailForUser(db, userId, emailId);
  if (!row) return null;

  if (
    !options.applicationId &&
    !hasIdentifiedCompanyAndRole({
      companyName: row.companyName,
      originalCompany: row.originalCompany,
      positionTitle: row.positionTitle,
      subject: row.originalSubject ?? row.subject,
      senderEmail: row.originalSenderEmail ?? row.fromEmail,
    })
  ) {
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
        detail: 'company and role must be identified',
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
  const dateApplied =
    row.classification === 'Application Confirmation'
      ? row.receivedAt.slice(0, 10)
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
  const existingContacts = db
    .select()
    .from(contacts)
    .where(eq(contacts.userId, userId))
    .all();

  const existing = existingContacts.find(
    (c) =>
      c.applicationId === applicationId &&
      c.email.trim().toLowerCase() === fromEmail,
  );

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

  if (existing) {
    contactId = existing.id;
    merged = true;
    const name = row.recruiterName?.trim() || existing.name;
    db.update(contacts)
      .set({
        name,
        lastContactDate: row.receivedAt.slice(0, 10),
        messageNotes: row.aiSummary
          ? `${existing.messageNotes}\n[${row.receivedAt.slice(0, 10)}] ${row.aiSummary}`.trim()
          : existing.messageNotes,
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
    const company = isLikelyDomainCompany(extractedCompany)
      ? (appRows[0]?.company ?? '')
      : extractedCompany || appRows[0]?.company || '';
    db.insert(contacts)
      .values({
        id: contactId,
        userId,
        applicationId,
        name,
        email: row.originalSenderEmail ?? row.fromEmail,
        linkedIn: '',
        company,
        source: row.fromEmail.includes('linkedin') ? 'linkedin' : 'email',
        lastContactDate: row.receivedAt.slice(0, 10),
        messageNotes: row.aiSummary ?? '',
        nextAction: resolvedNextAction,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }

  const textBody = extractTextBody(row.payload);
  const commId = createId();
  db.insert(communications)
    .values({
      id: commId,
      userId,
      applicationId,
      contactId,
      channel: 'email',
      direction: 'inbound',
      subject: row.subject,
      body: textBody.slice(0, 5000),
      occurredAt: row.receivedAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  const auditLogId = recordAuditLog(db, {
    userId,
    inboundEmailId: emailId,
    actionType: 'create_contact',
    confidence: row.classificationConfidence,
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
  });

  const targetStatus = input.status ?? proposal?.proposedStatus;
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
        detail: 'no matched application',
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
    updates.dateApplied = row.receivedAt.slice(0, 10);
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

  if (analysis.canCreateApplication && !applicationId) {
    const createResult = createApplicationFromEmail(db, userId, emailId);
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
    const auditLogId = recordAuditLog(db, {
      userId,
      inboundEmailId: approval.inboundEmailId,
      actionType: 'update_pipeline',
      confidence: approval.confidence,
      status: 'rejected',
      details: auditDetails,
    });
    return {
      success: false,
      actionType: 'update_pipeline',
      confidence: approval.confidence,
      auditLogId,
      changes: {},
      message: `Rejected: ${approvalDetails.reasonMessage}`,
    };
  }

  if (approval.approvalType === 'create_application_suggestion') {
    const createResult = createApplicationFromEmail(db, userId, approval.inboundEmailId);
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

  db.update(applications)
    .set({
      status: approval.proposedStatus,
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
      detail: `Approved pipeline update to ${approval.proposedStatus.replace(/_/g, ' ')}`,
    }),
  };
}

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

  for (const app of apps) {
    if (app.status === 'recruiter_screen' || app.status === 'interviewing') {
      const alreadyListed = attentionApplications.some(
        (a) => a.applicationId === app.id,
      );
      if (!alreadyListed) {
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
