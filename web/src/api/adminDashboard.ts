import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from './http';

export const DASHBOARD_MAX_RANGE_DAYS = 30;

export interface DashboardJobTypeCount {
  type: string;
  count: number;
}

export interface DashboardStats {
  from: string;
  to: string;
  totalUsers: number;
  totalJobs: number;
  totalUsedCredits: number | null;
  totalRechargeCredits: number;
  totalRevenueFen: number;
  jobTypeCounts: DashboardJobTypeCount[];
}

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


const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayNumber(day: string): number {
  if (!DAY_RE.test(day)) return Number.NaN;
  const parsed = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

export function rangeDays(from: string, to: string): number {
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000) + 1;
}

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

export function beijingToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
