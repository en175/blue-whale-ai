/* ============================================
 * 仪表盘查询区间：**北京时间的自然日**。
 *
 * ── 为什么要专门一个文件管这件事 ────────────────────────────────────────────
 *
 * 仪表盘要同时问三处数据，而这三处对「时间」的表达各不相同：
 *
 *   1. `generation_jobs.gmt_create`（本地库）—— 存的是**北京墙钟字面量**（ADR-0111）
 *   2. `recharge_orders.paid_at`（本地库）  —— 同上
 *   3. billing 的 `billing_cost_reservations`（另一个库、另一个进程）—— 连接串钉了
 *      `Asia/Shanghai`（见 billing 的 application.yml 与 `DbTime.ZONE`）
 *
 * 三处**必须落在同一个「今天」上**。跨零点 / 跨时区时，任一处口径偏了，表现都是
 * 「这张卡的数比那张卡少一点」——不会报错，也没人会发现。所以区间只在这里算一次，
 * 下游一律消费这里的产物。
 *
 * ── 统一到哪 ────────────────────────────────────────────────────────────────
 *
 * **统一到「北京时间的自然日」**（UTC+8），区间是**半开**的
 * `[from 00:00:00, to 次日 00:00:00)`。
 *
 * · 对本地库：Prisma 的 adapter 补丁把 `Date` 按 +08:00 写成 `DATETIME` 字面量
 *   （见 `backend/patches/@prisma__adapter-mariadb@7.9.0.patch`），所以传
 *   `new Date("2026-09-25T00:00:00+08:00")` 落库就是 `2026-09-25 00:00:00`，
 *   与 ADR-0111 的口径逐字对上。
 * · 对 billing：区间以带偏移的 RFC3339 下发，billing 侧经 `DbTime.toDb` 换算成
 *   同一个北京墙钟——它读的是同一个瞬时，写的是同一套口径。
 *
 * 半开区间（上界「次日零点」且不含）而不是 `BETWEEN` 到 `23:59:59`：DATETIME(0)
 * 只到秒，`23:59:59.5` 这种行会被 `BETWEEN ... AND '23:59:59'` 漏掉，
 * 而漏掉的那半天永远不会有人发现。
 *
 * ⚠️ 「今天」不能拿服务器本地时区算。容器里通常是 UTC，`new Date().toLocaleDateString()`
 *    在**北京时间 00:00–08:00** 之间会退回前一天——那正是这个文件存在的理由。
 * ============================================ */
import { AdminException } from "@lib/shared/errors/admin-error.js";

/** 北京时间的固定偏移。中国自 1991 年起无夏令时，固定 +08:00 即正确。 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 区间天数上限：**含首尾**最多 30 个自然日。超过即拒绝，见 {@link resolveDashboardRange}。 */
export const DASHBOARD_MAX_RANGE_DAYS = 30;

/** `YYYY-MM-DD`，且必须是真实存在的日期（`2026-02-30` 要拒，不能滚到 3 月）。 */
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DashboardRange {
  /** 起始自然日（北京时间），`YYYY-MM-DD` */
  from: string;
  /** 结束自然日（北京时间），`YYYY-MM-DD`，**含当天** */
  to: string;
  /** 区间起点瞬时 = `from` 00:00:00 北京；闭下界 */
  start: Date;
  /** 区间终点瞬时 = `to` 次日 00:00:00 北京；**开上界，不含** */
  endExclusive: Date;
}

/** 某个瞬时落在北京时间的哪一天（`YYYY-MM-DD`）。 */
export function beijingDayOf(instant: Date): string {
  return new Date(instant.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * `YYYY-MM-DD`（北京时间自然日）→ 该日零点的瞬时。
 *
 * @returns 非法或该日不存在（如 `2026-02-30`）时返回 null
 */
function beijingDayStart(day: string): Date | null {
  const m = DAY_RE.exec(day);
  if (!m) return null;
  const [, y, mo, d] = m;
  // 显式带上 +08:00：不要走 `new Date("2026-09-25")`，那按 UTC 解析，
  // 与本文件的口径差 8 小时，且正好是本文件要防的那种错。
  const parsed = new Date(`${y}-${mo}-${d}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  // 反查一遍：`2026-02-30` 这类不存在的日期会被 V8 滚成 3 月 2 日而不报错
  return beijingDayOf(parsed) === `${y}-${mo}-${d}` ? parsed : null;
}

/**
 * 解析仪表盘的查询区间。
 *
 * <p>两个参数**要么都给、要么都不给**：只给一个时「另一个是多少」有太多合理猜测
 * （给 from = 到今天？给 to = 最近 30 天？），猜错的那一半会静默地少统计一段数据。
 *
 * @param input `from` / `to` 为 `YYYY-MM-DD`（北京时间自然日）
 * @param now   当前瞬时，仅用于「都没给」时取今天；显式传入以便测试
 * @throws AdminException 400 —— 格式非法 / 起始晚于结束 / 区间超过 30 天
 */
export function resolveDashboardRange(
  input: { from?: string | undefined; to?: string | undefined },
  now: Date = new Date(),
): DashboardRange {
  const rawFrom = input.from?.trim() ?? "";
  const rawTo = input.to?.trim() ?? "";

  if (!rawFrom && !rawTo) {
    const today = beijingDayOf(now);
    // 默认「今天」= from = to = 今天，两个字段同值；不是「最近 30 天」
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
    // 反向区间返回的是空集，与「这段时间真的没有数据」在界面上长得一模一样
    throw new AdminException(400, `起始日期不能晚于结束日期：${from} > ${to}`);
  }

  // 含首尾的自然日数量。两端都取北京零点，差值必是整天数，不受时分秒影响。
  const days = Math.round((endDayStart.getTime() - start.getTime()) / MS_PER_DAY) + 1;
  if (days > DASHBOARD_MAX_RANGE_DAYS) {
    // ⚠️ **拒绝**而不是静默截断成最近 30 天：截断后用户看到的是一组「只统计了一部分」
    //    的数，而界面上没有任何东西提示它不完整——那是标准的「不报错的错答案」。
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

/** 本地库的 Prisma 时间条件（本地 `DATETIME` 列存北京墙钟字面量，见文件头）。 */
export function withinRange(range: DashboardRange): { gte: Date; lt: Date } {
  return { gte: range.start, lt: range.endExclusive };
}
