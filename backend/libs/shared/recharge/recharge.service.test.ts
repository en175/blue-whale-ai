import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SYSTEM_SETTINGS_SECRET_ENV,
  SystemSettingsService,
} from "@lib/shared/system-settings/index.js";
import type { TopupTierService } from "@lib/shared/topup-tier/topup-tier.service.js";
import { deriveCredits, RechargeService } from "./recharge.service.js";

/* ============================================
 * 充值到账的账实一致：这是钱路径，测的是「会不会多发一次」「会不会按错的数发」。
 *
 * 用内存假 Prisma 而不是 vi.fn 桩：条件更新（`status != paid`、查单名额）正是幂等的实现本身，
 * 桩掉它等于把要测的东西测没。
 * ============================================ */

const APP_SECRET = "s3cret";
const NOTIFY_URL = "https://api.example.com/api/recharge/notify/pay";

type Row = Record<string, unknown>;

function makePrisma() {
  const orders = new Map<string, Row>();
  const settings = new Map<string, Row>();

  const matches = (row: Row, where: Row): boolean => {
    if (where.trade_no !== undefined && row.trade_no !== where.trade_no) return false;
    const status = where.status as { not?: string } | string | undefined;
    if (typeof status === "string" && row.status !== status) return false;
    if (status && typeof status === "object" && status.not !== undefined) {
      if (row.status === status.not) return false;
    }
    if (where.pay_order_id === null && row.pay_order_id !== null) return false;
    const or = where.OR as Row[] | undefined;
    if (or) {
      const ok = or.some((clause) => {
        if (clause.last_query_at === null) return row.last_query_at === null;
        const lt = (clause.last_query_at as { lt?: Date } | undefined)?.lt;
        if (lt) {
          const current = row.last_query_at as Date | null;
          return current !== null && current.getTime() < lt.getTime();
        }
        return false;
      });
      if (!ok) return false;
    }
    return true;
  };

  const apply = (row: Row, data: Row): void => {
    for (const [key, value] of Object.entries(data)) {
      if (value && typeof value === "object" && "increment" in (value as Row)) {
        row[key] = Number(row[key] ?? 0) + Number((value as { increment: number }).increment);
      } else {
        row[key] = value;
      }
    }
  };

  const prisma = {
    recharge_orders: {
      create: async ({ data }: { data: Row }) => {
        const row: Row = {
          id: BigInt(orders.size + 1),
          pay_order_id: null,
          status: "pending",
          paid_at: null,
          grant_lot_id: null,
          last_query_at: null,
          notify_count: 0,
          is_delete: 0,
          gmt_create: new Date(),
          gmt_modified: new Date(),
          ...data,
        };
        orders.set(String(data.trade_no), row);
        return row;
      },
      findFirst: async ({ where }: { where: Row }) => {
        const row = orders.get(String(where.trade_no));
        return row && row.is_delete === 0 ? row : null;
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const row = orders.get(String((where as Row).trade_no));
        if (!row || !matches(row, where)) return { count: 0 };
        apply(row, data);
        return { count: 1 };
      },
    },
    system_settings: {
      findUnique: async ({ where }: { where: Row }) =>
        settings.get(String(where.setting_key)) ?? null,
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const key = String(where.setting_key);
        const existing = settings.get(key);
        if (existing) apply(existing, update);
        else settings.set(key, { ...create });
        return settings.get(key);
      },
    },
  };
  return { prisma, orders };
}

/** 网关 + billing 管理端的 HTTP 桩，按 URL 分流并记录调用。 */
function makeHttp(gatewayState = 1) {
  const granted: { amount: number; bizId: string }[] = [];
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let creditsPerYuan = 15;

  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url: target, body });

    if (target.endsWith("/admin/catalogs/active")) {
      return json({ catalogVersion: 1, creditsPerYuan });
    }
    if (target.endsWith("/admin/credits/grants")) {
      const bizId = String(body.bizId);
      if (granted.some((g) => g.bizId === bizId)) {
        return new Response(JSON.stringify({ code: "DUPLICATE" }), { status: 409 });
      }
      granted.push({ amount: Number(body.amount), bizId });
      return json({ lotId: 42, userId: body.userId, source: "purchased", amount: body.amount });
    }
    if (target.endsWith("/api/pay/unifiedOrder")) {
      return json({
        code: 0,
        msg: "SUCCESS",
        data: {
          payOrderId: "P-GATEWAY-1",
          orderState: 1,
          payDataType: "codeUrl",
          payData: "https://test.hccb.cc/uniCashierNew.html?tokenCode=abc",
        },
      });
    }
    if (target.endsWith("/api/pay/query")) {
      return json({
        code: 0,
        msg: "SUCCESS",
        data: { payOrderId: "P-GATEWAY-1", mchOrderNo: body.mchOrderNo, state: gatewayState, amount: 10000 },
      });
    }
    throw new Error(`未预期的请求：${target}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  return {
    granted,
    calls,
    setCreditsPerYuan: (v: number) => {
      creditsPerYuan = v;
    },
    setGatewayState: (v: number) => {
      gatewayState = v;
    },
  };
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const TIER = {
  id: "7",
  name: "1000积分",
  amount: 5_000_000,
  originalPrice: 100,
  discount: 1,
  price: 100,
  isRecommended: false,
  status: "active" as const,
  startTime: null,
  endTime: null,
  sortOrder: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

async function makeService() {
  const { prisma, orders } = makePrisma();
  const settings = new SystemSettingsService({ client: prisma } as never);
  await settings.update({
    credentials: {
      hccb_mch_no: "M0001",
      hccb_app_id: "app-1",
      hccb_app_secret: APP_SECRET,
      hccb_notify_url: NOTIFY_URL,
    },
  });
  const tiers = {
    listActive: async () => [TIER],
    getById: async (id: string) => (id === TIER.id ? TIER : null),
  } as unknown as TopupTierService;
  const service = new RechargeService({ client: prisma } as never, tiers, settings);
  return { service, orders, settings };
}

/** 网关回调的报文（真实字段集，金额单位分，`state=2` 表示支付成功）。 */
function notifyParams(tradeNo: string, overrides: Record<string, string> = {}) {
  return {
    payOrderId: "P-GATEWAY-1",
    mchNo: "M0001",
    appId: "app-1",
    mchOrderNo: tradeNo,
    ifCode: "hccb",
    wayCode: "HCCB_QR",
    state: "2",
    amount: "10000",
    ...overrides,
  };
}

async function signed(params: Record<string, string>): Promise<Record<string, string>> {
  const { paySign } = await import("@lib/shared/pay-server/pay-sign.js");
  return { ...params, sign: paySign(params, APP_SECRET) };
}

describe("RechargeService — 下单", () => {
  beforeEach(() => {
    vi.stubEnv("PAY_SERVER_BASE_URL", "https://pay.example.com");
    vi.stubEnv("BILLING_ADMIN_URL", "https://billing.example.com");
    vi.stubEnv(SYSTEM_SETTINGS_SECRET_ENV, "a".repeat(64));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("金额单位是分、积分按原价×换算率冻结，收银台链接原样返回", async () => {
    const http = makeHttp();
    const { service, orders } = await makeService();

    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    // 100 元 → 10000 分；100 元 × 15 = 1500 积分
    expect(created.amount).toBe(100);
    expect(created.credits).toBe(1500);
    expect(created.cashierUrl).toContain("uniCashierNew.html");
    expect(created.tradeNo).toMatch(/^RC\d{14}[0-9a-f]{8}$/);

    const order = orders.get(created.tradeNo);
    expect(order?.amount_fen).toBe(10_000n);
    expect(order?.credits).toBe(1500n);
    expect(order?.credits_per_yuan).toBe(15);
    expect(order?.status).toBe("pending");
    expect(order?.pay_order_id).toBe("P-GATEWAY-1");

    const unified = http.calls.find((c) => c.url.endsWith("/api/pay/unifiedOrder"));
    expect(unified?.body.amount).toBe(10_000);
    expect(unified?.body.wayCode).toBe("HCCB_QR");
    expect(unified?.body.notifyUrl).toBe(NOTIFY_URL);
  });

  it("换算率改成 20 后：新档位展示跟着变，已下订单仍按冻结的 15 发", async () => {
    const http = makeHttp();
    const { service, orders } = await makeService();

    const before = await service.createOrder({ userId: 9001, tierId: TIER.id });
    expect(before.credits).toBe(1500);

    http.setCreditsPerYuan(20);
    expect((await service.listTiers()).tiers[0]?.amount).toBe(2000);
    expect((await service.listTiers()).creditsPerYuan).toBe(20);

    // 旧订单没被改口径影响：它冻结的就是 1500
    const order = orders.get(before.tradeNo);
    expect(order?.credits).toBe(1500n);
  });

  it("档位下架 → 拒绝下单", async () => {
    makeHttp();
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
    const tiers = {
      listActive: async () => [],
      getById: async () => ({ ...TIER, status: "inactive" as const }),
    } as unknown as TopupTierService;
    const service = new RechargeService({ client: prisma } as never, tiers, settings);

    await expect(service.createOrder({ userId: 1, tierId: "7" })).rejects.toThrow(/已下架/);
  });

  it("商户凭证没配全 → 拒绝下单，不带着半份配置去调用网关", async () => {
    const http = makeHttp();
    const { prisma } = makePrisma();
    const settings = new SystemSettingsService({ client: prisma } as never);
    await settings.update({
      credentials: { hccb_mch_no: "M0001", hccb_app_id: "", hccb_app_secret: "", hccb_notify_url: "" },
    });
    const tiers = {
      listActive: async () => [TIER],
      getById: async () => TIER,
    } as unknown as TopupTierService;
    const service = new RechargeService({ client: prisma } as never, tiers, settings);

    await expect(service.createOrder({ userId: 1, tierId: "7" })).rejects.toThrow(
      /支付商户信息未配置完整/,
    );
    expect(http.calls.some((c) => c.url.endsWith("/api/pay/unifiedOrder"))).toBe(false);
  });
});

describe("RechargeService — 回调到账", () => {
  beforeEach(() => {
    vi.stubEnv("PAY_SERVER_BASE_URL", "https://pay.example.com");
    vi.stubEnv("BILLING_ADMIN_URL", "https://billing.example.com");
    vi.stubEnv(SYSTEM_SETTINGS_SECRET_ENV, "a".repeat(64));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("首次回调：发放积分并置为 paid", async () => {
    const http = makeHttp();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    expect(await service.handleNotify(await signed(notifyParams(created.tradeNo)))).toBe(true);

    expect(http.granted).toEqual([{ amount: 1500, bizId: created.tradeNo }]);
    const order = orders.get(created.tradeNo);
    expect(order?.status).toBe("paid");
    expect(order?.grant_lot_id).toBe(42n);
    expect(order?.paid_at).toBeInstanceOf(Date);
  });

  it("重复回调（网关重投）：积分只发一次，且仍应答 SUCCESS", async () => {
    const http = makeHttp();
    const { service } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const params = await signed(notifyParams(created.tradeNo));

    expect(await service.handleNotify(params)).toBe(true);
    expect(await service.handleNotify(params)).toBe(true);
    expect(await service.handleNotify(params)).toBe(true);

    // 本地这把锁的效果：重投被 `status=paid` 短路，**一次都没再打 billing**
    const grants = http.calls.filter((c) => c.url.endsWith("/admin/credits/grants"));
    expect(grants).toHaveLength(1);
    // billing 那把锁的效果：积分只发了一次
    expect(http.granted).toHaveLength(1);
    expect(http.granted[0]?.amount).toBe(1500);
  });

  it("回调金额与订单不符：不发放、不应答 SUCCESS（让网关重投并留痕）", async () => {
    const http = makeHttp();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    const tampered = await signed(notifyParams(created.tradeNo, { amount: "1" }));
    expect(await service.handleNotify(tampered)).toBe(false);

    expect(http.granted).toHaveLength(0);
    expect(orders.get(created.tradeNo)?.status).toBe("pending");
  });

  it("验签失败：不发放、不应答 SUCCESS", async () => {
    const http = makeHttp();
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
    const { service } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const params = await signed(notifyParams(created.tradeNo, { state: "1" }));
    expect(await service.handleNotify(params)).toBe(false);
    expect(http.granted).toHaveLength(0);
  });

  it("渠道不符 / 支付方式不符：拒绝（这条通道只认杭州银行）", async () => {
    const http = makeHttp();
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

  it("发放失败（billing 不可用）：不应答 SUCCESS，但订单不置 paid", async () => {
    makeHttp();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    // 换掉 fetch：发放接口 500，其余照常
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        if (String(url).endsWith("/admin/credits/grants")) {
          return new Response("boom", { status: 500 });
        }
        return json({ catalogVersion: 1, creditsPerYuan: 15 });
      }),
    );

    expect(await service.handleNotify(await signed(notifyParams(created.tradeNo)))).toBe(false);
    expect(orders.get(created.tradeNo)?.status).toBe("pending");
  });
});

describe("RechargeService — 查单补偿（回调丢失时）", () => {
  beforeEach(() => {
    vi.stubEnv("PAY_SERVER_BASE_URL", "https://pay.example.com");
    vi.stubEnv("BILLING_ADMIN_URL", "https://billing.example.com");
    vi.stubEnv(SYSTEM_SETTINGS_SECRET_ENV, "a".repeat(64));
    vi.stubEnv("BILLING_GRPC_URL", "http://billing.invalid:4004");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("网关侧已支付而回调丢了 → 用户查单时补发积分", async () => {
    const http = makeHttp(2); // 网关查单返回「支付成功」
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    // 余额查不到（这里没有 gRPC 服务）不该让查单整体失败，只影响 credits_after
    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(state.status).toBe("paid");
    expect(state.creditsAfter).toBeNull();
    expect(http.granted).toEqual([{ amount: 1500, bizId: created.tradeNo }]);
    expect(orders.get(created.tradeNo)?.status).toBe("paid");
  });

  it("查单补偿有限流：同一笔订单 30 秒内不重复问网关", async () => {
    const http = makeHttp(1);
    const { service } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });
    await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });
    await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    const queries = http.calls.filter((c) => c.url.endsWith("/api/pay/query"));
    expect(queries).toHaveLength(1);
  });

  it("令牌过期且网关未成功 → 置过期（给用户明确终态，不让轮询一直转）", async () => {
    makeHttp(1); // 网关侧仍是「支付中」
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    // 把建单时间拨到 31 分钟前（银行收银台令牌已失效）
    orders.get(created.tradeNo)!.gmt_create = new Date(Date.now() - 31 * 60 * 1000);

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(state.status).toBe("expired");
    expect(orders.get(created.tradeNo)?.status).toBe("expired");
  });

  it("网关说成功时，即使本地已过令牌期也以到账为准（钱比时钟权威）", async () => {
    const http = makeHttp(2);
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(created.tradeNo)!.gmt_create = new Date(Date.now() - 31 * 60 * 1000);

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(state.status).toBe("paid");
    expect(http.granted).toEqual([{ amount: 1500, bizId: created.tradeNo }]);
  });

  it("别人的订单当作不存在：不泄漏「这个单号存在」", async () => {
    makeHttp();
    const { service } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    await expect(
      service.getOrderStatus({ userId: 1234, tradeNo: created.tradeNo }),
    ).rejects.toThrow(/订单不存在/);
  });
});

describe("deriveCredits — 换算率是唯一的积分来源", () => {
  it("按原价折算并取整（账本只有整数积分）", () => {
    expect(deriveCredits(100, 15)).toBe(1500);
    expect(deriveCredits(99, 15)).toBe(1485);
    expect(deriveCredits(1, 1)).toBe(1);
    // 改口径 = 改目录，不改代码
    expect(deriveCredits(100, 20)).toBe(2000);
    expect(deriveCredits(100, 7)).toBe(700);
  });
});
