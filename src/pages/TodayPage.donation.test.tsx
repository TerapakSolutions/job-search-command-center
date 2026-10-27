/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TodayPage from './TodayPage';
import HelpPage from './HelpPage';

jest.mock('../components/DailyBriefingPanel', () => () => null);
jest.mock('../components/AutomationDashboardPanel', () => () => null);
jest.mock('../components/GoalsProgressPanel', () => () => null);
jest.mock('../lib/useSupportEmail', () => ({ useSupportEmail: () => null }));

const mockEmpty: never[] = [];
const mockRefreshData = jest.fn().mockResolvedValue(undefined);
jest.mock('../api/activityClient', () => ({ fetchActivityMetrics: jest.fn().mockResolvedValue(null) }));

jest.mock('../store/useJobSearchStore', () => ({
  useJobSearchStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      applications: mockEmpty,
      contacts: mockEmpty,
      interviews: mockEmpty,
      refreshData: mockRefreshData,
    }),
}));

const DONATION = { name: 'Support Job Search Command Center' };

describe('donation card placement', () => {
  it('shows on Today, above the goals and due actions', () => {
    render(
      <MemoryRouter>
        <TodayPage />
      </MemoryRouter>,
    );
    const donation = screen.getByRole('heading', DONATION);
    const due = screen.getByRole('heading', { name: /Due actions/ });
    expect(donation.compareDocumentPosition(due) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is no longer on Help', () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('heading', DONATION)).toBeNull();
  });
});
