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
