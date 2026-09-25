import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveDashboardRange } from "./dashboard-range.js";
import { DashboardService } from "./dashboard.service.js";

const DAY = "2026-09-25";
const RANGE = resolveDashboardRange({ from: DAY, to: DAY });

/** 北京时间 09-25 00:00 = UTC 09-24 16:00；09-26 00:00 = UTC 09-25 16:00。 */
const WINDOW = {
  gte: new Date("2026-09-24T16:00:00.000Z"),
  lt: new Date("2026-09-25T16:00:00.000Z"),
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** 记录 billing 的请求；默认回一个带 consumedCredits 的成功响应。 */
function stubBilling(responder: () => Response = () => json({ consumedCredits: 4321 })) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      calls.push(String(input));
      return responder();
    }),
  );
  return calls;
}

function makeService(options: {
  totalUsers?: number;
  jobRows?: Array<{ type: string; _count: { _all: number } }>;
  rechargeSum?: { credits: bigint | null; amount_fen: bigint | null };
}) {
  const groupBy = vi.fn().mockResolvedValue(options.jobRows ?? []);
  const aggregate = vi
    .fn()
    .mockResolvedValue({ _sum: options.rechargeSum ?? { credits: null, amount_fen: null } });
  const service = new DashboardService(
    {
      listAdminUsers: vi.fn().mockResolvedValue({ total: options.totalUsers ?? 7 }),
    } as never,
    {
      client: { generation_jobs: { groupBy }, recharge_orders: { aggregate } },
    } as never,
  );
  return { service, groupBy, aggregate };
}

describe("DashboardService —— 任务数与类型分组", () => {
  beforeEach(() => {
    process.env.BILLING_ADMIN_URL = "http://billing.test";
  });

  afterEach(() => {
    delete process.env.BILLING_ADMIN_URL;
    vi.unstubAllGlobals();
  });

  it("任务数 = 分组结果求和，且分组按任务数降序、同数按类型名升序", async () => {
    stubBilling();
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
    stubBilling();
    const { service } = makeService({ jobRows: [] });

    const stats = await service.stats(RANGE);

    expect(stats.totalJobs).toBe(0);
    expect(stats.jobTypeCounts).toEqual([]);
  });

  it("任务查询带的是**北京时间**的半开区间，且排除软删", async () => {
    stubBilling();
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
    process.env.BILLING_ADMIN_URL = "http://billing.test";
  });

  afterEach(() => {
    delete process.env.BILLING_ADMIN_URL;
    vi.unstubAllGlobals();
  });

  it("按**到账时刻**（paid_at）划区间、只算 paid、金额单位是分", async () => {
    stubBilling();
    const { service, aggregate } = makeService({
      rechargeSum: { credits: 5_000_000n, amount_fen: 1_000_000n },
    });

    const stats = await service.stats(RANGE);

    expect(aggregate).toHaveBeenCalledWith({
      where: { is_delete: 0, status: "paid", paid_at: WINDOW },
      _sum: { credits: true, amount_fen: true },
    });
    expect(stats.totalRechargeCredits).toBe(5_000_000);
    expect(stats.totalRevenueFen).toBe(1_000_000);
  });

  it("区间内没有已到账订单时两列都是 null（BIGINT 求和无行返回 null），要落成 0 而不是 NaN", async () => {
    stubBilling();
    const { service } = makeService({ rechargeSum: { credits: null, amount_fen: null } });

    const stats = await service.stats(RANGE);

    expect(stats.totalRechargeCredits).toBe(0);
    expect(stats.totalRevenueFen).toBe(0);
  });
});

describe("DashboardService —— 消耗积分（billing）", () => {
  beforeEach(() => {
    process.env.BILLING_ADMIN_URL = "http://billing.test";
  });

  afterEach(() => {
    delete process.env.BILLING_ADMIN_URL;
    vi.unstubAllGlobals();
  });

  it("以带 +08:00 的 RFC3339 把北京日界下发给 billing（同一天界，不是 UTC 的前一天 16 点）", async () => {
    const calls = stubBilling();
    const { service } = makeService({});

    await service.stats(RANGE);

    expect(calls).toHaveLength(1);
    const url = new URL(calls[0] ?? "");
    expect(url.pathname).toBe("/admin/transactions/consumed-credits");
    expect(url.searchParams.get("from")).toBe("2026-09-25T00:00:00+08:00");
    expect(url.searchParams.get("to")).toBe("2026-09-26T00:00:00+08:00");
  });

  it("billing 正常时取它的数", async () => {
    stubBilling(() => json({ consumedCredits: 98765 }));
    const { service } = makeService({});

    expect((await service.stats(RANGE)).totalUsedCredits).toBe(98765);
  });

  it("billing 挂了 → null，**不是 0**，且另外四个数照常返回", async () => {
    stubBilling(() => json({ code: "INTERNAL", message: "boom" }, 500));
    const { service } = makeService({
      totalUsers: 42,
      jobRows: [{ type: "video", _count: { _all: 3 } }],
      rechargeSum: { credits: 100n, amount_fen: 200n },
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

  it("billing 回包缺 consumedCredits 也算失败（回落 0 会得到假答案）", async () => {
    stubBilling(() => json({}));
    const { service } = makeService({});

    expect((await service.stats(RANGE)).totalUsedCredits).toBeNull();
  });
});
