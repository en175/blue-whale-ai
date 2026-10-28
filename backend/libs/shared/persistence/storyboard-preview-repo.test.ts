import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createStoryboardPreviewRepo } from "./storyboard-preview-repo.js";
import {
  buildTx,
  CAPABILITY_SNAPSHOT,
} from "./scene-card-generation-repo.test-helpers.js";

describe("StoryboardPreviewRepo.createStoryboardPreview 计费（IKR60U）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("建单时按图片口径扣费一次，输出张数带入规格", async () => {
    const tx = buildTx({
      catalog_models: {
        findUnique: vi.fn().mockResolvedValue({
          version: 3,
          enabled: true,
          is_delete: false,
          supported_sizes: [
            { id: "1280x720", label: "720p", api_value: "1280x720" },
          ],
          supported_aspect_ratios: ["16:9"],
          supported_durations: { min: 5, max: 5, step: 1 },
          supported_formats: ["mp4"],
          default_size: "1280x720",
          default_format: null,
          default_aspect_ratio: "16:9",
          default_duration: 5,
          features: { quantity_max: 2 },
        }),
      },
      storyboard_previews: {
        create: vi.fn().mockResolvedValue({ id: 8001n }),
      },
    });
    const transaction = vi.fn(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
    );
    const prisma = { $transaction: transaction } as unknown as PrismaClient;
    const repo = createStoryboardPreviewRepo(prisma);
    const billing = {
      charge: vi.fn().mockResolvedValue(undefined),
      release: vi.fn().mockResolvedValue(undefined),
    };

    const result = await repo.createStoryboardPreview({
      userId: "100",
      projectId: "42",
      sceneCardId: "5001",
      idempotencyKey: "cmd-1",
      requestHash: "a".repeat(64),
      base_scene_card_version: 1,
      parameters: {
        model_id: "doubao-seedance-1.0",
        size: "1280x720",
        aspect_ratio: "16:9",
        count: 2,
      },
      capability_snapshot_version: CAPABILITY_SNAPSHOT,
      billing,
    });

    expect(result.kind).toBe("applied");
    expect(billing.charge).toHaveBeenCalledTimes(1);
    expect(billing.charge.mock.calls[0]![0]).toMatchObject({
      userId: "100",
      jobId: 9001,
      modelId: "doubao-seedance-1.0",
      taskType: "image",
      input: {
        size: "1280x720",
        aspect_ratio: "16:9",
        expected_output_count: 2,
      },
    });
    expect(billing.release).not.toHaveBeenCalled();
  });
});

function buildPrisma(overrides: Record<string, Record<string, ReturnType<typeof vi.fn>>>) {
  return {
    project: {
      findFirst: vi.fn().mockResolvedValue({ id: 42n }),
      ...overrides.project,
    },
    storyboard_previews: {
      findMany: vi.fn().mockResolvedValue([]),
      ...overrides.storyboard_previews,
    },
    generation_output_slots: {
      findMany: vi.fn().mockResolvedValue([]),
      ...overrides.generation_output_slots,
    },
    user_assets: {
      findMany: vi.fn().mockResolvedValue([]),
      ...overrides.user_assets,
    },
  } as unknown as PrismaClient;
}

describe("StoryboardPreviewRepo.listStoryboardFrames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("返回 succeeded 且可访问画格（slot_index 升序，IK70LQ）", async () => {
    const prisma = buildPrisma({
      storyboard_previews: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ first_generation_job_id: 8001n }]),
      },
      generation_output_slots: {
        findMany: vi.fn().mockResolvedValue([
          { id: 109n, asset_id: 300n, slot_index: 0 },
          { id: 110n, asset_id: 301n, slot_index: 1 },
        ]),
      },
      user_assets: {
        findMany: vi.fn().mockResolvedValue([{ id: 300n }, { id: 301n }]),
      },
    });
    const repo = createStoryboardPreviewRepo(prisma);

    const result = await repo.listStoryboardFrames("42", "5001", "100");

    expect(result).toEqual({
      kind: "found",
      frames: [
        { slot_id: "109", asset_id: "300", slot_index: 0 },
        { slot_id: "110", asset_id: "301", slot_index: 1 },
      ],
    });
  });

  it("过滤掉 Asset 不可访问的画格", async () => {
    const prisma = buildPrisma({
      storyboard_previews: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ first_generation_job_id: 8001n }]),
      },
      generation_output_slots: {
        findMany: vi.fn().mockResolvedValue([
          { id: 109n, asset_id: 300n, slot_index: 0 },
          { id: 110n, asset_id: 301n, slot_index: 1 },
        ]),
      },
      user_assets: {
        findMany: vi.fn().mockResolvedValue([{ id: 300n }]),
      },
    });
    const repo = createStoryboardPreviewRepo(prisma);

    const result = await repo.listStoryboardFrames("42", "5001", "100");

    expect(result).toEqual({
      kind: "found",
      frames: [
        { slot_id: "109", asset_id: "300", slot_index: 0 },
      ],
    });
  });

  it("该 SceneCard 无分镜预览时返回空画格列表", async () => {
    const prisma = buildPrisma({
      storyboard_previews: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const repo = createStoryboardPreviewRepo(prisma);

    const result = await repo.listStoryboardFrames("42", "5001", "100");

    expect(result).toEqual({ kind: "found", frames: [] });
  });

  it("项目不归属当前用户返回 forbidden", async () => {
    const prisma = buildPrisma({
      project: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const repo = createStoryboardPreviewRepo(prisma);

    const result = await repo.listStoryboardFrames("42", "5001", "100");

    expect(result).toEqual({ kind: "forbidden" });
  });
});
