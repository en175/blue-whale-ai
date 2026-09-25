import { describe, expect, it, vi } from "vitest";

import { createRechargeOrderRepo } from "./recharge-order-repo.js";

// 管理端充值记录列表（offset 分页 + 总数）。本测试钉住 where 的形状：
// 筛选条件不能凭空出现在 where 里（那会把「全部」静默变成「某一种」），
// is_delete 的**类型**也不能抄错——recharge_orders 是 Int(0)，generation_jobs 是 Boolean。

const ROW = {
  trade_no: "RC20260925001",
  pay_order_id: "PAY-1",
  user_id: 9001n,
  tier_id: 3n,
  amount_fen: 9900n,
  credits: 1485n,
  credits_per_yuan: 15,
  status: "paid",
  paid_at: new Date("2026-09-25T00:05:00Z"),
  grant_lot_id: 12n,
  notify_count: 2,
  gmt_create: new Date("2026-09-25T00:00:00Z"),
};

function buildRepo() {
  const count = vi.fn().mockResolvedValue(1);
  const findMany = vi.fn().mockResolvedValue([ROW]);
  return {
    count,
    findMany,
    repo: createRechargeOrderRepo({ recharge_orders: { count, findMany } } as never),
  };
}

describe("createRechargeOrderRepo.list", () => {
  it("一个筛选条件都不传 = 全站订单：where 里只有未删除", async () => {
    const { count, repo } = buildRepo();

    await repo.list({ page: 1, pageSize: 20 });

    // is_delete 是 Int 列（0），不是 Boolean —— 两张表的写法不一样
    expect(count).toHaveBeenCalledWith({ where: { is_delete: 0 } });
  });

  it("用户 / 状态 / 交易单号按原值过滤，userId 转 BigInt", async () => {
    const { findMany, repo } = buildRepo();

    await repo.list({
      userId: 9001,
      status: "paid",
      tradeNo: "RC20260925001",
      page: 3,
      pageSize: 20,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        is_delete: 0,
        user_id: 9001n,
        status: "paid",
        trade_no: "RC20260925001",
      },
      // 次级键 id：DATETIME 只到秒，同一秒下单两笔是常态，只按时间排序会跳行/重复行
      orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
      skip: 40,
      take: 20,
    });
  });

  it("投影成前端口径：金额保持分、时间转 ISO、bigint 一律字符串", async () => {
    const { repo } = buildRepo();

    const page = await repo.list({ page: 1, pageSize: 20 });

    expect(page.total).toBe(1);
    expect(page.items[0]).toEqual({
      tradeNo: "RC20260925001",
      payOrderId: "PAY-1",
      userId: "9001",
      tierId: "3",
      amountFen: 9900,
      credits: 1485,
      creditsPerYuan: 15,
      status: "paid",
      paidAt: "2026-09-25T00:05:00.000Z",
      grantLotId: "12",
      notifyCount: 2,
      createdAt: "2026-09-25T00:00:00.000Z",
    });
  });
});
