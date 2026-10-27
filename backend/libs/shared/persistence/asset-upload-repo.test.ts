import { describe, expect, it, vi } from "vitest";

import { createAssetRepo } from "./asset-repo.js";

describe("AssetRepo upload persistence", () => {
  it("soft-deletes only an active Asset owned by the requested user", async () => {
    const assets = {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const project_asset = {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    };
    const prisma = {
      $transaction: vi.fn(
        async (cb: (tx: unknown) => Promise<unknown>) =>
          cb({ user_assets: assets, project_asset }),
      ),
    };
    const repo = createAssetRepo(prisma as never);

    await expect(repo.softDeleteOwned("42", "9")).resolves.toBe(true);

    expect(assets.updateMany).toHaveBeenCalledWith({
      where: {
        id: BigInt(42),
        user_id: BigInt(9),
        is_delete: false,
      },
      data: {
        is_delete: true,
        deleted_at: expect.any(Date),
        version: { increment: 1 },
        gmt_modified: expect.any(Date),
      },
    });
  });

  it("commits a verified upload directly into the owner's project", async () => {
    const committed = {
      id: BigInt(42),
      type: "image",
      storage_key: "uploads/9/image/file.png",
      url: "https://bucket.tos.test/uploads/9/image/file.png",
      mime: "image/png",
      size: BigInt(1024),
      width: null,
      height: null,
    };
    const assets = {
      findFirst: vi.fn().mockResolvedValue(committed),
      create: vi.fn().mockResolvedValue(committed),
    };
    const project_asset = {
      upsert: vi.fn().mockResolvedValue({}),
    };
    const prisma = {
      user_assets: assets,
      $transaction: vi.fn(
        async (cb: (tx: unknown) => Promise<unknown>) =>
          cb({ user_assets: assets, project_asset }),
      ),
    };
    const repo = createAssetRepo(prisma as never);

    const existing = await repo.findCommittedUpload(
      "9",
      "uploads/9/image/file.png",
    );
    const created = await repo.createUploadedAsset({
      userId: "9",
      projectId: "55",
      type: "image",
      mime: "image/png",
      size: 1024,
      storageKey: "uploads/9/image/file.png",
      url: "https://bucket.tos.test/uploads/9/image/file.png",
    });

    expect(assets.findFirst).toHaveBeenCalledWith({
      where: {
        user_id: BigInt(9),
        storage_key: "uploads/9/image/file.png",
        status: "normal",
        is_delete: false,
      },
      select: expect.any(Object),
    });
    expect(assets.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: BigInt(9),
        project_id: BigInt(55),
        source: "uploaded",
        status: "normal",
      }),
      select: expect.any(Object),
    });
    expect(existing).toMatchObject({ id: "42" });
    expect(created).toMatchObject({ id: "42" });
  });

  it("stores precise browser duration in milliseconds", async () => {
    const committed = {
      id: BigInt(43),
      type: "video",
      storage_key: "uploads/9/video/reference.mp4",
      url: "https://bucket.tos.test/uploads/9/video/reference.mp4",
      mime: "video/mp4",
      size: BigInt(1024),
      width: 1920,
      height: 1080,
      duration_ms: 6500,
    };
    const assets = {
      create: vi.fn().mockResolvedValue(committed),
    };
    const project_asset = {
      upsert: vi.fn().mockResolvedValue({}),
    };
    const prisma = {
      $transaction: vi.fn(
        async (cb: (tx: unknown) => Promise<unknown>) =>
          cb({ user_assets: assets, project_asset }),
      ),
    };
    const repo = createAssetRepo(prisma as never);

    await repo.createUploadedAsset({
      userId: "9",
      projectId: "55",
      type: "video",
      mime: "video/mp4",
      size: 1024,
      storageKey: "uploads/9/video/reference.mp4",
      url: "https://bucket.tos.test/uploads/9/video/reference.mp4",
      width: 1920,
      height: 1080,
      duration: 6.5,
    });

    expect(assets.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ duration_ms: 6500 }),
      select: expect.any(Object),
    });
  });

  it("IKGOTB：source 原样落库（mask_erase 遮罩中间素材），缺省 uploaded", async () => {
    const committed = {
      id: BigInt(44),
      type: "image",
      storage_key: "uploads/9/image/mask.png",
      url: "https://bucket.tos.test/uploads/9/image/mask.png",
      mime: "image/png",
      size: BigInt(100),
      width: 1600,
      height: 900,
      duration_ms: null,
    };
    const assets = { create: vi.fn().mockResolvedValue(committed) };
    const project_asset = { upsert: vi.fn().mockResolvedValue({}) };
    const prisma = {
      $transaction: vi.fn(
        async (cb: (tx: unknown) => Promise<unknown>) =>
          cb({ user_assets: assets, project_asset }),
      ),
    };
    const repo = createAssetRepo(prisma as never);

    await repo.createUploadedAsset({
      userId: "9",
      projectId: "55",
      type: "image",
      mime: "image/png",
      size: 100,
      storageKey: "uploads/9/image/mask.png",
      url: "https://bucket.tos.test/uploads/9/image/mask.png",
      width: 1600,
      height: 900,
      source: "mask_erase",
    });
    expect(assets.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ source: "mask_erase" }),
      select: expect.any(Object),
    });

    await repo.createUploadedAsset({
      userId: "9",
      projectId: "0",
      type: "image",
      mime: "image/png",
      size: 100,
      storageKey: "uploads/9/image/plain.png",
      url: "https://bucket.tos.test/uploads/9/image/plain.png",
    });
    expect(assets.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ source: "uploaded" }),
      select: expect.any(Object),
    });
  });

  it("creates, reads, and completes an owner-scoped pending upload", async () => {
    const assets = {
      create: vi.fn().mockResolvedValue({ id: BigInt(41) }),
      findFirst: vi.fn().mockResolvedValue({
        id: BigInt(41),
        type: "image",
        storage_key: "uploads/9/image/file.png",
        url: "https://bucket.tos.test/uploads/9/image/file.png",
        mime: "image/png",
        size: BigInt(1024),
        width: null,
        height: null,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const repo = createAssetRepo({ user_assets: assets } as never);
    const uploadRepo = repo as typeof repo & {
      createPendingUpload: (input: {
        userId: string;
        type: "image" | "video";
        mime: string;
        size: number;
        storageKey: string;
        url: string;
      }) => Promise<string>;
      findPendingUpload: (assetId: string, userId: string) => Promise<unknown>;
      markUploadReady: (assetId: string, userId: string) => Promise<boolean>;
    };

    expect(uploadRepo.createPendingUpload).toBeTypeOf("function");
    const id = await uploadRepo.createPendingUpload({
      userId: "9",
      type: "image",
      mime: "image/png",
      size: 1024,
      storageKey: "uploads/9/image/file.png",
      url: "https://bucket.tos.test/uploads/9/image/file.png",
    });
    const pending = await uploadRepo.findPendingUpload("41", "9");
    const completed = await uploadRepo.markUploadReady("41", "9");

    expect(id).toBe("41");
    expect(assets.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: BigInt(9),
        project_id: BigInt(0),
        status: "uploading",
        source: "uploaded",
      }),
    });
    expect(assets.findFirst).toHaveBeenCalledWith({
      where: {
        id: BigInt(41),
        user_id: BigInt(9),
        status: "uploading",
        is_delete: false,
      },
      select: expect.any(Object),
    });
    expect(pending).toMatchObject({ id: "41", type: "image" });
    expect(assets.updateMany).toHaveBeenCalledWith({
      where: {
        id: BigInt(41),
        user_id: BigInt(9),
        status: "uploading",
        is_delete: false,
      },
      data: { status: "normal", version: { increment: 1 } },
    });
    expect(completed).toBe(true);
  });
});

describe("AssetRepo upload md5 去重（IKCNLS）", () => {
  it("findOwnedByMd5 查该用户未删同 md5 最新资产", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 999n,
      type: "image",
      storage_key: "uploads/9/image/a.png",
      url: "https://bucket.tos.test/uploads/9/image/a.png",
      mime: "image/png",
      size: 1n,
      width: null,
      height: null,
      duration_ms: null,
    });
    const prisma = { user_assets: { findFirst } };
    const repo = createAssetRepo(prisma as never);

    const found = await repo.findOwnedByMd5("9", "abc123");
    expect(findFirst).toHaveBeenCalledWith({
      where: { user_id: 9n, md5: "abc123", status: "normal", is_delete: false, NOT: { source: "mask_erase" } },
      orderBy: { id: "desc" },
      select: expect.any(Object),
    });
    expect(found).toMatchObject({ id: "999" });
  });

  it("findOwnedByMd5 无命中返回 null", async () => {
    const prisma = { user_assets: { findFirst: vi.fn().mockResolvedValue(null) } };
    const repo = createAssetRepo(prisma as never);
    await expect(repo.findOwnedByMd5("9", "nonexistent")).resolves.toBeNull();
  });

  it("createUploadedAsset 落库写入 md5", async () => {
    const assets = {
      create: vi.fn().mockResolvedValue({
        id: 42n, type: "image", storage_key: "k", url: "u",
        mime: "image/png", size: 1n, width: null, height: null, duration_ms: null,
      }),
    };
    const project_asset = { upsert: vi.fn().mockResolvedValue({}) };
    const prisma = {
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({ user_assets: assets, project_asset })),
    };
    const repo = createAssetRepo(prisma as never);

    await repo.createUploadedAsset({
      userId: "9", projectId: "55", type: "image", mime: "image/png",
      size: 1, storageKey: "k", url: "u", md5: "abc123",
    });

    expect(assets.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ md5: "abc123" }),
      select: expect.any(Object),
    });
  });
});

describe("AssetRepo.bindMaterialId（IKGQWR / ADR-0093 决策 5）", () => {
  const MATERIAL = "asset-20260820153209-6c9z8";

  function repoWith(overrides: {
    owned?: unknown;
    onTransaction?: (attempt: number) => void;
  } = {}) {
    const assets = {
      findFirst: vi.fn().mockResolvedValue(
        "owned" in overrides
          ? overrides.owned
          : {
              id: BigInt(526),
              material_id: null,
            },
      ),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
    };
    let attempt = 0;
    const prisma = {
      user_assets: assets,
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
        attempt += 1;
        overrides.onTransaction?.(attempt);
        return cb({ user_assets: assets });
      }),
    };
    return { repo: createAssetRepo(prisma as never), assets, prisma };
  }

  it("先摘旧主、再写本行", async () => {
    const { repo, assets } = repoWith();
    await expect(
      repo.bindMaterialId({
        userId: "9",
        assetId: "526",
        materialId: MATERIAL,
      }),
    ).resolves.toBe(true);

    expect(assets.updateMany).toHaveBeenCalledWith({
      where: {
        material_id: MATERIAL,
        user_id: BigInt(9),
        id: { not: BigInt(526) },
      },
      data: expect.objectContaining({
        material_id: null,
      }),
    });
    expect(assets.update).toHaveBeenCalledWith({
      where: { id: BigInt(526) },
      data: expect.objectContaining({
        material_id: MATERIAL,
      }),
    });
  });

  it("并发撞唯一键（P2002）→ 重跑一次即成功，不冒成 500", async () => {
    const { repo, prisma } = repoWith({
      onTransaction: (attempt) => {
        if (attempt === 1) {
          throw Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
          });
        }
      },
    });

    await expect(
      repo.bindMaterialId({
        userId: "9",
        assetId: "526",
        materialId: MATERIAL,
      }),
    ).resolves.toBe(true);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("非 P2002 的错误直接抛出，不做第二次尝试（别把真故障吞成成功）", async () => {
    const { repo, prisma } = repoWith({
      onTransaction: (attempt) => {
        if (attempt === 1) throw new Error("db down");
      },
    });

    await expect(
      repo.bindMaterialId({
        userId: "9",
        assetId: "526",
        materialId: MATERIAL,
      }),
    ).rejects.toThrow("db down");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("已绑同一张素材且组 id 一致 → 幂等返回，一次写都不发", async () => {
    const { repo, prisma } = repoWith({
      owned: {
        id: BigInt(526),
        material_id: MATERIAL,
      },
    });

    await expect(
      repo.bindMaterialId({
        userId: "9",
        assetId: "526",
        materialId: MATERIAL,
      }),
    ).resolves.toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("资产不归属当前用户 → false，不写库", async () => {
    const { repo, prisma } = repoWith({ owned: null });
    await expect(
      repo.bindMaterialId({
        userId: "9",
        assetId: "526",
        materialId: MATERIAL,
      }),
    ).resolves.toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
