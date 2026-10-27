/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
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

function application(updatedAt: string): Application {
  return {
    id: `app-${updatedAt}`,
    company: 'Acme',
    roleTitle: 'Engineer',
    jobUrl: '',
    workLocationType: 'remote',
    location: '',
    salaryMin: null,
    salaryMax: null,
    dateApplied: null,
    status: 'applied',
    notes: '',
    interviewDate: null,
    createdAt: updatedAt,
    updatedAt,
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

describe('DailyBriefingPanel', () => {
  it('shows goal progress against the saved goals, not the defaults', async () => {
    const { container } = render(<DailyBriefingPanel />);

    await waitFor(() =>
      expect(container.textContent).toContain('Today: 0/2 · Week: 0/10'),
    );
  });

  it('says when the brief was written', async () => {
    render(<DailyBriefingPanel />);

    expect(await screen.findByText(/Written \d{1,2}:\d{2}/)).toBeTruthy();
  });

  it('does not rewrite a brief that is newer than every application', async () => {
    mockApplications = [application('2026-10-26T18:00:00.000Z')];
    render(<DailyBriefingPanel />);

    expect(await screen.findByText('You applied to 0 jobs today.')).toBeTruthy();
    expect(generateBriefing).not.toHaveBeenCalled();
  });

  it('rewrites the brief when the goals were saved after it was written', async () => {
    (fetchJobSearchGoals as jest.Mock).mockResolvedValue({
      dailyGoal: 2,
      weeklyGoal: 10,
      monthlyGoal: 40,
      updatedAt: '2026-10-26T19:50:00.000Z',
    });
    render(<DailyBriefingPanel />);

    expect(await screen.findByText('You applied to 3 jobs today.')).toBeTruthy();
    expect(generateBriefing).toHaveBeenCalledTimes(1);
  });

  it('rewrites the brief once when an application changed after it was written', async () => {
    mockApplications = [application('2026-10-26T19:30:54.000Z')];
    render(<DailyBriefingPanel />);

    expect(await screen.findByText('You applied to 3 jobs today.')).toBeTruthy();
    expect(generateBriefing).toHaveBeenCalledTimes(1);
    expect(generateBriefing).toHaveBeenCalledWith({ force: true });
  });
  it('says "rules only" when the brief was not written by the AI (#42)', async () => {
    (fetchLatestBriefing as jest.Mock).mockResolvedValue(
      briefing({ data: { ...briefing().data, summarySource: 'rules' } }),
    );
    render(<DailyBriefingPanel />);

    expect(await screen.findByText(/rules only/)).toBeTruthy();
  });

  it('does not say "rules only" for an AI-written or older brief', async () => {
    (fetchLatestBriefing as jest.Mock).mockResolvedValue(
      briefing({ data: { ...briefing().data, summarySource: 'llm' } }),
    );
    const { container, unmount } = render(<DailyBriefingPanel />);
    await screen.findByText(/Written \d{1,2}:\d{2}/);
    expect(container.textContent).not.toContain('rules only');
    unmount();

    (fetchLatestBriefing as jest.Mock).mockResolvedValue(briefing());
    const second = render(<DailyBriefingPanel />);
    await screen.findByText(/Written \d{1,2}:\d{2}/);
    expect(second.container.textContent).not.toContain('rules only');
  });

  it('says the AI is paused when the monthly AI budget was used up', async () => {
    (fetchLatestBriefing as jest.Mock).mockResolvedValue(
      briefing({ data: { ...briefing().data, summarySource: 'paused' } }),
    );
    render(<DailyBriefingPanel />);

    expect(
      await screen.findByText(
        'AI features are paused until the monthly limit resets. This brief was written without AI.',
      ),
    ).toBeTruthy();
  });
});
