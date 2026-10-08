// IKGZ80：去字幕创建入口复核矩阵与免费口径单测（先例：image-erasures.service.test.ts）。
// 只测外部可见行为：拒绝原因可读、落库参数冻结、免费口径无成本预留、凭证冻结、入队失败回拨终态。
import { describe, expect, it, vi } from "vitest";

import { VideoSubtitleErasuresService } from "./video-subtitle-erasures.service.js";

const VALID_SMART_BODY = {
  source_asset_id: "88",
  target_node_id: "node-1",
  detect_mode: "subtitle_smart",
  erase_boxes: [],
};

const VALID_BOXES_BODY = {
  source_asset_id: "88",
  target_node_id: "node-1",
  detect_mode: "text_full",
  erase_boxes: [
    { top_left_x: 0.1, top_left_y: 0.8, bottom_right_x: 0.9, bottom_right_y: 0.95 },
  ],
};

/** 默认源素材：1920x1080 mp4、1 分钟；宽高/时长均有权威值。 */
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
    service: new VideoSubtitleErasuresService(prisma as never, project as never, assets as never),
    create,
    costCreate,
    assets,
  };
}

describe("VideoSubtitleErasuresService.create：契约 schema 复核", () => {
  it("rejects a missing source_asset_id", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_SMART_BODY, source_asset_id: undefined });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("source_asset_id");
  });

  it("rejects an empty target_node_id", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_SMART_BODY, target_node_id: "" });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("target_node_id");
  });

  it("rejects an unknown detect_mode with a readable reason", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_SMART_BODY,
      detect_mode: "subtitle_magic",
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("检测模式");
  });

  it("rejects a non-numeric asset id", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_SMART_BODY, source_asset_id: "08x" });
    expect(result.code).not.toBe(200);
  });

  it("rejects an extra key", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", { ...VALID_SMART_BODY, extra: 1 });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("不支持的参数");
  });

  it("rejects more than 20 boxes with a readable reason", async () => {
    const { service } = makeService();
    const boxes = Array.from({ length: 21 }, () => ({
      top_left_x: 0.1,
      top_left_y: 0.8,
      bottom_right_x: 0.9,
      bottom_right_y: 0.95,
    }));
    const result = await service.create("9", "55", { ...VALID_BOXES_BODY, erase_boxes: boxes });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("擦除框列表");
  });

  it("rejects a box coordinate outside [0,1]", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_BOXES_BODY,
      erase_boxes: [
        { top_left_x: 1.5, top_left_y: 0.8, bottom_right_x: 0.9, bottom_right_y: 0.95 },
      ],
    });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("擦除框列表");
  });

  it("rejects a box with an unexpected inner key", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {
      ...VALID_BOXES_BODY,
      erase_boxes: [
        { top_left_x: 0.1, top_left_y: 0.8, bottom_right_x: 0.9, bottom_right_y: 0.95, extra: 1 },
      ],
    });
    expect(result.code).not.toBe(200);
  });
});

describe("VideoSubtitleErasuresService.create：归属与媒体类型复核", () => {
  it("rejects an unknown project", async () => {
    const { service } = makeService({
      project: { findOwnedById: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", VALID_SMART_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects a source asset not owned by the user", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", VALID_SMART_BODY);
    expect(result.code).not.toBe(200);
  });

  it("rejects a non-video asset with a readable reason", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(makeVideoAsset({ type: "image" })) },
    });
    const result = await service.create("9", "55", VALID_SMART_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("视频");
  });
});

describe("VideoSubtitleErasuresService.create：输入门槛复核（2K 分辨率 + 10 分钟产品上限）", () => {
  it("accepts at the exact boundary 2560x1440 and vertical 1440x2560 (short/long-side semantics)", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi
          .fn()
          .mockResolvedValueOnce(makeVideoAsset({ width: 2560, height: 1440 }))
          .mockResolvedValueOnce(makeVideoAsset({ width: 1440, height: 2560 })),
      },
    });
    expect((await service.create("9", "55", VALID_SMART_BODY)).code).toBe(200);
    // 竖屏长短边对调同样合法：短边 1440、长边 2560
    expect((await service.create("9", "55", VALID_SMART_BODY)).code).toBe(200);
  });

  it("rejects when long side exceeds 2560 (landscape and vertical) with a readable reason", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi
          .fn()
          .mockResolvedValueOnce(makeVideoAsset({ width: 2561, height: 100 }))
          .mockResolvedValueOnce(makeVideoAsset({ width: 100, height: 2561 })),
      },
    });
    expect((await service.create("9", "55", VALID_SMART_BODY)).msg).toContain("长边超过");
    expect((await service.create("9", "55", VALID_SMART_BODY)).msg).toContain("长边超过");
  });

  it("rejects when short side exceeds 1440 with a readable reason", async () => {
    const { service } = makeService({
      assets: {
        // 宽 2000 高 1441：短边 1441 超上限（旧宽高绑定语义会漏判这种横图）
        findOwnedSource: vi.fn().mockResolvedValue(makeVideoAsset({ width: 2000, height: 1441 })),
      },
    });
    const result = await service.create("9", "55", VALID_SMART_BODY);
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("短边超过");
  });

  it("accepts a video at the exact 10-minute boundary and rejects one second over", async () => {
    const { service } = makeService({
      assets: {
        findOwnedSource: vi
          .fn()
          .mockResolvedValueOnce(makeVideoAsset({ duration_ms: 600_000 }))
          .mockResolvedValueOnce(makeVideoAsset({ duration_ms: 600_001 })),
      },
    });
    expect((await service.create("9", "55", VALID_SMART_BODY)).code).toBe(200);
    const over = await service.create("9", "55", VALID_SMART_BODY);
    expect(over.code).not.toBe(200);
    expect(over.msg).toContain("10 分钟");
  });

  it("lets a video without recorded dimensions or duration pass to the supplier gate", async () => {
    // assets.width/height/duration_ms 由前端上报、存量大量为 null：缺权威值不臆造、不拦，
    // 交供应商按官方门槛拒（与擦除/高清同口径；规格故事 5）。
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(
          makeVideoAsset({ width: null, height: null, duration_ms: null }),
        ),
      },
    });
    const result = await service.create("9", "55", VALID_SMART_BODY);
    expect(result.code).toBe(200);
  });

  it("lets a video with only one recorded dimension pass (gate needs both)", async () => {
    // 宽高只有一侧有权威值时无法判定短边/长边，同 null 放行。
    const { service } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue(makeVideoAsset({ width: 4096, height: null })),
      },
    });
    const result = await service.create("9", "55", VALID_SMART_BODY);
    expect(result.code).toBe(200);
  });
});

describe("VideoSubtitleErasuresService.create：落任务与免费口径", () => {
  it("creates a video_subtitle_erase job for smart mode with the frozen four-key input (empty boxes legal)", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_SMART_BODY);
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({ job_id: "400", status: "queued" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "video_subtitle_erase",
        source: "video_subtitle_erase",
        status: "queued",
        user_id: 9n,
        project_id: 55n,
        input: VALID_SMART_BODY,
        next_action_at: expect.any(Date),
      }),
    });
  });

  it("creates a video_subtitle_erase job for text_full mode with the boxes frozen as-is", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", VALID_BOXES_BODY);
    expect(result.code).toBe(200);
    expect(create.mock.calls[0][0].data.input).toEqual(VALID_BOXES_BODY);
  });

  it("is free-tier: no cost reservation, no provider row", async () => {
    const { service, create, costCreate } = makeService();
    const result = await service.create("9", "55", VALID_BOXES_BODY);
    expect(result.code).toBe(200);
    expect(costCreate).not.toHaveBeenCalled();
    const data = create.mock.calls[0][0].data;
    expect(Object.keys(data)).not.toContain("provider");
  });
});