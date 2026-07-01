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
