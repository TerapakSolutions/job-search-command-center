/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import DailyBriefingPanel from './DailyBriefingPanel';
import type { Application } from '../types/application';
import type { DailyBriefing } from '../types/dailyBriefing';
import {
  fetchBriefingHistory,
  fetchLatestBriefing,
  generateBriefing,
} from '../api/dailyBriefingsClient';
import { fetchJobSearchGoals } from '../api/activityClient';

jest.mock('../api/dailyBriefingsClient', () => ({
  fetchLatestBriefing: jest.fn(),
  fetchBriefingHistory: jest.fn(),
  generateBriefing: jest.fn(),
}));
jest.mock('../api/activityClient', () => ({
  fetchJobSearchGoals: jest.fn(),
}));
jest.mock('../api/persistence', () => ({
  isDemoMode: () => false,
}));

let mockApplications: Application[] = [];
jest.mock('../store/useJobSearchStore', () => ({
  useJobSearchStore: (selector: (s: { applications: Application[] }) => unknown) =>
    selector({ applications: mockApplications }),
}));

const BRIEF_WRITTEN_AT = '2026-10-26T18:39:40.302Z';

function briefing(overrides: Partial<DailyBriefing> = {}): DailyBriefing {
  return {
    id: 'brief-1',
    userId: 'user-1',
    briefingDate: '2026-10-26',
    aiSummary: 'You applied to 0 jobs today.',
    data: {
      windowStart: '2026-10-25T06:24:56.266Z',
      windowEnd: BRIEF_WRITTEN_AT,
      briefingDate: '2026-10-26',
      pipelineStats: {
        total: 1,
        byStatus: { applied: 1 },
        active: 1,
        offers: 0,
        rejected: 0,
        ghosted: 0,
      },
      newRecruiterEmails: [],
      applicationsSubmitted: [],
      interviewInvitations: [],
      upcomingInterviews: [],
      followUpNeeded: [],
      inactiveApplications: [],
      recruiterResponsesOvernight: [],
      newOpportunities: [],
      recommendations: [],
      changesSincePrevious: [],
    },
    status: 'completed',
    emailSentAt: null,
    createdAt: '2026-10-26T06:24:56.904Z',
    updatedAt: BRIEF_WRITTEN_AT,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApplications = [];
  (fetchLatestBriefing as jest.Mock).mockResolvedValue(briefing());
  (fetchBriefingHistory as jest.Mock).mockResolvedValue([]);
  (fetchJobSearchGoals as jest.Mock).mockResolvedValue({
    dailyGoal: 2,
    weeklyGoal: 10,
    monthlyGoal: 40,
  });
  (generateBriefing as jest.Mock).mockResolvedValue(
    briefing({
      aiSummary: 'You applied to 3 jobs today.',
      updatedAt: '2026-10-26T19:45:00.000Z',
    }),
  );
});

describe('DailyBriefingPanel when the daily AI limit was reached', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ supportEmail: 'help@example.com' }),
    }) as unknown as typeof fetch;
  });

  it('says AI is paused until tomorrow, not until the monthly limit resets', async () => {
    (fetchLatestBriefing as jest.Mock).mockResolvedValue(
      briefing({ data: { ...briefing().data, summarySource: 'paused', pausedReason: 'daily_cap' } }),
    );
    const { container } = render(<DailyBriefingPanel />);

    expect(
      await screen.findByText(/AI features are paused until tomorrow \(daily limit reached\)\. This brief was written without AI\./),
    ).toBeTruthy();
    expect(container.textContent).not.toContain('monthly limit');
    expect(container.textContent).toContain('rules only');
  });

  it('keeps the monthly text for a paused brief with no daily-cap reason', async () => {
    (fetchLatestBriefing as jest.Mock).mockResolvedValue(
      briefing({ data: { ...briefing().data, summarySource: 'paused' } }),
    );
    const { container } = render(<DailyBriefingPanel />);

    expect(await screen.findByText(/AI features are paused until the monthly limit resets\./)).toBeTruthy();
    expect(container.textContent).not.toContain('until tomorrow');
  });
});
