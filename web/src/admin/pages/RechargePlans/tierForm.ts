/** 档位表单本地校验：原价正整数、折扣 ∈ (0, 1]。非法返回文案，合法返回 null。 */
export function tierFormError(priceNum: number, ratioNum: number): string | null {
  if (!Number.isInteger(priceNum) || priceNum <= 0) return '原价须为正整数';
  if (ratioNum <= 0 || ratioNum > 1) return '折扣比例须在 (0, 1] 之间';
  return null;
}

/** 列宽上限，与服务端同名常量、与 DDL 的列宽**三处同口径**（超了服务端会 400）。 */
export const TIER_TEXT_LIMITS = {
  description: 255,
  activityTag: 64,
  buttonText: 32,
  permissionDeniedHint: 255,
} as const;

/** 按钮文案默认值（PRD §10.2「默认『立享加赠』」）。 */
export const DEFAULT_BUTTON_TEXT = '立享加赠';

/** 积分有效期（月）的默认值：2 年（PRD §10.2）。 */
export const DEFAULT_CREDITS_VALID_MONTHS = 24;

/** 服务端接受的积分有效期区间（月）。 */
export const MIN_CREDITS_VALID_MONTHS = 1;
export const MAX_CREDITS_VALID_MONTHS = 1200;

/** PRD §10.2 卡片字段的表单值。 */
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

/**
 * 卡片字段（PRD §10.2）的本地校验：非法返回文案，合法返回 null。
 *
 * <p>规则与服务端 `readCardFields` 一一对应：**前端先拦一道只是为了不用等一个来回**，
 * 不是为了替代服务端 —— 两处都校验，是因为谁都不想看到「点了保存、转一圈、
 * 报一个自己早就能看出来的错」。
 *
 * <p>⚠️ 按钮文案按 PRD §10.2 是**必填**：空按钮在用户侧就是一个点不出名字的控件。
 * 其余文本列选填，空串即「未填」。
 */
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
    // TagInput 只收非空 tag，但「非空」不等于「是个 userId」——
    // 存进白名单的必须是十进制 id，一个错字就是一条永远匹配不上的规则
    if (!/^\d{1,19}$/.test(id)) return `白名单里的「${id}」不是合法的 userId`;
  }
  return null;
}
