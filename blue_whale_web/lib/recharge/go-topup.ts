/**
 * 充值下单/查单调用 Go 原生 new-api topup 所需的凭证解析。
 *
 * 背景（Model B + A+）：充值结算复用 Go 原生充值接口——/api/user/amount（报价）、
 * /api/user/bluewhalepay/pay（下单）、/api/user/topup/self（查单）。这些接口挂在
 * `middleware.UserAuth()`（authHelper）下，只认**用户个人 access_token**（users.access_token
 * 列）+ `New-Api-User` 头（= 令牌属主数字 id，校验 id == apiUserId），**不认前端登录拿到的
 * sk- 中继令牌**（那是 TokenAuth/relay 用的 tokens 表）。因此把前端 sk- 令牌直接转发给这些
 * 接口会被 `ValidateAccessToken` 拒绝（"invalid access token"）。
 *
 * 现阶段后台登录仍是 mock（后续接入真实登录），故按既定方针**固定使用 Go root 账户的
 * access_token + id**（env NEW_API_ROOT_ACCESS_TOKEN / NEW_API_ROOT_USER_ID）代表当前用户
 * 完成下单/查单，先跑通端到端。真实多用户登录落地后，此处改为按登录用户解析各自凭证。
 *
 * 与折扣同步（lib/topup-tier/go-amount-discount.ts）读同一组 root 凭证 env，但两者模块解耦，
 * 各自独立解析；任一未配置都降级为不可用（路由返回 503），不互相影响。
 */

export interface GoTopUpCredentials {
  baseUrl: string;
  rootToken: string;
  rootUserId: number;
}

type Env = Record<string, string | undefined>;

/** 从 env 读 root 凭证；缺任一非法 → null（调用方按未配置返回 503）。 */
export function loadGoTopUpCredentials(
  env: Env = process.env,
): GoTopUpCredentials | null {
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
