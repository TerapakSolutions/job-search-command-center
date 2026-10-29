/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import App from './App';

jest.mock('./store/useAuthStore', () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      user: { id: 'u1', email: 'a@b.c', name: 'A' },
      loading: false,
      checked: true,
      sessionExpired: false,
      checkAuth: jest.fn(),
      logout: jest.fn(),
      handleSessionExpired: jest.fn(),
    }),
}));

jest.mock('./api/persistence', () => ({
  ...jest.requireActual('./api/persistence'),
  isDemoMode: () => false,
}));
// Data-heavy pages are stubbed: these tests are about routing and tracking, and the
// real App routes, AuthGate, AppShell, LoginPage and PrivacyPage still render.
jest.mock('./api/jobSearchClient', () => ({
  ...jest.requireActual('./api/jobSearchClient'),
  loadAllData: async () => ({ applications: [], contacts: [], interviews: [] }),
}));
jest.mock('./pages/TodayPage', () => function MockToday() { return <h1>Today page</h1>; });
jest.mock('./pages/ApplicationsPage', () => function MockApps() { return <h1>Applications page</h1>; });
jest.mock('./pages/ContactsPage', () => function MockContacts() { return <h1>Contacts page</h1>; });


describe('GA4 on a non-production host', () => {
  it('does not load on localhost even in a production build', async () => {
    process.env.JEST_PRODUCTION_BUILD = 'true';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;
    expect(window.location.hostname).toBe('localhost');
    render(<App />);
    await screen.findAllByText('Daily Actions');
    expect(document.querySelectorAll('script[src*="googletagmanager.com"]')).toHaveLength(0);
    expect(window.gtag).toBeUndefined();
    expect(window.dataLayer).toBeUndefined();
    delete process.env.JEST_PRODUCTION_BUILD;
  });
});
