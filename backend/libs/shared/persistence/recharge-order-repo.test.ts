import { describe, expect, it, vi } from "vitest";

import { createRechargeOrderRepo } from "./recharge-order-repo.js";

// 管理端充值记录列表（offset 分页 + 总数）。本测试钉住 where 的形状：
// 筛选条件不能凭空出现在 where 里（那会把「全部」静默变成「某一种」），
// is_delete 的**类型**也不能抄错——recharge_orders 是 Int(0)，generation_jobs 是 Boolean。

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
      // 收银台链接要投影出来：复用未支付订单时原样还给用户的那条（网关不允许重下单，
      // 这条链接事后要不回来）
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
      grantLotId: "12",
      notifyCount: 2,
      createdAt: "2026-09-25T00:00:00.000Z",
      // 钱到的时刻（不是 paid_at）：主动对账靠它算「持有分钟数」
      paidPendingAt: "2026-09-25T00:04:00.000Z",
      // 有效期**月数**快照：起算点是支付成功时刻，所以订单存的是月数而不是算好的时刻
      creditsValidMonths: 24,
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
      // 首购两列与权限结果此刻是常量：写默认值而不是省略，省略时列默认值会静默生效，
      // 「快照写全了没有」就没人能验
      bonus_credits: 0n,
      // ⚠️ 下单时到期**时刻**写不了（起算点是支付成功时刻）：显式写 NULL，
      // 由发放那一步按「月数 + 钱到的时刻」算出来补上
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
      // 有效期快照只存**月数**（配置表自己那份），到期时刻发放时才算
      creditsValidMonths: 24,
    });

    // 编一个 0/1 顶上去，会让按 tier_id 聚合的对账把全部自定义充值算到某个无辜档位上
    expect(create.mock.calls[0]![0].data.tier_id).toBeNull();
    expect(view.tierId).toBeNull();
    expect(create.mock.calls[0]![0].data.product_type).toBe("custom");
    expect(create.mock.calls[0]![0].data.credits_valid_months).toBe(24);
    // 下单时到期时刻仍是 NULL：它由发放那一步写上（不是下单时按当时时间估一个）
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

    // notIn 而不是 `= pending`：failed/expired 的单收到支付成功回调时钱是真的到了，
    // 网关比我们的时钟权威，也要能推上来。
    //
    // `grant_failed` 也在这个 notIn 里：那是「钱到了、只是没发成功」的异常单，
    // 回炉重试不该把它推回 paid_pending —— 那会顺手刷新下面的 paid_pending_at，
    // 主动对账的「持有分钟数」就永远停在几分钟、看起来一切正常
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        trade_no: "RC20260926001",
        status: { notIn: ["paid_pending", "grant_failed", "paid"] },
      },
      data: {
        status: "paid_pending",
        // 「首次」进入待到账的时刻，主动对账据此判「等太久了吗」
        paid_pending_at: expect.any(Date),
        gmt_modified: expect.any(Date),
      },
    });
  });

  it("★ markPaid 把**真实发给 billing 的**到期时刻写进快照（与批次同一处落地）", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createRechargeOrderRepo({ recharge_orders: { updateMany } } as never);
    const expiresAt = new Date("2028-09-27T10:00:00.000Z");

    await repo.markPaid({ tradeNo: "RC20260926001", grantLotId: "42", creditsExpireAt: expiresAt });

    expect(updateMany).toHaveBeenCalledWith({
      where: { trade_no: "RC20260926001", status: { not: "paid" } },
      data: {
        status: "paid",
        paid_at: expect.any(Date),
        grant_lot_id: 42n,
        // 这一列记的必须是「真实发出去那批积分什么时候到期」，而不是下单时估的另一个数
        credits_expire_at: expiresAt,
        gmt_modified: expect.any(Date),
      },
    });
  });

  it("markPaid 不传到到期时刻（存量单走 billing 来源策略）时不写那一列", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createRechargeOrderRepo({ recharge_orders: { updateMany } } as never);

    await repo.markPaid({ tradeNo: "RC20260926001" });

    // 传 `credits_expire_at: undefined` 与不传在 Prisma 里等价，但**写 null 不是**：
    // 那会把早先一次成功发放留下的到期时刻抹掉
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
        // ⚠️ 只找 `pending`（2026-09-27 收窄）：`paid_pending` / `grant_failed` 那条
        // 「钱已经收了」的判定被绑在商品身份上时，用户在途时运营一改价再点一次就不命中
        // —— 建新单、能付款 = 重复收款。那条判定搬到了 findUnsettledPaidOrder（不看身份）
        status: "pending",
        is_delete: 0,
        product_type: "tier",
        tier_id: 7n,
        credits: 7500n,
        // ⚠️ 金额必须在 where 里：少了它，运营改价后用户再点一次会复用到**旧价**那笔单，
        // 界面上同时出现两个金额（目录价 vs 旧单价），方向还可能多收用户的钱
        amount_fen: 49_900n,
      },
      // 次级键 id：DATETIME 只到秒，同秒两笔是常态
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

    // 收窄之后这条更强：不只是「不包含 paid」，而是**只**认 pending
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
        // 钱已收、未落地
        status: { in: ["paid_pending", "grant_failed"] },
        is_delete: 0,
      },
      // 多笔时给**最早**那笔（次级键 id：DATETIME 只到秒，同秒两笔是常态）
      orderBy: [{ gmt_create: "asc" }, { id: "asc" }],
    });
  });

  it("★ 商品身份不在判据里：运营在用户在途时改价，也绕不开这道闸", async () => {
    const { findFirst, repo } = build();

    await repo.findUnsettledPaidOrder(9001);

    const where = findFirst.mock.calls[0]![0].where as Record<string, unknown>;
    // 这四个维度只要有一个进来，改价/换档/改积分就能把「已付未落地」的单藏起来，
    // 于是用户再买一笔、再付一次 —— 而这正是 B-2 要堵的那条路
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
