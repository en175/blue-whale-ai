import { AccountService } from "./account.service.js";
import { quotaToCredits } from "@lib/shared/credits/credits.js";
import {
  mapAdminOrder,
  mapConsumeRecord,
  type AdminOrder,
  type ConsumeRecord,
} from "./admin-mapper.js";

export type DashboardStats = {
  totalUsers: number;
  todayRecharge: number;
  todayRechargeCount: number;
  todaySpend: number;
  pendingOrders: number;
  recentRecharges: AdminOrder[];
  recentConsumes: ConsumeRecord[];
};

const SCAN_PAGE_SIZE = 100;
const MAX_SCAN_PAGES = 50;

export async function collectDashboardStats(
  account: AccountService,
  token: string,
  userId: number,
): Promise<DashboardStats> {
  const now = Date.now();
  const todayStartSec = Math.floor(
    new Date(new Date(now).setHours(0, 0, 0, 0)).getTime() / 1000,
  );
  const nowSec = Math.floor(now / 1000);

  const [usersPage, logStat, recentLogs] = await Promise.all([
    account.listAdminUsers(token, userId, { page: 1, pageSize: 1 }),
    account.getAdminLogStat(token, userId, {
      type: 2,
      startTimestamp: todayStartSec,
      endTimestamp: nowSec,
    }),
    account.listAdminLogs(token, userId, { page: 1, pageSize: 5 }),
  ]);

  let todayRecharge = 0;
  let todayRechargeCount = 0;
  let pendingOrders = 0;
  const recentRecharges: AdminOrder[] = [];

  for (let page = 1; page <= MAX_SCAN_PAGES; page++) {
    const topUpsPage = await account.listAdminTopUps(token, userId, {
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
        // IK9VZ0：topup amount 为 quota 量纲，今日充值展示统一换算为积分。
        todayRecharge += quotaToCredits(row.amount ?? 0);
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
    // IK9VZ0：logStat.quota 为 quota 量纲，今日消费展示统一换算为积分。
    todaySpend: quotaToCredits(logStat.quota),
    pendingOrders,
    recentRecharges,
    recentConsumes: recentLogs.items.map(mapConsumeRecord),
  };
}
