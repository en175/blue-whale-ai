import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { AdminConsumedCreditsResponseSchema } from "@lib/contracts/gen/billing/v1/billing_pb.js";
import {
  freshGrpcUrl,
  grpcAdminService,
  grpcConsumedCredits,
  grpcStubTransport,
} from "@lib/shared/billing/billing-admin-grpc-stub.testlib.js";
import { resolveDashboardRange } from "./dashboard-range.js";
import { DashboardService } from "./dashboard.service.js";

const DAY = "2026-09-25";
const RANGE = resolveDashboardRange({ from: DAY, to: DAY });

const WINDOW = {
  gte: new Date("2026-09-24T16:00:00.000Z"),
  lt: new Date("2026-09-25T16:00:00.000Z"),
};

vi.mock("@connectrpc/connect-node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect-node")>();
  return {
    ...actual,
    createGrpcTransport: () => grpcStubTransport(),
  };
});

type RechargeRow = {
  status: string;
  _sum: { credits: bigint | null; amount_fen: bigint | null };
};

type RawRechargeRow = {
  status: string;
  credits: bigint;
  amount_fen: bigint;
  paid_at: Date | null;
  paid_pending_at: Date | null;
  gmt_create: Date;
  is_delete: number;
};

function evalCond(value: unknown, cond: unknown): boolean {
  if (cond === null) return value === null || value === undefined;
  if (cond !== null && typeof cond === "object") {
    const c = cond as { in?: readonly unknown[]; gte?: Date; lt?: Date };
    let ok = true;
    if (c.in) ok = ok && c.in.map(String).includes(String(value));
    if (c.gte) ok = ok && value instanceof Date && value.getTime() >= c.gte.getTime();
    if (c.lt) ok = ok && value instanceof Date && value.getTime() < c.lt.getTime();
    return ok;
  }
  return value === cond;
}

function evalWhere(row: RawRechargeRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) =>
    key === "OR"
      ? (cond as Record<string, unknown>[]).some((clause) => evalWhere(row, clause))
      : evalCond((row as unknown as Record<string, unknown>)[key], cond),
  );
}

function fakeRechargeGroupBy(rows: RawRechargeRow[]) {
  return vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
    const sums = new Map<string, { credits: bigint; amount_fen: bigint }>();
    for (const row of rows.filter((r) => evalWhere(r, where))) {
      const acc = sums.get(row.status) ?? { credits: 0n, amount_fen: 0n };
      acc.credits += row.credits;
      acc.amount_fen += row.amount_fen;
      sums.set(row.status, acc);
    }
    return [...sums].map(([status, sum]) => ({ status, _sum: sum }));
  });
}

function makeService(options: {
  totalUsers?: number;
  jobRows?: Array<{ type: string; _count: { _all: number } }>;
  rechargeRows?: RechargeRow[];
  rechargeSourceRows?: RawRechargeRow[];
}) {
  const groupBy = vi.fn().mockResolvedValue(options.jobRows ?? []);
  const rechargeGroupBy = options.rechargeSourceRows
    ? fakeRechargeGroupBy(options.rechargeSourceRows)
    : vi.fn().mockResolvedValue(options.rechargeRows ?? []);
  const service = new DashboardService(
    {
      countAdminUsers: vi.fn().mockResolvedValue(options.totalUsers ?? 7),
    } as never,
    {
      client: { generation_jobs: { groupBy }, billing_recharge_orders: { groupBy: rechargeGroupBy } },
    } as never,
  );
  return { service, groupBy, rechargeGroupBy };
}

function rawRow(overrides: Partial<RawRechargeRow> & { status: string }): RawRechargeRow {
  return {
    credits: 0n,
    amount_fen: 0n,
    paid_at: new Date("2026-09-25T03:00:00.000Z"),
    paid_pending_at: new Date("2026-09-25T02:59:00.000Z"),
    gmt_create: new Date("2026-09-25T01:00:00.000Z"),
    is_delete: 0,
    ...overrides,
  };
}

describe("DashboardService —— 任务数与类型分组", () => {
  beforeEach(() => {
    freshGrpcUrl();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("任务数 = 分组结果求和，且分组按任务数降序、同数按类型名升序", async () => {
    grpcConsumedCredits(() => 4321n);
    const { service } = makeService({
      jobRows: [
        { type: "image", _count: { _all: 100 } },
        { type: "video", _count: { _all: 120 } },
        { type: "audio", _count: { _all: 60 } },
        { type: "audio_trim", _count: { _all: 0 } },
      ],
    });

    const stats = await service.stats(RANGE);

    expect(stats.totalJobs).toBe(280);
    expect(stats.jobTypeCounts).toEqual([
      { type: "video", count: 120 },
      { type: "image", count: 100 },
      { type: "audio", count: 60 },
      { type: "audio_trim", count: 0 },
    ]);
    expect(stats.jobTypeCounts.reduce((s, r) => s + r.count, 0)).toBe(stats.totalJobs);
  });

  it("区间内一个任务都没有时给空数组与 0，不是 NaN", async () => {
    grpcConsumedCredits(() => 4321n);
    const { service } = makeService({ jobRows: [] });

    const stats = await service.stats(RANGE);

    expect(stats.totalJobs).toBe(0);
    expect(stats.jobTypeCounts).toEqual([]);
  });

  it("任务查询带的是**北京时间**的半开区间，且排除软删", async () => {
    grpcConsumedCredits(() => 4321n);
    const { service, groupBy } = makeService({ jobRows: [] });

    await service.stats(RANGE);

    expect(groupBy).toHaveBeenCalledWith({
      by: ["type"],
      where: { is_delete: false, gmt_create: WINDOW },
      _count: { _all: true },
    });
  });
});

describe("DashboardService —— 充值积分与收入金额", () => {
  beforeEach(() => {
    freshGrpcUrl();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("按**到账时刻**（paid_at）划区间；实收含 `paid_pending` 与 `grant_failed`、到账积分只算 `paid`", async () => {
    grpcConsumedCredits(() => 4321n);
    const { service, rechargeGroupBy } = makeService({
      rechargeRows: [
        { status: "paid", _sum: { credits: 5_000_000n, amount_fen: 1_000_000n } },
        { status: "paid_pending", _sum: { credits: 700n, amount_fen: 30_000n } },
        { status: "grant_failed", _sum: { credits: 400n, amount_fen: 20_000n } },
      ],
    });

    const stats = await service.stats(RANGE);

    expect(rechargeGroupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: {
        is_delete: 0,
        status: { in: ["paid_pending", "grant_failed", "paid"] },
        OR: [
          { paid_at: WINDOW },
          { paid_at: null, paid_pending_at: WINDOW },
          { paid_at: null, paid_pending_at: null, gmt_create: WINDOW },
        ],
      },
      _sum: { credits: true, amount_fen: true },
    });
    expect(stats.totalRechargeCredits).toBe(5_000_000);
    expect(stats.totalRevenueFen).toBe(1_050_000);
  });

  it("★ 051 之前进入 paid_pending 的存量单（paid_pending_at 为 NULL）也进实收金额", async () => {
    grpcConsumedCredits(() => 4321n);
    const { service } = makeService({
      rechargeSourceRows: [
        rawRow({
          status: "paid_pending",
          paid_at: null,
          paid_pending_at: null,
          credits: 700n,
          amount_fen: 30_000n,
        }),
        rawRow({ status: "paid", credits: 5_000_000n, amount_fen: 1_000_000n }),
        rawRow({
          status: "paid",
          paid_at: new Date("2026-09-20T03:00:00.000Z"),
          paid_pending_at: new Date("2026-09-20T02:59:00.000Z"),
          gmt_create: new Date("2026-09-20T01:00:00.000Z"),
          credits: 111n,
          amount_fen: 222n,
        }),
        rawRow({
          status: "pending",
          paid_at: null,
          paid_pending_at: null,
          credits: 9n,
          amount_fen: 999n,
        }),
      ],
    });

    const stats = await service.stats(RANGE);

    expect(stats.totalRevenueFen).toBe(1_030_000);
    expect(stats.totalRechargeCredits).toBe(5_000_000);
  });

  it("区间内没有相关订单时两列都是 0（不是 NaN）", async () => {
    grpcConsumedCredits(() => 4321n);
    const { service } = makeService({ rechargeRows: [] });

    const stats = await service.stats(RANGE);

    expect(stats.totalRechargeCredits).toBe(0);
    expect(stats.totalRevenueFen).toBe(0);
  });

  it("求和列缺值（BIGINT 无行）落成 0 而不是 NaN", async () => {
    grpcConsumedCredits(() => 4321n);
    const { service } = makeService({
      rechargeRows: [{ status: "paid", _sum: { credits: null, amount_fen: null } }],
    });

    const stats = await service.stats(RANGE);

    expect(stats.totalRechargeCredits).toBe(0);
    expect(stats.totalRevenueFen).toBe(0);
  });
});

describe("DashboardService —— 消耗积分（billing）", () => {
  beforeEach(() => {
    freshGrpcUrl();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("以带 +08:00 的 RFC3339 把北京日界下发给 billing（同一天界，不是 UTC 的前一天 16 点）", async () => {
    const { requests } = grpcConsumedCredits(() => 4321n);
    const { service } = makeService({});

    await service.stats(RANGE);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.from).toBe("2026-09-25T00:00:00+08:00");
    expect(requests[0]?.to).toBe("2026-09-26T00:00:00+08:00");
  });

  it("billing 正常时取它的数", async () => {
    grpcConsumedCredits(() => 98765n);
    const { service } = makeService({});

    expect((await service.stats(RANGE)).totalUsedCredits).toBe(98765);
  });

  it("billing 挂了 → null，**不是 0**，且另外四个数照常返回", async () => {
    grpcConsumedCredits(() => {
      throw new ConnectError("boom", Code.Internal);
    });
    const { service } = makeService({
      totalUsers: 42,
      jobRows: [{ type: "video", _count: { _all: 3 } }],
      rechargeRows: [{ status: "paid", _sum: { credits: 100n, amount_fen: 200n } }],
    });

    const stats = await service.stats(RANGE);

    expect(stats.totalUsedCredits).toBeNull();
    expect(stats.totalUsers).toBe(42);
    expect(stats.totalJobs).toBe(3);
    expect(stats.totalRechargeCredits).toBe(100);
    expect(stats.totalRevenueFen).toBe(200);
  });

  it("回包里没设 consumed_credits 就是 0（proto3 的 int64 没有「缺值」这个状态）", async () => {
    grpcAdminService({
      adminConsumedCredits: () => create(AdminConsumedCreditsResponseSchema, {}),
    });
    const { service } = makeService({});

    expect((await service.stats(RANGE)).totalUsedCredits).toBe(0);
  });
});
