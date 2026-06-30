import { getEnv } from '../lib/env';

export type PersistenceMode = 'api' | 'demo';

export function getPersistenceMode(): PersistenceMode {
  return getEnv('VITE_PERSISTENCE_MODE') === 'demo' ? 'demo' : 'api';
}

export function isDemoMode(): boolean {
  return getPersistenceMode() === 'demo';
}

export function getApiBaseUrl(): string {
  return getEnv('VITE_API_BASE_URL', '/api');
}
