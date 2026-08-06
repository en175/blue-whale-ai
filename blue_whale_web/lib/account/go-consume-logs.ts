/**
 * 消费记录查询调用 Go /api/log/self 所需的凭证解析（过渡期方案）。
 *
 * 背景：ADR-0062 #18 只把充值三接口（amount/bluewhalepay/pay/topup/self）迁到
 * 账户层 AccountTokenOrUserAuth；/api/log/self 仍在旧 UserAuth——只认**用户个人
 * access_token**（users.access_token 列）+ New-Api-User 头，不认前端 sk- 中继令牌
 * （2026-08-05 部署环境实测 sk- 调用返回 "invalid access token"）。
 *
 * 故过渡期沿用 root 账户凭证代理查询（env NEW_API_ROOT_ACCESS_TOKEN /
 * NEW_API_ROOT_USER_ID，与折扣同步共用同一组 env、模块解耦各自解析）。mock 登录期
 * 全体用户即 root，数据归属一致；真实多用户登录且 Go 把 log/self 迁账户层后，
 * 本模块退役，改为透传用户 sk- 令牌（同 topups 路由）。
 */

export interface GoConsumeLogsCredentials {
  baseUrl: string;
  rootToken: string;
  rootUserId: number;
}

type Env = Record<string, string | undefined>;

/** 从 env 读 root 凭证；缺任一非法 → null（调用方按未配置返回 503）。 */
export function loadGoConsumeLogsCredentials(
  env: Env = process.env,
): GoConsumeLogsCredentials | null {
  const baseUrl = env.NEW_API_BASE_URL;
  const rootToken = env.NEW_API_ROOT_ACCESS_TOKEN;
  const rootUserId = Number(env.NEW_API_ROOT_USER_ID ?? "");
  if (
    !baseUrl ||
    !rootToken ||
    !Number.isInteger(rootUserId) ||
    rootUserId <= 0
  ) {
    return null;
  }
  return { baseUrl, rootToken, rootUserId };
}
