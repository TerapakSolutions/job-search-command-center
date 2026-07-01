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
});
