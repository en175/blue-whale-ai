import { describe, expect, it, vi } from "vitest";

import { ImageEnhancementsService } from "./image-enhancements.service.js";

const VALID_BODY = {
  source_asset_id: "88",
  target_node_id: "node-1",
  version_tier: "pro",
  multiple: 2,
  generative_enhance_mode: "generative_first",
  enable_correct_color: false,
};

function makeService(overrides: {
  project?: unknown;
  assets?: unknown;
  createJob?: unknown;
} = {}) {
  const project = overrides.project ?? { findOwnedById: vi.fn().mockResolvedValue({ id: 55n }) };
  const assets =
    overrides.assets ??
    { findOwnedSource: vi.fn().mockResolvedValue({ type: "image", width: 1920, height: 1080 }) };
  const create = overrides.createJob ?? vi.fn().mockResolvedValue({ id: 400n });
  const costCreate = vi.fn();
  const prisma = {
    client: {
      generation_jobs: { create },
      cost_reservations: { create: costCreate },
    },
  };
  return {
    service: new ImageEnhancementsService(prisma as never, project as never, assets as never),
    create,
    costCreate,
  };
}

describe("ImageEnhancementsService.create：契约 schema 复核", () => {
  it("rejects a missing source_asset_id", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, source_asset_id: undefined });
    expect(result.code).not.toBe(200);
  });

  it("rejects an invalid version tier with a readable reason", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, version_tier: "standard" });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("版本档");
  });

  it("rejects a multiple outside 2/4/6 with a readable reason", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, multiple: 3 });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("放大倍数");
  });

  it("rejects an extra key", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, extra: 1 });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("不支持的参数");
  });
});

describe("ImageEnhancementsService.create：归属与媒体类型复核", () => {
  it("rejects an unknown project", async () => {
    const { service } = makeService({
      project: { findOwnedById: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects an asset not owned by the user", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects a non-image asset with a readable reason", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue({ type: "video", width: 1920, height: 1080 }) },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("图片");
  });
});

describe("ImageEnhancementsService.create：版本档能力矩阵复核", () => {
  it("rejects lite with color correction enabled", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_BODY,
      version_tier: "lite",
      enable_correct_color: true,
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("色彩校正");
  });

  it("rejects pro with color correction enabled", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, enable_correct_color: true });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("色彩校正");
  });

  it("rejects lite with an explicitly selected enhance mode", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_BODY,
      version_tier: "lite",
      generative_enhance_mode: "fidelity_first",
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("增强策略");
  });

  it("accepts lite with the default placeholder enhance mode and color off", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_BODY,
      version_tier: "lite",
    });
    expect(result.code).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("accepts max with color correction enabled", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_BODY,
      version_tier: "max",
      enable_correct_color: true,
    });
    expect(result.code).toBe(200);
  });
});

describe("ImageEnhancementsService.create：源图尺寸门槛复核", () => {
  it("accepts lite at the exact boundary 2160x16", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue({ type: "image", width: 2160, height: 16 }) },
    });
    const result = await service.create("9", "55", { ...VALID_BODY, version_tier: "lite" });
    expect(result.code).toBe(200);
  });

  it("rejects lite when the long side exceeds 2160", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue({ type: "image", width: 2161, height: 100 }) },
    });
    const result = await service.create("9", "55", { ...VALID_BODY, version_tier: "lite" });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("Lite");
  });

  it("rejects lite when the short side is below 16", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue({ type: "image", width: 15, height: 100 }) },
    });
    const result = await service.create("9", "55", { ...VALID_BODY, version_tier: "lite" });
    expect(result.code).not.toBe(200);
  });

  it("accepts pro at the exact boundary 2048x256", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue({ type: "image", width: 2048, height: 256 }) },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
  });

  it("rejects pro when the long side exceeds 2048", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue({ type: "image", width: 2049, height: 300 }) },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("Pro");
  });

  it("rejects pro when the short side is below 256", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue({ type: "image", width: 1000, height: 255 }) },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
  });

  it("accepts max at aspect ratio exactly 32 (portrait included)", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue({ type: "image", width: 100, height: 3200 }) },
    });
    const result = await service.create("9", "55", { ...VALID_BODY, version_tier: "max" });
    expect(result.code).toBe(200);
  });

  it("rejects max when the aspect ratio exceeds 32", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue({ type: "image", width: 3201, height: 100 }) },
    });
    const result = await service.create("9", "55", { ...VALID_BODY, version_tier: "max" });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("Max");
  });

  it("rejects max when the short side is below 64", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue({ type: "image", width: 1000, height: 63 }) },
    });
    const result = await service.create("9", "55", { ...VALID_BODY, version_tier: "max" });
    expect(result.code).not.toBe(200);
  });

  it("rejects max when the long side exceeds 6240", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue({ type: "image", width: 6241, height: 1000 }) },
    });
    const result = await service.create("9", "55", { ...VALID_BODY, version_tier: "max" });
    expect(result.code).not.toBe(200);
  });

  it("lets an asset without recorded dimensions pass to the supplier gate", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue({ type: "image", width: null, height: null }) },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
  });
});

describe("ImageEnhancementsService.create：落任务与免费口径", () => {
  it("creates an image_enhance job with the frozen six-key input", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({ job_id: "400", status: "queued" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "image_enhance",
        source: "image_enhance",
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
    const result = await service.create("9", "55", { ...VALID_BODY, version_tier: "max", enable_correct_color: true });
    expect(result.code).toBe(200);
    expect(costCreate).not.toHaveBeenCalled();
    const data = create.mock.calls[0][0].data;
    expect(Object.keys(data)).not.toContain("provider");
  });
});
