import type { RechargeCustomConfigView } from "@lib/shared/persistence/index.js";
import {
  canPurchaseByPermission,
  parseNonNegativeInt,
  parseTierAllowlist,
  parseTierPermission,
} from "@lib/shared/topup-tier/constants.js";

export {
  parseTierAllowlist as parseCustomPermissionAllowlist,
  parseTierPermission as parseCustomPermission,
};

export const DEFAULT_PERMISSION_DENIED_HINT = "当前账号暂不可购买自定义充值";

export function customPriceFen(credits: number, creditsPerYuan: number): number {
  if (
    !Number.isFinite(credits) ||
    !Number.isFinite(creditsPerYuan) ||
    creditsPerYuan <= 0
  ) {
    throw new Error("自定义充值定价参数非法");
  }
  return Math.round((credits * 100) / creditsPerYuan);
}

export function parseCustomCredits(raw: unknown): number | null {
  const n = parseNonNegativeInt(raw);
  if (n === null || n < 1) return null;
  return n;
}

export interface CustomConfigNumbers {
  minCredits: number;
  maxCredits: number;
  defaultCredits: number;
  creditsPerYuan: number;
  stepCredits: number;
}

export function validateCustomConfig(next: CustomConfigNumbers): string | null {
  const { minCredits, maxCredits, defaultCredits, creditsPerYuan, stepCredits } = next;

  for (const [label, value] of [
    ["最低积分", minCredits],
    ["最高积分", maxCredits],
    ["默认积分", defaultCredits],
    ["每元积分数", creditsPerYuan],
    ["积分步长", stepCredits],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      return `${label}须为 1 以上的整数`;
    }
  }
  if (maxCredits < minCredits) return "最高积分不得低于最低积分";
  if (defaultCredits < minCredits || defaultCredits > maxCredits) {
    return "默认积分须落在最低积分与最高积分之间";
  }

  for (const [label, value] of [
    ["最低积分", minCredits],
    ["最高积分", maxCredits],
    ["默认积分", defaultCredits],
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

  return null;
}

export function canPurchaseCustom(
  config: Pick<RechargeCustomConfigView, "permission" | "permissionAllowlist">,
  userId: number,
): boolean {
  return canPurchaseByPermission(config.permission, config.permissionAllowlist, userId);
}

export function customDeniedHint(
  config: Pick<RechargeCustomConfigView, "permissionDeniedHint">,
): string {
  const hint = config.permissionDeniedHint.trim();
  return hint || DEFAULT_PERMISSION_DENIED_HINT;
}
