/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GoalsProgressPanel from './GoalsProgressPanel';
import { fetchActivityMetrics } from '../api/activityClient';
import type { ActivityMetrics } from '../types/activity';

jest.mock('../api/activityClient', () => ({ fetchActivityMetrics: jest.fn() }));
jest.mock('../api/persistence', () => ({ isDemoMode: () => false }));
const mockApplications: never[] = [];
jest.mock('../store/useJobSearchStore', () => ({
  useJobSearchStore: (selector: (s: { applications: never[] }) => unknown) =>
    selector({ applications: mockApplications }),
}));

const metrics: ActivityMetrics = {
  applicationsToday: 1,
  applicationsThisWeek: 1,
  applicationsThisMonth: 1,
  currentStreak: 1,
  longestStreak: 1,
  avgApplicationsPerWeekday: {},
  goals: { dailyGoal: 5, weeklyGoal: 25, monthlyGoal: 100 },
  progress: {
    daily: { current: 1, goal: 5, percent: 20, met: false },
    weekly: { current: 1, goal: 25, percent: 4, met: false },
    monthly: { current: 1, goal: 100, percent: 1, met: false },
  },
};

function renderPanel() {
  return render(
    <MemoryRouter>
      <GoalsProgressPanel />
    </MemoryRouter>,
  );
}

describe('GoalsProgressPanel', () => {
  it('shows counts and a prompt to set goals, not the placeholder targets', async () => {
    (fetchActivityMetrics as jest.Mock).mockResolvedValue({ ...metrics, goalsSetByUser: false });
    const { container } = renderPanel();

    expect(await screen.findByRole('link', { name: /Set your goals/ })).toBeTruthy();
    expect(container.textContent).not.toMatch(/\/5|\/25|\/100/);
  });

  it('shows progress against the goals once they are set (control)', async () => {
    (fetchActivityMetrics as jest.Mock).mockResolvedValue({ ...metrics, goalsSetByUser: true });
    renderPanel();

    expect(await screen.findByText('1/5')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Set your goals/ })).toBeNull();
  });
});
