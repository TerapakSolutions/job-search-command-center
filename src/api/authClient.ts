import type { User } from '../types/user';

export async function fetchCurrentUser(): Promise<User | null> {
  const res = await fetch('/auth/me', { credentials: 'include' });
  if (res.status === 401) {
    return null;
  }
  if (!res.ok) {
    throw new Error('Failed to check authentication');
  }
  return res.json() as Promise<User>;
}

export function getGoogleLoginUrl(): string {
  return '/auth/google';
}

export async function logout(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
}

export interface PublicConfig {
  supportEmail: string | null;
  /** True only when the server has "Report a problem" switched on. */
  feedbackEnabled: boolean;
}

export async function fetchPublicConfig(): Promise<PublicConfig> {
  try {
    const res = await fetch('/auth/config');
    if (!res.ok) return { supportEmail: null, feedbackEnabled: false };
    const body = (await res.json()) as Partial<PublicConfig>;
    return {
      supportEmail: body.supportEmail ?? null,
      feedbackEnabled: body.feedbackEnabled === true,
    };
  } catch {
    return { supportEmail: null, feedbackEnabled: false };
  }
}
