import { describe, expect, it, vi } from "vitest";

import { createWorkerRepo } from "./generation-worker-repo.js";

// IK7GRO：图片 GenerationJob claim 路径的 fencing_token 扩展验证。
// 本票只做扩展（领取/重放/重排递增 token，写路径暂不校验），
// 测试覆盖：领取发放 token、CAS 用旧 token 失效、重放/重排递增、重新领取发新 token。

function imageCandidateRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 300n,
    project_id: 55n,
    user_id: 9n,
    type: "image",
    status: "queued",
    input: { prompt: "一只猫", model_id: "m", provider_credential: "sealed" },
    expected_output_count: 1,
    retry_count: 0,
    fencing_token: 0n,
    ...overrides,
  };
}

describe("image claim fencing_token（IK7GRO 扩展）", () => {
  it("claimNextJob 领取成功时递增 fencing_token 并随任务返回", async () => {
    const findFirst = vi.fn().mockResolvedValue(imageCandidateRow());
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createWorkerRepo({
      generation_jobs: { findFirst, updateMany },
    } as never);

    await expect(repo.claimNextJob("worker-1")).resolves.toMatchObject({
      id: "300",
      fencingToken: 1,
    });
    // CAS where 含读到的 fencing_token，data 递增 1。
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 300n,
          status: "queued",
          fencing_token: 0n,
        }),
        data: expect.objectContaining({ fencing_token: { increment: 1 } }),
      }),
    );
  });

  it("claimJobById 领取成功时递增 fencing_token 并随任务返回", async () => {
    const findFirst = vi.fn().mockResolvedValue(imageCandidateRow());
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createWorkerRepo({
      generation_jobs: { findFirst, updateMany },
    } as never);

    await expect(
      repo.claimJobById("300", "9", "worker-1"),
    ).resolves.toMatchObject({ id: "300", fencingToken: 1 });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ fencing_token: 0n }),
        data: expect.objectContaining({ fencing_token: { increment: 1 } }),
      }),
    );
  });

  it("claimNextImageJob 领取成功时递增 fencing_token 并随任务返回", async () => {
    const findFirst = vi.fn().mockResolvedValue(imageCandidateRow());
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createWorkerRepo({
      generation_jobs: { findFirst, updateMany },
    } as never);

    await expect(repo.claimNextImageJob("worker-1")).resolves.toMatchObject({
      id: "300",
      fencingToken: 1,
    });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 300n,
          status: "queued",
          fencing_token: 0n,
        }),
        data: expect.objectContaining({ fencing_token: { increment: 1 } }),
      }),
    );
  });

  it("旧 token 与库值不一致时 CAS 不命中（count=0），返回 null", async () => {
    // 候选行读到 token=1，但库里实际已是 2（被重放/重新领取递增过）→ updateMany count=0。
    const findFirst = vi
      .fn()
      .mockResolvedValue(imageCandidateRow({ fencing_token: 1n }));
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repo = createWorkerRepo({
      generation_jobs: { findFirst, updateMany },
    } as never);

    await expect(repo.claimNextJob("worker-1")).resolves.toBeNull();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ fencing_token: 1n }),
      }),
    );
  });

  it("领取→租约过期重放→重新领取，fencing_token 单调递增", async () => {
    // 第一轮领取：token 0 → 1，worker-1 拿到 fencingToken=1。
    // resetStalledImageJobs 重放：再递增 → 2（旧 token 1 失效）。
    // 第二轮领取：读回 token=2，递增 → 3，worker-2 拿到 fencingToken=3。
    const updateMany = vi
      .fn()
      // 第一轮领取
      .mockResolvedValueOnce({ count: 1 })
      // 重放（resetStalledImageJobs）
      .mockResolvedValueOnce({ count: 1 })
      // 第二轮领取
      .mockResolvedValueOnce({ count: 1 });
    const findFirst = vi
      .fn()
      // 第一轮候选：token=0
      .mockResolvedValueOnce(imageCandidateRow({ fencing_token: 0n }))
      // 第二轮候选：token=2（重放后库值）
      .mockResolvedValueOnce(imageCandidateRow({ fencing_token: 2n }));
    const repo = createWorkerRepo({
      generation_jobs: { findFirst, updateMany },
    } as never);

    const first = await repo.claimNextJob("worker-1");
    expect(first).toMatchObject({ fencingToken: 1 });

    const resetCount = await repo.resetStalledImageJobs();
    expect(resetCount).toBe(1);
    // 重放同样递增 fencing_token。
    expect(updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ fencing_token: { increment: 1 } }),
      }),
    );

    const second = await repo.claimNextJob("worker-2");
    expect(second).toMatchObject({ fencingToken: 3 });
    // token 单调递增：0 → 1 → (重放) 2 → 3。
    expect(updateMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({ fencing_token: 2n }),
        data: expect.objectContaining({ fencing_token: { increment: 1 } }),
      }),
    );
  });

  it("requeueImageJobForRetry 重排时递增 fencing_token，旧领取 token 失效", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createWorkerRepo({
      generation_jobs: { updateMany },
    } as never);

    await expect(
      repo.requeueImageJobForRetry("300", new Date()),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 300n, status: "processing" },
        data: expect.objectContaining({
          status: "queued",
          fencing_token: { increment: 1 },
          retry_count: { increment: 1 },
        }),
      }),
    );
  });
});

describe("claimNextInProcessJob 恢复扫描认领范围（IK9ILQ）", () => {
  it("claimNextInProcessJob 认领 type∈(image,audio),不碰 video", async () => {
    const now = new Date();
    const findFirst = vi.fn().mockResolvedValue({
      id: 310n,
      project_id: 55n,
      user_id: 6n,
      type: "audio",
      input: {},
      expected_output_count: 1,
      retry_count: 0,
      fencing_token: 3n,
      status: "queued",
      is_delete: false,
      source: "bottom_dock",
      next_action_at: now,
      lease_expires_at: null,
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      generation_jobs: { findFirst, updateMany },
    } as never;
    const repo = createWorkerRepo(prisma);

    const claimed = await repo.claimNextInProcessJob("worker-a");
    expect(claimed?.type).toBe("audio");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: { in: ["image", "audio"] } }),
      }),
    );
  });
});
