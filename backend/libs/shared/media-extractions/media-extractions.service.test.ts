import { describe, expect, it, vi } from "vitest";

import { MediaExtractionsService } from "./media-extractions.service.js";

function makeService(overrides: {
  project?: unknown;
  assets?: unknown;
  createJob?: unknown;
} = {}) {
  const project = overrides.project ?? { findOwnedById: vi.fn().mockResolvedValue({ id: 55n }) };
  const assets = overrides.assets ?? { findAccessible: vi.fn().mockResolvedValue({ id: 88n, type: "video" }) };
  const create = overrides.createJob ?? vi.fn().mockResolvedValue({ id: 400n });
  const prisma = { client: { generation_jobs: { create } } };
  return { service: new MediaExtractionsService(prisma as never, project as never, assets as never), create };
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

  it("rejects an inaccessible asset", async () => {
    const { service } = makeService({
      assets: { findAccessible: vi.fn().mockResolvedValue(null) },
    });
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).not.toBe(200);
  });

  it("rejects a non-video asset", async () => {
    const { service } = makeService({
      assets: { findAccessible: vi.fn().mockResolvedValue({ id: 88n, type: "image" }) },
    });
    const result = await service.create("9", "55", { source_asset_id: "88" });
    expect(result.code).not.toBe(200);
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
});
