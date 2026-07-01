import type { DailyBriefing } from '../types/dailyBriefing';
import { getApiBaseUrl } from './persistence';

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Request failed: ${res.status}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export async function fetchLatestBriefing(): Promise<DailyBriefing | null> {
  const res = await fetch(`${getApiBaseUrl()}/daily-briefings/latest`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<DailyBriefing>;
}

export async function fetchBriefingHistory(limit = 30): Promise<DailyBriefing[]> {
  return request<DailyBriefing[]>(`/daily-briefings?limit=${limit}`);
}

export async function fetchBriefingById(id: string): Promise<DailyBriefing> {
  return request<DailyBriefing>(`/daily-briefings/${id}`);
}

export async function generateBriefing(options?: {
  force?: boolean;
  sendEmail?: boolean;
}): Promise<DailyBriefing> {
  return request<DailyBriefing>('/daily-briefings/generate', {
    method: 'POST',
    body: JSON.stringify(options ?? {}),
  });
}
