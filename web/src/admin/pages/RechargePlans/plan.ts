import type { TopupTier, TopupTierPermission, TopupTierStatus } from '@/admin/api/adminTopupTiers';
import { DEFAULT_BUTTON_TEXT, DEFAULT_CREDITS_VALID_MONTHS } from './tierForm';

export interface Plan {
  id: string;
  name: string;
  price: number;
  ratio: number;
  pay: number;
  baseCredits: number;
  recommended: boolean;
  start: string;
  end: string;
  status: TopupTierStatus;
  sort: number;
  description: string;
  bonusCredits: number;
  activityTag: string;
  buttonText: string;
  firstPurchaseEligible: boolean;
  creditsValidMonths: number;
  permission: TopupTierPermission;
  allowlist: string[];
  deniedHint: string;
}

export type PlanFormValues = Omit<Plan, 'id' | 'pay' | 'sort'>;

export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toPlan(t: TopupTier): Plan {
  return {
    id: String(t.id),
    name: t.name ?? '',
    price: t.originalPrice,
    ratio: t.discount,
    pay: t.price,
    baseCredits: t.baseCredits ?? 0,
    recommended: t.isRecommended,
    start: isoToLocalInput(t.startTime),
    end: isoToLocalInput(t.endTime),
    status: t.status,
    sort: t.sortOrder,
    description: t.description ?? '',
    bonusCredits: t.bonusCredits ?? 0,
    activityTag: t.activityTag ?? '',
    buttonText: t.buttonText || DEFAULT_BUTTON_TEXT,
    firstPurchaseEligible: t.firstPurchaseEligible ?? false,
    creditsValidMonths: t.creditsValidMonths ?? DEFAULT_CREDITS_VALID_MONTHS,
    permission: t.permission ?? 'all',
    allowlist: t.permissionAllowlist ?? [],
    deniedHint: t.permissionDeniedHint ?? '',
  };
}

export const fmtMoney = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
export const fmtPoints = (n: number) => n.toLocaleString('en-US');
export const discountLabel = (ratio: number) =>
  `${parseFloat((ratio * 10).toFixed(2))}折`;

export const TIER_STATUS_LABEL: Record<TopupTierStatus, string> = {
  draft: '草稿',
  active: '上架',
  inactive: '下架',
};
export const TIER_STATUS_TONE: Record<
  TopupTierStatus,
  'warning' | 'success' | 'neutral'
> = {
  draft: 'warning',
  active: 'success',
  inactive: 'neutral',
};

export const TIER_PERMISSION_LABEL: Record<TopupTierPermission, string> = {
  all: '全部登录用户',
  user_group: '指定用户群',
  member_tier: '指定会员等级',
};
