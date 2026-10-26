import type { Tier } from '@lib/core/identity/tier';

export type TopupTierStatus = 'draft' | 'active' | 'inactive';

export type TopupTierPermission = 'all' | 'user_group' | 'member_tier';

export const TIER_STATUS_LABEL: Record<TopupTierStatus, string> = {
  draft: '草稿',
  active: '上架',
  inactive: '下架',
};

export const TIER_STATUS_TONE: Record<TopupTierStatus, 'warning' | 'success' | 'neutral'> = {
  draft: 'warning',
  active: 'success',
  inactive: 'neutral',
};

export const TIER_PERMISSION_LABEL: Record<TopupTierPermission, string> = {
  all: '全部登录用户',
  user_group: '指定用户群',
  member_tier: '指定会员等级',
};

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

export const WEEKDAY_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' },
];

export const MEMBER_STATUS_OPTIONS = [
  { value: 'enabled', label: '启用' },
  { value: 'disabled', label: '停用' },
];

export const PROMOTION_STATUS_OPTIONS = [
  { value: 'draft', label: '草稿（不生效）' },
  { value: 'enabled', label: '启用（到点自动生效）' },
  { value: 'disabled', label: '停用' },
];
