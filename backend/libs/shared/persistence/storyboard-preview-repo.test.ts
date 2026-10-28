import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createStoryboardPreviewRepo } from "./storyboard-preview-repo.js";

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
