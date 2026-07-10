/**
 * userId —— 匿名用户标识（IJZYVR API 客户端骨架）
 *
 * 对齐 BACKEND-API-PRD.md §4：「P0 鉴权:HTTP header `X-User-Id: <uuid>`,
 * 前端首次进入本地生成 UUID 存 `localStorage`,后续每次请求携带。」
 *
 * 范式抄 `components/auth/authStorage.ts`:
 * - 键 `bw-user-id`（与 `bw-user` 同前缀,零冲突）
 * - SSR 安全:typeof window 守卫 + try/catch 静默丢弃
 *
 * 边界:不做 auth 校验（P0 后端只识别不校验,P2 登录后由中台接管）。
 */

const USER_ID_KEY = "bw-user-id";

/** RFC 4122 v4 UUID 严格校验（小写八位段） */
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(v: string): boolean {
  return UUID_V4_RE.test(v);
}

/** 生成 RFC 4122 v4 UUID。优先用 `crypto.randomUUID`,降级到自实现。 */
function generateUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 取匿名 userId。无则生成一个并持久化;非法值（外部污染）则覆盖重发。
 *
 * SSR（`typeof window === "undefined"`）下返回空串,调用方应不附带 header。
 */
export function getOrCreateUserId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.localStorage.getItem(USER_ID_KEY);
    if (existing && isValidUuid(existing)) return existing;
    const fresh = generateUuid();
    window.localStorage.setItem(USER_ID_KEY, fresh);
    return fresh;
  } catch {
    // localStorage 不可用（隐私模式 / 配额溢出 / 跨域 iframe）
    // 退化到 in-memory 生成值:进程内稳定但不持久,够 P0 兜底
    return generateUuid();
  }
}
