import { describe, expect, it, vi } from "vitest";

import { collectDashboardStats } from "./dashboard";

/** 构造仪表板 client 替身；todaySec 用可注入的「当前时间」以便断言今日边界。 */
function createFakeClient(overrides: Record<string, unknown> = {}) {
  const todayStart = Math.floor(
    new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000,
  );
  return {
    listAdminUsers: vi.fn().mockResolvedValue({
      items: [],
      total: 7,
      page: 1,
      page_size: 1,
    }),
    getAdminLogStat: vi.fn().mockResolvedValue({ quota: 320, rpm: 0, tpm: 0 }),
    listAdminLogs: vi.fn().mockResolvedValue({
      items: [
        {
          user_id: 1,
          model_name: "gpt-4o",
          quota: 50,
          created_at: todayStart + 60,
        },
      ],
      total: 1,
      page: 1,
      page_size: 5,
    }),
    listAdminTopUps: vi
      .fn()
      .mockImplementation(
        async (_token: string, _userId: number, opts: { page: number }) => {
          if (opts.page > 1) {
            return { items: [], total: 3, page: opts.page, page_size: 100 };
          }
          return {
            items: [
              {
                trade_no: "BWP1",
                user_id: 2,
                amount: 100,
                money: 1,
                create_time: todayStart + 10,
                complete_time: 0,
                status: "success",
              },
              {
                trade_no: "BWP2",
                user_id: 3,
                amount: 50,
                money: 0.5,
                create_time: todayStart - 100,
                complete_time: 0,
                status: "pending",
              },
            ],
            total: 3,
            page: opts.page,
            page_size: 100,
          };
        },
      ),
    ...overrides,
  };
}

describe("collectDashboardStats", () => {
  it("aggregates today topups, pending orders and recent records", async () => {
    const client = createFakeClient();
    const stats = await collectDashboardStats(client, "sk-admin", 1);

    expect(stats.totalUsers).toBe(7);
    expect(stats.todayRecharge).toBe(100);
    expect(stats.todayRechargeCount).toBe(1);
    expect(stats.todaySpend).toBe(320);
    expect(stats.pendingOrders).toBe(1);
    expect(stats.recentRecharges[0].tradeNo).toBe("BWP1");
    expect(stats.recentConsumes[0].model).toBe("gpt-4o");
    expect(client.getAdminLogStat).toHaveBeenCalledWith(
      "sk-admin",
      1,
      expect.objectContaining({ type: 2 }),
    );
    // 无当日/无 pending 的第二页 → 扫描停止
    expect(client.listAdminTopUps).toHaveBeenCalledTimes(2);
  });

  it("keeps scanning while a page still holds today or pending records", async () => {
    const todayStart = Math.floor(
      new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000,
    );
    const client = createFakeClient({
      listAdminTopUps: vi
        .fn()
        .mockImplementation(
          async (_token: string, _userId: number, opts: { page: number }) => {
            if (opts.page === 1) {
              return {
                items: [
                  {
                    trade_no: "P1",
                    user_id: 1,
                    amount: 10,
                    money: 1,
                    create_time: todayStart + 1,
                    complete_time: 0,
                    status: "pending",
                  },
                ],
                total: 3,
                page: 1,
                page_size: 100,
              };
            }
            if (opts.page === 2) {
              return {
                items: [
                  {
                    trade_no: "P2",
                    user_id: 2,
                    amount: 20,
                    money: 2,
                    create_time: todayStart - 500,
                    complete_time: 0,
                    status: "pending",
                  },
                ],
                total: 3,
                page: 2,
                page_size: 100,
              };
            }
            return { items: [], total: 3, page: opts.page, page_size: 100 };
          },
        ),
    });
    const stats = await collectDashboardStats(client, "sk-admin", 1);
    expect(stats.pendingOrders).toBe(2);
    expect(client.listAdminTopUps).toHaveBeenCalledTimes(3);
  });
});
