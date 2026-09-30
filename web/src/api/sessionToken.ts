/* ============================================
 * 登录令牌存取（IKJAZN）
 *
 * 凭证形态换成 JWT 之后，令牌由**前端自己保管**，随每个请求以
 * `Authorization: Bearer` 带回（`api/http.ts` 统一注入）。
 *
 * ⚠️ 与原来的 HttpOnly cookie 相比，这份令牌**JS 可读** —— 这是参考 GeekAI
 * 换凭证形态时一并接受的取舍（见需求 IKJAZL 的决策表）。因此这里**只放令牌本身**，
 * 不放任何用户信息：拿到它等于拿到登录态，不需要再顺带泄露别的。
 * ============================================ */

const TOKEN_STORAGE_KEY = 'bw-token';

/**
 * 读取令牌。
 *
 * <p>包 try：隐私模式 / 存储被策略禁掉时 `localStorage` 会直接抛。那种情况下
 * 「没有令牌」是正确语义，不该让整个应用起不来。
 */
export function getSessionToken(): string | null {
  try {
    const token = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    return token && token.trim() ? token : null;
  } catch {
    return null;
  }
}

/** 写入令牌（登录/注册成功后调用）。 */
export function setSessionToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // 存不进去就退化成「这次会话只在内存里」——后续请求不带令牌，
    // 迁移期后端仍认 cookie，不至于把人挡在门外。
  }
}

/** 清除令牌（登出、401 失效）。 */
export function clearSessionToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // 同上：清不掉也没有更坏的结果
  }
}
