import { describe, expect, it, vi } from "vitest";

import { assetDurationSeconds, createAssetRepo } from "./asset-repo";

describe("assetDurationSeconds", () => {
  it("prefers precise milliseconds and falls back to whole seconds", () => {
    expect(assetDurationSeconds(66, 65_900)).toBe(65.9);
    expect(assetDurationSeconds(66, null)).toBe(66);
    expect(assetDurationSeconds(null, null)).toBeNull();
  });
});

describe("createAssetRepo.listByUser", () => {
  it("返回 size/generation_job_id/project_id/mime 溯源字段（BigInt 转 number/string）", async () => {
    const row = {
      id: 42n,
      type: "image",
      url: "https://tos.test/a.png",
      width: 800,
      height: 600,
      duration: null,
      duration_ms: null,
      source: "generated",
      gmt_create: new Date("2026-08-01T00:00:00.000Z"),
      size: BigInt(5242880),
      generation_job_id: 7n,
      project_id: 55n,
      mime: "image/png",
    };
    const assets = {
      count: vi.fn().mockResolvedValue(1),
      findMany: vi.fn().mockResolvedValue([row]),
    };
    const repo = createAssetRepo({ assets } as never);

    const page = await repo.listByUser("9", { page: 1, size: 24 });

    expect(page.records[0]).toMatchObject({
      id: "42",
      type: "image",
      source: "generated",
      size: 5242880,
      generation_job_id: "7",
      project_id: "55",
      mime: "image/png",
    });
  });
});
