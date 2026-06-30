/// <reference types="vite/client" />

export function getEnv(key: keyof ImportMetaEnv, fallback = ''): string {
  return import.meta.env[key] ?? fallback;
}
