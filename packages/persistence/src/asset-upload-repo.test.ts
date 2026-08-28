import { describe, expect, it, vi } from "vitest";

import { createAssetRepo } from "./asset-repo.js";

describe("AssetRepo upload persistence", () => {
  it("soft-deletes only an active Asset owned by the requested user", async () => {
    const assets = {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const repo = createAssetRepo({ assets } as never);

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
      duration: null,
    };
    const assets = {
      findFirst: vi.fn().mockResolvedValue(committed),
      create: vi.fn().mockResolvedValue(committed),
    };
    const repo = createAssetRepo({ assets } as never);

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

  it("stores precise browser duration without changing the legacy seconds column", async () => {
    const committed = {
      id: BigInt(43),
      type: "video",
      storage_key: "uploads/9/video/reference.mp4",
      url: "https://bucket.tos.test/uploads/9/video/reference.mp4",
      mime: "video/mp4",
      size: BigInt(1024),
      width: 1920,
      height: 1080,
      duration: 7,
    };
    const assets = {
      create: vi.fn().mockResolvedValue(committed),
    };
    const repo = createAssetRepo({ assets } as never);

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
      data: expect.objectContaining({ duration: 7, duration_ms: 6500 }),
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
        duration: null,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const repo = createAssetRepo({ assets } as never);
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
