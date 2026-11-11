import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { inboundEmails } from '../db/schema.js';
import {
  classifyInboundEmailWithLlm,
  classifyInboundEmailWithRules,
} from './emailClassificationEngine.js';
import { inferEmployerFromSenderEmail,
  isInterviewConfirmationText ,
  resolveEmployerCompany,
  resolveRoleTitle,
} from './emailContentExtraction.js';
import type {
  EmailClassificationResult,
  InboundEmailClassificationFields,
} from './emailClassificationTypes.js';
import { classificationInputFromEmail } from './emailForwardedParser.js';
import { nowIso } from './id.js';
import {
  getUserEmailContext,
  inboundEmailBelongsToUser,
  isInboundEmailDeleted,
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
import { LlmQuotaError } from './llmClient.js';

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

function applyKnownPatternRuleOverrides(
  result: EmailClassificationResult,
  classifiedInput: ReturnType<typeof classificationInputFromEmail>,
): EmailClassificationResult {
  const haystack = `${classifiedInput.subject}\n${classifiedInput.textBody}`;
  const ruleResult = classifyInboundEmailWithRules({
    subject: classifiedInput.subject,
    fromEmail: classifiedInput.fromEmail,
    textBody: classifiedInput.textBody,
    writtenByCandidate: classifiedInput.forwardMetadata.topMessageFromForwarder,
  });

  // The job seeker's own reply agreeing to be submitted, or saying they are
  // already submitted through another vendor. The rules need a message they
  // wrote and a specific phrase, so their label wins; the company, role and
  // recruiter the LLM extracted are kept.
  if (
    classifiedInput.forwardMetadata.topMessageFromForwarder &&
    CANDIDATE_WRITTEN_LABELS.has(ruleResult.classification)
  ) {
    return enrichClassificationFromForward(
      {
        ...ruleResult,
        companyName: result.companyName ?? ruleResult.companyName,
        positionTitle: result.positionTitle ?? ruleResult.positionTitle,
        recruiterName: result.recruiterName ?? ruleResult.recruiterName,
      },
      classifiedInput,
    );
  }

  if (
    isInterviewConfirmationText(haystack) &&
    ruleResult.classification === 'Scheduling' &&
    (result.classification === 'Other' ||
      result.classification === 'General Update' ||
      (result.classificationConfidence ?? 0) < ruleResult.classificationConfidence)
  ) {
    return enrichClassificationFromForward(ruleResult, classifiedInput);
  }

  return enrichClassificationFromForward(result, classifiedInput);
}

export async function classifyEmailContent(input: {
  subject: string;
  fromEmail: string;
  fromName?: string | null;
  textBody: string;
}) {
  const classifiedInput = classificationInputFromEmail(input);

  try {
    const llmResult = await classifyInboundEmailWithLlm({
      subject: classifiedInput.subject,
      fromEmail: classifiedInput.fromEmail,
      textBody: classifiedInput.textBody,
      writtenByCandidate: classifiedInput.forwardMetadata.topMessageFromForwarder,
    });
    if (llmResult) {
      return applyKnownPatternRuleOverrides(llmResult, classifiedInput);
    }
  } catch (err) {
    // A spent budget is expected, not an error; the client warned once.
    if (!(err instanceof LlmQuotaError)) {
      console.error('[email-classification] LLM classification failed', err);
    }
  }

  const ruleResult = classifyInboundEmailWithRules({
    subject: classifiedInput.subject,
    fromEmail: classifiedInput.fromEmail,
    textBody: classifiedInput.textBody,
    writtenByCandidate: classifiedInput.forwardMetadata.topMessageFromForwarder,
  });
  return enrichClassificationFromForward(ruleResult, classifiedInput);
}

// Labels only a message the job seeker wrote can have.
const CANDIDATE_WRITTEN_LABELS = new Set<string>([
  'Agreed to Submission',
  'Already Submitted Elsewhere',
]);

const WAIT_FOR_REPLY_LABELS = new Set<string>([
  'Follow-up Required',
  'Recruiter Outreach',
  'General Update',
  'Other',
]);

function enrichClassificationFromForward(
  result: EmailClassificationResult,
  classifiedInput: ReturnType<typeof classificationInputFromEmail>,
): EmailClassificationResult {
  const { forwardMetadata } = classifiedInput;
  const outbound = forwardMetadata.topMessageFromForwarder;
  // Only a message the job seeker wrote can have these labels; any other
  // email the LLM puts there falls back to the rules.
  if (!outbound && CANDIDATE_WRITTEN_LABELS.has(result.classification)) {
    result = classifyInboundEmailWithRules({
      subject: classifiedInput.subject,
      fromEmail: classifiedInput.fromEmail,
      textBody: classifiedInput.textBody,
    });
  }
  // The job seeker wrote an outbound top message, so no reply is owed. For
  // labels where the next step is the other side's (a follow-up or general
  // note the job seeker sent), say so: the LLM tends to suggest replying to
  // the job seeker. Labels with their own next step (interview, offer,
  // rejection, agreed to submission, ...) keep it.
  if (outbound) {
    const counterparty = forwardMetadata.originalSenderName?.trim();
    result = {
      ...result,
      requiresResponse: false,
      suggestedAction: WAIT_FOR_REPLY_LABELS.has(result.classification)
        ? counterparty
          ? `Wait for ${counterparty} to reply`
          : 'Wait for a reply'
        : result.classification === 'Already Submitted Elsewhere'
          ? counterparty
            ? `Already submitted through another vendor. Keep ${counterparty} in mind for other roles`
            : 'Already submitted through another vendor'
          : result.suggestedAction,
    };
  }
  const subject = forwardMetadata.originalSubject ?? classifiedInput.subject;
  const senderEmail = forwardMetadata.originalSenderEmail ?? classifiedInput.fromEmail;

  // An outbound top message was written by the forwarder, so a company the
  // classifier derives from the forwarder's own address is not the employer.
  const forwarderCompany = forwardMetadata.topMessageFromForwarder
    ? inferEmployerFromSenderEmail(classifiedInput.fromEmail)
    : null;
  const classifiedCompany =
    forwarderCompany &&
    result.companyName?.trim().toLowerCase() === forwarderCompany.toLowerCase()
      ? null
      : result.companyName;

  const resolvedCompany = resolveEmployerCompany({
    companyName: classifiedCompany,
    originalCompany: forwardMetadata.originalCompany,
    subject,
    senderEmail,
  });

  const resolvedRole = resolveRoleTitle({
    positionTitle: result.positionTitle,
    subject,
  });

  if (!forwardMetadata.isForwarded) {
    return {
      ...result,
      companyName: resolvedCompany ?? result.companyName,
      positionTitle: resolvedRole ?? result.positionTitle,
    };
  }

  return {
    ...result,
    companyName: resolvedCompany ?? classifiedCompany,
    positionTitle: resolvedRole ?? result.positionTitle,
    // For an outbound top message the classifier read the forwarder's text,
    // so the counterparty from the quoted thread is the recruiter.
    recruiterName: forwardMetadata.topMessageFromForwarder
      ? forwardMetadata.originalSenderName ?? result.recruiterName ?? null
      : result.recruiterName ?? forwardMetadata.originalSenderName ?? null,
  };
}

export function persistForwardMetadata(
  db: Db,
  emailId: string,
  input: { subject: string; fromEmail: string; fromName?: string | null; textBody: string },
): ReturnType<typeof classificationInputFromEmail>['forwardMetadata'] {
  const classifiedInput = classificationInputFromEmail(input);
  const { forwardMetadata } = classifiedInput;
  if (!forwardMetadata.isForwarded) {
    return forwardMetadata;
  }

  db.update(inboundEmails)
    .set({
      isForwarded: true,
      originalSenderEmail: forwardMetadata.originalSenderEmail,
      originalSenderName: forwardMetadata.originalSenderName,
      originalSubject: forwardMetadata.originalSubject,
      originalRecipient: forwardMetadata.originalRecipient,
      originalSentAt: forwardMetadata.originalSentAt,
      originalCompany: forwardMetadata.originalCompany,
      updatedAt: nowIso(),
    })
    .where(eq(inboundEmails.id, emailId))
    .run();

  return forwardMetadata;
}

export async function classifyInboundEmailForUser(
  db: Db,
  userId: string,
  emailId: string,
  options: { force?: boolean } = {},
): Promise<InboundEmailClassificationFields | null> {
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

  if (row.processedAt && !options.force) {
    return classificationFieldsFromRow(row);
  }

  const textBody = extractTextBody(row.payload);
  const fromName = extractFromName(row.payload);
  persistForwardMetadata(db, row.id, {
    subject: row.subject,
    fromEmail: row.fromEmail,
    fromName,
    textBody,
  });
  const result = await classifyEmailContent({
    subject: row.subject,
    fromEmail: row.fromEmail,
    fromName,
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
  const { userEmail, contactEmails, otherUserEmails } = getUserEmailContext(db, userId);

  const candidates = db
    .select()
    .from(inboundEmails)
    .all()
    .filter((row) => inboundEmailBelongsToUser(row, userEmail, contactEmails, otherUserEmails))
    .filter((row) => !isInboundEmailDeleted(row))
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
