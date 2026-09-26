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
import type { TopupTierService } from "@lib/shared/topup-tier/topup-tier.service.js";
import { deriveCredits, RechargeService } from "./recharge.service.js";

/* ============================================
 * 充值到账的账实一致：这是钱路径，测的是「会不会多发一次」「会不会按错的数发」。
 *
 * 用内存假 Prisma 而不是 vi.fn 桩：条件更新（`status != paid`、查单名额）正是幂等的实现本身，
 * 桩掉它等于把要测的东西测没。
 *
 * ⚠️ 换算率（`fetchCreditsPerYuan`）读的是**定价目录的 gRPC 接口**，不再是 HTTP ——
 *    所以它由 `grpcActiveCatalog()` 桩，HTTP 那套只剩发放（`grantCredits` 尚未迁）。
 * ============================================ */

// 只做转发，「装哪个 router」在 billing-admin-grpc-stub.testlib.ts 里（三个测试文件同一套）。
vi.mock("@connectrpc/connect-node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect-node")>();
  return {
    ...actual,
    createGrpcTransport: () => grpcStubTransport(),
  };
});

const APP_SECRET = "s3cret";
const NOTIFY_URL = "https://api.example.com/api/recharge/notify/pay";

type Row = Record<string, unknown>;

function makePrisma() {
  const orders = new Map<string, Row>();
  const settings = new Map<string, Row>();
  /**
   * 状态列**被写入**的顺序（每次 updateMany 命中就记一笔）。
   *
   * <p>要的不只是最终值：`paid_pending` 与 `paid` 这两个写入的**先后**正是本次设计的核心，
   * 只看终值的话「先写 paid、事后补一次 paid_pending」也是绿的。
   */
  const statusWrites: string[] = [];

  const matches = (row: Row, where: Row): boolean => {
    if (where.trade_no !== undefined && row.trade_no !== where.trade_no) return false;
    const status = where.status as
      | { not?: string; notIn?: string[] }
      | string
      | undefined;
    if (typeof status === "string" && row.status !== status) return false;
    if (status && typeof status === "object") {
      if (status.not !== undefined && row.status === status.not) return false;
      // notIn 也要实现：`markPaidPending` 的「钱还没到」正是靠它做的条件更新，
      // 桩成「总是命中」等于把要测的幂等本身测没了
      if (status.notIn !== undefined && status.notIn.includes(String(row.status))) {
        return false;
      }
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
      if (key === "status") statusWrites.push(String(value));
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
  return { prisma, orders, statusWrites };
}

/** 网关 + 发放（HTTP）的桩，按 URL 分流并记录调用。目录与余额都走 gRPC，不在这里。 */
function makeHttp(gatewayState = 1) {
  const granted: { amount: number; bizId: string }[] = [];
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  /** 接下来 N 次发放请求返回 500（模拟 billing 抖动），用来观测「发放失败后重投」那条路。 */
  let grantFailures = 0;

  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    calls.push({ url: target, body });

    if (target.endsWith("/admin/credits/grants")) {
      if (grantFailures > 0) {
        grantFailures -= 1;
        return new Response("boom", { status: 500 });
      }
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
    setGatewayState: (v: number) => {
      gatewayState = v;
    },
    failNextGrants: (n: number) => {
      grantFailures = n;
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
  version: 3,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

async function makeService() {
  const { prisma, orders, statusWrites } = makePrisma();
  const settings = new SystemSettingsService({ client: prisma } as never);
  await settings.update({
    credentials: {
      hccb_mch_no: "M0001",
      hccb_app_id: "app-1",
      hccb_app_secret: APP_SECRET,
      hccb_notify_url: NOTIFY_URL,
    },
  });
  // 档位**可变**：`config_version` 快照的是下单那一刻的 version，
  // 所以测试要能中途把版本推上去，再看已创建订单有没有被连带改掉
  let tier = { ...TIER };
  const tiers = {
    listActive: async () => [tier],
    getById: async (id: string) => (id === tier.id ? tier : null),
  } as unknown as TopupTierService;
  const service = new RechargeService({ client: prisma } as never, tiers, settings);
  return {
    service,
    orders,
    settings,
    statusWrites,
    setTierVersion: (v: number) => {
      tier = { ...tier, version: v };
    },
  };
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
    freshGrpcUrl();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("金额单位是分、积分按原价×换算率冻结，收银台链接原样返回", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
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
    makeHttp();
    const catalog = grpcActiveCatalog();
    const { service, orders } = await makeService();

    const before = await service.createOrder({ userId: 9001, tierId: TIER.id });
    expect(before.credits).toBe(1500);

    catalog.setCreditsPerYuan(20);
    expect((await service.listTiers()).tiers[0]?.amount).toBe(2000);
    expect((await service.listTiers()).creditsPerYuan).toBe(20);

    // 旧订单没被改口径影响：它冻结的就是 1500
    const order = orders.get(before.tradeNo);
    expect(order?.credits).toBe(1500n);
  });

  it("下单写入 8 个快照字段：config_version 取档位**当时**的 version", async () => {
    makeHttp();
    grpcActiveCatalog();
    const { service, orders, setTierVersion } = await makeService();

    const first = await service.createOrder({ userId: 9001, tierId: TIER.id });

    const row = orders.get(first.tradeNo);
    expect(row?.product_type).toBe("tier");
    // 商品名是**用户当时看到的展示名**，不是库里那列原始名——自动生成的名字会随换算率
    // 重新派生（`displayTierName`），快照要回答的是「用户当时看到的是哪件商品」
    expect(row?.product_name).toBe("1500积分");
    // 下面这几列此刻还是常量：#40 首购加赠 / #43 有效期落地后才变成计算值
    expect(row?.bonus_credits).toBe(0n);
    expect(row?.credits_expire_at).toBeNull();
    expect(row?.first_purchase_state).toBe("unknown");
    expect(row?.first_purchase_eligible).toBe(0);
    expect(row?.permission_result).toBe("allowed");
    expect(row?.config_version).toBe(3);

    // 运营改配置（保存一次 version +1）之后：新单记新版本，**老单不动**——快照的意义就在这
    setTierVersion(4);
    const second = await service.createOrder({ userId: 9001, tierId: TIER.id });
    expect(orders.get(second.tradeNo)?.config_version).toBe(4);
    expect(orders.get(first.tradeNo)?.config_version).toBe(3);
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
    const tiers = {
      listActive: async () => [],
      getById: async () => ({ ...TIER, status: "inactive" as const }),
    } as unknown as TopupTierService;
    const service = new RechargeService({ client: prisma } as never, tiers, settings);

    await expect(service.createOrder({ userId: 1, tierId: "7" })).rejects.toThrow(/已下架/);
  });

  it("★ 档位还是草稿 → 拒绝下单，且**不说「已下架」**", async () => {
    // 草稿与下架都不可买，但话不能说成同一句（PRD §6.3 / §10.5）：
    // 「已下架」说的是一个曾经卖过的东西，而草稿是还没上过架 ——
    // 对着一张运营刚建好、字段还没配齐的卡片说「已下架」，客服和用户都无从下手。
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
    const tiers = {
      listActive: async () => [],
      getById: async () => ({ ...TIER, status: "draft" as const }),
    } as unknown as TopupTierService;
    const service = new RechargeService({ client: prisma } as never, tiers, settings);

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

    expect(http.granted).toEqual([{ amount: 1500, bizId: created.tradeNo }]);
    const order = orders.get(created.tradeNo);
    expect(order?.status).toBe("paid");
    expect(order?.grant_lot_id).toBe(42n);
    expect(order?.paid_at).toBeInstanceOf(Date);
    // 顺序本身要钉住：只看最终值是 paid 的话，「先写 paid、事后补一次 paid_pending」也是绿的。
    // 发放失败时订单必须**看得见**地停在 paid_pending，这个顺序就是那个保证。
    expect(statusWrites).toEqual(["paid_pending", "paid"]);
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

    // 本地这把锁的效果：重投被 `status=paid` 短路，**一次都没再打 billing**
    const grants = http.calls.filter((c) => c.url.endsWith("/admin/credits/grants"));
    expect(grants).toHaveLength(1);
    // 后面两次也没再写状态（短路发生在状态写入之前）
    expect(statusWrites).toEqual(["paid_pending", "paid"]);
    // billing 那把锁的效果：积分只发了一次
    expect(http.granted).toHaveLength(1);
    expect(http.granted[0]?.amount).toBe(1500);
  });

  it("已是 paid_pending 的重投：**重试发放**（白给的重试机会不能短路掉）", async () => {
    const http = makeHttp();
    grpcActiveCatalog();
    const { service, orders, statusWrites } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    const params = await signed(notifyParams(created.tradeNo));

    // 第一次发放失败 → 订单停在 paid_pending（钱到了，积分没发）
    http.failNextGrants(1);
    expect(await service.handleNotify(params)).toBe(false);
    expect(orders.get(created.tradeNo)?.status).toBe("paid_pending");

    // 网关重投：这时**不能**像 paid 那样短路，要继续往下走真的再发一次
    expect(await service.handleNotify(params)).toBe(true);
    expect(orders.get(created.tradeNo)?.status).toBe("paid");
    expect(http.granted).toEqual([{ amount: 1500, bizId: created.tradeNo }]);
    // 两次发放请求（第二次才成功）；paid_pending 只写了一次——「钱还没到」的条件更新挡住了重写
    expect(http.calls.filter((c) => c.url.endsWith("/admin/credits/grants"))).toHaveLength(2);
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
    makeHttp();
    grpcActiveCatalog();
    const { service, orders, statusWrites } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    // 换掉 fetch：发放接口 500。目录与余额都走 gRPC，不经过这里 —— 所以除了发放
    // 之外的请求一律抛，避免把「多打了一个 HTTP」当成通过
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        if (String(url).endsWith("/admin/credits/grants")) {
          return new Response("boom", { status: 500 });
        }
        throw new Error(`未预期的请求：${String(url)}`);
      }),
    );

    expect(await service.handleNotify(await signed(notifyParams(created.tradeNo)))).toBe(false);
    // 停在 paid_pending 是本次设计的重点：这条单**钱已经收了**，客服一眼能看出来；
    // 退回 pending 就与「用户还没付钱」不可分辨（那是扩状态前的老毛病）
    expect(orders.get(created.tradeNo)?.status).toBe("paid_pending");
    expect(statusWrites).toEqual(["paid_pending"]);
  });
});

describe("RechargeService — 查单补偿（回调丢失时）", () => {
  beforeEach(() => {
    vi.stubEnv("PAY_SERVER_BASE_URL", "https://pay.example.com");
    vi.stubEnv("BILLING_ADMIN_URL", "https://billing.example.com");
    vi.stubEnv(SYSTEM_SETTINGS_SECRET_ENV, "a".repeat(64));
    freshGrpcUrl();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("网关侧已支付而回调丢了 → 用户查单时补发积分", async () => {
    const http = makeHttp(2); // 网关查单返回「支付成功」
    // 只装目录（下单要换算率），**不装**查余额那条：余额查不到不该让查单整体失败
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(state.status).toBe("paid");
    expect(state.creditsAfter).toBeNull();
    expect(http.granted).toEqual([{ amount: 1500, bizId: created.tradeNo }]);
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
    makeHttp(1); // 网关侧仍是「支付中」
    grpcActiveCatalog();
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
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });
    orders.get(created.tradeNo)!.gmt_create = new Date(Date.now() - 31 * 60 * 1000);

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(state.status).toBe("paid");
    expect(http.granted).toEqual([{ amount: 1500, bizId: created.tradeNo }]);
  });

  it("★ 停在「待到账」的单，用户轮询会**补发**（不补就永远卡在发放中）", async () => {
    // ⚠️ 这条守的是**拆状态引入的一个回归**：网关重投窗口只有约 15 分钟，过了就没人补发。
    //    拆状态之前，发放失败的单留在 `pending`，用户轮询会经 reconcile（问网关→补发）自愈；
    //    拆完之后单停在 `paid_pending`，而查询路径若只认 `pending`，这类单就**再也不会自愈** ——
    //    用户永远停在「发放中」，比旧行为还差。
    //
    //    补发不再问网关（钱已确认收到），直接调 fulfill：它先 markPaidPending（条件更新，
    //    已达则不动作）再发放，发放走 billing 的幂等键，重复调用不会重复发积分。
    const http = makeHttp(2);
    grpcActiveCatalog();
    const { service, orders } = await makeService();
    const created = await service.createOrder({ userId: 9001, tierId: TIER.id });

    // 造出「钱到了、积分没发成功」——这正是 paid_pending 要表达的那个状态
    orders.get(created.tradeNo)!.status = "paid_pending";

    const state = await service.getOrderStatus({ userId: 9001, tradeNo: created.tradeNo });

    expect(http.granted).toEqual([{ amount: 1500, bizId: created.tradeNo }]);
    expect(state.status).toBe("paid");
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
