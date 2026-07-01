export interface LlmCompletionOptions {
  systemPrompt: string;
  userPrompt: string;
  responseFormat?: 'text' | 'json_object';
}

export function isLlmConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export async function generateLlmCompletion(
  options: LlmCompletionOptions,
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const baseUrl = (
    process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
  ).replace(/\/$/, '');
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

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

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM request failed (${res.status}): ${body.slice(0, 200)}`);
  }

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
}): string {
  const parts: string[] = [
    `Your pipeline has ${data.pipelineStats.total} applications (${data.pipelineStats.active} active, ${data.pipelineStats.offers} offers).`,
  ];

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
