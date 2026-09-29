/* ============================================
 * 自定义充值配置（PRD §10.3）的表单状态与校验。
 *
 * 从 index.tsx 拆出来：字段多、校验规则与**服务端逐条对应**，这两件事都该能被单测
 * 直接钉住，而不是混在版面代码里。页面只描述结构。
 *
 * ⚠️ 这里的校验是**服务端的镜像**（`backend/libs/shared/recharge-custom/constants.ts`
 *    的 `validateCustomConfig`），文案也照抄 —— 前端先拦一道只是为了不用等一个来回，
 *    不是替代服务端。两处都校验，是因为谁都不想看到「点了保存、转一圈、
 *    报一个自己早就能看出来的错」。规则若改了，必须两边一起改。
 * ============================================ */
import type { TopupTierPermission } from '@/api/adminTopupTiers';
import type {
  AdminRechargeCustomConfig,
  SaveRechargeCustomConfigParams,
} from '@/api/adminRechargeCustomConfig';

/** 服务端接受的无权限提示长度上限（与 DDL 列宽、controller 三处同口径）。 */
export const MAX_DENIED_HINT_LENGTH = 255;

/** 有效期（月）区间，与服务端 `parseCreditsValidMonths` 同口径。 */
export const MIN_CREDITS_VALID_MONTHS = 1;
export const MAX_CREDITS_VALID_MONTHS = 1200;

/**
 * 表单状态：数字一律存**文字**，提交时才解析成整数。
 *
 * <p>存字符串是因为空框要报错，而 `Number('')` 是 0 —— 它会悄悄通过「正整数」这一关。
 */
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

/** 接口记录 → 表单（全部转成字符串，供输入框直接吃） */
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

/** 空框 → NaN（不是 0）；其余按十进制解析。 */
function num(raw: string): number {
  return raw.trim() === '' ? NaN : Number(raw);
}

/** 本地校验：非法返回文案（照抄服务端那一句），合法返回 null。 */
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

  // 整除：上下限与默认值都要能被换算率整除，价格才是整分
  for (const [label, value] of [
    ['最低积分', minCredits],
    ['最高积分', maxCredits],
    ['默认积分', defaultCredits],
  ] as const) {
    if (value % creditsPerYuan !== 0) {
      return `${label} ${value} 不能被每元积分数 ${creditsPerYuan} 整除（PRD §7.1：上下限与默认值需能被换算比例整除）`;
    }
  }

  // 步长对齐：滑杆必须真能推到两端（推不到时界面上「最高 499,995」那句话就是假的）
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
    // 存进白名单的必须是十进制 userId：一个错字就是一条永远匹配不上的规则
    if (!/^\d{1,19}$/.test(id)) return `白名单里的「${id}」不是合法的 userId`;
  }
  return null;
}

/**
 * 表单 → 保存入参。
 *
 * <p>⚠️ 只在 {@link validateCustomConfigForm} 通过后调用（它保证这里取到的都是整数）。
 * 提交**整份**而不是只提交改动过的键：这一页是「一屏配完再保存」的形态，与档位那种
 * 逐行编辑不同 —— 服务端也接受整份（部分是允许的，整份是它的子集）。
 */
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

/**
 * 整除校验的**预检**（每次输入都跑）：返回第一条会挡住保存的问题，没问题返回 null。
 *
 * <p>与 `validateCustomConfigForm` 分开是因为**报错的时机不同**：保存时要说清「哪一条不满足」，
 * 输入过程中只该安静提示「这样存不下去」。用同一份规则，不重复实现。
 */
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
