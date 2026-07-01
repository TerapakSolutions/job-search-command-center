import type {
  ActivityHistory,
  ActivityMetrics,
  JobSearchGoals,
  ProductivityInsights,
} from '../types/activity';
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

export async function fetchJobSearchGoals(): Promise<JobSearchGoals> {
  return request<JobSearchGoals>('/job-search-goals');
}

export async function updateJobSearchGoals(
  goals: Partial<Pick<JobSearchGoals, 'dailyGoal' | 'weeklyGoal' | 'monthlyGoal'>>,
): Promise<JobSearchGoals> {
  return request<JobSearchGoals>('/job-search-goals', {
    method: 'PUT',
    body: JSON.stringify(goals),
  });
}

export async function fetchActivityMetrics(): Promise<ActivityMetrics> {
  return request<ActivityMetrics>('/activity/metrics');
}

export async function fetchActivityHistory(
  days = 90,
): Promise<ActivityHistory> {
  return request<ActivityHistory>(`/activity/history?days=${days}`);
}

export async function fetchProductivityInsights(): Promise<ProductivityInsights> {
  return request<ProductivityInsights>('/activity/insights');
}
