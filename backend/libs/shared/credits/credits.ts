export const QUOTA_TO_CREDITS_DIVISOR = 50_000;

export function quotaToCredits(
  quota: number,
  divisor = QUOTA_TO_CREDITS_DIVISOR,
): number {
  if (!Number.isFinite(quota) || !Number.isFinite(divisor) || quota <= 0 || divisor <= 0)
    return 0;
  return Math.round((quota / divisor) * 100) / 100;
}

export function creditsToNumber(credits: number): number {
  if (!Number.isFinite(credits) || credits <= 0) return 0;
  return Math.round(credits * 100) / 100;
}
