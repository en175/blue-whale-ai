import { describe, expect, it, vi } from "vitest";

import { createJobRepo } from "./job-repo.js";

describe("createJobRepo.listByUser", () => {
  it("只向音频混合列表投影卡片持久状态以区分未落盘与主动删除", async () => {
    const prisma = {
      generation_jobs: { count: vi.fn().mockResolvedValue(2), findMany: vi.fn().mockResolvedValue([
        { id: 73n, type: "audio_mix", status: "failed", canvas_card_state: "removed",
          progress: 0, input: { source_node_id: "source", provider_credential: "secret" },
          output_asset_ids: [], gmt_create: new Date("2026-09-23T00:00:00Z"), error: null },
        { id: 72n, type: "audio_mix", status: "queued", canvas_card_state: "pending",
          progress: 0, input: { source_node_id: "source" }, output_asset_ids: [],
          gmt_create: new Date("2026-09-23T00:00:00Z"), error: null },
      ]) },
      assets: { findMany: vi.fn().mockResolvedValue([]) },
    } as never;
    const page = await createJobRepo(prisma).listByUser("9", { projectId: "55", type: "audio_mix", page: 1, size: 100 });
    expect(page.records.map((job) => [job.job_id, job.canvas_card_state])).toEqual([
      ["73", "removed"], ["72", "pending"],
    ]);
    expect(page.records[0]?.input).toEqual({ source_node_id: "source" });
  });

  it("ids 精确过滤，按当前用户 + 去重后的 ID 查询", async () => {
    const count = vi.fn().mockResolvedValue(2);
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 2n,
        type: "video",
        status: "processing",
        progress: 20,
        input: { prompt: "b" },
        output_asset_ids: [],
        gmt_create: new Date("2026-07-29T00:00:02.000Z"),
        error: null,
      },
      {
        id: 1n,
        type: "video",
        status: "succeeded",
        progress: 100,
        input: { prompt: "a" },
        output_asset_ids: [],
        gmt_create: new Date("2026-07-29T00:00:01.000Z"),
        error: null,
      },
    ]);
    const prisma = {
      generation_jobs: { count, findMany },
      assets: { findMany: vi.fn().mockResolvedValue([]) },
    } as never;

    const page = await createJobRepo(prisma).listByUser("9", {
      ids: ["1", "2", "2"],
      page: 1,
      size: 3,
    });

    expect(count).toHaveBeenCalledWith({
      where: {
        user_id: 9n,
        is_delete: false,
        id: { in: [1n, 2n] },
      },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        user_id: 9n,
        is_delete: false,
        id: { in: [1n, 2n] },
      },
      orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
      skip: 0,
      take: 3,
    });
    expect(page.records).toHaveLength(2);
    expect(page.records[0]).toMatchObject({ job_id: "2", status: "processing" });
  });
});

describe("createJobRepo.findByIdForUser", () => {
  const assetRows = [
    { id: 11n, url: "https://tos/seg-1.mp4", type: "video", width: 1920, height: 1080 },
    { id: 12n, url: "https://tos/seg-2.mp4", type: "video", width: 1920, height: 1080 },
  ];

  function buildPrisma(overrides: Record<string, unknown> = {}) {
    return {
      generation_jobs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 5n,
          project_id: 7n,
          type: "video_scene_split",
          status: "succeeded",
          progress: 100,
          input: null,
          output_asset_ids: [11, 12],
          error: null,
        }),
      },
      assets: { findMany: vi.fn().mockResolvedValue(assetRows) },
      generation_job_logs: {
        findFirst: vi.fn().mockResolvedValue({
          payload: {
            asset_ids: ["11", "12"],
            duration: 61.5,
            segments: [
              { segment_index: 1, start_time: 0, end_time: 15, segment_asset_id: "11" },
              { segment_index: 2, start_time: 15, end_time: 61.5, segment_asset_id: "12" },
            ],
          },
        }),
      },
      ...overrides,
    } as never;
  }

  it("场景切分成功任务：output_assets 按 output_asset_ids 顺序、result 取终态日志 payload", async () => {
    const prisma = buildPrisma();
    const view = await createJobRepo(prisma).findByIdForUser("5", "9");

    expect(view?.asset).toEqual({ id: "11", url: "https://tos/seg-1.mp4", type: "video" });
    expect(view?.output_assets).toEqual([
      { id: "11", url: "https://tos/seg-1.mp4", type: "video", width: 1920, height: 1080 },
      { id: "12", url: "https://tos/seg-2.mp4", type: "video", width: 1920, height: 1080 },
    ]);
    expect(view?.result).toEqual({
      asset_ids: ["11", "12"],
      duration: 61.5,
      segments: [
        { segment_index: 1, start_time: 0, end_time: 15, segment_asset_id: "11" },
        { segment_index: 2, start_time: 15, end_time: 61.5, segment_asset_id: "12" },
      ],
    });
    expect(prisma.generation_job_logs.findFirst).toHaveBeenCalledWith({
      where: { generation_job_id: 5n, status: "succeeded" },
      orderBy: { occurred_at: "desc" },
      select: { payload: true },
    });
  });

  it("非场景切分任务：不查终态日志（result 恒 null），output_assets 照常投影", async () => {
    const prisma = buildPrisma({
      generation_jobs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 5n,
          project_id: 7n,
          type: "media_extract",
          status: "succeeded",
          progress: 100,
          input: null,
          output_asset_ids: [11],
          error: null,
        }),
      },
    });
    const view = await createJobRepo(prisma).findByIdForUser("5", "9");

    expect(view?.result).toBeNull();
    expect(prisma.generation_job_logs.findFirst).not.toHaveBeenCalled();
    expect(view?.output_assets).toEqual([
      { id: "11", url: "https://tos/seg-1.mp4", type: "video", width: 1920, height: 1080 },
    ]);
  });

  it("音频混合成功任务：首个产物的持久时长毫秒投影为秒", async () => {
    const prisma = buildPrisma({
      generation_jobs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 5n,
          project_id: 7n,
          type: "audio_mix",
          status: "succeeded",
          progress: 100,
          input: null,
          output_asset_ids: [11],
          error: null,
        }),
      },
      assets: { findMany: vi.fn().mockResolvedValue([
        { id: 11n, url: "https://tos/mixed.mp3", type: "audio", width: null, height: null, duration_ms: 42750 },
      ]) },
    });

    const view = await createJobRepo(prisma).findByIdForUser("5", "9");
    expect(view?.asset).toEqual({ id: "11", url: "https://tos/mixed.mp3", type: "audio", duration: 42.75 });
  });

  it("进行中任务：output_assets 为空、asset 为 null、不查日志", async () => {
    const prisma = buildPrisma({
      generation_jobs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 5n,
          project_id: 7n,
          type: "video_scene_split",
          status: "processing",
          progress: 40,
          input: null,
          output_asset_ids: [],
          error: null,
        }),
      },
    });
    const view = await createJobRepo(prisma).findByIdForUser("5", "9");

    expect(view?.asset).toBeNull();
    expect(view?.output_assets).toEqual([]);
    expect(view?.result).toBeNull();
    expect(prisma.generation_job_logs.findFirst).not.toHaveBeenCalled();
    expect(prisma.assets.findMany).not.toHaveBeenCalled();
  });
});

describe("createJobRepo.listForAdmin", () => {
  /** 一行真实列的子集：够投影出管理端那一行即可。 */
  const ROW = {
    id: 73n,
    user_id: 9001n,
    project_id: 55n,
    type: "video",
    status: "failed",
    progress: 40,
    provider: "doubao",
    retry_count: 2,
    gmt_create: new Date("2026-09-25T00:00:00Z"),
    gmt_modified: new Date("2026-09-25T00:01:00Z"),
    error: { code: "unsupported_input" },
  };

  const CAPS = [
    { model_id: "doubao-seedance-2-5-260628", model_label: "豆包 Seedance 2.5" },
  ];

  function buildPrisma(caps: { model_id: string; model_label: string }[] = []) {
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([ROW]);
    const capabilityFindMany = vi.fn().mockResolvedValue(caps);
    return {
      count,
      findMany,
      capabilityFindMany,
      repo: createJobRepo({
        generation_jobs: { count, findMany },
        generation_model_capability: { findMany: capabilityFindMany },
      } as never),
    };
  }

  it("一个筛选条件都不传 = 全站列表：where 里**没有**那些键", async () => {
    const { count, repo } = buildPrisma();

    await repo.listForAdmin({ page: 2, size: 20 });

    // is_delete 是 Boolean 列（recharge_orders 那张是 Int，别抄错）
    expect(count).toHaveBeenCalledWith({ where: { is_delete: false } });
  });

  it("用户 / 项目 / 类型 / 状态按原值过滤，两个 id 转 BigInt", async () => {
    const { findMany, repo } = buildPrisma();

    await repo.listForAdmin({
      userId: "9001",
      projectId: "55",
      type: "video",
      status: "failed",
      page: 2,
      size: 20,
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        is_delete: false,
        user_id: 9001n,
        project_id: 55n,
        type: "video",
        status: "failed",
      },
      // 次级键 id：DATETIME 只到秒，只按时间排序会在秒边界跳行或重复行
      orderBy: [{ gmt_create: "desc" }, { id: "desc" }],
      skip: 20,
      take: 20,
    });
  });

  it("投影出归属与失败原因原文（错误码投影是上层的事，这里只给库里的东西）", async () => {
    const { repo } = buildPrisma();

    const page = await repo.listForAdmin({ page: 1, size: 20 });

    expect(page).toMatchObject({ total: 1, size: 20, current: 1 });
    expect(page.records[0]).toMatchObject({
      job_id: "73",
      user_id: "9001",
      project_id: "55",
      provider: "doubao",
      retry_count: 2,
      stored_error: { code: "unsupported_input" },
    });
    // 管理端列表不拉 assets：那一列没人看，却会多一轮查询 + N+1
    expect(page.records[0]).not.toHaveProperty("output_assets");
  });

  it("project_id 为 null（不在项目里的任务）投影成空串，不是 'null'", async () => {
    const findMany = vi.fn().mockResolvedValue([{ ...ROW, project_id: null, error: null }]);
    const repo = createJobRepo({
      generation_jobs: { count: vi.fn().mockResolvedValue(1), findMany },
    } as never);

    const page = await repo.listForAdmin({ page: 1, size: 20 });

    expect(page.records[0]).toMatchObject({ project_id: "", stored_error: null });
  });

  /* ---------- 模型列（IK：任务记录不再显示厂商，有模型就显示模型） ---------- */

  it("从 input 只取 model_id，整份 input 不上列表", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        ...ROW,
        input: {
          model_id: "doubao-seedance-2-5-260628",
          prompt: "一句提示词",
          parameters: { duration: 5 },
        },
      },
    ]);
    const repo = createJobRepo({
      generation_jobs: { count: vi.fn().mockResolvedValue(1), findMany },
      generation_model_capability: { findMany: vi.fn().mockResolvedValue([]) },
    } as never);

    const page = await repo.listForAdmin({ page: 1, size: 20 });

    // 提示词、规格都留在库里：为了一列把整份 input 搬到列表上，接口体积会跟着 input 的结构长
    expect(page.records[0]).not.toHaveProperty("input");
    expect(page.records[0]?.model_id).toBe("doubao-seedance-2-5-260628");
  });

  it("能力表里查得到就用展示名（中文名由能力表维护，这里不另造一个）", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { ...ROW, input: { model_id: "doubao-seedance-2-5-260628" } },
    ]);
    const repo = createJobRepo({
      generation_jobs: { count: vi.fn().mockResolvedValue(1), findMany },
      generation_model_capability: { findMany: vi.fn().mockResolvedValue(CAPS) },
    } as never);

    const page = await repo.listForAdmin({ page: 1, size: 20 });

    expect(page.records[0]).toMatchObject({
      model_id: "doubao-seedance-2-5-260628",
      model_label: "豆包 Seedance 2.5",
    });
  });

  it("能力表里查不到 → model_label 为 null（由前端原样显示 model_id，不编名字）", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { ...ROW, input: { model_id: "已下架的模型" } },
    ]);
    const repo = createJobRepo({
      generation_jobs: { count: vi.fn().mockResolvedValue(1), findMany },
      generation_model_capability: { findMany: vi.fn().mockResolvedValue([]) },
    } as never);

    const page = await repo.listForAdmin({ page: 1, size: 20 });

    expect(page.records[0]).toMatchObject({ model_id: "已下架的模型", model_label: null });
  });

  it("没有 model_id 的任务（免费工具族）两个字段都是 null，不是空串", async () => {
    const findMany = vi.fn().mockResolvedValue([{ ...ROW, input: { source_node_id: "n1" } }]);
    const capabilityFindMany = vi.fn().mockResolvedValue(CAPS);
    const repo = createJobRepo({
      generation_jobs: { count: vi.fn().mockResolvedValue(1), findMany },
      generation_model_capability: { findMany: capabilityFindMany },
    } as never);

    const page = await repo.listForAdmin({ page: 1, size: 20 });

    expect(page.records[0]).toMatchObject({ model_id: null, model_label: null });
    // 一个 model_id 都没收到就不该去查能力表
    expect(capabilityFindMany).not.toHaveBeenCalled();
  });

  it("整页的模型名一次批量查（不是一行一次）", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { ...ROW, id: 1n, input: { model_id: "a" } },
      { ...ROW, id: 2n, input: { model_id: "b" } },
      { ...ROW, id: 3n, input: { model_id: "a" } },
    ]);
    const capabilityFindMany = vi.fn().mockResolvedValue([]);
    const repo = createJobRepo({
      generation_jobs: { count: vi.fn().mockResolvedValue(3), findMany },
      generation_model_capability: { findMany: capabilityFindMany },
    } as never);

    await repo.listForAdmin({ page: 1, size: 20 });

    expect(capabilityFindMany).toHaveBeenCalledTimes(1);
    // 去重后只查这两个
    expect(capabilityFindMany).toHaveBeenCalledWith({
      where: { model_id: { in: ["a", "b"] } },
      select: { model_id: true, model_label: true },
      orderBy: { id: "asc" },
    });
  });
});

/* ---------- 积分记录页：按 jobId 批量取「这个任务是什么」 ---------- */

describe("createJobRepo.loadChargeTaskSummaries", () => {
  /** 一条任务：input 里除了要抽的两个键，还有别的东西（那些都不该跟出去）。 */
  const JOB = {
    id: 7n,
    type: "video",
    input: {
      model_id: "doubao-seedance-2-5-260628",
      prompt: "一只猫在草地上跑",
      parameters: { duration: 5 },
      input_asset_ids: [1, 2],
    },
  };

  function repoOf(
    jobs: unknown[],
    caps: unknown[] = [],
  ): { repo: ReturnType<typeof createJobRepo>; jobsFindMany: ReturnType<typeof vi.fn>; capFindMany: ReturnType<typeof vi.fn> } {
    const jobsFindMany = vi.fn().mockResolvedValue(jobs);
    const capFindMany = vi.fn().mockResolvedValue(caps);
    return {
      repo: createJobRepo({
        generation_jobs: { findMany: jobsFindMany },
        generation_model_capability: { findMany: capFindMany },
      } as never),
      jobsFindMany,
      capFindMany,
    };
  }

  it("只抽 type / model_id / prompt 三个标量，input 其余字段不跟着出去", async () => {
    const { repo } = repoOf([JOB], [{ model_id: JOB.input.model_id, model_label: "豆包 Seedance 2.5" }]);

    const map = await repo.loadChargeTaskSummaries(["7"]);

    expect(map.get("7")).toEqual({
      type: "video",
      modelId: "doubao-seedance-2-5-260628",
      modelLabel: "豆包 Seedance 2.5",
      prompt: "一只猫在草地上跑",
    });
    // 与任务记录列表同一条纪律：为了一列把整份 input 搬出去，接口体积会随结构一起长
    expect(map.get("7")).not.toHaveProperty("input");
  });

  it("查不到的 id **键缺席**（不是塞一个空对象）——「没这个任务」与「有任务但没提示词」要能分开", async () => {
    const { repo } = repoOf([]);

    const map = await repo.loadChargeTaskSummaries(["7", "8"]);

    expect(map.size).toBe(0);
    expect(map.has("7")).toBe(false);
  });

  it("免费工具族没有 model_id → 两个模型字段为 null，但 prompt 仍在", async () => {
    const { repo, capFindMany } = repoOf([
      { id: 9n, type: "image_cutout", input: { prompt: "把背景抠掉" } },
    ]);

    const map = await repo.loadChargeTaskSummaries(["9"]);

    expect(map.get("9")).toEqual({
      type: "image_cutout",
      modelId: null,
      modelLabel: null,
      prompt: "把背景抠掉",
    });
    // 一个 model_id 都没收到就不该去查能力表
    expect(capFindMany).not.toHaveBeenCalled();
  });

  it("没有 prompt 的任务 → prompt 为 null，但类型与模型照常给", async () => {
    const { repo } = repoOf([{ id: 7n, type: "video", input: { model_id: "m" } }]);

    const map = await repo.loadChargeTaskSummaries(["7"]);

    expect(map.get("7")).toMatchObject({ type: "video", modelId: "m", prompt: null });
  });

  it("**不过滤 is_delete、不加 user_id 作用域**：任务软删了，那笔消费仍然发生过", async () => {
    const { repo, jobsFindMany } = repoOf([]);

    await repo.loadChargeTaskSummaries(["7"]);

    // 只按 id IN 查。加了 user_id 就会漏掉「全站流水」里别人的行；
    // 加了 is_delete 就会让软删任务的历史消费那一格空白——两者都是管理端不能接受的
    expect(jobsFindMany).toHaveBeenCalledWith({
      where: { id: { in: [7n] } },
      select: { id: true, type: true, input: true },
    });
  });

  it("id 去重后一次批量查（同一 job 的多条流水不会重复查）", async () => {
    const { repo, jobsFindMany } = repoOf([]);

    await repo.loadChargeTaskSummaries(["7", "7", "8"]);

    expect(jobsFindMany).toHaveBeenCalledTimes(1);
    expect(jobsFindMany).toHaveBeenCalledWith({
      where: { id: { in: [7n, 8n] } },
      select: { id: true, type: true, input: true },
    });
  });

  it("空列表直接返回空 Map，**不发查询**", async () => {
    const { repo, jobsFindMany, capFindMany } = repoOf([]);

    const map = await repo.loadChargeTaskSummaries([]);

    expect(map.size).toBe(0);
    expect(jobsFindMany).not.toHaveBeenCalled();
    expect(capFindMany).not.toHaveBeenCalled();
  });

  it("一批模型名一次批量查（不是一行一次）", async () => {
    const { repo, capFindMany } = repoOf([
      { id: 1n, type: "video", input: { model_id: "a" } },
      { id: 2n, type: "video", input: { model_id: "b" } },
      { id: 3n, type: "video", input: { model_id: "a" } },
    ]);

    await repo.loadChargeTaskSummaries(["1", "2", "3"]);

    expect(capFindMany).toHaveBeenCalledTimes(1);
    // 去重后只查这两个
    expect(capFindMany).toHaveBeenCalledWith({
      where: { model_id: { in: ["a", "b"] } },
      select: { model_id: true, model_label: true },
      orderBy: { id: "asc" },
    });
  });

  it("能力表查不到展示名 → model_label 为 null（由前端原样显示 model_id，不编名字）", async () => {
    const { repo } = repoOf([{ id: 7n, type: "video", input: { model_id: "已下架的模型" } }], []);

    const map = await repo.loadChargeTaskSummaries(["7"]);

    expect(map.get("7")).toMatchObject({ modelId: "已下架的模型", modelLabel: null });
  });

  it("input 形状不认识（老任务 / 免费工具族的各种形态）→ 不抛，读不出的字段为 null", async () => {
    const { repo } = repoOf([
      { id: 1n, type: "video", input: null },
      { id: 2n, type: "video", input: "不是对象" },
      { id: 3n, type: "video", input: { prompt: "   " } },
    ]);

    const map = await repo.loadChargeTaskSummaries(["1", "2", "3"]);

    // 空白串按「没有」处理：界面上「一行空白」与「没有提示词」没区别，不该多一态
    expect(map.get("1")).toMatchObject({ prompt: null, modelId: null });
    expect(map.get("2")).toMatchObject({ prompt: null, modelId: null });
    expect(map.get("3")).toMatchObject({ prompt: null });
  });
});

// ═══════════════════════════════════════════════════════════════
// IKIZQ8：两阶段视频的阶段投影（契约 videoStageJobProjectionSchema，金标 G11/G12）。
// 样片行投影阶段/来源/截止/费用；缺列旧行按普通视频兜底（video=video、其余 null）。
// ═══════════════════════════════════════════════════════════════
describe("createJobRepo 两阶段视频阶段投影（IKIZQ8）", () => {
  it("★ G11：样片任务详情投影 video_stage/截止/费用，截止折 RFC3339（金标 G06 值）", async () => {
    // upstream created_at=2026-09-29T02:00:00Z（金标 G06 输入）→ deadline=2026-10-06T01:00:00Z。
    const finalizeDeadlineMs = 1790647200000 + 7 * 24 * 3600 * 1000 - 3600 * 1000;
    const prisma = {
      generation_jobs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 302n,
          project_id: 7n,
          type: "video",
          status: "succeeded",
          progress: 100,
          input: null,
          output_asset_ids: [],
          error: null,
          video_stage: "sample",
          source_sample_job_id: null,
          final_job_id: 305n,
          upstream_created_at_ms: 1790647200000n,
          finalize_deadline_ms: BigInt(finalizeDeadlineMs),
          charge_state: "settled",
          actual_credits: 4,
        }),
      },
      assets: { findMany: vi.fn().mockResolvedValue([]) },
    } as never;

    const view = await createJobRepo(prisma).findByIdForUser("302", "9");

    expect(view?.video_stage).toBe("sample");
    expect(view?.source_sample_job_id).toBeNull();
    expect(view?.final_job_id).toBe("305");
    expect(view?.finalize_deadline_at).toBe("2026-10-06T01:00:00.000Z");
    expect(view?.charge_state).toBe("settled");
    expect(view?.actual_credits).toBe(4);
  });

  it("★ G12：旧任务缺阶段列 → video_stage 兜底 video、来源/截止/费用全 null", async () => {
    const prisma = {
      generation_jobs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 5n,
          project_id: 7n,
          type: "video",
          status: "succeeded",
          progress: 100,
          input: null,
          output_asset_ids: [],
          error: null,
        }),
      },
      assets: { findMany: vi.fn().mockResolvedValue([]) },
    } as never;

    const view = await createJobRepo(prisma).findByIdForUser("5", "9");

    expect(view?.video_stage).toBe("video");
    expect(view?.source_sample_job_id).toBeNull();
    expect(view?.final_job_id).toBeNull();
    expect(view?.finalize_deadline_at).toBeNull();
    expect(view?.charge_state).toBeNull();
    expect(view?.actual_credits).toBeNull();
  });

  it("列表投影同样携带阶段字段（缺可信时间的样片 deadline=null，禁成片不禁交付）", async () => {
    const prisma = {
      generation_jobs: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 303n,
            type: "video",
            status: "succeeded",
            progress: 100,
            input: null,
            output_asset_ids: [],
            gmt_create: new Date("2026-09-29T00:00:00Z"),
            error: null,
            video_stage: "sample",
            source_sample_job_id: null,
            final_job_id: null,
            upstream_created_at_ms: null,
            finalize_deadline_ms: null,
            charge_state: "held",
            actual_credits: null,
          },
        ]),
      },
      assets: { findMany: vi.fn().mockResolvedValue([]) },
    } as never;

    const page = await createJobRepo(prisma).listByUser("9", { page: 1, size: 10 });

    expect(page.records[0]?.video_stage).toBe("sample");
    expect(page.records[0]?.finalize_deadline_at).toBeNull();
    expect(page.records[0]?.charge_state).toBe("held");
  });
});
