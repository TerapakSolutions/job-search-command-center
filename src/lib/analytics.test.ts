import {
  ANALYTICS_COOKIE_DENIED_REGIONS,
  GA_MEASUREMENT_ID,
  loadGoogleTag,
  resolveTrackedPath,
  sanitizeLocation,
  sanitizePath,
  sanitizeReferrer,
  sanitizeSearch,
  shouldLoadAnalytics,
  titleForPath,
  trackPageView,
} from './analytics';

const UUID = '3f2b8c4e-9a1d-4e7b-8c2f-1a2b3c4d5e6f';

describe('sanitizePath', () => {
  it('keeps known static routes as-is', () => {
    expect(sanitizePath('/today')).toBe('/today');
    expect(sanitizePath('/inbound-emails')).toBe('/inbound-emails');
    expect(sanitizePath('/applications/')).toBe('/applications');
  });

  it('replaces numeric ids and UUIDs with :id', () => {
    expect(sanitizePath('/applications/12345')).toBe('/applications/:id');
    expect(sanitizePath(`/applications/${UUID}`)).toBe('/applications/:id');
    expect(sanitizePath(`/contacts/${UUID.toUpperCase()}/notes/9`)).toBe('/contacts/:id/:id/:id');
  });

  it('replaces free-text segments (employer or contact slugs) with :id', () => {
    expect(sanitizePath('/applications/acme-corp')).toBe('/applications/:id');
    expect(sanitizePath('/jane-doe')).toBe('/:id');
  });

  it('removes emails in paths, raw or percent-encoded', () => {
    expect(sanitizePath('/contacts/jane.doe@example.com')).toBe('/contacts/:id');
    expect(sanitizePath('/contacts/jane.doe%40example.com')).toBe('/contacts/:id');
    expect(sanitizePath('/contacts/jane.doe@example.com')).not.toMatch(/example|jane|@/);
  });
});

describe('sanitizeSearch', () => {
  it('strips every parameter except utm_* and gclid', () => {
    expect(
      sanitizeSearch('?error=auth_failed&utm_source=linkedin&q=acme&utm_campaign=beta&gclid=abc123&code=xyz'),
    ).toBe('?utm_source=linkedin&utm_campaign=beta&gclid=abc123');
  });

  it('returns an empty string when nothing is allowed', () => {
    expect(sanitizeSearch('?state=s3cr3t&code=oauth')).toBe('');
    expect(sanitizeSearch('')).toBe('');
  });

  it('removes emails in queries, even in allow-listed keys', () => {
    expect(sanitizeSearch('?email=jane@example.com&utm_source=jane%40example.com&utm_medium=email')).toBe(
      '?utm_medium=email',
    );
  });
});

describe('sanitizeLocation', () => {
  it('builds an absolute production URL with no hash, ids, or private params', () => {
    expect(sanitizeLocation(`/applications/${UUID}`, '?note=hello&utm_source=x')).toBe(
      'https://jobsearch.terapak.com/applications/:id?utm_source=x',
    );
  });
});

describe('sanitizeReferrer', () => {
  it('sanitizes same-host referrers', () => {
    expect(sanitizeReferrer('https://jobsearch.terapak.com/contacts/jane@example.com?x=1')).toBe(
      'https://jobsearch.terapak.com/contacts/:id',
    );
  });

  it('reduces cross-origin referrers to their origin (drops OAuth codes)', () => {
    expect(sanitizeReferrer('https://accounts.google.com/o/oauth2/v2/auth?code=abc&state=def')).toBe(
      'https://accounts.google.com/',
    );
  });

  it('returns empty for missing or invalid referrers', () => {
    expect(sanitizeReferrer('')).toBe('');
    expect(sanitizeReferrer('not a url')).toBe('');
  });
});

describe('titleForPath', () => {
  it('uses a static per-route title, never document.title', () => {
    document.title = 'Acme Corp - Jane Doe';
    expect(titleForPath('/applications')).toBe('Applications');
    expect(titleForPath('/applications/:id')).toBe('Not found');
  });
});

describe('shouldLoadAnalytics', () => {
  const prod = { hostname: 'jobsearch.terapak.com', prodBuild: true, demoMode: false };

  it('loads only on the production host, in a production build, outside demo mode', () => {
    expect(shouldLoadAnalytics(prod)).toBe(true);
  });

  it.each([
    'localhost',
    '127.0.0.1',
    'job-search-command-center.fly.dev',
    'staging.jobsearch.terapak.com',
    'jobsearch.terapak.com.evil.example',
    'terapak.com',
  ])('does not load on %s', (hostname) => {
    expect(shouldLoadAnalytics({ ...prod, hostname })).toBe(false);
  });

  it('does not load in a development build or demo mode', () => {
    expect(shouldLoadAnalytics({ ...prod, prodBuild: false })).toBe(false);
    expect(shouldLoadAnalytics({ ...prod, demoMode: true })).toBe(false);
  });
});

describe('resolveTrackedPath', () => {
  const signedIn = { demoMode: false, authChecked: true, signedIn: true };

  it('skips redirect-only routes', () => {
    expect(resolveTrackedPath({ ...signedIn, pathname: '/' })).toBeNull();
    expect(resolveTrackedPath({ ...signedIn, pathname: '/dashboard' })).toBeNull();
    expect(resolveTrackedPath({ ...signedIn, pathname: '/login' })).toBeNull();
  });

  it('waits for the auth check on protected routes', () => {
    expect(resolveTrackedPath({ ...signedIn, authChecked: false, pathname: '/today' })).toBeNull();
  });

  it('skips protected routes that will redirect a signed-out user to /login', () => {
    expect(resolveTrackedPath({ ...signedIn, signedIn: false, pathname: '/today' })).toBeNull();
    expect(resolveTrackedPath({ ...signedIn, signedIn: false, pathname: '/login' })).toBe('/login');
  });

  it('tracks public routes without waiting for auth', () => {
    const unresolved = { demoMode: false, authChecked: false, signedIn: false };
    expect(resolveTrackedPath({ ...unresolved, pathname: '/privacy' })).toBe('/privacy');
    expect(resolveTrackedPath({ ...unresolved, pathname: '/donation-success' })).toBe('/donation-success');
  });

  it('tracks the sanitized pattern for signed-in pages', () => {
    expect(resolveTrackedPath({ ...signedIn, pathname: `/applications/${UUID}` })).toBe('/applications/:id');
  });
});

describe('ANALYTICS_COOKIE_DENIED_REGIONS', () => {
  it('is exactly the EEA plus UK and Switzerland', () => {
    expect([...ANALYTICS_COOKIE_DENIED_REGIONS].sort()).toEqual(
      [
        'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
        'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO',
        'GB', 'CH',
      ].sort(),
    );
  });
});

describe('loadGoogleTag and trackPageView', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    delete (window as Partial<Window>).gtag;
    delete (window as Partial<Window>).dataLayer;
  });

  const calls = () => (window.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));

  it('injects the tag once, sets both consent defaults before js/config, and disables the automatic page_view', () => {
    loadGoogleTag('');
    loadGoogleTag('');
    const scripts = document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]');
    expect(scripts).toHaveLength(1);
    expect((scripts[0] as HTMLScriptElement).src).toBe(
      `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`,
    );

    const all = calls();
    const consentCalls = all.filter((c) => c[0] === 'consent' && c[1] === 'default');
    const configs = all.filter((c) => c[0] === 'config');
    expect(configs).toHaveLength(1);
    // Region-specific default first, then the global default; both before js and config.
    expect(consentCalls).toHaveLength(2);
    expect(all[0]).toEqual(['consent', 'default', {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'denied',
      region: [...ANALYTICS_COOKIE_DENIED_REGIONS],
    }]);
    expect(all[1]).toEqual(['consent', 'default', {
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'granted',
    }]);
    expect(all[2][0]).toBe('js');
    expect(all[3][0]).toBe('config');
    expect(configs[0][1]).toBe(GA_MEASUREMENT_ID);
    expect(configs[0][2]).toMatchObject({
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    expect(all.some((c) => c[0] === 'event')).toBe(false);
  });

  it('sanitizes the page context on config so non-page_view events cannot read the raw URL', () => {
    window.history.replaceState(null, '', `/contacts/${UUID}?note=secret#x`);
    loadGoogleTag('https://accounts.google.com/o/oauth2/v2/auth?code=abc');
    const config = calls().find((c) => c[0] === 'config');
    expect(config?.[2]).toMatchObject({
      page_location: 'https://jobsearch.terapak.com/contacts/:id',
      page_title: 'Not found',
      page_referrer: 'https://accounts.google.com/',
    });
    window.history.replaceState(null, '', '/');
  });

  it('sends exactly one page_view with sanitized values per call, and sets page context first', () => {
    loadGoogleTag('');
    trackPageView({ path: '/applications', search: '?utm_source=x&q=acme', referrer: '' });
    const all = calls();
    const views = all.filter((c) => c[0] === 'event' && c[1] === 'page_view');
    expect(views).toHaveLength(1);
    expect(views[0][2]).toEqual({
      page_location: 'https://jobsearch.terapak.com/applications?utm_source=x',
      page_title: 'Applications',
      page_referrer: '',
    });
    const set = all.find((c) => c[0] === 'set');
    expect(set?.[1]).toEqual(views[0][2]);
  });

  it('does nothing when the tag was never loaded', () => {
    trackPageView({ path: '/today', search: '', referrer: '' });
    expect(window.dataLayer).toBeUndefined();
  });
});
