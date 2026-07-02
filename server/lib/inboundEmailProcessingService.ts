import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { emailAutomationPendingApprovals, inboundEmails } from '../db/schema.js';
import {
  analyzeEmailAutomation,
  recordEmailAutomationAudit,
} from './emailAutomationService.js';
import {
  classifyEmailContent,
  persistForwardMetadata,
} from './emailClassificationService.js';
import { applySafeAutomationRules } from './emailProcessingAutomation.js';
import { nowIso } from './id.js';
import { resolveUserIdForInboundEmail } from './inboundEmailUserResolver.js';
import { isInboundEmailDeleted } from './inboundEmailService.js';
import { ProcessingTimelineBuilder } from './processingTimeline.js';
import type {
  InboundEmailProcessingResult,
  ProcessingStatus,
} from './inboundEmailProcessingTypes.js';

function extractTextBody(payloadJson: string): string {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    return typeof payload.TextBody === 'string' ? payload.TextBody : '';
  } catch {
    return '';
  }
}

function saveTimeline(db: Db, emailId: string, builder: ProcessingTimelineBuilder): void {
  db.update(inboundEmails)
    .set({
      processingTimelineJson: builder.toJson(),
      updatedAt: nowIso(),
    })
    .where(eq(inboundEmails.id, emailId))
    .run();
}

function markProcessingStarted(db: Db, emailId: string): void {
  const timestamp = nowIso();
  const row = db
    .select()
    .from(inboundEmails)
    .where(eq(inboundEmails.id, emailId))
    .limit(1)
    .all()[0];
  if (!row) return;

  db.update(inboundEmails)
    .set({
      processingStatus: 'processing',
      processingStartedAt: timestamp,
      processingAttempts: row.processingAttempts + 1,
      processingError: null,
      updatedAt: timestamp,
    })
    .where(eq(inboundEmails.id, emailId))
    .run();
}

function markProcessingComplete(
  db: Db,
  emailId: string,
  status: ProcessingStatus,
  error: string | null = null,
): void {
  const timestamp = nowIso();
  db.update(inboundEmails)
    .set({
      processingStatus: status,
      processingCompletedAt: timestamp,
      processingError: error,
      lastProcessedAt: status === 'processed' ? timestamp : undefined,
      updatedAt: timestamp,
    })
    .where(eq(inboundEmails.id, emailId))
    .run();
}

async function classifyInboundEmailRow(
  db: Db,
  row: typeof inboundEmails.$inferSelect,
  timeline: ProcessingTimelineBuilder,
): Promise<boolean> {
  const textBody = extractTextBody(row.payload);
  persistForwardMetadata(db, row.id, {
    subject: row.subject,
    fromEmail: row.fromEmail,
    textBody,
  });

  const result = await classifyEmailContent({
    subject: row.subject,
    fromEmail: row.fromEmail,
    textBody,
  });

  const timestamp = nowIso();
  db.update(inboundEmails)
    .set({
      classification: result.classification,
      classificationConfidence: result.classificationConfidence,
      companyName: result.companyName,
      positionTitle: result.positionTitle,
      recruiterName: result.recruiterName,
      requiresResponse: result.requiresResponse,
      suggestedAction: result.suggestedAction,
      actionDueAt: result.actionDueAt,
      interviewDetected: result.interviewDetected,
      interviewDatetime: result.interviewDatetime,
      aiSummary: result.aiSummary,
      processedAt: timestamp,
      updatedAt: timestamp,
    })
    .where(eq(inboundEmails.id, row.id))
    .run();

  timeline.complete(
    'classified',
    `Classified as "${result.classification}" (${result.classificationConfidence ?? 0}% confidence)`,
    timestamp,
  );
  saveTimeline(db, row.id, timeline);

  return true;
}

export async function processInboundEmail(
  db: Db,
  emailId: string,
  options: {
    userId?: string;
    reanalysis?: boolean;
    manual?: boolean;
  } = {},
): Promise<InboundEmailProcessingResult> {
  const rows = db
    .select()
    .from(inboundEmails)
    .where(eq(inboundEmails.id, emailId))
    .limit(1)
    .all();
  const row = rows[0];
  if (!row) {
    return {
      emailId,
      processingStatus: 'failed',
      processingError: 'Email not found',
      classificationRan: false,
      automationActions: 0,
      pendingApprovals: 0,
      skipped: true,
      reason: 'not_found',
    };
  }

  const timeline = new ProcessingTimelineBuilder();
  const startedAt = nowIso();
  timeline.complete(
    'received',
    `Email received from ${row.fromEmail || 'unknown sender'}`,
    row.receivedAt,
  );
  timeline.complete('persisted', 'Email stored in database', row.createdAt);
  saveTimeline(db, emailId, timeline);

  if (isInboundEmailDeleted(row)) {
    return {
      emailId,
      processingStatus: row.processingStatus as ProcessingStatus,
      processingError: null,
      classificationRan: false,
      automationActions: 0,
      pendingApprovals: 0,
      skipped: true,
      reason: 'deleted',
    };
  }

  if (
    !options.reanalysis &&
    row.processingStatus === 'processed' &&
    !options.manual
  ) {
    return {
      emailId,
      processingStatus: 'processed',
      processingError: null,
      classificationRan: false,
      automationActions: 0,
      pendingApprovals: 0,
      skipped: true,
      reason: 'already_processed',
    };
  }

  if (row.processingStatus === 'processing' && !options.reanalysis) {
    return {
      emailId,
      processingStatus: 'processing',
      processingError: null,
      classificationRan: false,
      automationActions: 0,
      pendingApprovals: 0,
      skipped: true,
      reason: 'already_processing',
    };
  }

  const userId = options.userId ?? resolveUserIdForInboundEmail(db, row);
  if (!userId) {
    markProcessingStarted(db, emailId);
    const failTime = nowIso();
    timeline.fail(
      'processing_failed',
      'Processing failed — no matching user',
      'No matching user found for inbound email',
      failTime,
    );
    saveTimeline(db, emailId, timeline);
    markProcessingComplete(
      db,
      emailId,
      'failed',
      'No matching user found for inbound email',
    );
    return {
      emailId,
      processingStatus: 'failed',
      processingError: 'No matching user found for inbound email',
      classificationRan: false,
      automationActions: 0,
      pendingApprovals: 0,
    };
  }

  markProcessingStarted(db, emailId);

  try {
    await Promise.resolve();
    await classifyInboundEmailRow(db, row, timeline);

    const updatedRow = db
      .select()
      .from(inboundEmails)
      .where(eq(inboundEmails.id, emailId))
      .limit(1)
      .all()[0];

    const analysis = analyzeEmailAutomation(db, userId, emailId);
    const matchTime = nowIso();
    if (analysis?.matches.bestMatch) {
      timeline.complete(
        'application_matched',
        `Matched existing application: ${analysis.matches.bestMatch.company} / ${analysis.matches.bestMatch.roleTitle}`,
        matchTime,
      );
    } else if (analysis?.duplicateApplicationId) {
      timeline.skip(
        'application_matched',
        'Skipped application creation: duplicate found',
        matchTime,
      );
    } else {
      timeline.skip(
        'application_matched',
        'No matched application for this email',
        matchTime,
      );
    }

    const evalTime = nowIso();
    if (analysis) {
      const evalParts: string[] = [];
      if (analysis.canCreateApplication) evalParts.push('can create application');
      if (analysis.pipelineProposal) {
        evalParts.push(
          `pipeline update to ${analysis.pipelineProposal.proposedStatus}`,
        );
      }
      timeline.complete(
        'automation_evaluated',
        evalParts.length > 0
          ? `Automation evaluated: ${evalParts.join('; ')}`
          : 'Automation evaluated — no automatic changes suggested',
        evalTime,
      );
    } else {
      timeline.skip('automation_evaluated', 'Automation analysis unavailable', evalTime);
    }
    saveTimeline(db, emailId, timeline);

    const automation = applySafeAutomationRules(db, userId, emailId, {
      skipCompletedActions: Boolean(options.reanalysis),
      timeline,
    });

    const actionTime = nowIso();
    if (automation.results.length > 0) {
      const messages = automation.results.map((r) => r.message).join('; ');
      timeline.complete('safe_actions_applied', messages, actionTime);
    } else {
      timeline.skip(
        'safe_actions_applied',
        automation.skipSummary ?? 'No safe automation actions applied',
        actionTime,
      );
    }

    if (automation.pendingApprovals > 0) {
      timeline.complete(
        'approval_queued',
        automation.approvalSummary ??
          `${automation.pendingApprovals} approval(s) queued`,
        actionTime,
      );
    } else {
      timeline.skip('approval_queued', 'No approvals required', actionTime);
    }

    recordEmailAutomationAudit(db, {
      userId,
      inboundEmailId: emailId,
      actionType: options.reanalysis ? 'reanalyze' : 'auto_process',
      confidence: updatedRow?.classificationConfidence ?? null,
      details: {
        manual: options.manual ?? false,
        automationActions: automation.results.length,
        pendingApprovals: automation.pendingApprovals,
        riskyReasons: automation.riskyReasons,
        skipSummary: automation.skipSummary,
      },
      resultingChanges: {
        actions: automation.results.map((r) => r.actionType),
      },
    });

    const auditTime = nowIso();
    timeline.complete('audit_logged', 'Processing audit log recorded', auditTime);

    const completeTime = nowIso();
    timeline.complete(
      'processing_completed',
      `Processing completed with ${automation.results.length} action(s)`,
      completeTime,
    );
    saveTimeline(db, emailId, timeline);
    markProcessingComplete(db, emailId, 'processed');

    return {
      emailId,
      processingStatus: 'processed',
      processingError: null,
      classificationRan: true,
      automationActions: automation.results.length,
      pendingApprovals: automation.pendingApprovals,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Processing failed';
    console.error('[inbound-processing] failed', { emailId, err });
    const failTime = nowIso();
    timeline.fail('processing_failed', 'Processing failed', message, failTime);
    saveTimeline(db, emailId, timeline);
    markProcessingComplete(db, emailId, 'failed', message);
    return {
      emailId,
      processingStatus: 'failed',
      processingError: message,
      classificationRan: false,
      automationActions: 0,
      pendingApprovals: 0,
    };
  }
}

export function emailHasPendingApprovals(db: Db, emailId: string): boolean {
  const rows = db
    .select()
    .from(emailAutomationPendingApprovals)
    .where(eq(emailAutomationPendingApprovals.inboundEmailId, emailId))
    .all();
  return rows.some((row) => row.status === 'pending');
}

export function processingFieldsFromRow(
  row: typeof inboundEmails.$inferSelect,
) {
  return {
    processingStatus: row.processingStatus as ProcessingStatus,
    processingStartedAt: row.processingStartedAt,
    processingCompletedAt: row.processingCompletedAt,
    processingError: row.processingError,
    lastProcessedAt: row.lastProcessedAt,
    processingAttempts: row.processingAttempts,
  };
}
