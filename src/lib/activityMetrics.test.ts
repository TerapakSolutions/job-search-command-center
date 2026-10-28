import { computeLocalActivityMetrics, firstPeriodGoals } from './activityMetrics';
import { DEFAULT_JOB_SEARCH_GOALS } from '../types/activity';
import type { Application } from '../types/application';

describe('computeLocalActivityMetrics', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const apps: Application[] = [
    {
      id: '1',
      company: 'A',
      roleTitle: 'Dev',
      jobUrl: '',
      workLocationType: 'remote',
      location: '',
      salaryMin: null,
      salaryMax: null,
      dateApplied: '2026-07-01',
      status: 'applied',
      notes: '',
      interviewDate: null,
      createdAt: '2026-07-01T10:00:00.000Z',
      updatedAt: '2026-07-01T10:00:00.000Z',
    },
  ];

  it('computes metrics from applications', () => {
    const metrics = computeLocalActivityMetrics(apps, DEFAULT_JOB_SEARCH_GOALS);
    expect(metrics.applicationsToday).toBe(1);
    expect(metrics.progress.daily.current).toBe(1);
  });
});

describe('firstPeriodGoals', () => {
  const goals = { dailyGoal: 2, weeklyGoal: 10, monthlyGoal: 40 };
  const tueOct27 = new Date(2026, 9, 27, 15, 0);

  it('scales the week and month when goals were set partway through them', () => {
    expect(firstPeriodGoals(goals, tueOct27.toISOString(), tueOct27)).toEqual({
      goals: { dailyGoal: 2, weeklyGoal: 9, monthlyGoal: 6 },
      firstPeriod: { week: true, month: true },
    });
  });

  it('uses the full targets when goals were set on the 1st, or are unset (control)', () => {
    const oct1 = new Date(2026, 9, 1, 9).toISOString();
    expect(firstPeriodGoals(goals, oct1, tueOct27).goals).toEqual(goals);
    expect(firstPeriodGoals(goals, null, tueOct27).firstPeriod).toEqual({ week: false, month: false });
  });
});
