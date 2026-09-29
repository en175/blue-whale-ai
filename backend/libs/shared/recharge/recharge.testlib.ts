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
import type { TopupTierPermission } from "@lib/shared/persistence/index.js";
import { SystemSettingsService } from "@lib/shared/system-settings/index.js";
import { stubTierRepo } from "@lib/shared/topup-tier/topup-tier.testlib.js";
import { RechargeCustomService } from "@lib/shared/recharge-custom/recharge-custom.service.js";
import { GRANT_RETRY_WINDOW_MS } from "./recharge-grant-sweeper.js";
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

  /**
   * 一条列条件：等值 / `null` / `not` / `notIn` / `in` / `lt` / `lte` / `gte` / `gt`。
   *
   * <p>⚠️ 一个条件对象里可以**同时有多个操作符**（主动对账的重试窗口就是一个
   * `{ gte, lt }` 区间）。早期版本按 if/else 只认第一个，于是「窗口的上界写没写」
   * 在桩里根本测不出来 —— 漏掉 `gte` 的分支会让「早于窗口起点的单不该被重试」
   * 这一条断言变成恒真。所以这里逐个判、且**认不出任何操作符时返回 false**
   * （与 Prisma 一样是「不匹配」，而不是「不匹配也算匹配」）。
   */
  const matchesValue = (current: unknown, cond: unknown): boolean => {
    if (cond === null) return current === null || current === undefined;
    if (cond !== null && typeof cond === "object") {
      const c = cond as Row;
      const at = () => (current as Date | null | undefined)?.getTime() ?? null;
      let recognized = false;
      if ("not" in c) {
        recognized = true;
        if (current === c.not) return false;
      }
      // notIn / in 比的是**状态字符串**（BigInt 列不进这两支），故按 String 统一
      if ("notIn" in c) {
        recognized = true;
        if ((c.notIn as unknown[]).includes(String(current))) return false;
      }
      if ("in" in c) {
        recognized = true;
        if (!(c.in as unknown[]).map(String).includes(String(current))) return false;
      }
      // 时间比较：current 不是 Date（含 NULL 列）一律不匹配 —— 与 SQL 里
      // `NULL < x` 为 UNKNOWN 的语义对齐，也让「存量单的 paid_pending_at 为空」
      // 必须走它自己那条 OR 分支（退回 gmt_create）
      for (const [op, cmp] of [
        ["lt", (a: number, b: number) => a < b],
        ["lte", (a: number, b: number) => a <= b],
        ["gte", (a: number, b: number) => a >= b],
        ["gt", (a: number, b: number) => a > b],
      ] as const) {
        if (!(op in c)) continue;
        recognized = true;
        const lhs = at();
        if (lhs === null || !cmp(lhs, (c[op] as Date).getTime())) return false;
      }
      return recognized;
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
      // 主动对账的「已超窗单数」用真 count（样本再多也只是样本，条数是另一个数）
      count: async ({ where }: { where: Row }) =>
        [...orders.values()].filter((row) => matches(row, where)).length,
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
  /** 已用掉的幂等键 → **是谁发的**（`bizId`）。409 的判据与归属都靠它，见下面那段注释 */
  const grantedKeys = new Map<string, string>();
  /**
   * 发放请求的**原始报文**（与 `granted` 分开：那个只留 amount/bizId，被一堆用例用
   * `toEqual` 精确断言着）。`expiresAt` 这条显式覆盖（运营配的有效期月数有没有真的
   * 生效）要看它 —— 它是本次最容易被漏掉的一个字段：不传也能「发放成功」。
   */
  const grantBodies: Record<string, unknown>[] = [];
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
      grantBodies.push(body);
      if (grantFailures > 0) {
        grantFailures -= 1;
        return new Response("boom", { status: 500 });
      }
      const bizId = String(body.bizId);
      // 幂等键与 billing 同口径：显式传了 `grantKey` 就用它，否则默认 `source:bizId`。
      //
      // ⚠️ 两者不是一回事，桩必须一起模拟：首购加赠按 **用户+档位** 取键
      // （`bonus:tier:{userId}:{tierId}`），两笔**不同订单**（不同 bizId）会撞同一个键——
      // 而那正是「谁是首单」的判据。只按 bizId 去重的话，第二笔会照样发放成功，
      // 于是这个桩会把真环境里拦得住的东西放过去。
      const idempotencyKey = String(body.grantKey ?? `${String(body.source ?? "purchased")}:${bizId}`);
      const owner = grantedKeys.get(idempotencyKey);
      if (owner !== undefined) {
        // ⚠️ 409 必须带上**归属**（`existingBizId`），与真 billing 一样：
        //    调用方靠它区分「我自己之前发过」与「别人先占了」。桩不带的话，
        //    「重放不写假的 repeat」那条路径在测试里根本走不到，用例会假绿。
        return new Response(
          JSON.stringify({ code: "DUPLICATE", message: "该幂等键已存在", existingBizId: owner }),
          { status: 409 },
        );
      }
      grantedKeys.set(idempotencyKey, bizId);
      granted.push({ amount: Number(body.amount), bizId });
      return json({ lotId: 42, userId: body.userId, source: body.source ?? "purchased", amount: body.amount });
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
    grantBodies,
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
  /**
   * 到账积分有效期（月）：运营在后台配的那个数。它就是「配了要生效」的那条 ——
   * 发放时按支付成功时刻 + 它折出 `expiresAt` 交给 billing（PRD §9.5）。
   */
  creditsValidMonths: 24,
  /** 购买权限的三个字段（PRD §10.4）：默认「全部登录用户」，白名单用例自己覆盖。
   *  `permission` 标注成联合类型而不是字面量 `"all"`：否则 `setTier({permission: "user_group"})`
   *  会被 `Partial<Tier>` 卡住，白名单那条路根本写不出用例 */
  permission: "all" as TopupTierPermission,
  permissionAllowlist: [] as string[],
  permissionDeniedHint: "",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  /**
   * 卡片文案三件套（PRD §10.2）：纯展示层字段，服务端不下发也不算，夹具给空串即可。
   *
   * <p>但**必须存在** —— 少了它们 `Tier` 就不满足 `TopupTierView`，把本夹具喂进 repo 类型的
   * 地方会报 TS2322。本仓测试文件默认不进任何 `tsc`（`backend/tsconfig.json` 排除
   * `*.test.ts` / `*.testlib.ts`），所以这错误只在编辑器里、或显式把测试文件纳入编译时才露出来。
   */
  description: "",
  activityTag: "",
  buttonText: "",
  /**
   * 首购加赠（PRD §10.2）：`firstPurchaseEligible` 决定是否参与，`bonusCredits` 是赠送额度。
   *
   * <p>夹具默认**不参与**（`false` / `0`）：既有用例讲的都是本金那条链路，
   * 不该被赠送夹带。要用赠送的用例自己 `setTier({ firstPurchaseEligible: true, bonusCredits: … })`。
   */
  firstPurchaseEligible: false,
  bonusCredits: 0,
};

export type Tier = typeof TIER;

/**
 * @param options.grantRetryWindowMs 补发重试窗口（毫秒）。生产里由装配层从 env 解析后注入
 *   （`RechargeLibModule` 的工厂），所以这里也只能**注入** —— 被测服务不许自己读 env，
 *   否则「两条路用同一个窗口」这件事在测试里就测不出来了（各读各的永远一起变）。
 */
export async function makeService(
  options: { grantRetryWindowMs?: number } = {},
) {
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
  const tiers = stubTierRepo({
    listActive: async () => [...tiersById.values()],
    getById: async (id: string) => tiersById.get(id) ?? null,
  });
  const service = new RechargeService(
    { client: prisma } as never,
    tiers,
    settings,
    new RechargeCustomService({ client: prisma } as never),
    // 默认就用生产那个默认窗口（同一个常量）：测试想要的「调大窗口」直接传进来
    options.grantRetryWindowMs ?? GRANT_RETRY_WINDOW_MS,
  );
  return {
    service,
    orders,
    settings,
    statusWrites,
    /** 假 Prisma 本体：测「某条查询自己挂了」这类路径时要能把它桩坏 */
    prisma,
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
