export function tierFormError(priceNum: number, ratioNum: number): string | null {
  if (!Number.isInteger(priceNum) || priceNum <= 0) return '原价须为正整数';
  if (ratioNum <= 0 || ratioNum > 1) return '折扣比例须在 (0, 1] 之间';
  return null;
}

export function baseCreditsFormError(raw: string): string | null {
  const n = raw.trim() === '' ? NaN : Number(raw);
  if (!Number.isInteger(n) || n < 1) return '基础积分须为 1 以上的整数';
  return null;
}

export const TIER_TEXT_LIMITS = {
  description: 255,
  activityTag: 64,
  buttonText: 32,
  permissionDeniedHint: 255,
} as const;

export const DEFAULT_BUTTON_TEXT = '立享加赠';

export const DEFAULT_CREDITS_VALID_MONTHS = 24;

export const MIN_CREDITS_VALID_MONTHS = 1;
export const MAX_CREDITS_VALID_MONTHS = 1200;

export interface TierCardFormValues {
  description: string;
  bonusCredits: number;
  activityTag: string;
  buttonText: string;
  firstPurchaseEligible: boolean;
  creditsValidMonths: number;
  permissionAllowlist: readonly string[];
  permissionDeniedHint: string;
}

export function tierCardFormError(values: TierCardFormValues): string | null {
  if (!values.buttonText.trim()) return '按钮文案不能为空';
  if (!Number.isInteger(values.bonusCredits) || values.bonusCredits < 0) {
    return '赠送积分须为非负整数';
  }
  if (
    !Number.isInteger(values.creditsValidMonths) ||
    values.creditsValidMonths < MIN_CREDITS_VALID_MONTHS ||
    values.creditsValidMonths > MAX_CREDITS_VALID_MONTHS
  ) {
    return `积分有效期须为 ${MIN_CREDITS_VALID_MONTHS}–${MAX_CREDITS_VALID_MONTHS} 的整数（单位：月）`;
  }
  const limited: [keyof typeof TIER_TEXT_LIMITS, string][] = [
    ['description', '卡片说明'],
    ['activityTag', '活动标签'],
    ['buttonText', '按钮文案'],
    ['permissionDeniedHint', '无权限提示'],
  ];
  for (const [field, label] of limited) {
    if (values[field].length > TIER_TEXT_LIMITS[field]) {
      return `${label}最长 ${TIER_TEXT_LIMITS[field]} 个字符`;
    }
  }
  for (const id of values.permissionAllowlist) {
    if (!/^\d{1,19}$/.test(id)) return `白名单里的「${id}」不是合法的 userId`;
  }
  return null;
}
