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
import { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { createWorkerRepo } from "@lib/shared/persistence/generation-worker-repo.js";
import { runVideoJobStep, type VideoTaskProvider } from "@lib/shared/generation-runtime/video-job-runner.js";
import { processImageJobById } from "@lib/shared/generation/worker/generation-worker.js";
import { ImageProviderError, type GenerateImageInput } from "@lib/shared/generation/worker/image-provider.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";
import { GenerationCommandService } from "@lib/shared/generation/generation-command.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { GenerationCostEstimatorService } from "@lib/shared/generation/cost-estimator.service.js";

// IKFA1P「文本附件索引与图文上下文生成」公开接口集成：
// 真 NestFactory 挂载生产 Canvas/Generation 控制器与服务 + 隔离 MySQL（IKFA1P_DATABASE_URL 门控）。
// 链路：画布 textNode 连线 → POST generation-jobs（prompt_doc 含 text_ref）→ 接纳当下读取来源最新文字
// → 编译 文本N → 冻结 text_attachments / composed_prompt 编号清单 → worker 记录式供应商 → 重试消费原快照。
// IKFA1P_BROWSER=1：真实浏览器 → 面板 @ 插入文本标签 → 发送 → worker → 供应商（生图+生视频）→ 改来源 → 重试。
describe.skipIf(!process.env.IKFA1P_DATABASE_URL)("Text attachment prompt ref doc public API (IKFA1P)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const IMAGE_MODEL = "seedream-ikfa1p";
  const VIDEO_MODEL = "doubao-seedance-2-0-ikfa1p";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKFA1P_DATABASE_URL;
    vi.stubEnv("ROCKETMQ_ENDPOINTS", "");
    const imageFeatures = { reference_image: true, max_reference_images: 9 };
    const videoFeatures = { reference_image: true, max_reference_images: 9, first_frame: true, last_frame: true, first_last_frame: true };
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikfa1p-test", model_id: IMAGE_MODEL } },
      create: {
        provider_id: "ikfa1p-test", model_id: IMAGE_MODEL, capability_type: "image", model_label: "IKFA1P Image",
        supported_sizes: [{ id: "2k", label: "2K", api_value: "2k" }], supported_aspect_ratios: ["1:1"], supported_formats: ["png"],
        default_size: "2k", default_aspect_ratio: "1:1", default_duration: null, features: imageFeatures,
      },
      update: { features: imageFeatures },
    });
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikfa1p-test", model_id: VIDEO_MODEL } },
      create: {
        provider_id: "ikfa1p-test", model_id: VIDEO_MODEL, capability_type: "video", model_label: "IKFA1P Video",
        supported_sizes: [{ id: "720p", label: "720p", api_value: "720p" }], supported_aspect_ratios: ["16:9"], supported_formats: ["mp4"],
        default_size: "720p", default_aspect_ratio: "16:9", default_duration: 5,
        supported_durations: { min: 4, max: 12, step: 1 }, features: videoFeatures,
      },
      update: { features: videoFeatures },
    });
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, GenerationCostEstimatorService, CanvasService], GenerationJobsController);
    Reflect.defineMetadata("design:paramtypes", [ModelCapabilityReadService], GenerationModelsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
    Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
    class HarnessModule {}
    Module({ controllers: [CanvasesController, GenerationJobsController, GenerationModelsController, ProjectsController, JobsController], providers: [
      { provide: JobsService, useValue: new JobsService(prisma, projects) },
      { provide: CanvasService, useValue: canvasService },
      { provide: ProjectService, useValue: projects },
      { provide: PrismaService, useValue: prisma },
      { provide: SnapshotService, useValue: new SnapshotService(prisma) },
      { provide: GenerationCommandService, useValue: new GenerationCommandService(prisma) },
      { provide: ModelCapabilityReadService, useValue: new ModelCapabilityReadService(prisma) },
      { provide: GenerationCostEstimatorService, useValue: new GenerationCostEstimatorService() },
    ] })(HarnessModule);
    app = await NestFactory.create(HarnessModule, { logger: false, bodyParser: false });
    // 配额门（IKBD2Q）：放行充足配额，避免 harness 404 被当 0 拦截
    app.use("/api/usage/token", (req: { method?: string }, res: { json: (body: unknown) => void }, next: () => void) => {
      if (req.method === "GET") {
        res.json({ code: 200, data: { quota: 50_000_000 } });
        return;
      }
      next();
    });
    app.use(json({ limit: "16mb" }));
    app.setGlobalPrefix("api");
    app.use((req: { user: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
      req.user = { userId: "987654" };
      req.headers.authorization = "Bearer sk-ikfa1p-recording-provider";
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
    vi.unstubAllEnvs();
  });

  async function createAsset(projectId: string, name: string, type: "image" | "video") {
    const asset = await prisma.client.assets.create({
      data: {
        user_id: BigInt(987654),
        project_id: BigInt(projectId),
        type,
        url: `https://example.com/${name}.${type === "image" ? "png" : "mp4"}`,
        ...(type === "image" ? { width: 1024, height: 1024 } : {}),
        size: BigInt(2048),
      },
    });
    return asset.id.toString();
  }
  async function createJob(projectId: string, body: unknown) {
    const response = await fetch(`${base}/api/projects/${projectId}/generation-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-ikfa1p-test" },
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

  /** 落画布：image 草稿目标 + 图片参考 + 3 个文本附件（风格/运镜/空白） */
  async function seedImageCanvas(projectId: string, imgAsset: string) {
    const nodes = [
      { id: "draft-1", type: "mediaNode", position: { x: 900, y: 120 }, data: { mediaType: "image", fileName: "图片草稿", draft: true, genStatus: "draft", prompt: "" } },
      { id: "ref-img", type: "mediaNode", position: { x: 140, y: 60 }, data: { mediaType: "image", fileName: "角色图", assetId: imgAsset, width: 1024, height: 1024 } },
      { id: "text-style", type: "textNode", position: { x: 140, y: 300 }, data: { title: "风格要求", text: "赛博朋克，霓虹灯" } },
      { id: "text-pose", type: "textNode", position: { x: 140, y: 480 }, data: { title: "姿势说明", text: "站立微笑" } },
      { id: "text-blank", type: "textNode", position: { x: 140, y: 660 }, data: { title: "空白草稿", text: "   " } },
    ];
    const edges = [
      { id: "e-img", source: "ref-img", target: "draft-1" },
      { id: "e-style", source: "text-style", target: "draft-1" },
      { id: "e-pose", source: "text-pose", target: "draft-1" },
      { id: "e-blank", source: "text-blank", target: "draft-1" },
    ];
    const saved = await (await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"missing"' },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges), viewport: "{}" }),
    })).status;
    expect(saved).toBe(200);
    return { nodes, edges };
  }

  function imageBody(inputAssetIds: string[], promptDoc: unknown) {
    return {
      type: "image",
      target_node_id: "draft-1",
      expected_output_count: 1,
      input_asset_ids: inputAssetIds.map(Number),
      parameters: { prompt: "按文本1生成", model_id: IMAGE_MODEL, aspect_ratio: "1:1", size: "2k" },
      prompt_doc: promptDoc,
    };
  }

  it("生图：文本附件接纳当下读取最新文字，编译 文本N，composed_prompt 冻结编号清单（D2/空白占位/未提及沿既有语义）", async () => {
    const projectId = (await projects.create("987654", "IKFA1P image doc")).id;
    const img = await createAsset(projectId, "role", "image");
    await seedImageCanvas(projectId, img);
    const doc = {
      version: 1,
      segments: [
        { kind: "text", text: "按" },
        { kind: "text_ref", node_id: "text-style", label: "文本1" },
        { kind: "text", text: "修改" },
        { kind: "asset_ref", asset_id: img, label: "图片1" },
      ],
    };
    const created = await createJob(projectId, imageBody([img], doc));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    // 编号跟附件顺序（text-style=文本1、text-pose=文本2、text-blank=文本3）
    expect(job!.input.prompt).toBe("按文本1修改图片1");
    expect(job!.input.prompt_doc).toEqual(doc);
    expect(job!.input.text_attachments).toEqual([
      { node_id: "text-style", title: "风格要求", text: "赛博朋克，霓虹灯" },
      { node_id: "text-pose", title: "姿势说明", text: "站立微笑" },
      { node_id: "text-blank", title: "空白草稿", text: "   " },
    ]);
    // 编号清单：全部附件按序进入（空白保留占位、未提及项沿既有语义输入），正文追加最后
    expect(job!.input.composed_prompt).toBe(
      "文本1：赛博朋克，霓虹灯\n\n文本2：站立微笑\n\n文本3：   \n\n按文本1修改图片1",
    );
  });

  it("生图改来源再提交：新任务使用来源最新完整文字（D2）", async () => {
    const projectId = (await projects.create("987654", "IKFA1P latest source")).id;
    const img = await createAsset(projectId, "role2", "image");
    const { nodes, edges } = await seedImageCanvas(projectId, img);
    const doc = {
      version: 1,
      segments: [{ kind: "text_ref", node_id: "text-style", label: "文本1" }],
    };
    const first = await createJob(projectId, imageBody([img], doc));
    expect(first.code).toBe(200);
    // 修改来源文本节点内容后重新提交：接纳当下读取最新文字
    const row = await prisma.client.canvas.findFirst({ where: { project_id: BigInt(projectId) } });
    const updatedNodes = nodes.map((n) =>
      n.id === "text-style" ? { ...n, data: { ...n.data, text: "水彩风格，柔光" } } : n);
    await (await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": `"${row!.version}"` },
      body: JSON.stringify({ nodes: JSON.stringify(updatedNodes), edges: JSON.stringify(edges), viewport: "{}" }),
    })).json();
    const second = await createJob(projectId, imageBody([img], doc));
    expect(second.code).toBe(200);
    const job = await readJob(second.data.generation_job_id);
    expect(job!.input.text_attachments[0]).toEqual({ node_id: "text-style", title: "风格要求", text: "水彩风格，柔光" });
    expect(job!.input.composed_prompt).toContain("文本1：水彩风格，柔光");
  });

  it("生图 worker：供应商正文 = composed_prompt 编号清单（不只发送文本1字样）", async () => {
    const projectId = (await projects.create("987654", "IKFA1P image worker")).id;
    const img = await createAsset(projectId, "role3", "image");
    await seedImageCanvas(projectId, img);
    const doc = {
      version: 1,
      segments: [
        { kind: "text", text: "按" },
        { kind: "text_ref", node_id: "text-style", label: "文本1" },
        { kind: "text", text: "生成" },
      ],
    };
    const created = await createJob(projectId, imageBody([img], doc));
    expect(created.code).toBe(200);
    const jobId = created.data.generation_job_id as string;
    const providerRequests: GenerateImageInput[] = [];
    const worker = {
      repo: createWorkerRepo(prisma.client),
      workerId: "ikfa1p-image-worker",
      credentialVault: { open: (token: string) => token },
      createImageProvider: () => ({
        generate: async (input: GenerateImageInput) => {
          providerRequests.push(structuredClone(input));
          return [{ url: "https://example.com/ikfa1p-out.png", width: 1024, height: 1024 }];
        },
      }),
    } as const;
    await vi.waitFor(async () => expect(await processImageJobById(jobId, worker)).toBe(jobId), { timeout: 15_000 });
    expect(providerRequests).toHaveLength(1);
    expect(providerRequests[0].prompt).toBe("文本1：赛博朋克，霓虹灯\n\n文本2：站立微笑\n\n文本3：   \n\n按文本1生成");
    const job = await readJob(jobId);
    expect(job!.status).toBe("succeeded");
  });

  it("文本身份不在附件集合 / 未携带 target_node_id / 失效标签 → 400 且零任务（D4）", async () => {
    const projectId = (await projects.create("987654", "IKFA1P bad text ref")).id;
    const img = await createAsset(projectId, "bad", "image");
    await seedImageCanvas(projectId, img);

    const unknownNode = await createJob(projectId, imageBody([img], {
      version: 1,
      segments: [{ kind: "text_ref", node_id: "text-gone" }],
    }));
    expect(unknownNode.code).toBe(400);
    expect(unknownNode.msg).toBe("正文文本标签指向无效的文本附件");

    const noTarget = await createJob(projectId, {
      ...imageBody([img], { version: 1, segments: [{ kind: "text_ref", node_id: "text-style" }] }),
      target_node_id: undefined,
    });
    expect(noTarget.code).toBe(400);
    expect(noTarget.msg).toBe("正文文本标签指向无效的文本附件");

    const invalidTag = await createJob(projectId, imageBody([img], {
      version: 1,
      segments: [{ kind: "text_ref", node_id: "text-style", invalid_label: "文本1" }],
    }));
    expect(invalidTag.code).toBe(400);
    expect(invalidTag.msg).toBe("存在已失效的素材标签，请删除后再提交");

    expect(await jobCount(projectId)).toBe(0);
  });

  it("方案附件 + 文本标签共存：providerPrompt 按编号清单组合，方案标签替换保持既有约束（D5 文本）", async () => {
    const projectId = (await projects.create("987654", "IKFA1P plan with text ref")).id;
    const img = await createAsset(projectId, "plan-ref", "image");
    const nodes = [
      { id: "draft-1", type: "mediaNode", position: { x: 900, y: 120 }, data: { mediaType: "image", fileName: "图片草稿", draft: true, genStatus: "draft", prompt: "" } },
      { id: "ref-img", type: "mediaNode", position: { x: 140, y: 60 }, data: { mediaType: "image", fileName: "角色图", assetId: img, src: `https://example.com/plan-ref.png` } },
      {
        id: "plan-node", type: "textNode", position: { x: 140, y: 300 },
        data: {
          title: "分镜方案",
          text: "XX出镜",
          promptSource: { sessionId: "ikfa1p-session", revisionId: "rev-1", shotNo: 1 },
          promptMentions: [{ start: 0, end: 2, index: 1, assetId: img }],
          promptMaterials: [{ assetId: img, mediaType: "image" }],
        },
      },
      { id: "plain-node", type: "textNode", position: { x: 140, y: 480 }, data: { title: "补充要求", text: "夜景灯光" } },
    ];
    const edges = [
      { id: "e-img", source: "ref-img", target: "draft-1" },
      { id: "e-plan", source: "plan-node", target: "draft-1", data: { promptReference: { bindings: [{ index: 1, assetId: img }] } } },
      { id: "e-plain", source: "plain-node", target: "draft-1" },
    ];
    // 方案节点（promptSource）经画布保存 API 会被「预览来源不可修改」校验拒绝（须走应用入口）；
    // 本用例聚焦接纳侧组合，直接落库种子（保存侧校验不在本票范围）。
    await prisma.client.canvas.create({
      data: {
        project_id: BigInt(projectId),
        version: 1,
        viewport_json: { x: 0, y: 0, zoom: 1 },
        nodes_json: nodes,
        edges_json: edges,
      },
    });
    const doc = {
      version: 1,
      segments: [
        { kind: "text", text: "按" },
        { kind: "text_ref", node_id: "plain-node", label: "文本2" },
        { kind: "text", text: "生成" },
      ],
    };
    const created = await createJob(projectId, imageBody([img], doc));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    // 正文编号跟附件顺序（方案附件=文本1、普通附件=文本2）；方案标签替换沿用既有编译
    expect(job!.input.prompt).toBe("按文本2生成");
    expect(job!.input.prompt_plan_snapshot).toMatchObject({
      providerPrompt: "文本1：参考图1出镜\n\n文本2：夜景灯光\n\n按文本2生成",
    });
    // 有方案快照时最终正文由 providerPrompt 承载，不重复冻结 composed_prompt
    expect(job!.input).not.toHaveProperty("composed_prompt");
  });

  it("无文本标签的任务不冻结 composed_prompt（组合格式不变，回归）", async () => {
    const projectId = (await projects.create("987654", "IKFA1P no text ref")).id;
    const img = await createAsset(projectId, "plain", "image");
    await seedImageCanvas(projectId, img);
    const created = await createJob(projectId, imageBody([img], {
      version: 1,
      segments: [{ kind: "text", text: "海边日落" }],
    }));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input).not.toHaveProperty("composed_prompt");
  });

  it("接纳后修改来源，重试仍消费原冻结快照（D3）", async () => {
    const projectId = (await projects.create("987654", "IKFA1P retry snapshot")).id;
    const img = await createAsset(projectId, "retry", "image");
    const { nodes, edges } = await seedImageCanvas(projectId, img);
    const doc = { version: 1, segments: [{ kind: "text_ref", node_id: "text-style", label: "文本1" }] };
    const first = await createJob(projectId, imageBody([img], doc));
    expect(first.code).toBe(200);
    const originalJobId = first.data.generation_job_id as string;
    // 接纳后修改来源文本（不影响已接纳任务）
    const row = await prisma.client.canvas.findFirst({ where: { project_id: BigInt(projectId) } });
    const updatedNodes = nodes.map((n) =>
      n.id === "text-style" ? { ...n, data: { ...n.data, text: "接纳后的新文字" } } : n);
    await (await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": `"${row!.version}"` },
      body: JSON.stringify({ nodes: JSON.stringify(updatedNodes), edges: JSON.stringify(edges), viewport: "{}" }),
    })).json();
    await prisma.client.generation_output_slots.updateMany({
      where: { generation_job_id: BigInt(originalJobId) },
      data: { status: "failed" },
    });
    await prisma.client.generation_jobs.update({
      where: { id: BigInt(originalJobId) },
      data: { status: "failed" },
    });
    const retried = await (await fetch(`${base}/api/projects/${projectId}/generation-jobs/${originalJobId}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "ikfa1p-retry-1" },
      body: JSON.stringify({}),
    })).json();
    expect(retried.code).toBe(200);
    const original = await readJob(originalJobId);
    const retry = await readJob(retried.data.generation_job_id);
    expect(retry!.input).toEqual(original!.input);
    // 该用例正文仅一个文本标签：编译后正文 = 文本1
    expect(retry!.input.composed_prompt).toBe(
      "文本1：赛博朋克，霓虹灯\n\n文本2：站立微笑\n\n文本3：   \n\n文本1",
    );
  });

  it("视频：references + 文本标签混排编译 + composed_prompt；worker 供应商正文为编号清单（D5 文本）", async () => {
    const projectId = (await projects.create("987654", "IKFA1P video doc")).id;
    const img = await createAsset(projectId, "vimg", "image");
    const nodes = [
      { id: "draft-v", type: "mediaNode", position: { x: 900, y: 120 }, data: { mediaType: "video", fileName: "视频草稿", draft: true, genStatus: "draft", prompt: "", draftMode: "all" } },
      { id: "ref-img", type: "mediaNode", position: { x: 140, y: 60 }, data: { mediaType: "image", fileName: "角色图", assetId: img, width: 1024, height: 1024 } },
      { id: "text-cam", type: "textNode", position: { x: 140, y: 300 }, data: { title: "运镜", text: "手持跟拍" } },
    ];
    const edges = [
      { id: "e-img", source: "ref-img", target: "draft-v" },
      { id: "e-cam", source: "text-cam", target: "draft-v" },
    ];
    const seeded = await (await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"missing"' },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges), viewport: "{}" }),
    })).status;
    expect(seeded).toBe(200);
    const references = [{ role: "reference", asset_id: img, type: "image" }];
    const doc = {
      version: 1,
      segments: [
        { kind: "text", text: "让" },
        { kind: "asset_ref", asset_id: img, label: "图片1" },
        { kind: "text", text: "按" },
        { kind: "text_ref", node_id: "text-cam", label: "文本1" },
        { kind: "text", text: "运镜" },
      ],
    };
    const created = await createJob(projectId, {
      type: "video",
      target_node_id: "draft-v",
      expected_output_count: 1,
      references,
      parameters: { prompt: "让图片1按文本1运镜", model_id: VIDEO_MODEL, aspect_ratio: "16:9", resolution: "720p", duration: 5 },
      prompt_doc: doc,
    });
    expect(created.code).toBe(200);
    const jobId = created.data.generation_job_id as string;
    const job = await readJob(jobId);
    expect(job!.input.prompt).toBe("让图片1按文本1运镜");
    expect(job!.input.composed_prompt).toBe("文本1：手持跟拍\n\n让图片1按文本1运镜");
    expect(job!.input.text_attachments).toEqual([{ node_id: "text-cam", title: "运镜", text: "手持跟拍" }]);

    // worker 供应商正文 = 编号清单（建立 文本1 ↔ 内容 关系）
    const providerSubmits: Array<{ prompt: string }> = [];
    const provider: VideoTaskProvider = {
      submit: async (input) => {
        providerSubmits.push({ prompt: input.prompt });
        return { taskId: "ikfa1p-video-1", status: "queued" };
      },
      poll: async () => ({ status: "succeeded", progress: 100, url: "https://example.com/ikfa1p-out.mp4", error: null }),
    };
    const workerArgs = {
      jobId, repo: createWorkerRepo(prisma.client), workerId: "ikfa1p-video-worker",
      credentialVault: { open: (value: string) => value },
      createProvider: () => provider,
      mediaRelay: { persist: async (url: string) => ({ url, storageKey: null, mime: "video/mp4", size: 2048 }) },
    } as const;
    await vi.waitFor(async () => expect(await runVideoJobStep(workerArgs)).toBe(jobId), { timeout: 15_000 });
    expect(providerSubmits[0]!.prompt).toBe("文本1：手持跟拍\n\n让图片1按文本1运镜");
  });

  // 浏览器段（验收链路）：真实浏览器 + 真实业务 API + 隔离 MySQL + 记录式供应商，生图路径。
  // 覆盖：@ 插入文本标签（附件区/菜单/正文同源编号）→ 发送冻结 → 断开连线失效 → 重连恢复 →
  // 改来源再生成（D2 最新文字）→ 重试消费原快照（D3）。
  it.runIf(process.env.IKFA1P_BROWSER)("browser(生图)：@ 文本插入 → API → DB → worker 编号清单 → 失效/恢复 → 改来源 → 重试冻结", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFA1P browser image")).id;
    const img = await createAsset(projectId, "role-b", "image");
    const { nodes, edges } = await seedImageCanvas(projectId, img);

    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const generationRequests: Array<Record<string, unknown>> = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && /\/api\/projects\/\d+\/generation-jobs$/.test(request.url())) {
          generationRequests.push(request.postDataJSON() as Record<string, unknown>);
        }
      });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      const draft = page.locator('.react-flow__node-mediaNode[data-id="draft-1"]');
      await draft.waitFor();
      await draft.locator('[data-testid="media-content"]').click();
      await page.locator('[contenteditable="true"]').waitFor();

      // 附件区展示文本附件编号徽标（与正文/菜单同源）
      await page.locator('[class*="attachmentBadge"]').first().waitFor();
      expect(await page.locator('[class*="attachmentBadge"]').allInnerTexts()).toEqual(["文本1", "文本2", "文本3"]);

      // @ 菜单已引用分区含图片与文本项（A2 文本部分）
      const editor = page.locator('[contenteditable="true"]');
      await editor.click();
      await page.keyboard.type("按@");
      await page.locator('[data-testid="mention-menu"]').waitFor();
      const items = page.locator('[data-testid="mention-ref-item"]');
      expect((await items.allInnerTexts()).map((t) => t.replace(/\n/g, ""))).toEqual(["角色图图片1", "风格要求文本1", "姿势说明文本2", "空白草稿文本3"]);
      await items.nth(1).click();
      await page.keyboard.type("修改");
      expect((await editor.innerText()).replace(/\n/g, "")).toContain("按文本1修改");

      await page.locator('button[title="发送"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      const body = generationRequests[0]!;
      expect(body.target_node_id).toBe("draft-1");
      expect(body.prompt_doc).toEqual({
        version: 1,
        segments: [
          { kind: "text", text: "按" },
          { kind: "text_ref", node_id: "text-style", label: "文本1" },
          { kind: "text", text: "修改" },
        ],
      });
      await vi.waitFor(async () => expect(await jobCount(projectId)).toBe(1), { timeout: 10_000 });
      const firstJobId = (await prisma.client.generation_jobs.findFirst({
        where: { project_id: BigInt(projectId) }, orderBy: { id: "asc" },
      }))!.id.toString();
      const frozen = (await readJob(firstJobId))!.input;
      expect(frozen.prompt).toBe("按文本1修改");
      expect(frozen.composed_prompt).toBe(
        "文本1：赛博朋克，霓虹灯\n\n文本2：站立微笑\n\n文本3：   \n\n按文本1修改",
      );

      // worker：记录式供应商断言编号清单正文（不只发送文本1字样）；首次拒绝形成真实失败，
      // 保留面板可交互状态做失效/恢复验证（对齐 IKFA1M 浏览器链路模式）。
      const providerRequests: GenerateImageInput[] = [];
      const imageWorker = {
        repo: createWorkerRepo(prisma.client),
        workerId: "ikfa1p-browser-image-worker",
        credentialVault: { open: (token: string) => token },
        createImageProvider: () => ({
          generate: async (input: GenerateImageInput) => {
            providerRequests.push(structuredClone(input));
            if (providerRequests.length === 1) throw new ImageProviderError("insufficient_quota", "记录供应商首次拒绝请求");
            return [{ url: "https://example.com/ikfa1p-b-out.png", width: 1024, height: 1024 }];
          },
        }),
      } as const;
      await vi.waitFor(async () => expect(await processImageJobById(firstJobId, imageWorker)).toBe(firstJobId), { timeout: 15_000 });
      expect(providerRequests[0]!.prompt).toBe(
        "文本1：赛博朋克，霓虹灯\n\n文本2：站立微笑\n\n文本3：   \n\n按文本1修改",
      );
      await vi.waitFor(async () => expect((await readJob(firstJobId))!.status).toBe("failed"), { timeout: 5_000 });

      // 断开文本连线（等效移除附件）→ 刷新重开面板：标签失效阻止发送（B1）
      async function putCanvas(nextEdges: unknown[], nextNodes?: unknown[]) {
        const row = await prisma.client.canvas.findFirst({ where: { project_id: BigInt(projectId) } });
        const putRes = await fetch(`${base}/api/canvases/${projectId}`, {
          method: "PUT",
          headers: { "content-type": "application/json", "if-match": `"${row!.version}"` },
          body: JSON.stringify({
            nodes: JSON.stringify(nextNodes ?? row!.nodes_json),
            edges: JSON.stringify(nextEdges), viewport: "{}",
          }),
        });
        if (!putRes.ok) throw new Error(`putCanvas 失败: ${putRes.status} ${await putRes.text()}`);
      }
      await putCanvas(edges.filter((e) => e.id !== "e-style"));
      await page.reload();
      await draft.waitFor();
      await draft.locator('[data-testid="media-content"]').click();
      await page.locator('[contenteditable="true"]').waitFor();
      await page.screenshot({ path: "/tmp/ikfa1p-invalid-debug.png", fullPage: true });
      await page.locator('[data-testid="asset-ref-invalid"]').first().waitFor();
      expect((await page.locator('[data-testid="asset-ref-invalid"]').first().innerText()).replace(/\n/g, "")).toContain("已失效：原文本1");
      await page.locator('button[title="关闭"]').first().click();

      // 重连同身份 → 恢复当前编号（B4）
      await putCanvas([...edges]);
      await page.reload();
      await draft.waitFor();
      await draft.locator('[data-testid="media-content"]').click();
      await page.locator('[data-testid="asset-ref-valid"]').first().waitFor();
      expect((await page.locator('[data-testid="asset-ref-valid"]').first().innerText()).replace(/\n/g, "")).toContain("文本1");
      await page.locator('button[title="关闭"]').first().click();

      // 改来源文字再生成：新任务用最新内容（D2）。
      // 基于当前 DB nodes 修改（保留面板自动保存写入草稿的 promptDoc），不用种子数组覆盖。
      {
        const row = await prisma.client.canvas.findFirst({ where: { project_id: BigInt(projectId) } });
        const updatedNodes = (row!.nodes_json as Array<{ id: string; data?: Record<string, unknown> }>).map((n) =>
          n.id === "text-style" ? { ...n, data: { ...n.data, text: "水彩风格，柔光" } } : n);
        await putCanvas([...edges], updatedNodes);
      }
      await page.reload();
      await draft.waitFor();
      await draft.locator('[data-testid="media-content"]').click();
      await page.locator('[contenteditable="true"]').waitFor();
      await page.locator('button[title="发送"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(2), { timeout: 10_000 });
      await vi.waitFor(async () => expect(await jobCount(projectId)).toBe(2), { timeout: 10_000 });
      const secondJobId = (await prisma.client.generation_jobs.findFirst({
        where: { project_id: BigInt(projectId) }, orderBy: { id: "desc" },
      }))!.id.toString();
      const second = (await readJob(secondJobId))!.input;
      expect(second.composed_prompt).toBe(
        "文本1：水彩风格，柔光\n\n文本2：站立微笑\n\n文本3：   \n\n按文本1修改",
      );

      // 重试消费原冻结快照（D3）
      await prisma.client.generation_output_slots.updateMany({
        where: { generation_job_id: BigInt(firstJobId) },
        data: { status: "failed" },
      });
      await prisma.client.generation_jobs.update({
        where: { id: BigInt(firstJobId) },
        data: { status: "failed" },
      });
      const retried = await (await fetch(`${base}/api/projects/${projectId}/generation-jobs/${firstJobId}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "ikfa1p-browser-retry-1" },
        body: JSON.stringify({}),
      })).json();
      expect(retried.code).toBe(200);
      const retryJob = await readJob(retried.data.generation_job_id);
      const originalJob = await readJob(firstJobId);
      expect(retryJob!.input).toEqual(originalJob!.input);
      expect(retryJob!.input.composed_prompt).toContain("文本1：赛博朋克，霓虹灯");
    } finally {
      await browser.close();
      await vite.close();
    }
  }, 120_000);

  // 浏览器段（视频路径）：@ 文本与媒体混排插入 → 发送 → worker 供应商编号清单正文。
  it.runIf(process.env.IKFA1P_BROWSER)("browser(生视频)：@ 文本混排插入 → API → DB → worker 编号清单", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFA1P browser video")).id;
    const img = await createAsset(projectId, "vimg-b", "image");
    const nodes = [
      { id: "draft-v", type: "mediaNode", position: { x: 900, y: 120 }, data: { mediaType: "video", fileName: "视频草稿", draft: true, genStatus: "draft", prompt: "", draftMode: "all" } },
      { id: "ref-img", type: "mediaNode", position: { x: 140, y: 60 }, data: { mediaType: "image", fileName: "角色图", assetId: img, width: 1024, height: 1024 } },
      { id: "text-cam", type: "textNode", position: { x: 140, y: 300 }, data: { title: "运镜", text: "手持跟拍" } },
    ];
    const edges = [
      { id: "e-img", source: "ref-img", target: "draft-v" },
      { id: "e-cam", source: "text-cam", target: "draft-v" },
    ];
    const seeded = await (await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"missing"' },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges), viewport: JSON.stringify({ x: 0, y: 0, zoom: 1 }) }),
    })).status;
    expect(seeded).toBe(200);

    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const generationRequests: Array<Record<string, unknown>> = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && /\/api\/projects\/\d+\/generation-jobs$/.test(request.url())) {
          generationRequests.push(request.postDataJSON() as Record<string, unknown>);
        }
      });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      const draft = page.locator('.react-flow__node-mediaNode[data-id="draft-v"]');
      await draft.waitFor();
      await draft.locator('[data-testid="media-content"]').click();
      await page.locator('[contenteditable="true"]').waitFor();

      // @ 菜单媒体与文本混排（A2）；插入 文本1
      const editor = page.locator('[contenteditable="true"]');
      await editor.click();
      await page.keyboard.type("按@");
      await page.locator('[data-testid="mention-menu"]').waitFor();
      const items = page.locator('[data-testid="mention-ref-item"]');
      expect((await items.allInnerTexts()).map((t) => t.replace(/\n/g, ""))).toEqual(["角色图图片1", "运镜文本1"]);
      await items.nth(1).click();
      await page.keyboard.type("运镜");
      expect((await editor.innerText()).replace(/\n/g, "")).toContain("按文本1运镜");

      await page.locator('[data-testid="video-send"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      const body = generationRequests[0]!;
      expect(body.target_node_id).toBe("draft-v");
      expect(Array.isArray(body.references)).toBe(true);
      expect(body.prompt_doc).toEqual({
        version: 1,
        segments: [
          { kind: "text", text: "按" },
          { kind: "text_ref", node_id: "text-cam", label: "文本1" },
          { kind: "text", text: "运镜" },
        ],
      });
      await vi.waitFor(async () => expect(await jobCount(projectId)).toBe(1), { timeout: 10_000 });
      const jobId = (await prisma.client.generation_jobs.findFirst({
        where: { project_id: BigInt(projectId) }, orderBy: { id: "asc" },
      }))!.id.toString();
      const frozen = (await readJob(jobId))!.input;
      expect(frozen.prompt).toBe("按文本1运镜");
      expect(frozen.composed_prompt).toBe("文本1：手持跟拍\n\n按文本1运镜");

      // worker：记录式视频供应商断言编号清单正文
      const providerSubmits: Array<{ prompt: string }> = [];
      const provider: VideoTaskProvider = {
        submit: async (input) => {
          providerSubmits.push({ prompt: input.prompt });
          return { taskId: "ikfa1p-browser-video-1", status: "queued" };
        },
        poll: async () => ({ status: "succeeded", progress: 100, url: "https://example.com/ikfa1p-bv-out.mp4", error: null }),
      };
      const workerArgs = {
        jobId, repo: createWorkerRepo(prisma.client), workerId: "ikfa1p-browser-video-worker",
        credentialVault: { open: (value: string) => value },
        createProvider: () => provider,
        mediaRelay: { persist: async (url: string) => ({ url, storageKey: null, mime: "video/mp4", size: 2048 }) },
      } as const;
      await vi.waitFor(async () => expect(await runVideoJobStep(workerArgs)).toBe(jobId), { timeout: 15_000 });
      expect(providerSubmits[0]!.prompt).toBe("文本1：手持跟拍\n\n按文本1运镜");
    } finally {
      await browser.close();
      await vite.close();
    }
  }, 120_000);
});
