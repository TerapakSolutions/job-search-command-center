/** @jest-environment node */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { jobSearchGoals } from '../db/schema.js';
import { getActivityMetrics, updateJobSearchGoals } from './activityMetrics.js';
import { aggregateBriefingData } from './briefingAggregator.js';
import { generateDailyBriefingForUser } from './briefingGenerator.js';
import { buildFallbackSummary } from './llmClient.js';
import { createTestDb, seedApplication, seedTestUser } from './testDb.js';

// A new account starts on placeholder goals (5 a day, 25 a week, 100 a month)
// it never chose. Until the user saves their own, the brief must not call
// them "behind" or "at risk"; it suggests setting goals in Settings instead.

const NOW = new Date('2026-10-27T19:00:00.000Z');
const saved = { ...process.env };

function newUserWithOneApplication() {
  const db = createTestDb();
  const userId = seedTestUser(db);
  seedApplication(db, userId, {
    dateApplied: '2026-10-27',
    createdAt: '2026-10-27T18:00:00.000Z',
  });
  return { db, userId };
}

const PRESSURE = /behind|at risk|Your goal is|more application/i;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  process.env = { ...saved };
  delete process.env.OPENAI_API_KEY;
});
afterEach(() => {
  jest.useRealTimers();
  process.env = { ...saved };
  jest.restoreAllMocks();
});

describe('goals the user has not set', () => {
  it('reports goals as not set for a new account, and set once saved', () => {
    const { db, userId } = newUserWithOneApplication();
    expect(getActivityMetrics(db, userId, NOW).goalsSetByUser).toBe(false);

    updateJobSearchGoals(db, userId, { dailyGoal: 2 });
    expect(getActivityMetrics(db, userId, NOW).goalsSetByUser).toBe(true);
  });

  it('counts goals saved before this change as set (migration backfill)', () => {
    const db = createTestDb();
    const saver = seedTestUser(db, { id: 'saver', email: 'saver@example.com' });
    const never = seedTestUser(db, { id: 'never', email: 'never@example.com' });
    const row = (userId: string, updatedAt: string) => ({
      id: `goals-${userId}`,
      userId,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt,
    });
    db.insert(jobSearchGoals).values(row(saver, '2026-10-05T00:00:00.000Z')).run();
    db.insert(jobSearchGoals).values(row(never, '2026-10-01T00:00:00.000Z')).run();

    const sql = readFileSync(
      path.join(__dirname, '../db/migrations/0011_job_search_goals_set_at.sql'),
      'utf8',
    );
    const backfill = sql.split('--> statement-breakpoint').find((s) => /UPDATE/i.test(s))!;
    db.$client.exec(backfill);

    expect(getActivityMetrics(db, saver, NOW).goalsSetByUser).toBe(true);
    expect(getActivityMetrics(db, never, NOW).goalsSetByUser).toBe(false);
  });

  it('suggests setting goals instead of saying the user is behind', () => {
    const { db, userId } = newUserWithOneApplication();
    const data = aggregateBriefingData(db, userId, NOW);

    expect(data.goalProgress?.goalMessages.join(' ')).not.toMatch(PRESSURE);
    expect(data.recommendations.join(' ')).not.toMatch(PRESSURE);
    expect(data.recommendations.join(' ')).toMatch(/Settings/);
    expect(buildFallbackSummary(data)).not.toMatch(PRESSURE);
  });

  it('keeps the goal pressure once the user has set goals (control)', () => {
    const { db, userId } = newUserWithOneApplication();
    updateJobSearchGoals(db, userId, { dailyGoal: 5, weeklyGoal: 25, monthlyGoal: 100 });
    const data = aggregateBriefingData(db, userId, NOW);

    expect(data.recommendations.join(' ')).toMatch(PRESSURE);
    expect(buildFallbackSummary(data)).toMatch(/Your goal is 5/);
  });

  it('does not give the AI the placeholder targets', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Brief.' } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const prompt = () => {
      const body = JSON.parse(fetchMock.mock.calls.at(-1)[1].body as string);
      return body.messages.map((m: { content: string }) => m.content).join('\n');
    };

    const { db, userId } = newUserWithOneApplication();
    await generateDailyBriefingForUser(db, userId, NOW, { force: true });
    expect(prompt()).not.toMatch(/"dailyGoal"|"monthlyGoal"|"monthlyMet"/);
    expect(prompt()).toMatch(/Settings/);

    updateJobSearchGoals(db, userId, { dailyGoal: 3 });
    await generateDailyBriefingForUser(db, userId, NOW, { force: true });
    expect(prompt()).toMatch(/"dailyGoal": 3/);
  });

  it('tells the AI never to mention targets while goals are unset', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Brief.' } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const systemPrompt = () => {
      const body = JSON.parse(fetchMock.mock.calls.at(-1)[1].body as string);
      return body.messages.find((m: { role: string }) => m.role === 'system').content as string;
    };

    const { db, userId } = newUserWithOneApplication();
    await generateDailyBriefingForUser(db, userId, NOW, { force: true });
    expect(systemPrompt()).not.toMatch(/daily\/weekly\/monthly targets|falling behind/);
    expect(systemPrompt()).toMatch(/Never mention targets/);

    updateJobSearchGoals(db, userId, { dailyGoal: 3 });
    await generateDailyBriefingForUser(db, userId, NOW, { force: true });
    expect(systemPrompt()).toMatch(/falling behind/);
  });

  it('leaves the stored goals row untouched by reading it', () => {
    const { db, userId } = newUserWithOneApplication();
    getActivityMetrics(db, userId, NOW);
    const rows = db.select().from(jobSearchGoals).where(eq(jobSearchGoals.userId, userId)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].goalsSetAt).toBeNull();
  });
});
