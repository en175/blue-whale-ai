import type { WorkerRepo } from "@lib/shared/persistence/index.js";
import type { AssetUploadStorage } from "@lib/shared/assets/upload.js";
import { describe, expect, it, vi } from "vitest";

import { processNextJob } from "./generation-worker.js";

function imageStorage() {
  return {
    prepareUpload: vi.fn().mockResolvedValue({
      storageKey: "k",
      publicUrl: "https://pub/a.png",
      uploadUrl: "https://up/a.png",
      headers: {},
      expiresIn: 60,
    }),
    makePublic: vi.fn().mockResolvedValue(undefined),
  } as unknown as Pick<AssetUploadStorage, "prepareUpload" | "makePublic">;
}

function fetchOk() {
  return vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => "image/png" },
    arrayBuffer: async () => new ArrayBuffer(16),
  });
}

async function runImageJob(input: {
  modelId: string;
  size: string;
  aspectRatio: string;
  capability: Record<string, unknown>;
}) {
  const generate = vi.fn().mockResolvedValue([
    { url: "https://img.test/a.png", width: 512, height: 512, requestId: "req-1" },
  ]);
  const repo = {
    claimNextJob: vi.fn().mockResolvedValue({
      id: "j-img",
      project_id: "p1",
      user_id: "u1",
      type: "image",
      input: {
        prompt: "一只猫",
        model_id: input.modelId,
        size: input.size,
        aspect_ratio: input.aspectRatio,
        provider_credential: "<sealed>",
      },
      expected_output_count: 1,
      retry_count: 0,
      fencingToken: 1,
    }),
    resolveInputAssets: vi.fn().mockResolvedValue([]),
    findImageCapability: vi.fn().mockResolvedValue({
      model_id: input.modelId,
      max_reference_images: 10,
      ...input.capability,
    }),
    createAsset: vi.fn().mockResolvedValue("a1"),
    completeJobAndSettle: vi.fn().mockResolvedValue(true),
    appendLog: vi.fn().mockResolvedValue(undefined),
  } as unknown as WorkerRepo;

  await processNextJob({
    repo,
    workerId: "worker-1",
    createImageProvider: vi.fn().mockReturnValue({ generate }),
    createAudioProvider: vi.fn(),
    credentialVault: { open: vi.fn().mockReturnValue("sk") },
    mediaStorage: imageStorage(),
    fetchImpl: fetchOk(),
  });

  return generate.mock.calls[0]?.[0] as {
    size?: string;
    quality?: string;
  };
}

describe("processNextJob 图片渠道解析器映射", () => {
  it("Seedream 4.0 1K+16:9 仍发现网像素 1312x736", async () => {
    const arg = await runImageJob({
      modelId: "doubao-seedream-4-0-250828",
      size: "1k",
      aspectRatio: "16:9",
      capability: {
        api_size: "1K",
        width: 1024,
        height: 1024,
        channel_parser: "seedream",
        request_mapping: null,
        default_size: "1K",
        default_aspect_ratio: "1:1",
      },
    });
    expect(arg).toMatchObject({ size: "1312x736" });
    expect(arg.quality).toBeUndefined();
  });

  it("GPT 1K+1:1 发 1024x1024", async () => {
    const arg = await runImageJob({
      modelId: "gpt-image-2",
      size: "1k",
      aspectRatio: "1:1",
      capability: {
        api_size: null,
        width: null,
        height: null,
        channel_parser: "gpt",
        default_size: "1k",
        default_aspect_ratio: "1:1",
        request_mapping: {
          matrix: { "1k": { "1:1": "1024x1024" }, "2k": { "16:9": "2048x1152" } },
        },
      },
    });
    expect(arg).toMatchObject({ size: "1024x1024" });
  });

  it("GPT 2K+16:9 发 2048x1152", async () => {
    const arg = await runImageJob({
      modelId: "gpt-image-2",
      size: "2k",
      aspectRatio: "16:9",
      capability: {
        api_size: null,
        width: null,
        height: null,
        channel_parser: "gpt",
        default_size: "1k",
        default_aspect_ratio: "1:1",
        request_mapping: {
          matrix: { "1k": { "1:1": "1024x1024" }, "2k": { "16:9": "2048x1152" } },
        },
      },
    });
    expect(arg).toMatchObject({ size: "2048x1152" });
  });

  it("banana 1K+1:1 发 quality=1k 且 size=1x1", async () => {
    const arg = await runImageJob({
      modelId: "nano-banana",
      size: "1k",
      aspectRatio: "1:1",
      capability: {
        api_size: null,
        width: null,
        height: null,
        channel_parser: "banana",
        default_size: "1k",
        default_aspect_ratio: "1:1",
        request_mapping: {
          quality: { "1k": "1k" },
          size: { "1:1": "1x1" },
        },
      },
    });
    expect(arg).toEqual(expect.objectContaining({ size: "1x1", quality: "1k" }));
  });
});
