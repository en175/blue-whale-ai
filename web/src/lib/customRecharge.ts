/* ============================================
 * 自定义充值的取数与换算（模块 B，PRD §7.2 / §7.3）。
 *
 * 全是纯函数：滑杆步进、手输修正、价格展示这三件事的规则必须能被单测直接钉住。
 * 组件（`components/CustomRecharge`）只负责渲染与事件，规则都在这里。
 * ============================================ */
import type { RechargeCustomConfig } from '@/api/recharge';

/** 取值范围 + 换算率（从配置里摘出来，纯函数直接吃）。 */
export type CustomCreditsRule = Pick<
  RechargeCustomConfig,
  'min_credits' | 'max_credits' | 'default_credits' | 'step_credits' | 'credits_per_yuan'
>;

/**
 * 价格（单位**分**）= 积分数 × 100 ÷ 每元积分数，四舍五入到分。
 *
 * <p>⚠️ 必须与服务端 `customPriceFen`（`backend/libs/shared/recharge/custom/constants.ts`）
 * **逐字同一个式子**，否则会出现「界面显示 ¥40.00、下单回来 ¥40.01」。
 * 服务端那份是权威（钱由它算），这份只用于下单前的实时展示。
 *
 * <p>先乘后除：写成 `credits / creditsPerYuan * 100` 会先把价格算成一个无限小数
 * （1 ÷ 15 = 0.0666…）再放大，四舍五入之前就带上了浮点误差。
 */
export function customPriceFen(credits: number, creditsPerYuan: number): number {
  if (!Number.isFinite(credits) || !Number.isFinite(creditsPerYuan) || creditsPerYuan <= 0) {
    return 0;
  }
  return Math.round((credits * 100) / creditsPerYuan);
}

/** 分 → 展示用的元字符串：整元不带小数（¥40），带零头保留两位（¥40.07）。 */
export function formatPriceYuan(fen: number): string {
  return fen % 100 === 0 ? String(fen / 100) : (fen / 100).toFixed(2);
}

/** 千分位（积分数量动辄六位数，「499995」与「499,995」读起来的差别很大）。 */
export function formatCredits(credits: number): string {
  return credits.toLocaleString('en-US');
}

/** 把值夹进 [min, max]。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 把任意输入修正成**合法格点上的积分数**（PRD §7.3「自动修正为合法值」）。
 *
 * <p>规则：非数 → 默认值；超出范围 → 夹到边界；再吸附到「从最低值起算的步长格点」。
 *
 * <p>⚠️ 修正只发生在前端**提交之前**。服务端对不在格点上的值一律**拒绝**而不是修正 ——
 * 那意味着用户点的是「买 601 积分」、付的却是别的数的钱，而金额是支付网关核对的第一道闸。
 *
 * <p>吸附用「离哪个格点近取哪个」而不是向零取整/向上取整：用户在滑杆附近手输
 * 4996 时应拿到 4995（最近），而不是 5010。
 */
export function snapCredits(raw: number | null | undefined, rule: CustomCreditsRule): number {
  const { min_credits: min, max_credits: max, default_credits: fallback, step_credits: step } = rule;
  if (raw == null || !Number.isFinite(raw)) return clamp(fallback, min, max);
  const clamped = clamp(Math.round(raw), min, max);
  if (step <= 1) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  return clamp(snapped, min, max);
}

/**
 * 校验并给出提示（PRD §7.3「输入低于/高于……提示最低/最高充值积分」）。
 *
 * <p>返回 null = 合法可提交。**文案里带上具体数字**：只说「超出范围」用户不知道该改成多少。
 */
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

/** 价格展示串（`¥40` / `¥40.07`）。 */
export function formatPriceLabel(credits: number, creditsPerYuan: number): string {
  return `¥${formatPriceYuan(customPriceFen(credits, creditsPerYuan))}`;
}
