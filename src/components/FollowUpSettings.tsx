import { useCallback, useEffect, useState } from 'react';
import { isDemoMode } from '../api/persistence';
import { loadSavedFollowUpAfterDays, saveFollowUpAfterDays } from '../api/userSettingsClient';
import {
  FOLLOW_UP_AFTER_DAYS,
  FOLLOW_UP_AFTER_DAYS_MAX,
  FOLLOW_UP_AFTER_DAYS_MIN,
  isValidFollowUpAfterDays,
} from '../lib/nextActionDates';

/** Settings section: business days after a meeting before Today says to follow up. */
export default function FollowUpSettings() {
  const demoMode = isDemoMode();
  // API mode starts empty and unsaveable: a value the user did not load (or
  // deliberately type after loading) must never be PUT over their stored one.
  // Demo mode keeps its old behaviour: the default on screen, Save enabled.
  const [value, setValue] = useState(demoMode ? String(FOLLOW_UP_AFTER_DAYS) : '');
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'failed'>(
    demoMode ? 'loaded' : 'loading',
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((isCancelled: () => boolean) => {
    loadSavedFollowUpAfterDays()
      .then((days) => {
        if (isCancelled()) return;
        setValue(String(days));
        setLoadState('loaded');
      })
      .catch(() => {
        if (!isCancelled()) setLoadState('failed');
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  const handleRetry = () => {
    setLoadState('loading');
    load(() => false);
  };

  const loaded = loadState === 'loaded';

  const handleSave = async () => {
    if (!loaded) return;
    setMessage(null);
    setError(null);
    const days = Number(value);
    if (!isValidFollowUpAfterDays(days)) {
      setError(
        `Enter a whole number from ${FOLLOW_UP_AFTER_DAYS_MIN} to ${FOLLOW_UP_AFTER_DAYS_MAX}.`,
      );
      return;
    }
    setSaving(true);
    try {
      const saved = await saveFollowUpAfterDays(days);
      setValue(String(saved));
      setMessage(demoMode ? 'Follow-up days saved locally.' : 'Follow-up days saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save follow-up days');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-white border rounded-lg p-6 space-y-4">
      <div>
        <h3 className="font-medium text-gray-900">Follow-ups</h3>
        <p className="text-sm text-gray-500 mt-1">
          After a meeting, interview, or call date passes, Today reminds you to follow up
          this many business days later. Business days are Monday to Friday; holidays
          are not skipped.
        </p>
      </div>
      <label className="block max-w-xs">
        <span className="text-sm font-medium text-gray-700">
          Follow up after a meeting (business days)
        </span>
        <input
          type="number"
          min={FOLLOW_UP_AFTER_DAYS_MIN}
          max={FOLLOW_UP_AFTER_DAYS_MAX}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={!loaded}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || !loaded}
          aria-label="Save follow-up days"
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {loadState === 'loading' && (
          <p className="text-sm text-gray-500">Loading your follow-up setting…</p>
        )}
        {loadState === 'failed' && (
          <>
            <p className="text-sm text-red-600" role="alert">
              Couldn&apos;t load your follow-up setting. Reload to try again.
            </p>
            <button
              type="button"
              onClick={handleRetry}
              className="px-3 py-2 text-sm font-medium text-blue-700 border border-blue-600 rounded-lg hover:bg-blue-50"
            >
              Retry
            </button>
          </>
        )}
        {message && (
          <p className="text-sm text-green-700" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
