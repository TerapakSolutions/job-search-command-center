/** @jest-environment node */

import {
  computeActivityMetrics,
  computeActivityHistory,
  buildGoalBriefingMessages,
  DEFAULT_JOB_SEARCH_GOALS,
} from './activityMetricsCore.js';

describe('activityMetricsCore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-01T15:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const apps = [
    {
      dateApplied: '2026-07-01',
      createdAt: '2026-07-01T10:00:00.000Z',
      status: 'applied',
    },
    {
      dateApplied: '2026-07-01',
      createdAt: '2026-07-01T11:00:00.000Z',
      status: 'applied',
    },
    {
      dateApplied: '2026-06-30',
      createdAt: '2026-06-30T10:00:00.000Z',
      status: 'applied',
    },
    {
      dateApplied: '2026-06-29',
      createdAt: '2026-06-29T10:00:00.000Z',
      status: 'applied',
    },
  ];

  it('computes daily, weekly, and monthly counts', () => {
    const metrics = computeActivityMetrics(apps, DEFAULT_JOB_SEARCH_GOALS);
    expect(metrics.applicationsToday).toBe(2);
    expect(metrics.applicationsThisWeek).toBe(4);
    expect(metrics.applicationsThisMonth).toBe(2);
  });

  it('computes current and longest streaks', () => {
    const metrics = computeActivityMetrics(apps, DEFAULT_JOB_SEARCH_GOALS);
    expect(metrics.currentStreak).toBe(3);
    expect(metrics.longestStreak).toBe(3);
  });

  it('builds progress against goals', () => {
    const metrics = computeActivityMetrics(apps, DEFAULT_JOB_SEARCH_GOALS);
    expect(metrics.progress.daily.current).toBe(2);
    expect(metrics.progress.daily.goal).toBe(5);
    expect(metrics.progress.daily.met).toBe(false);
  });

  it('computes activity history with goal completion flags', () => {
    const history = computeActivityHistory(apps, DEFAULT_JOB_SEARCH_GOALS, new Date(), 7);
    const today = history.daily.find((d) => d.date === '2026-07-01');
    expect(today?.count).toBe(2);
    expect(today?.goalMet).toBe(false);
  });

  it('builds goal briefing messages', () => {
    const metrics = computeActivityMetrics(apps, DEFAULT_JOB_SEARCH_GOALS);
    const messages = buildGoalBriefingMessages(metrics);
    expect(messages[0]).toContain('You applied to 2 jobs today');
    expect(messages[0]).toContain('Your goal is 5');
  });

  it('does not count saved applications without dateApplied', () => {
    const metrics = computeActivityMetrics(
      [
        {
          dateApplied: null,
          createdAt: '2026-07-01T10:00:00.000Z',
          status: 'saved',
        },
        {
          dateApplied: '2026-07-01',
          createdAt: '2026-07-01T10:00:00.000Z',
          status: 'applied',
        },
      ],
      DEFAULT_JOB_SEARCH_GOALS,
    );
    expect(metrics.applicationsToday).toBe(1);
  });
});
