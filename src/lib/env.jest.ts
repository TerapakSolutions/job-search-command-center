export function getEnv(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

/** Jest stand-in for `import.meta.env.PROD`; tests opt in with JEST_PRODUCTION_BUILD=true. */
export function isProductionBuild(): boolean {
  return process.env.JEST_PRODUCTION_BUILD === 'true';
}
