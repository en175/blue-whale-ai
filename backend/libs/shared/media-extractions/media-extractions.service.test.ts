import { describe, expect, it, vi } from "vitest";

import { MediaExtractionsService } from "./media-extractions.service.js";

// IKH28V：资产归属读法对齐去字幕（findOwnedSource）；免费口径哨兵（cost_reservations.create）
// 与凭证冻结断言对齐 video-subtitle-erasures.service.test.ts 先例。
function makeService(overrides: {
  project?: unknown;
  assets?: unknown;
  createJob?: unknown;
} = {}) {
  const project = overrides.project ?? { findOwnedById: vi.fn().mockResolvedValue({ id: 55n }) };
  const assets =
    overrides.assets ??
    {
      findOwnedSource: vi.fn().mockResolvedValue({ id: 88n, type: "video" }),
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
    service: new MediaExtractionsService(prisma as never, project as never, assets as never),
    create,
    costCreate,
  };
}

describe("MediaExtractionsService.create", () => {
  it("rejects a missing source_asset_id", async () => {
    const { service } = makeService();
    const result = await service.create("9", "55", {});
    expect(result.code).not.toBe(200);
  });

  it("rejects an unknown project", async () => {
    const { service } = makeService({
      project: { findOwnedById: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).not.toBe(200);
  });

  it("rejects a source asset not owned by the user", async () => {
    // IKH28V：归属口径对齐去字幕——findOwnedSource 按 user_id 过滤，非本人素材一律 404。
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).not.toBe(200);
  });

  it("rejects a non-video asset", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue({ id: 88n, type: "image" }) },
    });
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("视频");
  });

  it("creates a media_extract job and returns the job id", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", { source_asset_id: "88", output_format: "mp3" });
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({ job_id: "400", status: "queued" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "media_extract",
        status: "queued",
        user_id: 9n,
        project_id: 55n,
        input: { source_asset_id: "88", output_format: "mp3" },
        next_action_at: expect.any(Date),
      }),
    });
  });

  // IKH28T 契约口径（@lib/contracts/media-extract）：缺省补默认 m4a，非法值明确拒绝
  // （静默回退 mp3 的旧口径废除）。
  it("defaults output_format to m4a when omitted", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).toBe(200);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        input: { source_asset_id: "88", output_format: "m4a" },
      }),
    });
  });

  it.each(["aac", "MP3", "", null, 42])(
    "rejects an output_format outside the contract enum (%s)",
    async (outputFormat) => {
      const { service, create } = makeService();
      const result = await service.create("9", "55", {
        source_asset_id: "88",
        output_format: outputFormat,
      });
      expect(result.code).not.toBe(200);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it.each(["m4a", "mp3", "ogg", "flac", "wav"])(
    "accepts every contract enum value (%s)",
    async (outputFormat) => {
      const { service, create } = makeService();
      const result = await service.create("9", "55", {
        source_asset_id: "88",
        output_format: outputFormat,
      });
      expect(result.code).toBe(200);
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          input: { source_asset_id: "88", output_format: outputFormat },
        }),
      });
    },
  );

  it("is free-tier: no cost reservation, no provider row", async () => {
    // 免费口径哨兵（网关零价模型族，同去字幕先例）：本工具不写成本预留、不落 provider 行。
    const { service, create, costCreate } = makeService();
    const result = await service.create("9", "55", {
      source_asset_id: "88",
      output_format: "mp3",
    });
    expect(result.code).toBe(200);
    expect(costCreate).not.toHaveBeenCalled();
    const data = create.mock.calls[0][0].data;
    expect(Object.keys(data)).not.toContain("provider");
  });
});
