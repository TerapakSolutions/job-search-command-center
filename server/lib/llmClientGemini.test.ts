/** @jest-environment node */
import { GoogleAuth } from 'google-auth-library';
import { generateLlmCompletion, isLlmConfigured, LlmQuotaError } from './llmClient.js';

// The real library would POST to Google's token endpoint through the mocked
// global fetch, so calls[0] would be the OAuth request, not Vertex. Every test
// below asserts the Vertex call carries THIS token, which fails if the real
// auth path ever runs.
jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({
    getAccessToken: jest.fn().mockResolvedValue('fake-access-token'),
  })),
}));
const GoogleAuthMock = GoogleAuth as unknown as jest.Mock;

// Anything that reaches a log or an error message would show this string.
const SECRET = 'FAKE-PRIVATE-KEY-MARKER';
const fakeServiceAccount = JSON.stringify({
  type: 'service_account',
  project_id: 'test-project',
  private_key_id: 'test-key-id',
  private_key: SECRET,
  client_email: 'svc@test-project.iam.gserviceaccount.com',
});

const saved = { ...process.env };
let fetchMock: jest.Mock;

function vertexOk(
  parts: Array<{ text?: string; thought?: boolean }> = [{ text: 'hello' }],
  finishReason = 'STOP',
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { role: 'model', parts }, finishReason }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: 30, totalTokenCount: 42 },
      modelVersion: 'gemini-3.8-flash',
    }),
  };
}

// Captured shape of a Google API error body (google.rpc.Status).
function vertexError(status: number, statusWord: string, message: string, reason?: string) {
  return {
    ok: false,
    status,
    text: async () =>
      JSON.stringify({
        error: {
          code: status,
          message,
          status: statusWord,
          ...(reason ? { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason }] } : {}),
        },
      }),
  };
}

beforeEach(() => {
  process.env = {
    ...saved,
    AI_PROVIDER: 'gemini',
    GOOGLE_CLOUD_PROJECT: 'test-project',
    VERTEX_LOCATION: 'global',
    GOOGLE_APPLICATION_CREDENTIALS_JSON: fakeServiceAccount,
  };
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  delete process.env.LLM_MODEL_EXTRACT;
  delete process.env.LLM_MODEL_BRIEF;
  delete process.env.GEMINI_MODEL;
  fetchMock = jest.fn().mockResolvedValue(vertexOk());
  global.fetch = fetchMock as unknown as typeof fetch;
  GoogleAuthMock.mockClear();
});
afterEach(() => {
  process.env = { ...saved };
  jest.restoreAllMocks();
});

const call = (responseFormat?: 'text' | 'json_object') =>
  generateLlmCompletion({ purpose: 'extract', systemPrompt: 'sys', userPrompt: 'usr', responseFormat });

function sentUrl(i = 0): string {
  return fetchMock.mock.calls[i][0] as string;
}
function sentInit(i = 0): { headers: Record<string, string>; body: string } {
  return fetchMock.mock.calls[i][1] as { headers: Record<string, string>; body: string };
}
interface SentBody {
  generationConfig: Record<string, unknown>;
  [key: string]: unknown;
}
function sentBody(i = 0): SentBody {
  return JSON.parse(sentInit(i).body) as SentBody;
}

describe('provider switch', () => {
  it('stays on OpenAI when AI_PROVIDER is unset, even with Gemini fully configured', async () => {
    delete process.env.AI_PROVIDER;
    process.env.OPENAI_API_KEY = 'sk-test';
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'hi' } }] }) });

    await call();

    expect(sentUrl()).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('stays on OpenAI for an unrecognised AI_PROVIDER value', async () => {
    process.env.AI_PROVIDER = 'gemni';
    process.env.OPENAI_API_KEY = 'sk-test';
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'hi' } }] }) });

    await call();

    expect(sentUrl()).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('calls Vertex generateContent on the global host with a Google access token', async () => {
    // A credential value no earlier test used, so the auth client is built here.
    const credentials = fakeServiceAccount.replace('test-key-id', 'fresh-key-id');
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = credentials;

    await expect(call()).resolves.toBe('hello');

    expect(sentUrl()).toBe(
      'https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/publishers/google/models/gemini-3.8-flash:generateContent',
    );
    expect(sentInit().headers.Authorization).toBe('Bearer fake-access-token');
    expect(GoogleAuthMock).toHaveBeenCalledWith({
      credentials: JSON.parse(credentials),
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  });

  it('uses a regional host for a regional location', async () => {
    process.env.VERTEX_LOCATION = ' US-Central1 ';
    await call();
    expect(sentUrl()).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1/publishers/google/models/gemini-3.8-flash:generateContent',
    );
  });

  it('defaults the location to global, where gemini-3.8-flash is served', async () => {
    delete process.env.VERTEX_LOCATION;
    await call();
    expect(sentUrl()).toContain('https://aiplatform.googleapis.com/v1/projects/test-project/locations/global/');
  });

  it('uses GEMINI_MODEL, never the OpenAI model names', async () => {
    process.env.LLM_MODEL_EXTRACT = 'gpt-something';
    process.env.OPENAI_MODEL = 'gpt-other';
    await call();
    expect(sentUrl()).toContain('/models/gemini-3.8-flash:generateContent');

    process.env.GEMINI_MODEL = 'gemini-test-model';
    await call();
    expect(sentUrl(1)).toContain('/models/gemini-test-model:generateContent');
  });
});

describe('request body', () => {
  it('maps the prompts, caps output, thinks LOW, and sends no temperature', async () => {
    await call();
    const body = sentBody();

    expect(body).toEqual({
      systemInstruction: { parts: [{ text: 'sys' }] },
      contents: [{ role: 'user', parts: [{ text: 'usr' }] }],
      generationConfig: {
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingLevel: 'LOW' },
      },
    });
    expect(sentInit().body).not.toMatch(/temperature/i);
  });

  it('asks for JSON only in JSON mode', async () => {
    await call('json_object');
    await call('text');
    expect(sentBody(0).generationConfig.responseMimeType).toBe('application/json');
    expect(sentBody(1).generationConfig).not.toHaveProperty('responseMimeType');
  });
});

describe('response', () => {
  it('joins the answer parts and skips thought parts', async () => {
    fetchMock.mockResolvedValue(
      vertexOk([{ text: 'thinking...', thought: true }, { text: ' {"a":' }, { text: '1} ' }]),
    );
    await expect(call()).resolves.toBe('{"a":1}');
  });

  it('returns nothing when the output was cut off at the token cap', async () => {
    fetchMock.mockResolvedValue(vertexOk([{ text: '{"classification": "Interv' }], 'MAX_TOKENS'));
    await expect(call()).resolves.toBeNull();
  });

  it('returns nothing when there is no candidate', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ promptFeedback: { blockReason: 'OTHER' } }) });
    await expect(call()).resolves.toBeNull();
  });
});

describe('AI budget or rate limit reached on Vertex', () => {
  it('429 RESOURCE_EXHAUSTED means retry shortly, not paused', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue(vertexError(429, 'RESOURCE_EXHAUSTED', 'Resource exhausted. Please try again later.'));
    const err = await call().catch((e) => e);
    expect(err).toBeInstanceOf(LlmQuotaError);
    expect(err.reason).toBe('rate_limited');
  });

  it('429 quota-exceeded is still retry shortly', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue(
      vertexError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded for aiplatform.googleapis.com/generate_content_requests_per_minute_per_project_per_base_model'),
    );
    const err = await call().catch((e) => e);
    expect(err.reason).toBe('rate_limited');
  });

  it('402 (prepaid credit depleted) means AI paused', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue(vertexError(402, 'RESOURCE_EXHAUSTED', 'Your prepayment credits are depleted.'));
    const err = await call().catch((e) => e);
    expect(err).toBeInstanceOf(LlmQuotaError);
    expect(err.reason).toBe('insufficient_quota');
  });

  it('403 BILLING_DISABLED means AI paused', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue(
      vertexError(403, 'PERMISSION_DENIED', 'This API method requires billing to be enabled.', 'BILLING_DISABLED'),
    );
    const err = await call().catch((e) => e);
    expect(err).toBeInstanceOf(LlmQuotaError);
    expect(err.reason).toBe('insufficient_quota');
  });

  it('warns once per incident; a success ends the incident', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await call(); // earlier tests leave an incident open; a success closes it
    fetchMock.mockResolvedValue(vertexError(402, 'RESOURCE_EXHAUSTED', 'Your prepayment credits are depleted.'));

    await expect(call()).rejects.toBeInstanceOf(LlmQuotaError);
    await expect(call()).rejects.toBeInstanceOf(LlmQuotaError);
    expect(warn).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(vertexOk());
    await call();
    fetchMock.mockResolvedValue(vertexError(429, 'RESOURCE_EXHAUSTED', 'Resource exhausted.'));
    await expect(call()).rejects.toBeInstanceOf(LlmQuotaError);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it.each([
    [403, 'PERMISSION_DENIED', 'Permission denied on resource project test-project.'],
    [404, 'NOT_FOUND', 'Publisher model was not found.'],
    [500, 'INTERNAL', 'Internal error.'],
  ])('treats %i as an ordinary error', async (status, word, message) => {
    fetchMock.mockResolvedValue(vertexError(status, word, message));
    const err = await call().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LlmQuotaError);
  });
});

describe('missing or invalid Gemini config', () => {
  it.each(['GOOGLE_CLOUD_PROJECT', 'GOOGLE_APPLICATION_CREDENTIALS_JSON'])(
    'without %s: not configured, no request, no crash',
    async (name) => {
      process.env.OPENAI_API_KEY = 'sk-test'; // must not silently switch provider
      delete process.env[name];
      expect(isLlmConfigured()).toBe(false);
      await expect(call()).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('is configured when everything is set', () => {
    expect(isLlmConfigured()).toBe(true);
  });

  it('invalid credential JSON: not configured, never throws, never logs the value', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => {}),
    );
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = `{"private_key": "${SECRET}`;

    expect(() => isLlmConfigured()).not.toThrow();
    expect(isLlmConfigured()).toBe(false);
    await expect(call()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(SECRET);
    }
  });

  it('a failed token fetch is an ordinary error that does not carry the credential', async () => {
    GoogleAuthMock.mockImplementationOnce(() => ({
      getAccessToken: jest.fn().mockRejectedValue(new Error(`bad key ${SECRET}`)),
    }));
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = fakeServiceAccount.replace('test-key-id', 'other-key-id');

    const err = await call().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(LlmQuotaError);
    expect(String(err.message) + String(err.stack)).not.toContain(SECRET);
    expect(err.cause).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
