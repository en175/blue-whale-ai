import { TRACE_ID_HEADER, getCurrentTraceId } from "@lib/core/logging";

export const PAY_SERVER_BASE_URL_ENV = "PAY_SERVER_BASE_URL";

export class PayServerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayServerConfigError";
  }
}

export function payServerBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = (env[PAY_SERVER_BASE_URL_ENV] ?? "").trim();
  if (!raw) {
    throw new PayServerConfigError(`支付网关地址未配置（缺环境变量 ${PAY_SERVER_BASE_URL_ENV}）`);
  }
  return raw.replace(/\/+$/, "");
}

export function payServerUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${payServerBaseUrl(env)}${path}`;
}

export async function payServerFetch(
  path: string,
  init: RequestInit = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has(TRACE_ID_HEADER)) {
    const traceId = getCurrentTraceId();
    if (traceId) headers.set(TRACE_ID_HEADER, traceId);
  }
  return fetch(payServerUrl(path, env), { ...init, headers });
}
