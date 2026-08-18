import type { WorkerRepo } from "@blue-whale/persistence";
import type { AssetUploadStorage } from "@lib/shared/assets/upload.js";
import { describe, expect, it, vi } from "vitest";

import { persistProviderMedia, processNextJob } from "./generation-worker.js";

// IK9ILQ：音频生成接入 —— worker 音频分支 + persistProviderMedia(data 直传) 单测。
// persistProviderMedia 由生成器最小导出（加 export，签名不变），直接覆盖 data 直传 mime 边界；
// worker 音频分支经公开入口 processNextJob 驱动（repo.claimNextJob 返回音频 ClaimedJob）。

function buildStorage() {
  return {
    prepareUpload: vi.fn().mockResolvedValue({
      storageKey: "k",
      publicUrl: "https://pub/a.mp3",
      uploadUrl: "https://up/a.mp3",
      headers: {},
      expiresIn: 60,
    }),
    makePublic: vi.fn().mockResolvedValue(undefined),
  } as unknown as Pick<AssetUploadStorage, "prepareUpload" | "makePublic">;
}

describe("persistProviderMedia data 直传路径（IK9ILQ）", () => {
  it("data 提供 + storage 就绪 → 跳过源下载、PUT 上传字节、mime 回 audio/mpeg", async () => {
    const storage = buildStorage();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });

    const result = await persistProviderMedia(
      "",
      "audio",
      "u1",
      storage,
      fetchImpl,
      new Uint8Array([1, 2, 3]),
    );

    // 只发生一次 PUT 上传，不发起源 URL 下载。
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://up/a.mp3",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(storage.prepareUpload).toHaveBeenCalledWith({
      userId: "u1",
      type: "audio",
      mime: "audio/mpeg",
    });
    expect(storage.makePublic).toHaveBeenCalledWith("k");
    expect(result).toEqual({
      url: "https://pub/a.mp3",
      storageKey: "k",
      mime: "audio/mpeg",
      size: 3,
      width: null,
      height: null,
    });
  });

  it("data 提供但 storage 未配置 → 抛错（不产出 url:'' 死资产）", async () => {
    const fetchImpl = vi.fn();

    await expect(
      persistProviderMedia(
        "",
        "audio",
        "u1",
        undefined,
        fetchImpl,
        new Uint8Array([1, 2, 3]),
      ),
    ).rejects.toThrow("音频转存存储未配置");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("processNextJob 音频分支（IK9ILQ）", () => {
  it("音频任务：解凭证→provider 生成→建 audio 素材→completeJob→按 quota 实扣 100n", async () => {
    const claimNextJob = vi.fn().mockResolvedValue({
      id: "j1",
      project_id: "p1",
      user_id: "u1",
      type: "audio",
      input: {
        prompt: "海浪",
        model_id: "seed-audio-1.0",
        provider_credential: "<sealed>",
      },
      expected_output_count: 1,
      retry_count: 0,
      fencingToken: 5,
    });
    const findImageCapability = vi.fn().mockResolvedValue({
      model_id: "seed-audio-1.0",
      api_size: null,
      width: null,
      height: null,
    });
    const createAsset = vi.fn().mockResolvedValue("a1");
    const completeJob = vi.fn().mockResolvedValue(true);
    const settleReservation = vi.fn().mockResolvedValue(true);
    const appendLog = vi.fn().mockResolvedValue(undefined);
    const repo = {
      claimNextJob,
      findImageCapability,
      createAsset,
      completeJob,
      settleReservation,
      appendLog,
    } as unknown as WorkerRepo;

    const createAudioProvider = vi.fn().mockReturnValue({
      generate: vi.fn().mockResolvedValue({
        data: new Uint8Array([1, 2, 3]),
        mime: "audio/mpeg",
        requestId: "req-1",
      }),
    });
    const storage = buildStorage();
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });

    const jobId = await processNextJob({
      repo,
      workerId: "worker-1",
      createImageProvider: vi.fn(),
      createAudioProvider,
      credentialVault: { open: vi.fn().mockReturnValue("sk") },
      mediaStorage: storage,
      fetchImpl,
      readConsumeQuota: vi.fn().mockResolvedValue(10),
      quotaToFen: vi.fn().mockReturnValue(100n),
    });

    expect(jobId).toBe("j1");
    expect(createAudioProvider).toHaveBeenCalledWith("sk");
    expect(createAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "u1",
        project_id: "p1",
        generation_job_id: "j1",
        type: "audio",
        url: "https://pub/a.mp3",
        mime: "audio/mpeg",
        size: 3,
        storage_key: "k",
        workerId: "worker-1",
        fencingToken: 5,
      }),
    );
    expect(completeJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "j1",
        assetIds: ["a1"],
        workerId: "worker-1",
        fencingToken: 5,
      }),
    );
    // IK9ILQ：音频实扣 = readConsumeQuota(10) → quotaToFen(10) = 100n。
    expect(settleReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "j1",
        actualAmountFen: 100n,
        workerId: "worker-1",
        fencingToken: 5,
      }),
    );
  });
});
