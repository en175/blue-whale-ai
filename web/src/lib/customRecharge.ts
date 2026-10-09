import type { RechargeCustomConfig } from '@/api/recharge';

export type CustomCreditsRule = Pick<
  RechargeCustomConfig,
  'min_credits' | 'max_credits' | 'default_credits' | 'step_credits' | 'credits_per_yuan'
>;

export function customPriceFen(credits: number, creditsPerYuan: number): number {
  if (!Number.isFinite(credits) || !Number.isFinite(creditsPerYuan) || creditsPerYuan <= 0) {
    return 0;
  }
  return Math.round((credits * 100) / creditsPerYuan);
}

export function formatPriceYuan(fen: number): string {
  return fen % 100 === 0 ? String(fen / 100) : (fen / 100).toFixed(2);
}

export function formatCredits(credits: number): string {
  return credits.toLocaleString('en-US');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function snapCredits(raw: number | null | undefined, rule: CustomCreditsRule): number {
  const { min_credits: min, max_credits: max, default_credits: fallback, step_credits: step } = rule;
  if (raw == null || !Number.isFinite(raw)) return clamp(fallback, min, max);
  const clamped = clamp(Math.round(raw), min, max);
  if (step <= 1) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  return clamp(snapped, min, max);
}

export function validateCredits(
  raw: number | null | undefined,
  rule: CustomCreditsRule,
): string | null {
  const { min_credits: min, max_credits: max, step_credits: step } = rule;
  if (raw == null || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    return `请输入 ${formatCredits(min)} ~ ${formatCredits(max)} 的整数积分`;
  }
  if (raw < min) return `最低充值 ${formatCredits(min)} 积分`;
  if (raw > max) return `最高充值 ${formatCredits(max)} 积分`;
  if (step > 1 && (raw - min) % step !== 0) {
    return `积分数量须为 ${formatCredits(step)} 的整数倍`;
  }
  return null;
}

export function formatPriceLabel(credits: number, creditsPerYuan: number): string {
  return `¥${formatPriceYuan(customPriceFen(credits, creditsPerYuan))}`;
}
