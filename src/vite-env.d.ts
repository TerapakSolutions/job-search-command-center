/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PERSISTENCE_MODE?: 'api' | 'demo';
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
