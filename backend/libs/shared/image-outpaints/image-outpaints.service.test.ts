// IKGOQV：扩图创建入口复核矩阵与免费口径单测（先例：image-enhancements.service.test.ts）。
// 只测外部可见行为：拒绝原因可读、落库参数冻结、免费口径无成本预留。
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
      // 免费口径哨兵：任何成本预留写入都会在这里暴露。
      cost_reservations: { create: costCreate },
    },
  };
  // 默认 storage 不可用（uploads=null）：缺尺寸时探测跳过，落回拒绝——与修订前行为一致。
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

/** 一份最小的真 PNG 头（8 字节签名 + IHDR），宽高按参数写入第 16/20 字节。 */
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
    // 归属过滤在 findOwnedSource 内：不存在与非本人统一 404，不泄露存在性。
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
    // 缺尺寸且探测不可用（storage 未配置）→ 落回缺尺寸拒绝，行为与修订前一致。
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
    // 库里约四成图片资产宽高为 NULL（画布/资产库上传路径历史上不上报）——探测回填让这些
    // 存量资产直接可用，不再要求用户重新上传。
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
    // 探测值同样过门槛：探测出长边超 4160 的图照样拒绝（探测只是补数据，不放松口径）。
    const readHead = vi.fn().mockResolvedValue(pngHead(5000, 1080));
    const { service, updateAsset } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(assetWithoutDims) },
      storage: { uploads: { readHead } },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("4160");
    expect(updateAsset).toHaveBeenCalledTimes(1); // 回填照做，后续请求不再重复探测
  });

  it("falls back to the missing-dimensions rejection when probing finds nothing readable", async () => {
    // 探测不到（文件损坏/布局未覆盖）→ 拒绝，此时「请重新上传」名副其实。
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
    // 回填失败只丢一次优化：本次复核照用探测值放行。
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
        expected_output_count: 1,
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

describe("ImageOutpaintsService.create：请求方凭证冻结（断链防护）", () => {
  // 断链背景：worker（ImageOutpaintJobProcessor，IKGOQW）只从 input.provider_credential 取请求方 sk-，
  // 创建链路不冻结则必落 provider_credential_missing（先例：图片生成/高清放大）。
  it("freezes the requester sk- token into job input (provider_credential)", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_BODY, {
      providerCredential: "sk-live-token",
    });
    expect(result.code).toBe(200);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        input: { ...VALID_BODY, provider_credential: "sk-live-token" },
      }),
    });
  });

  it("omits provider_credential when the requester carries no sk- token", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
    expect(create.mock.calls[0][0].data.input).toEqual(VALID_BODY);
  });
});
