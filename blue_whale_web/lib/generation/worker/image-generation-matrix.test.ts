import { describe, expect, it, vi } from "vitest";

import { resolveSeedreamImageSize } from "../seedream-image-size";
import { processNextJob } from "./generation-worker";
import type { GenerateImageInput, ImageProvider } from "./image-provider";

const RATIOS = [
  "1:1",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
  "3:2",
  "2:3",
  "21:9",
] as const;

const MODELS = [
  {
    id: "doubao-seedream-5-0-pro-260628",
    sizes: ["1k", "2k"],
    quantityMax: 1,
    referenceMax: 0,
    webSearch: [false],
    sequential: [false],
  },
  {
    id: "doubao-seedream-5-0-260128",
    sizes: ["2k", "3k", "4k"],
    quantityMax: 4,
    referenceMax: 4,
    webSearch: [false, true],
    sequential: [false, true],
  },
  {
    id: "doubao-seedream-4-5-251128",
    sizes: ["2k", "4k"],
    quantityMax: 4,
    referenceMax: 4,
    webSearch: [false],
    sequential: [false, true],
  },
  {
    id: "doubao-seedream-4-0-250828",
    sizes: ["1k", "2k", "4k"],
    quantityMax: 4,
    referenceMax: 4,
    webSearch: [false],
    sequential: [false, true],
  },
] as const;

const SOURCE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function matrixRepo(
  job: Record<string, unknown>,
  model: string,
  size: string,
  referenceCount: number,
) {
  let assetId = 0;
  return {
    claimJobById: vi.fn(),
    claimNextJob: vi.fn().mockResolvedValue(job),
    resolveInputAssets: vi.fn().mockResolvedValue(
      Array.from({ length: referenceCount }, (_, index) => ({
        id: String(42 + index),
        type: "image",
        url: `https://assets.test/source-${index}.png`,
        mime: "image/png",
      })),
    ),
    findImageCapability: vi.fn().mockResolvedValue({
      model_id: model,
      api_size: size.toUpperCase(),
      width: null,
      height: null,
    }),
    createAsset: vi.fn().mockImplementation(async () => String(++assetId)),
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
    resetStalledImageJobs: vi.fn(),
    claimNextImageJob: vi.fn(),
    requeueImageJobForRetry: vi.fn(),
  };
}

describe("image generation contract matrix", () => {
  it("maps all 3,536 UI-valid combinations to provider requests", async () => {
    let covered = 0;

    for (const model of MODELS) {
      for (const size of model.sizes) {
        for (const ratio of RATIOS) {
          for (let quantity = 1; quantity <= model.quantityMax; quantity += 1) {
            for (
              let referenceCount = 0;
              referenceCount <= model.referenceMax;
              referenceCount += 1
            ) {
              for (const webSearch of model.webSearch) {
                for (const sequential of model.sequential) {
                  const job = {
                    id: `matrix-${covered}`,
                    project_id: "62",
                    user_id: "7",
                    type: "image",
                    input: {
                      prompt: "matrix",
                      model_id: model.id,
                      size,
                      aspect_ratio: ratio,
                      web_search: webSearch,
                      sequential_image_generation: sequential,
                      provider_credential: "matrix-token",
                      reference_asset_ids: Array.from(
                        { length: referenceCount },
                        (_, index) => String(42 + index),
                      ),
                    },
                    expected_output_count: quantity,
                  };
                  const repo = matrixRepo(job, model.id, size, referenceCount);
                  const provider: ImageProvider = {
                    generate: vi
                      .fn()
                      .mockImplementation(async (input: GenerateImageInput) =>
                        Array.from({ length: input.n }, (_, index) => ({
                          url: `https://provider.test/${covered}-${index}.png`,
                          width: null,
                          height: null,
                        })),
                      ),
                  };

                  await processNextJob({
                    repo,
                    createImageProvider: () => provider,
                    credentialVault: { open: () => "tok" },
                    workerId: "matrix",
                    fetchImpl: async () =>
                      new Response(SOURCE_PNG, {
                        status: 200,
                        headers: { "Content-Type": "image/png" },
                      }),
                  });

                  expect(provider.generate).toHaveBeenCalledWith(
                    expect.objectContaining({
                      model: model.id,
                      size: resolveSeedreamImageSize(model.id, size, ratio),
                      n: quantity,
                      webSearch,
                      sequential,
                      ...(referenceCount === 1
                        ? {
                            sourceImage: expect.objectContaining({
                              fileName: "asset-42.png",
                            }),
                          }
                        : referenceCount > 1
                          ? {
                              sourceImages: Array.from(
                                { length: referenceCount },
                                (_, index) =>
                                  expect.objectContaining({
                                    fileName: `asset-${42 + index}.png`,
                                  }),
                              ),
                            }
                          : {}),
                    }),
                  );
                  expect(repo.failJob).not.toHaveBeenCalled();
                  expect(repo.completeJob).toHaveBeenCalledOnce();
                  covered += 1;
                }
              }
            }
          }
        }
      }
    }

    expect(covered).toBe(3536);
  });
});
