/**
 * api —— 新页面（generate / assets）共享的后端请求层。
 *
 * 走 Next rewrite /api/* → blue_whale_server:8000（见 next.config.ts），浏览器同源无 CORS。
 * 统一 Result{code,msg,data} 拆包：code!==200 抛 Error(msg)，否则返 data。
 *
 * canvas 的 app/canvas/_canvas/api/generation.ts 维持其私有 request——本 change 约束「不动 canvas」，
 * 故此处另起共享 client，二者短期并存，后续可统一收口。
 */

/** 后端 MyBatis-Plus Page 经 Jackson SNAKE_CASE 序列化后的分页结构。 */
export type Paged<T> = {
  records: T[];
  total: number;
  size: number;
  current: number;
};

const API_BASE = "/api";
const DEFAULT_USER_ID = "1";

/** MVP 无鉴权：X-User-Id 头默认 1，localStorage `bw_user_id` 可覆盖。 */
export function userIdHeader(): string {
  if (typeof window === "undefined") return DEFAULT_USER_ID;
  return window.localStorage.getItem("bw_user_id") || DEFAULT_USER_ID;
}

/** 统一 GET/POST 请求：拆 Result 包，code!==200 抛错。 */
export async function request<T>(path: string, method: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-User-Id": userIdHeader(),
      },
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
