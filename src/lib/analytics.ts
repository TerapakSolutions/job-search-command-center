import { matchPath } from 'react-router-dom';

/**
 * Google Analytics 4 (property 561541850). See README "Analytics (GA4)".
 *
 * Privacy rules this module enforces:
 * - only sanitized route patterns, a utm_* and gclid query allow-list, and static
 *   per-route titles ever reach gtag (never document.location/title/referrer);
 * - nothing from the store, the user, or any form is ever passed in;
 * - Consent Mode v2 defaults to denied (no _ga cookies), matching the privacy page's
 *   "the only cookie is the one that keeps you signed in".
 *
 * `window.gtag` is called from this module only.
 */

export const GA_MEASUREMENT_ID = 'G-MP6LG6VRQC';
export const PRODUCTION_HOSTNAME = 'jobsearch.terapak.com';
const PRODUCTION_ORIGIN = `https://${PRODUCTION_HOSTNAME}`;
const SCRIPT_ID = 'ga4-gtag';

/**
 * Flip to 'granted' only together with a privacy-page update: granted lets GA set
 * first-party _ga cookies.
 */
export const ANALYTICS_STORAGE_CONSENT: 'granted' | 'denied' = 'denied';

const CONSENT_DEFAULTS = {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: ANALYTICS_STORAGE_CONSENT,
} as const;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

interface TrackedRoute {
  /** react-router pattern; keep in step with the <Route>s in src/App.tsx. */
  pattern: string;
  /** Static title sent as page_title (never document.title). */
  title: string;
  /** App.tsx only <Navigate>s away from it; the destination gets the page_view. */
  redirectOnly?: boolean;
  /** Rendered by AuthGate before the auth check (no sign-in needed). */
  alwaysPublic?: boolean;
}

const ROUTES: TrackedRoute[] = [
  { pattern: '/', title: 'Job Search Command Center', redirectOnly: true },
  { pattern: '/dashboard', title: 'Job Search Command Center', redirectOnly: true },
  { pattern: '/today', title: 'Daily Actions' },
  { pattern: '/pipeline', title: 'Pipeline Board' },
  { pattern: '/applications', title: 'Applications' },
  { pattern: '/contacts', title: 'Communications' },
  { pattern: '/inbound-emails', title: 'Inbound Emails' },
  { pattern: '/settings', title: 'Settings' },
  { pattern: '/activity', title: 'Activity History' },
  { pattern: '/help', title: 'Help' },
  { pattern: '/login', title: 'Sign in' },
  { pattern: '/privacy', title: 'Privacy', alwaysPublic: true },
  { pattern: '/donation-success', title: 'Donation complete', alwaysPublic: true },
  { pattern: '/donation-cancel', title: 'Donation cancelled', alwaysPublic: true },
];

const NOT_FOUND_TITLE = 'Not found';

/** Static words that may appear in an unmatched path; anything else becomes :id. */
const KNOWN_SEGMENTS = new Set(
  ROUTES.flatMap((r) => r.pattern.split('/')).filter((s) => s && !s.startsWith(':')),
);

/**
 * Route pattern for a pathname. Unknown paths keep only known route words; every
 * other segment (ids, UUIDs, emails, employer or contact slugs) becomes `:id`.
 */
export function sanitizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '') || '/';
  for (const route of ROUTES) {
    if (matchPath({ path: route.pattern, end: true }, trimmed)) return route.pattern;
  }
  const segments = trimmed
    .split('/')
    .filter(Boolean)
    .map((segment) => (KNOWN_SEGMENTS.has(segment.toLowerCase()) ? segment.toLowerCase() : ':id'));
  return `/${segments.join('/')}`;
}

/** Keeps only utm_* and gclid, and drops any value containing an email. */
export function sanitizeSearch(search: string): string {
  const kept = new URLSearchParams();
  new URLSearchParams(search).forEach((value, key) => {
    const lower = key.toLowerCase();
    const allowed = lower === 'gclid' || /^utm_[a-z0-9_]+$/.test(lower);
    if (allowed && !value.includes('@')) kept.append(key, value);
  });
  const query = kept.toString();
  return query ? `?${query}` : '';
}

/** Absolute production URL with a sanitized path and query, and no hash. */
export function sanitizeLocation(pathname: string, search: string): string {
  return `${PRODUCTION_ORIGIN}${sanitizePath(pathname)}${sanitizeSearch(search)}`;
}

/** Same-host referrers are sanitized; any other site is reduced to its origin. */
export function sanitizeReferrer(referrer: string): string {
  if (!referrer) return '';
  try {
    const url = new URL(referrer);
    if (url.hostname === PRODUCTION_HOSTNAME) return sanitizeLocation(url.pathname, url.search);
    return url.origin && url.origin !== 'null' ? `${url.origin}/` : '';
  } catch {
    return '';
  }
}

export function titleForPath(path: string): string {
  return ROUTES.find((r) => r.pattern === path)?.title ?? NOT_FOUND_TITLE;
}

export function shouldLoadAnalytics(env: {
  hostname: string;
  prodBuild: boolean;
  demoMode: boolean;
}): boolean {
  return env.hostname === PRODUCTION_HOSTNAME && env.prodBuild && !env.demoMode;
}

/**
 * The sanitized path that deserves a page_view right now, or null while the app is
 * still deciding (auth check) or is about to redirect. Mirrors AuthGate in App.tsx so
 * one navigation through a <Navigate> yields one page_view, for the destination.
 */
export function resolveTrackedPath(state: {
  pathname: string;
  demoMode: boolean;
  authChecked: boolean;
  signedIn: boolean;
}): string | null {
  const path = sanitizePath(state.pathname);
  const route = ROUTES.find((r) => r.pattern === path);
  if (route?.alwaysPublic) return path;
  if (route?.redirectOnly) return null;
  if (!state.demoMode && !state.authChecked) return null;
  const seesApp = state.demoMode || state.signedIn;
  if (path === '/login') return seesApp ? null : path;
  return seesApp ? path : null;
}

function pageContext(path: string, search: string, referrer: string) {
  const sanitizedPath = sanitizePath(path);
  return {
    page_location: `${PRODUCTION_ORIGIN}${sanitizedPath}${sanitizeSearch(search)}`,
    page_title: titleForPath(sanitizedPath),
    page_referrer: sanitizeReferrer(referrer),
  };
}

/** Injects gtag.js once, with consent defaults set before config. */
export function loadGoogleTag(documentReferrer: string): void {
  if (document.getElementById(SCRIPT_ID)) return;

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // gtag.js only processes the Arguments object, not a copied array.
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer?.push(arguments);
  };

  window.gtag('consent', 'default', { ...CONSENT_DEFAULTS });
  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    ...pageContext(window.location.pathname, window.location.search, documentReferrer),
  });

  const script = document.createElement('script');
  script.id = SCRIPT_ID;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);
}

/**
 * One page_view. The same sanitized context is `set` first so automatic events
 * (user_engagement, scroll) never fall back to the raw URL or title.
 */
export function trackPageView(view: { path: string; search: string; referrer: string }): void {
  if (!window.gtag) return;
  const context = pageContext(view.path, view.search, view.referrer);
  window.gtag('set', context);
  window.gtag('event', 'page_view', context);
}
