/** @jest-environment node */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { jobSearchGoals } from '../db/schema.js';
import { getActivityMetrics, getJobSearchGoals, updateJobSearchGoals } from './activityMetrics.js';
import {
  buildGoalBriefingMessages,
  computeActivityMetrics,
  firstPeriodGoals,
} from './activityMetricsCore.js';
import { generateDailyBriefingForUser } from './briefingGenerator.js';
import { createTestDb, seedApplication, seedTestUser } from './testDb.js';

// Goals saved mid-month used to be judged as if they had applied since the 1st:
// 40 a month saved on the 27th was "at risk" minutes later. In the week and
// month goals are first set, the weekly and monthly targets are scaled to the
// days left (rounded, at least 1) and the pace alerts are off.

const GOALS = { dailyGoal: 2, weeklyGoal: 10, monthlyGoal: 40 };
// Local-time constructors keep these independent of the machine's zone.
const TUE_OCT_27 = new Date(2026, 9, 27, 15, 0);
const SAT_OCT_31 = new Date(2026, 9, 31, 12, 0);
const MON_NOV_2 = new Date(2026, 10, 2, 12, 0);
const ONE_APP = [{ dateApplied: '2026-10-27', createdAt: TUE_OCT_27.toISOString(), status: 'applied' }];

const saved = { ...process.env };
afterEach(() => {
  jest.useRealTimers();
  process.env = { ...saved };
  jest.restoreAllMocks();
});

describe('firstPeriodGoals', () => {
  it('scales the week and month to the days left when goals were set this week and month', () => {
    const result = firstPeriodGoals(GOALS, TUE_OCT_27.toISOString(), TUE_OCT_27);
    // Tue-Sun is 6 of 7 days: 10 * 6/7 = 8.6 -> 9. Oct 27-31 is 5 of 31: 40 * 5/31 = 6.5 -> 6.
    expect(result.goals).toEqual({ dailyGoal: 2, weeklyGoal: 9, monthlyGoal: 6 });
    expect(result.firstPeriod).toEqual({ week: true, month: true });
  });

  it('uses the full targets once the week and month roll over', () => {
    const result = firstPeriodGoals(GOALS, TUE_OCT_27.toISOString(), MON_NOV_2);
    expect(result.goals).toEqual(GOALS);
    expect(result.firstPeriod).toEqual({ week: false, month: false });
  });

  it('leaves unset goals alone', () => {
    const result = firstPeriodGoals(GOALS, null, TUE_OCT_27);
    expect(result.goals).toEqual(GOALS);
    expect(result.firstPeriod).toEqual({ week: false, month: false });
  });
});

describe('pace alerts in the first period', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(SAT_OCT_31); // 1 day left in the week, 0 in the month
  });

  it('does not say the week or month is behind or at risk', () => {
    const metrics = {
      ...computeActivityMetrics(ONE_APP, GOALS, SAT_OCT_31),
      firstPeriod: { week: true, month: true },
    };
    expect(buildGoalBriefingMessages(metrics).join(' ')).not.toMatch(/pace alert|at risk/i);
  });

  it('still raises them after the first period (control)', () => {
    const metrics = computeActivityMetrics(ONE_APP, GOALS, SAT_OCT_31);
    const text = buildGoalBriefingMessages(metrics).join(' ');
    expect(text).toMatch(/Weekly pace alert/);
    expect(text).toMatch(/Monthly goal at risk/);
  });
});

describe('when goals were first set', () => {
  it('keeps the first save date when goals are saved again', () => {
    jest.useFakeTimers();
    const db = createTestDb();
    const userId = seedTestUser(db);
    jest.setSystemTime(new Date(2026, 9, 1, 9));
    updateJobSearchGoals(db, userId, GOALS);
    const first = getJobSearchGoals(db, userId).goalsSetAt;

    jest.setSystemTime(TUE_OCT_27);
    updateJobSearchGoals(db, userId, { monthlyGoal: 50 });
    expect(getJobSearchGoals(db, userId).goalsSetAt).toBe(first);

    // Set on Oct 1, so October is not a first partial month.
    const metrics = getActivityMetrics(db, userId, TUE_OCT_27);
    expect(metrics.goals.monthlyGoal).toBe(50);
    expect(metrics.firstPeriod?.month).toBe(false);
  });

  it('scales a user who just set goals', () => {
    jest.useFakeTimers();
    jest.setSystemTime(TUE_OCT_27);
    const db = createTestDb();
    const userId = seedTestUser(db);
    seedApplication(db, userId, { dateApplied: '2026-10-27', createdAt: TUE_OCT_27.toISOString() });
    updateJobSearchGoals(db, userId, GOALS);

    const metrics = getActivityMetrics(db, userId, TUE_OCT_27);
    expect(metrics.goals).toEqual({ dailyGoal: 2, weeklyGoal: 9, monthlyGoal: 6 });
    expect(metrics.firstPeriod).toEqual({ week: true, month: true });
  });

  it('moves existing first-set dates back to when the row was created (migration 0012)', () => {
    const db = createTestDb();
    const resaved = seedTestUser(db, { id: 'resaved', email: 'resaved@example.com' });
    const unset = seedTestUser(db, { id: 'unset', email: 'unset@example.com' });
    const row = (userId: string, goalsSetAt: string | null) => ({
      id: `goals-${userId}`,
      userId,
      goalsSetAt,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-10-20T00:00:00.000Z',
    });
    db.insert(jobSearchGoals).values(row(resaved, '2026-10-20T00:00:00.000Z')).run();
    db.insert(jobSearchGoals).values(row(unset, null)).run();

    const sql = readFileSync(
      path.join(__dirname, '../db/migrations/0012_goals_set_at_first_set.sql'),
      'utf8',
    );
    db.$client.exec(sql);

    const setAt = (userId: string) =>
      db.select().from(jobSearchGoals).where(eq(jobSearchGoals.userId, userId)).get()!.goalsSetAt;
    expect(setAt(resaved)).toBe('2026-08-01T00:00:00.000Z');
    expect(setAt(unset)).toBeNull();
  });

  it('tells the AI the saved targets when they are scaled', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(TUE_OCT_27);
    process.env.OPENAI_API_KEY = 'sk-test';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Brief.' } }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const db = createTestDb();
    const userId = seedTestUser(db);
    updateJobSearchGoals(db, userId, GOALS);
    await generateDailyBriefingForUser(db, userId, TUE_OCT_27, { force: true });

    const body = JSON.parse(fetchMock.mock.calls.at(-1)[1].body as string);
    const userPrompt = body.messages.find((m: { role: string }) => m.role === 'user').content;
    expect(userPrompt).toMatch(/scaled from 40 to 6/);
  });
});
