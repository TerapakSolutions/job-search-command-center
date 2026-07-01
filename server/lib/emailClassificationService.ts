import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { inboundEmails } from '../db/schema.js';
import {
  classifyInboundEmailWithLlm,
  classifyInboundEmailWithRules,
} from './emailClassificationEngine.js';
import type { InboundEmailClassificationFields } from './emailClassificationTypes.js';
import { nowIso } from './id.js';
import {
  getUserEmailContext,
  inboundEmailBelongsToUser,
} from './inboundEmailService.js';

export type {
  EmailClassification,
  EmailClassificationResult,
  InboundEmailClassificationFields,
} from './emailClassificationTypes.js';
export { EMAIL_CLASSIFICATIONS } from './emailClassificationTypes.js';
export {
  defaultSuggestedAction,
  parseClassificationJson,
} from './emailClassificationParser.js';

function extractTextBody(payloadJson: string): string {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    return typeof payload.TextBody === 'string' ? payload.TextBody : '';
  } catch {
    return '';
  }
}

export function classificationFieldsFromRow(
  row: typeof inboundEmails.$inferSelect,
): InboundEmailClassificationFields {
  return {
    classification: row.classification,
    classificationConfidence: row.classificationConfidence,
    companyName: row.companyName,
    positionTitle: row.positionTitle,
    recruiterName: row.recruiterName,
    requiresResponse: row.requiresResponse,
    suggestedAction: row.suggestedAction,
    actionDueAt: row.actionDueAt,
    interviewDetected: row.interviewDetected,
    interviewDatetime: row.interviewDatetime,
    aiSummary: row.aiSummary,
    processedAt: row.processedAt,
  };
}

export async function classifyEmailContent(input: {
  subject: string;
  fromEmail: string;
  textBody: string;
}) {
  try {
    const llmResult = await classifyInboundEmailWithLlm(input);
    if (llmResult) return llmResult;
  } catch (err) {
    console.error('[email-classification] LLM classification failed', err);
  }

  return classifyInboundEmailWithRules(input);
}

export async function classifyInboundEmailForUser(
  db: Db,
  userId: string,
  emailId: string,
  options: { force?: boolean } = {},
): Promise<InboundEmailClassificationFields | null> {
  const { userEmail, contactEmails } = getUserEmailContext(db, userId);
  const rows = db
    .select()
    .from(inboundEmails)
    .where(eq(inboundEmails.id, emailId))
    .limit(1)
    .all();
  const row = rows[0];
  if (!row || !inboundEmailBelongsToUser(row, userEmail, contactEmails)) {
    return null;
  }

  if (row.processedAt && !options.force) {
    return classificationFieldsFromRow(row);
  }

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
    .where(eq(inboundEmails.id, emailId))
    .run();

  return {
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
  };
}

export async function classifyUnprocessedInboundEmailsForUser(
  db: Db,
  userId: string,
  options: { limit?: number } = {},
): Promise<{ classified: number; failed: number; skipped: number }> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const { userEmail, contactEmails } = getUserEmailContext(db, userId);

  const candidates = db
    .select()
    .from(inboundEmails)
    .all()
    .filter((row) => inboundEmailBelongsToUser(row, userEmail, contactEmails))
    .filter((row) => !row.processedAt)
    .sort(
      (a, b) =>
        new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
    )
    .slice(0, limit);

  let classified = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of candidates) {
    try {
      const result = await classifyInboundEmailForUser(db, userId, row.id);
      if (result) {
        classified += 1;
      } else {
        skipped += 1;
      }
    } catch (err) {
      failed += 1;
      console.error('[email-classification] Failed to classify email', {
        emailId: row.id,
        err,
      });
    }
  }

  return { classified, failed, skipped };
}
