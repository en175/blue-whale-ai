import { describe, expect, it, vi } from "vitest";

const { enqueueAudioTrimJob } = vi.hoisted(() => ({ enqueueAudioTrimJob: vi.fn() }));
vi.mock("@lib/shared/generation/generation-queue.js", () => ({ enqueueAudioTrimJob }));

import { AudioTrimsService } from "./audio-trims.service.js";

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
    service: new AudioTrimsService(
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
    const { service, create, jobBilling } = makeService();
    const result = await service.create("9", "55", {
      source_asset_id: "88",
      start_time: 1.5,
      end_time: 10,
      output_format: "mp3",
    });
    expect(result.code).toBe(200);
    expect(jobBilling).toHaveBeenCalledWith("audio_trim", "9", expect.objectContaining({ duration: 9 }));
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
          duration: 9,
        },
        next_action_at: expect.any(Date),
      }),
    });
  });

  it("omits start_time / end_time keys when not sent (贴边省略原样落库)", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).toBe(200);
    expect(create.mock.calls[0][0].data.input).toEqual({
      source_asset_id: "88",
      output_format: "mp3",
      duration: 61,
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
      duration: 59,
    });
  });

  it("defaults output_format from the source file extension", async () => {
    const { service, create } = makeService({
      assets: {
        findOwnedSource: vi
          .fn()
          .mockResolvedValue({ id: 88n, type: "audio", storage_key: "audio/voice.flac", duration_ms: 61_000 }),
      },
    });
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).toBe(200);
    expect(create.mock.calls[0][0].data.input).toEqual({
      source_asset_id: "88",
      output_format: "flac",
      duration: 61,
    });
  });

  it.each([
    ["audio/voice.aac", "m4a"],
    ["audio/no-extension", "m4a"],
    [null, "m4a"],
  ])("falls back to m4a for storage_key=%s", async (storageKey, expected) => {
    const { service, create } = makeService({
      assets: {
        findOwnedSource: vi.fn().mockResolvedValue({ id: 88n, type: "audio", storage_key: storageKey, duration_ms: 61_000 }),
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
          input: { source_asset_id: "88", output_format: outputFormat, duration: 61 },
        }),
      });
    },
  );

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
      duration: 1,
    });
  });

  it("is free-tier: no cost reservation, no provider row", async () => {
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
