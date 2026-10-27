import { describe, expect, it, vi } from "vitest";

const { enqueueAudioSpeedJob } = vi.hoisted(() => ({ enqueueAudioSpeedJob: vi.fn() }));
vi.mock("@lib/shared/generation/generation-queue.js", () => ({ enqueueAudioSpeedJob }));

import { AudioSpeedsService } from "./audio-speeds.service.js";

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
        duration_ms: 61_000,
      }),
    };
  const create = overrides.createJob ?? vi.fn().mockResolvedValue({ id: 400n });
  const costCreate = vi.fn();
  const prisma = {
    client: {
      generation_jobs: { create },
      billing_cost_reservations: { create: costCreate },
    },
  };
  const jobBilling = vi.fn().mockResolvedValue(undefined);
  return {
    service: new AudioSpeedsService(
      prisma as never,
      project as never,
      assets as never,
      { probe: null } as never,
      { jobBilling, release: vi.fn() } as never,
    ),
    create,
    costCreate,
    jobBilling,
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
    const { service, create, jobBilling } = makeService();
    const result = await service.create("9", "55", {
      source_asset_id: "88",
      speed: 2,
    });
    expect(result.code).toBe(200);
    expect(jobBilling).toHaveBeenCalledWith("audio_speed", "9", expect.objectContaining({ duration: 31 }));
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
          speed: 2,
          duration: 31,
        },
        next_action_at: expect.any(Date),
      }),
    });
  });

  it("omits the speed key when not sent (贴原速省略原样落库)", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).toBe(200);
    expect(create.mock.calls[0][0].data.input).toEqual({
      source_asset_id: "88",
      duration: 61,
    });
  });

  it("accepts the range endpoints 0.1 / 4.0", async () => {
    const { service, create } = makeService();
    for (const speed of [0.1, 4.0]) {
      const result = await service.create("9", "55", { source_asset_id: "88", speed });
      expect(result.code, `speed=${speed}`).toBe(200);
    }
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].data.input).toEqual({ source_asset_id: "88", speed: 0.1, duration: 610 });
    expect(create.mock.calls[1][0].data.input).toEqual({ source_asset_id: "88", speed: 4, duration: 16 });
  });

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
