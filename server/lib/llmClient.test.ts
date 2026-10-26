/** @jest-environment node */
import { generateLlmCompletion, isLlmConfigured } from './llmClient.js';

describe('llmClient API key', () => {
  const original = process.env.OPENAI_API_KEY;
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'hello' } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = original;
    fetchMock.mockReset();
  });

  function sentAuthorization(): string {
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    return init.headers.Authorization;
  }

  // Prod, 2026-10-26: the secret was set as ‘sk-…’ (smart quotes from a
  // copy-paste), so every call threw "Cannot convert argument to a ByteString"
  // and the app silently fell back to rules.
  it.each([
    ['smart single quotes', '‘sk-test-123’'],
    ['smart double quotes', '“sk-test-123”'],
    ['straight quotes', "'sk-test-123'"],
    ['whitespace', '  sk-test-123\n'],
  ])('strips wrapping %s from the key', async (_label, value) => {
    process.env.OPENAI_API_KEY = value;

    await generateLlmCompletion({ systemPrompt: 's', userPrompt: 'u' });

    expect(sentAuthorization()).toBe('Bearer sk-test-123');
  });

  it('treats a key that is only quotes as not configured', () => {
    process.env.OPENAI_API_KEY = '‘’';
    expect(isLlmConfigured()).toBe(false);
  });
});
