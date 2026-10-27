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
 * OpenAI said no because the monthly budget is spent (insufficient_quota) or
 * we're sending too fast (rate_limited). Callers fall back to rules and say
 * the AI is paused rather than treating it as a failure.
 */
export class LlmQuotaError extends Error {
  constructor(readonly reason: 'insufficient_quota' | 'rate_limited') {
    super(`AI paused: ${reason}`);
    this.name = 'LlmQuotaError';
  }
}

// One warning per incident: set on the first 429, cleared by the next success.
let quotaIncidentOpen = false;

export function isLlmConfigured(): boolean {
  return Boolean(readApiKey());
}

export async function generateLlmCompletion(
  options: LlmCompletionOptions,
): Promise<string | null> {
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
