/// <reference types="vite/client" />

/** 自定义环境变量类型声明 */
interface ImportMetaEnv {
  /** 当前环境标识：development / test / production */
  readonly VITE_APP_ENV: 'development' | 'test' | 'production';
  /** 接口域名（dev 代理目标 / 生产部署域名） */
  readonly VITE_API_BASE_URL: string;
  /** Vitest 注入；仅测试运行时为 true，Vite dev server 不存在此字段 */
  readonly VITEST?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
