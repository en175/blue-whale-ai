import "reflect-metadata";
import { randomBytes } from "node:crypto";
import { openGenerationCredential } from "@blue-whale/core";
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
import { processImageJobById } from "@lib/shared/generation/worker/generation-worker.js";
import type { GenerateImageInput } from "@lib/shared/generation/worker/image-provider.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";
import { GenerationCommandService } from "@lib/shared/generation/generation-command.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { GenerationCostEstimatorService } from "@lib/shared/generation/cost-estimator.service.js";

// IKFA1M「生图正文素材索引与生成闭环」公开接口集成（契约 §7 服务端项）：
// 真 NestFactory 挂载生产 Canvas/Generation 控制器与服务 + 隔离 MySQL（IKFA1M_DATABASE_URL 门控）。
// 链路：POST generation-jobs（prompt_doc）→ 服务端复核/编译 → 库内冻结快照 → 重试消费。
// 浏览器段直接派发同一任务 id 到生产 worker（MQ 传输不在此验收范围），使用真实仓储与记录式供应商。
// IKFA1M_BROWSER=1：草稿面板 → @ 插入 → 接纳 → worker → 供应商 → 修改草稿 → 重试。
describe.skipIf(!process.env.IKFA1M_DATABASE_URL)("Image prompt ref doc public API (IKFA1M)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "ikfa1m-image-model";
  const AUDIO_MODEL_ID = "ikfa1m-audio-model";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;
  const previousSecret = process.env.GENERATION_CREDENTIAL_SECRET;
  const credentialSecret = randomBytes(32).toString("hex");
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKFA1M_DATABASE_URL;
    process.env.GENERATION_CREDENTIAL_SECRET = credentialSecret;
    const sizes = [{ id: "1024x1024", label: "1024x1024" }];
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikfa1m-test", model_id: MODEL_ID } },
      create: {
        provider_id: "ikfa1m-test",
        model_id: MODEL_ID,
        capability_type: "image",
        model_label: "IKFA1M Test",
        supported_sizes: sizes,
        supported_aspect_ratios: ["1:1"],
        supported_formats: ["png"],
        default_size: "1024x1024",
        default_aspect_ratio: "1:1",
        // 浏览器段草稿面板有两张图片参考：需开参考能力位，否则面板按契约禁用发送
        features: { reference_image: true, max_reference_images: 9 },
      },
      update: {
        supported_sizes: sizes,
        default_size: "1024x1024",
        features: { reference_image: true, max_reference_images: 9 },
      },
    });
    // IKFCXE 起音频支持正文素材标签：D4 用例需要一条音频能力行承载合法接纳断言
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikfa1m-test", model_id: AUDIO_MODEL_ID } },
      create: {
        provider_id: "ikfa1m-test",
        model_id: AUDIO_MODEL_ID,
        capability_type: "audio",
        model_label: "IKFA1M Audio Test",
        supported_sizes: [],
        supported_aspect_ratios: [],
        supported_formats: ["mp3"],
        default_size: "mp3",
        default_aspect_ratio: "1:1",
        features: {},
      },
      update: { features: {} },
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
    app.use(json({ limit: "16mb" }));
    app.setGlobalPrefix("api");
    app.use((req: { user: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
      req.user = { userId: "987654" };
      req.headers.authorization = "Bearer sk-ikfa1m-recording-provider";
      next();
    });
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  }, 30_000);
  afterAll(async () => {
    await app?.close();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    if (previousSecret === undefined) delete process.env.GENERATION_CREDENTIAL_SECRET;
    else process.env.GENERATION_CREDENTIAL_SECRET = previousSecret;
    await prisma.client.$disconnect();
  });

  async function createImageAsset(projectId: string, name: string) {
    const asset = await prisma.client.assets.create({
      data: {
        user_id: BigInt(987654),
        project_id: BigInt(projectId),
        type: "image",
        url: `https://example.com/${name}.png`,
        width: 1024,
        height: 1024,
        size: BigInt(2048),
      },
    });
    return asset.id.toString();
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

  function imageBody(inputAssetIds: string[], promptDoc?: unknown) {
    return {
      type: "image",
      expected_output_count: 1,
      parameters: { prompt: "让图片2穿上图片1的衣服", model_id: MODEL_ID, aspect_ratio: "1:1" },
      input_asset_ids: inputAssetIds,
      ...(promptDoc !== undefined ? { prompt_doc: promptDoc } : {}),
    };
  }
  // 正文先提第二张（B）再提第一张（A），媒体顺序保持 [A, B]（D1）
  const docMentionBFirst = (a: string, b: string) => ({
    version: 1,
    segments: [
      { kind: "text", text: "让" },
      { kind: "asset_ref", asset_id: b, label: "图片2" },
      { kind: "text", text: "穿上" },
      { kind: "asset_ref", asset_id: a, label: "图片1" },
      { kind: "text", text: "的衣服" },
    ],
  });

  it("带 prompt_doc 创建：按真实输入顺序编译正文并冻结原始结构（D1）", async () => {
    const projectId = (await projects.create("987654", "IKFA1M doc create")).id;
    const a = await createImageAsset(projectId, "a");
    const b = await createImageAsset(projectId, "b");
    const doc = docMentionBFirst(a, b);

    const created = await createJob(projectId, imageBody([a, b], doc));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job).not.toBeNull();
    // 编译：正文先提 B（图片2）再提 A（图片1），与 input_asset_ids 顺序 [a, b] 对应
    expect(job!.input.prompt).toBe("让图片2穿上图片1的衣服");
    expect(job!.input.prompt_doc).toEqual(doc);
    expect((job!.input.input_asset_ids as unknown[]).map(String)).toEqual([a, b]);
  });

  it("同一素材多次提及编译为同一编号；未提及参考不参与正文（A4/E2）", async () => {
    const projectId = (await projects.create("987654", "IKFA1M dup mention")).id;
    const a = await createImageAsset(projectId, "a");
    const b = await createImageAsset(projectId, "b");
    const doc = {
      version: 1,
      segments: [
        { kind: "text", text: "让" },
        { kind: "asset_ref", asset_id: b, label: "图片2" },
        { kind: "text", text: "微笑，再让" },
        { kind: "asset_ref", asset_id: b, label: "图片2" },
        { kind: "text", text: "招手" },
      ],
    };
    const created = await createJob(projectId, imageBody([a, b], doc));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.prompt).toBe("让图片2微笑，再让图片2招手");
    // 未提及的 A 仍随输入数组提交（既有语义）
    expect((job!.input.input_asset_ids as unknown[]).map(String)).toEqual([a, b]);
  });

  it("失效标签 / 无效身份 / 非法版本 → 400 不建任务；音频空结构 prompt_doc 合法接纳（服务端复核，D4）", async () => {
    const projectId = (await projects.create("987654", "IKFA1M bad doc")).id;
    const a = await createImageAsset(projectId, "a");

    const invalidTag = await createJob(projectId, imageBody([a], {
      version: 1,
      segments: [{ kind: "asset_ref", asset_id: a, invalid_label: "图片1" }],
    }));
    expect(invalidTag.code).toBe(400);
    expect(invalidTag.msg).toBe("存在已失效的素材标签，请删除后再提交");

    const unknownAsset = await createJob(projectId, imageBody([a], docMentionBFirst(a, "999")));
    expect(unknownAsset.code).toBe(400);
    expect(unknownAsset.msg).toBe("正文素材标签指向无效的参考素材");

    const badVersion = await createJob(projectId, imageBody([a], { version: 2, segments: [] }));
    expect(badVersion.code).toBe(400);
    expect(badVersion.msg).toBe("prompt_doc 无效");

    // IKFCXE 起音频支持正文素材标签（旧「音频携带一律 400」守卫已随该票退役）：
    // 纯文本 prompt_doc 合法接纳，编译正文与原始结构随任务冻结（与单测「音频纯文本 prompt_doc 可接纳且冻结结构」同口径）
    const audioDoc = { version: 1, segments: [{ kind: "text", text: "海浪声" }] };
    const audioType = await createJob(projectId, {
      type: "audio",
      expected_output_count: 1,
      parameters: { prompt: "任意占位（编译正文覆盖）", model_id: AUDIO_MODEL_ID },
      prompt_doc: audioDoc,
    });
    expect(audioType.code).toBe(200);
    const audioJob = await readJob(audioType.data.generation_job_id);
    expect(audioJob!.input.prompt_doc).toEqual(audioDoc);
    expect(audioJob!.input.prompt).toBe("海浪声");

    // 前三个拒绝用例零任务；音频合法接纳建 1 个
    expect(await jobCount(projectId)).toBe(1);
  });

  it("标签指向他人/不存在素材 → 参考复核先拒绝（invalid_reference），不建任务（D4）", async () => {
    const projectId = (await projects.create("987654", "IKFA1M ownership")).id;
    const otherProject = (await projects.create("987654", "IKFA1M ownership other")).id;
    const foreign = await createImageAsset(otherProject, "foreign");
    const doc = {
      version: 1,
      segments: [
        { kind: "text", text: "让" },
        { kind: "asset_ref", asset_id: foreign },
        { kind: "text", text: "微笑" },
      ],
    };
    const created = await createJob(projectId, imageBody([foreign], doc));
    expect(created.code).toBe(400);
    expect(created.msg).toBe("参考素材不存在或无权访问");
    expect(await jobCount(projectId)).toBe(0);
  });

  it("target_node_id + prompt_doc 混合：编译正文与文本附件同一最终输入冻结（D5 生图部分）", async () => {
    const projectId = (await projects.create("987654", "IKFA1M doc with target")).id;
    const a = await createImageAsset(projectId, "a");
    const b = await createImageAsset(projectId, "b");
    const nodes = [
      { id: "draft-1", type: "mediaNode", position: { x: 0, y: 0 }, data: { mediaType: "image" } },
      { id: "text-1", type: "textNode", position: { x: 0, y: 0 }, data: { title: "风格", text: "风格：水彩" } },
    ];
    const edges = [{ id: "e1", source: "text-1", target: "draft-1" }];
    const saved = await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"missing"' },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges), viewport: "{}" }),
    });
    expect(saved.status).toBe(200);

    const created = await createJob(projectId, {
      ...imageBody([a, b], docMentionBFirst(a, b)),
      target_node_id: "draft-1",
    });
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    // 主提示词标签按最终输入顺序编译；文本附件沿既有快照冻结——两套表达共用同一次最终输入
    expect(job!.input.prompt).toBe("让图片2穿上图片1的衣服");
    expect(job!.input.text_attachments).toEqual([{ node_id: "text-1", title: "风格", text: "风格：水彩" }]);
    expect((job!.input.input_asset_ids as unknown[]).map(String)).toEqual([a, b]);
  });

  it("无 prompt_doc 的旧请求：input 无该字段，prompt 原样冻结（E5 兼容）", async () => {
    const projectId = (await projects.create("987654", "IKFA1M legacy")).id;
    const created = await createJob(projectId, imageBody([], undefined));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.prompt).toBe("让图片2穿上图片1的衣服");
    expect(job!.input).not.toHaveProperty("prompt_doc");
  });

  it("接纳后改文字/删素材，重试仍消费原冻结快照（D3）", async () => {
    const projectId = (await projects.create("987654", "IKFA1M retry snapshot")).id;
    const a = await createImageAsset(projectId, "a");
    const b = await createImageAsset(projectId, "b");
    const doc = docMentionBFirst(a, b);
    const first = await createJob(projectId, imageBody([a, b], doc));
    expect(first.code).toBe(200);
    const originalJobId = first.data.generation_job_id as string;

    // 接纳后删除素材 B（模拟素材变化）：重试不得回读
    await prisma.client.assets.delete({ where: { id: BigInt(b) } });

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
      headers: { "content-type": "application/json", "idempotency-key": "ikfa1m-retry-1" },
      body: JSON.stringify({}),
    })).json();
    expect(retried.code).toBe(200);

    const original = await readJob(originalJobId);
    const retry = await readJob(retried.data.generation_job_id);
    expect(retry!.input).toEqual(original!.input);
    expect(retry!.input.prompt).toBe("让图片2穿上图片1的衣服");
    expect(retry!.input.prompt_doc).toEqual(doc);
  });

  // 浏览器段（契约 §7）：真实浏览器 + 真实业务 API + 隔离 MySQL 走完整生图路径。
  // 草稿面板 @ 插入标签 → 发送（请求体含 prompt_doc）→ 库内冻结编译正文 → 刷新重开恢复标签。
  it.runIf(process.env.IKFA1M_BROWSER)("browser: @ → API → DB → worker → provider → reload → edited draft → retry frozen input", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFA1M browser")).id;
    const a = await createImageAsset(projectId, "role");
    const b = await createImageAsset(projectId, "cloth");
    // 草稿目标 + 两个图片参考节点（连线由种子直接落，浏览器段聚焦 @ 与生成链路）
    const seeded = await (await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"missing"' },
      body: JSON.stringify({
        nodes: JSON.stringify([
          { id: "draft-1", type: "mediaNode", position: { x: 900, y: 120 }, data: { mediaType: "image", fileName: "图片草稿", draft: true, genStatus: "draft", prompt: "" } },
          { id: "ref-a", type: "mediaNode", position: { x: 140, y: 120 }, data: { mediaType: "image", fileName: "角色图", assetId: a, width: 1024, height: 1024 } },
          { id: "ref-b", type: "mediaNode", position: { x: 140, y: 420 }, data: { mediaType: "image", fileName: "衣服图", assetId: b, width: 1024, height: 1024 } },
        ]),
        edges: JSON.stringify([
          { id: "e1", source: "ref-a", target: "draft-1" },
          { id: "e2", source: "ref-b", target: "draft-1" },
        ]),
        viewport: JSON.stringify({ x: 0, y: 0, zoom: 1 }),
      }),
    })).status;
    expect(seeded).toBe(200);

    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const generationRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && /\/api\/projects\/\d+\/generation-jobs$/.test(request.url())) {
          generationRequests.push({ url: request.url(), body: request.postDataJSON() as Record<string, unknown> });
        }
      });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      const draft = page.locator('.react-flow__node-mediaNode[data-id="draft-1"]');
      await draft.waitFor();

      // 点击草稿卡打开绑定面板：参考区两张（图片1/图片2 角标）
      await draft.locator('[data-testid="media-content"]').click();
      await page.locator('[data-testid="dock-media-ref"]').first().waitFor();
      expect(await page.locator('[data-testid="dock-media-ref"]').count()).toBe(2);
      expect(await page.locator('[data-testid="dock-media-ref"]').first().innerText()).toContain("图片1");

      // 句中输入 @ 选择第二项（衣服图=图片2），前后文字保留
      const editor = page.locator('[contenteditable="true"]');
      await editor.click();
      await page.keyboard.type("让");
      await page.keyboard.type("@");
      await page.locator('[data-testid="mention-menu"]').waitFor();
      const items = page.locator('[data-testid="mention-ref-item"]');
      expect(await items.count()).toBe(2);
      await items.nth(1).click();
      await page.keyboard.type("微笑");
      // 编辑与选择均不触发生成
      expect(generationRequests).toEqual([]);

      await page.locator('button[title="发送"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      const body = generationRequests[0].body;
      expect(body.target_node_id).toBe("draft-1");
      expect((body.parameters as Record<string, unknown>).prompt).toBe("让图片2微笑");
      expect(body.prompt_doc).toEqual({
        version: 1,
        segments: [
          { kind: "text", text: "让" },
          { kind: "asset_ref", asset_id: b, label: "图片2" },
          { kind: "text", text: "微笑" },
        ],
      });
      await vi.waitFor(async () => expect(await jobCount(projectId)).toBe(1), { timeout: 10_000 });
      const jobRow = await prisma.client.generation_jobs.findFirst({
        where: { project_id: BigInt(projectId) }, orderBy: { id: "asc" },
      });
      const frozen = jobRow!.input as Record<string, unknown>;
      expect(frozen.prompt).toBe("让图片2微笑");
      expect((frozen.input_asset_ids as unknown[]).map(String)).toEqual([a, b]);

      // 消费浏览器创建的真实任务；首次供应商无产出形成真实失败，随后通过公开接口重试。
      const providerRequests: GenerateImageInput[] = [];
      const worker = {
        repo: createWorkerRepo(prisma.client),
        workerId: "ikfa1m-browser-worker",
        credentialVault: { open: (value: string) => openGenerationCredential(value, credentialSecret) },
        createAudioProvider: () => { throw new Error("本测试只允许图片任务"); },
        createImageProvider: (token: string) => {
          expect(token).toBe("sk-ikfa1m-recording-provider");
          return { generate: async (input: GenerateImageInput) => {
            providerRequests.push(structuredClone(input));
            return providerRequests.length === 1 ? [] : [{ url: "https://example.com/result.png", width: 1024, height: 1024 }];
          } };
        },
      };
      const firstJobId = jobRow!.id.toString();
      // next_action_at 以数据库秒精度保存，按调度条件等待可领取，不改任务调度字段。
      await vi.waitFor(async () => expect(await processImageJobById(firstJobId, worker)).toBe(firstJobId), { timeout: 3_000 });
      expect((await readJob(firstJobId))!.status).toBe("failed");
      expect(providerRequests).toHaveLength(1);
      expect(providerRequests[0].prompt).toBe("让图片2微笑");
      expect(providerRequests[0].sourceImages?.map((item) => item.url)).toEqual([
        "https://example.com/role.png", "https://example.com/cloth.png",
      ]);

      // 刷新重开面板：标签结构恢复（编号重新派生），不是拍平文本
      await page.reload();
      await draft.waitFor();
      await draft.locator('[data-testid="media-content"]').click();
      await page.locator('[data-testid="asset-ref-valid"]').waitFor();
      expect(await page.locator('[data-testid="asset-ref-valid"]').first().innerText()).toContain("图片2");
      await editor.fill("后来的草稿正文");
      await page.locator('[data-testid="dock-media-ref"]').nth(1).locator('button[title="移除"]').click();
      await vi.waitFor(async () => {
        const canvas = await prisma.client.canvas.findFirst({ where: { project_id: BigInt(projectId) } });
        const nodes = canvas!.nodes_json as Array<{ id: string; data: { prompt?: string } }>;
        expect(nodes.find((node) => node.id === "draft-1")!.data.prompt).toBe("后来的草稿正文");
        expect(canvas!.edges_json).not.toEqual(expect.arrayContaining([expect.objectContaining({ source: "ref-b", target: "draft-1" })]));
      }, { timeout: 10_000 });
      const retryResponse = await page.request.post(`${base}/api/projects/${projectId}/generation-jobs/${firstJobId}/retry`, {
        headers: { "idempotency-key": `ikfa1m-browser-retry-${firstJobId}` }, data: {},
      });
      const retried = await retryResponse.json();
      expect(retried.code).toBe(200);
      const retryJobId = String(retried.data.generation_job_id);
      expect((await readJob(retryJobId))!.input).toEqual(frozen);
      await vi.waitFor(async () => expect(await processImageJobById(retryJobId, worker)).toBe(retryJobId), { timeout: 3_000 });
      expect((await readJob(retryJobId))!.status).toBe("succeeded");
      expect(providerRequests).toHaveLength(2);
      expect(providerRequests[1]).toEqual(providerRequests[0]);
      await page.screenshot({ path: "/tmp/ikfa1m-browser.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 90_000);
});
