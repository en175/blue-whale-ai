import { describe, expect, it, vi } from "vitest";

import { createWorkerRepo } from "./generation-worker-repo.js";

describe("generation media extract worker repo", () => {
  it("claims only the media_extract job named by the RocketMQ message", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 400n,
      project_id: 55n,
      user_id: 9n,
      type: "media_extract",
      status: "queued",
      input: { source_asset_id: "88" },
      fencing_token: 0n,
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createWorkerRepo({
      generation_jobs: { findFirst, updateMany },
    } as never);

    await expect(
      repo.claimMediaExtractJobById("400", "worker-1"),
    ).resolves.toMatchObject({
      id: "400",
      projectId: "55",
      userId: "9",
      workerId: "worker-1",
      fencingToken: 1,
      input: { source_asset_id: "88" },
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 400n, type: "media_extract" }),
      }),
    );
  });

  it("returns null when another worker already claimed the job", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 400n,
      type: "media_extract",
      status: "processing",
      fencing_token: 3n,
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repo = createWorkerRepo({
      generation_jobs: { findFirst, updateMany },
    } as never);

    await expect(
      repo.claimMediaExtractJobById("400", "worker-2"),
    ).resolves.toBeNull();
  });

  it("rejects a stale worker before writing extract progress", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const repo = createWorkerRepo({ generation_jobs: { updateMany } } as never);

    await expect(
      repo.updateMediaExtractProgress({
        jobId: "400",
        workerId: "stale",
        fencingToken: 1,
        progress: 45,
      }),
    ).resolves.toBe(false);
  });

  it("writes monotonic progress for a processing extract job", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repo = createWorkerRepo({ generation_jobs: { updateMany } } as never);

    await expect(
      repo.updateMediaExtractProgress({
        jobId: "400",
        workerId: "worker-1",
        fencingToken: 1,
        progress: 45,
      }),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 400n,
        status: "processing",
        lease_owner: "worker-1",
        fencing_token: 1n,
      },
      data: expect.objectContaining({ progress: 45 }),
    });
  });

  it("rejects a stale worker before publishing an audio asset", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const createAsset = vi.fn();
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        generation_jobs: { updateMany },
        assets: { create: createAsset },
        generation_job_logs: { create: vi.fn() },
      }),
    );
    const repo = createWorkerRepo({ $transaction: transaction } as never);

    await expect(
      repo.publishMediaExtractResult({
        jobId: "400",
        projectId: "55",
        userId: "9",
        workerId: "stale-worker",
        fencingToken: 1,
        url: "https://bucket.test/out.mp3",
        storageKey: "media-extract/9/audio/out.mp3",
        mime: "audio/mpeg",
        size: 1024,
        duration: 8,
      }),
    ).resolves.toBe(false);
    expect(createAsset).not.toHaveBeenCalled();
  });

  it("publishes an audio asset on successful extraction", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const createAsset = vi.fn().mockResolvedValue({ id: 901n, version: 1 });
    const update = vi.fn().mockResolvedValue({});
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        // project_id: null → 跳过 project event 分支
        generation_jobs: {
          updateMany,
          update,
          findUnique: vi.fn().mockResolvedValue({ id: 400n, project_id: null }),
        },
        assets: { create: createAsset },
        generation_job_logs: { create: vi.fn() },
      }),
    );
    const repo = createWorkerRepo({ $transaction: transaction } as never);

    await expect(
      repo.publishMediaExtractResult({
        jobId: "400",
        projectId: "55",
        userId: "9",
        workerId: "worker-1",
        fencingToken: 2,
        url: "https://bucket.test/out.mp3",
        storageKey: "media-extract/9/audio/out.mp3",
        mime: "audio/mpeg",
        size: 1024,
        duration: 8,
      }),
    ).resolves.toBe(true);
    expect(createAsset).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "audio",
        mime: "audio/mpeg",
        duration: 8,
        generation_job_id: 400n,
      }),
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 400n },
      data: { output_asset_ids: [901] },
    });
  });

  it("fails a media_extract job with code and message", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({
        generation_jobs: {
          updateMany,
          findUnique: vi.fn().mockResolvedValue({ id: 400n, project_id: null }),
        },
        generation_job_logs: { create: vi.fn() },
      }),
    );
    const repo = createWorkerRepo({ $transaction: transaction } as never);

    await expect(
      repo.failMediaExtractJob({
        jobId: "400",
        workerId: "worker-1",
        fencingToken: 2,
        code: "video_has_no_audio_track",
        message: "视频没有音轨",
      }),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 400n,
        status: "processing",
        lease_owner: "worker-1",
        fencing_token: 2n,
      },
      data: expect.objectContaining({
        status: "failed",
        error: { code: "video_has_no_audio_track", message: "视频没有音轨" },
      }),
    });
  });
});
