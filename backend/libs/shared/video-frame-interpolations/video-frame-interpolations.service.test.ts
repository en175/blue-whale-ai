// IKHLK3：视频插帧创建入口复核矩阵与免费口径单测（先例：video-enhancements.service.test.ts）。
// 只测外部可见行为：拒绝原因可读、落库参数冻结（含 fps 缺省补默认）、免费口径无成本预留、
// 凭证冻结、无授权门槛（父单口径：不照搬 HD 分辨率门槛、不做源帧率 4 倍建议拦截）、
// 入队失败回拨（controller 测试覆盖 markFailed 调用，这里覆盖 create / markFailed 的落库口径）。
import { describe, expect, it, vi } from "vitest";

import { VideoFrameInterpolationsService } from "./video-frame-interpolations.service.js";

const VALID_BODY = {
  source_asset_id: "88",
  target_node_id: "node-1",
  fps: 60,
};

/** 默认源素材：1920x1080 mp4、1 分钟；宽高权威值齐备（插帧对宽高无门槛，此处仅作存在性对照）。 */
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
    service: new VideoFrameInterpolationsService(prisma as never, project as never, assets as never),
    create,
    costCreate,
    assets,
  };
}

describe("VideoFrameInterpolationsService.create：契约 schema 复核", () => {
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

  it("rejects an out-of-enum fps (45 is official-legal but not exposed by product)", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_BODY, fps: 45 });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("目标帧率");
  });

  it("rejects a string fps and a fractional fps", async () => {
    const { service } = makeService();
    expect((await service.create("9", "55", { ...VALID_BODY, fps: "60" })).code).not.toBe(200);
    expect((await service.create("9", "55", { ...VALID_BODY, fps: 60.5 })).code).not.toBe(200);
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

  it("accepts all three exposed fps tiers", async () => {
    const { service } = makeService();
    for (const fps of [30, 60, 120]) {
      const result = await service.create("9", "55", { ...VALID_BODY, fps });
      expect(result.code).toBe(200);
    }
  });

  it("defaults a missing fps to 60 and freezes it into the job input", async () => {
    // 父单决策口径：与 HD 高清 resolution 必填不同，fps 缺省补默认 60（前端面板恒有选中值，
    // 服务端仍兜底，保证落库 input 三键恒在）。
    const { service, create } = makeService();
    const result = await service.create("9", "55", {
      source_asset_id: "88",
      target_node_id: "node-1",
    });
    expect(result.code).toBe(200);
    expect(create.mock.calls[0][0].data.input).toEqual({
      source_asset_id: "88",
      target_node_id: "node-1",
      fps: 60,
    });
  });
});

describe("VideoFrameInterpolationsService.create：归属与媒体类型复核", () => {
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

describe("VideoFrameInterpolationsService.create：无输入门槛（与 HD 高清不同源）", () => {
  it("accepts an over-HD-limit video (2560x1440) — no resolution gate copied from HD", async () => {
    // 官方对该端点无分辨率限制，ADR-0113「插帧项不做任何额外前置」：HD 的短边/长边门槛不适用于本工具。
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(makeVideoAsset({ width: 2560, height: 1440 })),
      },
    });
    expect((await service.create("9", "55", VALID_BODY)).code).toBe(200);
  });

  it("accepts a tiny video (short side below the HD 360 floor)", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(makeVideoAsset({ width: 320, height: 240 })),
      },
    });
    expect((await service.create("9", "55", VALID_BODY)).code).toBe(200);
  });

  it("accepts a video without recorded dimensions", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(
          makeVideoAsset({ width: null, height: null, duration_ms: null }),
        ),
      },
    });
    expect((await service.create("9", "55", VALID_BODY)).code).toBe(200);
  });
});

describe("VideoFrameInterpolationsService.create：落任务与免费口径", () => {
  it("creates a video_frame_interpolation job with the frozen three-key input", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_BODY);
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({ job_id: "400", status: "queued" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "video_frame_interpolation",
        source: "video_frame_interpolation",
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

describe("VideoFrameInterpolationsService.create：请求方凭证冻结（断链防护）", () => {
  // 断链背景：worker（IKHLKJ 注册的处理器）只从 input.provider_credential 取请求方 sk-，
  // 创建链路不冻结则必落 provider_credential_missing（先例：去字幕 / 图片生成 / HD 高清）。
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
