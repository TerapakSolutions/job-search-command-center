/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  callCostMicros,
  dailyBudgetMicros,
  geminiRates,
  getAiSpendLedger,
  pacificDay,
  registerAiSpendLedger,
} from './aiSpend.js';
import { generateLlmCompletion, isLlmConfigured, LlmQuotaError } from './llmClient.js';
import { createTestDb } from './testDb.js';

jest.mock('google-auth-library', () => ({
  GoogleAuth: jest.fn().mockImplementation(() => ({
    getAccessToken: jest.fn().mockResolvedValue('fake-access-token'),
  })),
}));

const saved = { ...process.env };
let fetchMock: jest.Mock;

type Usage = { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
function vertexOk(usage?: Usage, finishReason = 'STOP') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{ content: { role: 'model', parts: [{ text: 'hello' }] }, finishReason }],
      ...(usage ? { usageMetadata: usage } : {}),
    }),
  };
}

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
  fetchMock = jest.fn().mockResolvedValue(vertexOk({ promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 900 }));
  global.fetch = fetchMock as unknown as typeof fetch;
  registerAiSpendLedger(createTestDb());
});
afterEach(() => {
  process.env = { ...saved };
  jest.restoreAllMocks();
});

const call = () => generateLlmCompletion({ purpose: 'extract', systemPrompt: 's', userPrompt: 'u' });
const today = () => pacificDay(new Date());
const spent = () => getAiSpendLedger()!.spentMicros(today());

describe('the budget day is the Pacific calendar day', () => {
  it.each([
    ['2026-11-17T07:30:00Z', '2026-11-16'], // 23:30 PST the day before
    ['2026-11-17T08:30:00Z', '2026-11-17'], // 00:30 PST
    ['2026-07-01T06:59:00Z', '2026-06-30'], // 23:59 PDT
    ['2026-07-01T07:00:00Z', '2026-07-01'],
  ])('%s is %s', (instant, day) => {
    expect(pacificDay(new Date(instant))).toBe(day);
  });
});

describe('gemini prices (USD per 1M tokens = micro-dollars per token)', () => {
  it('uses the 2026 rate up to the last UTC second of 2026', () => {
    expect(geminiRates('gemini-3.8-flash', new Date('2026-12-31T23:59:59Z'))).toEqual({ input: 0.75, output: 3.75 });
  });

  it('uses the 2027 rate from 2027-01-01 UTC, even though it is still 2026-12-31 in Pacific', () => {
    expect(geminiRates('gemini-3.8-flash', new Date('2027-01-01T00:00:00Z'))).toEqual({ input: 1.5, output: 7.5 });
  });

  it('prices an unknown model at the highest known rate, whatever the date', () => {
    expect(geminiRates('gemini-unknown', new Date('2026-11-17T12:00:00Z'))).toEqual({ input: 1.5, output: 7.5 });
  });

  it('counts thoughts as output', () => {
    const at = new Date('2026-11-17T12:00:00Z');
    // 1000 in × 0.75 + (100 + 900) out × 3.75
    expect(callCostMicros({ promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 900 }, 'gemini-3.8-flash', at, 99)).toBe(4500);
  });

  it('a missing thoughts count is zero thoughts, not an estimate', () => {
    const at = new Date('2026-11-17T12:00:00Z');
    expect(callCostMicros({ promptTokenCount: 1000, candidatesTokenCount: 100 }, 'gemini-3.8-flash', at, 99)).toBe(1125);
  });

  it('rounds up, so a tiny call never costs zero', () => {
    const at = new Date('2026-11-17T12:00:00Z');
    expect(callCostMicros({ promptTokenCount: 1, candidatesTokenCount: 0 }, 'gemini-3.8-flash', at, 99)).toBe(1);
  });

  it('without usageMetadata, falls back to the given conservative estimate', () => {
    const at = new Date('2026-11-17T12:00:00Z');
    expect(callCostMicros(undefined, 'gemini-3.8-flash', at, 31337)).toBe(31337);
    expect(callCostMicros({}, 'gemini-3.8-flash', at, 31337)).toBe(31337);
  });
});

describe('AI_DAILY_BUDGET_USD', () => {
  it('defaults to $1.00', () => {
    expect(dailyBudgetMicros()).toBe(1_000_000);
  });

  it('honours a positive value', () => {
    process.env.AI_DAILY_BUDGET_USD = '2.5';
    expect(dailyBudgetMicros()).toBe(2_500_000);
  });

  it.each(['', '0', '-1', 'abc', 'Infinity', 'NaN'])('treats %p as the default, never unlimited', (value) => {
    process.env.AI_DAILY_BUDGET_USD = value;
    expect(dailyBudgetMicros()).toBe(1_000_000);
  });
});

describe('recording spend', () => {
  it('records the cost of a call, thoughts included', async () => {
    await expect(call()).resolves.toBe('hello');
    expect(spent()).toBe(4500); // the reservation was settled to the real cost
  });

  it('records a call that was cut off at the token cap (it is still billed)', async () => {
    fetchMock.mockResolvedValue(vertexOk({ promptTokenCount: 1000, candidatesTokenCount: 100, thoughtsTokenCount: 900 }, 'MAX_TOKENS'));
    await expect(call()).resolves.toBeNull();
    expect(spent()).toBe(4500);
  });

  it('records a conservative estimate, never zero, when Vertex sends no usageMetadata', async () => {
    fetchMock.mockResolvedValue(vertexOk(undefined));
    await call();
    expect(spent()).toBeGreaterThanOrEqual(2 * 4096 * 3.75);
  });

  it('refunds the reservation when the call fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    await expect(call()).rejects.toThrow();
    expect(spent()).toBe(0);
  });
});

describe('the cap', () => {
  it('refuses the call once the day is at the cap, as "AI paused", warning once per day', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.AI_DAILY_BUDGET_USD = '0.004';
    await call(); // 4500 micros, over the 4000 cap
    fetchMock.mockClear();

    const err = await call().catch((e) => e);
    expect(err).toBeInstanceOf(LlmQuotaError);
    expect(err.reason).toBe('insufficient_quota');
    await expect(call()).rejects.toBeInstanceOf(LlmQuotaError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('daily AI budget');
  });

  it('stays configured at the cap, so the brief says "paused" rather than "rules"', async () => {
    process.env.AI_DAILY_BUDGET_USD = '0.004';
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await call();
    expect(isLlmConfigured()).toBe(true);
  });

  it('lets only one of a burst of concurrent calls through near the cap', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.AI_DAILY_BUDGET_USD = '0.005';
    await call(); // 4500 of 5000 spent
    fetchMock.mockClear();

    const results = await Promise.allSettled([call(), call(), call(), call(), call()]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(4);
  });

  it('does not cap OpenAI', async () => {
    delete process.env.AI_PROVIDER;
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.AI_DAILY_BUDGET_USD = '0.000001';
    registerAiSpendLedger(null);
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'hi' } }] }) });
    await expect(call()).resolves.toBe('hi');
    await expect(call()).resolves.toBe('hi');
  });

  it('without a spend ledger, Gemini is not configured and is never called', async () => {
    registerAiSpendLedger(null);
    expect(isLlmConfigured()).toBe(false);
    await expect(call()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the running total survives a restart', () => {
  it('a new process on the same database file is still capped', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jscc-spend-'));
    process.env.DATABASE_PATH = path.join(tmp, 'test.sqlite');
    // One call at 2M input tokens = $1.50, over the $1.00 default cap.
    fetchMock.mockResolvedValue(vertexOk({ promptTokenCount: 2_000_000, candidatesTokenCount: 1 }));

    type Mods = { createDb: () => unknown; generate: typeof generateLlmCompletion };
    const boot = (): Mods => {
      let mods: Mods | undefined;
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { createDb } = require('../db/index') as { createDb: () => unknown };
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { generateLlmCompletion: generate } = require('./llmClient') as { generateLlmCompletion: typeof generateLlmCompletion };
        mods = { createDb, generate };
      });
      return mods!;
    };
    try {
      const first = boot();
      first.createDb();
      await expect(first.generate({ purpose: 'brief', systemPrompt: 's', userPrompt: 'u' })).resolves.toBe('hello');
      fetchMock.mockClear();

      const second = boot(); // fresh module state, same file
      second.createDb();
      const err = await second.generate({ purpose: 'brief', systemPrompt: 's', userPrompt: 'u' }).catch((e) => e);
      expect(err?.name).toBe('LlmQuotaError');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
