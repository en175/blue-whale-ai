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

describe("claimNextInProcessJob 恢复扫描认领范围（IK9ILQ + IKBGKA review 2 轮）", () => {
  it("claimNextInProcessJob 只认领音频（图片已迁 MQ，不再进程内认领）", async () => {
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
        where: expect.objectContaining({ type: "audio" }),
      }),
    );
  });
});

// IKCR78：音频 MQ 消费端 claim + 低频补入队扫描（镜像图片 IKBGKA 语义，type=audio）。
describe("claimAudioJobById + listDueAudioJobIds（IKCR78）", () => {
  function audioRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 400n,
      project_id: 60n,
      user_id: 7n,
      type: "audio",
      status: "queued",
      input: { prompt: "你好", model_id: "tts-model" },
      expected_output_count: 1,
      retry_count: 0,
      fencing_token: 0n,
      is_delete: false,
      source: "bottom_dock",
      next_action_at: new Date(),
      lease_expires_at: null,
      ...overrides,
    };
  }

  it("claimAudioJobById 领取音频 job 时 where 限定 type=audio + queued，不套 source 白名单", async () => {
    const findFirst = vi.fn().mockResolvedValue(audioRow());
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      generation_jobs: { findFirst, updateMany },
    } as never;
    const repo = createWorkerRepo(prisma);

    const claimed = await repo.claimAudioJobById("400", "worker-a");
    expect(claimed).toMatchObject({ id: "400", type: "audio", fencingToken: 1 });
    const where = findFirst.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where).toMatchObject({ id: 400n, type: "audio" });
    // IKC9EJ 对齐 media_extract：claim 不套 source 白名单，与 listDueAudioJobIds（同样不带白名单）
    // 语义对称——非白名单 source 的音频 job 不会被「recovery 补入队但 claim 拒绝」卡死。
    expect(where).not.toHaveProperty("source");
  });

  it("claimAudioJobById 命中处理中且租约过期的音频 job 也可领取（镜像图片语义）", async () => {
    const now = new Date();
    const stale = audioRow({
      status: "processing",
      lease_expires_at: new Date(now.getTime() - 1000),
    });
    const findFirst = vi.fn().mockResolvedValue(stale);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      generation_jobs: { findFirst, updateMany },
    } as never;
    const repo = createWorkerRepo(prisma);

    const claimed = await repo.claimAudioJobById("400", "worker-a");
    expect(claimed?.type).toBe("audio");
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "processing" }),
      }),
    );
  });

  it("listDueAudioJobIds 只捞 type=audio + queued/租约过期孤儿，按 id asc，不套 source 白名单", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ id: 400n }, { id: 401n }]);
    const prisma = { generation_jobs: { findMany } } as never;
    const repo = createWorkerRepo(prisma);

    const ids = await repo.listDueAudioJobIds(100);
    expect(ids).toEqual(["400", "401"]);
    const where = findMany.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where).toMatchObject({ type: "audio" });
    // IKC9EJ 教训：恢复扫描不套 source 白名单，防未来非白名单 source 音频 job 漏捞
    expect(where).not.toHaveProperty("source");
  });
});
