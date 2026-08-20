/** 展示层换算：quota → 积分。产品确认口径（2026-08-19）：
 *  1 元 = 10 积分 = 1 美元 = 500,000 quota → 积分 = quota / 50,000（1 积分 = 50,000 quota = 0.1 美元）。
 *  仅蓝鲸端展示用；网关 quota 美元锚点（500,000 = $1）与记账换算 quotaToFen（quota→分）均不动。 */
export const QUOTA_TO_CREDITS_DIVISOR = 50_000;

export function quotaToCredits(
  quota: number,
  divisor = QUOTA_TO_CREDITS_DIVISOR,
): number {
  if (!Number.isFinite(quota) || !Number.isFinite(divisor) || quota <= 0 || divisor <= 0)
    return 0;
  return Math.round((quota / divisor) * 100) / 100;
}

/** 积分值保留 2 位小数（分位精度，消除浮点尾差）。 */
export function creditsToNumber(credits: number): number {
  if (!Number.isFinite(credits) || credits <= 0) return 0;
  return Math.round(credits * 100) / 100;
}
