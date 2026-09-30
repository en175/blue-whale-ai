import type { Request } from "express";
import { SESSION_COOKIE_NAME } from "./cookie.js";

/**
 * 取登录令牌（IKJAZL 迁移期双读）：**请求头 `Authorization: Bearer` 优先**，
 * 没有则回退会话 cookie `bw_session`。
 *
 * <p>迁移期为什么必须双读：凭证形态从 cookie 换成了请求头，但已登录的浏览器手里
 * 还是 cookie。只认请求头的话，上线那一刻所有在线用户被登出。
 *
 * <p>⚠️ **只此一处定义**。校验（AuthGuard）与吊销（logout）都用它——两处各写一份的
 * 后果不是"重复"，而是**登出只作废了一个通道**：请求头那份删了，cookie 那份还活着。
 *
 * <p>⚠️ 调用时机有约束：AuthGuard 会把上游 sk- **回注到同一个 `Authorization` 头**
 * （出网的执行凭证，与用户凭证同名不同义）。所以本函数必须在回注**之前**调用。
 * `logout` 是 `@Public()`，不经过回注那一段，天然安全。
 */
export function extractLoginToken(request: Request): string | null {
  const header = request.headers.authorization;
  if (typeof header === "string") {
    const matched = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (matched?.[1]) return matched[1].trim();
  }
  const cookie = request.cookies?.[SESSION_COOKIE_NAME];
  return typeof cookie === "string" && cookie.length > 0 ? cookie : null;
}
