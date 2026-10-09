import {
  readCreditsPerYuan,
  readDiscountPolicy,
  type CatalogDocumentJson,
} from '../../lib/billing-catalog/catalogDraft';

export const MIN_CREDITS_PER_YUAN = 1;
export const MAX_CREDITS_PER_YUAN = 100_000;

export const MAX_FLOOR_FACTOR_BP = 10_000;

const WHOLE_NUMBER = /^\d+$/;

export function creditsPerYuanError(text: string): string | null {
  const raw = text.trim();
  if (!WHOLE_NUMBER.test(raw)) {
    return '换算率必须是正整数（1 元等于多少积分，如 15）';
  }
  const value = Number(raw);
  if (value < MIN_CREDITS_PER_YUAN || value > MAX_CREDITS_PER_YUAN) {
    return `creditsPerYuan=${value} 不合法：它表示「1 元等于多少积分」，合法范围 ${MIN_CREDITS_PER_YUAN} ~ ${MAX_CREDITS_PER_YUAN}（超过上界说明多半是多敲了 0）`;
  }
  return null;
}

export function floorFactorBpError(text: string): string | null {
  const raw = text.trim();
  if (!WHOLE_NUMBER.test(raw)) {
    return '折扣底线必须是整数（万分比：3000 = 3 折，10000 = 不打折）';
  }
  const value = Number(raw);
  if (value < 1) {
    return '折扣底线必须大于 0（万分比：3000 = 3 折，10000 = 不打折）';
  }
  if (value > MAX_FLOOR_FACTOR_BP) {
    return `折扣底线不能超过 ${MAX_FLOOR_FACTOR_BP}：计价侧取的是 max(折扣, 底线)，超过 ${MAX_FLOOR_FACTOR_BP} 会把折扣抬成加价`;
  }
  return null;
}

export interface SiteParams {
  creditsPerYuan: number;
  stackMode: string;
  floorFactorBp: number;
}

export function textOf(value: number | null): string {
  return value === null ? '' : String(value);
}

export function buildNote(before: CatalogDocumentJson, after: SiteParams): string {
  const beforeRate = readCreditsPerYuan(before);
  const beforePolicy = readDiscountPolicy(before);
  const changes: string[] = [];
  if (beforeRate !== after.creditsPerYuan) {
    changes.push(`换算率 ${beforeRate ?? '（空）'} → ${after.creditsPerYuan}`);
  }
  if (beforePolicy.stackMode !== after.stackMode) {
    changes.push(`折扣叠加方式 ${beforePolicy.stackMode} → ${after.stackMode}`);
  }
  if (beforePolicy.floorFactorBp !== after.floorFactorBp) {
    changes.push(`折扣底线 ${beforePolicy.floorFactorBp} → ${after.floorFactorBp}`);
  }
  return `系统设置·计费：${changes.join('；')}`;
}
