/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://jobsearch.terapak.com/"}
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import App from './App';

const authState: Record<string, unknown> = {};

jest.mock('./store/useAuthStore', () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) => selector(authState),
}));

jest.mock('./api/persistence', () => ({
  ...jest.requireActual('./api/persistence'),
  isDemoMode: () => process.env.JEST_DEMO_MODE === 'true',
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


type Call = unknown[];
const calls = (): Call[] =>
  (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));
const pageViews = () => calls().filter((c) => c[0] === 'event' && c[1] === 'page_view');
const gtagScripts = () => document.querySelectorAll('script[src*="googletagmanager.com"]');

function signIn(signedIn: boolean) {
  Object.assign(authState, {
    user: signedIn ? { id: 'u1', email: 'jane.doe@example.com', name: 'Jane Doe' } : null,
    loading: false,
    checked: true,
    sessionExpired: false,
    checkAuth: jest.fn(),
    logout: jest.fn(),
    handleSessionExpired: jest.fn(),
  });
}

beforeEach(() => {
  process.env.JEST_PRODUCTION_BUILD = 'true';
  delete process.env.JEST_DEMO_MODE;
  signIn(true);
  window.history.replaceState(null, '', '/');
  document.head.innerHTML = '';
  delete (window as Partial<Window>).gtag;
  delete (window as Partial<Window>).dataLayer;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;
});

afterEach(() => {
  delete process.env.JEST_PRODUCTION_BUILD;
});

describe('GA4 page views', () => {
  it('loads the tag once and sends exactly one page_view for the initial load through a redirect', async () => {
    render(<App />);
    await screen.findAllByText('Daily Actions');

    expect(window.location.pathname).toBe('/today');
    expect(gtagScripts()).toHaveLength(1);
    expect(pageViews()).toHaveLength(1);
    expect(pageViews()[0][2]).toMatchObject({
      page_location: 'https://jobsearch.terapak.com/today',
      page_title: 'Daily Actions',
    });
  });

  it('sends exactly one more page_view per client-side navigation, with the previous page as referrer', async () => {
    render(<App />);
    await screen.findAllByText('Daily Actions');

    fireEvent.click(screen.getByRole('link', { name: /Applications/ }));
    await screen.findAllByRole('heading', { name: 'Applications' });
    expect(pageViews()).toHaveLength(2);
    expect(pageViews()[1][2]).toEqual({
      page_location: 'https://jobsearch.terapak.com/applications',
      page_title: 'Applications',
      page_referrer: 'https://jobsearch.terapak.com/today',
    });

    fireEvent.click(screen.getByRole('link', { name: /Contacts/ }));
    await screen.findAllByText('Communications');
    expect(pageViews()).toHaveLength(3);
    expect(gtagScripts()).toHaveLength(1);
    expect(calls().filter((c) => c[0] === 'config')).toHaveLength(1);
  });

  it('sends one page_view for a signed-out visitor redirected to /login, with the query stripped', async () => {
    signIn(false);
    window.history.replaceState(null, '', '/applications?error=auth_failed&utm_source=newsletter');
    render(<App />);
    await screen.findByText(/Sign in to manage/);

    expect(window.location.pathname).toBe('/login');
    expect(pageViews()).toHaveLength(1);
    expect(pageViews()[0][2]).toMatchObject({
      page_location: 'https://jobsearch.terapak.com/login',
      page_title: 'Sign in',
    });
  });

  it('tracks the public privacy page', async () => {
    signIn(false);
    window.history.replaceState(null, '', '/privacy');
    render(<App />);
    await screen.findByRole('heading', { name: 'Privacy' });
    expect(pageViews()).toHaveLength(1);
    expect(pageViews()[0][2]).toMatchObject({ page_location: 'https://jobsearch.terapak.com/privacy' });
  });

  it('never passes form values, emails, or user details to gtag', async () => {
    render(
      <>
        <App />
      </>,
    );
    await screen.findAllByText('Daily Actions');

    const form = document.createElement('form');
    const input = document.createElement('input');
    input.name = 'notes';
    form.appendChild(input);
    document.body.appendChild(form);
    fireEvent.change(input, { target: { value: 'Interview with Acme Corp recruiter' } });
    fireEvent.submit(form);

    act(() => {
      window.history.pushState(null, '', '/contacts/jane.doe@example.com?notes=Acme%20Corp&utm_source=x');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await screen.findAllByText(/Job Search Command Center|Communications/);

    const allowedKeys = new Set([
      'send_page_view',
      'allow_google_signals',
      'allow_ad_personalization_signals',
      'page_location',
      'page_title',
      'page_referrer',
      'ad_storage',
      'ad_user_data',
      'ad_personalization',
      'analytics_storage',
      'wait_for_update',
    ]);
    const serialized = JSON.stringify(calls());
    for (const call of calls()) {
      for (const arg of call) {
        if (arg && typeof arg === 'object' && !(arg instanceof Date)) {
          for (const key of Object.keys(arg)) expect(allowedKeys).toContain(key);
        }
      }
    }
    expect(serialized).not.toMatch(/Acme|Interview|jane|Jane|@|u1/);
    expect(pageViews().at(-1)?.[2]).toMatchObject({
      page_location: 'https://jobsearch.terapak.com/contacts/:id?utm_source=x',
    });
    form.remove();
  });
});

describe('GA4 is not loaded outside production', () => {
  it('does not load on a non-production build even on the production host', async () => {
    delete process.env.JEST_PRODUCTION_BUILD;
    render(<App />);
    await screen.findAllByText('Daily Actions');
    expect(gtagScripts()).toHaveLength(0);
    expect(window.gtag).toBeUndefined();
    expect(window.dataLayer).toBeUndefined();
  });

  it('does not load in demo mode', async () => {
    process.env.JEST_DEMO_MODE = 'true';
    render(<App />);
    await screen.findAllByText('Daily Actions');
    expect(gtagScripts()).toHaveLength(0);
    expect(window.gtag).toBeUndefined();
  });
});
