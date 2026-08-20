import { describe, expect, it, vi } from "vitest";

import { createWorkerSettleOps } from "./generation-worker-settle-ops.js";

// IK9VZ0：图片结算原子化——completeJobAndSettle 单事务验证。
// 覆盖：① 正常路径 job 守卫通过 + 预留 settled + 实扣金额写值；
//      ② 事务中段（settle）抛错 → 整个调用 reject，不出现「job 已 succeeded 但预留仍 reserved」的假成功；
//      ③ stale worker 守卫拒绝 → 返回 false 且不结算预留（无副作用）。

const FENCE_PROOF = { workerId: "worker-1", fencingToken: 5 };

function buildTx(overrides: Record<string, unknown> = {}) {
  const jobsUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const costUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const tx = {
    generation_jobs: {
      updateMany: jobsUpdateMany,
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({
        id: 300n,
        project_id: null,
        type: "image",
        source: "api",
        status: "succeeded",
        progress: 100,
        version: 2,
      }),
      update: vi.fn(),
    },
    generation_output_slots: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    cost_reservations: { updateMany: costUpdateMany },
    ...overrides,
  };
  return { tx, jobsUpdateMany, costUpdateMany };
}

describe("completeJobAndSettle（IK9VZ0 图片结算原子化）", () => {
  it("正常路径：守卫通过 → job 置 succeeded + 预留 settled + 实扣金额写值", async () => {
    const { tx, costUpdateMany } = buildTx();
    const prisma = {
      $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    } as never;
    const repo = createWorkerSettleOps(prisma);

    const ok = await repo.completeJobAndSettle({
      jobId: "300",
      assetIds: ["901"],
      ...FENCE_PROOF,
      actualAmountFen: 1285n,
    });

    expect(ok).toBe(true);
    // 结算并入同一事务：预留 reserved → settled + 实扣金额。
    expect(costUpdateMany).toHaveBeenCalledWith({
      where: { generation_job_id: 300n, status: "reserved" },
      data: { status: "settled", actual_amount_fen: 1285n },
    });
  });

  it("事务中段（settle）抛错 → 调用 reject，不返回假成功", async () => {
    const jobsUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const costUpdateMany = vi.fn().mockRejectedValue(new Error("db error"));
    const { tx } = buildTx({
      generation_jobs: {
        updateMany: jobsUpdateMany,
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({
          id: 300n,
          project_id: null,
          type: "image",
          source: "api",
          status: "succeeded",
          progress: 100,
          version: 2,
        }),
        update: vi.fn(),
      },
      cost_reservations: { updateMany: costUpdateMany },
    });
    const prisma = {
      $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    } as never;
    const repo = createWorkerSettleOps(prisma);

    // settle 阶段抛错 → 整个调用 reject；真实 DB 中 $transaction 回滚，
    // job 不落 succeeded、预留不落 settled——杜绝「job 已终态但预留悬挂」的静默账不平。
    await expect(
      repo.completeJobAndSettle({
        jobId: "300",
        assetIds: ["901"],
        ...FENCE_PROOF,
        actualAmountFen: 1285n,
      }),
    ).rejects.toThrow("db error");
  });

  it("守卫拒绝（stale worker）→ 返回 false，不结算预留", async () => {
    const jobsUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const costUpdateMany = vi.fn();
    const tx = {
      generation_jobs: { updateMany: jobsUpdateMany },
      generation_output_slots: { findMany: vi.fn() },
      cost_reservations: { updateMany: costUpdateMany },
    };
    const prisma = {
      $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    } as never;
    const repo = createWorkerSettleOps(prisma);

    const ok = await repo.completeJobAndSettle({
      jobId: "300",
      assetIds: ["901"],
      workerId: "stale",
      fencingToken: 4,
    });

    expect(ok).toBe(false);
    expect(costUpdateMany).not.toHaveBeenCalled();
  });
});
