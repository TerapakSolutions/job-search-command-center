/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TodayPage from './TodayPage';
import type { Application } from '../types/application';

// These panels pull in their own data/API surface unrelated to the date bug
// under test — stub them out so this stays a focused regression test.
jest.mock('../components/DailyBriefingPanel', () => () => null);
jest.mock('../components/AutomationDashboardPanel', () => () => null);
jest.mock('../components/GoalsProgressPanel', () => () => null);

function toLocalDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(base: Date, days: number): Date {
  const copy = new Date(base);
  copy.setDate(copy.getDate() + days);
  return copy;
}

// Sooner interview in 2 days, later interview in 5 days — both inside the
// 14-day "upcoming" window, computed relative to "now" so the test doesn't
// depend on a fixed calendar date.
const now = new Date();
const soonerDateOnly = toLocalDateOnly(addDays(now, 2));
const laterDateOnly = toLocalDateOnly(addDays(now, 5));

const mockApplications: Application[] = [
  {
    id: 'app-later',
    company: 'LaterCo',
    roleTitle: 'Engineer',
    jobUrl: '',
    workLocationType: 'remote',
    location: '',
    salaryMin: null,
    salaryMax: null,
    dateApplied: null,
    status: 'interviewing',
    notes: '',
    interviewDate: laterDateOnly,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  },
  {
    id: 'app-sooner',
    company: 'SoonerCo',
    roleTitle: 'Engineer',
    jobUrl: '',
    workLocationType: 'remote',
    location: '',
    salaryMin: null,
    salaryMax: null,
    dateApplied: null,
    status: 'interviewing',
    notes: '',
    interviewDate: soonerDateOnly,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  },
];

jest.mock('../store/useJobSearchStore', () => ({
  useJobSearchStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      applications: mockApplications,
      contacts: [],
      refreshData: jest.fn().mockResolvedValue(undefined),
    }),
}));

describe('TodayPage upcoming interviews — date-only sort/filter (west-of-UTC regression)', () => {
  const originalTz = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'America/Los_Angeles';
  });

  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('includes both interviews within the 14-day window and orders the sooner one first', async () => {
    render(
      <MemoryRouter>
        <TodayPage />
      </MemoryRouter>,
    );

    const sooner = await screen.findByText('SoonerCo — Engineer');
    const later = await screen.findByText('LaterCo — Engineer');

    // Sooner interview must render before the later one (chronological sort);
    // under the pre-fix UTC-midnight parsing this ordering could invert or
    // drop entries near a day boundary depending on local TZ.
    const position = (node: HTMLElement) =>
      Array.from(document.querySelectorAll('li')).indexOf(node.closest('li')!);
    expect(position(sooner)).toBeLessThan(position(later));
  });
});
