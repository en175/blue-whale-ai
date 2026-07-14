/**
 * api —— 新页面（generate / assets）共享的后端请求层。
 *
 * 走 Next rewrite /api/* → 后端服务（见 next.config.ts），浏览器同源无 CORS。
 * 统一 Result{code,msg,data} 拆包：code!==200 抛 Error(msg)，否则返 data。
 * 通过 api-client 实现 Bearer token 自动附送 + 401 自动刷新。
 */

import { apiFetch } from "./api-client";

/** 后端 MyBatis-Plus Page 经 Jackson SNAKE_CASE 序列化后的分页结构。 */
export type Paged<T> = {
  records: T[];
  total: number;
  size: number;
  current: number;
};

const API_BASE = "/api/agent";

/** 统一 GET/POST 请求：apiFetch 自动带 Authorization 头 + 401 拦截刷新。 */
export async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(`${API_BASE}${path}`, {
      method,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("后端未启动或无法连接");
  }
  let json: { code: number; msg?: string; data?: T };
  try {
    json = await res.json();
  } catch {
    throw new Error(`上游响应非 JSON（HTTP ${res.status}）`);
  }
  if (json.code !== 200) {
    throw new Error(json.msg || `上游错误 ${json.code}`);
  }
  return json.data as T;
}
