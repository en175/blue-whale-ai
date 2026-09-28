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
