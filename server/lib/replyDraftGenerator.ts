import { buildDraftReply } from './emailNextActions.js';
import { generateLlmCompletion, isLlmConfigured, LlmQuotaError } from './llmClient.js';

export interface ReplyDraftInput {
  userName: string | null;
  classification: string | null;
  recruiterName: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  companyName: string | null;
  positionTitle: string | null;
  subject: string;
  // Unwrapped from a forward, when it was one.
  textBody: string;
  // The newest message in the thread is the user's own, so this is a nudge.
  lastMessageFromUser: boolean;
}

export interface ReplyDraftResult {
  draft: string;
  // 'template' covers no key, an empty answer, an error, and a rate limit.
  source: 'llm' | 'template' | 'paused';
}

// Enough for a recruiter thread; keeps a long quoted history from running up cost.
const MAX_BODY_CHARS = 6000;

const SYSTEM_PROMPT = `You draft short email replies for a job seeker, written as the job seeker, in the first person.
Rules:
- Plain text only. No subject line, no markdown.
- Under 150 words. Warm, professional, direct.
- Only use facts in the email and the context given. Never invent dates, times, availability, salary figures, or details about the user's background.
- Where the user must supply a specific detail (for example, times they're free), write a bracketed placeholder such as [your availability].
- If lastMessageFromUser is true, the user wrote last and hasn't heard back: write a polite follow-up that checks in, not a reply to their own message.
- Greet the other person by first name when known. Sign off with the user's first name when known.`;

function templateDraft(input: ReplyDraftInput): string {
  return buildDraftReply({
    classification: input.classification,
    recruiterName: input.recruiterName ?? input.recipientName,
    companyName: input.companyName,
    positionTitle: input.positionTitle,
    subject: input.subject,
  });
}

export function buildReplyDraftPrompt(input: ReplyDraftInput): string {
  const body =
    input.textBody.length > MAX_BODY_CHARS
      ? `${input.textBody.slice(0, MAX_BODY_CHARS)}\n[truncated]`
      : input.textBody;
  return JSON.stringify(
    {
      userName: input.userName,
      replyTo: { name: input.recipientName ?? input.recruiterName, email: input.recipientEmail },
      company: input.companyName,
      position: input.positionTitle,
      classification: input.classification,
      lastMessageFromUser: input.lastMessageFromUser,
      subject: input.subject,
      email: body,
    },
    null,
    2,
  );
}

export async function generateReplyDraft(input: ReplyDraftInput): Promise<ReplyDraftResult> {
  const fallback: ReplyDraftResult = { draft: templateDraft(input), source: 'template' };
  if (!isLlmConfigured()) return fallback;

  try {
    const text = await generateLlmCompletion({
      purpose: 'brief',
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildReplyDraftPrompt(input),
    });
    const draft = text?.trim();
    return draft ? { draft, source: 'llm' } : fallback;
  } catch (err) {
    // Same split as the briefing: a spent budget is "paused"; anything else
    // falls back to the template without failing the request.
    if (err instanceof LlmQuotaError && err.reason === 'insufficient_quota') {
      return { ...fallback, source: 'paused' };
    }
    console.warn('[replyDraft] LLM draft failed, using template', err);
    return fallback;
  }
}
