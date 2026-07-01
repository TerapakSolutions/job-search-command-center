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
  },
): string {
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
      reason: input.reason,
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

  const matches = matchEmailToApplications(db, userId, {
    fromEmail: row.fromEmail,
    companyName: row.companyName,
    positionTitle: row.positionTitle,
    recruiterName: row.recruiterName,
  });

  const duplicateApplicationId = findDuplicateApplication(
    db,
    userId,
    row.companyName,
    row.positionTitle,
  );

  const canCreateApplication =
    CREATE_APPLICATION_CLASSIFICATIONS.has(row.classification ?? '') &&
    !matches.bestMatch &&
    !duplicateApplicationId;

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

  const duplicateId = findDuplicateApplication(
    db,
    userId,
    row.companyName,
    row.positionTitle,
  );
  if (duplicateId && !options.applicationId) {
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
      message: 'An application already exists for this company and role.',
    };
  }

  const timestamp = nowIso();
  const appId = createId();
  const company = row.companyName?.trim() || row.fromEmail.split('@')[1] || 'Unknown';
  const roleTitle = row.positionTitle?.trim() || 'Unknown role';
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
    message: `Created application for ${company} — ${roleTitle}`,
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

  const fromEmail = row.fromEmail.trim().toLowerCase();
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
        nextAction: row.suggestedAction ?? existing.nextAction,
        updatedAt: timestamp,
      })
      .where(eq(contacts.id, existing.id))
      .run();
  } else {
    contactId = createId();
    const name =
      row.recruiterName?.trim() ||
      row.fromEmail.split('@')[0].replace(/[._]/g, ' ') ||
      'Recruiter';
    db.insert(contacts)
      .values({
        id: contactId,
        userId,
        applicationId,
        name,
        email: row.fromEmail,
        linkedIn: '',
        lastContactDate: row.receivedAt.slice(0, 10),
        messageNotes: row.aiSummary ?? '',
        nextAction: row.suggestedAction ?? '',
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
      : 'Created contact and logged communication',
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
      message: 'No pipeline update suggested for this email.',
    };
  }

  const confidence = row.classificationConfidence ?? 50;
  const requiresApproval =
    proposal?.requiresApproval && !input.force && confidence < 75;

  if (requiresApproval) {
    const approvalId = createId();
    const timestamp = nowIso();
    db.insert(emailAutomationPendingApprovals)
      .values({
        id: approvalId,
        userId,
        inboundEmailId: emailId,
        approvalType: 'pipeline_update',
        applicationId: app.id,
        proposedStatus: targetStatus,
        currentStatus: app.status,
        confidence,
        reason: proposal?.reason ?? 'Low-confidence pipeline update',
        status: 'pending',
        createdAt: timestamp,
      })
      .run();

    const auditLogId = recordAuditLog(db, {
      userId,
      inboundEmailId: emailId,
      actionType: 'update_pipeline',
      confidence,
      status: 'pending',
      details: { pendingApprovalId: approvalId, proposedStatus: targetStatus },
    });

    return {
      success: true,
      actionType: 'update_pipeline',
      confidence,
      auditLogId,
      pendingApprovalId: approvalId,
      changes: { pendingApprovalId: approvalId, proposedStatus: targetStatus },
      message: 'Pipeline update requires approval due to low confidence.',
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
    message: `Updated application status to ${targetStatus}`,
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
        const contactResult = createContactFromEmail(
          db,
          userId,
          emailId,
          String(createResult.changes.applicationId),
        );
        if (contactResult) results.push(contactResult);

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

  return rows.map((row) => {
    const emailRows = db
      .select({ subject: inboundEmails.subject })
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
    return {
      id: row.id,
      inboundEmailId: row.inboundEmailId,
      approvalType: row.approvalType,
      applicationId: row.applicationId,
      proposedStatus: row.proposedStatus,
      currentStatus: row.currentStatus,
      confidence: row.confidence,
      reason: row.reason,
      status: row.status,
      createdAt: row.createdAt,
      emailSubject: emailRows[0]?.subject,
      company,
      roleTitle,
    };
  });
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
  if (!approval || !approval.applicationId) return null;

  const timestamp = nowIso();
  db.update(emailAutomationPendingApprovals)
    .set({ status: decision, resolvedAt: timestamp })
    .where(eq(emailAutomationPendingApprovals.id, approvalId))
    .run();

  if (decision === 'rejected') {
    const auditLogId = recordAuditLog(db, {
      userId,
      inboundEmailId: approval.inboundEmailId,
      actionType: 'update_pipeline',
      confidence: approval.confidence,
      status: 'rejected',
      details: { pendingApprovalId: approvalId },
    });
    return {
      success: false,
      actionType: 'update_pipeline',
      confidence: approval.confidence,
      auditLogId,
      changes: {},
      message: 'Pipeline update rejected.',
    };
  }

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
    resultingChanges: {
      applicationId: approval.applicationId,
      previousStatus: approval.currentStatus,
      newStatus: approval.proposedStatus,
      approvedFromPending: approvalId,
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
    message: `Approved pipeline update to ${approval.proposedStatus}`,
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
