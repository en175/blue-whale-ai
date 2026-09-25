/* ============================================
 * 折扣的展示与输入口径（会员折扣页 / 限时活动页共用）
 *
 * ── 为什么单独一个文件在 admin 根下 ────────────────────────────────────────────
 *
 * 两个页面都要做同一件事：把库里的**万分比**翻译成运营认得的「折」、把等级/星期/状态
 * 翻成中文、把条件拼成一句人话。各写一份的话，最典型的分叉是「一边显示 9 折、
 * 另一边显示 0.9 折」，而两边看起来都对。
 *
 * ── 单位：界面按「折」，库里存万分比 ──────────────────────────────────────────
 *
 * 与「模型计费按元编辑」同一条纪律：运营手上的是「打 9 折」，不是 9000。
 * 让他对着 9000 填，既认不出自己配的是哪一档，也容易把 9 折写成 900。
 * 所以**编辑与展示都是折**，写回接口的仍然是 `discount_bp`（万分比）——引擎与账本的单位不动。
 * ============================================ */
import type { Tier } from '@lib/core/identity/tier';

/**
 * 等级的中文名。
 *
 * ⚠️ 用 `Record<Tier, string>` 而不是 `Record<string, string>`：`Tier` 的权威定义在
 * backend 的 `libs/core/identity/tier.ts`，那边**新增一个等级**时这里会直接编译不过 ——
 * 这就是我们要的效果。写成 `Record<string, string>` 的话，新等级会安静地不出现在下拉里，
 * 而运营只会觉得「怎么没有我要的那个等级」。
 */
export const TIER_LABELS: Record<Tier, string> = {
  free: '免费',
  basic: '基础',
  pro: '专业',
  max: '旗舰',
};

/** 等级下拉项（值 + 中文名 + 原始字面值）。**不让手打等级**：写错一个 `PRO` 就是静默不打折。 */
export const TIER_OPTIONS = (Object.keys(TIER_LABELS) as Tier[]).map((tier) => ({
  value: tier,
  label: `${TIER_LABELS[tier]}（${tier}）`,
}));

export function tierLabel(tier: string): string {
  // 库里可能有历史脏值（大写、旧名），回退成原值：显示 PRO 只是不好看，显示空白没法排查
  return TIER_LABELS[tier as Tier] ?? tier;
}

/** 生效星期 [1..7]，1 = 周一（与 `DayOfWeek.getValue()` 同口径）。 */
export const WEEKDAY_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' },
];

export function weekdayLabel(day: number): string {
  return WEEKDAY_OPTIONS.find((o) => o.value === day)?.label ?? String(day);
}

/** 会员折扣的状态只有两个（长期契约，没有起止时间）。 */
export const MEMBER_STATUS_OPTIONS = [
  { value: 'enabled', label: '启用' },
  { value: 'disabled', label: '停用' },
];

/** 活动的状态。`expired` 在库里是合法值，但它是**时间走到头**的结果，不是手选的。 */
export const PROMOTION_STATUS_OPTIONS = [
  { value: 'draft', label: '草稿（不生效）' },
  { value: 'enabled', label: '启用（到点自动生效）' },
  { value: 'disabled', label: '停用' },
];

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  enabled: '启用',
  disabled: '停用',
  expired: '已过期',
  // 认不出的值原样显示：库里可能有别人手写进去的状态
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function statusTone(status: string): 'neutral' | 'success' | 'warning' {
  if (status === 'enabled') return 'success';
  if (status === 'disabled' || status === 'draft') return 'warning';
  return 'neutral';
}

/* ---------- 万分比 ↔ 折 ---------- */

/** 一万分比 = 1 折。9000 → 9 折，8500 → 8.5 折。 */
const BP_PER_ZHE = 1000;

/** 万分比 → 折的数值（用于表单回填与展示）。10000 → 10。 */
export function bpToZhe(bp: number): number {
  return bp / BP_PER_ZHE;
}

/** 折 → 万分比。允许两位小数（8.55 折），四舍五入到整数万分比。 */
export function zheToBp(zhe: number): number {
  return Math.round(zhe * BP_PER_ZHE);
}

/**
 * 折的文本 → 万分比。
 *
 * @returns 不合法返回 `null`（**不返回 0**：0 在库里是「免费」，兜底成 0 是白送）
 */
export function parseZheToBp(text: string): number | null {
  const raw = text.trim();
  if (raw === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const zhe = Number(raw);
  // 上界 10 折（原价）：大于 10 是加价，那不是折扣，该去定价目录改单价
  if (!(zhe > 0) || zhe > 10) return null;
  return zheToBp(zhe);
}

/** 「9 折」「8.5 折」；10000 显示「不打折（原价）」——那不是折扣，别写成「10 折」。 */
export function formatDiscount(bp: number): string {
  if (bp === 10_000) return '不打折（原价）';
  const zhe = bpToZhe(bp);
  // 去掉没意义的小数位：9000 → 9，8500 → 8.5，8550 → 8.55
  return `${Number(zhe.toFixed(3))} 折`;
}

/* ---------- 条件的人话 ---------- */

/** 模式集合 → 人话。null / 空 = 不限（两种表示在接口层已归一，这里再兜一次）。 */
export function describePatterns(patterns: readonly string[] | null, unlimited: string): string {
  if (patterns === null || patterns.length === 0) return unlimited;
  return patterns.join('、');
}

export function describeTiers(tiers: readonly string[] | null): string {
  if (tiers === null || tiers.length === 0) return '不限等级';
  return tiers.map(tierLabel).join('、');
}

/** 每日时段 + 星期 + 时区 → 一句话。没配时段就是全天，**必须说出来**（否则看起来像没限制）。 */
export function describeSchedule(p: {
  daysOfWeek: readonly number[] | null;
  dailyTimeStart: string | null;
  dailyTimeEnd: string | null;
  tz: string;
}): string {
  const days =
    p.daysOfWeek === null || p.daysOfWeek.length === 0
      ? '每天'
      : p.daysOfWeek.map(weekdayLabel).join('、');
  const start = shortTime(p.dailyTimeStart);
  const end = shortTime(p.dailyTimeEnd);
  // 计价侧：只要有一端为空就当全天（两个都不给才是我们要的形态，见后端的校验）
  const hours = start === null || end === null ? '全天' : `${start}–${end}`;
  return `${days} ${hours}（${p.tz}）`;
}

export function shortTime(value: string | null): string | null {
  // 库里是 `22:00:00`，界面按 `22:00` 说
  return value === null ? null : value.slice(0, 5);
}

/** `2026-10-01T00:00:00` → `2026-10-01 00:00`。空值给空串，不编造时间。 */
export function shortDateTime(value: string | null): string {
  if (!value) return '';
  return value.replace('T', ' ').slice(0, 16);
}

/* ---------- 目录级策略（只读展示） ---------- */

/**
 * 折扣叠加方式的说明。
 *
 * <p>它是**目录级配置**（在「模型计费」页改），但会直接改变这里配的活动能落到什么价，
 * 所以两个折扣页都要只读地把它摆出来。
 */
export function describeStackMode(stackMode: string): string {
  if (stackMode === 'best') {
    return 'best —— 会员折扣与活动取优，不叠加';
  }
  return 'multiply —— 会员再享活动，两个系数相乘';
}

/** 底线的人话：3000 → 「3 折」；10000 → 「不打折」。 */
export function describeFloor(floorFactorBp: number): string {
  if (floorFactorBp === 10_000) return '不打折（10000）—— 等于不设底线';
  return `${formatDiscount(floorFactorBp)}（${floorFactorBp}）`;
}

/**
 * 会员折扣与活动叠加后的**最坏情况**提示。
 *
 * <p>运营在两张表里各配一个折扣时，没人会心算乘积：8 折 × 7 折 = 5.6 折。
 * 这个函数只负责把这句算给运营看，真正的兜底在计价侧（`CompositeDiscountResolver`）。
 */
export function combineFactors(a: number, b: number, stackMode: string): number {
  if (stackMode === 'best') return Math.min(a, b);
  return Math.round((a * b) / 10_000);
}
