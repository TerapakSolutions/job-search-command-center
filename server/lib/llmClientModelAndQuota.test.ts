/** @jest-environment node */
import { generateLlmCompletion, LlmQuotaError } from './llmClient.js';

const saved = { ...process.env };
let fetchMock: jest.Mock;

function ok(content = 'hello') {
  return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
}
function quota(code = 'insufficient_quota') {
  return {
    ok: false,
    status: 429,
    text: async () => JSON.stringify({ error: { code, message: 'You exceeded your current quota' } }),
  };
}

beforeEach(() => {
  process.env = { ...saved, OPENAI_API_KEY: 'sk-test' };
  delete process.env.OPENAI_MODEL;
  delete process.env.LLM_MODEL_EXTRACT;
  delete process.env.LLM_MODEL_BRIEF;
  fetchMock = jest.fn().mockResolvedValue(ok());
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  process.env = { ...saved };
  jest.restoreAllMocks();
});

function sentModel(call = 0): string {
  return JSON.parse((fetchMock.mock.calls[call][1] as { body: string }).body).model;
}

describe('model per call site', () => {
  it('defaults every call site to gpt-4o-mini', async () => {
    await generateLlmCompletion({ purpose: 'extract', systemPrompt: 's', userPrompt: 'u' });
    await generateLlmCompletion({ purpose: 'brief', systemPrompt: 's', userPrompt: 'u' });
    expect([sentModel(0), sentModel(1)]).toEqual(['gpt-4o-mini', 'gpt-4o-mini']);
  });

  it('lets extraction and the brief use different models', async () => {
    process.env.LLM_MODEL_EXTRACT = 'model-extract';
    process.env.LLM_MODEL_BRIEF = 'model-brief';
    await generateLlmCompletion({ purpose: 'extract', systemPrompt: 's', userPrompt: 'u' });
    await generateLlmCompletion({ purpose: 'brief', systemPrompt: 's', userPrompt: 'u' });
    expect([sentModel(0), sentModel(1)]).toEqual(['model-extract', 'model-brief']);
  });

  it('still honours the existing OPENAI_MODEL when no per-site model is set', async () => {
    process.env.OPENAI_MODEL = 'model-shared';
    await generateLlmCompletion({ purpose: 'brief', systemPrompt: 's', userPrompt: 'u' });
    expect(sentModel()).toBe('model-shared');
  });
});

describe('AI budget or rate limit reached', () => {
  it('throws a quota error, warning once per incident rather than per request', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue(quota());
    const call = () => generateLlmCompletion({ purpose: 'extract', systemPrompt: 's', userPrompt: 'u' });

    await expect(call()).rejects.toBeInstanceOf(LlmQuotaError);
    await expect(call()).rejects.toBeInstanceOf(LlmQuotaError);
    expect(warn).toHaveBeenCalledTimes(1);

    // A success ends the incident, so the next one warns again.
    fetchMock.mockResolvedValueOnce(ok());
    await call();
    fetchMock.mockResolvedValue(quota('rate_limit_exceeded'));
    await expect(call()).rejects.toBeInstanceOf(LlmQuotaError);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('treats other failures as ordinary errors', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const err = await generateLlmCompletion({ purpose: 'extract', systemPrompt: 's', userPrompt: 'u' }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LlmQuotaError);
  });
});
