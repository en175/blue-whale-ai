/**
 * 充值下单/查单调用 Go 原生 new-api topup 所需的配置解析。
 *
 * 背景（Model B + A+）：充值结算复用 Go 原生充值接口——/api/user/amount（报价）、
 * /api/user/bluewhalepay/pay（下单）、/api/user/topup/self（查单）。这些接口挂在
 * 账户层 `middleware.AccountTokenOrUserAuth` 下，只凭 Bearer sk-xxx 证明账户身份；
 * 订单 User ID 一律由 Go 从验证后的 Token 属主解析，BFF 不发送 New-Api-User，
 * 也不再使用 root 凭证代理下单（NEW_API_ROOT_ACCESS_TOKEN / NEW_API_ROOT_USER_ID
 * 在充值链路退役；额度耗尽的 Token 仍可充值，禁用/过期 Token 被 Go 拒绝）。
 *
 * 折扣同步（lib/topup-tier/go-amount-discount.ts）仍保留 root 凭证 env 用于真正的
 * Root 管理接口，与本模块解耦、各自独立解析。
 */

export interface GoTopUpConfig {
  baseUrl: string;
}

type Env = Record<string, string | undefined>;

/** 只读 NEW_API_BASE_URL；缺失 → null（调用方按未配置返回 503）。 */
export function loadGoTopUpConfig(env: Env = process.env): GoTopUpConfig | null {
  const baseUrl = env.NEW_API_BASE_URL;
  if (!baseUrl) {
    return null;
  }
  return { baseUrl };
}
