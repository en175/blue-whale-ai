import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  freshGrpcUrl,
  grpcActiveCatalog,
  grpcStubTransport,
} from "@lib/shared/billing/billing-admin-grpc-stub.testlib.js";
import {
  SYSTEM_SETTINGS_SECRET_ENV,
  SystemSettingsService,
} from "@lib/shared/system-settings/index.js";
import { RechargeCustomService } from "@lib/shared/recharge-custom/recharge-custom.service.js";
import { stubTierRepo } from "@lib/shared/topup-tier/topup-tier.testlib.js";
import {
  APP_SECRET,
  NOTIFY_URL,
  TIER,
  makeHttp,
  makePrisma,
  makeService,
  notifyParams,
  signed,
} from "./recharge.testlib.js";
import { creditsExpireAt } from "./credits-validity.js";
import { GRANT_RETRY_WINDOW_MS } from "./recharge-grant-sweeper.js";
import { RechargeService } from "./recharge.service.js";

vi.mock("@connectrpc/connect-node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect-node")>();
  return {
    ...actual,
    createGrpcTransport: () => grpcStubTransport(),
  };
});


describe("RechargeService — 下单", () => {
  beforeEach(() => {
    vi.stubEnv("PAY_SERVER_BASE_URL", "https://pay.example.com");
    vi.stubEnv(SYSTEM_SETTINGS_SECRET_ENV, "a".repeat(64));
    freshGrpcUrl();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("档位不存在 → 404（这条留在 service 侧，不在纯函数里）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service } = await makeService();

    await expect(service.createOrder({ userId: 9001, tierId: "999" })).rejects.toMatchObject({
      status: 404,
      message: "档位不存在",
    });
  });

  it("★ 积分冻结的是**档位配的基础积分**（配置值），不是「原价 × 换算率」", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();

    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(created.amount).toBe(100);
    expect(created.credits).toBe(7500);
    expect(created.cashierUrl).toContain("uniCashierNew.html");
    expect(created.tradeNo).toMatch(/^RC\d{14}[0-9a-f]{8}$/);

    const order = orders.get(created.tradeNo);
    expect(order?.amount_fen).toBe(10_000n);
    expect(order?.credits).toBe(7500n);
    expect(order?.credits_per_yuan).toBe(15);
    expect(order?.status).toBe("pending");
    expect(order?.pay_order_id).toBe("P-GATEWAY-1");

    const unified = http.calls.find((c) => c.url.endsWith("/api/pay/unifiedOrder"));
    expect(unified?.body.amount).toBe(10_000);
    expect(unified?.body.wayCode).toBe("HCCB_QR");
    expect(unified?.body.notifyUrl).toBe(NOTIFY_URL);
  });

  it("★ 换算率改成 20 后：档位展示**不变**（积分是配置值），已下订单仍按冻结的数发", async () => {
    makeHttp();
    const catalog = grpcActiveCatalog();
    const { service, orders } = await makeService();

    const before = await service.createOrder({ userId: 9001, tierId: TIER.id });
    expect(before.credits).toBe(7500);

    catalog.setCreditsPerYuan(20);
    expect((await service.listTiers()).tiers[0]?.amount).toBe(7500);
    expect((await service.listTiers()).creditsPerYuan).toBe(20);

    const order = orders.get(before.tradeNo);
    expect(order?.credits).toBe(7500n);
  });

  it("下单写入 9 个快照字段：config_version 取档位**当时**的 version", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTierVersion } = await makeService();

    const first = await service.createOrder({ userId: 9001, tierId: TIER.id });

    const row = orders.get(first.tradeNo);
    expect(row?.product_type).toBe("tier");
    expect(row?.product_name).toBe("7500积分");
    expect(row?.bonus_credits).toBe(0n);
    expect(row?.first_purchase_state).toBe("unknown");
    expect(row?.first_purchase_eligible).toBe(0);
    expect(row?.permission_result).toBe("allowed");
    expect(row?.config_version).toBe(3);
    expect(row?.credits_valid_months).toBe(24);
    expect(row?.credits_expire_at).toBeNull();

    orders.get(first.tradeNo)!.status = "paid";
    setTierVersion(4);
    const second = await service.createOrder({ userId: 9001, tierId: TIER.id });
    expect(orders.get(second.tradeNo)?.config_version).toBe(4);
    expect(orders.get(first.tradeNo)?.config_version).toBe(3);
  });

  it("★ 档位配的有效期月数进快照：换一档就是换一个数（不是写死的 2 年）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTier } = await makeService();

    setTier({ creditsValidMonths: 6 });
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(orders.get(created.tradeNo)?.credits_valid_months).toBe(6);
  });

  it("★ 档位购买权限：不在白名单 → 403 带后台配的提示，且**一笔单都不建**", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTier } = await makeService();
    setTier({
      permission: "user_group",
      permissionAllowlist: ["9001"],
      permissionDeniedHint: "该档位仅限内测用户",
    });

    await expect(service.createOrder({ userId: 7007, tierId: TIER.id })).rejects.toThrow(
      /该档位仅限内测用户/,
    );
    expect(orders.size).toBe(0);
    expect(http.calls.some((c) => c.url.endsWith("/api/pay/unifiedOrder"))).toBe(false);

    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    expect(created.credits).toBe(7500);
  });

  it("★ 档位没配提示文案时用默认文案（不能把空串当提示展示）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, setTier } = await makeService();
    setTier({ permission: "user_group", permissionAllowlist: [] });

    await expect(service.createOrder({ userId: 9001, tierId: TIER.id })).rejects.toThrow(
      /暂不可购买该档位/,
    );
  });

  it("★ `member_tier` 权限本阶段只是占位：不拦人（PRD §10.4 阶段 2 生效）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, setTier } = await makeService();
    setTier({ permission: "member_tier", permissionAllowlist: [] });

    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    expect(created.credits).toBe(7500);
  });

  it("★ listTiers 带上权限信号：游客未判定、白名单外的用户 false（PRD §6.3 置灰）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, setTier } = await makeService();
    setTier({
      permission: "user_group",
      permissionAllowlist: ["9001"],
      permissionDeniedHint: "该档位仅限内测用户",
    });

    const guest = await service.listTiers(null);
    expect(guest.tiers[0]?.canPurchase).toBeNull();
    expect(guest.tiers[0]?.deniedHint).toBe("该档位仅限内测用户");

    const denied = await service.listTiers(7007);
    expect(denied.tiers[0]?.canPurchase).toBe(false);

    const allowed = await service.listTiers(9001);
    expect(allowed.tiers[0]?.canPurchase).toBe(true);
  });

  it("★ 默认不传 userId = 游客视角：`can_purchase` 为 null（未判定），不是 false", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service } = await makeService();

    expect((await service.listTiers()).tiers[0]?.canPurchase).toBeNull();
  });

  it("档位下架 → 拒绝下单", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { prisma } = makePrisma();
    const settings = new SystemSettingsService({ client: prisma } as never);
    await settings.update({
      credentials: {
        hccb_mch_no: "M0001",
        hccb_app_id: "app-1",
        hccb_app_secret: APP_SECRET,
        hccb_notify_url: NOTIFY_URL,
      },
    });
    const tiers = stubTierRepo({
      listActive: async () => [],
      getById: async () => ({ ...TIER, status: "inactive" as const }),
    });
    const service = new RechargeService(
      { client: prisma } as never,
      tiers,
      settings,
      new RechargeCustomService({ client: prisma } as never),
      GRANT_RETRY_WINDOW_MS,
    );

    await expect(service.createOrder({ userId: 1, tierId: "7" })).rejects.toThrow(/已下架/);
  });

  it("★ 档位还是草稿 → 拒绝下单，且**不说「已下架」**", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { prisma } = makePrisma();
    const settings = new SystemSettingsService({ client: prisma } as never);
    await settings.update({
      credentials: {
        hccb_mch_no: "M0001",
        hccb_app_id: "app-1",
        hccb_app_secret: APP_SECRET,
        hccb_notify_url: NOTIFY_URL,
      },
    });
    const tiers = stubTierRepo({
      listActive: async () => [],
      getById: async () => ({ ...TIER, status: "draft" as const }),
    });
    const service = new RechargeService(
      { client: prisma } as never,
      tiers,
      settings,
      new RechargeCustomService({ client: prisma } as never),
      GRANT_RETRY_WINDOW_MS,
    );

    await expect(service.createOrder({ userId: 1, tierId: "7" })).rejects.toThrow(
      /尚未上架/,
    );
  });

  it("商户凭证没配全 → 拒绝下单，不带着半份配置去调用网关", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { prisma } = makePrisma();
    const settings = new SystemSettingsService({ client: prisma } as never);
    await settings.update({
      credentials: { hccb_mch_no: "M0001", hccb_app_id: "", hccb_app_secret: "", hccb_notify_url: "" },
    });
    const tiers = stubTierRepo({
      listActive: async () => [TIER],
      getById: async () => TIER,
    });
    const service = new RechargeService(
      { client: prisma } as never,
      tiers,
      settings,
      new RechargeCustomService({ client: prisma } as never),
      GRANT_RETRY_WINDOW_MS,
    );

    await expect(service.createOrder({ userId: 1, tierId: "7" })).rejects.toThrow(
      /支付商户信息未配置完整/,
    );
    expect(http.calls.some((c) => c.url.endsWith("/api/pay/unifiedOrder"))).toBe(false);
  });
});


describe("RechargeService — 回调到账", () => {
  beforeEach(() => {
    vi.stubEnv("PAY_SERVER_BASE_URL", "https://pay.example.com");
    vi.stubEnv(SYSTEM_SETTINGS_SECRET_ENV, "a".repeat(64));
    freshGrpcUrl();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("首次回调：先置 paid_pending（钱到了）再发放、最后置 paid（积分也发了）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders, statusWrites } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(await service.handleNotify(await signed(notifyParams(created.tradeNo)))).toBe(true);

    expect(http.granted).toEqual([{ amount: 7500, bizId: created.tradeNo }]);
    expect(http.grantBodies[0]?.bizType).toBe("recharge");
    const order = orders.get(created.tradeNo);
    expect(order?.status).toBe("paid");
    expect(order?.paid_at).toBeInstanceOf(Date);
    expect(statusWrites).toEqual(["paid_pending", "paid"]);
  });

  it("★ 到账把配的有效期**真的**传给了 billing，起算点是支付成功时刻（PRD §9.5）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTier } = await makeService();
    setTier({ creditsValidMonths: 6 });
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(await service.handleNotify(await signed(notifyParams(created.tradeNo)))).toBe(true);

    const row = orders.get(created.tradeNo);
    const paidPendingAt = row?.paid_pending_at as Date;
    const expected = creditsExpireAt(paidPendingAt, 6);
    expect(row?.credits_expire_at).toEqual(expected);
    expect(http.grantBodies[0]?.expiresAt).toBe(expected.toISOString());
  });

  it("有效期快照缺失（本列上线前的存量单）→ 不显式传 expiresAt，由 billing 按来源策略发", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(created.tradeNo)!.credits_valid_months = null;

    await service.handleNotify(await signed(notifyParams(created.tradeNo)));

    expect("expiresAt" in (http.grantBodies[0] ?? {})).toBe(false);
    expect(orders.get(created.tradeNo)?.credits_expire_at).toBeNull();
  });

  it("重复回调（网关重投）：积分只发一次，且仍应答 SUCCESS", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, statusWrites } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const params = await signed(notifyParams(created.tradeNo));

    expect(await service.handleNotify(params)).toBe(true);
    expect(await service.handleNotify(params)).toBe(true);
    expect(await service.handleNotify(params)).toBe(true);

    expect(http.grantBodies).toHaveLength(1);
    expect(statusWrites).toEqual(["paid_pending", "paid"]);
    expect(http.granted).toHaveLength(1);
    expect(http.granted[0]?.amount).toBe(7500);
  });

  it("已是 paid_pending 的重投：**重试发放**（白给的重试机会不能短路掉）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders, statusWrites } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const params = await signed(notifyParams(created.tradeNo));

    http.failNextGrants(1);
    expect(await service.handleNotify(params)).toBe(false);
    expect(orders.get(created.tradeNo)?.status).toBe("paid_pending");

    expect(await service.handleNotify(params)).toBe(true);
    expect(orders.get(created.tradeNo)?.status).toBe("paid");
    expect(http.granted).toEqual([{ amount: 7500, bizId: created.tradeNo }]);
    expect(http.grantBodies).toHaveLength(2);
    expect(statusWrites).toEqual(["paid_pending", "paid"]);
  });

  it("回调金额与订单不符：不发放、不应答 SUCCESS（让网关重投并留痕）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    const tampered = await signed(notifyParams(created.tradeNo, { amount: "1" }));
    expect(await service.handleNotify(tampered)).toBe(false);

    expect(http.granted).toHaveLength(0);
    expect(orders.get(created.tradeNo)?.status).toBe("pending");
  });

  it("验签失败：不发放、不应答 SUCCESS", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    const forged = { ...notifyParams(created.tradeNo), sign: "0".repeat(32) };
    expect(await service.handleNotify(forged)).toBe(false);
    expect(http.granted).toHaveLength(0);
  });

  it("订单不存在：不应答 SUCCESS（不把异常吞成成功）", async () => {
    const http = makeHttp();
    const { service } = await makeService();
    const params = await signed(notifyParams("RC-NOT-EXIST"));
    expect(await service.handleNotify(params)).toBe(false);
    expect(http.granted).toHaveLength(0);
  });

  it("非终态通知：不应答 SUCCESS（契约说只通知终态，来了就是异常）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const params = await signed(notifyParams(created.tradeNo, { state: "1" }));
    expect(await service.handleNotify(params)).toBe(false);
    expect(http.granted).toHaveLength(0);
  });

  it("渠道不符 / 支付方式不符：拒绝（这条通道只认杭州银行）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(
      await service.handleNotify(await signed(notifyParams(created.tradeNo, { ifCode: "wxpay" }))),
    ).toBe(false);
    expect(
      await service.handleNotify(await signed(notifyParams(created.tradeNo, { wayCode: "ALI_QR" }))),
    ).toBe(false);
    expect(http.granted).toHaveLength(0);
  });

  it("发放失败（billing 不可用）：不应答 SUCCESS，订单停在 paid_pending 而不是退回 pending", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders, statusWrites } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    http.failNextGrants(1);

    expect(await service.handleNotify(await signed(notifyParams(created.tradeNo)))).toBe(false);
    expect(orders.get(created.tradeNo)?.status).toBe("paid_pending");
    expect(statusWrites).toEqual(["paid_pending"]);
  });
});

describe("RechargeService — 首购加赠（每档首次）", () => {
  beforeEach(() => {
    vi.stubEnv("PAY_SERVER_BASE_URL", "https://pay.example.com");
    vi.stubEnv(SYSTEM_SETTINGS_SECRET_ENV, "a".repeat(64));
    freshGrpcUrl();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("★ 同一档位第一笔支付发赠送批次，第二笔不发（幂等键按用户+档位裁决）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTier } = await makeService();
    setTier({ firstPurchaseEligible: true, bonusCredits: 1_000 });

    const first = await service.createOrder({ userId: 9001, tierId: TIER.id });
    expect(orders.get(first.tradeNo)?.bonus_credits).toBe(1_000n);
    expect(await service.handleNotify(await signed(notifyParams(first.tradeNo)))).toBe(true);

    expect(http.granted).toEqual([
      { amount: 7_500, bizId: first.tradeNo },
      { amount: 1_000, bizId: first.tradeNo },
    ]);
    expect(http.grantBodies[1]).toMatchObject({
      source: "bonus",
      grantKey: `bonus:tier:9001:${TIER.id}`,
    });
    expect(orders.get(first.tradeNo)?.first_purchase_state).toBe("first");

    const second = await service.createOrder({ userId: 9001, tierId: TIER.id });
    expect(await service.handleNotify(await signed(notifyParams(second.tradeNo)))).toBe(true);

    expect(http.granted).toEqual([
      { amount: 7_500, bizId: first.tradeNo },
      { amount: 1_000, bizId: first.tradeNo },
      { amount: 7_500, bizId: second.tradeNo },
    ]);
    expect(orders.get(second.tradeNo)?.first_purchase_state).toBe("repeat");
    expect(orders.get(second.tradeNo)?.bonus_credits).toBe(1_000n);
  });

  it("★ 重放不会把「本单发出的赠送」记成 repeat（撞键要看归属）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTier } = await makeService();
    setTier({ firstPurchaseEligible: true, bonusCredits: 1_000 });

    const order = await service.createOrder({ userId: 9001, tierId: TIER.id });
    await service.handleNotify(await signed(notifyParams(order.tradeNo)));
    expect(orders.get(order.tradeNo)?.first_purchase_state).toBe("first");

    const row = orders.get(order.tradeNo)!;
    row.status = "paid_pending";
    row.first_purchase_state = "unknown";

    await service.handleNotify(await signed(notifyParams(order.tradeNo)));

    expect(orders.get(order.tradeNo)?.first_purchase_state).toBe("first");
    expect(http.granted).toEqual([
      { amount: 7_500, bizId: order.tradeNo },
      { amount: 1_000, bizId: order.tradeNo },
    ]);
  });

  it("档位不参与首购：不发赠送批次，状态保持 unknown", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    await service.handleNotify(await signed(notifyParams(created.tradeNo)));

    expect(http.granted).toEqual([{ amount: 7_500, bizId: created.tradeNo }]);
    const row = orders.get(created.tradeNo);
    expect(row?.bonus_credits).toBe(0n);
    expect(row?.first_purchase_state).toBe("unknown");
  });
});

describe("RechargeService — 查单补偿（回调丢失时）", () => {
  beforeEach(() => {
    vi.stubEnv("PAY_SERVER_BASE_URL", "https://pay.example.com");
    vi.stubEnv(SYSTEM_SETTINGS_SECRET_ENV, "a".repeat(64));
    freshGrpcUrl();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("网关侧已支付而回调丢了 → 用户查单时补发积分", async () => {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(state.status).toBe("paid");
    expect(state.creditsAfter).toBeNull();
    expect(http.granted).toEqual([{ amount: 7500, bizId: created.tradeNo }]);
    expect(orders.get(created.tradeNo)?.status).toBe("paid");
  });

  it("查单补偿有限流：同一笔订单 30 秒内不重复问网关", async () => {
    const http = makeHttp(1);
    grpcActiveCatalog();
    const { service } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });
    await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });
    await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    const queries = http.calls.filter((c) => c.url.endsWith("/api/pay/query"));
    expect(queries).toHaveLength(1);
  });

  it("令牌过期且网关未成功 → 置过期（给用户明确终态，不让轮询一直转）", async () => {
    makeHttp(1);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(created.tradeNo)!.gmt_create = new Date(Date.now() - 31 * 60 * 1000);

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(state.status).toBe("expired");
    expect(orders.get(created.tradeNo)?.status).toBe("expired");
  });

  it("网关说成功时，即使本地已过令牌期也以到账为准（钱比时钟权威）", async () => {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(created.tradeNo)!.gmt_create = new Date(Date.now() - 31 * 60 * 1000);

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(state.status).toBe("paid");
    expect(http.granted).toEqual([{ amount: 7500, bizId: created.tradeNo }]);
  });

  it("★ 停在「待到账」的单，用户轮询会**补发**（不补就永远卡在发放中）", async () => {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    orders.get(created.tradeNo)!.status = "paid_pending";

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(http.granted).toEqual([{ amount: 7500, bizId: created.tradeNo }]);
    expect(state.status).toBe("paid");
  });

  it("★ 标成 `grant_failed` 的单，用户轮询也**补发**（两条自愈路径行为一致）", async () => {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(created.tradeNo)!.status = "grant_failed";

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(http.granted).toEqual([{ amount: 7500, bizId: created.tradeNo }]);
    expect(state.status).toBe("paid");
  });

  it("★ `grant_failed` 的超窗单：同样只回状态、不再打 billing（补发规则对它一并生效）", async () => {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const row = orders.get(created.tradeNo)!;
    row.status = "grant_failed";
    row.paid_pending_at = new Date(Date.now() - 3 * 60 * 60 * 1000);

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(http.grantBodies).toHaveLength(0);
    expect(state.status).toBe("grant_failed");
    expect(orders.get(created.tradeNo)?.status).toBe("grant_failed");
  });

  it("★ 补发走限流：30 秒内用户轮询多次，只打一次 billing", async () => {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(created.tradeNo)!.status = "paid_pending";
    http.failNextGrants(10);

    await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });
    await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });
    await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(http.grantBodies).toHaveLength(1);
    expect(orders.get(created.tradeNo)?.status).toBe("paid_pending");
  });

  it("★ 超出重试窗口的 paid_pending：只回状态，**不再打 billing**（也不改状态）", async () => {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const row = orders.get(created.tradeNo)!;
    row.status = "paid_pending";
    row.paid_pending_at = new Date(Date.now() - 3 * 60 * 60 * 1000);

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(http.grantBodies).toHaveLength(0);
    expect(state.status).toBe("paid_pending");
    expect(orders.get(created.tradeNo)?.status).toBe("paid_pending");
  });

  it("存量单没有 paid_pending_at：退回按下单时刻判窗口（更宽松，好过永远扫不到）", async () => {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const row = orders.get(created.tradeNo)!;
    row.status = "paid_pending";
    row.paid_pending_at = null;
    row.gmt_create = new Date(Date.now() - 3 * 60 * 60 * 1000);

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(http.grantBodies).toHaveLength(0);
    expect(state.status).toBe("paid_pending");
  });

  it("别人的订单当作不存在：不泄漏「这个单号存在」", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    await expect(
      service.getOrderStatus({ userId: 1234, tradeNo: created.tradeNo }),
    ).rejects.toThrow(/订单不存在/);
  });
});

describe("RechargeService — 档位目录带上有效期（C-1）", () => {
  beforeEach(() => {
    vi.stubEnv("PAY_SERVER_BASE_URL", "https://pay.example.com");
    vi.stubEnv(SYSTEM_SETTINGS_SECRET_ENV, "a".repeat(64));
    freshGrpcUrl();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("★ 有效期**逐档**回给前端：不同档位拿到不同的数（不是整页一个写死的 2 年）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, addTier, setTier } = await makeService();

    setTier({ creditsValidMonths: 6 });
    addTier({ ...TIER, id: "8", name: "高级", creditsValidMonths: 24 });

    const catalog = await service.listTiers();

    const byId = new Map(catalog.tiers.map((t) => [t.id, t.creditsValidMonths]));
    expect(byId.get("7")).toBe(6);
    expect(byId.get("8")).toBe(24);
  });

  it("默认档位把后台配的月数原样带出来（游客也要能拿到，价格表本来就是公开信息）", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service } = await makeService();

    const catalog = await service.listTiers();

    expect(catalog.tiers[0]?.creditsValidMonths).toBe(TIER.creditsValidMonths);
  });
});

describe("RechargeService — 超窗 WARN 的频次（M-1）", () => {
  beforeEach(() => {
    vi.stubEnv("PAY_SERVER_BASE_URL", "https://pay.example.com");
    vi.stubEnv(SYSTEM_SETTINGS_SECRET_ENV, "a".repeat(64));
    freshGrpcUrl();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function makeOverWindowOrder() {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const made = await makeService();
    const created = await made.service.createOrder({ userId: 9001, tierId: TIER.id });
    const row = made.orders.get(created.tradeNo)!;
    row.status = "paid_pending";
    row.paid_pending_at = new Date(Date.now() - 3 * 60 * 60 * 1000);
    return { ...made, http, tradeNo: created.tradeNo };
  }

  it("★ 同一笔超窗单被轮询多次，WARN 只出现一次（名额是 30 秒，不压就是 2880 条/天）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, tradeNo } = await makeOverWindowOrder();

    for (let i = 0; i < 10; i += 1) {
      await service.getOrderStatus({ userId: 9001, tradeNo });
    }

    const lines = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((text) => text.includes("recharge.grant_retry_window_exceeded"));
    expect(lines).toHaveLength(1);
  });

  it("★ 压的是频次、不是可见性：超窗这件事仍然报得出来（带单号与已等多久）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, tradeNo } = await makeOverWindowOrder();

    await service.getOrderStatus({ userId: 9001, tradeNo });

    const line = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .find((text) => text.includes("recharge.grant_retry_window_exceeded"));
    expect(line).toBeDefined();
    expect(line).toContain(tradeNo);
    expect(line).toContain("已等=180 分钟");
  });

  it("★ 超窗的门票仍然一次都不打 billing（压频次没把重试也改回去）", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, tradeNo, http } = await makeOverWindowOrder();

    for (let i = 0; i < 5; i += 1) {
      await service.getOrderStatus({ userId: 9001, tradeNo });
    }

    expect(http.grantBodies).toHaveLength(0);
  });
});

describe("RechargeService — 重试窗口两条路同一个值", () => {
  beforeEach(() => {
    vi.stubEnv("PAY_SERVER_BASE_URL", "https://pay.example.com");
    vi.stubEnv(SYSTEM_SETTINGS_SECRET_ENV, "a".repeat(64));
    freshGrpcUrl();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const TUNED_WINDOW_MS = 45 * 60 * 1000;

  async function makeOrderHeld50Min(grantRetryWindowMs?: number) {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const made = await makeService(
      grantRetryWindowMs === undefined ? {} : { grantRetryWindowMs },
    );
    const created = await made.service.createOrder({ userId: 9001, tierId: TIER.id });
    const row = made.orders.get(created.tradeNo)!;
    row.status = "paid_pending";
    row.paid_pending_at = new Date(Date.now() - 50 * 60 * 1000);
    return { ...made, http, tradeNo: created.tradeNo };
  }

  it("★ 窗口调成 45 分钟：用户轮询那条路也按 45 分钟停（不再是硬编码的 120）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, tradeNo, http } = await makeOrderHeld50Min(TUNED_WINDOW_MS);

    const state = await service.getOrderStatus({ userId: 9001, tradeNo });

    expect(http.grantBodies).toHaveLength(0);
    expect(state.status).toBe("paid_pending");
    const line = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .find((text) => text.includes("recharge.grant_retry_window_exceeded"));
    expect(line).toBeDefined();
    expect(line).toContain("45 分钟");
    expect(line).not.toContain("120 分钟");
  });

  it("★ 同一个 45 分钟也管着扫描器：这一轮取不到它（进 abandoned、一单都不重试）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { service, orders, tradeNo, http } = await makeOrderHeld50Min(TUNED_WINDOW_MS);

    const result = await service.sweepStaleGrants({ claimMs: 60_000 });

    expect(result).toMatchObject({ scanned: 0, healed: 0, abandoned: 1 });
    expect(http.grantBodies).toHaveLength(0);
    expect(orders.get(tradeNo)?.status).toBe("paid_pending");
    const line = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .find((text) => text.includes("recharge.grant_retry_exhausted"));
    expect(JSON.parse(line as string)).toMatchObject({ count: 1, window_minutes: 45 });
  });

  it("★ 默认（2 小时）下同一笔单两条路都放行：可配不等于默认被改掉", async () => {
    const { service, tradeNo, http } = await makeOrderHeld50Min();

    const state = await service.getOrderStatus({ userId: 9001, tradeNo });

    expect(http.grantBodies).toHaveLength(1);
    expect(state.status).toBe("paid");
  });
});

describe("RechargeService — 管理端人工补发（E-1 的第三条出口）", () => {
  beforeEach(() => {
    vi.stubEnv("PAY_SERVER_BASE_URL", "https://pay.example.com");
    vi.stubEnv(SYSTEM_SETTINGS_SECRET_ENV, "a".repeat(64));
    freshGrpcUrl();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("★ 超窗的 paid_pending 单：人工点一下**能**补发（自动重试已停，这是唯一出口）", async () => {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const row = orders.get(created.tradeNo)!;
    row.status = "paid_pending";
    row.paid_pending_at = new Date(Date.now() - 3 * 60 * 60 * 1000);

    const result = await service.retryGrantForAdmin(created.tradeNo);

    expect(http.grantBodies).toHaveLength(1);
    expect(result.status).toBe("paid");
    expect(orders.get(created.tradeNo)?.status).toBe("paid");
  });

  it("★ 已标 grant_failed 的单也能人工补发（billing 恢复后人一点就通）", async () => {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(created.tradeNo)!.status = "grant_failed";

    const result = await service.retryGrantForAdmin(created.tradeNo);

    expect(result.status).toBe("paid");
    expect(http.grantBodies).toHaveLength(1);
  });

  it("★ 补发不是「点一下就必成」：仍失败时如实回当前状态，不编一个已到账", async () => {
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(created.tradeNo)!.status = "paid_pending";
    http.failNextGrants(1);

    const result = await service.retryGrantForAdmin(created.tradeNo);

    expect(result.status).toBe("paid_pending");
    expect(orders.get(created.tradeNo)?.status).toBe("paid_pending");
  });

  it("★ 未支付的单不能补发：从 pending 补发等于无中生有地发积分", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    await expect(service.retryGrantForAdmin(created.tradeNo)).rejects.toThrow(/尚未收到款项/);
    expect(orders.get(created.tradeNo)?.status).toBe("pending");
  });

  it("★ 已到账的单不给补发：说清楚「无需重试」，而不是报一个笼统的错", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(created.tradeNo)!.status = "paid";

    await expect(service.retryGrantForAdmin(created.tradeNo)).rejects.toThrow(/已经发放到账/);
  });

  it("单号不存在 → 404", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service } = await makeService();

    await expect(service.retryGrantForAdmin("RC-NOPE")).rejects.toThrow(/订单不存在/);
  });

  it("★ 补发失败**也回读状态**而不是抛错：管理端要记的是每一次尝试", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(created.tradeNo)!.status = "paid_pending";
    http.failNextGrants(1);

    const result = await service.retryGrantForAdmin(created.tradeNo);

    expect(result).toEqual({ tradeNo: created.tradeNo, status: "paid_pending" });
  });
});
