import "reflect-metadata";
import { Module } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasesController } from "./canvases.controller.js";
import { GenerationJobsController } from "../generation/generation-jobs.controller.js";
import { GenerationModelsController } from "../generation/models.controller.js";
import { JobsController } from "../jobs/jobs.controller.js";
import { ProjectsController } from "../projects/projects.controller.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { GenerationCommandService } from "@lib/shared/generation/generation-command.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { MaterialService } from "@lib/shared/material/material.service.js";
import { SystemSettingsService } from "@lib/shared/system-settings/index.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { IdentityService } from "@lib/shared/identity/identity.service.js";
import { textInputSignatureOf, VIDEO_TEXT_INDEX_FRAME_CONFLICT_MESSAGE } from "@lib/contracts";
import { AllExceptionsFilter } from "@lib/infra/filters/all-exceptions.filter.js";

vi.mock("@lib/shared/generation/generation-queue.js", () => ({
  enqueueVideoGenerationJob: vi.fn(async () => {}),
  enqueueImageGenerationJob: vi.fn(async () => {}),
  enqueueAudioGenerationJob: vi.fn(async () => {}),
  enqueueMediaExtractJob: vi.fn(async () => {}),
  loadRocketMqConfig: vi.fn(() => ({ endpoints: "", sslEnabled: false })),
  createRocketMqGenerationProducer: vi.fn(() => ({ enqueue: vi.fn(async () => {}) })),
  closeGenerationQueue: vi.fn(async () => {}),
}));

vi.mock("@lib/shared/billing/billing-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lib/shared/billing/billing-client.js")>();
  return {
    ...actual,
    sharedBillingClient: () => ({
      charge: async () => ({ chargedCredits: 1, catalogVersion: 1, duplicated: false }),
      quote: async () => ({ credits: BigInt(1), catalogVersion: 1 }),
      queryBalance: async () => ({ availableCredits: 0, expiring: [] }),
      listTransactions: async () => ({ items: [], total: 0 }),
    }),
  };
});

describe.skipIf(!process.env.IKFM3S_DATABASE_URL)("Text index downstream sync contract (IKFM3S)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "ikfm3s-image-model";
  const LIMIT_MODEL_ID = "ikfm3s-limit-model";
  const VIDEO_MODEL_ID = "ikfm3w-video-model";
  const VIDEO_LIMIT_MODEL_ID = "ikfm3w-video-limit-model";
  const VIDEO_NOVID_MODEL_ID = "ikfm3w-video-novid-model";
  const AUDIO_MODEL_ID = "ikfm41-audio-model";
  const AUDIO_LIMIT_MODEL_ID = "ikfm41-audio-limit-model";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKFM3S_DATABASE_URL;
    const sizes = [{ id: "1024x1024", label: "1024x1024" }];
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikfm3s-test", model_id: MODEL_ID } },
      create: {
        provider_id: "ikfm3s-test",
        model_id: MODEL_ID,
        capability_type: "image",
        model_label: "IKFM3S Test",
        supported_sizes: sizes,
        supported_aspect_ratios: ["1:1"],
        supported_formats: ["png"],
        default_size: "1024x1024",
        default_aspect_ratio: "1:1",
        features: { reference_image: true },
        channel: "seedream-image",
      },
      update: { supported_sizes: sizes, default_size: "1024x1024", features: { reference_image: true } },
    });
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikfm3s-test", model_id: LIMIT_MODEL_ID } },
      create: {
        provider_id: "ikfm3s-test",
        model_id: LIMIT_MODEL_ID,
        capability_type: "image",
        model_label: "IKFM3S Limit",
        supported_sizes: sizes,
        supported_aspect_ratios: ["1:1"],
        supported_formats: ["png"],
        default_size: "1024x1024",
        default_aspect_ratio: "1:1",
        features: { image_reference_max: 1 },
        channel: "seedream-image",
      },
      update: { features: { image_reference_max: 1 } },
    });
    const videoFeatures = { reference_image: true, video_reference: true, audio_reference: false, image_reference_max: 10 };
    for (const [modelId, label, features, sortOrder] of [
      [VIDEO_MODEL_ID, "IKFM3W Video", videoFeatures, 0],
      [VIDEO_LIMIT_MODEL_ID, "IKFM3W Video Limit", { ...videoFeatures, image_reference_max: 1 }, 100],
      [VIDEO_NOVID_MODEL_ID, "IKFM3W Video NoVid", { ...videoFeatures, video_reference: false }, 101],
    ] as const) {
      await prisma.client.generation_model_capability.upsert({
        where: { provider_id_model_id: { provider_id: "ikfm3s-test", model_id: modelId } },
        create: {
          provider_id: "ikfm3s-test",
          model_id: modelId,
          capability_type: "video",
          model_label: label,
          supported_sizes: sizes,
          supported_aspect_ratios: ["1:1", "adaptive"],
          supported_formats: ["mp4"],
          supported_durations: [5, 10, 1],
          default_duration: 5,
          default_size: "1024x1024",
          default_aspect_ratio: "1:1",
          features,
          channel: "seedream-video",
          sort_order: sortOrder,
        },
        update: { features, supported_durations: [5, 10, 1], default_duration: 5 },
      });
    }
    for (const [modelId, label, features] of [
      [AUDIO_MODEL_ID, "IKFM41 Audio", {}],
      [AUDIO_LIMIT_MODEL_ID, "IKFM41 Audio Limit", { audio_reference_max: 1 }],
    ] as const) {
      await prisma.client.generation_model_capability.upsert({
        where: { provider_id_model_id: { provider_id: "ikfm3s-test", model_id: modelId } },
        create: {
          provider_id: "ikfm3s-test",
          model_id: modelId,
          capability_type: "audio",
          model_label: label,
          supported_sizes: [],
          supported_aspect_ratios: [],
          supported_formats: ["mp3"],
          default_size: "mp3",
          default_aspect_ratio: "1:1",
          features,
          channel: "seedream-audio",
        },
        update: { features },
      });
    }
    const canvasService = new CanvasService(prisma, projects);
    const jobsService = new JobsService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, CanvasService, MaterialService, AssetService, AssetStorageService, IdentityService], GenerationJobsController);
    Reflect.defineMetadata("design:paramtypes", [ModelCapabilityReadService], GenerationModelsController);
    Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
    class HarnessModule {}
    Module({ controllers: [CanvasesController, GenerationJobsController, GenerationModelsController, JobsController, ProjectsController], providers: [
      { provide: APP_FILTER, useClass: AllExceptionsFilter },
      { provide: MaterialService, useValue: new MaterialService(prisma, new SystemSettingsService(prisma)) },
      { provide: AssetService, useValue: new AssetService(prisma, new AssetStorageService()) },
      { provide: AssetStorageService, useValue: new AssetStorageService() },
      { provide: CanvasService, useValue: canvasService },
      { provide: ProjectService, useValue: projects },
      { provide: PrismaService, useValue: prisma },
      { provide: JobsService, useValue: jobsService },
      { provide: GenerationCommandService, useValue: new GenerationCommandService(prisma) },
      { provide: ModelCapabilityReadService, useValue: new ModelCapabilityReadService(prisma) },
      { provide: SnapshotService, useValue: new SnapshotService(prisma) },
      { provide: MaterialService, useValue: new MaterialService(prisma, new SystemSettingsService(prisma)) },
      { provide: AssetService, useValue: new AssetService(prisma, new AssetStorageService()) },
      { provide: IdentityService, useValue: new IdentityService(prisma) },
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

  async function createAsset(projectId: bigint, type: "image" | "video" | "audio", url: string) {
    const asset = await prisma.client.assets.create({ data: { user_id: 987654n, project_id: projectId, type, url, width: 640, height: 480 } });
    return asset.id.toString();
  }
  async function saveCanvas(projectId: string, nodes: unknown[], edges: unknown[], version: number | "missing") {
    const response = await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": version === "missing" ? '"missing"' : `"${version}"` },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges), viewport: "{}" }),
    });
    expect(response.status, await response.clone().text()).toBe(200);
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
  async function readJob(jobId: string) {
    const row = await prisma.client.generation_jobs.findUnique({ where: { id: BigInt(jobId) } });
    return row ? { ...row, input: row.input as Record<string, unknown> } : null;
  }
  const jobCount = (projectId: string) =>
    prisma.client.generation_jobs.count({ where: { project_id: BigInt(projectId) } });

  function imageJobBody(targetNodeId: string, prompt: string, inputAssetIds?: string[], modelId = MODEL_ID) {
    return {
      type: "image",
      target_node_id: targetNodeId,
      expected_output_count: 1,
      ...(inputAssetIds ? { input_asset_ids: inputAssetIds } : {}),
      parameters: { prompt, model_id: modelId, aspect_ratio: "1:1" },
    };
  }

  async function seedIndexedCanvas(projectName: string, options: { dropIndexEdge?: boolean; videoRef?: boolean } = {}) {
    const project = await projects.create("987654", projectName);
    const projectId = project.id;
    const mediaType = options.videoRef ? "video" : "image";
    const imageAssetId = await createAsset(projectId, mediaType, "https://example.com/m1.png");
    const directAssetId = await createAsset(projectId, "image", "https://example.com/m2.png");
    const nodes = [
      { id: "gen-1", type: "mediaNode", position: { x: 800, y: 0 }, data: { mediaType: "image", draft: true } },
      { id: "media-1", type: "mediaNode", position: { x: 0, y: 0 }, data: { assetId: imageAssetId, mediaType, src: "https://example.com/m1.png", fileName: "甲图" } },
      { id: "media-2", type: "mediaNode", position: { x: 0, y: 300 }, data: { assetId: directAssetId, mediaType: "image", src: "https://example.com/m2.png", fileName: "乙图" } },
      {
        id: "text-1", type: "textNode", position: { x: 400, y: 0 },
        data: {
          title: "文本",
          text: "用图片1出图",
          mediaMentions: [{ start: 1, end: 4, nodeId: "media-1", assetId: imageAssetId }],
          mediaRefs: [{ nodeId: "media-1", assetId: imageAssetId, mediaType, name: "甲图", url: "https://example.com/m1.png" }],
        },
      },
    ];
    const edges = [
      { id: "e-text", source: "text-1", target: "gen-1" },
      { id: "e-direct", source: "media-2", target: "gen-1" },
      ...(options.dropIndexEdge ? [] : [{ id: "e-index", source: "media-1", target: "text-1", data: { textIndex: true } }]),
    ];
    await saveCanvas(projectId, nodes, edges, "missing");
    return { projectId, imageAssetId, directAssetId };
  }

  it("权威并入：文本带入素材追加尾部，media 映射与签名冻结进快照", async () => {
    const { projectId, imageAssetId, directAssetId } = await seedIndexedCanvas("IKFM3S merge");
    const created = await createJob(projectId, imageJobBody("gen-1", "暮色", [directAssetId]));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.input_asset_ids).toEqual([directAssetId, imageAssetId]);
    expect(job!.input.text_attachments).toEqual([
      {
        node_id: "text-1",
        title: "文本",
        text: "用图片2出图",
        media: [{ node_id: "media-1", asset_id: imageAssetId, media_type: "image" }],
      },
    ]);
    expect(job!.input.text_input_signature).toBe(
      textInputSignatureOf([
        { nodeId: "text-1", text: "用图片1出图", identities: [{ sourceNodeId: "media-1", assetId: imageAssetId, mediaType: "image" }] },
      ]),
    );
  });

  it("正文原样冻结（prompt_doc 已退役，不再由它编译正文）", async () => {
    const { projectId, imageAssetId, directAssetId } = await seedIndexedCanvas("IKFR50 prompt doc");
    const created = await createJob(projectId, {
      ...imageJobBody("gen-1", "重绘", [directAssetId]),
      prompt_doc: { version: 1, segments: [
        { kind: "text", text: "重绘" },
        { kind: "asset_ref", asset_id: imageAssetId },
      ] },
    });
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.prompt).toBe("重绘");
    expect(job!.input).not.toHaveProperty("prompt_doc");
    expect(job!.input.input_asset_ids).toEqual([directAssetId, imageAssetId]);
  });

  it("各文本卡独立重编号，重复绑定区间与 Markdown 保留，普通编号不替换", async () => {
    const { projectId, imageAssetId, directAssetId } = await seedIndexedCanvas("IKFR50 bound ranges");
    const canvas = await prisma.client.canvas.findUnique({ where: { project_id: BigInt(projectId) } });
    const nodes = canvas!.nodes_json as unknown as Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
    const source = nodes.find((node) => node.id === "text-1")!;
    const text = "**图片1**，图片1；普通图片1";
    source.data.text = text;
    source.data.mediaMentions = [text.indexOf("图片1"), text.indexOf("图片1", 5)].map((start) => ({
      start, end: start + 3, nodeId: "media-1", assetId: imageAssetId,
    }));
    nodes.push({ ...source, id: "text-2", data: {
      title: "另一个文本", text: "图片1",
      mediaMentions: [{ start: 0, end: 3, nodeId: "media-2", assetId: directAssetId }],
      mediaRefs: [{ nodeId: "media-2", assetId: directAssetId, mediaType: "image", name: "乙图", url: "https://example.com/m2.png" }],
    } });
    await saveCanvas(projectId, nodes, [
      ...(canvas!.edges_json as unknown as unknown[]),
      { id: "e-text2", source: "text-2", target: "gen-1" },
      { id: "e-index2", source: "media-2", target: "text-2", data: { textIndex: true } },
    ], canvas!.version);
    const created = await createJob(projectId, imageJobBody("gen-1", "暮色", [directAssetId]));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect((job!.input.text_attachments as Array<{ text: string }>).map((item) => item.text))
      .toEqual(["**图片2**，图片2；普通图片1", "图片1"]);
  });

  it("方案快照包含文本带入素材及目标编号正文", async () => {
    const { projectId, imageAssetId, directAssetId } = await seedIndexedCanvas("IKFR50 plan snapshot");
    const canvas = await prisma.client.canvas.findUnique({ where: { project_id: BigInt(projectId) } });
    const nodes = canvas!.nodes_json as unknown as Array<{ id: string; data: Record<string, unknown> }>;
    const planNodes = [...nodes, {
      id: "plan-1", type: "textNode", position: { x: 0, y: 500 }, data: {
        text: "电影质感", promptSource: { sessionId: "test-session", revisionId: "test-revision", shotNo: 1 },
        promptMentions: [], promptMaterials: [],
      },
    }];
    const planEdges = [...(canvas!.edges_json as unknown as unknown[]), {
      id: "e-plan", source: "plan-1", target: "gen-1",
    }];
    await prisma.client.canvas.update({ where: { project_id: BigInt(projectId) }, data: {
      nodes_json: JSON.parse(JSON.stringify(planNodes)), edges_json: JSON.parse(JSON.stringify(planEdges)),
    } });
    const created = await createJob(projectId, imageJobBody("gen-1", "暮色", [directAssetId]));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    const snapshot = job!.input.prompt_plan_snapshot as { images: Array<{ assetId: string }> };
    expect(snapshot.images.map((item) => item.assetId)).toEqual([directAssetId, imageAssetId]);
    expect(snapshot).not.toHaveProperty("providerPrompt");
  });

  it("重试复用原快照：合并参考、media 映射与签名原样复制，不重读画布", async () => {
    const { projectId, imageAssetId, directAssetId } = await seedIndexedCanvas("IKFM3S retry");
    const created = await createJob(projectId, imageJobBody("gen-1", "暮色", [directAssetId]));
    expect(created.code).toBe(200);
    const original = await readJob(created.data.generation_job_id);
    const canvasRow = await prisma.client.canvas.findUnique({ where: { project_id: BigInt(projectId) } });
    const retryNodes = canvasRow!.nodes_json as unknown as Array<{ id: string; data: Record<string, unknown> }>;
    retryNodes.find((node) => node.id === "text-1")!.data.text = "提交后改的正文";
    await saveCanvas(projectId, retryNodes, canvasRow!.edges_json as unknown as unknown[], canvasRow!.version);
    await prisma.client.generation_output_slots.updateMany({
      where: { generation_job_id: BigInt(created.data.generation_job_id) },
      data: { status: "failed" },
    });
    await prisma.client.generation_jobs.update({ where: { id: BigInt(created.data.generation_job_id) }, data: { status: "failed" } });
    const retried = await fetch(`${base}/api/projects/${projectId}/generation-jobs/${created.data.generation_job_id}/retry`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": `ikfm3s-${created.data.generation_job_id}-${Date.now()}`,
      },
      body: "{}",
    });
    const retryBody = (await retried.json()) as { code: number; data?: { generation_job_id: string } };
    expect(retryBody.code).toBe(200);
    const retryJob = await readJob(retryBody.data!.generation_job_id);
    expect(retryJob!.id).not.toBe(original!.id);
    expect(retryJob!.input.input_asset_ids).toEqual(original!.input.input_asset_ids);
    expect(retryJob!.input.text_attachments).toEqual(original!.input.text_attachments);
    expect(retryJob!.input.text_input_signature).toBe(original!.input.text_input_signature);
  });

  it("同源预演：body 已含文本素材时序不变（后端零追加）", async () => {
    const { projectId, imageAssetId, directAssetId } = await seedIndexedCanvas("IKFM3S premerged");
    const created = await createJob(projectId, imageJobBody("gen-1", "暮色", [directAssetId, imageAssetId]));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.input_asset_ids).toEqual([directAssetId, imageAssetId]);
  });

  it("失效索引（textIndex 关系线缺失）阻止发送且零建任务", async () => {
    const { projectId } = await seedIndexedCanvas("IKFM3S invalid", { dropIndexEdge: true });
    const before = await jobCount(projectId);
    const created = await createJob(projectId, imageJobBody("gen-1", "暮色"));
    expect(created.code).toBe(1034);
    expect(created.msg).toBe("文本索引存在失效素材，请修复来源文本后提交");
    expect(await jobCount(projectId)).toBe(before);
  });

  it("不支持媒体类型（文本索引视频素材进图片目标）阻止发送", async () => {
    const { projectId } = await seedIndexedCanvas("IKFM3S unsupported", { videoRef: true });
    const before = await jobCount(projectId);
    const created = await createJob(projectId, imageJobBody("gen-1", "暮色"));
    expect(created.code).toBe(1035);
    expect(created.msg).toBe("文本索引包含目标不支持的媒体类型，请修改来源文本");
    expect(await jobCount(projectId)).toBe(before);
  });

  it("合并后超模型上限阻止发送（直接参考 + 文本带入联算）", async () => {
    const { projectId, directAssetId } = await seedIndexedCanvas("IKFM3S overflow");
    const before = await jobCount(projectId);
    const created = await createJob(projectId, imageJobBody("gen-1", "暮色", [directAssetId], LIMIT_MODEL_ID));
    expect(created.code).toBe(1004);
    expect(created.msg).toBe("参考图最多 1 张");
    expect(await jobCount(projectId)).toBe(before);
  });

  it("回归：普通文本连线（无媒体索引）行为不变；签名覆盖正文（提示含正文变化）", async () => {
    const project = await projects.create("987654", "IKFM3S plain");
    const projectId = project.id;
    const nodes = [
      { id: "gen-1", type: "mediaNode", position: { x: 800, y: 0 }, data: { mediaType: "image", draft: true } },
      { id: "text-1", type: "textNode", position: { x: 400, y: 0 }, data: { title: "文本", text: "赛博朋克" } },
    ];
    await saveCanvas(projectId, nodes, [{ id: "e1", source: "text-1", target: "gen-1" }], "missing");
    const created = await createJob(projectId, imageJobBody("gen-1", "暮色"));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.input_asset_ids).toBeUndefined();
    expect(job!.input.text_attachments).toEqual([{ node_id: "text-1", title: "文本", text: "赛博朋克" }]);
    expect(job!.input.text_input_signature).toBe(
      textInputSignatureOf([{ nodeId: "text-1", text: "赛博朋克", identities: [] }]),
    );
  });

  it("正文变化后新任务签名不同（提示清除依据）；素材删除后提交被存在性复核拒绝", async () => {
    const { projectId, imageAssetId, directAssetId } = await seedIndexedCanvas("IKFM3S signature");
    const first = await createJob(projectId, imageJobBody("gen-1", "暮色", [directAssetId]));
    expect(first.code).toBe(200);
    const firstJob = await readJob(first.data.generation_job_id);
    const canvas = await prisma.client.canvas.findUnique({ where: { project_id: BigInt(projectId) } });
    const nodes = canvas!.nodes_json as unknown as Array<{ id: string; data: Record<string, unknown> }>;
    const edges = canvas!.edges_json as unknown as unknown[];
    const text = nodes.find((node) => node.id === "text-1")!;
    text.data.text = "改用图片1出图吧";
    await saveCanvas(projectId, nodes, edges, canvas!.version);
    const second = await createJob(projectId, imageJobBody("gen-1", "暮色", [directAssetId]));
    expect(second.code).toBe(200);
    const secondJob = await readJob(second.data.generation_job_id);
    expect(secondJob!.input.text_input_signature).not.toBe(firstJob!.input.text_input_signature);
    await prisma.client.assets.update({ where: { id: BigInt(imageAssetId) }, data: { is_delete: true } });
    const third = await createJob(projectId, imageJobBody("gen-1", "暮色", [directAssetId]));
    expect(third.code).toBe(1034);
    expect(third.msg).toBe("参考素材不存在或无权访问");
  });

  it.runIf(process.env.IKFM3S_BROWSER)("browser: 锁定参考进栏、输入已更新提示、成功清除、编辑重现、冻结输入", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFM3S browser")).id;
    const indexedAssetId = await createAsset(projectId, "image", "https://example.com/indexed.png");
    const directAssetId = await createAsset(projectId, "image", "https://example.com/direct.png");
    const nodes = [
      { id: "m1", type: "mediaNode", position: { x: 100, y: 80 }, data: { assetId: indexedAssetId, mediaType: "image", src: "https://example.com/indexed.png", fileName: "索引图" } },
      { id: "m2", type: "mediaNode", position: { x: 100, y: 320 }, data: { assetId: directAssetId, mediaType: "image", src: "https://example.com/direct.png", fileName: "直接图" } },
      { id: "t1", type: "textNode", position: { x: 520, y: 200 }, data: {
        title: "文案", text: "用图片1重绘",
        mediaMentions: [{ start: 1, end: 4, nodeId: "m1", assetId: indexedAssetId }],
        mediaRefs: [{ nodeId: "m1", assetId: indexedAssetId, mediaType: "image", name: "索引图", url: "https://example.com/indexed.png" }],
      } },
      { id: "d1", type: "mediaNode", position: { x: 960, y: 120 }, data: { mediaType: "image", draft: true, fileName: "图片生成" } },
    ];
    const edges = [
      { id: "e-index", source: "m1", target: "t1", data: { textIndex: true } },
      { id: "e-direct", source: "m2", target: "d1" },
    ];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).version).toBeDefined();

    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
      const generationRequests: Array<Record<string, unknown>> = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && /\/api\/projects\/\d+\/generation-jobs$/.test(request.url())) {
          generationRequests.push(request.postDataJSON() as Record<string, unknown>);
        }
      });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      page.on("pageerror", (error) => console.log("[ikfm3s pageerror]", String(error).slice(0, 600)));
      page.on("console", (message) => {
        if (message.type() === "error") console.log("[ikfm3s console.error]", message.text().slice(0, 600));
      });
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      const nodeById = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
      const dockRefs = page.locator('[data-testid="dock-media-ref"]');
      const editor = page.locator('[contenteditable="true"]');
      const badge = page.locator('[data-testid="input-stale-badge"]');

      await nodeById("m1").waitFor();
      await nodeById("t1").waitFor();
      await nodeById("d1").waitFor();

      const src = page.locator('.react-flow__node[data-id="t1"] .react-flow__handle-right');
      const dst = page.locator('.react-flow__node[data-id="d1"] .react-flow__handle-left');
      const sb = (await src.boundingBox())!;
      const db = (await dst.boundingBox())!;
      await page.mouse.move(sb.x + sb.width * 0.75, sb.y + sb.height / 2);
      await page.mouse.down();
      await page.mouse.move(db.x + db.width * 0.25, db.y + db.height / 2, { steps: 24 });
      await page.mouse.up();
      await vi.waitFor(async () => expect(await badge.count(), "文本连线后目标右上角显示输入已更新").toBe(1));
      await page.screenshot({ path: "/tmp/ikfm3s-badge.png", fullPage: true });

      await nodeById("d1").locator('[data-testid="media-content"]').click();
      await editor.waitFor();
      await vi.waitFor(async () => expect(await dockRefs.count(), "直接参考 + 文本带入参考").toBe(2));
      const locked = dockRefs.filter({ has: page.locator('button[title="此素材由文本索引提供，请修改来源文本"]') });
      const removable = dockRefs.filter({ has: page.locator('button[title="移除"]') });
      await vi.waitFor(async () => expect(await locked.count(), "文本带入条目锁定（定位入口）").toBe(1));
      await vi.waitFor(async () => expect(await removable.count(), "直接参考可移除").toBe(1));
      expect(await dockRefs.nth(1).locator('[data-testid="ref-thumb-badge"]').textContent()).toBe("2");

      await editor.click();
      await page.keyboard.type("参考这张图重新绘制");
      const acceptedResponse = page.waitForResponse((response) =>
        response.request().method() === "POST" && response.url().endsWith(`/api/projects/${projectId}/generation-jobs`));
      await page.locator('button[title="发送"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      expect(generationRequests[0].target_node_id).toBe("d1");
      expect(generationRequests[0].input_asset_ids).toEqual([directAssetId, indexedAssetId]);

      const response = await acceptedResponse;
      expect(response.ok()).toBe(true);
      const accepted = await response.json();
      expect(accepted.code).toBe(200);
      const jobRow = await prisma.client.generation_jobs.findUnique({ where: { id: BigInt(accepted.data.generation_job_id) } });
      expect(jobRow).not.toBeNull();
      const outputAsset = await prisma.client.assets.create({ data: { user_id: 987654n, project_id: BigInt(projectId), type: "image", url: "https://example.com/out.png", width: 640, height: 480 } });
      await prisma.client.generation_jobs.update({
        where: { id: jobRow!.id },
        data: { status: "succeeded", progress: 100, output_asset_ids: [outputAsset.id] },
      });
      await vi.waitFor(async () => expect(await badge.count(), "成功使用最新输入后清除提示").toBe(0), { timeout: 15_000 });
      await vi.waitFor(async () => {
        const canvas = await prisma.client.canvas.findUnique({ where: { project_id: BigInt(projectId) } });
        const saved = (canvas!.nodes_json as unknown as Array<{ id: string; data: Record<string, unknown> }>).find((n) => n.id === "d1");
        expect(saved!.data.usedInputSignature).toBe((jobRow!.input as Record<string, unknown>).text_input_signature);
        expect(saved!.data.usedInputJobId).toBe(Number(jobRow!.id));
      }, { timeout: 10_000 });

      const canvasRow = await prisma.client.canvas.findUnique({ where: { project_id: BigInt(projectId) } });
      const savedNodes = canvasRow!.nodes_json as unknown as Array<{ id: string; data: Record<string, unknown> }>;
      savedNodes.find((n) => n.id === "t1")!.data.text = "改用图片1重绘这张";
      await saveCanvas(projectId, savedNodes, canvasRow!.edges_json as unknown as unknown[], canvasRow!.version);
      await page.reload();
      await nodeById("d1").waitFor();
      await vi.waitFor(async () => expect(await badge.count(), "正文变化后提示重现（刷新恢复）").toBe(1));
      await page.screenshot({ path: "/tmp/ikfm3s-badge-reappear.png", fullPage: true });

      const textEdge = page.locator('.react-flow__edge[data-id="e-t1-d1"]');
      await textEdge.waitFor();
      await nodeById("d1").locator('[data-testid="media-content"]').click({ position: { x: 5, y: 5 } }).catch(() => {});
      const srcBox = (await page.locator('.react-flow__node[data-id="t1"] .react-flow__handle-right').boundingBox())!;
      const dstBox = (await page.locator('.react-flow__node[data-id="d1"] .react-flow__handle-left').boundingBox())!;
      await page.mouse.move(srcBox.x + (dstBox.x - srcBox.x) * 0.25, srcBox.y + (dstBox.y - srcBox.y) * 0.25);
      const cut = textEdge.locator('g[class*="deleteBtn"]');
      await cut.waitFor({ state: "visible" });
      await cut.dispatchEvent("click");
      await vi.waitFor(async () => expect(await textEdge.count(), "断开文本→目标连线").toBe(0), { timeout: 10_000 });
      await vi.waitFor(async () => expect(await badge.count(), "断开文本线后无文本输入、提示消失").toBe(0), { timeout: 10_000 });
      await nodeById("d1").locator('[data-testid="media-content"]').click();
      await editor.waitFor();
      await vi.waitFor(async () => expect(await dockRefs.count(), "仅剩直接参考").toBe(1));
      await page.screenshot({ path: "/tmp/ikfm3s-after-unlink.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 180_000);


  function videoJobBody(targetNodeId: string, prompt: string, references?: unknown[], modelId = VIDEO_MODEL_ID, aspectRatio = "1:1") {
    return {
      type: "video",
      target_node_id: targetNodeId,
      expected_output_count: 1,
      ...(references ? { references } : {}),
      parameters: { prompt, model_id: modelId, aspect_ratio: aspectRatio },
    };
  }

  async function seedVideoIndexedCanvas(projectName: string, options: { refMediaType?: "image" | "video"; dropIndexEdge?: boolean } = {}) {
    const project = await projects.create("987654", projectName);
    const projectId = project.id;
    const refMediaType = options.refMediaType ?? "image";
    const indexedAssetId = await createAsset(projectId, refMediaType, "https://example.com/v1.png");
    const directAssetId = await createAsset(projectId, "image", "https://example.com/v2.png");
    const nodes = [
      { id: "gen-v", type: "mediaNode", position: { x: 800, y: 0 }, data: { mediaType: "video", draft: true } },
      { id: "media-1", type: "mediaNode", position: { x: 0, y: 0 }, data: { assetId: indexedAssetId, mediaType: refMediaType, src: "https://example.com/v1.png", fileName: "甲素材" } },
      { id: "media-2", type: "mediaNode", position: { x: 0, y: 300 }, data: { assetId: directAssetId, mediaType: "image", src: "https://example.com/v2.png", fileName: "乙图" } },
      {
        id: "text-1", type: "textNode", position: { x: 400, y: 0 },
        data: {
          title: "文本",
          text: "用图片1出片",
          mediaMentions: [{ start: 1, end: 4, nodeId: "media-1", assetId: indexedAssetId }],
          mediaRefs: [{ nodeId: "media-1", assetId: indexedAssetId, mediaType: refMediaType, name: "甲素材", url: "https://example.com/v1.png" }],
        },
      },
    ];
    const edges = [
      { id: "e-text", source: "text-1", target: "gen-v" },
      { id: "e-direct", source: "media-2", target: "gen-v" },
      ...(options.dropIndexEdge ? [] : [{ id: "e-index", source: "media-1", target: "text-1", data: { textIndex: true } }]),
    ];
    await saveCanvas(projectId, nodes, edges, "missing");
    return { projectId, indexedAssetId, directAssetId };
  }
  const directVideoRefs = (directAssetId: string) => [{ role: "reference", asset_id: directAssetId, type: "image" }];

  it("视频权威并入：文本带入追加为普通参考，media 映射与签名冻结进快照", async () => {
    const { projectId, indexedAssetId, directAssetId } = await seedVideoIndexedCanvas("IKFM3W merge");
    const created = await createJob(projectId, videoJobBody("gen-v", "暮色", directVideoRefs(directAssetId)));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.references).toEqual([
      { role: "reference", asset_id: directAssetId, type: "image" },
      { role: "reference", asset_id: indexedAssetId, type: "image" },
    ]);
    expect(job!.input.text_attachments).toEqual([
      {
        node_id: "text-1",
        title: "文本",
        text: "用图片2出片",
        media: [{ node_id: "media-1", asset_id: indexedAssetId, media_type: "image" }],
      },
    ]);
    expect(job!.input.text_input_signature).toBe(
      textInputSignatureOf([
        { nodeId: "text-1", text: "用图片1出片", identities: [{ sourceNodeId: "media-1", assetId: indexedAssetId, mediaType: "image" }] },
      ]),
    );
  });

  it("视频 references 缺失时以文本带入新建单数组（无直接参考目标）", async () => {
    const project = await projects.create("987654", "IKFM3W create refs");
    const projectId = project.id;
    const indexedAssetId = await createAsset(projectId, "image", "https://example.com/vi.png");
    const nodes = [
      { id: "gen-v", type: "mediaNode", position: { x: 800, y: 0 }, data: { mediaType: "video", draft: true } },
      { id: "media-1", type: "mediaNode", position: { x: 0, y: 0 }, data: { assetId: indexedAssetId, mediaType: "image", src: "https://example.com/vi.png", fileName: "甲图" } },
      {
        id: "text-1", type: "textNode", position: { x: 400, y: 0 },
        data: {
          title: "文本", text: "用图片1出片",
          mediaMentions: [{ start: 1, end: 4, nodeId: "media-1", assetId: indexedAssetId }],
          mediaRefs: [{ nodeId: "media-1", assetId: indexedAssetId, mediaType: "image", name: "甲图", url: "https://example.com/vi.png" }],
        },
      },
    ];
    const edges = [
      { id: "e-text", source: "text-1", target: "gen-v" },
      { id: "e-index", source: "media-1", target: "text-1", data: { textIndex: true } },
    ];
    await saveCanvas(projectId, nodes, edges, "missing");
    const created = await createJob(projectId, videoJobBody("gen-v", "暮色"));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.references).toEqual([{ role: "reference", asset_id: indexedAssetId, type: "image" }]);
  });

  it("视频同源预演：references 已含文本素材时序不变；同 assetId 去重", async () => {
    const { projectId, indexedAssetId, directAssetId } = await seedVideoIndexedCanvas("IKFM3W premerged");
    const created = await createJob(projectId, videoJobBody("gen-v", "暮色", [
      { role: "reference", asset_id: directAssetId, type: "image" },
      { role: "reference", asset_id: indexedAssetId, type: "image" },
    ]));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.references).toEqual([
      { role: "reference", asset_id: directAssetId, type: "image" },
      { role: "reference", asset_id: indexedAssetId, type: "image" },
    ]);
  });

  it("视频失效索引（textIndex 关系线缺失）阻止发送且零建任务", async () => {
    const { projectId } = await seedVideoIndexedCanvas("IKFM3W invalid", { dropIndexEdge: true });
    const before = await jobCount(projectId);
    const created = await createJob(projectId, videoJobBody("gen-v", "暮色"));
    expect(created.code).toBe(1034);
    expect(created.msg).toBe("文本索引存在失效素材，请修复来源文本后提交");
    expect(await jobCount(projectId)).toBe(before);
  });

  it("视频首尾帧互斥：references 含 first_frame 且文本带入非空 → 400 阻止", async () => {
    const { projectId, directAssetId } = await seedVideoIndexedCanvas("IKFM3W frame");
    const before = await jobCount(projectId);
    const created = await createJob(projectId, videoJobBody("gen-v", "暮色", [
      { role: "first_frame", asset_id: directAssetId, type: "image" },
    ], VIDEO_MODEL_ID, "adaptive"));
    expect(created.code).toBe(1034);
    expect(created.msg).toBe(VIDEO_TEXT_INDEX_FRAME_CONFLICT_MESSAGE);
    expect(await jobCount(projectId)).toBe(before);
  });

  it("视频类型能力位：模型 video_reference 关时文本索引视频素材 → 400 阻止", async () => {
    const { projectId, directAssetId } = await seedVideoIndexedCanvas("IKFM3W novid", { refMediaType: "video" });
    const before = await jobCount(projectId);
    const created = await createJob(projectId, videoJobBody("gen-v", "暮色", directVideoRefs(directAssetId), VIDEO_NOVID_MODEL_ID));
    expect(created.code).toBe(1035);
    expect(created.msg).toBe("文本索引包含目标不支持的媒体类型，请修改来源文本");
    expect(await jobCount(projectId)).toBe(before);
  });

  it("视频分类超限：直接参考 + 文本带入图联算超 image_reference_max → 400", async () => {
    const { projectId, directAssetId } = await seedVideoIndexedCanvas("IKFM3W overflow");
    const before = await jobCount(projectId);
    const created = await createJob(projectId, videoJobBody("gen-v", "暮色", directVideoRefs(directAssetId), VIDEO_LIMIT_MODEL_ID));
    expect(created.code).toBe(1034);
    expect(created.msg).toBe("参考图最多 1 张");
    expect(await jobCount(projectId)).toBe(before);
  });

  it("混合目标独立处理：视频目标被帧互斥阻止不影响同文本连接的图片目标提交", async () => {
    const { projectId, directAssetId } = await seedVideoIndexedCanvas("IKFM3W mixed");
    const canvasRow = await prisma.client.canvas.findUnique({ where: { project_id: BigInt(projectId) } });
    const nodes = canvasRow!.nodes_json as unknown as unknown[];
    const edges = [
      ...(canvasRow!.edges_json as unknown as unknown[]),
      { id: "e-text-i", source: "text-1", target: "gen-i" },
    ];
    await saveCanvas(projectId, [...nodes, { id: "gen-i", type: "mediaNode", position: { x: 800, y: 400 }, data: { mediaType: "image", draft: true } }], edges, canvasRow!.version);
    const videoBlocked = await createJob(projectId, videoJobBody("gen-v", "暮色", [
      { role: "first_frame", asset_id: directAssetId, type: "image" },
    ], VIDEO_MODEL_ID, "adaptive"));
    expect(videoBlocked.code).toBe(1034);
    expect(videoBlocked.msg).toBe(VIDEO_TEXT_INDEX_FRAME_CONFLICT_MESSAGE);
    const imageOk = await createJob(projectId, imageJobBody("gen-i", "暮色"));
    expect(imageOk.code).toBe(200);
  });

  it("视频重试复用原快照：references、media 映射与签名原样复制，不重读画布", async () => {
    const { projectId, directAssetId } = await seedVideoIndexedCanvas("IKFM3W retry");
    const created = await createJob(projectId, videoJobBody("gen-v", "暮色", directVideoRefs(directAssetId)));
    expect(created.code).toBe(200);
    const original = await readJob(created.data.generation_job_id);
    const canvasRow = await prisma.client.canvas.findUnique({ where: { project_id: BigInt(projectId) } });
    const retryNodes = canvasRow!.nodes_json as unknown as Array<{ id: string; data: Record<string, unknown> }>;
    retryNodes.find((node) => node.id === "text-1")!.data.text = "提交后改的正文";
    await saveCanvas(projectId, retryNodes, canvasRow!.edges_json as unknown as unknown[], canvasRow!.version);
    await prisma.client.generation_output_slots.updateMany({
      where: { generation_job_id: BigInt(created.data.generation_job_id) },
      data: { status: "failed" },
    });
    await prisma.client.generation_jobs.update({ where: { id: BigInt(created.data.generation_job_id) }, data: { status: "failed" } });
    const retried = await fetch(`${base}/api/projects/${projectId}/generation-jobs/${created.data.generation_job_id}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": `ikfm3w-${created.data.generation_job_id}-${Date.now()}` },
      body: "{}",
    });
    const retryBody = (await retried.json()) as { code: number; data?: { generation_job_id: string } };
    expect(retryBody.code).toBe(200);
    const retryJob = await readJob(retryBody.data!.generation_job_id);
    expect(retryJob!.input.references).toEqual(original!.input.references);
    expect(retryJob!.input.text_attachments).toEqual(original!.input.text_attachments);
    expect(retryJob!.input.text_input_signature).toBe(original!.input.text_input_signature);
  });

  it("视频回归：普通文本连线（无媒体索引）不新建 references，签名覆盖正文", async () => {
    const project = await projects.create("987654", "IKFM3W plain");
    const projectId = project.id;
    const nodes = [
      { id: "gen-v", type: "mediaNode", position: { x: 800, y: 0 }, data: { mediaType: "video", draft: true } },
      { id: "text-1", type: "textNode", position: { x: 400, y: 0 }, data: { title: "文本", text: "赛博朋克" } },
    ];
    await saveCanvas(projectId, nodes, [{ id: "e1", source: "text-1", target: "gen-v" }], "missing");
    const created = await createJob(projectId, videoJobBody("gen-v", "暮色"));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.references).toBeUndefined();
    expect(job!.input.text_attachments).toEqual([{ node_id: "text-1", title: "文本", text: "赛博朋克" }]);
    expect(job!.input.text_input_signature).toBe(
      textInputSignatureOf([{ nodeId: "text-1", text: "赛博朋克", identities: [] }]),
    );
  });

  it("视频旧参考字段与文本带入并存 → 防御拒绝（新客户端一律走单数组）", async () => {
    const { projectId, directAssetId } = await seedVideoIndexedCanvas("IKFM3W legacy");
    const before = await jobCount(projectId);
    const created = await createJob(projectId, {
      type: "video",
      target_node_id: "gen-v",
      expected_output_count: 1,
      reference_asset_ids: [directAssetId],
      parameters: { prompt: "暮色", model_id: VIDEO_MODEL_ID, aspect_ratio: "1:1" },
    });
    expect(created.code).toBe(1034);
    expect(created.msg).toBe("文本带入参考与旧参考字段不能混用，请使用 references 提交");
    expect(await jobCount(projectId)).toBe(before);
  });

  it("视频文本带入素材被软删后提交被存在性复核拒绝；类型替换被类型复核拒绝", async () => {
    const { projectId, indexedAssetId, directAssetId } = await seedVideoIndexedCanvas("IKFM3W missing");
    await prisma.client.assets.update({ where: { id: BigInt(indexedAssetId) }, data: { is_delete: true } });
    const blocked = await createJob(projectId, videoJobBody("gen-v", "暮色", directVideoRefs(directAssetId)));
    expect(blocked.code).toBe(1034);
    expect(blocked.msg).toBe("参考素材不存在或无权访问");
    await prisma.client.assets.update({ where: { id: BigInt(indexedAssetId) }, data: { is_delete: false, type: "video" } });
    const mismatch = await createJob(projectId, videoJobBody("gen-v", "暮色", directVideoRefs(directAssetId)));
    expect(mismatch.code).toBe(1035);
    expect(mismatch.msg).toBe("参考素材类型与声明不符");
  });

  it.runIf(process.env.IKFM3S_BROWSER)("browser video: 锁定参考进视频面板、发送冻结、提示清除与重现", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFM3W browser")).id;
    const indexedAssetId = await createAsset(projectId, "image", "https://example.com/indexed.png");
    const directAssetId = await createAsset(projectId, "image", "https://example.com/direct.png");
    const nodes = [
      { id: "m1", type: "mediaNode", position: { x: 100, y: 80 }, data: { assetId: indexedAssetId, mediaType: "image", src: "https://example.com/indexed.png", fileName: "索引图" } },
      { id: "m2", type: "mediaNode", position: { x: 100, y: 320 }, data: { assetId: directAssetId, mediaType: "image", src: "https://example.com/direct.png", fileName: "直接图", materialId: "asset-ikfm3w-direct" } },
      { id: "t1", type: "textNode", position: { x: 520, y: 200 }, data: {
        title: "文案", text: "用图片1出片",
        mediaMentions: [{ start: 1, end: 4, nodeId: "m1", assetId: indexedAssetId }],
        mediaRefs: [{ nodeId: "m1", assetId: indexedAssetId, mediaType: "image", name: "索引图", url: "https://example.com/indexed.png" }],
      } },
      { id: "d1", type: "mediaNode", position: { x: 960, y: 120 }, data: { mediaType: "video", draft: true, fileName: "视频生成" } },
    ];
    const edges = [
      { id: "e-index", source: "m1", target: "t1", data: { textIndex: true } },
      { id: "e-direct", source: "m2", target: "d1" },
    ];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).version).toBeDefined();

    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
      const generationRequests: Array<Record<string, unknown>> = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && /\/api\/projects\/\d+\/generation-jobs$/.test(request.url())) {
          generationRequests.push(request.postDataJSON() as Record<string, unknown>);
        }
      });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      page.on("pageerror", (error) => console.log("[ikfm3w pageerror]", String(error).slice(0, 600)));
      page.on("console", (message) => {
        if (message.type() === "error") console.log("[ikfm3w console.error]", message.text().slice(0, 600));
      });
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      const nodeById = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
      const videoRefs = page.locator('[data-testid="dock-video-ref"]');
      const editor = page.locator('[contenteditable="true"]');
      const badge = page.locator('[data-testid="input-stale-badge"]');

      await nodeById("m1").waitFor();
      await nodeById("t1").waitFor();
      await nodeById("d1").waitFor();

      const src = page.locator('.react-flow__node[data-id="t1"] .react-flow__handle-right');
      const dst = page.locator('.react-flow__node[data-id="d1"] .react-flow__handle-left');
      const sb = (await src.boundingBox())!;
      const db = (await dst.boundingBox())!;
      await page.mouse.move(sb.x + sb.width * 0.75, sb.y + sb.height / 2);
      await page.mouse.down();
      await page.mouse.move(db.x + db.width * 0.25, db.y + db.height / 2, { steps: 24 });
      await page.mouse.up();
      await vi.waitFor(async () => expect(await badge.count(), "文本连线后视频目标显示输入已更新").toBe(1));
      await page.screenshot({ path: "/tmp/ikfm3w-badge.png", fullPage: true });

      await nodeById("d1").locator('[data-testid="media-content"]').click();
      await editor.waitFor();
      await vi.waitFor(async () => expect(await videoRefs.count(), "直接参考 + 文本带入参考").toBe(2));
      const locked = videoRefs.filter({ has: page.locator('button[title="此素材由文本索引提供，请修改来源文本"]') });
      const removable = videoRefs.filter({ has: page.locator('button[title="移除"]') });
      await vi.waitFor(async () => expect(await locked.count(), "文本带入条目锁定（定位入口）").toBe(1));
      await vi.waitFor(async () => expect(await removable.count(), "直接参考可移除").toBe(1));

      await editor.click();
      await page.keyboard.type("用这两张图出一段视频");
      await vi.waitFor(async () => {
        const sendBtn = page.locator('[data-testid="video-send"]');
        expect(await sendBtn.isDisabled(), `发送按钮不应禁用（title=${await sendBtn.getAttribute("title")}）`).toBe(false);
      });
      const acceptedResponse = page.waitForResponse((response) =>
        response.request().method() === "POST" && response.url().endsWith(`/api/projects/${projectId}/generation-jobs`));
      await page.locator('[data-testid="video-send"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 15_000 });
      expect(generationRequests[0].type).toBe("video");
      expect(generationRequests[0].target_node_id).toBe("d1");
      expect(generationRequests[0].references).toEqual([
        { role: "reference", material_id: "asset-ikfm3w-direct", type: "image" },
        { role: "reference", asset_id: indexedAssetId, type: "image" },
      ]);

      const response = await acceptedResponse;
      expect(response.ok()).toBe(true);
      const accepted = await response.json();
      expect(accepted.code).toBe(200);
      const jobRow = await prisma.client.generation_jobs.findUnique({ where: { id: BigInt(accepted.data.generation_job_id) } });
      expect(jobRow).not.toBeNull();
      const frozen = jobRow!.input as Record<string, unknown>;
      expect(frozen.references).toEqual([
        { role: "reference", material_id: "asset-ikfm3w-direct", type: "image" },
        { role: "reference", asset_id: indexedAssetId, type: "image" },
      ]);
      expect((frozen.text_attachments as Array<Record<string, unknown>>)[0]!.media).toEqual([
        { node_id: "m1", asset_id: indexedAssetId, media_type: "image" },
      ]);
      expect(typeof frozen.text_input_signature).toBe("string");
      const outputAsset = await prisma.client.assets.create({ data: { user_id: 987654n, project_id: BigInt(projectId), type: "video", url: "https://example.com/out.mp4", width: 640, height: 480 } });
      await prisma.client.generation_jobs.update({
        where: { id: jobRow!.id },
        data: { status: "succeeded", progress: 100, output_asset_ids: [outputAsset.id] },
      });
      await vi.waitFor(async () => expect(await badge.count(), "成功使用最新输入后清除提示").toBe(0), { timeout: 15_000 });
      await vi.waitFor(async () => {
        const canvas = await prisma.client.canvas.findUnique({ where: { project_id: BigInt(projectId) } });
        const saved = (canvas!.nodes_json as unknown as Array<{ id: string; data: Record<string, unknown> }>).find((n) => n.id === "d1");
        expect(saved!.data.usedInputSignature).toBe(frozen.text_input_signature);
        expect(saved!.data.usedInputJobId).toBe(Number(jobRow!.id));
      }, { timeout: 10_000 });

      const canvasRow = await prisma.client.canvas.findUnique({ where: { project_id: BigInt(projectId) } });
      const savedNodes = canvasRow!.nodes_json as unknown as Array<{ id: string; data: Record<string, unknown> }>;
      savedNodes.find((n) => n.id === "t1")!.data.text = "改用图片1出片吧";
      await saveCanvas(projectId, savedNodes, canvasRow!.edges_json as unknown as unknown[], canvasRow!.version);
      await page.reload();
      await nodeById("d1").waitFor();
      await vi.waitFor(async () => expect(await badge.count(), "正文变化后提示重现（刷新恢复）").toBe(1));
      await page.screenshot({ path: "/tmp/ikfm3w-badge-reappear.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 180_000);


  function audioJobBody(targetNodeId: string, prompt: string, references?: unknown[], modelId = AUDIO_MODEL_ID) {
    return {
      type: "audio",
      target_node_id: targetNodeId,
      expected_output_count: 1,
      ...(references ? { references } : {}),
      parameters: { prompt, model_id: modelId },
    };
  }

  async function seedAudioIndexedCanvas(
    projectName: string,
    options: { refMediaType?: "audio" | "image" | "video"; directMediaType?: "audio" | "image"; dropIndexEdge?: boolean; withImageMention?: boolean } = {},
  ) {
    const project = await projects.create("987654", projectName);
    const projectId = project.id;
    const refMediaType = options.refMediaType ?? "audio";
    const directMediaType = options.directMediaType ?? "audio";
    const indexedAssetId = await createAsset(projectId, refMediaType, "https://example.com/a1.mp3");
    const directAssetId = await createAsset(projectId, directMediaType, "https://example.com/a2.mp3");
    const imageAssetId = await createAsset(projectId, "image", "https://example.com/a3.png");
    const mentions = [{ start: 1, end: 4, nodeId: "media-1", assetId: indexedAssetId }];
    const mediaRefs = [{ nodeId: "media-1", assetId: indexedAssetId, mediaType: refMediaType, name: "甲音频", url: "https://example.com/a1.mp3" }];
    if (options.withImageMention) {
      mentions.push({ start: 6, end: 8, nodeId: "media-3", assetId: imageAssetId });
      mediaRefs.push({ nodeId: "media-3", assetId: imageAssetId, mediaType: "image", name: "丙图", url: "https://example.com/a3.png" });
    }
    const nodes = [
      { id: "gen-a", type: "mediaNode", position: { x: 800, y: 0 }, data: { mediaType: "audio", draft: true } },
      { id: "media-1", type: "mediaNode", position: { x: 0, y: 0 }, data: { assetId: indexedAssetId, mediaType: refMediaType, src: "https://example.com/a1.mp3", fileName: "甲音频" } },
      { id: "media-2", type: "mediaNode", position: { x: 0, y: 300 }, data: { assetId: directAssetId, mediaType: directMediaType, src: "https://example.com/a2.mp3", fileName: "乙音频" } },
      ...(options.withImageMention
        ? [{ id: "media-3", type: "mediaNode", position: { x: 0, y: 600 }, data: { assetId: imageAssetId, mediaType: "image", src: "https://example.com/a3.png", fileName: "丙图" } }]
        : []),
      {
        id: "text-1", type: "textNode", position: { x: 400, y: 0 },
        data: {
          title: "文本",
          text: options.withImageMention ? "用音频1配音图2一起" : "用音频1配音",
          mediaMentions: mentions,
          mediaRefs,
        },
      },
    ];
    const edges = [
      { id: "e-text", source: "text-1", target: "gen-a" },
      { id: "e-direct", source: "media-2", target: "gen-a" },
      ...(options.withImageMention ? [{ id: "e-index-3", source: "media-3", target: "text-1", data: { textIndex: true } }] : []),
      ...(options.dropIndexEdge ? [] : [{ id: "e-index", source: "media-1", target: "text-1", data: { textIndex: true } }]),
    ];
    await saveCanvas(projectId, nodes, edges, "missing");
    return { projectId, indexedAssetId, directAssetId, imageAssetId };
  }
  const directAudioRefs = (directAssetId: string) => [{ role: "reference", asset_id: directAssetId, type: "audio" }];

  it("音频权威并入：文本带入追加为普通参考，media 映射与签名冻结进快照", async () => {
    const { projectId, indexedAssetId, directAssetId } = await seedAudioIndexedCanvas("IKFM41 merge");
    const created = await createJob(projectId, audioJobBody("gen-a", "暮色背景音", directAudioRefs(directAssetId)));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.references).toEqual([
      { role: "reference", asset_id: directAssetId, type: "audio" },
      { role: "reference", asset_id: indexedAssetId, type: "audio" },
    ]);
    expect(job!.input.text_attachments).toEqual([
      {
        node_id: "text-1",
        title: "文本",
        text: "用音频2配音",
        media: [{ node_id: "media-1", asset_id: indexedAssetId, media_type: "audio" }],
      },
    ]);
    expect(job!.input.text_input_signature).toBe(
      textInputSignatureOf([
        { nodeId: "text-1", text: "用音频1配音", identities: [{ sourceNodeId: "media-1", assetId: indexedAssetId, mediaType: "audio" }] },
      ]),
    );
  });

  it("音频 references 缺失时以文本带入新建单数组（无直接参考目标）", async () => {
    const project = await projects.create("987654", "IKFM41 create refs");
    const projectId = project.id;
    const indexedAssetId = await createAsset(projectId, "audio", "https://example.com/ai.mp3");
    const nodes = [
      { id: "gen-a", type: "mediaNode", position: { x: 800, y: 0 }, data: { mediaType: "audio", draft: true } },
      { id: "media-1", type: "mediaNode", position: { x: 0, y: 0 }, data: { assetId: indexedAssetId, mediaType: "audio", src: "https://example.com/ai.mp3", fileName: "甲音频" } },
      {
        id: "text-1", type: "textNode", position: { x: 400, y: 0 },
        data: {
          title: "文本", text: "用音频1配音",
          mediaMentions: [{ start: 1, end: 4, nodeId: "media-1", assetId: indexedAssetId }],
          mediaRefs: [{ nodeId: "media-1", assetId: indexedAssetId, mediaType: "audio", name: "甲音频", url: "https://example.com/ai.mp3" }],
        },
      },
    ];
    const edges = [
      { id: "e-text", source: "text-1", target: "gen-a" },
      { id: "e-index", source: "media-1", target: "text-1", data: { textIndex: true } },
    ];
    await saveCanvas(projectId, nodes, edges, "missing");
    const created = await createJob(projectId, audioJobBody("gen-a", "暮色背景音"));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.references).toEqual([{ role: "reference", asset_id: indexedAssetId, type: "audio" }]);
  });

  it("音频同源预演：references 已含文本素材时序不变；同 assetId 去重", async () => {
    const { projectId, indexedAssetId, directAssetId } = await seedAudioIndexedCanvas("IKFM41 premerged");
    const created = await createJob(projectId, audioJobBody("gen-a", "暮色背景音", [
      { role: "reference", asset_id: directAssetId, type: "audio" },
      { role: "reference", asset_id: indexedAssetId, type: "audio" },
    ]));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.references).toEqual([
      { role: "reference", asset_id: directAssetId, type: "audio" },
      { role: "reference", asset_id: indexedAssetId, type: "audio" },
    ]);
  });

  it("音频失效索引（textIndex 关系线缺失）阻止发送且零建任务", async () => {
    const { projectId } = await seedAudioIndexedCanvas("IKFM41 invalid", { dropIndexEdge: true });
    const before = await jobCount(projectId);
    const created = await createJob(projectId, audioJobBody("gen-a", "暮色背景音"));
    expect(created.code).toBe(1034);
    expect(created.msg).toBe("文本索引存在失效素材，请修复来源文本后提交");
    expect(await jobCount(projectId)).toBe(before);
  });

  it("音频不支持类型：文本索引视频素材进音频目标 → 400 阻止（不静默丢素材）", async () => {
    const { projectId } = await seedAudioIndexedCanvas("IKFM41 unsupported", { refMediaType: "video" });
    const before = await jobCount(projectId);
    const created = await createJob(projectId, audioJobBody("gen-a", "暮色背景音"));
    expect(created.code).toBe(1035);
    expect(created.msg).toBe("文本索引包含目标不支持的媒体类型，请修改来源文本");
    expect(await jobCount(projectId)).toBe(before);
  });

  it("音频与图片不可混用：文本带入内混用 → 400 阻止", async () => {
    const { projectId } = await seedAudioIndexedCanvas("IKFM41 mix refs", { withImageMention: true });
    const before = await jobCount(projectId);
    const created = await createJob(projectId, audioJobBody("gen-a", "暮色背景音"));
    expect(created.code).toBe(1034);
    expect(created.msg).toBe("音频与图片参考不可混用");
    expect(await jobCount(projectId)).toBe(before);
  });

  it("音频与图片不可混用：文本带入音频 + 直接参考图片跨来源混用 → 400 阻止", async () => {
    const { projectId, directAssetId } = await seedAudioIndexedCanvas("IKFM41 mix direct", { directMediaType: "image" });
    const before = await jobCount(projectId);
    const created = await createJob(projectId, audioJobBody("gen-a", "暮色背景音", [
      { role: "reference", asset_id: directAssetId, type: "image" },
    ]));
    expect(created.code).toBe(1034);
    expect(created.msg).toBe("音频与图片参考不可混用");
    expect(await jobCount(projectId)).toBe(before);
  });

  it("音频分类超限：直接参考 + 文本带入联算超 audio_reference_max → 400", async () => {
    const { projectId, directAssetId } = await seedAudioIndexedCanvas("IKFM41 overflow");
    const before = await jobCount(projectId);
    const created = await createJob(projectId, audioJobBody("gen-a", "暮色背景音", directAudioRefs(directAssetId), AUDIO_LIMIT_MODEL_ID));
    expect(created.code).toBe(1034);
    expect(created.msg).toBe("参考音频最多 1 个");
    expect(await jobCount(projectId)).toBe(before);
  });

  it("混合目标独立处理：同文本音频素材音频目标正常、图片目标分别报错（不静默丢素材）", async () => {
    const { projectId } = await seedAudioIndexedCanvas("IKFM41 mixed targets");
    const canvasRow = await prisma.client.canvas.findUnique({ where: { project_id: BigInt(projectId) } });
    const nodes = canvasRow!.nodes_json as unknown as unknown[];
    const edges = [
      ...(canvasRow!.edges_json as unknown as unknown[]),
      { id: "e-text-i", source: "text-1", target: "gen-i" },
    ];
    await saveCanvas(projectId, [...nodes, { id: "gen-i", type: "mediaNode", position: { x: 800, y: 400 }, data: { mediaType: "image", draft: true } }], edges, canvasRow!.version);
    const audioOk = await createJob(projectId, audioJobBody("gen-a", "暮色背景音"));
    expect(audioOk.code).toBe(200);
    const imageBlocked = await createJob(projectId, imageJobBody("gen-i", "暮色"));
    expect(imageBlocked.code).toBe(1035);
    expect(imageBlocked.msg).toBe("文本索引包含目标不支持的媒体类型，请修改来源文本");
  });

  it("断开文本→音频目标连线仅解除该来源：文本带入消失、直接参考与素材卡保留", async () => {
    const { projectId, indexedAssetId, directAssetId } = await seedAudioIndexedCanvas("IKFM41 unlink");
    const canvasRow = await prisma.client.canvas.findUnique({ where: { project_id: BigInt(projectId) } });
    const keptEdges = (canvasRow!.edges_json as unknown as Array<{ id: string }>).filter((edge) => edge.id !== "e-text");
    await saveCanvas(projectId, canvasRow!.nodes_json as unknown as unknown[], keptEdges, canvasRow!.version);
    const created = await createJob(projectId, audioJobBody("gen-a", "暮色背景音", directAudioRefs(directAssetId)));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.references).toEqual([{ role: "reference", asset_id: directAssetId, type: "audio" }]);
    expect(job!.input.text_attachments).toEqual([]);
    expect(job!.input.text_input_signature).toBeUndefined();
    const after = await prisma.client.canvas.findUnique({ where: { project_id: BigInt(projectId) } });
    const nodeIds = (after!.nodes_json as unknown as Array<{ id: string }>).map((node) => node.id);
    expect(nodeIds).toContain("media-1");
    expect(nodeIds).toContain("text-1");
    expect(JSON.stringify(job!.input.references)).not.toContain(indexedAssetId);
  });

  it("音频重试复用原快照：references、media 映射与签名原样复制，不重读画布", async () => {
    const { projectId, directAssetId } = await seedAudioIndexedCanvas("IKFM41 retry");
    const created = await createJob(projectId, audioJobBody("gen-a", "暮色背景音", directAudioRefs(directAssetId)));
    expect(created.code).toBe(200);
    const original = await readJob(created.data.generation_job_id);
    const canvasRow = await prisma.client.canvas.findUnique({ where: { project_id: BigInt(projectId) } });
    const retryNodes = canvasRow!.nodes_json as unknown as Array<{ id: string; data: Record<string, unknown> }>;
    retryNodes.find((node) => node.id === "text-1")!.data.text = "提交后改的正文";
    await saveCanvas(projectId, retryNodes, canvasRow!.edges_json as unknown as unknown[], canvasRow!.version);
    await prisma.client.generation_output_slots.updateMany({
      where: { generation_job_id: BigInt(created.data.generation_job_id) },
      data: { status: "failed" },
    });
    await prisma.client.generation_jobs.update({ where: { id: BigInt(created.data.generation_job_id) }, data: { status: "failed" } });
    const retried = await fetch(`${base}/api/projects/${projectId}/generation-jobs/${created.data.generation_job_id}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": `ikfm41-${created.data.generation_job_id}-${Date.now()}` },
      body: "{}",
    });
    const retryBody = (await retried.json()) as { code: number; data?: { generation_job_id: string } };
    expect(retryBody.code).toBe(200);
    const retryJob = await readJob(retryBody.data!.generation_job_id);
    expect(retryJob!.input.references).toEqual(original!.input.references);
    expect(retryJob!.input.text_attachments).toEqual(original!.input.text_attachments);
    expect(retryJob!.input.text_input_signature).toBe(original!.input.text_input_signature);
  });

  it("音频回归：普通文本连线（无媒体索引）不新建 references，创作上下文与签名照旧", async () => {
    const project = await projects.create("987654", "IKFM41 plain");
    const projectId = project.id;
    const nodes = [
      { id: "gen-a", type: "mediaNode", position: { x: 800, y: 0 }, data: { mediaType: "audio", draft: true } },
      { id: "text-1", type: "textNode", position: { x: 400, y: 0 }, data: { title: "文本", text: "赛博朋克" } },
    ];
    await saveCanvas(projectId, nodes, [{ id: "e1", source: "text-1", target: "gen-a" }], "missing");
    const created = await createJob(projectId, audioJobBody("gen-a", "赛博朋克"));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.references).toBeUndefined();
    expect(job!.input.text_attachments).toEqual([{ node_id: "text-1", title: "文本", text: "赛博朋克" }]);
    expect(job!.input.text_input_signature).toBe(
      textInputSignatureOf([{ nodeId: "text-1", text: "赛博朋克", identities: [] }]),
    );
  });

  it("音频文本带入素材被软删后提交被存在性复核拒绝；类型替换被类型复核拒绝", async () => {
    const { projectId, indexedAssetId, directAssetId } = await seedAudioIndexedCanvas("IKFM41 missing");
    await prisma.client.assets.update({ where: { id: BigInt(indexedAssetId) }, data: { is_delete: true } });
    const blocked = await createJob(projectId, audioJobBody("gen-a", "暮色背景音", directAudioRefs(directAssetId)));
    expect(blocked.code).toBe(1034);
    expect(blocked.msg).toBe("参考素材不存在或无权访问");
    await prisma.client.assets.update({ where: { id: BigInt(indexedAssetId) }, data: { is_delete: false, type: "video" } });
    const mismatch = await createJob(projectId, audioJobBody("gen-a", "暮色背景音", directAudioRefs(directAssetId)));
    expect(mismatch.code).toBe(1035);
    expect(mismatch.msg).toBe("参考素材类型与声明不符");
  });

  it.runIf(process.env.IKFM3S_BROWSER)("browser audio: 锁定参考进音频面板、发送冻结、提示清除与重现", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFM41 browser")).id;
    const indexedAssetId = await createAsset(projectId, "audio", "https://example.com/indexed.mp3");
    const directAssetId = await createAsset(projectId, "audio", "https://example.com/direct.mp3");
    const nodes = [
      { id: "m1", type: "mediaNode", position: { x: 100, y: 80 }, data: { assetId: indexedAssetId, mediaType: "audio", src: "https://example.com/indexed.mp3", fileName: "索引音频" } },
      { id: "m2", type: "mediaNode", position: { x: 100, y: 320 }, data: { assetId: directAssetId, mediaType: "audio", src: "https://example.com/direct.mp3", fileName: "直接音频" } },
      { id: "t1", type: "textNode", position: { x: 520, y: 200 }, data: {
        title: "文案", text: "用音频1配音",
        mediaMentions: [{ start: 1, end: 4, nodeId: "m1", assetId: indexedAssetId }],
        mediaRefs: [{ nodeId: "m1", assetId: indexedAssetId, mediaType: "audio", name: "索引音频", url: "https://example.com/indexed.mp3" }],
      } },
      { id: "d1", type: "mediaNode", position: { x: 960, y: 120 }, data: { mediaType: "audio", draft: true, fileName: "音频生成" } },
    ];
    const edges = [
      { id: "e-index", source: "m1", target: "t1", data: { textIndex: true } },
      { id: "e-direct", source: "m2", target: "d1" },
    ];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).version).toBeDefined();

    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
      const generationRequests: Array<Record<string, unknown>> = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && /\/api\/projects\/\d+\/generation-jobs$/.test(request.url())) {
          generationRequests.push(request.postDataJSON() as Record<string, unknown>);
        }
      });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      page.on("pageerror", (error) => console.log("[ikfm41 pageerror]", String(error).slice(0, 600)));
      page.on("console", (message) => {
        if (message.type() === "error") console.log("[ikfm41 console.error]", message.text().slice(0, 600));
      });
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      const nodeById = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
      const audioRefs = page.locator('[data-testid="audio-ref-thumb"]');
      const editor = page.locator('[data-testid="audio-input"] [contenteditable="true"]');
      const badge = page.locator('[data-testid="input-stale-badge"]');

      await nodeById("m1").waitFor();
      await nodeById("t1").waitFor();
      await nodeById("d1").waitFor();

      const src = page.locator('.react-flow__node[data-id="t1"] .react-flow__handle-right');
      const dst = page.locator('.react-flow__node[data-id="d1"] .react-flow__handle-left');
      const sb = (await src.boundingBox())!;
      const db = (await dst.boundingBox())!;
      await page.mouse.move(sb.x + sb.width * 0.75, sb.y + sb.height / 2);
      await page.mouse.down();
      await page.mouse.move(db.x + db.width * 0.25, db.y + db.height / 2, { steps: 24 });
      await page.mouse.up();
      await vi.waitFor(async () => expect(await badge.count(), "文本连线后音频目标显示输入已更新").toBe(1));
      await page.screenshot({ path: "/tmp/ikfm41-badge.png", fullPage: true });

      await nodeById("d1").locator('[data-testid="media-content"]').click();
      await editor.waitFor();
      await vi.waitFor(async () => expect(await audioRefs.count(), "直接参考 + 文本带入参考").toBe(2));
      const locked = audioRefs.filter({ has: page.locator('button[title="此素材由文本索引提供，请修改来源文本"]') });
      const removable = audioRefs.filter({ has: page.locator('button[title="移除"]') });
      await vi.waitFor(async () => expect(await locked.count(), "文本带入条目锁定（定位入口）").toBe(1));
      await vi.waitFor(async () => expect(await removable.count(), "直接参考可移除").toBe(1));

      await editor.click();
      await page.keyboard.type("用这两段音频出一段配乐");
      await vi.waitFor(async () => {
        const sendBtn = page.locator('[data-testid="audio-send"]');
        expect(await sendBtn.isDisabled(), `发送按钮不应禁用（title=${await sendBtn.getAttribute("title")}）`).toBe(false);
      });
      const acceptedResponse = page.waitForResponse((response) =>
        response.request().method() === "POST" && response.url().endsWith(`/api/projects/${projectId}/generation-jobs`));
      await page.locator('[data-testid="audio-send"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 15_000 });
      expect(generationRequests[0].type).toBe("audio");
      expect(generationRequests[0].target_node_id).toBe("d1");
      expect(generationRequests[0].references).toEqual([
        { role: "reference", asset_id: directAssetId, type: "audio" },
        { role: "reference", asset_id: indexedAssetId, type: "audio" },
      ]);

      const response = await acceptedResponse;
      expect(response.ok()).toBe(true);
      const accepted = await response.json();
      expect(accepted.code).toBe(200);
      const jobRow = await prisma.client.generation_jobs.findUnique({ where: { id: BigInt(accepted.data.generation_job_id) } });
      expect(jobRow).not.toBeNull();
      const frozen = jobRow!.input as Record<string, unknown>;
      expect(frozen.references).toEqual([
        { role: "reference", asset_id: directAssetId, type: "audio" },
        { role: "reference", asset_id: indexedAssetId, type: "audio" },
      ]);
      expect((frozen.text_attachments as Array<Record<string, unknown>>)[0]!.media).toEqual([
        { node_id: "m1", asset_id: indexedAssetId, media_type: "audio" },
      ]);
      expect(typeof frozen.text_input_signature).toBe("string");
      const outputAsset = await prisma.client.assets.create({ data: { user_id: 987654n, project_id: BigInt(projectId), type: "audio", url: "https://example.com/out.mp3", width: 640, height: 480 } });
      await prisma.client.generation_jobs.update({
        where: { id: jobRow!.id },
        data: { status: "succeeded", progress: 100, output_asset_ids: [outputAsset.id] },
      });
      await vi.waitFor(async () => expect(await badge.count(), "成功使用最新输入后清除提示").toBe(0), { timeout: 15_000 });
      await vi.waitFor(async () => {
        const canvas = await prisma.client.canvas.findUnique({ where: { project_id: BigInt(projectId) } });
        const saved = (canvas!.nodes_json as unknown as Array<{ id: string; data: Record<string, unknown> }>).find((n) => n.id === "d1");
        expect(saved!.data.usedInputSignature).toBe(frozen.text_input_signature);
        expect(saved!.data.usedInputJobId).toBe(Number(jobRow!.id));
      }, { timeout: 10_000 });

      const canvasRow = await prisma.client.canvas.findUnique({ where: { project_id: BigInt(projectId) } });
      const savedNodes = canvasRow!.nodes_json as unknown as Array<{ id: string; data: Record<string, unknown> }>;
      savedNodes.find((n) => n.id === "t1")!.data.text = "改用音频1配音吧";
      await saveCanvas(projectId, savedNodes, canvasRow!.edges_json as unknown as unknown[], canvasRow!.version);
      await page.reload();
      await nodeById("d1").waitFor();
      await vi.waitFor(async () => expect(await badge.count(), "正文变化后提示重现（刷新恢复）").toBe(1));
      await page.screenshot({ path: "/tmp/ikfm41-badge-reappear.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 180_000);
});
