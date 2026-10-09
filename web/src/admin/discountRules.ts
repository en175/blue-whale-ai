import type { Tier } from '@lib/core/identity/tier';

export const TIER_LABELS: Record<Tier, string> = {
  free: '免费',
  basic: '基础',
  pro: '专业',
  max: '旗舰',
};

export const TIER_OPTIONS = (Object.keys(TIER_LABELS) as Tier[]).map((tier) => ({
  value: tier,
  label: `${TIER_LABELS[tier]}（${tier}）`,
}));

export function tierLabel(tier: string): string {
  return TIER_LABELS[tier as Tier] ?? tier;
}

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

export const MEMBER_STATUS_OPTIONS = [
  { value: 'enabled', label: '启用' },
  { value: 'disabled', label: '停用' },
];

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
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function statusTone(status: string): 'neutral' | 'success' | 'warning' {
  if (status === 'enabled') return 'success';
  if (status === 'disabled' || status === 'draft') return 'warning';
  return 'neutral';
}


const BP_PER_ZHE = 1000;

export function bpToZhe(bp: number): number {
  return bp / BP_PER_ZHE;
}

export function zheToBp(zhe: number): number {
  return Math.round(zhe * BP_PER_ZHE);
}

export function parseZheToBp(text: string): number | null {
  const raw = text.trim();
  if (raw === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const zhe = Number(raw);
  if (!(zhe > 0) || zhe > 10) return null;
  return zheToBp(zhe);
}

export function formatDiscount(bp: number): string {
  if (bp === 10_000) return '不打折（原价）';
  const zhe = bpToZhe(bp);
  return `${Number(zhe.toFixed(3))} 折`;
}


export function describePatterns(patterns: readonly string[] | null, unlimited: string): string {
  if (patterns === null || patterns.length === 0) return unlimited;
  return patterns.join('、');
}

export function describeTiers(tiers: readonly string[] | null): string {
  if (tiers === null || tiers.length === 0) return '不限等级';
  return tiers.map(tierLabel).join('、');
}

export function describeSchedule(p: {
  daysOfWeek: readonly number[] | null;
  dailyTimeStart: string | null;
  dailyTimeEnd: string | null;
}): string {
  const days =
    p.daysOfWeek === null || p.daysOfWeek.length === 0
      ? '每天'
      : p.daysOfWeek.map(weekdayLabel).join('、');
  const start = shortTime(p.dailyTimeStart);
  const end = shortTime(p.dailyTimeEnd);
  const hours = start === null || end === null ? '全天' : `${start}–${end}`;
  return `${days} ${hours}`;
}

export function shortTime(value: string | null): string | null {
  return value === null ? null : value.slice(0, 5);
}

export function shortDateTime(value: string | null): string {
  if (!value) return '';
  return value.replace('T', ' ').slice(0, 16);
}


export function describeStackMode(stackMode: string): string {
  if (stackMode === 'best') {
    return 'best —— 会员折扣与活动取优，不叠加';
  }
  return 'multiply —— 会员再享活动，两个系数相乘';
}

export function describeFloor(floorFactorBp: number): string {
  if (floorFactorBp === 10_000) return '不打折（10000）—— 等于不设底线';
  return `${formatDiscount(floorFactorBp)}（${floorFactorBp}）`;
}

export function combineFactors(a: number, b: number, stackMode: string): number {
  if (stackMode === 'best') return Math.min(a, b);
  return Math.round((a * b) / 10_000);
}
