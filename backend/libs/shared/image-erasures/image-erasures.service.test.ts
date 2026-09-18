// IKGOT4：擦除创建入口复核矩阵与免费口径单测（先例：image-enhancements.service.test.ts）。
// 只测外部可见行为：拒绝原因可读、落库参数冻结、免费口径无成本预留、凭证冻结。
import { describe, expect, it, vi } from "vitest";

import { ImageErasuresService } from "./image-erasures.service.js";

const VALID_TEXT_BODY = {
  source_asset_id: "88",
  target_node_id: "node-1",
  erase_scene: "full_screen_text_erase",
};

const VALID_AREA_BODY = {
  source_asset_id: "88",
  target_node_id: "node-1",
  erase_scene: "selected_area_erase",
  mask_asset_id: "99",
};

/** 默认源素材：1920x1080 png、5MB；id=99 视为遮罩素材（同形状，均为本人图片）。 */
function makeImageAsset(overrides: Record<string, unknown> = {}) {
  return {
    type: "image",
    url: "https://tos.example.com/uploads/9/image/a.png",
    storage_key: "uploads/9/image/a.png",
    mime: "image/png",
    size: 5_000_000n,
    width: 1920,
    height: 1080,
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
      findOwnedSource: vi.fn().mockImplementation(async (id: string) =>
        id === "99" ? makeImageAsset() : makeImageAsset(),
      ),
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
    service: new ImageErasuresService(prisma as never, project as never, assets as never),
    create,
    costCreate,
    assets,
  };
}

describe("ImageErasuresService.create：契约 schema 复核", () => {
  it("rejects a missing source_asset_id", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_TEXT_BODY, source_asset_id: undefined });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("source_asset_id");
  });

  it("rejects an unknown erase_scene with a readable reason", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_TEXT_BODY,
      erase_scene: "full_screen_icon_erase",
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("擦除场景");
  });

  it("rejects selected_area_erase missing mask_asset_id with a readable reason", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_AREA_BODY,
      mask_asset_id: undefined,
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("遮罩");
  });

  it("rejects full_screen_text_erase carrying mask_asset_id (scene forbids mask)", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_TEXT_BODY,
      mask_asset_id: "99",
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("不支持");
  });

  it("rejects a non-numeric asset id", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_TEXT_BODY, source_asset_id: "08x" });
    expect(result.code).not.toBe(200);
  });

  it("rejects an extra key", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_TEXT_BODY, extra: 1 });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("不支持的参数");
  });
});

describe("ImageErasuresService.create：归属与媒体类型复核", () => {
  it("rejects an unknown project", async () => {
    const { service } = makeService({
      project: { findOwnedById: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects a source asset not owned by the user", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects a non-image asset with a readable reason", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ type: "video" })) },
    });
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("图片");
  });

  it("rejects a mask asset not owned by the user", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockImplementation(async (id: string) =>
          id === "99" ? null : makeImageAsset(),
        ),
      },
    });
    const result = await service.create("9", "55", VALID_AREA_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects a non-image mask asset", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockImplementation(async (id: string) =>
          id === "99" ? makeImageAsset({ type: "video" }) : makeImageAsset(),
        ),
      },
    });
    const result = await service.create("9", "55", VALID_AREA_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("遮罩");
  });
});

describe("ImageErasuresService.create：输入门槛复核（官方 PDF 输入限制）", () => {
  it("accepts at the exact boundary 2560x1440 and vertical 1440x2560 (short/long-side semantics)", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi
          .fn()
          .mockResolvedValueOnce(makeImageAsset({ width: 2560, height: 1440 }))
          .mockResolvedValueOnce(makeImageAsset({ width: 1440, height: 2560 })),
      },
    });
    expect((await service.create("9", "55", VALID_TEXT_BODY)).code).toBe(200);
    // 竖图长短边对调同样合法：短边 1440、长边 2560
    expect((await service.create("9", "55", VALID_TEXT_BODY)).code).toBe(200);
  });

  it("rejects when long side exceeds 2560 (landscape and vertical) with a readable reason", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi
          .fn()
          .mockResolvedValueOnce(makeImageAsset({ width: 2561, height: 100 }))
          .mockResolvedValueOnce(makeImageAsset({ width: 100, height: 2561 })),
      },
    });
    expect((await service.create("9", "55", VALID_TEXT_BODY)).msg).toContain("长边超过");
    expect((await service.create("9", "55", VALID_TEXT_BODY)).msg).toContain("长边超过");
  });

  it("rejects when short side exceeds 1440 with a readable reason", async () => {
    const { service } = makeService({
      assets: {
        // 宽 2000 高 1441：短边 1441 超上限（旧宽高绑定语义会漏判这种横图）
        findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: 2000, height: 1441 })),
      },
    });
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("短边超过");
  });

  it("rejects when a side is below 10px", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: 9, height: 1080 })),
      },
    });
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("尺寸");
  });

  it("rejects a file over 10MB", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(
          makeImageAsset({ size: BigInt(10 * 1024 * 1024) + 1n }),
        ),
      },
    });
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("10MB");
  });

  it("rejects a webp asset with a readable reason (mime)", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ mime: "image/webp" })) },
    });
    const result = await service.create("9", "55", VALID_TEXT_BODY);
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
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("格式");
  });

  it("accepts a heic asset", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ mime: "image/heic" })) },
    });
    const result = await service.create("9", "55", VALID_TEXT_BODY);
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
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).toBe(200);
  });

  it("lets an asset without recorded dimensions pass to the supplier gate", async () => {
    // assets.width/height 由前端上报、存量图大量为 null：缺权威尺寸不臆造、不拦，
    // 交供应商按官方门槛拒（与高清放大同口径）。
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(makeImageAsset({ width: null, height: null })),
      },
    });
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).toBe(200);
  });
});

describe("ImageErasuresService.create：落任务与免费口径", () => {
  it("creates an image_erase job for the full-screen text scene with the frozen three-key input", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_TEXT_BODY);
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({ job_id: "400", status: "queued" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "image_erase",
        source: "image_erase",
        status: "queued",
        user_id: 9n,
        project_id: 55n,
        input: VALID_TEXT_BODY,
        next_action_at: expect.any(Date),
      }),
    });
  });

  it("creates an image_erase job for the selected-area scene with the frozen four-key input", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_AREA_BODY);
    expect(result.code).toBe(200);
    expect(create.mock.calls[0][0].data.input).toEqual(VALID_AREA_BODY);
  });

  it("is free-tier: no cost reservation, no provider row", async () => {
    const { service, create, costCreate } = makeService();
    const result = await service.create("9", "55", VALID_AREA_BODY);
    expect(result.code).toBe(200);
    expect(costCreate).not.toHaveBeenCalled();
    const data = create.mock.calls[0][0].data;
    expect(Object.keys(data)).not.toContain("provider");
  });
});

describe("ImageErasuresService.create：请求方凭证冻结（断链防护）", () => {
  // 断链背景：worker（ImageEraseJobProcessor）只从 input.provider_credential 取请求方 sk-，
  // 创建链路不冻结则必落 provider_credential_missing（先例：图片生成 / 高清放大）。
  it("freezes the requester sk- token into job input (provider_credential)", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_TEXT_BODY, {
      providerCredential: "sk-live-token",
    });
    expect(result.code).toBe(200);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        input: { ...VALID_TEXT_BODY, provider_credential: "sk-live-token" },
      }),
    });
  });

  it("omits provider_credential when the requester carries no sk- token", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_AREA_BODY);
    expect(result.code).toBe(200);
    expect(create.mock.calls[0][0].data.input).toEqual(VALID_AREA_BODY);
  });
});
