import { computeLocalActivityMetrics } from './activityMetrics';
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
