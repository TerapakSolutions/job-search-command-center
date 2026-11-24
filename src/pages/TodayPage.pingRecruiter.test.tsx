/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TodayPage from './TodayPage';
import type { Application } from '../types/application';
import type { Contact } from '../types/contact';

jest.mock('../components/DailyBriefingPanel', () => () => null);
jest.mock('../components/AutomationDashboardPanel', () => () => null);
jest.mock('../components/GoalsProgressPanel', () => () => null);

// Invented identities. Contacts last heard from long ago, so the nudges show on any run date.
const app = (id: string, company: string): Application => ({
  id,
  company,
  roleTitle: 'Engineer',
  jobUrl: '',
  workLocationType: 'remote',
  location: '',
  salaryMin: null,
  salaryMax: null,
  dateApplied: null,
  status: 'recruiter_screen',
  notes: '',
  interviewDate: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

const contact = (overrides: Partial<Contact>): Contact => ({
  id: 'c-1',
  applicationId: 'app-1',
  name: 'Lena Ortiz',
  email: 'lena.ortiz@talent-c.example',
  linkedIn: '',
  company: 'Talent C',
  source: 'email',
  lastContactDate: '2026-01-05',
  messageNotes: '',
  nextAction: '',
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

const mockLogFollowUp = jest.fn();
const mockCloseContactThread = jest.fn();
const mockKeepContactThreadOpen = jest.fn();

// One state object: fresh arrays on every render would re-run Today's effects forever.
const mockState: Record<string, unknown> = {
  applications: [app('app-1', 'Acme Bank'), app('app-2', 'Globex Insurance')],
  contacts: [
    contact({}),
    contact({
      id: 'c-2',
      applicationId: 'app-2',
      name: 'Maya Lund',
      email: 'maya.lund@vendor-a.example',
      company: 'Vendor A',
      declineDetectedAt: '2026-01-05T23:18:37.000Z',
    }),
  ],
  interviews: [],
  refreshData: jest.fn().mockResolvedValue(undefined),
  moveApplication: jest.fn(),
  logFollowUp: mockLogFollowUp,
  closeContactThread: mockCloseContactThread,
  keepContactThreadOpen: mockKeepContactThreadOpen,
};

jest.mock('../store/useJobSearchStore', () => ({
  useJobSearchStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mockState),
}));

function renderToday() {
  render(
    <MemoryRouter>
      <TodayPage />
    </MemoryRouter>,
  );
}

beforeEach(() => jest.clearAllMocks());

it('"I followed up" logs the follow-up for that recruiter and hides the nudge', async () => {
  renderToday();
  await screen.findByText('Ping recruiter: Acme Bank');
  fireEvent.click(screen.getByRole('button', { name: 'I followed up' }));
  expect(mockLogFollowUp).toHaveBeenCalledWith('c-1');
  expect(screen.queryByText('Ping recruiter: Acme Bank')).toBeNull();
});

it('a decline shows a confirmable "Close thread" instead of a ping', async () => {
  renderToday();
  await screen.findByText('Close thread: Globex Insurance via Vendor A (you declined)?');
  expect(screen.queryByText('Ping recruiter: Globex Insurance')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close thread' }));
  expect(mockCloseContactThread).toHaveBeenCalledWith('c-2');
  expect(mockKeepContactThreadOpen).not.toHaveBeenCalled();
});

it('"Keep open" clears the suggestion without closing', async () => {
  renderToday();
  await screen.findByText('Close thread: Globex Insurance via Vendor A (you declined)?');
  fireEvent.click(screen.getByRole('button', { name: 'Keep open' }));
  expect(mockKeepContactThreadOpen).toHaveBeenCalledWith('c-2');
  expect(mockCloseContactThread).not.toHaveBeenCalled();
});
