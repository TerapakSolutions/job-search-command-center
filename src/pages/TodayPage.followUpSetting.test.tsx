/** @jest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TodayPage from './TodayPage';
import type { Contact } from '../types/contact';

// API mode, so Today reads the setting from the server path, not localStorage.
jest.mock('../api/persistence', () => ({
  isDemoMode: () => false,
  getPersistenceMode: () => 'api',
  getApiBaseUrl: () => '/api',
}));

const mockApiRequest = jest.fn();
jest.mock('../api/http', () => ({
  ...jest.requireActual('../api/http'),
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

jest.mock('../components/DailyBriefingPanel', () => () => null);
jest.mock('../components/AutomationDashboardPanel', () => () => null);
jest.mock('../components/GoalsProgressPanel', () => () => null);
jest.mock('../components/DonationCard', () => () => null);
jest.mock('../components/QuickStartPanel', () => () => null);

// Tue Nov 17, 2026, 9:00 local. Invented names and dates.
const NOW = new Date(2026, 10, 17, 9, 0);

beforeEach(() => {
  jest.useFakeTimers({
    doNotFake: [
      'nextTick',
      'queueMicrotask',
      'setImmediate',
      'clearImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
    ],
  });
  jest.setSystemTime(NOW);
  mockApiRequest.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

const mockContacts: Contact[] = [
  {
    id: 'c-meet',
    applicationId: null,
    name: 'Wren Calloway',
    email: 'wren@example.test',
    linkedIn: '',
    company: 'Quillfern Labs',
    source: 'email',
    lastContactDate: null,
    messageNotes: '',
    nextAction: 'Confirm attendance for the meeting on Nov 13.', // Fri Nov 13
    createdAt: '2030-01-01T00:00:00.000Z',
    updatedAt: '2030-01-01T00:00:00.000Z',
  },
];
const mockEmpty: never[] = [];
const mockRefresh = jest.fn().mockResolvedValue(undefined);

jest.mock('../store/useJobSearchStore', () => ({
  useJobSearchStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      applications: mockEmpty,
      contacts: mockContacts,
      interviews: mockEmpty,
      refreshData: mockRefresh,
    }),
}));

function serve(settings: () => Promise<unknown>) {
  mockApiRequest.mockImplementation((path: string) => {
    if (path === '/user-settings') return settings();
    return Promise.reject(new Error(`not served in this test: ${path}`));
  });
}

function renderPage() {
  render(
    <MemoryRouter>
      <TodayPage />
    </MemoryRouter>,
  );
}

function item(): HTMLElement {
  const section = screen.getByRole('heading', { name: /Contact next actions/ }).closest('section')!;
  return within(section).getByText('Wren Calloway').closest('li')!;
}

describe('TodayPage reads the follow-up setting', () => {
  it('with the setting at 7, a Fri Nov 13 meeting is due in 5 business days (Tue Nov 24)', async () => {
    serve(() => Promise.resolve({ followUpAfterDays: 7 }));
    renderPage();
    expect(
      await within(item()).findByText('Follow-up due in 5 business days', { exact: false }),
    ).not.toBeNull();
    expect(mockApiRequest).toHaveBeenCalledWith('/user-settings');
    expect(item().textContent).not.toContain('due in 1 business day');
  });

  it('when the setting cannot be read, it uses the default 3 (due Wed Nov 18)', async () => {
    serve(() => Promise.reject(new Error('Could not reach the server.')));
    renderPage();
    await screen.findByText('Follow up on the meeting from Nov 13.');
    // Let the rejected read settle, then the line still reflects the default.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockApiRequest).toHaveBeenCalledWith('/user-settings');
    expect(item().textContent).toContain('Follow-up due in 1 business day');
  });

  it('ignores an out-of-range value from the server and uses the default', async () => {
    serve(() => Promise.resolve({ followUpAfterDays: 99 }));
    renderPage();
    await new Promise((r) => setTimeout(r, 0));
    expect(item().textContent).toContain('Follow-up due in 1 business day');
  });
});
