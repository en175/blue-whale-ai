import { describe, expect, it, vi } from "vitest";

import { assetDurationSeconds, createAssetRepo } from "./asset-repo";

describe("assetDurationSeconds", () => {
  it("从 duration_ms 换算秒；缺省（无毫秒数据）为 null", () => {
    expect(assetDurationSeconds(65_900)).toBe(65.9);
    expect(assetDurationSeconds(null)).toBeNull();
    expect(assetDurationSeconds(undefined)).toBeNull();
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

describe("createAssetRepo.findOwnedById", () => {
  it("命中返回完整 AssetView，含 model 溯源展示名（字段与列表一致）", async () => {
    const row = {
      id: 42n,
      type: "image",
      url: "https://tos.test/a.png",
      width: 800,
      height: 600,
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
        findFirst: vi.fn().mockResolvedValue(row),
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

    const asset = await repo.findOwnedById("42", "9");

    expect(asset).toMatchObject({
      id: "42",
      type: "image",
      url: "https://tos.test/a.png",
      width: 800,
      height: 600,
      source: "generated",
      created_at: "2026-08-01T00:00:00.000Z",
      size: 5242880,
      generation_job_id: "7",
      project_id: "55",
      mime: "image/png",
      model: "Seedance 2.0 标准版",
    });
  });

  it("归属校验：查询条件含 id + user_id + is_delete，不命中返回 null", async () => {
    const assets = {
      findFirst: vi.fn().mockResolvedValue(null),
    };
    const prisma = {
      assets,
      generation_jobs: { findMany: vi.fn().mockResolvedValue([]) },
      generation_model_capability: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const repo = createAssetRepo(prisma as never);

    const asset = await repo.findOwnedById("999", "9");

    expect(asset).toBeNull();
    expect(assets.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BigInt(999), user_id: BigInt(9), is_delete: false },
      }),
    );
  });

  it("上传资产无生成任务 → model 为 null", async () => {
    const row = {
      id: 1n,
      type: "image",
      url: "https://tos.test/upload.png",
      width: null,
      height: null,
      duration_ms: null,
      source: "uploaded",
      gmt_create: new Date("2026-08-01T00:00:00.000Z"),
      size: null,
      generation_job_id: null,
      project_id: 0n,
      mime: "image/png",
    };
    const prisma = {
      assets: { findFirst: vi.fn().mockResolvedValue(row) },
      generation_jobs: { findMany: vi.fn().mockResolvedValue([]) },
      generation_model_capability: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const repo = createAssetRepo(prisma as never);

    const asset = await repo.findOwnedById("1", "9");

    expect(asset).toMatchObject({ id: "1", source: "uploaded", model: null });
  });

  it("生成任务有 model_id 但能力表无展示名 → model 回退 model_id", async () => {
    const row = {
      id: 3n,
      type: "image",
      url: "https://tos.test/gen2.png",
      width: null,
      height: null,
      duration_ms: null,
      source: "generated",
      gmt_create: new Date("2026-08-03T00:00:00.000Z"),
      size: null,
      generation_job_id: 9n,
      project_id: 0n,
      mime: "image/png",
    };
    const prisma = {
      assets: { findFirst: vi.fn().mockResolvedValue(row) },
      generation_jobs: {
        findMany: vi.fn().mockResolvedValue([
          { id: 9n, input: { prompt: "y", model_id: "unknown-model" } },
        ]),
      },
      generation_model_capability: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const repo = createAssetRepo(prisma as never);

    const asset = await repo.findOwnedById("3", "9");

    expect(asset).toMatchObject({ id: "3", model: "unknown-model" });
  });
});

describe("createAssetRepo 方案C（project_asset 关联）", () => {
  it("softDeleteOwned 软删资产 + 同步删 project_asset 关联", async () => {
    const assetsUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const paUpdate = vi.fn().mockResolvedValue({ count: 2 });
    const tx = {
      assets: { updateMany: assetsUpdate },
      project_asset: { updateMany: paUpdate },
    };
    const prisma = { $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)) };
    const repo = createAssetRepo(prisma as never);

    const ok = await repo.softDeleteOwned("3652", "9");
    expect(ok).toBe(true);
    expect(paUpdate).toHaveBeenCalledWith({
      where: { asset_id: 3652n, user_id: 9n, is_delete: 0 },
      data: expect.objectContaining({ is_delete: 1 }),
    });
  });

  it("linkAssetToProject 幂等 upsert 关联；资产不存在返回 false", async () => {
    const assetsFind = vi.fn().mockResolvedValue({ id: 3652n });
    const paUpsert = vi.fn().mockResolvedValue({});
    const prisma = {
      assets: { findFirst: assetsFind },
      project_asset: { upsert: paUpsert },
    };
    const repo = createAssetRepo(prisma as never);

    const ok = await repo.linkAssetToProject({ userId: "9", assetId: "3652", projectId: "91" });
    expect(ok).toBe(true);
    expect(paUpsert).toHaveBeenCalledWith({
      where: { user_id_asset_id_project_id: { user_id: 9n, asset_id: 3652n, project_id: 91n } },
      create: { user_id: 9n, asset_id: 3652n, project_id: 91n, is_delete: 0 },
      update: expect.objectContaining({ is_delete: 0 }),
    });

    assetsFind.mockResolvedValue(null);
    await expect(repo.linkAssetToProject({ userId: "9", assetId: "999", projectId: "91" })).resolves.toBe(false);
  });

  it("createUploadedAsset 落库时 project_id!=0 自动建关联", async () => {
    const tx = {
      assets: { create: vi.fn().mockResolvedValue({ id: 501n, storage_key: "k", url: "u", type: "image", mime: "image/png", size: 1n, width: null, height: null, duration_ms: null }) },
      project_asset: { upsert: vi.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)) };
    const repo = createAssetRepo(prisma as never);

    await repo.createUploadedAsset({ userId: "9", projectId: "91", type: "image", mime: "image/png", size: 1, storageKey: "k", url: "u" });
    expect(tx.project_asset.upsert).toHaveBeenCalled();
  });
});

describe("createAssetRepo.countReferencingProjects（IKCZAT）", () => {
  it("直接归属 ∪ project_asset 并集去重：重叠项目只计一次", async () => {
    const prisma = {
      assets: {
        groupBy: vi.fn().mockResolvedValue([
          { project_id: 55n },
          { project_id: 66n },
        ]),
      },
      project_asset: {
        groupBy: vi.fn().mockResolvedValue([
          { project_id: 66n },
          { project_id: 77n },
        ]),
      },
      project: {
        findMany: vi.fn().mockResolvedValue([{ id: 55n }, { id: 66n }, { id: 77n }]),
      },
    };
    const repo = createAssetRepo(prisma as never);

    const count = await repo.countReferencingProjects("42", "9");

    expect(count).toBe(3); // {55, 66, 77}
    expect(prisma.assets.groupBy).toHaveBeenCalledWith({
      by: ["project_id"],
      where: { id: 42n, user_id: 9n, is_delete: false, project_id: { not: 0n } },
    });
    expect(prisma.project_asset.groupBy).toHaveBeenCalledWith({
      by: ["project_id"],
      where: { asset_id: 42n, user_id: 9n, is_delete: 0 },
    });
  });

  it("已删除项目（is_delete=1）不计为引用：并集后与存活项目求交", async () => {
    const prisma = {
      assets: {
        groupBy: vi.fn().mockResolvedValue([
          { project_id: 55n },
          { project_id: 66n },
        ]),
      },
      project_asset: {
        groupBy: vi.fn().mockResolvedValue([{ project_id: 77n }]),
      },
      project: {
        findMany: vi.fn().mockResolvedValue([{ id: 55n }]), // 66/77 已删
      },
    };
    const repo = createAssetRepo(prisma as never);

    const count = await repo.countReferencingProjects("42", "9");

    expect(count).toBe(1); // 仅 55 存活
    expect(prisma.project.findMany).toHaveBeenCalledWith({
      where: { id: { in: [55n, 66n, 77n] }, is_delete: 0 },
      select: { id: true },
    });
  });

  it("两来源全空 → 返回 0（不触发 project 查询）", async () => {
    const prisma = {
      assets: { groupBy: vi.fn().mockResolvedValue([]) },
      project_asset: { groupBy: vi.fn().mockResolvedValue([]) },
    };
    const repo = createAssetRepo(prisma as never);

    await expect(repo.countReferencingProjects("42", "9")).resolves.toBe(0);
    expect(prisma.project).toBeUndefined();
  });

  it("project_id=0 不计数（SQL 排除 + Set 兜底双保险）", async () => {
    const prisma = {
      assets: {
        groupBy: vi.fn().mockResolvedValue([
          { project_id: 0n },
          { project_id: 55n },
        ]),
      },
      project_asset: { groupBy: vi.fn().mockResolvedValue([]) },
      project: {
        findMany: vi.fn().mockResolvedValue([{ id: 55n }]),
      },
    };
    const repo = createAssetRepo(prisma as never);

    await expect(repo.countReferencingProjects("42", "9")).resolves.toBe(1);
  });
});

describe("createAssetRepo.findAccessible", () => {
  /**
   * 归属按人算，不按项目算。
   *
   * 这条守的是一次真实故障：md5 去重（IKCNLS）跨项目复用素材时只写 `project_asset` 关联行，
   * `assets.project_id` 仍是第一次上传的那个项目。当时这里的 where 带着 `project_id`，于是
   * 同一张图传进第二个项目后 agent 一律读不到——画布上看得见、resolve 返回 404，用户看到的
   * 错话是「服务端打开文件失败」，像文件坏了。
   *
   * 断言 where **不含** `project_id`，而不只是断言查得到：查得到可以靠 mock 蒙对，
   * 少一个过滤条件才是这条修复的实质。
   */
  it("只按素材号与用户查，不带项目号", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      storage_key: "uploads/49/image/a.jpg",
      type: "image",
      mime: "image/jpeg",
      size: 274_779n,
      duration_ms: null,
    });
    const repo = createAssetRepo({ assets: { findFirst } } as never);

    const asset = await repo.findAccessible("5942", "49");

    expect(asset).toEqual({
      storage_key: "uploads/49/image/a.jpg",
      type: "image",
      mime: "image/jpeg",
      size: 274_779n,
      duration_seconds: null,
    });
    const where = findFirst.mock.calls[0][0].where;
    expect(where).toEqual({
      id: 5942n,
      user_id: 49n,
      status: "normal",
      is_delete: false,
    });
    expect(where).not.toHaveProperty("project_id");
  });

  it("查不到返回 null", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repo = createAssetRepo({ assets: { findFirst } } as never);

    await expect(repo.findAccessible("5942", "49")).resolves.toBeNull();
  });
});
