import { describe, expect, it, vi } from "vitest";

import { ImageOutpaintsService } from "./image-outpaints.service.js";
import { IMAGE_OUTPAINT_SOURCE_LIMITS } from "@lib/contracts";

const VALID_BODY = {
  source_asset_id: "88",
  target_node_id: "node-1",
  expand_top: 0.1,
  expand_bottom: 0,
  expand_left: 0,
  expand_right: 0.2,
};

const MB = 1024 * 1024;

function makeService(overrides: {
  project?: unknown;
  assets?: unknown;
  createJob?: unknown;
  storage?: unknown;
  updateAsset?: unknown;
} = {}) {
  const project = overrides.project ?? { findOwnedById: vi.fn().mockResolvedValue({ id: 55n }) };
  const assets =
    overrides.assets ??
    {
      findOwnedSource: vi.fn().mockResolvedValue({
        type: "image",
        width: 1920,
        height: 1080,
        size: 5 * MB,
      }),
    };
  const create = overrides.createJob ?? vi.fn().mockResolvedValue({ id: 400n });
  const updateAsset = overrides.updateAsset ?? vi.fn().mockResolvedValue({});
  const costCreate = vi.fn();
  const prisma = {
    client: {
      generation_jobs: { create },
      assets: { update: updateAsset },
      cost_reservations: { create: costCreate },
    },
  };
  const storage = overrides.storage ?? { uploads: null };
  return {
    service: new ImageOutpaintsService(
      prisma as never,
      project as never,
      assets as never,
      storage as never,
    ),
    create,
    costCreate,
    updateAsset,
  };
}

function pngHead(width: number, height: number): Uint8Array {
  const head = new Uint8Array(32);
  head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  head.set([0x00, 0x00, 0x00, 0x0d], 8);
  head.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(head.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return head;
}

describe("ImageOutpaintsService.create：契约 schema 复核", () => {
  it("rejects a missing source_asset_id with a readable reason", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, source_asset_id: undefined });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("源素材");
  });

  it("rejects an expand ratio above 0.4 with a readable reason", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, expand_top: 0.5 });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("上方扩展比例");
  });

  it("rejects a negative expand ratio", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, expand_right: -0.1 });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("右侧扩展比例");
  });

  it("rejects all-zero ratios with the schema-level reason", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_BODY,
      expand_top: 0,
      expand_right: 0,
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("至少一个方向");
  });

  it("rejects an extra key", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, extra: 1 });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("不支持的参数");
  });

  it("accepts ratios at the exact 0.4 boundary", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_BODY,
      expand_top: 0,
      expand_bottom: 0.4,
      expand_left: 0,
      expand_right: 0,
    });
    expect(result.code).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("ImageOutpaintsService.create：归属与媒体类型复核", () => {
  it("rejects an unknown project", async () => {
    const { service } = makeService({
      project: { findOwnedById: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects an asset that does not exist or is not owned by the user", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects a non-image asset with a readable reason", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue({
          type: "video",
          width: 1920,
          height: 1080,
          size: 5 * MB,
        }),
      },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("图片");
  });
});

describe("ImageOutpaintsService.create：源图门槛复核", () => {
  it("accepts at the exact 4160px long-side boundary", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue({
          type: "image",
          width: 4160,
          height: 1080,
          size: 5 * MB,
        }),
      },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
  });

  it("rejects when the long side exceeds 4160px with a readable reason", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue({
          type: "image",
          width: 4161,
          height: 1080,
          size: 5 * MB,
        }),
      },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("4160");
  });

  it("rejects when the file exceeds 10MB with a readable reason", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue({
          type: "image",
          width: 1920,
          height: 1080,
          size: IMAGE_OUTPAINT_SOURCE_LIMITS.maxFileSizeBytes + 1,
        }),
      },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("10MB");
  });

  it("accepts a file at exactly 10MB", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue({
          type: "image",
          width: 1920,
          height: 1080,
          size: IMAGE_OUTPAINT_SOURCE_LIMITS.maxFileSizeBytes,
        }),
      },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
  });

  it("rejects an asset without recorded dimensions when probing is unavailable", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue({
          type: "image",
          width: null,
          height: null,
          size: 5 * MB,
          storage_key: "uploads/9/image/a.png",
        }),
      },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("尺寸");
  });
});

describe("ImageOutpaintsService.create：缺尺寸探测回填（IKGOQ0 验收修订）", () => {
  const assetWithoutDims = {
    type: "image",
    width: null,
    height: null,
    size: 5 * MB,
    storage_key: "uploads/9/image/a.png",
  };

  it("probes real dimensions from storage, backfills the asset row, and creates the job", async () => {
    const readHead = vi.fn().mockResolvedValue(pngHead(1776, 2368));
    const { service, create, updateAsset } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(assetWithoutDims) },
      storage: { uploads: { readHead } },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
    expect(readHead).toHaveBeenCalledWith("uploads/9/image/a.png", 32);
    expect(updateAsset).toHaveBeenCalledWith({
      where: { id: 88n },
      data: { width: 1776, height: 2368 },
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("applies the probed long side to the 4160px gate", async () => {
    const readHead = vi.fn().mockResolvedValue(pngHead(5000, 1080));
    const { service, updateAsset } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(assetWithoutDims) },
      storage: { uploads: { readHead } },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("4160");
    expect(updateAsset).toHaveBeenCalledTimes(1);
  });

  it("falls back to the missing-dimensions rejection when probing finds nothing readable", async () => {
    const readHead = vi.fn().mockResolvedValue(null);
    const { service, updateAsset } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(assetWithoutDims) },
      storage: { uploads: { readHead } },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("尺寸");
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it("still creates the job when the probe succeeds but the backfill write fails", async () => {
    const readHead = vi.fn().mockResolvedValue(pngHead(1776, 2368));
    const { service, create } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(assetWithoutDims) },
      storage: { uploads: { readHead } },
      updateAsset: vi.fn().mockRejectedValue(new Error("db down")),
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not probe when the asset already carries dimensions", async () => {
    const readHead = vi.fn();
    const { service, create } = makeService({
      storage: { uploads: { readHead } },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    expect(readHead).not.toHaveBeenCalled();
  });
});

describe("ImageOutpaintsService.create：落任务与免费口径", () => {
  it("creates an image_outpaint job with the frozen six-key input", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({ job_id: "400", status: "queued" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "image_outpaint",
        source: "image_outpaint",
        status: "queued",
        user_id: 9n,
        project_id: 55n,
        input: VALID_BODY,
        next_action_at: expect.any(Date),
      }),
    });
  });

  it("is free-tier: no cost reservation, no provider row", async () => {
    const { service, create, costCreate } = makeService();
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
    expect(costCreate).not.toHaveBeenCalled();
    const data = create.mock.calls[0][0].data;
    expect(Object.keys(data)).not.toContain("provider");
  });
});
