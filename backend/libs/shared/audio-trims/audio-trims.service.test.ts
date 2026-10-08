import { describe, expect, it, vi } from "vitest";

import { AudioTrimsService } from "./audio-trims.service.js";

// IKHB6N：一对一仿 media-extractions.service.test 先例。资产归属读法同 findOwnedSource；
// 免费口径哨兵（cost_reservations.create）与凭证冻结断言同款；截取特有面（贴边省略键不落、
// 时间精度/顺序服务端复核、缺省格式按源文件名后缀推导）覆盖契约 audio-trim.ts 口径。
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
        id: 88n,
        type: "audio",
        storage_key: "audio/source.mp3",
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
    service: new AudioTrimsService(prisma as never, project as never, assets as never),
    create,
    costCreate,
  };
}

describe("AudioTrimsService.create", () => {
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
    // 归属口径同 media_extract——findOwnedSource 按 user_id 过滤，非本人素材一律 404。
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).not.toBe(200);
    expect(result.code).toBe(100301);
  });

  it("rejects a non-audio asset", async () => {
    const { service } = makeService({
      assets: { findOwnedSource: vi.fn().mockResolvedValue({ id: 88n, type: "video" }) },
    });
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).not.toBe(200);
    expect(result.msg).toContain("音频");
  });

  it("creates an audio_trim job and returns the job id", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", {
      source_asset_id: "88",
      start_time: 1.5,
      end_time: 10,
      output_format: "mp3",
    });
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({ job_id: "400", status: "queued" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "audio_trim",
        source: "dock",
        status: "queued",
        user_id: 9n,
        project_id: 55n,
        input: {
          source_asset_id: "88",
          start_time: 1.5,
          end_time: 10,
          output_format: "mp3",
        },
        next_action_at: expect.any(Date),
      }),
    });
  });

  // 贴边省略口径（ADR-0111 / buildAudioTrimTimeParams）：左缘贴 0 / 右缘贴源全长时前端省略
  // start_time / end_time，创建入口原样落库——undefined 键不写（toEqual 精确匹配钉死）。
  it("omits start_time / end_time keys when not sent (贴边省略原样落库)", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).toBe(200);
    expect(create.mock.calls[0][0].data.input).toEqual({
      source_asset_id: "88",
      output_format: "mp3",
    });
  });

  it("keeps one-sided omission: only start_time sent", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", {
      source_asset_id: "88",
      start_time: 2.25,
    });
    expect(result.code).toBe(200);
    expect(create.mock.calls[0][0].data.input).toEqual({
      source_asset_id: "88",
      start_time: 2.25,
      output_format: "mp3",
    });
  });

  // 缺省推导（ADR-0111 默认跟随源音频格式）：storage_key 后缀在枚举内跟随源格式，
  // 无后缀 / 枚举外后缀（如 aac）/ storage_key 缺失一律回退 m4a。
  it("defaults output_format from the source file extension", async () => {
    const { service, create } = makeService({
      assets: {
        findOwnedSource: vi
          .fn()
          .mockResolvedValue({ id: 88n, type: "audio", storage_key: "audio/voice.flac" }),
      },
    });
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).toBe(200);
    expect(create.mock.calls[0][0].data.input).toEqual({
      source_asset_id: "88",
      output_format: "flac",
    });
  });

  it.each([
    ["audio/voice.aac", "m4a"],
    ["audio/no-extension", "m4a"],
    [null, "m4a"],
  ])("falls back to m4a for storage_key=%s", async (storageKey, expected) => {
    const { service, create } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue({ id: 88n, type: "audio", storage_key: storageKey }),
      },
    });
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).toBe(200);
    expect(create.mock.calls[0][0].data.input.output_format).toBe(expected);
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
      expect(result.code).toBe(100000);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it.each(["mp3", "m4a", "ogg", "flac", "wav"])(
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

  // 服务端复核契约枚举（audioTrimInputSchema）：非负、最多两位小数、start < end
  // （官方 PDF start_time / end_time 节硬性条款）。
  it.each([
    ["负数", { start_time: -1 }],
    ["超两位小数", { start_time: 1.234 }],
    ["字符串类型", { start_time: "1.5" }],
    ["start_time > end_time", { start_time: 10, end_time: 5 }],
    ["start_time = end_time", { start_time: 5, end_time: 5 }],
    ["end_time 超两位小数", { end_time: 3.456 }],
  ])("rejects invalid time params（%s）", async (_label, timeParams) => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", { source_asset_id: "88", ...timeParams });
    expect(result.code).not.toBe(200);
    expect(result.code).toBe(100000);
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts edge-legal two-decimal times", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", {
      source_asset_id: "88",
      start_time: 0.01,
      end_time: 0.02,
    });
    expect(result.code).toBe(200);
    expect(create.mock.calls[0][0].data.input).toEqual({
      source_asset_id: "88",
      start_time: 0.01,
      end_time: 0.02,
      output_format: "mp3",
    });
  });

  it("is free-tier: no cost reservation, no provider row", async () => {
    // 免费口径哨兵（网关零价模型族，同 media_extract 先例）：本工具不写成本预留、不落 provider 行。
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
