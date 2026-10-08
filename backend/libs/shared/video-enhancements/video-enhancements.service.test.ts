// IKH3VE：视频 HD 高清创建入口复核矩阵与免费口径单测（先例：video-subtitle-erasures.service.test.ts）。
// 只测外部可见行为：拒绝原因可读、落库参数冻结、免费口径无成本预留、凭证冻结、入队失败回拨终态
// （回拨在 controller 测试覆盖，这里覆盖 service.create / markFailed 的落库口径）。
import { describe, expect, it, vi } from "vitest";

import { VideoEnhancementsService } from "./video-enhancements.service.js";

const VALID_BODY = {
  source_asset_id: "88",
  target_node_id: "node-1",
  resolution: "1080p",
};

/** 默认源素材：1920x1080 mp4、1 分钟；宽高权威值齐备且在门槛内。 */
function makeVideoAsset(overrides: Record<string, unknown> = {}) {
  return {
    type: "video",
    url: "https://tos.example.com/uploads/9/video/a.mp4",
    storage_key: "uploads/9/video/a.mp4",
    mime: "video/mp4",
    width: 1920,
    height: 1080,
    duration_ms: 60_000,
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
      findOwnedSource: vi.fn().mockResolvedValue(makeVideoAsset()),
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
    service: new VideoEnhancementsService(prisma as never, project as never, assets as never),
    create,
    costCreate,
    assets,
  };
}

describe("VideoEnhancementsService.create：契约 schema 复核", () => {
  it("rejects a missing source_asset_id", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, source_asset_id: undefined });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("source_asset_id");
  });

  it("rejects an empty target_node_id", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, target_node_id: "" });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("target_node_id");
  });

  it("rejects an unknown resolution with a readable reason", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, resolution: "8k" });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("目标分辨率");
  });

  it("rejects the supplier-default 720p — cut by product (ADR-0105), not a fallback", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, resolution: "720p" });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("目标分辨率");
  });

  it("rejects a non-numeric asset id", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, source_asset_id: "08x" });
    expect(result.code).not.toBe(200);
  });

  it("rejects an extra key", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, extra: 1 });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("不支持的参数");
  });

  it("accepts all three exposed resolutions", async () => {
    const { service } = makeService();
    for (const resolution of ["1080p", "2k", "4k"]) {
      const result = await service.create("9", "55", { ...VALID_BODY, resolution });
      expect(result.code).toBe(200);
    }
  });
});

describe("VideoEnhancementsService.create：归属与媒体类型复核", () => {
  it("rejects an unknown project", async () => {
    const { service } = makeService({
      project: { findOwnedById: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects a source asset not owned by the user", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects a non-video asset with a readable reason", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeVideoAsset({ type: "image" })) },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("视频");
  });
});

describe("VideoEnhancementsService.create：输入门槛复核（短边 [360,1080] / 长边 ≤1920）", () => {
  it("accepts at the exact upper boundary 1920x1080 and vertical 1080x1920 (short/long-side semantics)", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi
          .fn()
          .mockResolvedValueOnce(makeVideoAsset({ width: 1920, height: 1080 }))
          .mockResolvedValueOnce(makeVideoAsset({ width: 1080, height: 1920 })),
      },
    });
    expect((await service.create("9", "55", VALID_BODY)).code).toBe(200);
    // 竖屏长短边对调同样合法：短边 1080、长边 1920
    expect((await service.create("9", "55", VALID_BODY)).code).toBe(200);
  });

  it("accepts at the exact short-side lower boundary 360", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(makeVideoAsset({ width: 640, height: 360 })),
      },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
  });

  it("rejects when long side exceeds 1920 (landscape and vertical) with a readable reason", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi
          .fn()
          .mockResolvedValueOnce(makeVideoAsset({ width: 2560, height: 1440 }))
          .mockResolvedValueOnce(makeVideoAsset({ width: 1440, height: 2560 })),
      },
    });
    // 2560x1440 是 2K 输出的合法上游，但作为 HD 高清源输入超官方上限（短边>1080 且长边>1920）
    expect((await service.create("9", "55", VALID_BODY)).msg).toContain("无法发起 HD 高清");
    expect((await service.create("9", "55", VALID_BODY)).msg).toContain("无法发起 HD 高清");
  });

  it("rejects when short side exceeds 1080 even if long side is within limit", async () => {
    const { service } = makeService({
      assets: {
        // 宽 1920 高 1440：长边 1920 合法但短边 1441 > 1080 超上限
        findOwnedSource: vi.fn().mockResolvedValue(makeVideoAsset({ width: 1920, height: 1440 })),
      },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("无法发起 HD 高清");
  });

  it("rejects when short side is below 360 with a readable reason", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(makeVideoAsset({ width: 640, height: 359 })),
      },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("无法发起 HD 高清");
  });

  it("lets a video without recorded dimensions pass to the supplier gate", async () => {
    // assets.width/height 由前端上报、存量大量为 null：缺权威值不臆造、不拦，
    // 交供应商按官方门槛拒（与去字幕 / 擦除 / 高清同口径）；SDR 限制同由任务失败口径兜底。
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(
          makeVideoAsset({ width: null, height: null, duration_ms: null }),
        ),
      },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
  });

  it("lets a video with only one recorded dimension pass (gate needs both)", async () => {
    // 宽高只有一侧有权威值时无法判定短边/长边，同 null 放行。
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(makeVideoAsset({ width: 4096, height: null })),
      },
    });
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
  });
});

describe("VideoEnhancementsService.create：落任务与免费口径", () => {
  it("creates a video_enhance job with the frozen three-key input", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({ job_id: "400", status: "queued" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "video_enhance",
        source: "video_enhance",
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
