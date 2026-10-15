import type { TopupTierPermission } from '@/admin/api/adminTopupTiers';
import type {
  AdminRechargeCustomConfig,
  SaveRechargeCustomConfigParams,
} from '@/admin/api/adminRechargeCustomConfig';

export const MAX_DENIED_HINT_LENGTH = 255;

export const MIN_CREDITS_VALID_MONTHS = 1;
export const MAX_CREDITS_VALID_MONTHS = 1200;

export interface CustomConfigForm {
  minCredits: string;
  maxCredits: string;
  defaultCredits: string;
  creditsPerYuan: string;
  stepCredits: string;
  creditsValidMonths: string;
  enabled: boolean;
  permission: TopupTierPermission;
  permissionAllowlist: string[];
  permissionDeniedHint: string;
}

export function formFromConfig(config: AdminRechargeCustomConfig): CustomConfigForm {
  return {
    minCredits: String(config.minCredits),
    maxCredits: String(config.maxCredits),
    defaultCredits: String(config.defaultCredits),
    creditsPerYuan: String(config.creditsPerYuan),
    stepCredits: String(config.stepCredits),
    creditsValidMonths: String(config.creditsValidMonths),
    enabled: config.enabled,
    permission: config.permission,
    permissionAllowlist: [...config.permissionAllowlist],
    permissionDeniedHint: config.permissionDeniedHint,
  };
}

function num(raw: string): number {
  return raw.trim() === '' ? NaN : Number(raw);
}

export function validateCustomConfigForm(form: CustomConfigForm): string | null {
  const minCredits = num(form.minCredits);
  const maxCredits = num(form.maxCredits);
  const defaultCredits = num(form.defaultCredits);
  const creditsPerYuan = num(form.creditsPerYuan);
  const stepCredits = num(form.stepCredits);
  const months = num(form.creditsValidMonths);

  for (const [label, value] of [
    ['最低积分', minCredits],
    ['最高积分', maxCredits],
    ['默认积分', defaultCredits],
    ['每元积分数', creditsPerYuan],
    ['积分步长', stepCredits],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) return `${label}须为 1 以上的整数`;
  }
  if (maxCredits < minCredits) return '最高积分不得低于最低积分';
  if (defaultCredits < minCredits || defaultCredits > maxCredits) {
    return '默认积分须落在最低积分与最高积分之间';
  }

  for (const [label, value] of [
    ['最低积分', minCredits],
    ['最高积分', maxCredits],
    ['默认积分', defaultCredits],
  ] as const) {
    if (value % creditsPerYuan !== 0) {
      return `${label} ${value} 不能被每元积分数 ${creditsPerYuan} 整除（PRD §7.1：上下限与默认值需能被换算比例整除）`;
    }
  }

  if ((maxCredits - minCredits) % stepCredits !== 0) {
    return `最高积分与最低积分之差（${maxCredits - minCredits}）必须是积分步长 ${stepCredits} 的整数倍，否则滑杆推不到最高值`;
  }
  if ((defaultCredits - minCredits) % stepCredits !== 0) {
    return `默认积分与最低积分之差（${defaultCredits - minCredits}）必须是积分步长 ${stepCredits} 的整数倍，否则默认值不在滑杆的格点上`;
  }

  if (!Number.isInteger(months) || months < MIN_CREDITS_VALID_MONTHS || months > MAX_CREDITS_VALID_MONTHS) {
    return `积分有效期须为 ${MIN_CREDITS_VALID_MONTHS}–${MAX_CREDITS_VALID_MONTHS} 的整数（单位：月）`;
  }
  if (form.permissionDeniedHint.length > MAX_DENIED_HINT_LENGTH) {
    return `无权限提示最长 ${MAX_DENIED_HINT_LENGTH} 个字符`;
  }
  for (const id of form.permissionAllowlist) {
    if (!/^\d{1,19}$/.test(id)) return `白名单里的「${id}」不是合法的 userId`;
  }
  return null;
}

export function toSaveParams(form: CustomConfigForm): SaveRechargeCustomConfigParams {
  return {
    minCredits: num(form.minCredits),
    maxCredits: num(form.maxCredits),
    defaultCredits: num(form.defaultCredits),
    creditsPerYuan: num(form.creditsPerYuan),
    stepCredits: num(form.stepCredits),
    creditsValidMonths: num(form.creditsValidMonths),
    enabled: form.enabled,
    permission: form.permission,
    permissionAllowlist: form.permissionAllowlist,
    permissionDeniedHint: form.permissionDeniedHint.trim(),
  };
}

export function previewIssue(form: CustomConfigForm): string | null {
  const minCredits = num(form.minCredits);
  const maxCredits = num(form.maxCredits);
  const defaultCredits = num(form.defaultCredits);
  const creditsPerYuan = num(form.creditsPerYuan);
  const stepCredits = num(form.stepCredits);
  if (
    !Number.isInteger(minCredits) ||
    !Number.isInteger(maxCredits) ||
    !Number.isInteger(defaultCredits) ||
    !Number.isInteger(creditsPerYuan) ||
    !Number.isInteger(stepCredits) ||
    minCredits < 1 ||
    maxCredits < 1 ||
    defaultCredits < 1 ||
    creditsPerYuan < 1 ||
    stepCredits < 1
  ) {
    return null;
  }
  if (maxCredits < minCredits) return '最高积分低于最低积分';
  if (defaultCredits < minCredits || defaultCredits > maxCredits) {
    return '默认积分不在上下限之间';
  }
  if (minCredits % creditsPerYuan !== 0) return '最低积分不能被每元积分数整除';
  if (maxCredits % creditsPerYuan !== 0) return '最高积分不能被每元积分数整除';
  if (defaultCredits % creditsPerYuan !== 0) return '默认积分不能被每元积分数整除';
  if ((maxCredits - minCredits) % stepCredits !== 0) return '最高值不在步长格点上（滑杆推不到）';
  if ((defaultCredits - minCredits) % stepCredits !== 0) return '默认值不在步长格点上';
  return null;
}
