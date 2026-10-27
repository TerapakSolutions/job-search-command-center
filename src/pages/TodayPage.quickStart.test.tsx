/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TodayPage from './TodayPage';
import type { Application } from '../types/application';

jest.mock('../components/DailyBriefingPanel', () => () => null);
jest.mock('../components/AutomationDashboardPanel', () => () => null);
jest.mock('../components/GoalsProgressPanel', () => () => null);

let mockApplications: Application[] = [];

jest.mock('../store/useJobSearchStore', () => ({
  useJobSearchStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      applications: mockApplications,
      contacts: [],
      interviews: [],
      refreshData: jest.fn().mockResolvedValue(undefined),
    }),
}));

const oneApplication: Application = {
  id: 'app-1',
  company: 'Acme',
  roleTitle: 'Engineer',
  jobUrl: '',
  workLocationType: 'remote',
  location: '',
  salaryMin: null,
  salaryMax: null,
  dateApplied: '2026-10-01',
  status: 'applied',
  notes: '',
  interviewDate: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

function renderToday() {
  render(
    <MemoryRouter>
      <TodayPage />
    </MemoryRouter>,
  );
}

describe('TodayPage quick start', () => {
  it('shows the quick start when there are no applications yet', () => {
    mockApplications = [];
    renderToday();
    expect(screen.getByRole('heading', { name: 'Quick start' })).toBeTruthy();
  });

  it('hides it once there is at least one application', () => {
    mockApplications = [oneApplication];
    renderToday();
    expect(screen.queryByRole('heading', { name: 'Quick start' })).toBeNull();
  });
});
