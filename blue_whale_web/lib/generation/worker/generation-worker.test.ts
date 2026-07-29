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
  },
  expected_output_count: 1,
};

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
      provider,
      workerId: "w1",
      jobId: "300",
      userId: "9",
    });

    expect(repo.claimJobById).toHaveBeenCalledWith("300", "9", "w1");
    expect(repo.claimNextJob).not.toHaveBeenCalled();
  });
});

describe("processNextJob - 成功路径", () => {
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
    const deps = { repo, provider, mediaStorage, fetchImpl, workerId: "w1" };

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

    const id = await processNextJob({ repo, provider, workerId: "w1" });

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

    await processNextJob({ repo, provider, workerId: "w1" });

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
      provider,
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

    await processNextJob({ repo, provider, videoProvider, workerId: "w1" });

    expect(videoProvider.generate).toHaveBeenCalledWith({
      model: "seedance-2",
      prompt: "鲸鱼游动",
      duration: 5,
      width: 1280,
      height: 720,
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
      provider,
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

    await processNextJob({ repo, provider, videoProvider, workerId: "w1" });

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
    const id = await processNextJob({ repo, provider, workerId: "w1" });
    expect(id).toBeNull();
    expect(provider.generate).not.toHaveBeenCalled();
  });
});

describe("processNextJob - 失败路径", () => {
  it("provider 抛错 → failJob 带错误码", async () => {
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
          new ImageProviderError("provider_failed", "生成服务返回 500"),
        ),
    };
    const id = await processNextJob({ repo, provider, workerId: "w1" });
    expect(id).toBe("300");
    expect(repo.failJob).toHaveBeenCalledWith(
      "300",
      "provider_failed",
      "生成服务返回 500",
    );
    expect(repo.completeJob).not.toHaveBeenCalled();
  });

  it("model 不在能力表 → failJob model_unavailable", async () => {
    const repo = makeRepo();
    repo.claimNextJob.mockResolvedValue(queuedImageJob);
    repo.findImageCapability.mockResolvedValue(null);
    const provider = mockProvider([]);
    await processNextJob({ repo, provider, workerId: "w1" });
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
    await processNextJob({ repo, provider, workerId: "w1" });
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
    await processNextJob({ repo, provider, workerId: "w1" });
    expect(repo.failJob).toHaveBeenCalledWith(
      "300",
      "no_result",
      expect.any(String),
    );
  });
});
