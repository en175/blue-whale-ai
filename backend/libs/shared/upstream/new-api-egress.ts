import { NewApiError } from "@lib/core";
import { TRACE_ID_HEADER, getCurrentTraceId } from "@lib/core/logging";

export const NEW_API_BASE_URL_ENV = "NEW_API_BASE_URL";

export class NewApiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NewApiConfigError";
  }
}

export function newApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env[NEW_API_BASE_URL_ENV] ?? "").trim();
  if (!raw) {
    throw new NewApiConfigError(`上游地址未配置（缺环境变量 ${NEW_API_BASE_URL_ENV}）`);
  }
  return raw.replace(/\/+$/, "");
}

export function newApiUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${newApiBaseUrl(env)}${path}`;
}


export class UpstreamCredentialMissingError extends NewApiError {
  constructor() {
    super(
      "上游凭证未配置：请在管理端「系统设置 → 上游凭证」填入 new-api 的项目统一 key" +
        "（全项目共用这一把）",
      503,
      "upstream_credential_missing",
    );
    this.name = "UpstreamCredentialMissingError";
  }
}


export async function newApiFetch(
  path: string,
  init: RequestInit = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has(TRACE_ID_HEADER)) {
    const traceId = getCurrentTraceId();
    if (traceId) headers.set(TRACE_ID_HEADER, traceId);
  }
  return fetch(newApiUrl(path, env), { ...init, headers });
}
