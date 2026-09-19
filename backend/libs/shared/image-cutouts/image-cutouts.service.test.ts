// IKGXM1：抠图创建入口复核矩阵与免费口径单测（先例：image-erasures.service.test.ts）。
// 只测外部可见行为：拒绝原因可读、落库参数冻结、免费口径无成本预留、凭证冻结、按场景两档上限。
import { describe, expect, it, vi } from "vitest";

import { ImageCutoutsService } from "./image-cutouts.service.js";

const VALID_GENERAL_BODY = {
  source_asset_id: "88",
  target_node_id: "node-1",
  cutout_scene: "general",
};

const VALID_HUMAN_BODY = {
  source_asset_id: "88",
  target_node_id: "node-1",
  cutout_scene: "human",
  need_contour: true,
  contour_color: "#FFFFFF",
  contour_size: 10,
  need_crop_background: false,
};

const VALID_PRODUCT_BODY = {
  source_asset_id: "88",
  target_node_id: "node-1",
  cutout_scene: "product",
  need_contour: false,
  contour_color: "#FFFFFF",
  contour_size: 10,
  need_crop_background: true,
};

/** 默认源素材：4000x3000 png、5MB（general 12MP ≤40MP、human|product 4000≤7680/3000≤4320，三档复核均过）。 */
function makeImageAsset(overrides: Record<string, unknown> = {}) {
  return {
    type: "image",
    url: "https://tos.example.com/uploads/9/image/a.png",
    storage_key: "uploads/9/image/a.png",
    mime: "image/png",
    size: 5_000_000n,
    width: 4000,
    height: 3000,
    ...overrides,
  };
}

function makeService(overrides: {
  project?: unknown;
  assets?: unknown;
  createJob?: unknown;
} = {}) {
  const project = overrides.project ?? { findOwnedById: vi.fn().mockResolvedValue({ id: 55n }) };
  const assets =
    overrides.assets ??
    {
      findOwnedSource: vi.fn().mockImplementation(async (id: string) => makeImageAsset()),
    };
  const create = overrides.createJob ?? vi.fn().mockResolvedValue({ id: 400n });
  const costCreate = vi.fn();
  const prisma = {
    client: {
      generation_jobs: { create },
      // 免费口径哨兵：任何成本预留写入都会在这里暴露。
      cost_reservations: { create: costCreate },
    },
  };
  return {
    service: new ImageCutoutsService(prisma as never, project as never, assets as never),
    create,
    costCreate,
    assets,
  };
}

describe("ImageCutoutsService.create：契约 schema 复核", () => {
  it("rejects a missing source_asset_id", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_GENERAL_BODY, source_asset_id: undefined });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("source_asset_id");
  });

  it("rejects an unknown cutout_scene with a readable reason", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_GENERAL_BODY,
      cutout_scene: "animal",
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("抠图场景");
  });

  it("rejects the general scene carrying enhancement keys (scene forbids them)", async () => {
    // 规格故事 29：通用场景不携带描边与裁剪参数——官方在 general 场景忽略四参，契约 strict 分支无此键。
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_GENERAL_BODY,
      need_contour: true,
      contour_color: "#FFFFFF",
      contour_size: 10,
      need_crop_background: false,
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("通用场景不支持");
  });

  it("rejects the human scene missing need_contour with a readable reason", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      source_asset_id: "88",
      target_node_id: "node-1",
      cutout_scene: "human",
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("need_contour");
  });

  it("rejects a contour_size outside [1,100]", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_HUMAN_BODY,
      contour_size: 101,
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("contour_size");
  });

  it("rejects a non-white contour color", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_HUMAN_BODY,
      contour_color: "#FF0000",
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("contour_color");
  });

  it("rejects a non-numeric asset id", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_GENERAL_BODY, source_asset_id: "08x" });
    expect(result.code).not.toBe(200);
  });

  it("rejects an extra key", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_GENERAL_BODY, extra: 1 });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("不支持的参数");
  });
});

describe("ImageCutoutsService.create：归属与媒体类型复核", () => {
  it("rejects an unknown project", async () => {
    const { service } = makeService({
      project: { findOwnedById: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects a source asset not owned by the user", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects a non-image asset with a readable reason", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ type: "video" })) },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("图片");
  });
});

describe("ImageCutoutsService.create：输入门槛复核（官方 PDF 输入限制，按场景两档）", () => {
  it("accepts the general scene at the exact long-side boundary 10240 (total pixels within 40MP)", async () => {
    // 10240x3906 = 39,997,440 ≤ 40MP：长边恰好到档、总像素仍在限内。
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: 10240, height: 3906 })) },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).toBe(200);
  });

  it("accepts the general scene at exactly 40MP total pixels (10000x4000)", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: 10000, height: 4000 })) },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).toBe(200);
  });

  it("rejects the general scene when total pixels exceed 40MP (sides within limits)", async () => {
    // 10000x4001 = 40,010,000 > 40MP：长边 ≤10240、短边 ≤6000 均过，仅总像素超。
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: 10000, height: 4001 })) },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("总像素超过 40MP");
  });

  it("rejects the general scene when the long side exceeds 10240", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi
          .fn()
          .mockResolvedValueOnce(makeImageAsset({ width: 10241, height: 3000 }))
          .mockResolvedValueOnce(makeImageAsset({ width: 3000, height: 10241 })),
      },
    });
    // 横图竖图同口径（长边 = max、短边 = min）。
    expect((await service.create("9", "55", VALID_GENERAL_BODY)).msg).toContain("长边超过");
    expect((await service.create("9", "55", VALID_GENERAL_BODY)).msg).toContain("长边超过");
  });

  it("rejects the general scene when the short side exceeds 6000 (long side within limit)", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: 7000, height: 6001 })) },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("短边超过");
  });

  it("accepts the human scene at the exact boundary 7680x4320", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: 7680, height: 4320 })) },
    });
    const result = await service.create("9", "55", VALID_HUMAN_BODY);
    expect(result.code).toBe(200);
  });

  it("rejects the human scene when the long side exceeds 7680", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: 7681, height: 4000 })) },
    });
    const result = await service.create("9", "55", VALID_HUMAN_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("长边超过 7680");
  });

  it("rejects the human scene when the short side exceeds 4320", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: 5000, height: 4321 })) },
    });
    const result = await service.create("9", "55", VALID_HUMAN_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("短边超过 4320");
  });

  it("applies the two-tier limits per scene: same image passes general but is rejected for human and product", async () => {
    // 8000x5000 = 40MP：general 档（≤10240/≤6000/≤40MP）恰好全过；human|product 档长边 8000 > 7680 拒
    // （规格故事 15：切人像/商品后更严上限被正确拦截）。
    const asset = makeImageAsset({ width: 8000, height: 5000 });
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(asset) },
    });
    expect((await service.create("9", "55", VALID_GENERAL_BODY)).code).toBe(200);
    expect((await service.create("9", "55", VALID_HUMAN_BODY)).code).not.toBe(200);
    expect((await service.create("9", "55", VALID_PRODUCT_BODY)).code).not.toBe(200);
  });

  it("rejects a file over 30MB", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(
          makeImageAsset({ size: BigInt(30 * 1024 * 1024) + 1n }),
        ),
      },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("30MB");
  });

  it("rejects a webp asset with a readable reason (mime)", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ mime: "image/webp" })) },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("格式");
  });

  it("rejects a gif asset (extension fallback when mime missing)", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(
          makeImageAsset({
            mime: null,
            url: "https://tos.example.com/uploads/9/image/a.gif",
            storage_key: "uploads/9/image/a.gif",
          }),
        ),
      },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("格式");
  });

  it("accepts a heic asset", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ mime: "image/heic" })) },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).toBe(200);
  });

  it("accepts a jpeg asset (jpg 与 jpeg 同源)", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(
          makeImageAsset({
            mime: "image/jpeg",
            url: "https://tos.example.com/uploads/9/image/a.jpg",
            storage_key: "uploads/9/image/a.jpg",
          }),
        ),
      },
    });
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).toBe(200);
  });

  it("lets an asset without recorded dimensions pass to the supplier gate", async () => {
    // assets.width/height 由前端上报、存量图大量为 null：缺权威尺寸不臆造、不拦，
    // 交供应商按官方门槛拒（与擦除/高清同口径，规格故事 5）。
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: null, height: null })),
      },
    });
    const result = await service.create("9", "55", VALID_HUMAN_BODY);
    expect(result.code).toBe(200);
  });
});

describe("ImageCutoutsService.create：落任务与免费口径", () => {
  it("creates an image_cutout job for the general scene with the frozen three-key input", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_GENERAL_BODY);
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({ job_id: "400", status: "queued" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "image_cutout",
        source: "image_cutout",
        status: "queued",
        user_id: 9n,
        project_id: 55n,
        input: VALID_GENERAL_BODY,
        next_action_at: expect.any(Date),
      }),
    });
  });

  it("creates an image_cutout job for the human scene with the frozen seven-key input", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_HUMAN_BODY);
    expect(result.code).toBe(200);
    expect(create.mock.calls[0][0].data.input).toEqual(VALID_HUMAN_BODY);
  });

  it("is free-tier: no cost reservation, no provider row", async () => {
    const { service, create, costCreate } = makeService();
    const result = await service.create("9", "55", VALID_PRODUCT_BODY);
    expect(result.code).toBe(200);
    expect(costCreate).not.toHaveBeenCalled();
    const data = create.mock.calls[0][0].data;
    expect(Object.keys(data)).not.toContain("provider");
  });
});

describe("ImageCutoutsService.create：请求方凭证冻结（断链防护）", () => {
  // 断链背景：worker（ImageCutoutJobProcessor）只从 input.provider_credential 取请求方 sk-，
  // 创建链路不冻结则必落 provider_credential_missing（先例：图片生成 / 擦除）。
  it("freezes the requester sk- token into job input (provider_credential)", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_GENERAL_BODY, {
      providerCredential: "sk-live-token",
    });
    expect(result.code).toBe(200);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        input: { ...VALID_GENERAL_BODY, provider_credential: "sk-live-token" },
      }),
    });
  });

  it("omits provider_credential when the requester carries no sk- token", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_HUMAN_BODY);
    expect(result.code).toBe(200);
    expect(create.mock.calls[0][0].data.input).toEqual(VALID_HUMAN_BODY);
  });
});
