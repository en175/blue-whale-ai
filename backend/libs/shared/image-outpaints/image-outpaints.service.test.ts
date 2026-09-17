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
  const costCreate = vi.fn();
  const prisma = {
    client: {
      generation_jobs: { create },
      // 免费口径哨兵：任何成本预留写入都会在这里暴露。
      cost_reservations: { create: costCreate },
    },
  };
  return {
    service: new ImageOutpaintsService(prisma as never, project as never, assets as never),
    create,
    costCreate,
  };
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

  it("rejects an asset without recorded dimensions", async () => {
    // 与高清放大「缺尺寸放行」相反：扩展比例相对原图短边换算，缺尺寸无法预检 40% 上限，一律拒绝。
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue({
          type: "image",
          width: null,
          height: null,
          size: 5 * MB,
        }),
      },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("尺寸");
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
