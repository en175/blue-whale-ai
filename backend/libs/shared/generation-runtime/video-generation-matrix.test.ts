import { describe, expect, it, vi } from "vitest";

import {
  runVideoJobStep,
  type VideoJobRunnerRepo,
  type VideoTaskProvider,
} from "./video-job-runner.js";

const MODELS = [
  {
    id: "doubao-seedance-2-0-260128",
    resolutions: ["480p", "720p", "1080p"],
  },
  {
    id: "doubao-seedance-2-0-fast-260128",
    resolutions: ["480p", "720p"],
  },
  {
    id: "doubao-seedance-2-0-mini-260615",
    resolutions: ["480p", "720p"],
  },
] as const;

const RATIOS = ["16:9", "9:16", "1:1"] as const;
const REFERENCE_CASES = [
  {
    name: "text-to-video",
    input: {},
    expected: { references: [] },
  },
  {
    name: "image-to-video",
    input: { reference_asset_ids: ["41"] },
    expected: {
      references: [
        { type: "image", url: "https://assets.test/reference.png" },
      ],
    },
  },
  {
    name: "video-to-video",
    input: { reference_asset_ids: ["42"] },
    expected: {
      references: [
        { type: "video", url: "https://assets.test/reference.mp4" },
      ],
    },
  },
  {
    name: "mixed-reference-to-video",
    input: { reference_asset_ids: ["41", "42"] },
    expected: {
      references: [
        { type: "image", url: "https://assets.test/reference.png" },
        { type: "video", url: "https://assets.test/reference.mp4" },
      ],
    },
  },
  {
    name: "first-frame-to-video",
    input: { first_frame_asset_id: "41" },
    expected: {
      firstFrameImage: "https://assets.test/reference.png",
      references: [],
    },
  },
  {
    name: "first-last-frame-to-video",
    input: {
      first_frame_asset_id: "41",
      last_frame_asset_id: "43",
    },
    expected: {
      firstFrameImage: "https://assets.test/reference.png",
      lastFrameImage: "https://assets.test/last.png",
      references: [],
    },
  },
] as const;

const REFERENCE_ASSETS = {
  "41": {
    id: "41",
    type: "image",
    url: "https://assets.test/reference.png",
    mime: "image/png",
  },
  "42": {
    id: "42",
    type: "video",
    url: "https://assets.test/reference.mp4",
    mime: "video/mp4",
    size: 1024,
    width: 1280,
    height: 720,
    duration: 5,
  },
  "43": {
    id: "43",
    type: "image",
    url: "https://assets.test/last.png",
    mime: "image/png",
  },
} as const;

function expectedDimensions(resolution: string, ratio: string) {
  const height = Number.parseInt(resolution, 10);
  const [ratioWidth, ratioHeight] = ratio.split(":").map(Number);
  return {
    width: Math.round((height * ratioWidth) / ratioHeight / 2) * 2,
    height,
  };
}

function createRepo(input: Record<string, unknown>): VideoJobRunnerRepo {
  const inputAssetIds = [
    input.first_frame_asset_id,
    input.last_frame_asset_id,
    ...(Array.isArray(input.reference_asset_ids)
      ? input.reference_asset_ids
      : []),
  ].filter((id): id is keyof typeof REFERENCE_ASSETS =>
    typeof id === "string" && id in REFERENCE_ASSETS
  );
  return {
    claimVideoJobById: vi.fn().mockResolvedValue({
      id: "matrix-job",
      projectId: "55",
      userId: "9",
      input: {
        ...input,
        provider_credential: "sealed-token",
      },
      providerTaskId: null,
      cancelRequested: false,
      workerId: "matrix-worker",
      fencingToken: 1,
    }),
    claimNextVideoJob: vi.fn(),
    resolveInputAssets: vi
      .fn()
      .mockResolvedValue(inputAssetIds.map((id) => REFERENCE_ASSETS[id])),
    markVideoSubmitted: vi.fn().mockResolvedValue(true),
    rescheduleVideoPoll: vi.fn(),
    publishVideoResult: vi.fn(),
    failVideoJob: vi.fn(),
    cancelVideoBeforeDispatch: vi.fn(),
  };
}

describe("video generation contract matrix", () => {
  it("maps all 1,512 UI-valid combinations to provider requests", async () => {
    let covered = 0;

    for (const model of MODELS) {
      for (const resolution of model.resolutions) {
        for (const ratio of RATIOS) {
          for (let duration = 4; duration <= 15; duration += 1) {
            for (const referenceCase of REFERENCE_CASES) {
              const input = {
                prompt: "video matrix",
                model_id: model.id,
                resolution,
                aspect_ratio: ratio,
                duration,
                ...referenceCase.input,
              };
              const repo = createRepo(input);
              const submit = vi
                .fn<VideoTaskProvider["submit"]>()
                .mockResolvedValue({
                  taskId: `upstream-${covered}`,
                  status: "queued",
                });

              await runVideoJobStep({
                repo,
                workerId: "matrix-worker",
                jobId: "matrix-job",
                createProvider: () => ({ submit, poll: vi.fn() }),
                credentialVault: {
                  open: vi.fn().mockReturnValue("provider-token"),
                },
                mediaRelay: { persist: vi.fn() },
              });

              expect(submit).toHaveBeenCalledWith({
                model: model.id,
                prompt: "video matrix",
                duration,
                resolution,
                ratio,
                ...expectedDimensions(resolution, ratio),
                ...referenceCase.expected,
              });
              expect(repo.failVideoJob).not.toHaveBeenCalled();
              expect(repo.markVideoSubmitted).toHaveBeenCalledOnce();
              covered += 1;
            }
          }
        }
      }
    }

    expect(covered).toBe(1512);
  });
});
