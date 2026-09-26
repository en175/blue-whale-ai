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

/** create 的桩行：字段名与真实表一致（快照列由写入的 data 覆盖）。 */
function snapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    trade_no: "RC20260926001",
    pay_order_id: null,
    user_id: 9001n,
    tier_id: 3n,
    amount_fen: 10_000n,
    credits: 1500n,
    credits_per_yuan: 15,
    status: "pending",
    paid_at: null,
    grant_lot_id: null,
    notify_count: 0,
    gmt_create: new Date("2026-09-26T00:00:00Z"),
    ...overrides,
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

  it("paid_pending 原样投影：认不出的状态才会回落成 pending", async () => {
    const findMany = vi.fn().mockResolvedValue([{ ...ROW, status: "paid_pending" }]);
    const repo = createRechargeOrderRepo({
      recharge_orders: { count: vi.fn().mockResolvedValue(1), findMany },
    } as never);

    const page = await repo.list({ page: 1, pageSize: 20 });

    // 回落成 pending 会把「钱到了、积分没发」显示成「用户还没付钱」——正是这个状态要消掉的歧义。
    // 所以扩状态时必须同步 repo 里的状态清单（只有 RECHARGE_ORDER_STATUSES 一份）。
    expect(page.items[0]?.status).toBe("paid_pending");
  });
});

describe("createRechargeOrderRepo — 下单快照与状态机", () => {
  it("create 写入 8 个快照列；调用方不传的取快照默认值（不靠列默认值）", async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
      snapshotRow(data),
    );
    const repo = createRechargeOrderRepo({ recharge_orders: { create } } as never);

    await repo.create({
      tradeNo: "RC20260926001",
      userId: 9001,
      tierId: 3,
      amountFen: 10_000,
      credits: 1500,
      creditsPerYuan: 15,
      productName: "1500积分",
      configVersion: 3,
    });

    const data = create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      status: "pending",
      product_type: "tier",
      product_name: "1500积分",
      // 首购两列与有效期此刻是常量：写默认值而不是省略，省略时列默认值会静默生效，
      // 「快照写全了没有」就没人能验
      bonus_credits: 0n,
      credits_expire_at: null,
      first_purchase_state: "unknown",
      first_purchase_eligible: 0,
      permission_result: "allowed",
      config_version: 3,
    });
  });

  it("markPaidPending 只对「钱还没到」的单生效（>= 待到账 的下界判断）", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createRechargeOrderRepo({ recharge_orders: { updateMany } } as never);

    expect(await repo.markPaidPending("RC20260926001")).toBe(true);

    // notIn 而不是 `= pending`：failed/expired 的单收到支付成功回调时钱是真的到了，
    // 网关比我们的时钟权威，也要能推上来
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        trade_no: "RC20260926001",
        status: { notIn: ["paid_pending", "paid"] },
      },
      data: { status: "paid_pending", gmt_modified: expect.any(Date) },
    });
  });
});
