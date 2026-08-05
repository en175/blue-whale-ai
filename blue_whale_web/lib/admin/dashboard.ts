/**
 * 仪表板统计聚合（IK6JXI 契约 3.3 / 4.6）。
 *
 * 口径说明（与契约一致）：
 * - totalUsers：GET /api/user（page=1,page_size=1）的 total；
 * - todayRecharge / todayRechargeCount：从最新向旧分页扫描 topups，
 *   统计 create_time 落在今日零点后的记录；todayRecharge 取 TopUp.amount 汇总
 *   （与订单列表 amount 同口径，new-api 无换算后积分字段）；
 * - todaySpend：GET /api/log/stat（type=2 消费）今日区间 quota；
 * - pendingOrders：同一扫描中累计 status=pending 的记录数
 *   （扫描口径：遇连续一页既无当日记录也无 pending 记录即停止，上限 MAX_PAGES 页，
 *    极端历史 pending 可能低估，属实用折中）；
 * - recentRecharges：topups 倒序前 5；recentConsumes：logs 倒序前 5。
 */

import type {
  NewApiAdminTopUpRow,
  NewApiAdminUserRow,
  NewApiLogRow,
  NewApiLogStat,
  NewApiPageInfo,
} from "@blue-whale/core";

import { mapAdminOrder, mapConsumeRecord } from "./mapper";
import type { DashboardStats } from "./types";

/** 仪表板依赖端口：仅需 client 的子集，便于单测注入替身。 */
export interface AdminDashboardClient {
  listAdminUsers(
    token: string,
    options?: {
      keyword?: string;
      status?: number;
      role?: number;
      page?: number;
      pageSize?: number;
    },
  ): Promise<NewApiPageInfo<NewApiAdminUserRow>>;
  listAdminTopUps(
    token: string,
    options?: { keyword?: string; page?: number; pageSize?: number },
  ): Promise<NewApiPageInfo<NewApiAdminTopUpRow>>;
  getAdminLogStat(
    token: string,
    input: { type: number; startTimestamp: number; endTimestamp: number },
  ): Promise<NewApiLogStat>;
  listAdminLogs(
    token: string,
    options?: { page?: number; pageSize?: number },
  ): Promise<NewApiPageInfo<NewApiLogRow>>;
}

const SCAN_PAGE_SIZE = 100;
const MAX_SCAN_PAGES = 50;

export async function collectDashboardStats(
  client: AdminDashboardClient,
  token: string,
): Promise<DashboardStats> {
  const now = Date.now();
  const todayStartSec = Math.floor(
    new Date(new Date(now).setHours(0, 0, 0, 0)).getTime() / 1000,
  );
  const nowSec = Math.floor(now / 1000);

  const [usersPage, logStat, recentLogs] = await Promise.all([
    client.listAdminUsers(token, { page: 1, pageSize: 1 }),
    client.getAdminLogStat(token, {
      type: 2,
      startTimestamp: todayStartSec,
      endTimestamp: nowSec,
    }),
    client.listAdminLogs(token, { page: 1, pageSize: 5 }),
  ]);

  let todayRecharge = 0;
  let todayRechargeCount = 0;
  let pendingOrders = 0;
  const recentRecharges = [];

  for (let page = 1; page <= MAX_SCAN_PAGES; page++) {
    const topUpsPage = await client.listAdminTopUps(token, {
      page,
      pageSize: SCAN_PAGE_SIZE,
    });
    const rows = topUpsPage.items;
    let pageHasTarget = false;

    for (const row of rows) {
      if (recentRecharges.length < 5) {
        recentRecharges.push(mapAdminOrder(row));
      }
      if (row.status === "pending") {
        pendingOrders++;
        pageHasTarget = true;
      }
      if ((row.create_time ?? 0) >= todayStartSec) {
        todayRecharge += row.amount ?? 0;
        todayRechargeCount++;
        pageHasTarget = true;
      }
    }

    if (rows.length === 0 || !pageHasTarget) break;
  }

  return {
    totalUsers: usersPage.total,
    todayRecharge,
    todayRechargeCount,
    todaySpend: logStat.quota,
    pendingOrders,
    recentRecharges,
    recentConsumes: recentLogs.items.map(mapConsumeRecord),
  };
}
