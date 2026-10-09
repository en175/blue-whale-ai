
interface ImportMetaEnv {
  readonly VITE_APP_ENV: 'development' | 'test' | 'production';
  readonly VITE_API_BASE_URL: string;
  readonly VITEST?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
