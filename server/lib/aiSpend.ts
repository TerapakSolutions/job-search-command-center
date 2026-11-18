import type BetterSqlite3 from 'better-sqlite3';

/**
 * Daily AI spend cap for the Gemini path (AI_DAILY_BUDGET_USD, default $1.00).
 *
 * Gemini bills the same Google Cloud project as the SEO engine, so a runaway
 * loop here could spend the shared credit and stop the engine's nightly.
 * OpenAI has its own monthly budget and is not capped here.
 *
 * The running total lives in SQLite (`ai_spend_daily`, one row per Pacific
 * day), so a restart or crash loop cannot reset it. Money is stored as integer
 * micro-dollars: a price in USD per 1M tokens is exactly micro-dollars per
 * token.
 *
 * Each call RESERVES its worst-case cost in one atomic statement that only
 * succeeds while the day is under the cap, then settles to the real cost from
 * usageMetadata. Inbound emails are classified concurrently, so a plain
 * check-then-record would let a whole burst through at the cap.
 */

const DEFAULT_BUDGET_USD = 1;

/** USD per 1M tokens; `from` is a UTC instant. Newest period last. */
const GEMINI_PRICES: Record<string, Array<{ from: string; input: number; output: number }>> = {
  'gemini-3.8-flash': [
    { from: '1970-01-01T00:00:00Z', input: 0.75, output: 3.75 },
    { from: '2027-01-01T00:00:00Z', input: 1.5, output: 7.5 },
  ],
};

/** Unknown model: the highest rate anywhere in the table, whatever the date. */
const HIGHEST_RATE = {
  input: Math.max(...Object.values(GEMINI_PRICES).flat().map((p) => p.input)),
  output: Math.max(...Object.values(GEMINI_PRICES).flat().map((p) => p.output)),
};

export function geminiRates(model: string, at: Date): { input: number; output: number } {
  const periods = GEMINI_PRICES[model];
  if (!periods) return { ...HIGHEST_RATE };
  let rate = periods[0];
  for (const p of periods) {
    if (at.getTime() >= Date.parse(p.from)) rate = p;
  }
  return { input: rate.input, output: rate.output };
}

export interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
}

/**
 * Cost of one call in micro-dollars, rounded up. Thoughts are billed as
 * output. With no token counts at all, `estimateMicros` is used, never zero.
 */
export function callCostMicros(
  usage: GeminiUsage | undefined,
  model: string,
  at: Date,
  estimateMicros: number,
): number {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
  const input = num(usage?.promptTokenCount);
  const candidates = num(usage?.candidatesTokenCount);
  const thoughts = num(usage?.thoughtsTokenCount);
  if (input === undefined && candidates === undefined && thoughts === undefined) {
    return estimateMicros;
  }
  const rate = geminiRates(model, at);
  return Math.ceil((input ?? 0) * rate.input + ((candidates ?? 0) + (thoughts ?? 0)) * rate.output);
}

/** Worst case for a call: prompt at ~2 chars/token, and twice the output cap (thinking overshoot is reported). */
export function estimateCallCostMicros(
  promptChars: number,
  maxOutputTokens: number,
  model: string,
  at: Date,
): number {
  const rate = geminiRates(model, at);
  return Math.ceil(Math.ceil(promptChars / 2) * rate.input + 2 * maxOutputTokens * rate.output);
}

/** AI_DAILY_BUDGET_USD in micro-dollars. Unset, zero, negative or not a number → $1.00, never unlimited. */
export function dailyBudgetMicros(): number {
  const raw = process.env.AI_DAILY_BUDGET_USD?.trim();
  const usd = raw ? Number(raw) : NaN;
  const budget = Number.isFinite(usd) && usd > 0 ? usd : DEFAULT_BUDGET_USD;
  return Math.round(budget * 1_000_000);
}

const pacificDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** YYYY-MM-DD in America/Los_Angeles: the app's day (briefings run on Pacific time). */
export function pacificDay(at: Date): string {
  return pacificDate.format(at);
}

export interface AiSpendLedger {
  /** Atomically add `micros` to the day if it is still under `capMicros`. False = at the cap. */
  reserve(day: string, micros: number, capMicros: number): boolean;
  /** Adjust the day by `deltaMicros` (negative to refund) and add the call's tokens. */
  settle(day: string, deltaMicros: number, usage: { calls: number; inputTokens: number; outputTokens: number }): void;
  spentMicros(day: string): number;
}

function sqliteLedger(sqlite: BetterSqlite3.Database): AiSpendLedger {
  const reserveStmt = sqlite.prepare(
    `INSERT INTO ai_spend_daily (day, cost_micros, calls, input_tokens, output_tokens, updated_at)
     VALUES (@day, @micros, 0, 0, 0, @now)
     ON CONFLICT(day) DO UPDATE SET
       cost_micros = ai_spend_daily.cost_micros + excluded.cost_micros,
       updated_at = excluded.updated_at
     WHERE ai_spend_daily.cost_micros < @cap`,
  );
  const settleStmt = sqlite.prepare(
    `UPDATE ai_spend_daily SET
       cost_micros = MAX(0, cost_micros + @delta),
       calls = calls + @calls,
       input_tokens = input_tokens + @inputTokens,
       output_tokens = output_tokens + @outputTokens,
       updated_at = @now
     WHERE day = @day`,
  );
  const readStmt = sqlite.prepare(`SELECT cost_micros AS micros FROM ai_spend_daily WHERE day = ?`);

  return {
    reserve(day, micros, capMicros) {
      if (capMicros <= 0) return false;
      const res = reserveStmt.run({ day, micros, cap: capMicros, now: new Date().toISOString() });
      return res.changes === 1;
    },
    settle(day, deltaMicros, usage) {
      settleStmt.run({ day, delta: deltaMicros, ...usage, now: new Date().toISOString() });
    },
    spentMicros(day) {
      const row = readStmt.get(day) as { micros: number } | undefined;
      return row?.micros ?? 0;
    },
  };
}

let ledger: AiSpendLedger | null = null;

/** Called by createDb(). Without a ledger the Gemini path reports "not configured". */
export function registerAiSpendLedger(db: { $client: BetterSqlite3.Database } | null): void {
  ledger = db ? sqliteLedger(db.$client) : null;
}

export function getAiSpendLedger(): AiSpendLedger | null {
  return ledger;
}
