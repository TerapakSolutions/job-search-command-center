import type {
  ActivityHistory,
  ActivityMetrics,
  JobSearchGoals,
  ProductivityInsights,
} from '../types/activity';
import { apiRequest as request } from './http';

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
