import { describe, expect, it, vi } from "vitest";

import { AudioSpeedsService } from "./audio-speeds.service.js";

// IKHW59：一对一仿 audio-trims.service.test 先例（IKHB6N）。资产归属读法同 findOwnedSource；
// 免费口径哨兵（cost_reservations.create）与凭证冻结断言同款；调速特有面（贴原速省略键不落、
// speed 域与两位小数精度服务端复核）覆盖契约 audio-speed.ts 口径。
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
    service: new AudioSpeedsService(prisma as never, project as never, assets as never),
    create,
    costCreate,
  };
}

describe("AudioSpeedsService.create", () => {
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
    // 归属口径同 audio_trim——findOwnedSource 按 user_id 过滤，非本人素材一律 404。
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

  it("creates an audio_speed job and returns the job id", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", {
      source_asset_id: "88",
      speed: 1.35,
    });
    expect(result.code).toBe(200);
    expect(result.data).toMatchObject({ job_id: "400", status: "queued" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "audio_speed",
        source: "dock",
        status: "queued",
        user_id: 9n,
        project_id: 55n,
        input: {
          source_asset_id: "88",
          speed: 1.35,
        },
        next_action_at: expect.any(Date),
      }),
    });
  });

  // 贴原速省略口径（契约 audio-speed.ts / buildAudioSpeedInput）：speed 缺省不补键，
  // undefined = 走官方默认 1——创建入口原样落库（键不写，toEqual 精确匹配钉死）。
  it("omits the speed key when not sent (贴原速省略原样落库)", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).toBe(200);
    expect(create.mock.calls[0][0].data.input).toEqual({
      source_asset_id: "88",
    });
  });

  it("accepts the range endpoints 0.1 / 4.0", async () => {
    const { service, create } = makeService();
    for (const speed of [0.1, 4.0]) {
      const result = await service.create("9", "55", { source_asset_id: "88", speed });
      expect(result.code, `speed=${speed}`).toBe(200);
    }
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].data.input).toEqual({ source_asset_id: "88", speed: 0.1 });
    expect(create.mock.calls[1][0].data.input).toEqual({ source_asset_id: "88", speed: 4 });
  });

  // 服务端复核契约枚举（audioSpeedInputSchema）：speed ∈ [0.1, 4.0]、最多两位小数、
  // 必须为 number 类型（契约层精度收口，超精度在创建入口即拒）。
  it.each([
    ["低于下界", 0.09],
    ["高于上界", 4.01],
    ["零", 0],
    ["负数", -1],
    ["NaN", Number.NaN],
    ["字符串类型", "1.5"],
    ["null", null],
    ["超两位小数", 1.355],
    ["浮点尾差 0.05×k 形态", 0.30000000000000004],
  ])("rejects an invalid speed（%s）", async (_label, speed) => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", { source_asset_id: "88", speed });
    expect(result.code).not.toBe(200);
    expect(result.code).toBe(100000);
    expect(create).not.toHaveBeenCalled();
  });

  it("is free-tier: no cost reservation, no provider row", async () => {
    // 免费口径哨兵（网关零价模型族，同 audio_trim 先例）：本工具不写成本预留、不落 provider 行。
    const { service, create, costCreate } = makeService();
    const result = await service.create("9", "55", {
      source_asset_id: "88",
      speed: 2,
    });
    expect(result.code).toBe(200);
    expect(costCreate).not.toHaveBeenCalled();
    const data = create.mock.calls[0][0].data;
    expect(Object.keys(data)).not.toContain("provider");
  });
});
