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

/** 北京时间 09-25 00:00 = UTC 09-24 16:00；09-26 00:00 = UTC 09-25 16:00。 */
const WINDOW = {
  gte: new Date("2026-09-24T16:00:00.000Z"),
  lt: new Date("2026-09-25T16:00:00.000Z"),
};

// 只做转发，「装哪个 router」在 billing-admin-grpc-stub.testlib.ts 里（三个测试文件同一套）。
vi.mock("@connectrpc/connect-node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect-node")>();
  return {
    ...actual,
    createGrpcTransport: () => grpcStubTransport(),
  };
});

/** 一条按 status 分组后的充值求和行（`sumPaidRecharges` 用 groupBy，见那里的注释）。 */
type RechargeRow = {
  status: string;
  _sum: { credits: bigint | null; amount_fen: bigint | null };
};

/**
 * 一条**原始**订单行（进假 groupBy，由它按 `where` 筛完再按 status 分组）。
 *
 * ⚠️ 为什么需要它：`sumPaidRecharges` 的缺陷**全在 `where` 里**（区间条件少一支，
 *    行就被整行过滤掉）。桩成「不管 where 是什么都返回同一批行」的话，
 *    「存量单进没进实收金额」这件事根本测不到 —— 那正是这条修复第一版
 *    「绿着的假修复」的成因（见 `sumPaidRecharges` 的注释）。
 */
type RawRechargeRow = {
  status: string;
  credits: bigint;
  amount_fen: bigint;
  paid_at: Date | null;
  paid_pending_at: Date | null;
  gmt_create: Date;
  is_delete: number;
};

/** 一条列条件：等值 / `null` / `in` / `gte` / `lt`（本测试里出现过的操作符就这些）。 */
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

/** where 求值：键之间是 AND，`OR` 是「任一子句命中」——与 Prisma 的语义对齐。 */
function evalWhere(row: RawRechargeRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) =>
    key === "OR"
      ? (cond as Record<string, unknown>[]).some((clause) => evalWhere(row, clause))
      : evalCond((row as unknown as Record<string, unknown>)[key], cond),
  );
}

/**
 * 会真的**按 where 筛行**的假 groupBy。
 *
 * <p>不这么写的话，`OR` 少一支（存量单被整行过滤掉）在测试里毫无痕迹 ——
 * 桩返回的行数与 where 无关，断言恒真。这里筛完再按 status 分组求和，
 * 于是「哪一行进了实收金额」是**算出来**的，不是摆出来的。
 */
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
  /**
   * ⚠️ 是**按状态分组的多行**，不是一条求和。
   * 拆出 `paid_pending` 之后，实收金额与到账积分的口径不同（钱到了 vs 积分发了），
   * 一条 `where` 出不来两个数 —— 见 `sumPaidRecharges` 的注释。
   */
  rechargeRows?: RechargeRow[];
  /** 原始订单行：走 `fakeRechargeGroupBy`，按 where 真筛（见该类型注释）。 */
  rechargeSourceRows?: RawRechargeRow[];
}) {
  const groupBy = vi.fn().mockResolvedValue(options.jobRows ?? []);
  const rechargeGroupBy = options.rechargeSourceRows
    ? fakeRechargeGroupBy(options.rechargeSourceRows)
    : vi.fn().mockResolvedValue(options.rechargeRows ?? []);
  const service = new DashboardService(
    {
      listAdminUsers: vi.fn().mockResolvedValue({ total: options.totalUsers ?? 7 }),
    } as never,
    {
      client: { generation_jobs: { groupBy }, recharge_orders: { groupBy: rechargeGroupBy } },
    } as never,
  );
  return { service, groupBy, rechargeGroupBy };
}

/** 一笔订单的原始行（区间内的默认值集中在 WINDOW 上，用例只覆盖它在乎的那几列）。 */
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

    // ⚠️ 分母必须来自**同一份分组结果**：另发一条 count 会与分子取自两个瞬间，
    //    对不上时表现为占比加起来不是 100%
    expect(stats.totalJobs).toBe(280);
    expect(stats.jobTypeCounts).toEqual([
      { type: "video", count: 120 },
      { type: "image", count: 100 },
      { type: "audio", count: 60 },
      { type: "audio_trim", count: 0 },
    ]);
    // 分子之和恒等于分母 —— 这是「占比不会加不齐」的结构性保证
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
    // ⚠️ 这条的断言语义**变了**（2026-09-26 拆出 `paid_pending` 之后）：
    //    停在 `paid_pending` 的单**钱已经收了**（网关确认过），只是积分还没发成功 ——
    //    所以它该进「实收金额」，不该进「到账积分」。原来一条 `where: status='paid'`
    //    把两个数一起算，会把这部分收入**低报**。
    //
    //    2026-09-27 主动对账落地后又多了一个 `grant_failed`：它是 `paid_pending` 的**后继**
    //    （钱到了、反复发放失败被标出来），钱并没有退回去 —— 同样该进实收。漏掉它，
    //    「到账异常」的单就会在收入报表里凭空消失。
    grpcConsumedCredits(() => 4321n);
    const { service, rechargeGroupBy } = makeService({
      rechargeRows: [
        // 已到账：钱与积分都算
        { status: "paid", _sum: { credits: 5_000_000n, amount_fen: 1_000_000n } },
        // 待到账：只算钱、不算积分
        { status: "paid_pending", _sum: { credits: 700n, amount_fen: 30_000n } },
        // 到账异常：钱收了、积分没发出去。同样是「只算钱」
        { status: "grant_failed", _sum: { credits: 400n, amount_fen: 20_000n } },
      ],
    });

    const stats = await service.stats(RANGE);

    // 查询本身：状态过滤与**区间条件**都要在 SQL 里（不是取回来再筛）
    //
    // ⚠️ 区间是 OR **三条**，不是单写 `paid_at` —— 这条断言是**本修复第一版翻车后补的**。
    //    第一版只把 `status` 放宽了、区间条件没跟着改，于是 `paid_pending` / `grant_failed`
    //    的行因 `paid_at IS NULL` 被整行过滤掉，**行为与改前逐字相同**，
    //    而当时那条测试只断言「查询形状长这样」，把这个形状原样钉住了 —— 绿着的假修复。
    //    所以现在把 OR 写进断言：谁把它改回单写 `paid_at`，这条就红。
    //
    //    第三条（`gmt_create` 兜底）是**第二版**补的：`paid_pending_at` 是迁移 051 才加的列，
    //    051 之前进入 `paid_pending` 的存量单那一列是 NULL，会同时落空前两支、掉进缝里。
    //    形状断言管不住「行真的进没进」，所以下面另有一条按行求值的用例。
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
    // 积分：只有 paid 那 5,000,000（待到账与异常的都不算 —— 积分确实还没发出去）
    expect(stats.totalRechargeCredits).toBe(5_000_000);
    // 金额：三笔都算（钱都收了）
    expect(stats.totalRevenueFen).toBe(1_050_000);
  });

  it("★ 051 之前进入 paid_pending 的存量单（paid_pending_at 为 NULL）也进实收金额", async () => {
    // ⚠️ 这条**按行求值**（`fakeRechargeGroupBy` 真的按 where 筛），不是形状断言：
    //    上面那条只看查询长什么样，而这条缺陷恰恰是「查询形状对了、行还是没进来」。
    //
    //    存量单：`paid_at` 与 `paid_pending_at` **两列都是 NULL**（后者是迁移 051 才加的），
    //    划区间只能退回它唯一有的那个时刻 —— 下单时刻 `gmt_create`。
    //    少了这一支，这笔已经收到的钱会在收入报表里彻底消失。
    grpcConsumedCredits(() => 4321n);
    const { service } = makeService({
      rechargeSourceRows: [
        // 存量单：两列全空，只有下单时刻。**必须进实收金额**
        rawRow({
          status: "paid_pending",
          paid_at: null,
          paid_pending_at: null,
          credits: 700n,
          amount_fen: 30_000n,
        }),
        // 正常已到账：进积分、也进金额（证明筛选没被放宽成「全都要」）
        rawRow({ status: "paid", credits: 5_000_000n, amount_fen: 1_000_000n }),
        // 区间**之外**的已到账单：不该进任何一个数
        rawRow({
          status: "paid",
          paid_at: new Date("2026-09-20T03:00:00.000Z"),
          paid_pending_at: new Date("2026-09-20T02:59:00.000Z"),
          gmt_create: new Date("2026-09-20T01:00:00.000Z"),
          credits: 111n,
          amount_fen: 222n,
        }),
        // 还没付钱的单：status 就不在白名单里
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

    // 金额 = 存量单 30,000 + 区间内已到账 1,000,000（区间外那笔与 pending 那笔都不算）
    expect(stats.totalRevenueFen).toBe(1_030_000);
    // 积分仍只算严格 paid 的那笔
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
    // 断言落在**请求对象**的 from/to 上：迁到 gRPC 之后它们不再是 URL query，
    // 但「带偏移、不是 UTC」这条契约没变——换回 `toISOString()` 这条必须红
    const { requests } = grpcConsumedCredits(() => 4321n);
    const { service } = makeService({});

    await service.stats(RANGE);

    // 整个仪表盘只打这一次 billing 聚合（另外四个数都在我们自己的库里）
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

    // 0 的意思是「这段时间确实没人消费」；billing 取不到时我们并不知道消费了多少。
    // 给 0 就是把一次故障伪装成一句「没人消费」
    expect(stats.totalUsedCredits).toBeNull();
    // billing 抖动不该把本地库里的数一起带走
    expect(stats.totalUsers).toBe(42);
    expect(stats.totalJobs).toBe(3);
    expect(stats.totalRechargeCredits).toBe(100);
    expect(stats.totalRevenueFen).toBe(200);
  });

  it("回包里没设 consumed_credits 就是 0（proto3 的 int64 没有「缺值」这个状态）", async () => {
    // ⚠️ 这条**换了断言对象**，不是放宽：HTTP 时代要防「JSON 键整个消失被读成 0」，
    //    而 gRPC 下 int64 没有 presence —— 没设就是 0，而 0 恰恰是个合法答案
    //    （这段时间真的没消费）。原样保留那条 `toBeNull()` 等于在测一个不存在的状态。
    //    真正还存在的守卫是「调用失败 → null」，即上一条。
    grpcAdminService({
      adminConsumedCredits: () => create(AdminConsumedCreditsResponseSchema, {}),
    });
    const { service } = makeService({});

    expect((await service.stats(RANGE)).totalUsedCredits).toBe(0);
  });
});
