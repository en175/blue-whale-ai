/**
 * 展示层换算：new-api quota 仍是唯一余额真相，credits 只是 UI 别名。
 * TODO: 上线前把占位系数固定为产品确认值。
 */
export const QUOTA_TO_CREDITS_COEFFICIENT =
  Number(process.env.NEXT_PUBLIC_QUOTA_TO_CREDITS_COEFFICIENT ?? "0.00001") ||
  0.00001;

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

/**
 * 积分值保留 2 位小数（分位精度，消除浮点尾差）。
 * 单次 AI 消费可能不足 1 积分（如 0.43），整数展示会失真，故统一 2 位小数。
 */
export function creditsToNumber(credits: number): number {
  if (!Number.isFinite(credits) || credits <= 0) return 0;
  return Math.round(credits * 100) / 100;
}

/** 积分展示格式化：2 位小数，尾随 .00 省略（如 5、0.43、12.5）。 */
export function formatCredits(credits: number): string {
  const value = creditsToNumber(credits);
  if (value === 0) return "0";
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
