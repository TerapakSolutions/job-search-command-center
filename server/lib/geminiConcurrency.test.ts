/** @jest-environment node */
import { GoogleAuth } from 'google-auth-library';
import { estimateCallCostMicros, getAiSpendLedger, pacificDay, registerAiSpendLedger } from './aiSpend.js';
import { GEMINI_MAX_OUTPUT_TOKENS } from './geminiVertex.js';
import { generateDailyBriefingForUser } from './briefingGenerator.js';
import { generateLlmCompletion, LlmQuotaError } from './llmClient.js';
import { createTestDb, seedTestUser } from './testDb.js';

jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({
    getAccessToken: jest.fn().mockResolvedValue('fake-access-token'),
  })),
}));

const saved = { ...process.env };
// 1000 in × 0.75 + (100 + 900) out × 3.75 micro-dollars (2026 rate)
const TYPICAL_USAGE = { promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 900 };
const TYPICAL_COST = 4500;

let inFlight = 0;
let maxInFlight = 0;

/** A Vertex that takes a few ms to answer, so concurrent calls overlap. */
function slowVertex(answer: () => unknown) {
  return jest.fn().mockImplementation(async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return answer();
  });
}
const ok = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    candidates: [{ content: { parts: [{ text: 'hello' }] }, finishReason: 'STOP' }],
    usageMetadata: TYPICAL_USAGE,
  }),
});

beforeEach(() => {
  process.env = {
    ...saved,
    AI_PROVIDER: 'gemini',
    GOOGLE_CLOUD_PROJECT: 'test-project',
    VERTEX_LOCATION: 'global',
    GOOGLE_APPLICATION_CREDENTIALS_JSON: JSON.stringify({
      type: 'service_account',
      project_id: 'test-project',
      private_key: 'not-a-real-key',
      client_email: 'svc@test-project.iam.gserviceaccount.com',
    }),
  };
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_MODEL;
  delete process.env.AI_DAILY_BUDGET_USD;
  inFlight = 0;
  maxInFlight = 0;
  global.fetch = slowVertex(ok) as unknown as typeof fetch;
  registerAiSpendLedger(createTestDb());
});
afterEach(() => {
  process.env = { ...saved };
  jest.restoreAllMocks();
});

const call = () => generateLlmCompletion({ purpose: 'extract', systemPrompt: 's', userPrompt: 'u' });
/** The worst case one call('s', 'u') reserves before calling. */
const reservation = () => estimateCallCostMicros(2, GEMINI_MAX_OUTPUT_TOKENS, 'gemini-3.8-flash', new Date());
const spent = () => getAiSpendLedger()!.spentMicros(pacificDay(new Date()));

describe('Gemini concurrency limit', () => {
  it('runs a burst of 50 at most 4 at a time, refusing none, and records the real total', async () => {
    const results = await Promise.allSettled(Array.from({ length: 50 }, () => call()));

    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(0);
    expect(global.fetch).toHaveBeenCalledTimes(50);
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThan(1); // control: calls really do overlap
    expect(spent()).toBe(50 * TYPICAL_COST);
  });

  it('serves waiting calls first come, first served', async () => {
    const prompts = Array.from({ length: 12 }, (_, i) => `email-${i}`);
    await Promise.all(prompts.map((p) => generateLlmCompletion({ purpose: 'extract', systemPrompt: 's', userPrompt: p })));
    const sent = (global.fetch as jest.Mock).mock.calls.map(
      (c) => JSON.parse((c[1] as { body: string }).body).contents[0].parts[0].text as string,
    );
    expect(sent).toEqual(prompts);
  });

  it('gives every Vertex call a timeout, so a hung call cannot hold a slot forever', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    await call();
    const init = (global.fetch as jest.Mock).mock.calls[0][1] as { signal?: unknown };
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenCalledWith(30_000);
  });

  it('a timed-out call frees its slot and keeps its reservation counted (Google may have billed it)', async () => {
    global.fetch = slowVertex(() => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }) as unknown as typeof fetch;
    const timedOut = await Promise.allSettled(Array.from({ length: 8 }, () => call()));
    expect(timedOut.every((r) => r.status === 'rejected')).toBe(true);
    expect(spent()).toBe(8 * reservation());

    global.fetch = slowVertex(ok) as unknown as typeof fetch;
    await expect(call()).resolves.toBe('hello');
  });

  it('frees the slot when a call throws, so later calls still run', async () => {
    global.fetch = slowVertex(() => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const failed = await Promise.allSettled(Array.from({ length: 8 }, () => call()));
    expect(failed.every((r) => r.status === 'rejected')).toBe(true);

    global.fetch = slowVertex(ok) as unknown as typeof fetch;
    await expect(call()).resolves.toBe('hello');
    // A network error after sending may still be billed: those 8 stay counted.
    expect(spent()).toBe(8 * reservation() + TYPICAL_COST);
  });

  it('refunds when Vertex answers with an error status (an answered error is not billed)', async () => {
    global.fetch = slowVertex(() => ({ ok: false, status: 500, text: async () => 'boom' })) as unknown as typeof fetch;
    await Promise.allSettled(Array.from({ length: 8 }, () => call()));
    expect(spent()).toBe(0);
  });

  it('refunds when the token fetch fails (no Vertex call was made)', async () => {
    (GoogleAuth as unknown as jest.Mock).mockImplementationOnce(() => ({
      getAccessToken: jest.fn().mockRejectedValue(new Error('token endpoint down')),
    }));
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify({ type: 'service_account', private_key: 'k', client_email: 'a@test-project.iam.gserviceaccount.com', private_key_id: 'token-fails' });
    await expect(call()).rejects.toThrow('Gemini authentication failed');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(spent()).toBe(0);
  });

  it('gives up on a hung token fetch after 15s, frees the slot and refunds', async () => {
    (GoogleAuth as unknown as jest.Mock).mockImplementationOnce(() => ({
      getAccessToken: jest.fn().mockReturnValue(new Promise(() => {})), // never answers
    }));
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = JSON.stringify({ type: 'service_account', private_key: 'k', client_email: 'a@test-project.iam.gserviceaccount.com', private_key_id: 'token-hangs' });
    jest.useFakeTimers();
    try {
      const outcomes: string[] = [];
      const hung = Array.from({ length: 4 }, () =>
        call().then(
          () => outcomes.push('ok'),
          (e: Error) => outcomes.push(e.message),
        ),
      );
      await jest.advanceTimersByTimeAsync(14_999);
      expect(outcomes).toHaveLength(0);
      await jest.advanceTimersByTimeAsync(1);
      await Promise.all(hung);
      expect(outcomes.every((m) => m.startsWith('Gemini authentication failed'))).toBe(true);
    } finally {
      jest.useRealTimers();
    }
    expect(global.fetch).not.toHaveBeenCalled();
    expect(spent()).toBe(0);

    await expect(call()).resolves.toBe('hello'); // all 4 slots came back
  });

  it('frees the slot when Vertex answers with an error status', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = slowVertex(() => ({ ok: false, status: 429, text: async () => 'RESOURCE_EXHAUSTED' })) as unknown as typeof fetch;
    await Promise.allSettled(Array.from({ length: 8 }, () => call()));

    global.fetch = slowVertex(ok) as unknown as typeof fetch;
    await expect(call()).resolves.toBe('hello');
  });

  it('frees the slot when the call is refused at the cap', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const day = pacificDay(new Date());
    getAiSpendLedger()!.reserve(day, 1_000_000, 2_000_000); // $1.00 spent
    await Promise.allSettled(Array.from({ length: 8 }, () => call()));
    expect(global.fetch).not.toHaveBeenCalled();

    process.env.AI_DAILY_BUDGET_USD = '5';
    await expect(call()).resolves.toBe('hello');
  });
});

describe('the daily cap says it is the daily cap', () => {
  it('marks the quota error as the daily cap, still "insufficient_quota"', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    getAiSpendLedger()!.reserve(pacificDay(new Date()), 1_000_000, 2_000_000);
    const err = await call().catch((e) => e);
    expect(err).toBeInstanceOf(LlmQuotaError);
    expect(err.reason).toBe('insufficient_quota');
    expect(err.limit).toBe('daily_cap');
  });

  it('a provider budget error is not the daily cap', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 402, text: async () => 'RESOURCE_EXHAUSTED' }) as unknown as typeof fetch;
    const err = await call().catch((e) => e);
    expect(err.reason).toBe('insufficient_quota');
    expect(err.limit).toBe('provider');
  });

  it('records the daily cap on the brief, which stays "paused"', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    getAiSpendLedger()!.reserve(pacificDay(new Date()), 1_000_000, 2_000_000);
    const db = createTestDb();
    const userId = seedTestUser(db);
    const briefing = await generateDailyBriefingForUser(db, userId, new Date(), { force: true });
    expect(briefing?.data.summarySource).toBe('paused');
    expect(briefing?.data.pausedReason).toBe('daily_cap');
  });

  it('a provider budget error leaves no daily-cap reason on the brief', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 402, text: async () => 'RESOURCE_EXHAUSTED' }) as unknown as typeof fetch;
    const db = createTestDb();
    const userId = seedTestUser(db);
    const briefing = await generateDailyBriefingForUser(db, userId, new Date(), { force: true });
    expect(briefing?.data.summarySource).toBe('paused');
    expect(briefing?.data.pausedReason).toBeUndefined();
  });
});
