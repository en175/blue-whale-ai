import { describe, expect, it, vi } from "vitest";

import { cancelImageJob } from "./generation-image-cancel.js";

describe("cancelImageJob（图片任务取消）", () => {
  function makeTx(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      generation_jobs: {
        updateMany: vi.fn(),
        count: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
      generation_output_slots: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
      },
      cost_reservations: {
        updateMany: vi.fn(),
      },
      generation_job_logs: {
        create: vi.fn(),
      },
      storyboard_previews: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      project_events: {
        create: vi.fn().mockResolvedValue({
          event_id: "evt_test",
          event_type: "generation_job.status_changed",
          cursor: 1n,
          project_id: 7n,
          aggregate_type: "generation_job",
          aggregate_id: "42",
          aggregate_version: 1,
          correlation_id: null,
          causation_id: null,
          occurred_at: new Date(),
          payload: null,
        }),
      },
      ...overrides,
    };
  }

  const baseJob = {
    id: 42n,
    project_id: 7n,
    user_id: 9n,
    type: "image",
    source: "bottom_dock",
    status: "queued",
    progress: 0,
    version: 1,
  };

  it("queued 任务收敛为 cancelled：撤销写入权 + 释放预留 + 落审计日志", async () => {
    const tx = makeTx();
    tx.generation_jobs.updateMany.mockResolvedValue({ count: 1 });
    tx.generation_jobs.findUniqueOrThrow.mockResolvedValue(baseJob);
    tx.cost_reservations.updateMany.mockResolvedValue({ count: 1 });

    const ok = await cancelImageJob(
      { $transaction: (cb: (t: unknown) => Promise<boolean>) => cb(tx) } as never,
      "42",
      "9",
    );

    expect(ok).toBe(true);
    expect(tx.generation_jobs.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 42n,
          user_id: 9n,
          type: "image",
          status: { in: ["queued", "processing"] },
        }),
        data: expect.objectContaining({
          status: "cancelled",
          fencing_token: { increment: 1 },
        }),
      }),
    );
    expect(tx.cost_reservations.updateMany).toHaveBeenCalled();
    expect(tx.generation_job_logs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event: "cancelled" }),
      }),
    );
  });

  it("updateMany 未命中（终态）时拒绝取消：查是否已取消，是则幂等 true，否则 false", async () => {
    const tx = makeTx();
    tx.generation_jobs.updateMany.mockResolvedValue({ count: 0 });
    tx.generation_jobs.count.mockResolvedValue(1);

    const ok = await cancelImageJob(
      { $transaction: (cb: (t: unknown) => Promise<boolean>) => cb(tx) } as never,
      "42",
      "9",
    );

    expect(ok).toBe(true);
    expect(tx.generation_jobs.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "cancelled" }),
      }),
    );
  });

  it("updateMany 未命中且未取消（成功/失败终态）→ 返回 false，不落日志", async () => {
    const tx = makeTx();
    tx.generation_jobs.updateMany.mockResolvedValue({ count: 0 });
    tx.generation_jobs.count.mockResolvedValue(0);

    const ok = await cancelImageJob(
      { $transaction: (cb: (t: unknown) => Promise<boolean>) => cb(tx) } as never,
      "42",
      "9",
    );

    expect(ok).toBe(false);
    expect(tx.generation_job_logs.create).not.toHaveBeenCalled();
  });
});
