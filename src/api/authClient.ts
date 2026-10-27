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
}

export async function fetchPublicConfig(): Promise<PublicConfig> {
  try {
    const res = await fetch('/auth/config');
    if (!res.ok) return { supportEmail: null };
    return (await res.json()) as PublicConfig;
  } catch {
    return { supportEmail: null };
  }
}
