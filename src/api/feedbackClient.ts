import { apiRequest } from './http';

/** Matches the server's cap; the auto-attached URL must never fail a report. */
const PAGE_URL_MAX = 500;

export async function submitFeedback(message: string, pageUrl: string): Promise<void> {
  await apiRequest<{ id: string }>('/feedback', {
    method: 'POST',
    body: JSON.stringify({ message, pageUrl: pageUrl.slice(0, PAGE_URL_MAX) }),
  });
}
