/* ============================================
 * 管理端 API：仪表盘统计（`GET /api/admin/dashboard`）
 *
 * 区间是**北京时间的自然日、含首尾**（后端口径见 `backend/libs/shared/dashboard/dashboard-range.ts`），
 * 上限 30 天。这里也拦一道上限，但那是**体验**——别让用户选完才被拒；
 * 权威在后端：直接打 API 的人绕不过去。
 * ============================================ */
import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from './http';

/** 与后端 `DASHBOARD_MAX_RANGE_DAYS` 一致。改一处必须改另一处。 */
export const DASHBOARD_MAX_RANGE_DAYS = 30;

/** 某个任务类型在区间内的任务数。 */
export interface DashboardJobTypeCount {
  /** `generation_jobs.type` 原值（自由文本，可能是前端没收录的新类型） */
  type: string;
  count: number;
}

export interface DashboardStats {
  /** 区间起止自然日（`YYYY-MM-DD`，北京时间），原样回显 */
  from: string;
  to: string;
  totalUsers: number;
  /** 区间内任务数。**也是 `jobTypeCounts` 占比的分母**（后端由同一份分组结果求和得出） */
  totalJobs: number;
  /**
   * 区间内已结算的实际消耗积分。
   *
   * ⚠️ `null` = **计费服务取不到**，与 `0` 是两件事：0 的意思是「这段时间确实没人消费」，
   *    而取不到时我们并不知道消费了多少。界面必须让两者长得不一样。
   */
  totalUsedCredits: number | null;
  /** 区间内已到账订单发放的积分（按档位**原价**派生，折扣是让利、不少给积分） */
  totalRechargeCredits: number;
  /** 区间内已到账订单的**实付**金额合计，单位**分**（不是元、不是积分） */
  totalRevenueFen: number;
  /** 按任务类型分组，任务数降序。空区间为 `[]` */
  jobTypeCounts: DashboardJobTypeCount[];
}

/** 查询区间（`YYYY-MM-DD`，北京时间自然日，含首尾）。 */
export interface DashboardRangeQuery {
  from: string;
  to: string;
}

export const adminDashboardKeys = {
  all: ['admin-dashboard'] as const,
  stats: (range: DashboardRangeQuery) => [...adminDashboardKeys.all, range] as const,
};

export function fetchAdminDashboard(range: DashboardRangeQuery): Promise<DashboardStats> {
  const qs = new URLSearchParams({ from: range.from, to: range.to });
  return apiRequest<DashboardStats>(`/api/admin/dashboard?${qs.toString()}`, {
    silent: true,
  });
}

export function adminDashboardOptions(range: DashboardRangeQuery) {
  return queryOptions({
    queryKey: adminDashboardKeys.stats(range),
    queryFn: () => fetchAdminDashboard(range),
  });
}

/* ---------- 区间的本地校验与工具 ---------- */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` → UTC 毫秒（只用来算天数差，与展示无关）。非法返回 NaN。 */
function dayNumber(day: string): number {
  if (!DAY_RE.test(day)) return Number.NaN;
  const parsed = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

/**
 * 区间覆盖的自然日数量（**含首尾**）；任一端非法返回 NaN。
 *
 * <p>按 `YYYY-MM-DD` 的**字符串**做 UTC 解析：两端的时区偏移相同，差值就是准确的天数。
 */
export function rangeDays(from: string, to: string): number {
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * 区间校验，返回一句中文错误；合法时返回空串（没有错误）。
 *
 * <p>与后端 `resolveDashboardRange` 同口径、同文案风格——**两处一起改**。
 * 前端这一道只为「别让用户选完才被拒」，不是权威。
 */
export function validateRange(from: string, to: string): string {
  if (!from || !to) return '请选择起止日期';
  const days = rangeDays(from, to);
  if (Number.isNaN(days)) return '日期格式不正确';
  if (days < 1) return '起始日期不能晚于结束日期';
  if (days > DASHBOARD_MAX_RANGE_DAYS) {
    return `查询区间最多 ${DASHBOARD_MAX_RANGE_DAYS} 天，当前为 ${days} 天`;
  }
  return '';
}

/** 北京时间的今天（`YYYY-MM-DD`）。固定 +08:00，与后端 `beijingDayOf` 同一口径。 */
export function beijingToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
