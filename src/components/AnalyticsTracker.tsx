import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { isDemoMode } from '../api/persistence';
import { isProductionBuild } from '../lib/env';
import {
  loadGoogleTag,
  resolveTrackedPath,
  sanitizeLocation,
  shouldLoadAnalytics,
  trackPageView,
} from '../lib/analytics';
import { useAuthStore } from '../store/useAuthStore';

/**
 * Mounted once in App, inside the router and above AuthGate, so the public pages
 * (login, privacy, donation results) are measured too. Renders nothing.
 */
export default function AnalyticsTracker() {
  const location = useLocation();
  const checked = useAuthStore((s) => s.checked);
  const signedIn = useAuthStore((s) => s.user !== null);
  const demoMode = isDemoMode();
  const enabled = shouldLoadAnalytics({
    hostname: window.location.hostname,
    prodBuild: isProductionBuild(),
    demoMode,
  });
  const lastTrackedKey = useRef<string | null>(null);
  const previousLocation = useRef<string | null>(null);

  useEffect(() => {
    if (enabled) loadGoogleTag(document.referrer);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || lastTrackedKey.current === location.key) return;
    const path = resolveTrackedPath({
      pathname: location.pathname,
      demoMode,
      authChecked: checked,
      signedIn,
    });
    if (!path) return;
    lastTrackedKey.current = location.key;
    trackPageView({
      path,
      search: location.search,
      referrer: previousLocation.current ?? document.referrer,
    });
    previousLocation.current = sanitizeLocation(location.pathname, location.search);
  }, [enabled, location.key, location.pathname, location.search, demoMode, checked, signedIn]);

  return null;
}
