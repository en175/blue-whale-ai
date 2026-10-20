import { vi } from "vitest";
import {
  RECHARGE_CUSTOM_SETTING_KEY,
  type TopupTierPermission,
} from "@lib/shared/persistence/index.js";
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
  const statusWrites: string[] = [];

  const matches = (row: Row, where: Row): boolean => {
    for (const [key, cond] of Object.entries(where)) {
      if (key === "OR") {
        if (!(cond as Row[]).some((clause) => matches(row, clause))) return false;
        continue;
      }
      if (!matchesValue(row[key], cond)) return false;
    }
    return true;
  };

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
      if ("notIn" in c) {
        recognized = true;
        if ((c.notIn as unknown[]).includes(String(current))) return false;
      }
      if ("in" in c) {
        recognized = true;
        if (!(c.in as unknown[]).map(String).includes(String(current))) return false;
      }
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
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        const key = String(where.setting_key);
        const existing = settings.get(key);
        if (!existing) return { count: 0 };
        if (where.version !== undefined && existing.version !== where.version) {
          return { count: 0 };
        }
        apply(existing, data);
        return { count: 1 };
      },
    },
  };
  return { prisma, orders, statusWrites, settings };
}

export function defaultCustomConfigRow(overrides: Row = {}): Row {
  const config = {
    minCredits: 600,
    maxCredits: 499_995,
    defaultCredits: 600,
    creditsPerYuan: 15,
    stepCredits: 15,
    enabled: true,
    permission: "all",
    permissionAllowlist: null,
    permissionDeniedHint: "",
    creditsValidMonths: 24,
    ...overrides,
  };
  return {
    setting_key: RECHARGE_CUSTOM_SETTING_KEY,
    setting_value: JSON.stringify(config),
    is_secret: false,
    version: 5,
    gmt_create: new Date("2026-09-27T00:00:00.000Z"),
    gmt_modified: new Date("2026-09-27T00:00:00.000Z"),
  };
}

export function makeHttp(gatewayState = 1) {
  const granted: { amount: number; bizId: string }[] = [];
  const grantedKeys = new Map<string, string>();
  const grantBodies: Record<string, unknown>[] = [];
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  let grantFailures = 0;
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
      const idempotencyKey = String(body.grantKey ?? `${String(body.source ?? "purchased")}:${bizId}`);
      const owner = grantedKeys.get(idempotencyKey);
      if (owner !== undefined) {
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
  creditsValidMonths: 24,
  permission: "all" as TopupTierPermission,
  permissionAllowlist: [] as string[],
  permissionDeniedHint: "",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  description: "",
  activityTag: "",
  buttonText: "",
  firstPurchaseEligible: false,
  bonusCredits: 0,
};

export type Tier = typeof TIER;

export async function makeService(
  options: { grantRetryWindowMs?: number } = {},
) {
  const { prisma, orders, statusWrites, settings: settingRows } = makePrisma();
  settingRows.set(RECHARGE_CUSTOM_SETTING_KEY, defaultCustomConfigRow());
  const settings = new SystemSettingsService({ client: prisma } as never);
  await settings.update({
    credentials: {
      hccb_mch_no: "M0001",
      hccb_app_id: "app-1",
      hccb_app_secret: APP_SECRET,
      hccb_notify_url: NOTIFY_URL,
    },
  });
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
    options.grantRetryWindowMs ?? GRANT_RETRY_WINDOW_MS,
  );
  return {
    service,
    orders,
    settings,
    statusWrites,
    prisma,
    setCustomConfig: (patch: Row) => {
      const row = settingRows.get(RECHARGE_CUSTOM_SETTING_KEY) ?? defaultCustomConfigRow();
      const current = JSON.parse(String(row.setting_value)) as Row;
      settingRows.set(RECHARGE_CUSTOM_SETTING_KEY, {
        ...row,
        setting_value: JSON.stringify({ ...current, ...patch }),
      });
    },
    addTier: (t: Tier) => {
      tiersById.set(t.id, { ...t });
    },
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
