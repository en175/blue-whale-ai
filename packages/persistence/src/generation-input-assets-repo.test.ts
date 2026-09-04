import { describe, expect, it, vi } from "vitest";

import { createWorkerRepo } from "./generation-worker-repo.js";

describe("WorkerRepo.resolveInputAssets", () => {
  it("accepts an owner-scoped uploaded Asset before it is attached to a project", async () => {
    const assets = {
      findMany: vi.fn().mockResolvedValue([
        {
          id: BigInt(41),
          type: "video",
          url: "https://tos.test/uploads/9/video/source.mov",
          mime: "video/quicktime",
          size: BigInt(1234),
          width: 1920,
          height: 1080,
          duration_ms: 6500,
        },
      ]),
    };
    const projectAsset = {
      findMany: vi.fn().mockResolvedValue([]),
    };
    const repo = createWorkerRepo({
      assets,
      project_asset: projectAsset,
    } as never);

    await expect(repo.resolveInputAssets(["41"], "9", "55")).resolves.toEqual([
      {
        id: "41",
        type: "video",
        url: "https://tos.test/uploads/9/video/source.mov",
        mime: "video/quicktime",
        size: 1234,
        width: 1920,
        height: 1080,
        duration: 6.5,
      },
    ]);

    expect(projectAsset.findMany).toHaveBeenCalledWith({
      where: { user_id: BigInt(9), project_id: BigInt(55), is_delete: 0 },
      select: { asset_id: true },
    });
    expect(assets.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [BigInt(41)] },
        user_id: BigInt(9),
        OR: [{ project_id: BigInt(55) }, { project_id: BigInt(0) }],
        status: "normal",
        is_delete: false,
      },
      select: {
        id: true,
        type: true,
        url: true,
        mime: true,
        size: true,
        width: true,
        height: true,
        duration_ms: true,
      },
    });
  });

  it("accepts a cross-project asset explicitly linked to the project (IKDD4Z)", async () => {
    // asset 81 原始归属 project 189，但已通过 project_asset 关联到当前项目 55（跨项目复用）。
    const assets = {
      findMany: vi.fn().mockResolvedValue([
        {
          id: BigInt(81),
          type: "video",
          url: "https://tos.test/uploads/9/video/linked.mov",
          mime: "video/quicktime",
          size: BigInt(2048),
          width: 1280,
          height: 720,
          duration_ms: 3000,
        },
      ]),
    };
    const projectAsset = {
      findMany: vi.fn().mockResolvedValue([{ asset_id: BigInt(81) }]),
    };
    const repo = createWorkerRepo({
      assets,
      project_asset: projectAsset,
    } as never);

    await expect(repo.resolveInputAssets(["81"], "9", "55")).resolves.toEqual([
      {
        id: "81",
        type: "video",
        url: "https://tos.test/uploads/9/video/linked.mov",
        mime: "video/quicktime",
        size: 2048,
        width: 1280,
        height: 720,
        duration: 3,
      },
    ]);
    expect(assets.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [BigInt(81)] },
        user_id: BigInt(9),
        OR: [
          { project_id: BigInt(55) },
          { project_id: BigInt(0) },
          { id: { in: [BigInt(81)] } },
        ],
        status: "normal",
        is_delete: false,
      },
      select: {
        id: true,
        type: true,
        url: true,
        mime: true,
        size: true,
        width: true,
        height: true,
        duration_ms: true,
      },
    });
  });

  it("does not expose a cross-project asset that was never linked to the project (IKDD4Z)", async () => {
    // asset 82 归属 project 189，无 project_asset 关联 → 仍判定无权访问。
    const assets = {
      findMany: vi.fn().mockResolvedValue([]),
    };
    const projectAsset = {
      findMany: vi.fn().mockResolvedValue([{ asset_id: BigInt(81) }]),
    };
    const repo = createWorkerRepo({
      assets,
      project_asset: projectAsset,
    } as never);

    await expect(repo.resolveInputAssets(["82"], "9", "55")).resolves.toEqual([]);
    expect(assets.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: [BigInt(82)] },
        user_id: BigInt(9),
        OR: [
          { project_id: BigInt(55) },
          { project_id: BigInt(0) },
          { id: { in: [BigInt(81)] } },
        ],
        status: "normal",
        is_delete: false,
      },
      select: {
        id: true,
        type: true,
        url: true,
        mime: true,
        size: true,
        width: true,
        height: true,
        duration_ms: true,
      },
    });
  });

  it("resolves a media extract source for a cross-project linked asset (IKDD4Z)", async () => {
    // 媒体提取源解析：asset 88 归属 project 189，但关联到当前项目 55 → 可用。
    const assets = {
      findFirst: vi.fn().mockResolvedValue({
        storage_key: "video/9/source.mov",
        url: "https://tos.test/uploads/9/video/source.mov",
        mime: "video/quicktime",
        type: "video",
      }),
    };
    const projectAsset = {
      findMany: vi.fn().mockResolvedValue([{ asset_id: BigInt(88) }]),
    };
    const repo = createWorkerRepo({
      assets,
      project_asset: projectAsset,
    } as never);

    await expect(
      repo.resolveMediaExtractSource("88", "9", "55"),
    ).resolves.toEqual({
      storageKey: "video/9/source.mov",
      mime: "video/quicktime",
      url: "https://tos.test/uploads/9/video/source.mov",
    });
    expect(assets.findFirst).toHaveBeenCalledWith({
      where: {
        id: BigInt(88),
        user_id: BigInt(9),
        OR: [
          { project_id: BigInt(55) },
          { project_id: BigInt(0) },
          { id: { in: [BigInt(88)] } },
        ],
        status: "normal",
        is_delete: false,
      },
      select: { storage_key: true, url: true, mime: true, type: true },
    });
  });
});
