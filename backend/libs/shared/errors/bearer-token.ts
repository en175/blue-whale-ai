/** BFF 请求头中的上游执行凭证：AuthGuard 回注后的 `Bearer sk-...`（下游业务接口自解析用）。
 *  登录态本身走 HttpOnly 会话 cookie，不入请求头。非该格式视为未携带。 */
export function parseBearerToken(
  authorization: string | undefined | null,
): string | null {
  return /^Bearer (sk-\S+)$/.exec(authorization ?? "")?.[1] ?? null;
}
