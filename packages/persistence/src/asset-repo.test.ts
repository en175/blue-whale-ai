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
  it("返回 size/generation_job_id/project_id/mime/model 溯源字段（BigInt 转 number/string）", async () => {
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
    const prisma = {
      assets: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([row]),
      },
      generation_jobs: {
        findMany: vi.fn().mockResolvedValue([
          { id: 7n, input: { prompt: "海浪", model_id: "seedance-2.0" } },
        ]),
      },
      generation_model_capability: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { model_id: "seedance-2.0", model_label: "Seedance 2.0 标准版" },
          ]),
      },
    };
    const repo = createAssetRepo(prisma as never);

    const page = await repo.listByUser("9", { page: 1, size: 24 });

    expect(page.records[0]).toMatchObject({
      id: "42",
      type: "image",
      source: "generated",
      size: 5242880,
      generation_job_id: "7",
      project_id: "55",
      mime: "image/png",
      model: "Seedance 2.0 标准版",
    });
  });

  it("模型解析兜底：无生成任务 / 任务无 model_id / 无展示名 → model 为 null 或回退 model_id", async () => {
    const rows = [
      {
        id: 1n,
        type: "image",
        url: "https://tos.test/upload.png",
        width: null,
        height: null,
        duration: null,
        duration_ms: null,
        source: "uploaded",
        gmt_create: new Date("2026-08-01T00:00:00.000Z"),
        size: null,
        generation_job_id: null,
        project_id: 0n,
        mime: "image/png",
      },
      {
        id: 2n,
        type: "video",
        url: "https://tos.test/gen.mp4",
        width: null,
        height: null,
        duration: null,
        duration_ms: null,
        source: "generated",
        gmt_create: new Date("2026-08-02T00:00:00.000Z"),
        size: null,
        generation_job_id: 8n,
        project_id: 0n,
        mime: "video/mp4",
      },
      {
        id: 3n,
        type: "image",
        url: "https://tos.test/gen2.png",
        width: null,
        height: null,
        duration: null,
        duration_ms: null,
        source: "generated",
        gmt_create: new Date("2026-08-03T00:00:00.000Z"),
        size: null,
        generation_job_id: 9n,
        project_id: 0n,
        mime: "image/png",
      },
    ];
    const prisma = {
      assets: {
        count: vi.fn().mockResolvedValue(3),
        findMany: vi.fn().mockResolvedValue(rows),
      },
      generation_jobs: {
        findMany: vi.fn().mockResolvedValue([
          // 8n：input 无 model_id（顶层与 parameters 都没有）
          { id: 8n, input: { prompt: "x" } },
          // 9n：有 model_id，但 capability 表无对应展示名
          { id: 9n, input: { prompt: "y", model_id: "unknown-model" } },
        ]),
      },
      generation_model_capability: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const repo = createAssetRepo(prisma as never);

    const page = await repo.listByUser("9", { page: 1, size: 24 });

    expect(page.records[0].model).toBeNull(); // 上传资产无生成任务
    expect(page.records[1].model).toBeNull(); // 任务 input 无 model_id
    expect(page.records[2].model).toBe("unknown-model"); // 无展示名回退 model_id
  });

  it("分页稳定：orderBy 含 id 兜底，避免 gmt_create 秒级并列导致跨页重复", async () => {
    const assets = {
      count: vi.fn().mockResolvedValue(120),
      findMany: vi.fn().mockResolvedValue([]),
    };
    const prisma = {
      assets,
      generation_jobs: { findMany: vi.fn().mockResolvedValue([]) },
      generation_model_capability: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const repo = createAssetRepo(prisma as never);

    await repo.listByUser("9", { page: 2, size: 60 });

    expect(assets.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
      }),
    );
  });
});
