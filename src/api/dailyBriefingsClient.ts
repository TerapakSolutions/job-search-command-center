import type { DailyBriefing } from '../types/dailyBriefing';
import { apiRequest as request, apiRequestOrNull } from './http';

export async function fetchLatestBriefing(): Promise<DailyBriefing | null> {
  return apiRequestOrNull<DailyBriefing>('/daily-briefings/latest');
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
