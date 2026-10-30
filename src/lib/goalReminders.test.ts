import { computeGoalReminders } from './goalReminders';
import type { ActivityMetrics } from '../types/activity';

describe('computeGoalReminders', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-01T18:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const baseMetrics: ActivityMetrics = {
    applicationsToday: 1,
    applicationsThisWeek: 10,
    applicationsThisMonth: 40,
    currentStreak: 3,
    longestStreak: 5,
    avgApplicationsPerWeekday: {},
    goals: { dailyGoal: 5, weeklyGoal: 25, monthlyGoal: 100 },
    progress: {
      daily: { current: 1, goal: 5, percent: 20, met: false },
      weekly: { current: 10, goal: 25, percent: 40, met: false },
      monthly: { current: 40, goal: 100, percent: 40, met: false },
    },
  };

  it('reminds when daily goal not met in evening', () => {
    const evening = new Date('2026-07-01T12:00:00.000Z');
    evening.setHours(18, 0, 0, 0);
    const reminders = computeGoalReminders(baseMetrics, evening);
    expect(reminders.some((r) => r.type === 'daily_goal_behind')).toBe(true);
  });

  it('congratulates streak milestones', () => {
    const reminders = computeGoalReminders({
      ...baseMetrics,
      currentStreak: 7,
    });
    expect(reminders.some((r) => r.type === 'streak_milestone')).toBe(true);
  });

  // 2026-10-29 (Steve): "3-day streak! Congratulations on 3 consecutive days" showed next to
  // "0 today". Both were true — the streak counts through YESTERDAY until today ends
  // (activityMetrics computeStreaks) — but the wording read as if today counted.
  it('with nothing applied today, the streak message says it is still open — not a done deal', () => {
    const reminders = computeGoalReminders({
      ...baseMetrics,
      applicationsToday: 0,
      currentStreak: 3,
      progress: { ...baseMetrics.progress, daily: { current: 0, goal: 5, percent: 0, met: false } },
    });
    const streak = reminders.find((r) => r.type === 'streak_milestone');
    expect(streak?.title).toBe('3-day streak');
    expect(streak?.description).toBe(
      'You applied each of the last 3 days. Apply today to keep the streak going.',
    );
  });

  it('once something is applied today, the milestone congratulates as before', () => {
    const reminders = computeGoalReminders({ ...baseMetrics, applicationsToday: 1, currentStreak: 3 });
    const streak = reminders.find((r) => r.type === 'streak_milestone');
    expect(streak?.title).toBe('3-day streak!');
    expect(streak?.description).toBe('Congratulations on 3 consecutive days of applications. Keep it up!');
  });

  it('congratulates daily goal completion', () => {
    const reminders = computeGoalReminders({
      ...baseMetrics,
      applicationsToday: 5,
      progress: {
        ...baseMetrics.progress,
        daily: { current: 5, goal: 5, percent: 100, met: true },
      },
    });
    expect(reminders.some((r) => r.type === 'daily_goal_met')).toBe(true);
  });

  describe('when the user has not set their own goals', () => {
    const PRESSURE_IDS = ['goal-daily-behind', 'goal-weekly-pace', 'goal-monthly-risk'];
    // Friday evening, a day before month end: every "behind" reminder fires.
    const lateInMonth = new Date(2026, 9, 30, 19, 0, 0);
    const behind: ActivityMetrics = {
      ...baseMetrics,
      currentStreak: 0,
      progress: {
        daily: { current: 0, goal: 5, percent: 0, met: false },
        weekly: { current: 1, goal: 25, percent: 4, met: false },
        monthly: { current: 1, goal: 100, percent: 1, met: false },
      },
    };
    const ids = (m: ActivityMetrics) => computeGoalReminders(m, lateInMonth).map((r) => r.id);

    it('shows no behind or at-risk reminders', () => {
      const shown = ids({ ...behind, goalsSetByUser: false });
      for (const id of PRESSURE_IDS) expect(shown).not.toContain(id);
    });

    it('still shows them once goals are set, or when unknown (control)', () => {
      expect(ids({ ...behind, goalsSetByUser: true })).toEqual(expect.arrayContaining(PRESSURE_IDS));
      expect(ids(behind)).toEqual(expect.arrayContaining(PRESSURE_IDS));
    });
  });

  describe('in the week and month goals were first set', () => {
    const satOct31 = new Date(2026, 9, 31, 19, 0, 0);
    const behind: ActivityMetrics = {
      ...baseMetrics,
      currentStreak: 0,
      progress: {
        daily: { current: 0, goal: 2, percent: 0, met: false },
        weekly: { current: 1, goal: 9, percent: 11, met: false },
        monthly: { current: 1, goal: 6, percent: 16, met: false },
      },
    };
    const ids = (m: ActivityMetrics) => computeGoalReminders(m, satOct31).map((r) => r.id);

    it('shows no weekly pace or monthly at-risk reminder, but keeps the daily one', () => {
      const shown = ids({ ...behind, firstPeriod: { week: true, month: true } });
      expect(shown).not.toContain('goal-weekly-pace');
      expect(shown).not.toContain('goal-monthly-risk');
      expect(shown).toContain('goal-daily-behind');
    });

    it('shows them outside the first period (control)', () => {
      expect(ids(behind)).toEqual(expect.arrayContaining(['goal-weekly-pace', 'goal-monthly-risk']));
    });
  });
});
