/* ============================================
 * 充值测试的共享夹具（内存假 Prisma + 网关/发放 HTTP 桩 + 默认定档位与配置）。
 *
 * 抽成 `*.testlib.ts`（tsconfig 排除编译、vitest 不当用例文件收集，同
 * `billing-admin-grpc-stub.testlib.ts` / `skill-repo.testlib.ts`）：自定义充值（模块 B）
 * 的下单用例与档位/回调用例要的是**同一套**假库 —— 各写一份就会各漏一处，
 * 而这里桩掉的正是幂等本身（条件更新），漏一处就等于把钱路径的断言测没。
 *
 * ⚠️ `vi.mock("@connectrpc/connect-node", …)` 必须留在各测试文件里（vitest 会把它
 *    提升到 import 之前执行，写进本模块就作用不到被测模块）—— 与 `billing-admin-grpc-stub`
 *    同一条注意事项。
 * ============================================ */
import { vi } from "vitest";
import { SystemSettingsService } from "@lib/shared/system-settings/index.js";
import type { TopupTierService } from "@lib/shared/topup-tier/topup-tier.service.js";
import { RechargeCustomService } from "@lib/shared/recharge-custom/recharge-custom.service.js";
import { RechargeService } from "./recharge.service.js";

export const APP_SECRET = "s3cret";
export const NOTIFY_URL = "https://api.example.com/api/recharge/notify/pay";

export type Row = Record<string, unknown>;

export function makePrisma() {
  const orders = new Map<string, Row>();
  const settings = new Map<string, Row>();
  /** 自定义充值配置（单行，模块 B）。测试想要「配置变了」就直接改这一行 */
  const customConfig = new Map<number, Row>();
  /**
   * 状态列**被写入**的顺序（每次 updateMany 命中就记一笔）。
   *
   * <p>要的不只是最终值：`paid_pending` 与 `paid` 这两个写入的**先后**正是本次设计的核心，
   * 只看终值的话「先写 paid、事后补一次 paid_pending」也是绿的。
   */
  const statusWrites: string[] = [];

  const matches = (row: Row, where: Row): boolean => {
    for (const [key, cond] of Object.entries(where)) {
      // OR 是「任一子句命中」：主动对账的取数（`paid_pending_at` 为空时退回 `gmt_create`）
      // 与查单名额（`last_query_at`）都靠它，桩成恒真等于把要测的两件事都测没
      if (key === "OR") {
        if (!(cond as Row[]).some((clause) => matches(row, clause))) return false;
        continue;
      }
      if (!matchesValue(row[key], cond)) return false;
    }
    return true;
  };

  /** 一条列条件：等值 / `null` / `not` / `notIn` / `in` / `lt`。 */
  const matchesValue = (current: unknown, cond: unknown): boolean => {
    if (cond === null) return current === null || current === undefined;
    if (cond !== null && typeof cond === "object") {
      const c = cond as Row;
      if ("not" in c) return current !== c.not;
      // notIn / in 比的是**状态字符串**（BigInt 列不进这两支），故按 String 统一
      if ("notIn" in c) return !(c.notIn as unknown[]).includes(String(current));
      if ("in" in c) return (c.in as unknown[]).map(String).includes(String(current));
      if ("lt" in c) {
        const at = current as Date | null | undefined;
        return at instanceof Date && at.getTime() < (c.lt as Date).getTime();
      }
      return false;
    }
    return current === cond;
  };

  /** 取行：where + orderBy + take（充值的两条新查询要的是这个，不是「按主键取一条」）。 */
  const select = (args: { where: Row; orderBy?: Row[]; take?: number }): Row[] => {
    const rows = [...orders.values()].filter((row) => matches(row, args.where));
    const orderBy = args.orderBy ?? [];
    if (orderBy.length > 0) {
      rows.sort((a, b) => {
        for (const clause of orderBy) {
          const [key, dir] = Object.entries(clause)[0] as [string, string];
          const av = a[key];
          const bv = b[key];
          const at = av instanceof Date ? av.getTime() : Number(av ?? 0);
          const bt = bv instanceof Date ? bv.getTime() : Number(bv ?? 0);
          if (at !== bt) return dir === "desc" ? bt - at : at - bt;
        }
        return 0;
      });
    }
    return args.take === undefined ? rows : rows.slice(0, args.take);
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
          cashier_url: null,
          status: "pending",
          paid_at: null,
          paid_pending_at: null,
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
      findFirst: async ({ where, orderBy }: { where: Row; orderBy?: Row[] }) =>
        select({ where, ...(orderBy ? { orderBy } : {}) })[0] ?? null,
      findMany: async ({
        where,
        orderBy,
        take,
      }: {
        where: Row;
        orderBy?: Row[];
        take?: number;
      }) => select({ where, ...(orderBy ? { orderBy } : {}), ...(take !== undefined ? { take } : {}) }),
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const hits = [...orders.values()].filter((row) => matches(row, where));
        for (const row of hits) apply(row, data);
        return { count: hits.length };
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
    // 自定义充值配置是**单行表**（模块 B）：这里同样只留一行，`id` 恒为 1
    recharge_custom_config: {
      findUnique: async ({ where }: { where: Row }) =>
        customConfig.get(Number(where.id)) ?? null,
      upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const id = Number(where.id);
        const existing = customConfig.get(id);
        if (existing) apply(existing, update);
        else customConfig.set(id, { ...create });
        return customConfig.get(id);
      },
    },
  };
  return { prisma, orders, statusWrites, customConfig };
}

/**
 * 自定义充值配置的默认行（PRD §7.1 逐字：600 / 499995 / 600 / 15 / 24 个月）。
 *
 * <p>放在测试里而不是生产代码里，是因为它**只是测试的起点**：生产那份由迁移 050 种下，
 * 代码里没有任何地方复制这几个数字（PRD §6.1「不在代码中写死」）。
 */
export function defaultCustomConfigRow(overrides: Row = {}): Row {
  return {
    id: 1,
    min_credits: BigInt(600),
    max_credits: BigInt(499_995),
    default_credits: BigInt(600),
    credits_per_yuan: 15,
    step_credits: BigInt(15),
    enabled: 1,
    permission: "all",
    permission_allowlist: null,
    permission_denied_hint: "",
    credits_valid_months: 24,
    version: 5,
    gmt_create: new Date("2026-09-27T00:00:00.000Z"),
    gmt_modified: new Date("2026-09-27T00:00:00.000Z"),
    ...overrides,
  };
}

/** 网关 + 发放（HTTP）的桩，按 URL 分流并记录调用。目录与余额都走 gRPC，不在这里。 */
export function makeHttp(gatewayState = 1) {
  const granted: { amount: number; bizId: string }[] = [];
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  /** 接下来 N 次发放请求返回 500（模拟 billing 抖动），用来观测「发放失败后重投」那条路。 */
  let grantFailures = 0;
  /** 接下来 N 次统一下单返回业务失败，用来造「落库了但没拿到收银台链接」的单。 */
  let unifiedOrderFailures = 0;

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
      if (unifiedOrderFailures > 0) {
        unifiedOrderFailures -= 1;
        // 网关业务失败（`code != 0`）→ 调用方抛 PayGatewayError。这一支用来造
        // 「订单行落了库、但从来没拿到过收银台链接」那种单
        return json({ code: 1, msg: "商户订单[RC...]已存在", data: null });
      }
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
    failNextUnifiedOrders: (n: number) => {
      unifiedOrderFailures = n;
    },
  };
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

export const TIER = {
  id: "7",
  name: "1000积分",
  /**
   * ⚠️ **基础积分是配置值**：7,500 与 `原价 100 × 换算率 15 = 1,500` **刻意不同**。
   * 任何一个「还在按原价派生积分」的实现都会在这条线上红 —— 那正是本次要钉住的事
   * （充值常有折扣，¥499 的档给 7,500 而不是 7,485）。
   */
  baseCredits: 7_500,
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

export type Tier = typeof TIER;

export async function makeService() {
  const { prisma, orders, statusWrites, customConfig } = makePrisma();
  // 默认种一份 PRD §7.1 的配置：档位单用不到它，自定义充值单（模块 B）全靠它报价
  customConfig.set(1, defaultCustomConfigRow());
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
  // 所以测试要能中途把版本推上去，再看已创建订单有没有被连带改掉。
  // 用 Map 而不是单个变量：下单防重要能造出「换了档位」与「同一档位改了配置」两种情形
  const tiersById = new Map<string, Tier>();
  tiersById.set(TIER.id, { ...TIER });
  const tiers = {
    listActive: async () => [...tiersById.values()],
    getById: async (id: string) => tiersById.get(id) ?? null,
  } as unknown as TopupTierService;
  const service = new RechargeService(
    { client: prisma } as never,
    tiers,
    settings,
    new RechargeCustomService({ client: prisma } as never),
  );
  return {
    service,
    orders,
    settings,
    statusWrites,
    /** 覆盖自定义充值配置的某一列（模拟运营在后台改了配置） */
    setCustomConfig: (patch: Row) => {
      customConfig.set(1, { ...(customConfig.get(1) ?? defaultCustomConfigRow()), ...patch });
    },
    /** 再挂一个档位（测「换了档位不该被当成重复点击」） */
    addTier: (t: Tier) => {
      tiersById.set(t.id, { ...t });
    },
    /** 覆盖某个档位的列（模拟运营改配置：到账积分、价格、状态…） */
    setTier: (patch: Partial<Tier>, id: string = TIER.id) => {
      const current = tiersById.get(id);
      if (!current) throw new Error(`没有这个档位：${id}`);
      tiersById.set(id, { ...current, ...patch });
    },
    setTierVersion: (v: number) => {
      const current = tiersById.get(TIER.id)!;
      tiersById.set(TIER.id, { ...current, version: v });
    },
  };
}

/** 网关回调的报文（真实字段集，金额单位分，`state=2` 表示支付成功）。 */
export function notifyParams(tradeNo: string, overrides: Record<string, string> = {}) {
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

export async function signed(params: Record<string, string>): Promise<Record<string, string>> {
  const { paySign } = await import("@lib/shared/pay-server/pay-sign.js");
  return { ...params, sign: paySign(params, APP_SECRET) };
}
