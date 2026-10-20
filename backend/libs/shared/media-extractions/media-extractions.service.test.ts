import { describe, expect, it, vi } from "vitest";

const { enqueueMediaExtractJob } = vi.hoisted(() => ({ enqueueMediaExtractJob: vi.fn() }));
vi.mock("@lib/shared/generation/generation-queue.js", () => ({ enqueueMediaExtractJob }));

import { MediaExtractionsService } from "./media-extractions.service.js";

function makeService(overrides: {
  project?: unknown;
  assets?: unknown;
  createJob?: unknown;
} = {}) {
  const project = overrides.project ?? { findOwnedById: vi.fn().mockResolvedValue({ id: 55n }) };
  const assets =
    overrides.assets ??
    {
      findOwnedSource: vi.fn().mockResolvedValue({ id: 88n, type: "video", duration_ms: 61_000 }),
    };
  const create = overrides.createJob ?? vi.fn().mockResolvedValue({ id: 400n });
  const costCreate = vi.fn();
  const prisma = {
    client: {
      generation_jobs: { create },
      cost_reservations: { create: costCreate },
    },
  };
  const jobBilling = vi.fn().mockResolvedValue(undefined);
  return {
    service: new MediaExtractionsService(
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
    const { service, create, jobBilling } = makeService();
    const result = await service.create("9", "55", { source_asset_id: "88", output_format: "mp3" });
    expect(result.code).toBe(200);
    expect(jobBilling).toHaveBeenCalledWith("media_extract", "9", expect.objectContaining({ duration: 61 }));
    expect(result.data).toMatchObject({ job_id: "400", status: "queued" });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "media_extract",
        status: "queued",
        user_id: 9n,
        project_id: 55n,
        input: { source_asset_id: "88", output_format: "mp3", duration: 61 },
        next_action_at: expect.any(Date),
      }),
    });
  });

  it("defaults output_format to m4a when omitted", async () => {
    const { service, create } = makeService();
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).toBe(200);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        input: { source_asset_id: "88", output_format: "m4a", duration: 61 },
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
          input: { source_asset_id: "88", output_format: outputFormat, duration: 61 },
        }),
      });
    },
  );

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
