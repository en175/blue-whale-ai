/** 展示层换算：new-api quota 仍是唯一余额真相，credits 只是 UI 别名。
 *  后端需与前端 lib/credits 同系数（占位值，上线前固定）。 */
export const QUOTA_TO_CREDITS_COEFFICIENT =
  Number(process.env.QUOTA_TO_CREDITS_COEFFICIENT ?? "0.00001") || 0.00001;

export function quotaToCredits(
  quota: number,
  coefficient = QUOTA_TO_CREDITS_COEFFICIENT,
): number {
  if (
    !Number.isFinite(quota) ||
    !Number.isFinite(coefficient) ||
    quota <= 0 ||
    coefficient <= 0
  )
    return 0;
  return quota * coefficient;
}

/** 积分值保留 2 位小数（分位精度，消除浮点尾差）。 */
export function creditsToNumber(credits: number): number {
  if (!Number.isFinite(credits) || credits <= 0) return 0;
  return Math.round(credits * 100) / 100;
}
