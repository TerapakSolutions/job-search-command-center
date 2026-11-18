import {
  callCostMicros,
  dailyBudgetMicros,
  estimateCallCostMicros,
  getAiSpendLedger,
  pacificDay,
  type GeminiUsage,
} from './aiSpend.js';
import {
  GEMINI_MAX_OUTPUT_TOKENS,
  type GeminiResponse,
  buildGeminiRequestBody,
  geminiQuotaReason,
  geminiResponseText,
  getVertexAccessToken,
  readGeminiConfig,
  vertexGenerateContentUrl,
} from './geminiVertex.js';

/**
 * AI_PROVIDER=gemini sends every call to Gemini on Vertex AI. Anything else,
 * including unset, stays on OpenAI, which is the one-setting rollback.
 */
function aiProvider(): 'openai' | 'gemini' {
  return process.env.AI_PROVIDER?.trim().toLowerCase() === 'gemini' ? 'gemini' : 'openai';
}

/** Which feature is calling, so each can use its own model. */
export type LlmPurpose = 'extract' | 'brief';

const MODEL_ENV: Record<LlmPurpose, string> = {
  extract: 'LLM_MODEL_EXTRACT',
  brief: 'LLM_MODEL_BRIEF',
};

export interface LlmCompletionOptions {
  purpose: LlmPurpose;
  systemPrompt: string;
  userPrompt: string;
  responseFormat?: 'text' | 'json_object';
}

// Copy-pasting a key through Notes/Slack can wrap it in smart quotes
// (‘sk-…’), which makes every request throw before it is sent.
function readApiKey(): string {
  return (process.env.OPENAI_API_KEY ?? '')
    .trim()
    .replace(/^['"\u2018\u2019\u201c\u201d]+|['"\u2018\u2019\u201c\u201d]+$/g, '')
    .trim();
}

/**
 * The provider said no because the monthly budget is spent (insufficient_quota) or
 * we're sending too fast (rate_limited). Callers fall back to rules and say
 * the AI is paused rather than treating it as a failure.
 */
export class LlmQuotaError extends Error {
  constructor(
    readonly reason: 'insufficient_quota' | 'rate_limited',
    // 'daily_cap' = our own AI_DAILY_BUDGET_USD (resets tomorrow, Pacific);
    // 'provider' = the provider refused (OpenAI's monthly budget, Vertex 402).
    readonly limit: 'provider' | 'daily_cap' = 'provider',
  ) {
    super(`AI paused: ${reason}`);
    this.name = 'LlmQuotaError';
  }
}

// One warning per incident: set on the first 429, cleared by the next success.
let quotaIncidentOpen = false;

export function isLlmConfigured(): boolean {
  if (aiProvider() === 'gemini') {
    // No spend ledger means no cap, so Gemini stays off rather than uncapped.
    return readGeminiConfig() !== null && getAiSpendLedger() !== null;
  }
  return Boolean(readApiKey());
}

function quotaExceeded(reason: LlmQuotaError['reason'], body: string): LlmQuotaError {
  if (!quotaIncidentOpen) {
    quotaIncidentOpen = true;
    console.warn(`[llm] AI paused: budget or rate limit reached: ${body.slice(0, 200)}`);
  }
  return new LlmQuotaError(reason);
}

// One warning per Pacific day (per process) when the daily budget trips.
let budgetWarnedDay: string | null = null;

/**
 * At most this many Gemini calls in flight; the rest wait in FIFO order, none
 * dropped. Each in-flight call holds a worst-case reservation against the
 * daily cap, so an unbounded burst (inbound email is processed one
 * setImmediate per email) would fill the cap with reservations and refuse
 * calls on a cheap day. It also keeps bursts under Vertex's rate limit.
 */
const GEMINI_MAX_IN_FLIGHT = 4;
const GEMINI_TIMEOUT_MS = 30_000;
let geminiInFlight = 0;
const geminiWaiting: Array<() => void> = [];

async function acquireGeminiSlot(): Promise<void> {
  if (geminiInFlight < GEMINI_MAX_IN_FLIGHT) {
    geminiInFlight++;
    return;
  }
  // The releasing call hands its slot straight to the next waiter.
  await new Promise<void>((resolve) => geminiWaiting.push(resolve));
}

function releaseGeminiSlot(): void {
  const next = geminiWaiting.shift();
  if (next) {
    next();
  } else {
    geminiInFlight--;
  }
}

async function generateGeminiCompletion(
  options: LlmCompletionOptions,
): Promise<string | null> {
  const config = readGeminiConfig();
  const ledger = getAiSpendLedger();
  if (!config || !ledger) {
    return null;
  }

  await acquireGeminiSlot();
  try {
    return await reserveAndCallGemini(options, config, ledger);
  } finally {
    releaseGeminiSlot();
  }
}

async function reserveAndCallGemini(
  options: LlmCompletionOptions,
  config: NonNullable<ReturnType<typeof readGeminiConfig>>,
  ledger: NonNullable<ReturnType<typeof getAiSpendLedger>>,
): Promise<string | null> {
  // Reserve the worst case before calling (atomic, so a burst cannot all slip
  // under the cap), then settle to the real cost once Vertex says what it was.
  const now = new Date();
  const day = pacificDay(now);
  const budget = dailyBudgetMicros();
  const reserved = estimateCallCostMicros(
    options.systemPrompt.length + options.userPrompt.length,
    GEMINI_MAX_OUTPUT_TOKENS,
    config.model,
    now,
  );
  if (!ledger.reserve(day, reserved, budget)) {
    if (budgetWarnedDay !== day) {
      budgetWarnedDay = day;
      const usd = (budget / 1_000_000).toFixed(2);
      console.warn(`[llm] AI paused: daily AI budget of USD ${usd} reached for ${day} (Pacific)`);
    }
    throw new LlmQuotaError('insufficient_quota', 'daily_cap');
  }

  // Refund ONLY when we know Google did not bill: no request was sent (token
  // fetch failed) or Vertex answered with an error status. A timeout, abort or
  // network error after sending may still be billed, so the worst-case
  // reservation stays counted.
  let phase: 'not_sent' | 'sent' | 'answered_error' | 'billed' = 'not_sent';
  try {
    return await callGemini(options, config, {
      sending: () => {
        phase = 'sent';
      },
      answeredError: () => {
        phase = 'answered_error';
      },
      billed: (usage) => {
        phase = 'billed';
        const actual = callCostMicros(usage, config.model, now, reserved);
        ledger.settle(day, actual - reserved, {
          calls: 1,
          inputTokens: usage?.promptTokenCount ?? 0,
          outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
        });
      },
    });
  } finally {
    if (phase === 'not_sent' || phase === 'answered_error') {
      ledger.settle(day, -reserved, { calls: 0, inputTokens: 0, outputTokens: 0 });
    }
  }
}

async function callGemini(
  options: LlmCompletionOptions,
  config: NonNullable<ReturnType<typeof readGeminiConfig>>,
  report: {
    sending: () => void;
    answeredError: () => void;
    billed: (usage: GeminiUsage | undefined) => void;
  },
): Promise<string | null> {
  const token = await getVertexAccessToken(config);
  report.sending();
  const res = await fetch(vertexGenerateContentUrl(config), {
    method: 'POST',
    // A hung call would hold one of the 4 slots; the SEO engine measured
    // Vertex hangs in prod and bounds the same call at 30s.
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(
      buildGeminiRequestBody({
        systemPrompt: options.systemPrompt,
        userPrompt: options.userPrompt,
        json: options.responseFormat === 'json_object',
      }),
    ),
  });

  if (!res.ok) {
    report.answeredError();
    const body = await res.text();
    const reason = geminiQuotaReason(res.status, body);
    if (reason) {
      throw quotaExceeded(reason, `(${res.status}) ${body}`);
    }
    throw new Error(`LLM request failed (${res.status}): ${body.slice(0, 200)}`);
  }

  // A 2xx is billed even if the body is unreadable or cut off at MAX_TOKENS;
  // an unreadable body keeps the worst-case reservation.
  let json: GeminiResponse & { usageMetadata?: GeminiUsage };
  try {
    json = (await res.json()) as GeminiResponse & { usageMetadata?: GeminiUsage };
  } catch (err) {
    report.billed(undefined);
    throw err;
  }
  report.billed(json.usageMetadata);
  quotaIncidentOpen = false;
  return geminiResponseText(json);
}

export async function generateLlmCompletion(
  options: LlmCompletionOptions,
): Promise<string | null> {
  if (aiProvider() === 'gemini') {
    return generateGeminiCompletion(options);
  }

  const apiKey = readApiKey();
  if (!apiKey) {
    return null;
  }

  const baseUrl = (
    process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
  ).replace(/\/$/, '');
  const model =
    process.env[MODEL_ENV[options.purpose]]?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    'gpt-4o-mini';

  const body: Record<string, unknown> = {
    model,
    temperature: 0.4,
    max_tokens: 800,
    messages: [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: options.userPrompt },
    ],
  };

  if (options.responseFormat === 'json_object') {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    const body = await res.text();
    if (!quotaIncidentOpen) {
      quotaIncidentOpen = true;
      console.warn(`[llm] AI paused: budget or rate limit reached (429): ${body.slice(0, 200)}`);
    }
    throw new LlmQuotaError(body.includes('insufficient_quota') ? 'insufficient_quota' : 'rate_limited');
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM request failed (${res.status}): ${body.slice(0, 200)}`);
  }

  quotaIncidentOpen = false;

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content?.trim();
  return content ?? null;
}

export function buildFallbackSummary(data: {
  pipelineStats: { total: number; active: number; offers: number };
  newRecruiterEmails: unknown[];
  applicationsSubmitted: unknown[];
  upcomingInterviews: unknown[];
  followUpNeeded: unknown[];
  recommendations: string[];
  goalProgress?: {
    applicationsToday: number;
    dailyGoal: number;
    currentStreak: number;
    goalMessages: string[];
    goalsSetByUser?: boolean;
  };
}): string {
  const parts: string[] = [];

  if (data.goalProgress) {
    const goal =
      data.goalProgress.goalsSetByUser === false
        ? ''
        : ` Your goal is ${data.goalProgress.dailyGoal}.`;
    parts.push(
      `You applied to ${data.goalProgress.applicationsToday} job${data.goalProgress.applicationsToday === 1 ? '' : 's'} today.${goal}`,
    );
    if (data.goalProgress.currentStreak >= 3) {
      parts.push(
        `You're on a ${data.goalProgress.currentStreak}-day application streak.`,
      );
    }
    if (data.goalProgress.goalMessages[1]) {
      parts.push(data.goalProgress.goalMessages[1]);
    }
  }

  parts.push(
    `Your pipeline has ${data.pipelineStats.total} applications (${data.pipelineStats.active} active, ${data.pipelineStats.offers} offers).`,
  );

  if (data.newRecruiterEmails.length > 0) {
    parts.push(
      `${data.newRecruiterEmails.length} new recruiter email(s) since your last briefing.`,
    );
  }

  if (data.applicationsSubmitted.length > 0) {
    parts.push(
      `You submitted ${data.applicationsSubmitted.length} application(s) in the reporting window.`,
    );
  }

  if (data.upcomingInterviews.length > 0) {
    parts.push(
      `${data.upcomingInterviews.length} interview(s) coming up in the next two weeks.`,
    );
  }

  if (data.followUpNeeded.length > 0) {
    parts.push(`${data.followUpNeeded.length} application(s) need follow-up.`);
  }

  if (data.recommendations.length > 0) {
    parts.push(`Top action: ${data.recommendations[0]}`);
  }

  return parts.join(' ');
}
