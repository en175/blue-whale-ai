/* ============================================
 * RechargePlans 的领域映射与展示文案。
 *
 * 从 index.tsx 拆出来（页面文件撞了 max-lines 上限）：接口记录 → 页面 Plan 的映射、
 * 三态与权限的中文名、金额/积分的格式化，都是「围绕数据的」而不是「围绕版面的」。
 * 页面与两个弹窗共用同一份，避免同一句话在几处各写一份、某天只改了一处。
 * ============================================ */
import type { TopupTier, TopupTierPermission, TopupTierStatus } from '@/api/admin';
import { DEFAULT_BUTTON_TEXT, DEFAULT_CREDITS_VALID_MONTHS } from './tierForm';

/** 档位数据（列表源 GET /api/admin/topup-tiers） */
export interface Plan {
  id: string;
  name: string; // 档位名称（可空）
  price: number; // 原价（元），与折扣一起构成划线价，**不参与积分计算**
  ratio: number; // 折扣比例 (0-1]，1 = 无折扣
  pay: number; // 实付（元）= 原价 × 折扣，后端权威值
  /**
   * 基础积分：用户下单到账的积分。**运营配置的值，不是派生值**
   * （后端 `topup_tiers.base_credits`；充值常有折扣，¥499 给 7,500 而不是 7,485）。
   */
  baseCredits: number;
  recommended: boolean;
  start: string; // datetime-local 格式（空 = 不限）
  end: string;
  /** 三态：draft 草稿（新建默认）/ active 上架 / inactive 下架 */
  status: TopupTierStatus;
  sort: number; // sortOrder，越小越靠前
  /* ── PRD §10.2 卡片展示与首购活动 ── */
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

/**
 * 表单值：新建/编辑弹窗交给页面去提交的那一份。
 *
 * <p>「实付」（`pay`）与「排序」（`sort`）不在其中 —— 实付是 `原价 × 折扣` 派生出来的，
 * 排序走单独的排序接口。**基础积分在**：它是运营的输入（配置值），不是派生量。
 */
export type PlanFormValues = Omit<Plan, 'id' | 'pay' | 'sort'>;

/** ISO 时间转 datetime-local 输入值（本地时区） */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 接口记录 → 页面 Plan */
export function toPlan(t: TopupTier): Plan {
  return {
    id: String(t.id),
    name: t.name ?? '',
    price: t.originalPrice,
    ratio: t.discount,
    pay: t.price,
    // 老后端回包缺这一项时落到 0 = 「没配过」：列表里一眼能看见，
    // 而且 0 保存不了（服务端 400 / 表单也拦），不会被当成一个真值存下去。
    baseCredits: t.baseCredits ?? 0,
    recommended: t.isRecommended,
    start: isoToLocalInput(t.startTime),
    end: isoToLocalInput(t.endTime),
    status: t.status,
    sort: t.sortOrder,
    description: t.description ?? '',
    bonusCredits: t.bonusCredits ?? 0,
    activityTag: t.activityTag ?? '',
    // 服务端有默认值，但**别把空串当真值渲染进输入框**：存量/老后端回包缺这个字段时，
    // 空按钮文案会让运营一保存就报错，而错误根本不在他改的那一格上
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

/** 三态的中文名与色调（列表徽标与筛选共用一处，别在两处各写一份）。 */
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
