import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { emailAutomationPendingApprovals, inboundEmails } from '../db/schema.js';
import { recordEmailAutomationAudit } from './emailAutomationService.js';
import { classifyEmailContent } from './emailClassificationService.js';
import { applySafeAutomationRules } from './emailProcessingAutomation.js';
import { nowIso } from './id.js';
import { resolveUserIdForInboundEmail } from './inboundEmailUserResolver.js';
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
): Promise<boolean> {
  const textBody = extractTextBody(row.payload);
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
    await classifyInboundEmailRow(db, row);

    const automation = applySafeAutomationRules(db, userId, emailId, {
      skipCompletedActions: Boolean(options.reanalysis),
    });

    recordEmailAutomationAudit(db, {
      userId,
      inboundEmailId: emailId,
      actionType: options.reanalysis ? 'reanalyze' : 'auto_process',
      confidence: null,
      details: {
        manual: options.manual ?? false,
        automationActions: automation.results.length,
        pendingApprovals: automation.pendingApprovals,
        riskyReasons: automation.riskyReasons,
      },
      resultingChanges: {
        actions: automation.results.map((r) => r.actionType),
      },
    });

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
