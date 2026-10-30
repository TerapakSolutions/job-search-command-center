/// <reference types="vite/client" />

export function getEnv(key: keyof ImportMetaEnv, fallback = ''): string {
  return import.meta.env[key] ?? fallback;
}

/** True only in a `vite build` bundle (never under `vite` dev server). */
export function isProductionBuild(): boolean {
  return import.meta.env.PROD === true;
}
