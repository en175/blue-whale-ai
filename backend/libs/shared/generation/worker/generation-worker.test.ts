import { composeImagePrompt } from "@blue-whale/core";
import { ERROR_REFERENCE_ASSET_UNAVAILABLE } from "@blue-whale/contracts";
import type { WorkerRepo } from "@lib/shared/persistence/index.js";
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

  it("音频任务带 references：解析 asset→本地 url（不走素材库 asset://），provider.generate 收到 seed-audio references（IKE4GC）", async () => {
    const claimNextJob = vi.fn().mockResolvedValue({
      id: "j2",
      project_id: "p1",
      user_id: "u1",
      type: "audio",
      input: {
        prompt: "海浪",
        model_id: "seed-audio-1.0",
        provider_credential: "<sealed>",
        references: [
          { role: "reference", asset_id: "42", type: "audio" },
          { role: "reference", asset_id: "43", type: "image" },
        ],
      },
      expected_output_count: 1,
      retry_count: 0,
      fencingToken: 5,
    });
    const findImageCapability = vi.fn().mockResolvedValue({
      model_id: "seed-audio-1.0",
    });
    const createAsset = vi.fn().mockResolvedValue("a1");
    const completeJobAndSettle = vi.fn().mockResolvedValue(true);
    const appendLog = vi.fn().mockResolvedValue(undefined);
    const resolveInputAssets = vi.fn().mockResolvedValue([
      { id: "42", type: "audio", url: "https://tos/ref42.mp3", material_id: "asset-bind-1" }, // 虽绑定素材库，音频仍用本地 url
      { id: "43", type: "image", url: "https://tos/ref43.jpg", material_id: null },
    ]);
    const repo = {
      claimNextJob,
      findImageCapability,
      createAsset,
      completeJobAndSettle,
      appendLog,
      resolveInputAssets,
    } as unknown as WorkerRepo;
    const generate = vi.fn().mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      mime: "audio/mpeg",
    });
    const createAudioProvider = vi.fn().mockReturnValue({ generate });

    await processNextJob({
      repo,
      workerId: "worker-1",
      createImageProvider: vi.fn(),
      createAudioProvider,
      credentialVault: { open: vi.fn().mockReturnValue("sk") },
      mediaStorage: buildStorage(),
      fetchImpl: vi.fn().mockResolvedValue({ ok: true }),
    });

    expect(resolveInputAssets).toHaveBeenCalledWith(["42", "43"], "u1", "p1");
    expect(generate).toHaveBeenCalledWith({
      model: "seed-audio-1.0",
      prompt: "海浪",
      references: [
        { audio_url: "https://tos/ref42.mp3" }, // 按资产实际类型 → audio_url，用本地 url（绑定素材库也转 asset://）
        { image_url: "https://tos/ref43.jpg" }, // 图片资产 → image_url
      ],
    });
  });

  it("音频任务带 references 但 asset 不存在 → 参考素材不存在或无权访问", async () => {
    const claimNextJob = vi.fn().mockResolvedValue({
      id: "j3",
      project_id: "p1",
      user_id: "u1",
      type: "audio",
      input: {
        prompt: "海浪",
        model_id: "seed-audio-1.0",
        provider_credential: "<sealed>",
        references: [{ role: "reference", asset_id: "999", type: "audio" }],
      },
      expected_output_count: 1,
      retry_count: 0,
      fencingToken: 5,
    });
    const findImageCapability = vi.fn().mockResolvedValue({
      model_id: "seed-audio-1.0",
    });
    const failJob = vi.fn().mockResolvedValue(true);
    const repo = {
      claimNextJob,
      findImageCapability,
      resolveInputAssets: vi.fn().mockReturnValue([]), // asset 不存在
      failJob,
      appendLog: vi.fn(),
    } as unknown as WorkerRepo;
    const createAudioProvider = vi.fn().mockReturnValue({ generate: vi.fn() });

    const jobId = await processNextJob({
      repo,
      workerId: "worker-1",
      createImageProvider: vi.fn(),
      createAudioProvider,
      credentialVault: { open: vi.fn().mockReturnValue("sk") },
      mediaStorage: buildStorage(),
      fetchImpl: vi.fn().mockResolvedValue({ ok: true }),
    });

    expect(jobId).toBe("j3");
    expect(failJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "j3",
        errorCode: ERROR_REFERENCE_ASSET_UNAVAILABLE,
        errorMessage: "参考素材不存在或无权访问",
      }),
    );
  });

  it("音频任务带 references：重复来源（本地 url 相同）只保留首个（IKE4GC 去重）", async () => {
    const claimNextJob = vi.fn().mockResolvedValue({
      id: "j4",
      project_id: "p1",
      user_id: "u1",
      type: "audio",
      input: {
        prompt: "海浪",
        model_id: "seed-audio-1.0",
        provider_credential: "<sealed>",
        references: [
          { role: "reference", asset_id: "42", type: "audio" },
          { role: "reference", asset_id: "43", type: "audio" }, // 与 42 同 url
        ],
      },
      expected_output_count: 1,
      retry_count: 0,
      fencingToken: 5,
    });
    const findImageCapability = vi.fn().mockResolvedValue({ model_id: "seed-audio-1.0" });
    const createAsset = vi.fn().mockResolvedValue("a1");
    const completeJobAndSettle = vi.fn().mockResolvedValue(true);
    const appendLog = vi.fn().mockResolvedValue(undefined);
    const resolveInputAssets = vi.fn().mockReturnValue([
      { id: "42", type: "audio", url: "https://tos/same.mp3", material_id: null },
      { id: "43", type: "audio", url: "https://tos/same.mp3", material_id: null },
    ]);
    const repo = {
      claimNextJob, findImageCapability, createAsset, completeJobAndSettle, appendLog, resolveInputAssets,
    } as unknown as WorkerRepo;
    const generate = vi.fn().mockResolvedValue({ data: new Uint8Array([1]), mime: "audio/mpeg" });
    const createAudioProvider = vi.fn().mockReturnValue({ generate });

    await processNextJob({
      repo,
      workerId: "worker-1",
      createImageProvider: vi.fn(),
      createAudioProvider,
      credentialVault: { open: vi.fn().mockReturnValue("sk") },
      mediaStorage: buildStorage(),
      fetchImpl: vi.fn().mockResolvedValue({ ok: true }),
    });

    // 两个 reference 都解析成同一本地 url → 去重仅保留 1 个。
    expect(generate).toHaveBeenCalledWith({
      model: "seed-audio-1.0",
      prompt: "海浪",
      references: [{ audio_url: "https://tos/same.mp3" }],
    });
  });

  it("音频任务带 references：asset 实际类型为 video → 参考素材类型不适用（IKE4GC）", async () => {
    const claimNextJob = vi.fn().mockResolvedValue({
      id: "j5",
      project_id: "p1",
      user_id: "u1",
      type: "audio",
      input: {
        prompt: "海浪",
        model_id: "seed-audio-1.0",
        provider_credential: "<sealed>",
        references: [{ role: "reference", asset_id: "44", type: "image" }],
      },
      expected_output_count: 1,
      retry_count: 0,
      fencingToken: 5,
    });
    const findImageCapability = vi.fn().mockResolvedValue({ model_id: "seed-audio-1.0" });
    const failJob = vi.fn().mockResolvedValue(true);
    const repo = {
      claimNextJob,
      findImageCapability,
      resolveInputAssets: vi.fn().mockReturnValue([
        { id: "44", type: "video", url: "https://tos/v.mp4", material_id: null },
      ]),
      failJob,
      appendLog: vi.fn(),
    } as unknown as WorkerRepo;
    const createAudioProvider = vi.fn().mockReturnValue({ generate: vi.fn() });

    await processNextJob({
      repo,
      workerId: "worker-1",
      createImageProvider: vi.fn(),
      createAudioProvider,
      credentialVault: { open: vi.fn().mockReturnValue("sk") },
      mediaStorage: buildStorage(),
      fetchImpl: vi.fn().mockResolvedValue({ ok: true }),
    });

    expect(failJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "j5",
        errorMessage: "参考素材类型不适用",
      }),
    );
  });

  it("音频任务 references 为损坏形状（非数组）→ 参考素材引用无效（IKE4GC）", async () => {
    const claimNextJob = vi.fn().mockResolvedValue({
      id: "j6",
      project_id: "p1",
      user_id: "u1",
      type: "audio",
      input: {
        prompt: "海浪",
        model_id: "seed-audio-1.0",
        provider_credential: "<sealed>",
        references: { role: "reference" }, // 非数组
      },
      expected_output_count: 1,
      retry_count: 0,
      fencingToken: 5,
    });
    const findImageCapability = vi.fn().mockResolvedValue({ model_id: "seed-audio-1.0" });
    const failJob = vi.fn().mockResolvedValue(true);
    const repo = {
      claimNextJob,
      findImageCapability,
      resolveInputAssets: vi.fn(),
      failJob,
      appendLog: vi.fn(),
    } as unknown as WorkerRepo;
    const createAudioProvider = vi.fn().mockReturnValue({ generate: vi.fn() });

    await processNextJob({
      repo,
      workerId: "worker-1",
      createImageProvider: vi.fn(),
      createAudioProvider,
      credentialVault: { open: vi.fn().mockReturnValue("sk") },
      mediaStorage: buildStorage(),
      fetchImpl: vi.fn().mockResolvedValue({ ok: true }),
    });

    expect(failJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "j6",
        errorMessage: "参考素材引用无效",
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

// IKA72G：图片参考图上限读取能力配置（features.max_reference_images）、字段统一 input_asset_ids、
// 失败文案输出真实上限。video 旧版单图分支维持 1 张并输出真实上限文案。
describe("processNextJob 图片参考图上限与字段语义（IKA72G）", () => {
  function imageJobWithRefs(
    refIds: (string | number)[],
    maxReferenceImages?: number,
  ) {
    const claimNextJob = vi.fn().mockResolvedValue({
      id: "j-img-refs",
      project_id: "p1",
      user_id: "u1",
      type: "image",
      input: {
        prompt: "一只猫",
        model_id: "m1",
        provider_credential: "<sealed>",
        input_asset_ids: refIds,
      },
      expected_output_count: 1,
      retry_count: 0,
      fencingToken: 11,
    });
    const findImageCapability = vi.fn().mockResolvedValue({
      model_id: "m1",
      api_size: null,
      width: 512,
      height: 512,
      ...(maxReferenceImages !== undefined
        ? { max_reference_images: maxReferenceImages }
        : {}),
    });
    return { claimNextJob, findImageCapability };
  }

  it("5 张参考图 + 能力 10 → 从 input_asset_ids 解析素材并成功出图", async () => {
    const { claimNextJob, findImageCapability } = imageJobWithRefs(
      ["101", "102", "103", "104", "105"],
      10,
    );
    const resolveInputAssets = vi.fn().mockResolvedValue(
      ["101", "102", "103", "104", "105"].map((id) => ({
        id,
        type: "image",
        url: `https://asset/${id}.png`,
        mime: "image/png",
        size: 1,
        width: 512,
        height: 512,
        duration: null,
      })),
    );
    const createAsset = vi.fn().mockResolvedValue("a1");
    const completeJobAndSettle = vi.fn().mockResolvedValue(true);
    const appendLog = vi.fn().mockResolvedValue(undefined);
    const repo = {
      claimNextJob,
      resolveInputAssets,
      findImageCapability,
      createAsset,
      completeJobAndSettle,
      appendLog,
    } as unknown as WorkerRepo;
    const generate = vi.fn().mockResolvedValue([
      { url: "https://img.test/a.png", width: 512, height: 512, requestId: "req-1" },
    ]);
    const createImageProvider = vi.fn().mockReturnValue({ generate });

    const jobId = await processNextJob({
      repo,
      workerId: "worker-1",
      createImageProvider,
      createAudioProvider: vi.fn(),
      credentialVault: { open: vi.fn().mockReturnValue("sk") },
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(["x"], { type: "image/png" }),
      }),
    });

    expect(jobId).toBe("j-img-refs");
    // 字段语义：worker 从 input_asset_ids 读取参考图（不再读 reference_asset_ids）
    expect(resolveInputAssets).toHaveBeenCalledWith(
      ["101", "102", "103", "104", "105"],
      "u1",
      "p1",
    );
    const providerArg = generate.mock.calls[0]![0] as {
      sourceImages?: Array<{ url?: string }>;
    };
    expect(providerArg.sourceImages).toHaveLength(5);
    expect(providerArg.sourceImages?.map((item) => item.url)).toEqual([
      "https://asset/101.png",
      "https://asset/102.png",
      "https://asset/103.png",
      "https://asset/104.png",
      "https://asset/105.png",
    ]);
    expect(completeJobAndSettle).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "j-img-refs", assetIds: ["a1"] }),
    );
  });

  it("11 张参考图 > 能力 10 → 失败，文案含真实上限", async () => {
    const { claimNextJob, findImageCapability } = imageJobWithRefs(
      Array.from({ length: 11 }, (_, i) => i + 1),
      10,
    );
    const failJob = vi.fn().mockResolvedValue(true);
    const repo = {
      claimNextJob,
      findImageCapability,
      failJob,
    } as unknown as WorkerRepo;

    await processNextJob({
      repo,
      workerId: "worker-1",
      createImageProvider: vi.fn(),
      createAudioProvider: vi.fn(),
      credentialVault: { open: vi.fn().mockReturnValue("sk") },
    });

    expect(failJob).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "unsupported_input",
        errorMessage: "当前模型最多支持 10 张参考图",
      }),
    );
  });

  it("能力配置更小（3）→ 4 张参考图失败，文案含 3", async () => {
    const { claimNextJob, findImageCapability } = imageJobWithRefs(
      [1, 2, 3, 4],
      3,
    );
    const failJob = vi.fn().mockResolvedValue(true);
    const repo = {
      claimNextJob,
      findImageCapability,
      failJob,
    } as unknown as WorkerRepo;

    await processNextJob({
      repo,
      workerId: "worker-1",
      createImageProvider: vi.fn(),
      createAudioProvider: vi.fn(),
      credentialVault: { open: vi.fn().mockReturnValue("sk") },
    });

    expect(failJob).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: "当前模型最多支持 3 张参考图",
      }),
    );
  });

  it("能力快照缺失 max_reference_images → 回退常量 10（10 张通过）", async () => {
    const { claimNextJob, findImageCapability } = imageJobWithRefs(
      Array.from({ length: 10 }, (_, i) => i + 1),
    );
    const resolveInputAssets = vi.fn().mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        id: String(i + 1),
        type: "image",
        url: `https://asset/${i + 1}.png`,
        mime: "image/png",
        size: 1,
        width: 512,
        height: 512,
        duration: null,
      })),
    );
    const createAsset = vi.fn().mockResolvedValue("a1");
    const completeJobAndSettle = vi.fn().mockResolvedValue(true);
    const appendLog = vi.fn().mockResolvedValue(undefined);
    const repo = {
      claimNextJob,
      resolveInputAssets,
      findImageCapability,
      createAsset,
      completeJobAndSettle,
      appendLog,
    } as unknown as WorkerRepo;

    const jobId = await processNextJob({
      repo,
      workerId: "worker-1",
      createImageProvider: vi.fn().mockReturnValue({
        generate: vi.fn().mockResolvedValue([
          { url: "https://img.test/a.png", width: 512, height: 512, requestId: "req-1" },
        ]),
      }),
      createAudioProvider: vi.fn(),
      credentialVault: { open: vi.fn().mockReturnValue("sk") },
      fetchImpl: vi.fn().mockResolvedValue({
        ok: true,
        blob: async () => new Blob(["x"], { type: "image/png" }),
      }),
    });

    expect(jobId).toBe("j-img-refs");
    expect(completeJobAndSettle).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "j-img-refs" }),
    );
  });

  it("video 任务带 2 张 reference_asset_ids → 旧版单图分支失败，文案含 1（video 走 RocketMQ 不受影响）", async () => {
    const claimNextJob = vi.fn().mockResolvedValue({
      id: "j-video-refs",
      project_id: "p1",
      user_id: "u1",
      type: "video",
      input: {
        prompt: "海边",
        model_id: "seedance-2.0",
        reference_asset_ids: ["11", "12"],
      },
      expected_output_count: 1,
      retry_count: 0,
      fencingToken: 12,
    });
    const failJob = vi.fn().mockResolvedValue(true);
    const repo = {
      claimNextJob,
      failJob,
    } as unknown as WorkerRepo;

    await processNextJob({
      repo,
      workerId: "worker-1",
      createImageProvider: vi.fn(),
      createAudioProvider: vi.fn(),
      credentialVault: { open: vi.fn().mockReturnValue("sk") },
    });

    expect(failJob).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "unsupported_input",
        errorMessage: "当前模型最多支持 1 张参考图",
      }),
    );
  });
});

// IKDLQF：文本附件驱动图片生成——worker 组 providerInput.prompt 时调用 composeImagePrompt
// （契约「供应商请求组合」：附件正文按序在前、忽略纯空白、目标提示词非空则最后追加，"\n\n" 连接）。
describe("processNextJob 文本附件组合 prompt（IKDLQF）", () => {
  async function runImageJob(input: Record<string, unknown>) {
    const claimNextJob = vi.fn().mockResolvedValue({
      id: "j-img-att",
      project_id: "p1",
      user_id: "u1",
      type: "image",
      input: {
        model_id: "m1",
        provider_credential: "<sealed>",
        ...input,
      },
      expected_output_count: 1,
      retry_count: 0,
      fencingToken: 21,
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
    const generate = vi.fn().mockResolvedValue([
      { url: "https://img.test/a.png", width: 512, height: 512, requestId: "req-1" },
    ]);
    const createImageProvider = vi.fn().mockReturnValue({ generate });

    const jobId = await processNextJob({
      repo,
      workerId: "worker-1",
      createImageProvider,
      createAudioProvider: vi.fn(),
      credentialVault: { open: vi.fn().mockReturnValue("sk") },
    });

    return { jobId, generate, completeJobAndSettle };
  }

  it("带 text_attachments：provider 收到的 prompt 与 composeImagePrompt(冻结附件, 冻结 prompt) 精确相等", async () => {
    const textAttachments = [
      { node_id: "n1", title: "背景", text: "背景：雨夜" },
      { node_id: "n2", title: "空白附件", text: "   " },
      { node_id: "n3", title: "风格", text: "风格：水彩" },
    ];

    const { generate } = await runImageJob({
      prompt: "画一只猫",
      text_attachments: textAttachments,
    });

    const providerArg = generate.mock.calls[0]![0] as { prompt: string };
    expect(providerArg.prompt).toBe(
      composeImagePrompt(textAttachments, "画一只猫"),
    );
  });

  it("仅附件、prompt 为空字符串：可生成且 provider 收到附件正文", async () => {
    const { jobId, generate, completeJobAndSettle } = await runImageJob({
      prompt: "",
      text_attachments: [
        { node_id: "n1", title: "设定", text: "一只在雨中的猫" },
      ],
    });

    expect(jobId).toBe("j-img-att");
    const providerArg = generate.mock.calls[0]![0] as { prompt: string };
    expect(providerArg.prompt).toBe("一只在雨中的猫");
    expect(completeJobAndSettle).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "j-img-att", assetIds: ["a1"] }),
    );
  });

  it("附件与目标提示词同时送达且顺序正确（附件按序在前，prompt 最后追加）", async () => {
    const { generate } = await runImageJob({
      prompt: "画一只猫",
      text_attachments: [
        { node_id: "n1", title: "甲", text: "背景：雨夜" },
        { node_id: "n2", title: "乙", text: "风格：水彩" },
      ],
    });

    const providerArg = generate.mock.calls[0]![0] as { prompt: string };
    expect(providerArg.prompt).toBe("背景：雨夜\n\n风格：水彩\n\n画一只猫");
  });

  // IKDLQH：排序后的快照——provider prompt 严格跟随快照数组顺序（非 node_id/标题排序），钉住「供应商请求顺序=快照顺序」。
  it("快照数组为非默认顺序时 provider prompt 精确跟随（IKDLQH 顺序钉扎）", async () => {
    const { generate } = await runImageJob({
      prompt: "目标提示词",
      text_attachments: [
        { node_id: "n9", title: "乙", text: "正文乙" },
        { node_id: "n1", title: "甲", text: "正文甲" },
      ],
    });

    const providerArg = generate.mock.calls[0]![0] as { prompt: string };
    expect(providerArg.prompt).toBe("正文乙\n\n正文甲\n\n目标提示词");
  });

  it("无 text_attachments 的旧任务 input：provider 收到的 prompt 逐字节不变（回归）", async () => {
    const { jobId, generate } = await runImageJob({ prompt: "一只猫" });

    expect(jobId).toBe("j-img-att");
    const providerArg = generate.mock.calls[0]![0] as { prompt: string };
    expect(providerArg.prompt).toBe("一只猫");
  });
});
