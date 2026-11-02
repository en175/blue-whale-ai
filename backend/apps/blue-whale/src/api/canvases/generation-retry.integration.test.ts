import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasesController } from "./canvases.controller.js";
import { GenerationJobsController } from "../generation/generation-jobs.controller.js";
import { GenerationModelsController } from "../generation/models.controller.js";
import { ProjectsController } from "../projects/projects.controller.js";
import { JobsController } from "../jobs/jobs.controller.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { GenerationCommandService } from "@lib/shared/generation/generation-command.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { MaterialService } from "@lib/shared/material/material.service.js";
import { SystemSettingsService } from "@lib/shared/system-settings/index.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { AccountDirectoryService } from "@lib/shared/identity/account-directory.service.js";
import { AllExceptionsFilter } from "@lib/infra/filters/all-exceptions.filter.js";

const { charge, queueSend } = vi.hoisted(() => ({
  charge: vi.fn(async () => ({ chargedCredits: 1, catalogVersion: 1, duplicated: false })),
  queueSend: vi.fn(async () => ({})),
}));

vi.mock("@lib/infra/mq/rocketmq-producer.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("@lib/infra/mq/rocketmq-producer.js")>(),
  loadRocketMqConfig: () => ({}),
  getStartedRocketMqProducer: async () => ({ send: queueSend }),
}));


vi.mock("@lib/shared/billing/billing-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lib/shared/billing/billing-client.js")>();
  return {
    ...actual,
    sharedBillingClient: () => ({
      charge,
      quote: async () => ({ credits: BigInt(1), catalogVersion: 1 }),
      queryBalance: async () => ({ availableCredits: 0, expiring: [] }),
      listTransactions: async () => ({ items: [], total: 0 }),
    }),
  };
});





describe.skipIf(!process.env.IKDMQV_DATABASE_URL)("Generation failure retry public API (IKDMQV)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const IMAGE_MODEL = "ikdmqv-image-model";
  const VIDEO_MODEL = "ikdmqv-video-model";
  const AUDIO_MODEL = "ikdmqv-audio-model";
  const VIDEO_FEATURES = {
    reference_image: true, image_reference_max: 10, first_frame: true, last_frame: true, first_last_frame: true,
    task_types: { text2video: {}, image_reference: {}, first_frame: {}, first_last_frame: {} },
  };
  const VIDEO_25_MODEL = "iknb97-configured-video";
  const VIDEO_20_MODEL = "iknb97-ordinary-video";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKDMQV_DATABASE_URL;
    const imageSizes = [{ id: "1024x1024", label: "1024x1024" }];
    await prisma.client.catalog_models.upsert({
      where: { provider_id_model_id: { provider_id: "ikdmqv-test", model_id: IMAGE_MODEL } },
      create: {
        provider_id: "ikdmqv-test",
        model_id: IMAGE_MODEL,
        capability_type: "image",
        model_label: "IKDMQV Image",
        supported_sizes: imageSizes,
        supported_aspect_ratios: ["1:1"],
        supported_formats: ["png"],
        default_size: "1024x1024",
        default_aspect_ratio: "1:1",
        features: {},

        channel: "seedream-image",
      },
      update: { features: {} },
    });
    await prisma.client.catalog_models.upsert({
      where: { provider_id_model_id: { provider_id: "ikdmqv-test", model_id: VIDEO_MODEL } },
      create: {
        provider_id: "ikdmqv-test",
        model_id: VIDEO_MODEL,
        capability_type: "video",
        model_label: "IKDMQV Video",
        supported_sizes: [{ id: "720p", label: "720p", api_value: "720p" }],
        supported_aspect_ratios: ["16:9"],
        supported_formats: ["mp4"],
        default_size: "720p",
        default_aspect_ratio: "16:9",
        default_duration: 5,
        supported_durations: { min: 4, max: 12, step: 1 },
        features: VIDEO_FEATURES,

        channel: "seedream-video",
      },
      update: { features: VIDEO_FEATURES },
    });
    for (const modelId of [VIDEO_25_MODEL, VIDEO_20_MODEL, "doubao-seedance-2-5-260628", "iknb97-no-video-reference"]) {
      const features = {
        ...VIDEO_FEATURES, video_reference: modelId !== "iknb97-no-video-reference", video_reference_max: 3, max_reference_duration_sec: 30,
        omni_reference_task_type: modelId !== VIDEO_20_MODEL,
        task_types: {
          ...VIDEO_FEATURES.task_types, omni: {},
          edit: modelId === VIDEO_20_MODEL
            ? { allowed_ratios: ["adaptive", "16:9"] }
            : { allowed_ratios: ["adaptive"], allowed_durations: [-1] },
        },
      };
      const data = {
        provider_id: "ikdmqv-test", model_id: modelId, capability_type: "video", model_label: modelId,
        supported_sizes: [{ id: "480p", label: "480p", api_value: "480p" }],
        supported_aspect_ratios: ["adaptive", "16:9"], supported_formats: ["mp4"],
        default_size: "480p", default_aspect_ratio: "adaptive", default_duration: 5,
        supported_durations: { min: 4, max: 30, step: 1 }, features, channel: "seedream-video",
      };
      await prisma.client.catalog_models.upsert({
        where: { provider_id_model_id: { provider_id: data.provider_id, model_id: modelId } },
        create: data, update: data,
      });
    }
    await prisma.client.catalog_models.upsert({
      where: { provider_id_model_id: { provider_id: "ikdmqv-test", model_id: AUDIO_MODEL } },
      create: {
        provider_id: "ikdmqv-test",
        model_id: AUDIO_MODEL,
        capability_type: "audio",
        model_label: "IKDMQV Audio",
        supported_sizes: [],
        supported_aspect_ratios: [],
        supported_formats: ["mp3"],
        default_size: "mp3",
        default_aspect_ratio: "1:1",
        features: {},

        channel: "seedream-audio",
      },
      update: { features: {} },
    });
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, CanvasService, MaterialService, AssetService, AssetStorageService, AccountDirectoryService], GenerationJobsController);
    Reflect.defineMetadata("design:paramtypes", [ModelCapabilityReadService], GenerationModelsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
    Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
    class HarnessModule {}
    Module({ controllers: [CanvasesController, GenerationJobsController, GenerationModelsController, ProjectsController, JobsController], providers: [
      { provide: CanvasService, useValue: canvasService },
      { provide: ProjectService, useValue: projects },
      { provide: PrismaService, useValue: prisma },
      { provide: SnapshotService, useValue: new SnapshotService(prisma) },
      { provide: JobsService, useValue: new JobsService(prisma, projects) },
      { provide: GenerationCommandService, useValue: new GenerationCommandService(prisma) },
      { provide: ModelCapabilityReadService, useValue: new ModelCapabilityReadService(prisma) },

      { provide: MaterialService, useValue: new MaterialService(prisma, new SystemSettingsService(prisma)) },
      { provide: AssetService, useValue: new AssetService(prisma, new AssetStorageService()) },
      { provide: AssetStorageService, useValue: new AssetStorageService() },
      { provide: AccountDirectoryService, useValue: new AccountDirectoryService(prisma) },
    ] })(HarnessModule);
    app = await NestFactory.create(HarnessModule, { logger: false, bodyParser: false });
    app.useGlobalFilters(new AllExceptionsFilter());
    app.use(json({ limit: "16mb" }));
    app.setGlobalPrefix("api");
    app.use((req: { user: unknown }, _res: unknown, next: () => void) => {
      req.user = { userId: "987654" };
      next();
    });
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  }, 30_000);
  afterAll(async () => {
    await app?.close();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    await prisma.client.$disconnect();
  });

  function imageDraftNode(id: string, prompt = "") {
    return {
      id,
      type: "mediaNode",
      position: { x: 420, y: 160 },
      data: {
        src: "",
        mediaType: "image",
        fileName: "图片草稿",
        genStatus: "draft",
        draft: true,
        prompt,
        draftModelId: IMAGE_MODEL,
        draftSize: "1024x1024",
        draftRatio: "1:1",
        targetRatio: "1:1",
      },
    };
  }
  function textNode(id: string, text: string, title = "文本") {
    return { id, type: "textNode", position: { x: 560, y: 80 }, data: { title, text } };
  }
  async function createAsset(projectId: string, type: "image" | "video" | "audio", url: string) {
    const row = await prisma.client.user_assets.create({
      data: {
        user_id: BigInt(987654),
        project_id: BigInt(projectId),
        type,
        url,
        width: 1024,
        height: 1024,
        size: BigInt(2048),
      },
    });
    return row.id.toString();
  }
  async function saveCanvas(projectId: string, nodes: unknown[], edges: unknown[], version: number | "missing", viewport = "{}") {
    return fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": version === "missing" ? '"missing"' : `"${version}"` },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges), viewport }),
    });
  }
  async function getCanvas(projectId: string) {
    const response = await fetch(`${base}/api/canvases?projectId=${projectId}`);
    return (await response.json()).data;
  }
  async function createJob(projectId: string, body: unknown) {
    const response = await fetch(`${base}/api/projects/${projectId}/generation-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.json();
  }
  async function retryJob(projectId: string, jobId: string) {
    const response = await fetch(`${base}/api/projects/${projectId}/generation-jobs/${jobId}/retry`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `ikdmqv-${jobId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      body: JSON.stringify({}),
    });
    return response.json();
  }
  async function readJob(jobId: string) {
    const row = await prisma.client.generation_jobs.findUnique({ where: { id: BigInt(jobId) } });
    return row ? { ...row, input: row.input as Record<string, unknown> } : null;
  }

  async function failJob(jobId: string) {
    await prisma.client.generation_output_slots.updateMany({
      where: { generation_job_id: BigInt(jobId) },
      data: { status: "failed" },
    });
    await prisma.client.generation_jobs.update({ where: { id: BigInt(jobId) }, data: { status: "failed" } });
  }

  it("旧视频缺少明确模式时，重复和并发重试要求重新编辑且保留画布，不新增任务、扣款或派发", async () => {
    const projectId = (await projects.create("987654", "IKNB97 legacy retry")).id;
    const imageA = await createAsset(projectId, "image", "https://example.com/8045.png");
    const imageB = await createAsset(projectId, "image", "https://example.com/8044.png");
    const video = await createAsset(projectId, "video", "https://example.com/8046.mp4");
    const nodes = [imageA, imageB, video].map((assetId, index) => ({
      id: `ref-${index}`, type: "mediaNode", position: { x: 100, y: index * 100 },
      data: { assetId, mediaType: index === 2 ? "video" : "image", src: `https://example.com/${assetId}` },
    }));
    const draft = { id: "media-draft-1790668577137-4", type: "mediaNode", position: { x: 420, y: 160 },
      data: { mediaType: "video", prompt: "保留人物，更换背景并加入手提袋", draft: true, genStatus: "failed" } };
    const edges = nodes.map((node) => ({ id: `e-${node.id}`, source: node.id, target: draft.id }));
    expect((await saveCanvas(projectId, [...nodes, draft], edges, "missing")).status).toBe(200);
    const input = {
      target_node_id: draft.id, prompt: draft.data.prompt, model_id: "doubao-seedance-2-5-260628",
      duration: 5, aspect_ratio: "adaptive", resolution: "480p", expected_output_count: 1,
      references: [
        { asset_id: imageA, role: "reference", type: "image" },
        { asset_id: imageB, role: "reference", type: "image" },
        { asset_id: video, role: "reference", type: "video", duration: 11 },
      ],
    };
    const original = await prisma.client.generation_jobs.create({ data: {
      project_id: BigInt(projectId), user_id: BigInt(987654), type: "video", source: "bottom_dock",
      status: "failed", input,
    } });
    const before = await getCanvas(projectId);
    charge.mockClear();
    queueSend.mockClear();
    const rejected = await Promise.all([
      retryJob(projectId, original.id.toString()),
      retryJob(projectId, original.id.toString()),
    ]);
    rejected.push(await retryJob(projectId, original.id.toString()));
    for (const response of rejected) {
      expect(response).toMatchObject({ code: 1060, data: null });
      expect(response.msg).toContain("重新编辑");
    }
    const jobs = await (await fetch(`${base}/api/jobs?projectId=${projectId}`)).json();
    expect(jobs.data.total).toBe(1);
    expect(charge).not.toHaveBeenCalled();
    expect(queueSend).not.toHaveBeenCalled();
    const after = await getCanvas(projectId);
    expect(after.nodes).toBe(before.nodes);
    expect(after.edges).toBe(before.edges);
    expect((await readJob(original.id.toString()))!.input).toEqual(input);
  });

  it.each([
    { label: "当前能力不再支持视频参考", patch: { model_id: "iknb97-no-video-reference" } },
    { label: "没有冻结上游任务类型能力", patch: { omni_reference_task_type_allowed: undefined } },
    { label: "冻结能力与当前能力不一致", patch: { omni_reference_task_type_allowed: false } },
    { label: "编辑模式仍保留固定时长", patch: { video_mode: "edit", duration: 5 } },
    { label: "编辑模式比例不合法", patch: { video_mode: "edit", duration: -1, aspect_ratio: "16:9" } },
    { label: "当前能力没有开放模式", patch: { video_mode: "extend" } },
    { label: "时长超出当前范围", patch: { duration: 31 } },
  ])("$label 时在任务与外部调用之前返回重新编辑提示", async ({ patch }) => {
    const projectId = (await projects.create("987654", "IKNB97 unsafe video")).id;
    const video = await createAsset(projectId, "video", "https://example.com/unsafe.mp4");
    const input = {
      model_id: VIDEO_25_MODEL, prompt: "保留人物", video_mode: "omni", duration: 5,
      aspect_ratio: "adaptive", resolution: "480p", omni_reference_task_type_allowed: true,
      references: [{ asset_id: video, role: "reference", type: "video", duration: 11 }], ...patch,
    };
    const original = await prisma.client.generation_jobs.create({ data: {
      project_id: BigInt(projectId), user_id: BigInt(987654), type: "video", source: "bottom_dock", status: "failed", input,
    } });
    charge.mockClear();
    queueSend.mockClear();
    const rejected = await retryJob(projectId, original.id.toString());
    expect(rejected).toMatchObject({ code: 1060, data: null });
    expect(rejected.msg).toContain("重新编辑");
    expect((await (await fetch(`${base}/api/jobs?projectId=${projectId}`)).json()).data.total).toBe(1);
    expect(charge).not.toHaveBeenCalled();
    expect(queueSend).not.toHaveBeenCalled();
  });

  it.each([
    { mode: "omni", model: "iknb97-configured-video", duration: 5, ratio: "adaptive", taskTypeAllowed: true },
    { mode: "edit", model: "iknb97-configured-video", duration: -1, ratio: "adaptive", taskTypeAllowed: true },
    { mode: "edit", model: "iknb97-ordinary-video", duration: 5, ratio: "16:9", taskTypeAllowed: false },
    { mode: "first_last_frame", model: "iknb97-configured-video", duration: 5, ratio: "16:9", taskTypeAllowed: true },
  ])("明确合法的 $mode / $model 继续沿用冻结快照及 duration=$duration", async ({ mode, model, duration, ratio, taskTypeAllowed }) => {
    const projectId = (await projects.create("987654", `IKNB97 ${mode} compatibility`)).id;
    const video = await createAsset(projectId, "video", "https://example.com/reference.mp4");
    const first = await createAsset(projectId, "image", "https://example.com/first.png");
    const last = await createAsset(projectId, "image", "https://example.com/last.png");
    const input = {
      model_id: model, prompt: "更换背景并加入手提袋", video_mode: mode,
      duration, aspect_ratio: ratio, resolution: "480p", expected_output_count: 1,
      omni_reference_task_type_allowed: taskTypeAllowed,
      references: mode === "first_last_frame"
        ? [{ asset_id: first, role: "first_frame", type: "image" }, { asset_id: last, role: "last_frame", type: "image" }]
        : [{ asset_id: video, role: "reference", type: "video", duration: 11 }],
    };
    const original = await prisma.client.generation_jobs.create({ data: {
      project_id: BigInt(projectId), user_id: BigInt(987654), type: "video", source: "bottom_dock", status: "failed", input,
    } });
    const retried = await retryJob(projectId, original.id.toString());
    expect(retried.code).toBe(200);
    expect((await readJob(retried.data.generation_job_id))!.input).toEqual(input);
    expect((await readJob(original.id.toString()))!.input).toEqual(input);
  });

  it.each([
    { model: "iknb97-configured-video", mode: "edit", duration: -1, ratio: "adaptive", allowed: true },
    { model: "iknb97-ordinary-video", mode: "edit", duration: 5, ratio: "16:9", allowed: false },
    { model: "iknb97-configured-video", mode: "omni", duration: 5, ratio: "adaptive", allowed: true },
  ])("重新报价提交的 $model / $mode 冻结明确模式和时长，再次失败仍可合法重试", async ({ model, mode, duration, ratio, allowed }) => {
    const projectId = (await projects.create("987654", "IKNB97 confirmed video")).id;
    const video = await createAsset(projectId, "video", "https://example.com/confirmed.mp4");
    await prisma.client.user_assets.update({ where: { id: BigInt(video) }, data: { duration_ms: 11000 } });
    const body = {
      type: "video", expected_output_count: 1,
      parameters: { model_id: model, prompt: "保留人物，更换背景并加入手提袋", mode, duration, aspect_ratio: ratio, resolution: "480p" },
      references: [{ asset_id: video, role: "reference", type: "video" }],
    };
    const quoted = await (await fetch(`${base}/api/projects/${projectId}/generation-jobs/quote`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    })).json();
    expect(quoted.code).toBe(200);
    expect(quoted.data.credits).toBe(1);
    const created = await createJob(projectId, { ...body, expected_credits: quoted.data.credits, quote_revision: quoted.data.quote_revision });
    expect(created.code).toBe(200);
    const jobId = created.data.generation_job_id;
    const frozen = (await readJob(jobId))!.input;
    expect(frozen).toMatchObject({ video_mode: mode, duration, omni_reference_task_type_allowed: allowed });
    await failJob(jobId);
    const retried = await retryJob(projectId, jobId);
    expect(retried.code).toBe(200);
    expect((await readJob(retried.data.generation_job_id))!.input).toEqual(frozen);
    expect((await readJob(jobId))!.input).toEqual(frozen);
  });

  it("直接重试沿用失败任务冻结快照：来源正文变化不替换原输入，历史任务不被改写；修改后新生成按现行规则冻结新输入", async () => {
    const projectId = (await projects.create("987654", "IKDMQV retry snapshot")).id;
    const assetId = await createAsset(projectId, "image", "https://example.com/ref.png");
    const nodesBodyA = [imageDraftNode("d1", "暮色"), textNode("t1", "赛博朋克", "雨夜")];
    const edges = [
      { id: "e-media", source: "m0", target: "d1" },
      { id: "e-text", source: "t1", target: "d1" },
    ];

    const sourceNode = {
      id: "m0",
      type: "mediaNode",
      position: { x: 100, y: 90 },
      data: { src: "https://example.com/ref.png", mediaType: "image", fileName: "参考图", assetId },
    };
    expect(
      (await saveCanvas(projectId, [sourceNode, ...nodesBodyA], edges, "missing")).status,
    ).toBe(200);

    const created = await createJob(projectId, {
      type: "image",
      target_node_id: "d1",
      input_asset_ids: [assetId],
      expected_output_count: 1,
      parameters: { prompt: "暮色", model_id: IMAGE_MODEL, aspect_ratio: "1:1" },
    });
    expect(created.code).toBe(200);
    const originalJobId = created.data.generation_job_id as string;
    const original = await readJob(originalJobId);
    expect(original!.input.text_attachments).toEqual([{ node_id: "t1", title: "雨夜", text: "赛博朋克" }]);
    expect(original!.input.input_asset_ids).toEqual([assetId]);


    await failJob(originalJobId);
    const canvas = await getCanvas(projectId);
    expect(
      (await saveCanvas(
        projectId,
        [sourceNode, imageDraftNode("d1", "暮色"), textNode("t1", "霓虹都市", "雨夜")],
        [{ id: "e-text", source: "t1", target: "d1" }],
        canvas.version,
      )).status,
    ).toBe(200);


    const retried = await retryJob(projectId, originalJobId);
    expect(retried.code).toBe(200);
    const retryJobId = retried.data.generation_job_id as string;
    expect(retryJobId).not.toBe(originalJobId);
    const retryRow = await readJob(retryJobId);
    expect(retryRow!.input.text_attachments, "重试沿用旧正文快照").toEqual([
      { node_id: "t1", title: "雨夜", text: "赛博朋克" },
    ]);
    expect(retryRow!.input.input_asset_ids, "重试沿用旧参考快照").toEqual([assetId]);
    expect(retryRow!.input.prompt).toBe(original!.input.prompt);


    const originalAfter = await readJob(originalJobId);
    expect(originalAfter!.input).toEqual(original!.input);


    const regenerated = await createJob(projectId, {
      type: "image",
      target_node_id: "d1",
      expected_output_count: 1,
      parameters: { prompt: "暮色新版", model_id: IMAGE_MODEL, aspect_ratio: "1:1" },
    });
    expect(regenerated.code).toBe(200);
    const regenRow = await readJob(regenerated.data.generation_job_id as string);
    expect(regenRow!.input.text_attachments, "新生成使用新正文").toEqual([
      { node_id: "t1", title: "雨夜", text: "霓虹都市" },
    ]);
    expect(regenRow!.input.input_asset_ids).toBeUndefined();


    expect((await readJob(originalJobId))!.input).toEqual(original!.input);
    expect((await readJob(retryJobId))!.input).toEqual(retryRow!.input);
  });

  it("时序隔离：重试任务创建后，原任务迟到翻成功不改变新任务的输入与状态", async () => {
    const projectId = (await projects.create("987654", "IKDMQV stale isolation")).id;
    expect(
      (await saveCanvas(projectId, [imageDraftNode("d1", "首战"), textNode("t1", "旧正文", "文本")], [
        { id: "e-text", source: "t1", target: "d1" },
      ], "missing")).status,
    ).toBe(200);

    const created = await createJob(projectId, {
      type: "image",
      target_node_id: "d1",
      expected_output_count: 1,
      parameters: { prompt: "首战", model_id: IMAGE_MODEL, aspect_ratio: "1:1" },
    });
    const originalJobId = created.data.generation_job_id as string;
    await failJob(originalJobId);

    const retried = await retryJob(projectId, originalJobId);
    const retryJobId = retried.data.generation_job_id as string;
    const retryInput = (await readJob(retryJobId))!.input;


    const lateAsset = await createAsset(projectId, "image", "https://example.com/late.png");
    await prisma.client.generation_output_slots.updateMany({
      where: { generation_job_id: BigInt(originalJobId) },
      data: { status: "succeeded", asset_id: BigInt(lateAsset) },
    });
    await prisma.client.generation_jobs.update({
      where: { id: BigInt(originalJobId) },
      data: { status: "succeeded", output_asset_ids: [lateAsset] },
    });


    const retryAfter = await readJob(retryJobId);
    expect(retryAfter!.input).toEqual(retryInput);
    expect(retryAfter!.status).not.toBe("succeeded");

    expect((await readJob(originalJobId))!.status).toBe("succeeded");
  });

  it("视频失败重试沿用冻结快照（显式首尾帧角色输入）", async () => {
    const projectId = (await projects.create("987654", "IKDMQV video retry")).id;
    const firstAsset = await createAsset(projectId, "image", "https://example.com/first.png");
    const lastAsset = await createAsset(projectId, "image", "https://example.com/last.png");
    const frameNode = (id: string, assetId: string) => ({
      id,
      type: "mediaNode" as const,
      position: { x: 100, y: 90 },
      data: { src: `https://example.com/${id}.png`, mediaType: "image", fileName: id, assetId },
    });
    const videoDraft = {
      id: "v1",
      type: "mediaNode",
      position: { x: 420, y: 160 },
      data: { src: "", mediaType: "video", fileName: "视频草稿", genStatus: "draft", draft: true, prompt: "追逐", draftModelId: VIDEO_MODEL, draftSize: "720p", draftRatio: "16:9", draftDuration: 5 },
    };
    expect(
      (await saveCanvas(projectId, [frameNode("f0", firstAsset), frameNode("l0", lastAsset), videoDraft], [
        { id: "e-first", source: "f0", target: "v1", data: { refRole: "first" } },
        { id: "e-last", source: "l0", target: "v1", data: { refRole: "last" } },
      ], "missing")).status,
    ).toBe(200);

    const created = await createJob(projectId, {
      type: "video",
      target_node_id: "v1",
      first_frame_asset_id: firstAsset,
      last_frame_asset_id: lastAsset,
      expected_output_count: 1,
      parameters: { prompt: "追逐", model_id: VIDEO_MODEL, aspect_ratio: "16:9", resolution: "720p", duration: 5 },
    });
    expect(created.code).toBe(200);
    const originalJobId = created.data.generation_job_id as string;
    await failJob(originalJobId);

    const retried = await retryJob(projectId, originalJobId);
    expect(retried.code).toBe(200);
    const retryRow = await readJob(retried.data.generation_job_id as string);
    expect(retryRow!.input.first_frame_asset_id).toBe(firstAsset);
    expect(retryRow!.input.last_frame_asset_id).toBe(lastAsset);
    expect(retryRow!.input.model_id).toBe(VIDEO_MODEL);
  });

  it("音频失败重试沿用冻结快照（纯文字描述输入）", async () => {
    const projectId = (await projects.create("987654", "IKDMQV audio retry")).id;
    const audioDraft = {
      id: "a1",
      type: "mediaNode",
      position: { x: 420, y: 160 },
      data: { src: "", mediaType: "audio", fileName: "音频草稿", genStatus: "draft", draft: true, prompt: "轻快的海浪声", draftModelId: AUDIO_MODEL },
    };
    expect((await saveCanvas(projectId, [audioDraft], [], "missing")).status).toBe(200);

    const created = await createJob(projectId, {
      type: "audio",
      target_node_id: "a1",
      expected_output_count: 1,
      parameters: { prompt: "轻快的海浪声", model_id: AUDIO_MODEL },
    });
    expect(created.code).toBe(200);
    const originalJobId = created.data.generation_job_id as string;
    await failJob(originalJobId);

    const retried = await retryJob(projectId, originalJobId);
    expect(retried.code).toBe(200);
    const retryRow = await readJob(retried.data.generation_job_id as string);
    expect(retryRow!.input.prompt).toBe("轻快的海浪声");
    expect(retryRow!.input.model_id).toBe(AUDIO_MODEL);

    expect(retryRow!.input.text_attachments).toEqual([]);
  });





  it.runIf(process.env.IKDMQV_BROWSER)("browser: failure recovery, retry with frozen snapshot, edit-then-regenerate", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKDMQV browser")).id;
    expect(
      (await saveCanvas(projectId, [textNode("t1", "赛博朋克", "雨夜")], [], "missing")).status,
    ).toBe(200);

    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const generationRequests: Array<Record<string, unknown>> = [];
      const retryRequests: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && /\/api\/projects\/\d+\/generation-jobs$/.test(request.url())) {
          generationRequests.push(request.postDataJSON() as Record<string, unknown>);
        }
        if (request.method() === "POST" && /\/generation-jobs\/\d+\/retry$/.test(request.url())) {
          retryRequests.push(request.url());
        }
      });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      const mediaNodes = page.locator(".react-flow__node-mediaNode");
      const nodeById = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);


      await nodeById("t1").waitFor({ timeout: 15_000 });



      await page.locator('button[aria-label="图片对话"]').click();
      const draft = page.locator(".react-flow__node-mediaNode", { hasText: "待生成" });
      const draftId = (await draft.getAttribute("data-id"))!;
      await page.locator("textarea").waitFor();
      await page.getByText("IKDMQV Image").waitFor();
      await page.locator("textarea").fill("画一只蓝鲸");

      const srcHandle = page.locator('.react-flow__node[data-id="t1"] .react-flow__handle-right');
      const dstHandle = page.locator(`.react-flow__node[data-id="${draftId}"] .react-flow__handle-left`);
      const sb = (await srcHandle.boundingBox())!;
      const db = (await dstHandle.boundingBox())!;
      await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
      await page.mouse.down();
      await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2, { steps: 12 });
      await page.mouse.up();
      await page.getByText("文本附件（1）").waitFor();
      await page.locator('button[title="发送"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      expect(generationRequests[0]!.target_node_id).toBe(draftId);

      const jobRows = async () =>
        prisma.client.generation_jobs.findMany({ where: { project_id: BigInt(projectId) }, orderBy: { id: "asc" } });
      await vi.waitFor(async () => expect((await jobRows()).length).toBe(1));
      const firstJob = (await jobRows())[0]!;


      await failJob(firstJob.id.toString());
      const failedCard = nodeById(draftId);
      await failedCard.getByText("生成失败").waitFor({ timeout: 15_000 });
      expect(await failedCard.getByRole("button", { name: "重试" }).count()).toBe(1);
      expect(await mediaNodes.count(), "失败不丢草稿卡").toBe(1);



      const canvas = await getCanvas(projectId);
      const savedNodes = JSON.parse(canvas.nodes) as unknown[];
      const editedNodes = savedNodes.map((n) =>
        (n as { id: string; data?: Record<string, unknown> }).id === "t1"
          ? { ...(n as object), data: { ...(n as { data: Record<string, unknown> }).data, text: "霓虹都市" } }
          : n,
      );
      expect((await saveCanvas(projectId, editedNodes, JSON.parse(canvas.edges), canvas.version)).status).toBe(200);
      await page.reload();
      await nodeById("t1").waitFor({ timeout: 15_000 });
      await vi.waitFor(async () =>
        expect(await nodeById(draftId).innerText()).toContain("生成失败"),
      );


      await failedCard.getByRole("button", { name: "重试" }).click();
      await vi.waitFor(() => expect(retryRequests).toHaveLength(1), { timeout: 10_000 });
      await vi.waitFor(async () => expect((await jobRows()).length).toBe(2));
      const retryJobRow = (await jobRows())[1]!;
      expect(retryJobRow.id).not.toBe(firstJob.id);
      const retryDetail = await readJob(retryJobRow.id.toString());
      expect(retryDetail!.input.text_attachments, "重试沿用失败任务冻结快照").toEqual([
        { node_id: "t1", title: "雨夜", text: "赛博朋克" },
      ]);
      const firstDetail = await readJob(firstJob.id.toString());
      expect(firstDetail!.input.text_attachments, "历史失败任务输入不变").toEqual([
        { node_id: "t1", title: "雨夜", text: "赛博朋克" },
      ]);


      const outputAsset = await prisma.client.user_assets.create({
        data: {
          user_id: BigInt(987654),
          project_id: BigInt(projectId),
          type: "image",
          url: "https://example.com/ikdmqv-out.png",
          width: 1024,
          height: 1024,
          size: BigInt(2048),
        },
      });
      await prisma.client.generation_output_slots.updateMany({
        where: { generation_job_id: retryJobRow.id },
        data: { status: "succeeded", asset_id: outputAsset.id },
      });
      await prisma.client.generation_jobs.update({
        where: { id: retryJobRow.id },
        data: { status: "succeeded", output_asset_ids: [outputAsset.id.toString()] },
      });
      await failedCard.locator("img").waitFor({ timeout: 15_000 });
      expect(await mediaNodes.count(), "成功承接不新增结果卡").toBe(1);
      await vi.waitFor(async () => {
        const doc = await getCanvas(projectId);
        const nodes = JSON.parse(doc.nodes) as Array<{ id: string; data: Record<string, unknown> }>;
        const done = nodes.find((n) => n.id === draftId);
        expect(done?.data.draft, "草稿身份结束").toBeUndefined();
        expect(done?.data.genStatus).toBeUndefined();
      });


      await failedCard.locator('[data-testid="media-content"]').click();
      await page.locator("textarea").waitFor();
      await vi.waitFor(async () => expect(await page.locator("textarea").inputValue()).toBe("画一只蓝鲸"));
      await page.locator("textarea").fill("画一只蓝鲸，逆光");
      await page.locator('button[title="发送"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(2), { timeout: 10_000 });
      expect(generationRequests[1]!.target_node_id, "修改后新生成仍由原卡承接").toBe(draftId);
      expect((generationRequests[1]!.parameters as Record<string, unknown>).prompt).toBe("画一只蓝鲸，逆光");
      await vi.waitFor(async () => {
        const rows = await jobRows();
        const third = await readJob(rows[2]!.id.toString());
        expect(third!.input.prompt, "新生成按现行规则冻结新输入").toBe("画一只蓝鲸，逆光");
        expect(third!.input.text_attachments, "来源已改文：新生成读最新正文").toEqual([
          { node_id: "t1", title: "雨夜", text: "霓虹都市" },
        ]);
      }, { timeout: 10_000 });

      const rows = await jobRows();
      expect((await readJob(rows[0]!.id.toString()))!.input.prompt).toBe("画一只蓝鲸");
      expect((await readJob(rows[1]!.id.toString()))!.input.prompt).toBe("画一只蓝鲸");


      await page.locator('button[aria-label="音频生成"]').click();
      const audioDraft = page.locator(".react-flow__node-mediaNode", { hasText: "待生成" });
      const audioDraftId = (await audioDraft.getAttribute("data-id"))!;
      await page.locator('[data-testid="audio-input"]').waitFor();
      await page.getByText("IKDMQV Audio").waitFor();
      await page.locator('[data-testid="audio-input"]').fill("轻快的海浪声");
      await vi.waitFor(async () => {
        const doc = await getCanvas(projectId);
        const nodes = JSON.parse(doc.nodes) as Array<{ id: string; data: Record<string, unknown> }>;
        expect(nodes.find((n) => n.id === audioDraftId)?.data.prompt, "描述落盘").toBe("轻快的海浪声");
      }, { timeout: 10_000 });
      await page.locator('[data-testid="audio-send"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(3), { timeout: 10_000 });

      const audioCard = nodeById(audioDraftId);
      await audioCard.getByText("任务入队失败").waitFor({ timeout: 15_000 });
      expect(await audioCard.getByRole("button", { name: "重试" }).count()).toBe(1);
      expect(await mediaNodes.count(), "音频失败保留草稿卡").toBe(2);

      await vi.waitFor(async () => {
        const doc = await getCanvas(projectId);
        const nodes = JSON.parse(doc.nodes) as Array<{ id: string; data: Record<string, unknown> }>;
        const audioSaved = nodes.find((n) => n.id === audioDraftId);
        expect(audioSaved?.data.genStatus, "音频失败态随画布落盘").toBe("failed");
        expect(audioSaved?.data.prompt, "描述随画布落盘").toBe("轻快的海浪声");
      }, { timeout: 10_000 });

      await page.reload();
      await vi.waitFor(async () => expect(await mediaNodes.count()).toBe(2));
      await vi.waitFor(async () =>
        expect(await nodeById(audioDraftId).innerText()).toContain("任务入队失败"),
      );
      await audioCard.locator('[data-testid="media-content"]').click();
      await page.locator('[data-testid="audio-input"]').waitFor();
      await vi.waitFor(async () =>
        expect(await page.locator('[data-testid="audio-input"]').inputValue()).toBe("轻快的海浪声"),
      );


      await page.locator('button[aria-label="视频对话"]').click();
      const videoDraft = page.locator(".react-flow__node-mediaNode", { hasText: "待生成" });
      const videoDraftId = (await videoDraft.getAttribute("data-id"))!;
      const editor = page.locator('[data-testid="chip-editor"] [contenteditable="true"], [contenteditable="true"]').first();
      await editor.waitFor();
      await editor.click();
      await page.keyboard.type("追逐镜头");
      await page.locator('[data-testid="video-send"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(4), { timeout: 10_000 });

      await vi.waitFor(async () => {
        const rows = await prisma.client.generation_jobs.findMany({
          where: { project_id: BigInt(projectId), type: "video" },
        });
        expect(rows.length).toBe(1);
      }, { timeout: 10_000 });
      const videoJob = (await prisma.client.generation_jobs.findFirst({
        where: { project_id: BigInt(projectId), type: "video" }, orderBy: { id: "desc" },
      }))!;
      await failJob(videoJob.id.toString());
      const videoCard = nodeById(videoDraftId);
      await videoCard.getByText("生成失败").waitFor({ timeout: 15_000 });
      expect(await videoCard.getByRole("button", { name: "重试" }).count()).toBe(1);
      expect(await mediaNodes.count(), "视频失败保留草稿卡").toBe(3);

      await browser.close();
      await vite.close();
    } finally {
      await browser.close().catch(() => {});
      await vite.close().catch(() => {});
    }
  }, 180_000);
});
