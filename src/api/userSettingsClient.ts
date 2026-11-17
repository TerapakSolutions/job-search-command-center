import { apiRequest as request } from './http';
import { isDemoMode } from './persistence';
import { FOLLOW_UP_AFTER_DAYS, isValidFollowUpAfterDays } from '../lib/nextActionDates';

/** Demo mode keeps the setting in this browser, per the Settings page note. */
export const DEMO_FOLLOW_UP_DAYS_KEY = 'follow-up-after-days';

interface UserSettings {
  followUpAfterDays: number;
}

/**
 * The signed-in user's "follow up after a meeting" business days. API mode reads
 * /api/user-settings (scoped to the session user); demo mode reads localStorage.
 * Anything missing or out of range reads as FOLLOW_UP_AFTER_DAYS. API errors throw.
 */
export async function loadFollowUpAfterDays(): Promise<number> {
  if (isDemoMode()) {
    let stored: number | null = null;
    try {
      const raw = localStorage.getItem(DEMO_FOLLOW_UP_DAYS_KEY);
      stored = raw === null ? null : Number(raw);
    } catch {
      stored = null;
    }
    return isValidFollowUpAfterDays(stored) ? stored : FOLLOW_UP_AFTER_DAYS;
  }
  const data = await request<UserSettings>('/user-settings');
  return isValidFollowUpAfterDays(data?.followUpAfterDays)
    ? data.followUpAfterDays
    : FOLLOW_UP_AFTER_DAYS;
}

/** Saves the value (the caller validates; the server validates again). Returns what was stored. */
export async function saveFollowUpAfterDays(days: number): Promise<number> {
  if (isDemoMode()) {
    localStorage.setItem(DEMO_FOLLOW_UP_DAYS_KEY, String(days));
    return days;
  }
  const data = await request<UserSettings>('/user-settings', {
    method: 'PUT',
    body: JSON.stringify({ followUpAfterDays: days }),
  });
  return data.followUpAfterDays;
}
