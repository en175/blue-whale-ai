/**
 * 用户会话失效标记（IK8N1S）。
 *
 * 只有带此标记的 401 才表示「当前用户的登录凭证失效」。服务间鉴权失败
 * （new-api / Agent 对 BFF 的 401）在 BFF 层已映射为 502，不会带此标记；
 * 前端仅在标记存在时才清理登录态，避免上游故障把用户踢下线。
 *
 * 同构模块：浏览器端与服务端路由共用，禁止引入 server-only 依赖。
 */
export const USER_AUTH_FAILURE_HEADER = "x-auth-failure";
export const USER_AUTH_FAILURE_VALUE = "user-session";

/** 供服务端构造响应时附带标记头。 */
export function userAuthFailureHeaders(): Record<string, string> {
  return { [USER_AUTH_FAILURE_HEADER]: USER_AUTH_FAILURE_VALUE };
}

/** 判定响应是否为「用户会话失效」：401 语义由调用方先检查，这里只看标记。 */
export function isUserSessionFailureResponse(response: Response): boolean {
  return (
    response.headers.get(USER_AUTH_FAILURE_HEADER) === USER_AUTH_FAILURE_VALUE
  );
}
