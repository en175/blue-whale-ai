import { describe, expect, it, vi } from "vitest";

import { createRechargeOrderRepo } from "./recharge-order-repo.js";


const ROW = {
  trade_no: "RC20260925001",
  pay_order_id: "PAY-1",
  cashier_url: "https://test.hccb.cc/uniCashierNew.html?tokenCode=abc",
  user_id: 9001n,
  tier_id: 3n,
  amount_fen: 9900n,
  credits: 1485n,
  credits_per_yuan: 15,
  product_type: "tier",
  product_name: "轻量尝鲜",
  status: "paid",
  paid_at: new Date("2026-09-25T00:05:00Z"),
  paid_pending_at: new Date("2026-09-25T00:04:00Z"),
  credits_valid_months: 24,
  bonus_credits: 1000n,
  first_purchase_eligible: 1,
  first_purchase_state: "first",
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
    notify_count: 0,
    gmt_create: new Date("2026-09-26T00:00:00Z"),
    ...overrides,
  };
}

describe("createRechargeOrderRepo.list", () => {
  it("一个筛选条件都不传 = 全站订单：where 里只有未删除", async () => {
    const { count, repo } = buildRepo();

    await repo.list({ page: 1, pageSize: 20 });

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
      cashierUrl: "https://test.hccb.cc/uniCashierNew.html?tokenCode=abc",
      userId: "9001",
      tierId: "3",
      amountFen: 9900,
      credits: 1485,
      creditsPerYuan: 15,
      productType: "tier",
      productName: "轻量尝鲜",
      status: "paid",
      paidAt: "2026-09-25T00:05:00.000Z",
      notifyCount: 2,
      createdAt: "2026-09-25T00:00:00.000Z",
      paidPendingAt: "2026-09-25T00:04:00.000Z",
      creditsValidMonths: 24,
      bonusCredits: 1000,
      firstPurchaseEligible: 1,
      firstPurchaseState: "first",
    });
  });

  it("paid_pending 原样投影：认不出的状态才会回落成 pending", async () => {
    const findMany = vi.fn().mockResolvedValue([{ ...ROW, status: "paid_pending" }]);
    const repo = createRechargeOrderRepo({
      recharge_orders: { count: vi.fn().mockResolvedValue(1), findMany },
    } as never);

    const page = await repo.list({ page: 1, pageSize: 20 });

    expect(page.items[0]?.status).toBe("paid_pending");
  });
});

describe("createRechargeOrderRepo — 下单快照与状态机", () => {
  it("create 写入 9 个快照列；调用方不传的取快照默认值（不靠列默认值）", async () => {
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
      bonus_credits: 0n,
      credits_expire_at: null,
      credits_valid_months: null,
      first_purchase_state: "unknown",
      first_purchase_eligible: 0,
      permission_result: "allowed",
      config_version: 3,
    });
  });

  it("★ 自定义充值单：`tier_id` 写 **NULL**，不是 0/1（模块 B，迁移 050）", async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
      snapshotRow(data),
    );
    const repo = createRechargeOrderRepo({ recharge_orders: { create } } as never);

    const view = await repo.create({
      tradeNo: "RC20260927001",
      userId: 9001,
      tierId: null,
      amountFen: 4_000,
      credits: 600,
      creditsPerYuan: 15,
      productType: "custom",
      productName: "自定义充值",
      configVersion: 5,
      creditsValidMonths: 24,
    });

    expect(create.mock.calls[0]![0].data.tier_id).toBeNull();
    expect(view.tierId).toBeNull();
    expect(create.mock.calls[0]![0].data.product_type).toBe("custom");
    expect(create.mock.calls[0]![0].data.credits_valid_months).toBe(24);
    expect(create.mock.calls[0]![0].data.credits_expire_at).toBeNull();
  });

  it("可空 tier_id 的读回：NULL 原样投影成 null（不是 \"null\" 字符串，也不抛错）", async () => {
    const findMany = vi.fn().mockResolvedValue([{ ...ROW, tier_id: null }]);
    const repo = createRechargeOrderRepo({
      recharge_orders: { count: vi.fn().mockResolvedValue(1), findMany },
    } as never);

    const page = await repo.list({ page: 1, pageSize: 20 });

    expect(page.items[0]?.tierId).toBeNull();
  });

  it("markPaidPending 只对「钱还没到」的单生效（>= 待到账 的下界判断）", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createRechargeOrderRepo({ recharge_orders: { updateMany } } as never);

    expect(await repo.markPaidPending("RC20260926001")).toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        trade_no: "RC20260926001",
        status: { notIn: ["paid_pending", "grant_failed", "paid"] },
      },
      data: {
        status: "paid_pending",
        paid_pending_at: expect.any(Date),
        gmt_modified: expect.any(Date),
      },
    });
  });

  it("★ markPaid 把**真实发给 billing 的**到期时刻写进快照（与发放同一处落地）", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createRechargeOrderRepo({ recharge_orders: { updateMany } } as never);
    const expiresAt = new Date("2028-09-27T10:00:00.000Z");

    await repo.markPaid({ tradeNo: "RC20260926001", creditsExpireAt: expiresAt });

    expect(updateMany).toHaveBeenCalledWith({
      where: { trade_no: "RC20260926001", status: { not: "paid" } },
      data: {
        status: "paid",
        paid_at: expect.any(Date),
        credits_expire_at: expiresAt,
        gmt_modified: expect.any(Date),
      },
    });
  });

  it("markPaid 不传到到期时刻（存量单走 billing 来源策略）时不写那一列", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createRechargeOrderRepo({ recharge_orders: { updateMany } } as never);

    await repo.markPaid({ tradeNo: "RC20260926001" });

    const data = updateMany.mock.calls[0]![0].data as Record<string, unknown>;
    expect("credits_expire_at" in data).toBe(false);
  });
});

describe("createRechargeOrderRepo — 活跃单的身份（下单防重）", () => {
  function build(rows: unknown[] = []) {
    const findFirst = vi.fn().mockResolvedValue(rows[0] ?? null);
    return {
      findFirst,
      repo: createRechargeOrderRepo({ recharge_orders: { findFirst } } as never),
    };
  }

  it("★ 身份四个维度全部进 where：含**金额**（改价 = 换了商品，见 B 条修正）", async () => {
    const { findFirst, repo } = build();

    await repo.findActiveOrder({
      userId: 9001,
      productType: "tier",
      tierId: 7,
      credits: 7500,
      amountFen: 49_900,
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        user_id: 9001n,
        status: "pending",
        is_delete: 0,
        product_type: "tier",
        tier_id: 7n,
        credits: 7500n,
        amount_fen: 49_900n,
      },
      orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
    });
  });

  it("自定义充值单：tier_id 用 IS NULL 匹配，amount_fen 同样进 where", async () => {
    const { findFirst, repo } = build();

    await repo.findActiveOrder({
      userId: 9001,
      productType: "custom",
      tierId: null,
      credits: 600,
      amountFen: 4_000,
    });

    const where = findFirst.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where.tier_id).toBeNull();
    expect(where.amount_fen).toBe(4_000n);
  });

  it("★ `paid` 不在活跃状态里：那是一笔已完成的交易，用户再买一笔是正常的", async () => {
    const { findFirst, repo } = build();

    await repo.findActiveOrder({
      userId: 9001,
      productType: "tier",
      tierId: 7,
      credits: 7500,
      amountFen: 49_900,
    });

    expect(findFirst.mock.calls[0]![0].where.status).toBe("pending");
  });
});

describe("createRechargeOrderRepo — 已付未落地的单（重复收款防护，B-2）", () => {
  function build(rows: unknown[] = []) {
    const findFirst = vi.fn().mockResolvedValue(rows[0] ?? null);
    return {
      findFirst,
      repo: createRechargeOrderRepo({ recharge_orders: { findFirst } } as never),
    };
  }

  it("★ 判据只看「谁的、什么状态」：**商品身份与金额都不进 where**", async () => {
    const { findFirst, repo } = build();

    await repo.findUnsettledPaidOrder(9001);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        user_id: 9001n,
        status: { in: ["paid_pending", "grant_failed"] },
        is_delete: 0,
      },
      orderBy: [{ gmt_create: "asc" }, { id: "asc" }],
    });
  });

  it("★ 商品身份不在判据里：运营在用户在途时改价，也绕不开这道闸", async () => {
    const { findFirst, repo } = build();

    await repo.findUnsettledPaidOrder(9001);

    const where = findFirst.mock.calls[0]![0].where as Record<string, unknown>;
    expect(Object.keys(where).sort()).toEqual(["is_delete", "status", "user_id"]);
  });

  it("★ `paid` 不在里面：已完成的一笔不该拦住下一次购买", async () => {
    const { findFirst, repo } = build();

    await repo.findUnsettledPaidOrder(9001);

    const status = findFirst.mock.calls[0]![0].where.status as { in: string[] };
    expect(status.in).not.toContain("paid");
    expect(status.in).not.toContain("pending");
  });
});
