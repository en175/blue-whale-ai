import { describe, expect, it, vi } from "vitest";

import { VocalSplitsService } from "./vocal-splits.service.js";

// IKHA2I：人声背景分离建单服务复核矩阵（先例：media-extractions.service.test.ts；
// 凭证冻结断言对齐 video-subtitle-erasures.service.test.ts）。
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
    service: new VocalSplitsService(prisma as never, project as never, assets as never),
    create,
    costCreate,
  };
}

describe("VocalSplitsService.create：参数校验", () => {
  it("rejects a missing source_asset_id", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", {});
    expect(result.code).not.toBe(200);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric source_asset_id (contract schema)", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", { source_asset_id: "abc" });
    expect(result.code).not.toBe(200);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects an unknown project", async () => {
    const { service } = makeService({
      project: { findOwnedById: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).not.toBe(200);
  });

  it("rejects a source asset not owned by the user", async () => {
    // 归属口径对齐去字幕 / media-extractions——findOwnedSource 按 user_id 过滤，非本人素材一律 404。
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).not.toBe(200);
  });

  it("rejects an image asset (only video/audio sources)", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue({ id: 88n, type: "image" }) },
    });
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("视频或音频");
  });

  it.each(["Audio", "music1", "", null, 42, {}])(
    "rejects a scene outside the contract enum (%s)",
    async (scene) => {
      const { service, create } = makeService();
      const result = await service.create("9", "55", {
        source_asset_id: "88",
        scene,
      });
      expect(result.code).not.toBe(200);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it.each(["ogg", "MP3", "", null, 42, {}])(
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
});

describe("VocalSplitsService.create：缺省补默认与建单", () => {
  // 契约口径（@lib/contracts/vocal-split）：缺省 scene=audio、output_format=aac
  // （注意默认格式与 extract-audio 的 m4a 不同），三键恒在冻结。
  it("defaults scene to audio and output_format to aac when omitted", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).toBe(200);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        input: { source_asset_id: "88", scene: "audio", output_format: "aac" },
      }),
    });
  });

  it.each(["aac", "mp3", "wav", "m4a", "flac"])(
    "accepts every contract output_format enum value (%s)",
    async (outputFormat) => {
      const { service, create } = makeService();
      const result = await service.create("9", "55", {
        source_asset_id: "88",
        output_format: outputFormat,
      });
      expect(result.code).toBe(200);
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          input: { source_asset_id: "88", scene: "audio", output_format: outputFormat },
        }),
      });
    },
  );

  it.each([
    ["audio", 2],
    ["music", 2],
    ["drama", 3],
    ["narrate", 3],
  ] as const)(
    "freezes scene %s with expected_output_count %d (VOCAL_SPLIT_SCENE_TRACKS)",
    async (scene, trackCount) => {
      const { service, create } = makeService();
      const result = await service.create("9", "55", {
        source_asset_id: "88",
        scene,
      });
      expect(result.code).toBe(200);
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          expected_output_count: trackCount,
          input: { source_asset_id: "88", scene, output_format: "aac" },
        }),
      });
    },
  );

  it("creates a vocal_split job and returns the job id", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", {
      source_asset_id: "88",
      scene: "drama",
      output_format: "flac",
    });
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({ job_id: "400", status: "queued" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "vocal_split",
        // 契约 §VOCAL_SPLIT_SOURCE：专属来源值（不沿用 media_extract 的 "dock" 存量特例）。
        source: "vocal_split",
        status: "queued",
        progress: 0,
        user_id: 9n,
        project_id: 55n,
        expected_output_count: 3,
        input: { source_asset_id: "88", scene: "drama", output_format: "flac" },
        next_action_at: expect.any(Date),
      }),
    });
  });

  it("is free-tier: no cost reservation, no provider row", async () => {
    // 免费口径哨兵（「本期免费」，同去字幕 / media-extractions 先例）：不写成本预留、不落 provider 行。
    const { service, create, costCreate } = makeService();
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).toBe(200);
    expect(costCreate).not.toHaveBeenCalled();
    const data = create.mock.calls[0][0].data;
    expect(Object.keys(data)).not.toContain("provider");
  });
});

describe("VocalSplitsService.create：请求方凭证冻结（断链防护）", () => {
  // 断链背景：worker 经 input.provider_credential 取请求方 sk- 调网关，创建链路不冻结
  // 则任务必落 provider_credential_missing（先例：去字幕 / media-extractions）。
  it("freezes the requester sk- token into job input (provider_credential)", async () => {
    const { service, create } = makeService();
    const result = await service.create(
      "9",
      "55",
      { source_asset_id: "88", scene: "music" },
      { providerCredential: "sk-live-token" },
    );
    expect(result.code).toBe(200);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        input: {
          source_asset_id: "88",
          scene: "music",
          output_format: "aac",
          provider_credential: "sk-live-token",
        },
      }),
    });
  });

  it("omits provider_credential when the requester carries no sk- token", async () => {
    // 未携带凭证时 input 保持三业务键结构不变（占位身份字段恒定）。
    const { service, create } = makeService();
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).toBe(200);
    expect(create.mock.calls[0][0].data.input).toEqual({
      source_asset_id: "88",
      scene: "audio",
      output_format: "aac",
    });
  });
});
