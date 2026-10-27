import { describe, expect, it, vi } from "vitest";

import { createJobRepo } from "./job-repo.js";

function extraRow(jobId: bigint, extra_key: string, value_type: string, value_text: string) {
  return { generation_job_id: jobId, extra_key, value_type, value_text };
}

function extrasDelegate(rows: ReturnType<typeof extraRow>[] = []) {
  return {
    findMany: vi.fn().mockResolvedValue(rows),
    upsert: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
}

describe("createJobRepo.listByUser", () => {
  it("只向音频混合列表投影卡片持久状态以区分未落盘与主动删除", async () => {
    const prisma = {
      generation_jobs: { count: vi.fn().mockResolvedValue(2), findMany: vi.fn().mockResolvedValue([
        { id: 73n, type: "audio_mix", status: "failed",
          progress: 0, input: { source_node_id: "source", provider_credential: "secret" },
          output_asset_ids: [], gmt_create: new Date("2026-09-23T00:00:00Z"), error: null },
        { id: 72n, type: "audio_mix", status: "queued",
          progress: 0, input: { source_node_id: "source" }, output_asset_ids: [],
          gmt_create: new Date("2026-09-23T00:00:00Z"), error: null },
      ]) },
      user_assets: { findMany: vi.fn().mockResolvedValue([]) },
      generation_job_extras: extrasDelegate([extraRow(73n, "canvas_card_state", "string", "removed")]),
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
      user_assets: { findMany: vi.fn().mockResolvedValue([]) },
      generation_job_extras: extrasDelegate(),
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

  function buildPrisma(
    overrides: Record<string, unknown> = {},
    extrasRows: ReturnType<typeof extraRow>[] = [],
  ) {
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
      user_assets: { findMany: vi.fn().mockResolvedValue(assetRows) },
      generation_job_extras: extrasDelegate(extrasRows),
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
      user_assets: { findMany: vi.fn().mockResolvedValue([
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
    expect(prisma.user_assets.findMany).not.toHaveBeenCalled();
  });
});

describe("createJobRepo.listForAdmin", () => {
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
        catalog_models: { findMany: capabilityFindMany },
      } as never),
    };
  }

  it("一个筛选条件都不传 = 全站列表：where 里**没有**那些键", async () => {
    const { count, repo } = buildPrisma();

    await repo.listForAdmin({ page: 2, size: 20 });

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
      catalog_models: { findMany: vi.fn().mockResolvedValue([]) },
    } as never);

    const page = await repo.listForAdmin({ page: 1, size: 20 });

    expect(page.records[0]).not.toHaveProperty("input");
    expect(page.records[0]?.model_id).toBe("doubao-seedance-2-5-260628");
  });

  it("能力表里查得到就用展示名（中文名由能力表维护，这里不另造一个）", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { ...ROW, input: { model_id: "doubao-seedance-2-5-260628" } },
    ]);
    const repo = createJobRepo({
      generation_jobs: { count: vi.fn().mockResolvedValue(1), findMany },
      catalog_models: { findMany: vi.fn().mockResolvedValue(CAPS) },
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
      catalog_models: { findMany: vi.fn().mockResolvedValue([]) },
    } as never);

    const page = await repo.listForAdmin({ page: 1, size: 20 });

    expect(page.records[0]).toMatchObject({ model_id: "已下架的模型", model_label: null });
  });

  it("没有 model_id 的任务（免费工具族）两个字段都是 null，不是空串", async () => {
    const findMany = vi.fn().mockResolvedValue([{ ...ROW, input: { source_node_id: "n1" } }]);
    const capabilityFindMany = vi.fn().mockResolvedValue(CAPS);
    const repo = createJobRepo({
      generation_jobs: { count: vi.fn().mockResolvedValue(1), findMany },
      catalog_models: { findMany: capabilityFindMany },
    } as never);

    const page = await repo.listForAdmin({ page: 1, size: 20 });

    expect(page.records[0]).toMatchObject({ model_id: null, model_label: null });
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
      catalog_models: { findMany: capabilityFindMany },
    } as never);

    await repo.listForAdmin({ page: 1, size: 20 });

    expect(capabilityFindMany).toHaveBeenCalledTimes(1);
    expect(capabilityFindMany).toHaveBeenCalledWith({
      where: { model_id: { in: ["a", "b"] } },
      select: { model_id: true, model_label: true },
      orderBy: { id: "asc" },
    });
  });
});


describe("createJobRepo.loadChargeTaskSummaries", () => {
  const JOB = {
    id: 7n,
    type: "video",
    input: {
      model_id: "doubao-seedance-2-5-260628",
      prompt: "一只猫在草地上跑",
      provider_credential: "secret",
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
        catalog_models: { findMany: capFindMany },
      } as never),
      jobsFindMany,
      capFindMany,
    };
  }

  it("只抽 type / model_id / prompt 三个标量 + 规格，input 其余字段不跟着出去", async () => {
    const { repo } = repoOf([JOB], [{ model_id: JOB.input.model_id, model_label: "豆包 Seedance 2.5" }]);

    const map = await repo.loadChargeTaskSummaries(["7"]);

    expect(map.get("7")).toEqual({
      type: "video",
      modelId: "doubao-seedance-2-5-260628",
      modelLabel: "豆包 Seedance 2.5",
      prompt: "一只猫在草地上跑",
      specs: {
        model_id: "doubao-seedance-2-5-260628",
        reference_count: "0",
        video: "0",
        prompt_characters: "8",
      },
    });
    expect(map.get("7")).not.toHaveProperty("input");
  });

  it("specs 走 billing 同一份归一：凭证与提示词都不进规格，规格键小写、参考数按媒介取", async () => {
    const { repo } = repoOf([
      {
        id: 11n,
        type: "video",
        input: {
          model_id: "m",
          prompt: "提示词",
          provider_credential: "secret",
          Resolution: "1080P",
          references: [{ type: "video", duration: 3 }],
        },
      },
    ]);

    const map = await repo.loadChargeTaskSummaries(["11"]);

    expect(map.get("11")?.specs).toEqual({
      model_id: "m",
      resolution: "1080p",
      reference_count: "1",
      video: "1",
      reference_seconds: "3",
      prompt_characters: "3",
    });
    expect(map.get("11")?.specs).not.toHaveProperty("provider_credential");
    expect(map.get("11")?.specs).not.toHaveProperty("prompt");
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
      specs: { reference_count: "0", video: "0", prompt_characters: "5" },
    });
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

    expect(map.get("1")).toMatchObject({ prompt: null, modelId: null });
    expect(map.get("2")).toMatchObject({ prompt: null, modelId: null });
    expect(map.get("3")).toMatchObject({ prompt: null });
  });
});

describe("createJobRepo 两阶段视频阶段投影（IKIZQ8）", () => {
  it("★ G11：样片任务详情投影 video_stage/截止/费用，截止折 RFC3339（金标 G06 值）", async () => {
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
          source_sample_job_id: null,
        }),
      },
      user_assets: { findMany: vi.fn().mockResolvedValue([]) },
      generation_job_extras: extrasDelegate([
        extraRow(302n, "video_stage", "string", "sample"),
        extraRow(302n, "final_job_id", "number", "305"),
        extraRow(302n, "finalize_deadline_ms", "number", String(finalizeDeadlineMs)),
        extraRow(302n, "charge_state", "string", "charged"),
        extraRow(302n, "actual_credits", "number", "4"),
      ]),
    } as never;

    const view = await createJobRepo(prisma).findByIdForUser("302", "9");

    expect(view?.video_stage).toBe("sample");
    expect(view?.source_sample_job_id).toBeNull();
    expect(view?.final_job_id).toBe("305");
    expect(view?.finalize_deadline_at).toBe("2026-10-06T09:00:00+08:00");
    expect(view?.charge_state).toBe("charged");
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
      user_assets: { findMany: vi.fn().mockResolvedValue([]) },
      generation_job_extras: extrasDelegate(),
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
            source_sample_job_id: null,
          },
        ]),
      },
      user_assets: { findMany: vi.fn().mockResolvedValue([]) },
      generation_job_extras: extrasDelegate([
        extraRow(303n, "video_stage", "string", "sample"),
        extraRow(303n, "charge_state", "string", "charged"),
      ]),
    } as never;

    const page = await createJobRepo(prisma).listByUser("9", { page: 1, size: 10 });

    expect(page.records[0]?.video_stage).toBe("sample");
    expect(page.records[0]?.finalize_deadline_at).toBeNull();
    expect(page.records[0]?.charge_state).toBe("charged");
  });
});

describe("createJobRepo 两阶段历史与资产查询（IKIZQH）", () => {
  it("双向来源链路后半段：借样片资产的 final_job_id 查成片任务详情，拿到 source 指回 + 成片资产", async () => {
    const prisma = {
      generation_jobs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 305n,
          project_id: 7n,
          type: "video",
          status: "succeeded",
          progress: 100,
          input: null,
          output_asset_ids: [88],
          error: null,
          source_sample_job_id: 302n,
        }),
      },
      user_assets: {
        findMany: vi.fn().mockResolvedValue([
          { id: 88n, url: "https://tos.test/88.mp4", type: "video", width: 1920, height: 1080 },
        ]),
      },
      generation_job_extras: extrasDelegate([
        extraRow(305n, "video_stage", "string", "final"),
        extraRow(305n, "charge_state", "string", "charged"),
        extraRow(305n, "actual_credits", "number", "20"),
      ]),
    } as never;

    const view = await createJobRepo(prisma).findByIdForUser("305", "9");

    expect(view?.video_stage).toBe("final");
    expect(view?.source_sample_job_id).toBe("302");
    expect(view?.output_assets[0]).toMatchObject({ id: "88", type: "video" });
  });

  it("失败任务留历史不进成功资产：详情带阶段投影与原始错误，不查产出 assets", async () => {
    const assetsFindMany = vi.fn();
    const prisma = {
      generation_jobs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 306n,
          project_id: 7n,
          type: "video",
          status: "failed",
          progress: 0,
          input: null,
          output_asset_ids: null,
          error: { code: "provider_upstream_error", message: "上游生成失败" },
          source_sample_job_id: 302n,
        }),
      },
      user_assets: { findMany: assetsFindMany },
      generation_job_extras: extrasDelegate([
        extraRow(306n, "video_stage", "string", "final"),
        extraRow(306n, "charge_state", "string", "refunded"),
      ]),
    } as never;

    const view = await createJobRepo(prisma).findByIdForUser("306", "9");

    expect(view?.status).toBe("failed");
    expect(view?.video_stage).toBe("final");
    expect(view?.source_sample_job_id).toBe("302");
    expect(view?.charge_state).toBe("refunded");
    expect(view?.stored_error).toMatchObject({ code: "provider_upstream_error" });
    expect(view?.asset).toBeNull();
    expect(assetsFindMany).not.toHaveBeenCalled();
  });

  it("按本人跨项目汇总：不传 projectId 时 where 不含 project_id，跨项目两行都返回且失败行保留", async () => {
    const count = vi.fn().mockResolvedValue(2);
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 301n,
        project_id: 55n,
        type: "video",
        status: "queued",
        progress: 0,
        input: null,
        output_asset_ids: [],
        gmt_create: new Date("2026-09-29T01:00:00Z"),
        error: null,
        source_sample_job_id: null,
      },
      {
        id: 299n,
        project_id: 91n,
        type: "video",
        status: "failed",
        progress: 0,
        input: null,
        output_asset_ids: [],
        gmt_create: new Date("2026-09-28T00:00:00Z"),
        error: { code: "provider_upstream_error", message: "上游生成失败" },
      },
    ]);
    const prisma = {
      generation_jobs: { count, findMany },
      user_assets: { findMany: vi.fn().mockResolvedValue([]) },
      generation_job_extras: extrasDelegate([
        extraRow(301n, "video_stage", "string", "sample"),
        extraRow(301n, "charge_state", "string", "charged"),
      ]),
    } as never;

    const page = await createJobRepo(prisma).listByUser("9", { page: 1, size: 20 });

    expect(findMany.mock.calls[0][0].where).toEqual({
      user_id: 9n,
      is_delete: false,
    });
    expect(page.total).toBe(2);
    expect(page.records.map((r) => r.job_id)).toEqual(["301", "299"]);
    expect(page.records[0]).toMatchObject({ video_stage: "sample", charge_state: "charged" });
    expect(page.records[1]).toMatchObject({ video_stage: "video", source_sample_job_id: null });
    expect(page.records[1]?.stored_error).toMatchObject({ code: "provider_upstream_error" });
  });

  it("他人借来源 ID 读取任务被拒：详情查询强制 user_id + is_delete 过滤，不命中即 null", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { generation_jobs: { findFirst } } as never;

    const view = await createJobRepo(prisma).findByIdForUser("302", "8");

    expect(view).toBeNull();
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 302n, user_id: 8n, is_delete: false },
    });
  });
});
