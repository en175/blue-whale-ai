import { describe, expect, it, vi } from "vitest";

import * as generationWorker from "./generation-worker.js";
import { processNextJob } from "./generation-worker.js";
import {
  ImageProviderError,
  type GenerateImageInput,
  type GeneratedImage,
  type ImageProvider,
} from "./image-provider.js";
import type { GeneratedVideo, VideoProvider } from "./video-provider.js";

// worker 编排：认领→出图→建素材→结任务→结算。repo/provider 全 mock。

function makeRepo() {
  return {
    claimJobById: vi.fn(),
    claimNextJob: vi.fn(),
    resolveInputAssets: vi.fn(),
    findImageCapability: vi.fn(),
    createAsset: vi.fn(),
    completeJob: vi.fn(),
    failJob: vi.fn(),
    settleReservation: vi.fn(),
    appendLog: vi.fn(),
    claimVideoJobById: vi.fn(),
    listDueVideoJobIds: vi.fn(),
    claimNextVideoJob: vi.fn(),
    markVideoSubmitted: vi.fn(),
    rescheduleVideoPoll: vi.fn(),
    publishVideoResult: vi.fn(),
    failVideoJob: vi.fn(),
    cancelVideoBeforeDispatch: vi.fn(),
    resetStalledImageJobs: vi.fn().mockResolvedValue(0),
    claimNextImageJob: vi.fn(),
    requeueImageJobForRetry: vi.fn().mockResolvedValue(true),
  };
}

function mockVideoProvider(video: GeneratedVideo): VideoProvider {
  return {
    generate: vi.fn().mockResolvedValue(video),
  };
}

function mockProvider(images: GeneratedImage[]): ImageProvider {
  return {
    generate: vi.fn().mockResolvedValue(images),
  };
}

const queuedImageJob = {
  id: "300",
  project_id: "55",
  user_id: "9",
  type: "image",
  input: {
    prompt: "一只猫",
    model_id: "doubao-seedream-4-0",
    size: "1K",
    web_search: false,
    provider_credential: "sealed-token",
  },
  expected_output_count: 1,
  retry_count: 0,
};

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("processJob - request-scoped token dispatch", () => {
  it("claims only the requested job for the authenticated owner", async () => {
    type ProcessJob = (
      deps: Parameters<typeof processNextJob>[0] & {
        jobId: string;
        userId: string;
      },
    ) => Promise<string | null>;
    const processJob = (generationWorker as { processJob?: ProcessJob })
      .processJob;

    expect(processJob).toBeTypeOf("function");
    if (!processJob) return;

    const repo = makeRepo();
    repo.claimJobById.mockResolvedValue(queuedImageJob);
    repo.findImageCapability.mockResolvedValue({
      model_id: "doubao-seedream-4-0",
      api_size: "1024x1024",
      width: 1024,
      height: 1024,
    });
    repo.createAsset.mockResolvedValue("700");
    const provider = mockProvider([
      { url: "https://cdn.test/x.png", width: 1024, height: 1024 },
    ]);

    await processJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      workerId: "w1",
      jobId: "300",
      userId: "9",
    });

    expect(repo.claimJobById).toHaveBeenCalledWith("300", "9", "w1");
    expect(repo.claimNextJob).not.toHaveBeenCalled();
  });
});

describe("processNextJob - 成功路径", () => {
  it("把模型分辨率和宽高比映射为火山官方像素尺寸", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue({
      ...queuedImageJob,
      input: {
        ...queuedImageJob.input,
        model_id: "doubao-seedream-5-0-260128",
        size: "2k",
        aspect_ratio: "4:3",
      },
    });
    repo.findImageCapability.mockResolvedValue({
      model_id: "doubao-seedream-5-0-260128",
      api_size: "2K",
      width: null,
      height: null,
    });
    repo.createAsset.mockResolvedValue("700");
    const provider = mockProvider([
      { url: "https://ark/x.png", width: null, height: null },
    ]);

    await processNextJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      workerId: "w1",
    });

    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({ size: "2304x1728" }),
    );
  });

  it("把连续组图开关传给图片 provider", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue({
      ...queuedImageJob,
      expected_output_count: 4,
      input: {
        ...queuedImageJob.input,
        sequential_image_generation: true,
      },
    });
    repo.findImageCapability.mockResolvedValue({
      model_id: "doubao-seedream-4-0",
      api_size: "1024x1024",
      width: 1024,
      height: 1024,
    });
    repo.createAsset.mockResolvedValue("700");
    const provider = mockProvider([
      { url: "https://ark/x.png", width: 1024, height: 1024 },
    ]);

    await processNextJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      workerId: "w1",
    });

    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({ n: 4, sequential: true }),
    );
  });

  it("普通多图返回不足时按剩余数量补请求并完整建素材", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue({
      ...queuedImageJob,
      expected_output_count: 2,
    });
    repo.findImageCapability.mockResolvedValue({
      model_id: "doubao-seedream-4-0",
      api_size: "1024x1024",
      width: 1024,
      height: 1024,
    });
    repo.createAsset.mockResolvedValueOnce("701").mockResolvedValueOnce("702");
    const provider: ImageProvider = {
      generate: vi
        .fn()
        .mockResolvedValueOnce([
          {
            url: "https://ark/first.png",
            width: 1024,
            height: 1024,
          },
        ])
        .mockResolvedValueOnce([
          {
            url: "https://ark/second.png",
            width: 1024,
            height: 1024,
          },
        ]),
    };

    await processNextJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      workerId: "w1",
    });

    expect(provider.generate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ n: 2, sequential: false }),
    );
    expect(provider.generate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ n: 1, sequential: false }),
    );
    expect(repo.completeJob).toHaveBeenCalledWith("300", ["701", "702"]);
    expect(repo.failJob).not.toHaveBeenCalled();
  });

  it("连续组图返回数量不足时按剩余数量补请求并完整建素材", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue({
      ...queuedImageJob,
      expected_output_count: 2,
      input: {
        ...queuedImageJob.input,
        sequential_image_generation: true,
      },
    });
    repo.findImageCapability.mockResolvedValue({
      model_id: "doubao-seedream-4-0",
      api_size: "1024x1024",
      width: 1024,
      height: 1024,
    });
    repo.createAsset.mockResolvedValueOnce("701").mockResolvedValueOnce("702");
    const provider: ImageProvider = {
      generate: vi
        .fn()
        .mockResolvedValueOnce([
          {
            url: "https://ark/first.png",
            width: 1024,
            height: 1024,
          },
        ])
        .mockResolvedValueOnce([
          {
            url: "https://ark/second.png",
            width: 1024,
            height: 1024,
          },
        ]),
    };

    await processNextJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      workerId: "w1",
    });

    expect(provider.generate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ n: 2, sequential: true }),
    );
    expect(provider.generate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ n: 1, sequential: true }),
    );
    expect(repo.completeJob).toHaveBeenCalledWith("300", ["701", "702"]);
    expect(repo.failJob).not.toHaveBeenCalled();
  });

  it("provider 图片先转存 TOS，再用对象键创建 Asset", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue(queuedImageJob);
    repo.findImageCapability.mockResolvedValue({
      model_id: "doubao-seedream-4-0",
      api_size: "1024x1024",
      width: 1024,
      height: 1024,
    });
    repo.createAsset.mockResolvedValue("700");
    const provider = mockProvider([
      { url: "https://provider.test/result.png", width: 1024, height: 1024 },
    ]);
    const mediaStorage = {
      prepareUpload: vi.fn().mockResolvedValue({
        storageKey: "generated/9/image/result.png",
        publicUrl: "https://bucket.test/generated/9/image/result.png",
        uploadUrl: "https://bucket.test/signed-put",
        headers: { "Content-Type": "image/png" },
        expiresIn: 600,
      }),
      inspectObject: vi.fn(),
      makePublic: vi.fn(),
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("image-bytes", {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const deps = {
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      mediaStorage,
      fetchImpl,
      workerId: "w1",
    };

    await processNextJob(deps);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://provider.test/result.png",
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://bucket.test/signed-put",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "image/png" },
      }),
    );
    expect(mediaStorage.makePublic).toHaveBeenCalledWith(
      "generated/9/image/result.png",
    );
    expect(fetchImpl.mock.invocationCallOrder[1]).toBeLessThan(
      mediaStorage.makePublic.mock.invocationCallOrder[0],
    );
    expect(mediaStorage.makePublic.mock.invocationCallOrder[0]).toBeLessThan(
      repo.createAsset.mock.invocationCallOrder[0],
    );
    expect(repo.createAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://bucket.test/generated/9/image/result.png",
        storage_key: "generated/9/image/result.png",
        mime: "image/png",
        size: 11,
      }),
    );
  });

  it("能力表和 provider 不含宽高时，从真实图片字节读取尺寸再创建 Asset", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue(queuedImageJob);
    repo.findImageCapability.mockResolvedValue({
      model_id: "doubao-seedream-4-0",
      api_size: "2K",
      width: null,
      height: null,
    });
    repo.createAsset.mockResolvedValue("700");
    const provider = mockProvider([
      {
        url: "https://provider.test/result.png",
        width: null,
        height: null,
      },
    ]);
    const mediaStorage = {
      prepareUpload: vi.fn().mockResolvedValue({
        storageKey: "generated/9/image/result.png",
        publicUrl: "https://bucket.test/generated/9/image/result.png",
        uploadUrl: "https://bucket.test/signed-put",
        headers: { "Content-Type": "image/png" },
        expiresIn: 600,
      }),
      makePublic: vi.fn(),
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(ONE_PIXEL_PNG, {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await processNextJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      mediaStorage,
      fetchImpl,
      workerId: "w1",
    });

    expect(repo.createAsset).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1, height: 1 }),
    );
  });

  it("认领 image 任务 → 调 provider → 建素材 → 结任务 → 结算", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue(queuedImageJob);
    repo.findImageCapability.mockResolvedValue({
      model_id: "doubao-seedream-4-0",
      api_size: "1024x1024",
      width: 1024,
      height: 1024,
    });
    repo.createAsset.mockResolvedValue("700");
    const provider = mockProvider([
      { url: "https://ark/x.png", width: 1024, height: 1024 },
    ]);

    const id = await processNextJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      workerId: "w1",
    });

    expect(id).toBe("300");
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "doubao-seedream-4-0",
        prompt: "一只猫",
        size: "1024x1024",
        n: 1,
      }),
    );
    expect(repo.createAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        generation_job_id: "300",
        url: "https://ark/x.png",
        type: "image",
      }),
    );
    expect(repo.completeJob).toHaveBeenCalledWith("300", ["700"]);
    expect(repo.settleReservation).toHaveBeenCalledWith("300");
    expect(repo.failJob).not.toHaveBeenCalled();
  });

  it("expected_output_count=2 → n=2，两张图都建素材", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue({
      ...queuedImageJob,
      expected_output_count: 2,
    });
    repo.findImageCapability.mockResolvedValue({
      model_id: "m",
      api_size: null,
      width: null,
      height: null,
    });
    repo.createAsset.mockResolvedValueOnce("701").mockResolvedValueOnce("702");
    const provider = mockProvider([
      { url: "https://ark/1.png", width: null, height: null },
      { url: "https://ark/2.png", width: null, height: null },
    ]);

    await processNextJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      workerId: "w1",
    });

    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({ n: 2 }),
    );
    expect(repo.completeJob).toHaveBeenCalledWith("300", ["701", "702"]);
  });

  it("image job with one authorized Asset downloads it and calls image edits", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue({
      ...queuedImageJob,
      input: { ...queuedImageJob.input, reference_asset_ids: [41] },
    });
    repo.resolveInputAssets.mockResolvedValue([
      {
        id: "41",
        type: "image",
        url: "https://cdn.test/source.png",
        mime: "image/png",
      },
    ]);
    repo.findImageCapability.mockResolvedValue({
      model_id: "image-model",
      api_size: "1024x1024",
      width: 1024,
      height: 1024,
    });
    repo.createAsset.mockResolvedValue("700");
    const provider = mockProvider([
      { url: "https://cdn.test/edited.png", width: 1024, height: 1024 },
    ]);

    await processNextJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      workerId: "w1",
      fetchImpl: vi.fn().mockResolvedValue(
        new Response("image-bytes", {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
      ),
    });

    expect(repo.resolveInputAssets).toHaveBeenCalledWith(["41"], "9", "55");
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceImage: expect.objectContaining({ fileName: "asset-41.png" }),
      }),
    );
  });

  it("image job with four authorized Assets preserves their order for image edits", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue({
      ...queuedImageJob,
      input: {
        ...queuedImageJob.input,
        reference_asset_ids: [41, 42, 43, 44],
      },
    });
    repo.resolveInputAssets.mockResolvedValue(
      [41, 42, 43, 44].map((id) => ({
        id: String(id),
        type: "image",
        url: `https://cdn.test/source-${id}.png`,
        mime: "image/png",
      })),
    );
    repo.findImageCapability.mockResolvedValue({
      model_id: "image-model",
      api_size: "1024x1024",
      width: 1024,
      height: 1024,
    });
    repo.createAsset.mockResolvedValue("700");
    const provider = mockProvider([
      { url: "https://cdn.test/edited.png", width: 1024, height: 1024 },
    ]);
    const fetchImpl = vi.fn().mockImplementation(
      async () =>
        new Response("image-bytes", {
          status: 200,
          headers: { "Content-Type": "image/png" },
        }),
    );

    await processNextJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      workerId: "w1",
      fetchImpl,
    });

    expect(repo.resolveInputAssets).toHaveBeenCalledWith(
      ["41", "42", "43", "44"],
      "9",
      "55",
    );
    expect(provider.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceImages: [
          expect.objectContaining({ fileName: "asset-41.png" }),
          expect.objectContaining({ fileName: "asset-42.png" }),
          expect.objectContaining({ fileName: "asset-43.png" }),
          expect.objectContaining({ fileName: "asset-44.png" }),
        ],
      }),
    );
    expect(repo.failJob).not.toHaveBeenCalled();
  });

  it("text-to-video calls the video provider and creates a video Asset", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue({
      ...queuedImageJob,
      type: "video",
      input: {
        prompt: "鲸鱼游动",
        model_id: "seedance-2",
        aspect_ratio: "16:9",
        resolution: "720p",
        duration: 5,
      },
    });
    repo.createAsset.mockResolvedValue("801");
    const provider = mockProvider([]);
    const videoProvider = mockVideoProvider({
      url: "https://cdn.test/video.mp4",
      width: 1280,
      height: 720,
    });

    await processNextJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      videoProvider,
      workerId: "w1",
    });

    expect(videoProvider.generate).toHaveBeenCalledWith({
      model: "seedance-2",
      prompt: "鲸鱼游动",
      duration: 5,
      width: 1280,
      height: 720,
      resolution: "720p",
      ratio: "16:9",
    });
    expect(repo.createAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "video",
        url: "https://cdn.test/video.mp4",
      }),
    );
    expect(repo.completeJob).toHaveBeenCalledWith("300", ["801"]);
  });

  it("provider 视频先转存 TOS，再用对象键创建 Asset", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue({
      ...queuedImageJob,
      type: "video",
      input: {
        prompt: "鲸鱼游动",
        model_id: "seedance-2",
        aspect_ratio: "16:9",
        resolution: "720p",
        duration: 5,
      },
    });
    repo.createAsset.mockResolvedValue("801");
    const provider = mockProvider([]);
    const videoProvider = mockVideoProvider({
      url: "https://provider.test/result.mp4",
      width: 1280,
      height: 720,
    });
    const mediaStorage = {
      prepareUpload: vi.fn().mockResolvedValue({
        storageKey: "generated/9/video/result.mp4",
        publicUrl: "https://bucket.test/generated/9/video/result.mp4",
        uploadUrl: "https://bucket.test/signed-put-video",
        headers: { "Content-Type": "video/mp4" },
        expiresIn: 600,
      }),
      inspectObject: vi.fn(),
      makePublic: vi.fn(),
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("video-bytes", {
          status: 200,
          headers: { "Content-Type": "video/mp4" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const deps = {
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      videoProvider,
      mediaStorage,
      fetchImpl,
      workerId: "w1",
    };

    await processNextJob(deps);

    expect(mediaStorage.makePublic).toHaveBeenCalledWith(
      "generated/9/video/result.mp4",
    );
    expect(fetchImpl.mock.invocationCallOrder[1]).toBeLessThan(
      mediaStorage.makePublic.mock.invocationCallOrder[0],
    );
    expect(mediaStorage.makePublic.mock.invocationCallOrder[0]).toBeLessThan(
      repo.createAsset.mock.invocationCallOrder[0],
    );
    expect(repo.createAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://bucket.test/generated/9/video/result.mp4",
        storage_key: "generated/9/video/result.mp4",
        mime: "video/mp4",
        size: 11,
      }),
    );
  });

  it("image-to-video passes the authorized source image URL", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue({
      ...queuedImageJob,
      type: "video",
      input: {
        prompt: "让图片动起来",
        model_id: "seedance-2",
        aspect_ratio: "16:9",
        resolution: "720p",
        duration: 5,
        reference_asset_ids: [42],
      },
    });
    repo.resolveInputAssets.mockResolvedValue([
      {
        id: "42",
        type: "image",
        url: "https://cdn.test/frame.png",
        mime: "image/png",
      },
    ]);
    repo.createAsset.mockResolvedValue("802");
    const provider = mockProvider([]);
    const videoProvider = mockVideoProvider({
      url: "https://cdn.test/video.mp4",
      width: 1280,
      height: 720,
    });

    await processNextJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      videoProvider,
      workerId: "w1",
    });

    expect(videoProvider.generate).toHaveBeenCalledWith(
      expect.objectContaining({ image: "https://cdn.test/frame.png" }),
    );
  });
});

describe("processNextJob - 无任务", () => {
  it("无 queued 任务 → 返回 null，不调 provider", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue(null);
    const provider = mockProvider([]);
    const id = await processNextJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      workerId: "w1",
    });
    expect(id).toBeNull();
    expect(provider.generate).not.toHaveBeenCalled();
  });
});

describe("processNextJob - 失败路径", () => {
  it("provider 瞬时失败（provider_failed）→ 按退避回 queued 重试，不一次判死", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue(queuedImageJob);
    repo.findImageCapability.mockResolvedValue({
      model_id: "m",
      api_size: null,
      width: null,
      height: null,
    });
    const provider: ImageProvider = {
      generate: vi
        .fn()
        .mockRejectedValue(
          new ImageProviderError("provider_failed", "new-api 不可达"),
        ),
    };
    const id = await processNextJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      workerId: "w1",
    });
    expect(id).toBe("300");
    expect(repo.requeueImageJobForRetry).toHaveBeenCalledWith(
      "300",
      expect.any(Date),
    );
    expect(repo.appendLog).toHaveBeenCalledWith(
      "300",
      "retry_scheduled",
      "queued",
      expect.stringContaining("瞬时失败"),
    );
    // 未到最大次数时不判死，也不结成功。
    expect(repo.failJob).not.toHaveBeenCalled();
    expect(repo.completeJob).not.toHaveBeenCalled();
  });

  it("瞬时失败已达最大重试次数 → failJob 判死", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue({ ...queuedImageJob, retry_count: 3 });
    repo.findImageCapability.mockResolvedValue({
      model_id: "m",
      api_size: null,
      width: null,
      height: null,
    });
    const provider: ImageProvider = {
      generate: vi
        .fn()
        .mockRejectedValue(
          new ImageProviderError("provider_failed", "new-api 不可达"),
        ),
    };
    await processNextJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      workerId: "w1",
    });
    expect(repo.requeueImageJobForRetry).not.toHaveBeenCalled();
    expect(repo.failJob).toHaveBeenCalledWith(
      "300",
      "provider_failed",
      "new-api 不可达",
    );
  });

  it("非瞬时错误（quota_exhausted）→ 直接 failJob 不重试", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue(queuedImageJob);
    repo.findImageCapability.mockResolvedValue({
      model_id: "m",
      api_size: null,
      width: null,
      height: null,
    });
    const provider: ImageProvider = {
      generate: vi
        .fn()
        .mockRejectedValue(
          new ImageProviderError("quota_exhausted", "额度不足"),
        ),
    };
    await processNextJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      workerId: "w1",
    });
    expect(repo.requeueImageJobForRetry).not.toHaveBeenCalled();
    expect(repo.failJob).toHaveBeenCalledWith(
      "300",
      "quota_exhausted",
      "额度不足",
    );
  });

  it("缺少 provider_credential → failJob provider_credential_missing", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue({
      ...queuedImageJob,
      input: { ...queuedImageJob.input, provider_credential: undefined },
    });
    const provider = mockProvider([
      { url: "https://ark/x.png", width: 1, height: 1 },
    ]);
    await processNextJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      workerId: "w1",
    });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(repo.failJob).toHaveBeenCalledWith(
      "300",
      "provider_credential_missing",
      expect.any(String),
    );
  });

  it("model 不在能力表 → failJob model_unavailable", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue(queuedImageJob);
    repo.findImageCapability.mockResolvedValue(null);
    const provider = mockProvider([]);
    await processNextJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      workerId: "w1",
    });
    expect(repo.failJob).toHaveBeenCalledWith(
      "300",
      "model_unavailable",
      expect.stringContaining("doubao-seedream"),
    );
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("missing or foreign reference Asset fails before provider dispatch", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue({
      ...queuedImageJob,
      input: { ...queuedImageJob.input, reference_asset_ids: [99] },
    });
    repo.resolveInputAssets.mockResolvedValue([]);
    const provider = mockProvider([]);
    await processNextJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      workerId: "w1",
    });
    expect(repo.failJob).toHaveBeenCalledWith(
      "300",
      "unsupported_input",
      expect.any(String),
    );
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("provider 返空 → failJob no_result", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue(queuedImageJob);
    repo.findImageCapability.mockResolvedValue({
      model_id: "m",
      api_size: null,
      width: null,
      height: null,
    });
    const provider = mockProvider([]);
    await processNextJob({
      repo,
      createImageProvider: () => provider,
      credentialVault: { open: () => "tok" },
      workerId: "w1",
    });
    expect(repo.failJob).toHaveBeenCalledWith(
      "300",
      "no_result",
      expect.any(String),
    );
  });
});
