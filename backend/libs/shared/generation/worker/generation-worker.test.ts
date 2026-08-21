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
    const completeJobAndSettle = vi.fn().mockResolvedValue(true);
    const appendLog = vi.fn().mockResolvedValue(undefined);
    const repo = {
      claimNextJob,
      findImageCapability,
      createAsset,
      completeJobAndSettle,
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
    expect(completeJobAndSettle).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "j1",
        assetIds: ["a1"],
        workerId: "worker-1",
        fencingToken: 5,
      }),
    );
    // IK9ILQ：音频实扣 = readConsumeQuota(10) → quotaToFen(10) = 100n（单事务结算）。
    expect(completeJobAndSettle).toHaveBeenCalledWith(
      expect.objectContaining({
        actualAmountFen: 100n,
      }),
    );
  });
});

describe("processNextJob 图片实扣取证（IK9VZ0）", () => {
  it("实扣取证失败（流水查不到）必须告警，而非静默落 0", async () => {
    const claimNextJob = vi.fn().mockResolvedValue({
      id: "j-img",
      project_id: "p1",
      user_id: "u1",
      type: "image",
      input: {
        prompt: "一只猫",
        model_id: "m1",
        provider_credential: "<sealed>",
      },
      expected_output_count: 1,
      retry_count: 0,
      fencingToken: 7,
    });
    const findImageCapability = vi.fn().mockResolvedValue({
      model_id: "m1",
      api_size: null,
      width: 512,
      height: 512,
    });
    const createAsset = vi.fn().mockResolvedValue("a1");
    const completeJobAndSettle = vi.fn().mockResolvedValue(true);
    const appendLog = vi.fn().mockResolvedValue(undefined);
    const repo = {
      claimNextJob,
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      findImageCapability,
      createAsset,
      completeJobAndSettle,
      appendLog,
    } as unknown as WorkerRepo;

    const createImageProvider = vi.fn().mockReturnValue({
      generate: vi.fn().mockResolvedValue([
        {
          url: "https://img.test/a.png",
          width: 512,
          height: 512,
          requestId: "req-1",
        },
      ]),
    });
    const storage = {
      prepareUpload: vi.fn().mockResolvedValue({
        storageKey: "k",
        publicUrl: "https://pub/a.png",
        uploadUrl: "https://up/a.png",
        headers: {},
        expiresIn: 60,
      }),
      makePublic: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pick<AssetUploadStorage, "prepareUpload" | "makePublic">;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => "image/png" },
        arrayBuffer: async () => new ArrayBuffer(16),
      })
      .mockResolvedValueOnce({ ok: true });
    const warnLogs: string[] = [];

    const jobId = await processNextJob({
      repo,
      workerId: "worker-1",
      createImageProvider,
      createAudioProvider: vi.fn(),
      credentialVault: { open: vi.fn().mockReturnValue("sk") },
      mediaStorage: storage,
      fetchImpl,
      // 流水查不到 → 取证失败
      readConsumeQuota: vi.fn().mockResolvedValue(null),
      quotaToFen: vi.fn().mockReturnValue(123n),
      warn: (msg: string) => warnLogs.push(msg),
    });

    expect(jobId).toBe("j-img");
    // 取证失败必须告警（含 actual_amount_fen 落 0 语义），不再静默
    expect(warnLogs.some((l) => l.includes("actual_amount_fen") && l.includes("0"))).toBe(true);
    // 仍正常完成 job，actual 落 0（不传 actualAmountFen，单事务结算）
    expect(completeJobAndSettle).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "j-img", assetIds: ["a1"] }),
    );
    expect(completeJobAndSettle).not.toHaveBeenCalledWith(
      expect.objectContaining({ actualAmountFen: expect.anything() }),
    );
  });

  it("失败但 new-api 流水显示已扣 → warn 告警 + failJob 写 releaseNote=refund_unverified", async () => {
    const claimNextJob = vi.fn().mockResolvedValue({
      id: "j-img-fail",
      project_id: "p1",
      user_id: "u1",
      type: "image",
      input: {
        prompt: "一只猫",
        model_id: "m1",
        provider_credential: "<sealed>",
      },
      expected_output_count: 1,
      retry_count: 3,
      fencingToken: 8,
    });
    const findImageCapability = vi.fn().mockResolvedValue({
      model_id: "m1",
      api_size: null,
      width: 512,
      height: 512,
    });
    const failJob = vi.fn().mockResolvedValue(true);
    const repo = {
      claimNextJob,
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      findImageCapability,
      failJob,
    } as unknown as WorkerRepo;
    const createImageProvider = vi.fn().mockReturnValue({
      generate: vi.fn().mockResolvedValue([
        {
          url: "https://img.test/a.png",
          width: 512,
          height: 512,
          requestId: "req-1",
        },
      ]),
    });
    const warnLogs: string[] = [];

    await processNextJob({
      repo,
      workerId: "worker-1",
      createImageProvider,
      createAudioProvider: vi.fn(),
      credentialVault: { open: vi.fn().mockReturnValue("sk") },
      // 下载失败 → 任务失败（generate 已发出请求，requestId 有证据）
      fetchImpl: vi.fn().mockRejectedValue(new Error("download failed")),
      readConsumeQuota: vi.fn().mockResolvedValue(1000),
      quotaToFen: vi.fn().mockReturnValue(100n),
      warn: (msg: string) => warnLogs.push(msg),
    });

    // 失败但流水显示已扣 → 必须告警
    expect(warnLogs.some((l) => l.includes("已扣"))).toBe(true);
    // releaseNote = refund_unverified（可能已扣，需人工核对退款）
    expect(failJob).toHaveBeenCalledWith(
      expect.objectContaining({ releaseNote: "refund_unverified" }),
    );
  });

  it("取证查询异常 → 不得记 refund_confirmed（审计结论写反风险，IK9VZ0 C2）", async () => {
    const claimNextJob = vi.fn().mockResolvedValue({
      id: "j-img-c2",
      project_id: "p1",
      user_id: "u1",
      type: "image",
      input: {
        prompt: "一只猫",
        model_id: "m1",
        provider_credential: "<sealed>",
      },
      expected_output_count: 1,
      retry_count: 3,
      fencingToken: 9,
    });
    const findImageCapability = vi.fn().mockResolvedValue({
      model_id: "m1",
      api_size: null,
      width: 512,
      height: 512,
    });
    const failJob = vi.fn().mockResolvedValue(true);
    const repo = {
      claimNextJob,
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      findImageCapability,
      failJob,
    } as unknown as WorkerRepo;
    const createImageProvider = vi.fn().mockReturnValue({
      generate: vi.fn().mockResolvedValue([
        { url: "https://img.test/a.png", width: 512, height: 512, requestId: "req-1" },
      ]),
    });
    const warnLogs: string[] = [];

    await processNextJob({
      repo,
      workerId: "worker-1",
      createImageProvider,
      createAudioProvider: vi.fn(),
      credentialVault: { open: vi.fn().mockReturnValue("sk") },
      fetchImpl: vi.fn().mockRejectedValue(new Error("download failed")),
      // 取证查询抛错（如 new-api 宕机）→ 无法确认退款
      readConsumeQuota: vi.fn().mockRejectedValue(new Error("upstream down")),
      quotaToFen: vi.fn().mockReturnValue(100n),
      warn: (msg: string) => warnLogs.push(msg),
    });

    // C2：查询异常必须 refund_unverified，绝不能 refund_confirmed（与注释意图相反）
    expect(failJob).toHaveBeenCalledWith(
      expect.objectContaining({ releaseNote: "refund_unverified" }),
    );
    expect(failJob).not.toHaveBeenCalledWith(
      expect.objectContaining({ releaseNote: "refund_confirmed" }),
    );
  });

  it("无 request_id 证据失败 → 默认 releaseNote=refund_unverified（需求 4 每次失败必留痕）", async () => {
    const claimNextJob = vi.fn().mockResolvedValue({
      id: "j-img-noev",
      project_id: "p1",
      user_id: "u1",
      type: "image",
      input: {
        prompt: "一只猫",
        model_id: "m1",
        provider_credential: "<sealed>",
      },
      expected_output_count: 1,
      retry_count: 3,
      fencingToken: 10,
    });
    const findImageCapability = vi.fn().mockResolvedValue({
      model_id: "m1",
      api_size: null,
      width: 512,
      height: 512,
    });
    const failJob = vi.fn().mockResolvedValue(true);
    const repo = {
      claimNextJob,
      resolveInputAssets: vi.fn().mockResolvedValue([]),
      findImageCapability,
      failJob,
    } as unknown as WorkerRepo;
    const createImageProvider = vi.fn().mockReturnValue({
      // generate 抛错 → 未产生任何 request_id 证据
      generate: vi.fn().mockRejectedValue(new Error("provider boom")),
    });

    await processNextJob({
      repo,
      workerId: "worker-1",
      createImageProvider,
      createAudioProvider: vi.fn(),
      credentialVault: { open: vi.fn().mockReturnValue("sk") },
      readConsumeQuota: vi.fn().mockResolvedValue(null),
      quotaToFen: vi.fn().mockReturnValue(100n),
    });

    expect(failJob).toHaveBeenCalledWith(
      expect.objectContaining({ releaseNote: "refund_unverified" }),
    );
  });
});
