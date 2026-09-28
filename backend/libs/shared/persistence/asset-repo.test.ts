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
      name: "海浪素材.png",
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
      name: "海浪素材.png",
      source: "generated",
      size: 5242880,
      generation_job_id: "7",
      project_id: "55",
      mime: "image/png",
      model: "Seedance 2.0 标准版",
    });
  });

  it("未单独命名的混音产物返回生成任务名", async () => {
    const row = { id: 88n, type: "audio", name: null, url: "https://tos.test/mix.mp3", width: null,
      height: null, duration_ms: 1000, source: "generated", gmt_create: new Date(), size: 10n,
      generation_job_id: 70n, project_id: 55n, mime: "audio/mpeg" };
    const prisma = {
      assets: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([row]) },
      generation_jobs: { findMany: vi.fn().mockResolvedValue([{ id: 70n, type: "audio_mix", input: {} }]) },
    };
    const page = await createAssetRepo(prisma as never).listByUser("9", { page: 1, size: 24 });
    expect(page.records[0]?.name).toBe("音频混合 70");
  });

  it("IKGOTB：listByUser 排除擦除遮罩中间素材（NOT source=mask_erase，资产列表不可见）", async () => {
    const prisma = {
      assets: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const repo = createAssetRepo(prisma as never);
    await repo.listByUser("9", { page: 1, size: 24, type: "image" });
    const expectedWhere = {
      user_id: BigInt(9),
      is_delete: false,
      type: "image",
      NOT: { source: "mask_erase" },
    };
    expect(prisma.assets.count).toHaveBeenCalledWith({ where: expectedWhere });
    expect(prisma.assets.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere }),
    );
  });

  it("IKGOTB：findOwnedByMd5 排除遮罩中间素材（用户上传同内容图不得命中隐藏遮罩资产）", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repo = createAssetRepo({ assets: { findFirst } } as never);
    await repo.findOwnedByMd5("9", "d41d8cd98f00b204e9800998ecf8427e");
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        user_id: BigInt(9),
        md5: "d41d8cd98f00b204e9800998ecf8427e",
        status: "normal",
        is_delete: false,
        NOT: { source: "mask_erase" },
      },
      orderBy: { id: "desc" },
      select: expect.any(Object),
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

  it("IKFSSO：AI 生成素材返回原始提示词（与 model 同一批 input 解析）", async () => {
    const row = {
      id: 42n,
      type: "image",
      url: "https://tos.test/a.png",
      width: 800,
      height: 600,
      duration_ms: null,
      source: "generated",
      gmt_create: new Date("2026-08-01T00:00:00.000Z"),
      size: null,
      generation_job_id: 7n,
      project_id: 55n,
      mime: "image/png",
    };
    const generationJobs = {
      findMany: vi.fn().mockResolvedValue([
        { id: 7n, input: { prompt: "一只白鲸穿过蓝色鲸落", model_id: "seedance-2.0" } },
      ]),
    };
    const prisma = {
      assets: { findFirst: vi.fn().mockResolvedValue(row) },
      generation_jobs: generationJobs,
      generation_model_capability: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ model_id: "seedance-2.0", model_label: "Seedance 2.0" }]),
      },
    };
    const repo = createAssetRepo(prisma as never);

    const asset = await repo.findOwnedById("42", "9");

    expect(asset).toMatchObject({ id: "42", prompt: "一只白鲸穿过蓝色鲸落" });
    // 提示词与模型展示名共用一次 generation_jobs 查询，不额外回表。
    expect(generationJobs.findMany).toHaveBeenCalledTimes(1);
  });

  it("IKFSSO：提取音频（media_extract）input 只有 source_asset_id → prompt 为 null", async () => {
    const row = {
      id: 6019n,
      type: "audio",
      url: "https://tos.test/a.mp3",
      width: null,
      height: null,
      duration_ms: 12000,
      source: "generated",
      gmt_create: new Date("2026-08-01T00:00:00.000Z"),
      size: null,
      generation_job_id: 1803n,
      project_id: 0n,
      mime: "audio/mpeg",
    };
    const prisma = {
      assets: { findFirst: vi.fn().mockResolvedValue(row) },
      generation_jobs: {
        findMany: vi.fn().mockResolvedValue([{ id: 1803n, input: { source_asset_id: "6018" } }]),
      },
      generation_model_capability: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const repo = createAssetRepo(prisma as never);

    const asset = await repo.findOwnedById("6019", "9");

    // 提取音频同样是 source=generated，但没有提示词——不能靠 source 判定。
    expect(asset).toMatchObject({ id: "6019", source: "generated", prompt: null });
  });

  it("IKFSSO：上传素材无 generation_job_id → prompt 为 null", async () => {
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

    expect(asset).toMatchObject({ id: "1", source: "uploaded", prompt: null });
  });

  it("IKFSSO：空串 prompt（IKDLQF 允许）按「无」处理，不返回空白提示词", async () => {
    const row = {
      id: 5n,
      type: "image",
      url: "https://tos.test/blank.png",
      width: null,
      height: null,
      duration_ms: null,
      source: "generated",
      gmt_create: new Date("2026-08-01T00:00:00.000Z"),
      size: null,
      generation_job_id: 11n,
      project_id: 0n,
      mime: "image/png",
    };
    const prisma = {
      assets: { findFirst: vi.fn().mockResolvedValue(row) },
      generation_jobs: {
        findMany: vi.fn().mockResolvedValue([{ id: 11n, input: { prompt: "   " } }]),
      },
      generation_model_capability: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const repo = createAssetRepo(prisma as never);

    const asset = await repo.findOwnedById("5", "9");

    expect(asset?.prompt).toBeNull();
  });

  it("场景卡视频重生成写 prompt_text（不是 prompt）→ 仍取得到提示词", async () => {
    const row = {
      id: 7n,
      type: "video",
      url: "https://tos.test/scene.mp4",
      width: null,
      height: null,
      duration_ms: null,
      source: "generated",
      gmt_create: new Date("2026-08-01T00:00:00.000Z"),
      size: null,
      generation_job_id: 12n,
      project_id: 0n,
      mime: "video/mp4",
    };
    const prisma = {
      assets: { findFirst: vi.fn().mockResolvedValue(row) },
      generation_jobs: {
        // scene-card-generation-repo 建 job 时的真实形状：只有 prompt_text。
        findMany: vi.fn().mockResolvedValue([
          {
            id: 12n,
            input: {
              scene_card_id: "88",
              plan_message_id: "9",
              prompt_text: "分镜：海面上升起一轮月亮",
              parameters: { model_id: "doubao-seedance-2-0" },
            },
          },
        ]),
      },
      generation_model_capability: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const repo = createAssetRepo(prisma as never);

    const asset = await repo.findOwnedById("7", "9");

    expect(asset).toMatchObject({
      prompt: "分镜：海面上升起一轮月亮",
      model: "doubao-seedance-2-0",
    });
  });

  it("generation_job_id 悬空（任务行已不在）→ prompt 与 model 一起为 null，不报错", async () => {
    const row = {
      id: 6050n,
      type: "video",
      url: "https://tos.test/orphan.mp4",
      width: null,
      height: null,
      duration_ms: 4000,
      source: "generated",
      gmt_create: new Date("2026-08-01T00:00:00.000Z"),
      size: null,
      generation_job_id: 1847n,
      project_id: 443n,
      mime: "video/mp4",
    };
    const prisma = {
      assets: { findFirst: vi.fn().mockResolvedValue(row) },
      // 查得到 0 行：本地库里这个 job 确实不存在（真实数据里踩到过）。
      generation_jobs: { findMany: vi.fn().mockResolvedValue([]) },
      generation_model_capability: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const repo = createAssetRepo(prisma as never);

    const asset = await repo.findOwnedById("6050", "9");

    expect(asset).toMatchObject({ id: "6050", model: null, prompt: null });
  });

  it("input 不是对象（null / 字符串 / 数组）→ 不抛错，prompt 为 null", async () => {
    const row = {
      id: 8n,
      type: "image",
      url: "https://tos.test/weird.png",
      width: null,
      height: null,
      duration_ms: null,
      source: "generated",
      gmt_create: new Date("2026-08-01T00:00:00.000Z"),
      size: null,
      generation_job_id: 13n,
      project_id: 0n,
      mime: "image/png",
    };
    const inputs: unknown[] = [null, "raw-string", ["array"]];
    const prisma = {
      assets: { findFirst: vi.fn().mockResolvedValue(row) },
      generation_jobs: { findMany: vi.fn().mockResolvedValue([{ id: 13n, input: inputs[0] }]) },
      generation_model_capability: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const repo = createAssetRepo(prisma as never);

    for (const input of inputs) {
      prisma.generation_jobs.findMany.mockResolvedValue([{ id: 13n, input }]);
      const asset = await repo.findOwnedById("8", "9");
      expect(asset?.prompt).toBeNull();
    }
  });
});

describe("IKFSSO：提示词只进详情，不进列表", () => {
  it("listByUser 的记录不含 prompt 字段（资产库全量拉取不背提示词体积）", async () => {
    const row = {
      id: 42n,
      type: "image",
      url: "https://tos.test/a.png",
      width: 800,
      height: 600,
      duration_ms: null,
      source: "generated",
      gmt_create: new Date("2026-08-01T00:00:00.000Z"),
      size: null,
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
        findMany: vi.fn().mockResolvedValue([{ id: 7n, input: { prompt: "海浪" } }]),
      },
      generation_model_capability: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const repo = createAssetRepo(prisma as never);

    const page = await repo.listByUser("9", { page: 1, size: 24 });

    expect(page.records[0]).not.toHaveProperty("prompt");
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

// IKFYHJ（ADR-0087）：列表/详情带上素材校验状态。
// 性能是本组的重点——控制器对 ?size= 没有上限，前端 fetchAllAssets 又是并发翻页全量拉取。
describe("createAssetRepo 素材校验状态（IKFYHJ）", () => {
  const baseRow = (over: Record<string, unknown>) => ({
    id: 1n,
    type: "image",
    url: "https://tos.test/a.png",
    width: null,
    height: null,
    duration_ms: null,
    source: "uploaded",
    gmt_create: null,
    size: null,
    generation_job_id: null,
    project_id: 55n,
    mime: null,
    material_id: null,
    material_group_id: null,
    ...over,
  });
  /** 无生成任务的 prisma 骨架（本组不关心 model 溯源）。 */
  const basePrisma = (rows: unknown[], findMaterial: ReturnType<typeof vi.fn>) => ({
    assets: {
      count: vi.fn().mockResolvedValue(rows.length),
      findMany: vi.fn().mockResolvedValue(rows),
    },
    generation_jobs: { findMany: vi.fn().mockResolvedValue([]) },
    generation_model_capability: { findMany: vi.fn().mockResolvedValue([]) },
    material_assets: { findMany: findMaterial },
  });

  it("带上状态与确认时间；未关联/无状态行 → null", async () => {
    const findMaterial = vi.fn().mockResolvedValue([
      {
        material_id: "asset-a",
        status: "Active",
        status_checked_at: new Date("2026-09-15T10:00:00.000Z"),
      },
      { material_id: "asset-b", status: "Failed", status_checked_at: null },
    ]);
    const prisma = basePrisma(
      [
        baseRow({ id: 1n, material_id: "asset-a" }),
        baseRow({ id: 2n, material_id: "asset-b" }),
        baseRow({ id: 3n, material_id: "asset-norow" }), // 关联了但无状态行
        baseRow({ id: 4n }), // 未关联素材库
      ],
      findMaterial,
    );

    const page = await createAssetRepo(prisma as never).listByUser("9", {
      page: 1,
      size: 24,
    });

    // 关键：整页只发一条 IN，不是每条一次（无 N+1）。
    expect(findMaterial).toHaveBeenCalledTimes(1);
    expect(findMaterial).toHaveBeenCalledWith({
      where: { user_id: 9n, material_id: { in: ["asset-a", "asset-b", "asset-norow"] } },
      select: { material_id: true, status: true, status_checked_at: true },
    });

    const byId = new Map(page.records.map((r) => [r.id, r]));
    expect(byId.get("1")).toMatchObject({
      material_status: "Active",
      material_status_checked_at: "2026-09-15T10:00:00.000Z",
    });
    expect(byId.get("2")).toMatchObject({
      material_status: "Failed",
      material_status_checked_at: null,
    });
    expect(byId.get("3")).toMatchObject({ material_status: null });
    expect(byId.get("4")).toMatchObject({ material_status: null });
  });

  it("整页没有任何素材库关联时不发查询（常见的纯上传素材场景）", async () => {
    const findMaterial = vi.fn();
    const prisma = basePrisma([baseRow({ id: 1n }), baseRow({ id: 2n })], findMaterial);

    const page = await createAssetRepo(prisma as never).listByUser("9", {
      page: 1,
      size: 24,
    });

    expect(findMaterial).not.toHaveBeenCalled();
    expect(page.records.every((r) => r.material_status === null)).toBe(true);
  });

  it("超大批量分批查：单个 IN 不超过 500（?size= 无上限的防御）", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) =>
      baseRow({ id: BigInt(i + 1), material_id: `asset-${i}` }),
    );
    const findMaterial = vi.fn().mockResolvedValue([]);
    const prisma = basePrisma(rows, findMaterial);

    await createAssetRepo(prisma as never).listByUser("9", { page: 1, size: 1200 });

    expect(findMaterial).toHaveBeenCalledTimes(3); // 500 + 500 + 200
    const sizes = findMaterial.mock.calls.map(
      (c) => (c[0].where.material_id.in as string[]).length,
    );
    expect(sizes).toEqual([500, 500, 200]);
  });

  it("findOwnedById 详情路径同样带上状态", async () => {
    const findMaterial = vi.fn().mockResolvedValue([
      {
        material_id: "asset-a",
        status: "Processing",
        status_checked_at: null,
      },
    ]);
    const prisma = {
      assets: { findFirst: vi.fn().mockResolvedValue(baseRow({ material_id: "asset-a" })) },
      generation_jobs: { findMany: vi.fn().mockResolvedValue([]) },
      generation_model_capability: { findMany: vi.fn().mockResolvedValue([]) },
      material_assets: { findMany: findMaterial },
    };

    const view = await createAssetRepo(prisma as never).findOwnedById("1", "9");

    expect(view).toMatchObject({
      material_id: "asset-a",
      material_status: "Processing",
      material_status_checked_at: null,
    });
  });
});

describe("createAssetRepo 两阶段资产阶段与来源投影（IKIZQH，金标 G11 资产侧）", () => {
  const videoAssetRow = (id: bigint, jobId: bigint | null) => ({
    id,
    type: "video",
    name: null,
    url: `https://tos.test/${id}.mp4`,
    width: 1920,
    height: 1080,
    duration_ms: 5000,
    source: "generated",
    gmt_create: new Date("2026-09-29T00:00:00Z"),
    size: 1024n,
    generation_job_id: jobId,
    project_id: 55n,
    mime: "video/mp4",
  });

  it("成片资产投影 video_stage=final + source_sample_job_id 指回样片任务（列表路径）", async () => {
    const prisma = {
      assets: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([videoAssetRow(88n, 305n)]),
      },
      generation_jobs: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 305n,
            type: "video",
            input: { model_id: "seedance-2.5" },
            video_stage: "final",
            source_sample_job_id: 302n,
            final_job_id: null,
          },
        ]),
      },
      generation_model_capability: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const page = await createAssetRepo(prisma as never).listByUser("9", { page: 1, size: 24 });

    expect(page.records[0]).toMatchObject({
      id: "88",
      video_stage: "final",
      source_sample_job_id: "302",
      final_job_id: null,
    });
  });

  it("样片资产投影 video_stage=sample + final_job_id 指向唯一成片任务（详情路径）", async () => {
    const prisma = {
      assets: { findFirst: vi.fn().mockResolvedValue(videoAssetRow(61n, 302n)) },
      generation_jobs: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 302n,
            type: "video",
            input: { model_id: "seedance-2.5" },
            video_stage: "sample",
            source_sample_job_id: null,
            final_job_id: 305n,
          },
        ]),
      },
      generation_model_capability: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const asset = await createAssetRepo(prisma as never).findOwnedById("61", "9");

    expect(asset).toMatchObject({
      id: "61",
      video_stage: "sample",
      source_sample_job_id: null,
      final_job_id: "305",
    });
  });

  it("旧任务资产缺阶段列（G12）与上传资产 → video_stage 兜底 video、来源 null", async () => {
    const legacyRow = videoAssetRow(5n, 7n);
    const uploadedRow = { ...videoAssetRow(6n, null), type: "image" };
    const prisma = {
      assets: {
        count: vi.fn().mockResolvedValue(2),
        findMany: vi.fn().mockResolvedValue([legacyRow, uploadedRow]),
      },
      generation_jobs: {
        // 旧任务行没有 video_stage / 来源列（历史数据）。
        findMany: vi.fn().mockResolvedValue([{ id: 7n, type: "video", input: {} }]),
      },
      generation_model_capability: { findMany: vi.fn().mockResolvedValue([]) },
    };

    const page = await createAssetRepo(prisma as never).listByUser("9", { page: 1, size: 24 });

    expect(page.records[0]).toMatchObject({
      video_stage: "video",
      source_sample_job_id: null,
      final_job_id: null,
    });
    expect(page.records[1]).toMatchObject({
      type: "image",
      video_stage: "video",
      source_sample_job_id: null,
      final_job_id: null,
    });
  });

  it("资产主动删除不级联另一阶段：事务只软删目标 assets 行 + project_asset 关联，不触碰任务与其余资产", async () => {
    const assetsUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const paUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const generationJobs = { updateMany: vi.fn(), update: vi.fn(), findFirst: vi.fn() };
    const tx = {
      assets: { updateMany: assetsUpdate },
      project_asset: { updateMany: paUpdate },
      generation_jobs: generationJobs,
    };
    const prisma = { $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)) };

    // 删样片资产 61（其成片资产 88 与两阶段任务行都必须原地不动）。
    const ok = await createAssetRepo(prisma as never).softDeleteOwned("61", "9");

    expect(ok).toBe(true);
    expect(assetsUpdate).toHaveBeenCalledWith({
      where: { id: 61n, user_id: 9n, is_delete: false },
      data: expect.objectContaining({ is_delete: true }),
    });
    expect(generationJobs.updateMany).not.toHaveBeenCalled();
    expect(generationJobs.update).not.toHaveBeenCalled();
  });
});
