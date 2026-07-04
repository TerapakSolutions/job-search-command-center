/** @jest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TodayPage from './TodayPage';
import type { Application } from '../types/application';

jest.mock('../components/DailyBriefingPanel', () => () => null);
jest.mock('../components/AutomationDashboardPanel', () => () => null);
jest.mock('../components/GoalsProgressPanel', () => () => null);

const pathstream: Application = {
  id: 'app-pathstream',
  company: 'Pathstream',
  roleTitle: 'Engineering Manager',
  jobUrl: '',
  workLocationType: 'remote',
  location: '',
  salaryMin: null,
  salaryMax: null,
  dateApplied: null,
  status: 'interviewing',
  notes: '',
  interviewDate: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

// Stable state slice (matches how real zustand hands back unchanged
// references) so selector-derived values don't change identity every render.
const storeState = {
  applications: [pathstream],
  contacts: [] as unknown[],
  interviews: [] as unknown[],
  refreshData: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../store/useJobSearchStore', () => ({
  useJobSearchStore: (selector: (state: typeof storeState) => unknown) =>
    selector(storeState),
}));

const KEY = 'milestone-last-seen-status-v1';

describe('TodayPage milestone celebration', () => {
  afterEach(() => localStorage.clear());

  it('celebrates when an application has advanced into a milestone since last seen', async () => {
    localStorage.setItem(KEY, JSON.stringify({ 'app-pathstream': 'applied' }));

    render(
      <MemoryRouter>
        <TodayPage />
      </MemoryRouter>,
    );

    const banner = (await screen.findByText('Interview scheduled!')).closest(
      '[role="status"]',
    ) as HTMLElement;
    expect(banner).toBeTruthy();
    // Company/role named within the celebration itself (also appears in the
    // Upcoming-interviews card, hence scoping to the banner).
    expect(within(banner).getByText('Pathstream — Engineering Manager')).toBeTruthy();
    // Seen-status is advanced so it won't re-fire next visit.
    expect(JSON.parse(localStorage.getItem(KEY)!)['app-pathstream']).toBe(
      'interviewing',
    );
  });

  it('does not celebrate an app already at the milestone (no transition)', () => {
    localStorage.setItem(KEY, JSON.stringify({ 'app-pathstream': 'interviewing' }));

    render(
      <MemoryRouter>
        <TodayPage />
      </MemoryRouter>,
    );

    expect(screen.queryByText('Interview scheduled!')).toBeNull();
  });

  it('seeds silently on first ever run (no baseline) without celebrating', () => {
    expect(localStorage.getItem(KEY)).toBeNull();

    render(
      <MemoryRouter>
        <TodayPage />
      </MemoryRouter>,
    );

    // No confetti on first load...
    expect(screen.queryByText('Interview scheduled!')).toBeNull();
    // ...but the baseline is now recorded for next time.
    expect(JSON.parse(localStorage.getItem(KEY)!)['app-pathstream']).toBe(
      'interviewing',
    );
  });
});
