import { AdminException } from "@lib/shared/errors/admin-error.js";

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const DASHBOARD_MAX_RANGE_DAYS = 30;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DashboardRange {
  from: string;
  to: string;
  start: Date;
  endExclusive: Date;
}

export function beijingDayOf(instant: Date): string {
  return new Date(instant.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

function beijingDayStart(day: string): Date | null {
  const m = DAY_RE.exec(day);
  if (!m) return null;
  const [, y, mo, d] = m;
  const parsed = new Date(`${y}-${mo}-${d}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return beijingDayOf(parsed) === `${y}-${mo}-${d}` ? parsed : null;
}

export function resolveDashboardRange(
  input: { from?: string | undefined; to?: string | undefined },
  now: Date = new Date(),
): DashboardRange {
  const rawFrom = input.from?.trim() ?? "";
  const rawTo = input.to?.trim() ?? "";

  if (!rawFrom && !rawTo) {
    const today = beijingDayOf(now);
    return build(today, today);
  }
  if (!rawFrom || !rawTo) {
    throw new AdminException(400, "查询区间必须同时给出 from 与 to（或都不给，默认今天）");
  }
  return build(rawFrom, rawTo);
}

function build(from: string, to: string): DashboardRange {
  const start = beijingDayStart(from);
  if (!start) {
    throw new AdminException(400, `from 不是合法的日期（须为 YYYY-MM-DD）：${from}`);
  }
  const endDayStart = beijingDayStart(to);
  if (!endDayStart) {
    throw new AdminException(400, `to 不是合法的日期（须为 YYYY-MM-DD）：${to}`);
  }
  if (endDayStart.getTime() < start.getTime()) {
    throw new AdminException(400, `起始日期不能晚于结束日期：${from} > ${to}`);
  }

  const days = Math.round((endDayStart.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  if (days > DASHBOARD_MAX_RANGE_DAYS) {
    throw new AdminException(
      400,
      `查询区间最多 ${DASHBOARD_MAX_RANGE_DAYS} 天，当前为 ${days} 天：请缩小范围后重试`,
    );
  }

  return {
    from,
    to,
    start,
    endExclusive: new Date(endDayStart.getTime() + MS_PER_DAY),
  };
}

export function withinRange(range: DashboardRange): { gte: Date; lt: Date } {
  return { gte: range.start, lt: range.endExclusive };
}
