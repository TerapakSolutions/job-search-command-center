/** @jest-environment node */
import { buildReplyDraftPrompt, generateReplyDraft, type ReplyDraftInput } from './replyDraftGenerator.js';

const saved = { ...process.env };

const input: ReplyDraftInput = {
  userName: 'Steve Terapak',
  classification: 'Interview Request',
  recruiterName: 'Nick Gasparro',
  recipientName: 'Nick Gasparro',
  recipientEmail: 'nick@example.com',
  companyName: 'Afresh',
  positionTitle: 'Engineering Manager',
  subject: 'Afresh Interview Request',
  textBody: 'Hi Steve, would you be open to an interview next week?',
  lastMessageFromUser: false,
};

function openAiAnswers(status: number, body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status === 200,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env = { ...saved };
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  process.env = { ...saved };
  jest.restoreAllMocks();
});

describe('generateReplyDraft', () => {
  it('uses the template when no AI key is set', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_PROVIDER;
    const result = await generateReplyDraft(input);
    expect(result.source).toBe('template');
    expect(result.draft).toContain('Hi Nick,');
  });

  it('returns the AI draft when the AI answers', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    openAiAnswers(200, {
      choices: [{ message: { content: '  Hi Nick,\n\nThanks for reaching out.\n\nSteve  ' } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    });
    const result = await generateReplyDraft(input);
    expect(result).toEqual({ draft: 'Hi Nick,\n\nThanks for reaching out.\n\nSteve', source: 'llm' });
  });

  it('marks the draft paused, with the template, when the AI budget is spent', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    openAiAnswers(429, { error: { code: 'insufficient_quota' } });
    const result = await generateReplyDraft(input);
    expect(result.source).toBe('paused');
    expect(result.draft).toContain('Hi Nick,');
  });

  it('reports our own daily cap as paused with pausedReason daily_cap', async () => {
    jest.resetModules();
    jest.doMock('./llmClient.js', () => {
      const actual = jest.requireActual('./llmClient.js');
      return {
        ...actual,
        isLlmConfigured: () => true,
        generateLlmCompletion: async () => {
          throw new actual.LlmQuotaError('insufficient_quota', 'daily_cap');
        },
      };
    });
    const { generateReplyDraft: generate } = await import('./replyDraftGenerator.js');
    const result = await generate(input);
    expect(result).toMatchObject({ source: 'paused', pausedReason: 'daily_cap' });
    jest.dontMock('./llmClient.js');
  });

  it('uses the template on a rate limit, not paused', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    openAiAnswers(429, { error: { code: 'rate_limit_exceeded' } });
    const result = await generateReplyDraft(input);
    expect(result.source).toBe('template');
  });

  it('uses the template when the AI takes too long', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    global.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    const result = await generateReplyDraft(input, { timeoutMs: 20 });
    expect(result.source).toBe('template');
    expect(result.draft).toContain('Hi Nick,');
  });

  it('uses the template when the AI answers with nothing', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    openAiAnswers(200, { choices: [{ message: { content: '   ' } }], usage: {} });
    const result = await generateReplyDraft(input);
    expect(result.source).toBe('template');
  });

  it('falls back to the template when the AI call fails', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    openAiAnswers(500, { error: { message: 'boom' } });
    const result = await generateReplyDraft(input);
    expect(result.source).toBe('template');
  });
});

describe('buildReplyDraftPrompt', () => {
  it('tells the AI when the user wrote last, so it writes a follow-up', () => {
    const prompt = JSON.parse(buildReplyDraftPrompt({ ...input, lastMessageFromUser: true }));
    expect(prompt.lastMessageFromUser).toBe(true);
    expect(prompt.replyTo).toEqual({ name: 'Nick Gasparro', email: 'nick@example.com' });
  });

  it('truncates a long thread', () => {
    const prompt = JSON.parse(buildReplyDraftPrompt({ ...input, textBody: 'x'.repeat(10000) }));
    expect(prompt.email.length).toBeLessThan(6100);
    expect(prompt.email.endsWith('[truncated]')).toBe(true);
  });
});
