/** @jest-environment jsdom */
import { useJobSearchStore } from './useJobSearchStore';
import type { Contact } from '../types/contact';

// API mode: every write goes through apiRequest, captured here.
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

const recruiter: Contact = {
  id: 'c-1',
  applicationId: 'app-1',
  name: 'Lena Ortiz',
  email: 'lena.ortiz@talent-c.example',
  linkedIn: '',
  company: 'Talent C',
  source: 'email',
  lastContactDate: '2026-11-10',
  messageNotes: '',
  nextAction: '',
  declineDetectedAt: null,
  threadClosedAt: null,
  createdAt: '',
  updatedAt: '',
};

function calls() {
  return mockApiRequest.mock.calls.map(([url, init]) => [
    url,
    (init as RequestInit | undefined)?.method,
    JSON.parse(((init as RequestInit | undefined)?.body as string) ?? 'null'),
  ]);
}

beforeEach(() => {
  mockApiRequest.mockReset();
  mockApiRequest.mockResolvedValue({});
  useJobSearchStore.setState({ contacts: [recruiter], applications: [], interviews: [] });
});

describe('"I followed up"', () => {
  it('logs an outbound touch now and moves the contact date to today', () => {
    const now = new Date('2026-11-24T12:00:00');
    useJobSearchStore.getState().logFollowUp('c-1', now);

    expect(useJobSearchStore.getState().contacts[0].lastContactDate).toBe('2026-11-24');
    expect(calls()).toEqual([
      ['/contacts/c-1', 'PUT', { lastContactDate: '2026-11-24' }],
      [
        '/communications',
        'POST',
        {
          applicationId: 'app-1',
          contactId: 'c-1',
          channel: 'email',
          direction: 'outbound',
          subject: 'Followed up (logged from Today)',
          body: '',
          occurredAt: now.toISOString(),
        },
      ],
    ]);
  });
});

describe('"Close thread"', () => {
  it('confirming stores the close time', () => {
    useJobSearchStore.getState().closeContactThread('c-1', new Date('2026-11-24T20:00:00.000Z'));
    expect(useJobSearchStore.getState().contacts[0].threadClosedAt).toBe('2026-11-24T20:00:00.000Z');
    expect(calls()).toEqual([['/contacts/c-1', 'PUT', { threadClosedAt: '2026-11-24T20:00:00.000Z' }]]);
  });

  it('"Keep open" clears the suggestion and records your choice', () => {
    useJobSearchStore.setState({ contacts: [{ ...recruiter, declineDetectedAt: '2026-11-10T23:18:37.000Z' }] });
    const now = new Date('2026-11-24T20:00:00.000Z');
    useJobSearchStore.getState().keepContactThreadOpen('c-1', now);
    const change = { declineDetectedAt: null, threadKeptOpenAt: now.toISOString() };
    expect(useJobSearchStore.getState().contacts[0]).toMatchObject({ ...change, threadClosedAt: null });
    expect(calls()).toEqual([['/contacts/c-1', 'PUT', change]]);
  });
});
