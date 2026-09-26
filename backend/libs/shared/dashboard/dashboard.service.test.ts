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

function makeService(options: {
  totalUsers?: number;
  jobRows?: Array<{ type: string; _count: { _all: number } }>;
  /**
   * ⚠️ 是**按状态分组的多行**，不是一条求和。
   * 拆出 `paid_pending` 之后，实收金额与到账积分的口径不同（钱到了 vs 积分发了），
   * 一条 `where` 出不来两个数 —— 见 `sumPaidRecharges` 的注释。
   */
  rechargeRows?: RechargeRow[];
}) {
  const groupBy = vi.fn().mockResolvedValue(options.jobRows ?? []);
  const rechargeGroupBy = vi.fn().mockResolvedValue(options.rechargeRows ?? []);
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

  it("按**到账时刻**（paid_at）划区间；实收含 `paid_pending`、到账积分只算 `paid`", async () => {
    // ⚠️ 这条的断言语义**变了**（2026-09-26 拆出 `paid_pending` 之后）：
    //    停在 `paid_pending` 的单**钱已经收了**（网关确认过），只是积分还没发成功 ——
    //    所以它该进「实收金额」，不该进「到账积分」。原来一条 `where: status='paid'`
    //    把两个数一起算，会把这部分收入**低报**。
    grpcConsumedCredits(() => 4321n);
    const { service, rechargeGroupBy } = makeService({
      rechargeRows: [
        // 已到账：钱与积分都算
        { status: "paid", _sum: { credits: 5_000_000n, amount_fen: 1_000_000n } },
        // 待到账：只算钱、不算积分
        { status: "paid_pending", _sum: { credits: 700n, amount_fen: 30_000n } },
      ],
    });

    const stats = await service.stats(RANGE);

    // 查询本身：区间与「≥ 待到账」的过滤都要在 SQL 里（不是取回来再筛）
    expect(rechargeGroupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: { is_delete: 0, status: { in: ["paid_pending", "paid"] }, paid_at: WINDOW },
      _sum: { credits: true, amount_fen: true },
    });
    // 积分：只有 paid 那 5,000,000（待到账的 700 不算 —— 积分确实还没发出去）
    expect(stats.totalRechargeCredits).toBe(5_000_000);
    // 金额：两笔都算（钱都收了）
    expect(stats.totalRevenueFen).toBe(1_030_000);
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
