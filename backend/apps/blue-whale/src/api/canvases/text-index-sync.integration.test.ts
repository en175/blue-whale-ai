import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
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
import { GenerationCostEstimatorService } from "@lib/shared/generation/cost-estimator.service.js";
import { textInputSignatureOf } from "@lib/contracts";

/* IKFM3S 文本索引下游同步契约 v1 集成（隔离 MySQL，IKFM3S_DATABASE_URL 门控）：
   真实保存 + 提交 API → 数据库核对——契约见 docs/specs/2026-09-14-ikfm3s-text-index-sync-contract.md。
   - 权威并入：文本带入素材追加 input_asset_ids 尾部、text_attachments[].media 与 text_input_signature 冻结；
   - 同源预演：body 已含文本素材时序不变；同 assetId 去重；
   - 阻止发送：失效索引 / 不支持媒体类型 / 合并超限 400 且零建任务；
   - 回归：无媒体索引的普通文本连线行为不变。 */
describe.skipIf(!process.env.IKFM3S_DATABASE_URL)("Text index downstream sync contract (IKFM3S)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "ikfm3s-image-model";
  const LIMIT_MODEL_ID = "ikfm3s-limit-model";
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
        features: { max_reference_images: 1 },
      },
      update: { features: { max_reference_images: 1 } },
    });
    const canvasService = new CanvasService(prisma, projects);
    const jobsService = new JobsService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, GenerationCostEstimatorService, CanvasService], GenerationJobsController);
    Reflect.defineMetadata("design:paramtypes", [ModelCapabilityReadService], GenerationModelsController);
    Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
    class HarnessModule {}
    Module({ controllers: [CanvasesController, GenerationJobsController, GenerationModelsController, JobsController, ProjectsController], providers: [
      { provide: CanvasService, useValue: canvasService },
      { provide: ProjectService, useValue: projects },
      { provide: PrismaService, useValue: prisma },
      { provide: JobsService, useValue: jobsService },
      { provide: GenerationCommandService, useValue: new GenerationCommandService(prisma) },
      { provide: ModelCapabilityReadService, useValue: new ModelCapabilityReadService(prisma) },
      { provide: GenerationCostEstimatorService, useValue: new GenerationCostEstimatorService() },
      { provide: SnapshotService, useValue: new SnapshotService(prisma) },
    ] })(HarnessModule);
    app = await NestFactory.create(HarnessModule, { logger: false, bodyParser: false });
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

  async function createAsset(projectId: bigint, type: "image" | "video", url: string) {
    const asset = await prisma.client.assets.create({ data: { user_id: 987654n, project_id: projectId, type, url, width: 640, height: 480 } });
    return asset.id.toString();
  }
  async function saveCanvas(projectId: string, nodes: unknown[], edges: unknown[], version: number | "missing") {
    const response = await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": version === "missing" ? '"missing"' : `"${version}"` },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges), viewport: "{}" }),
    });
    expect(response.status).toBe(200);
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

  /** 夹具：图片目标 gen-1 + 文本卡 text-1（正文索引 media-1）+ 直接参考 media-2。
   *  返回画布保存所需的节点/连线与素材 id。 */
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
    // 直接参考在前、文本带入追加尾部（body 未携带 → 后端权威并入）
    expect(job!.input.input_asset_ids).toEqual([directAssetId, imageAssetId]);
    expect(job!.input.text_attachments).toEqual([
      {
        node_id: "text-1",
        title: "文本",
        text: "用图片1出图",
        media: [{ node_id: "media-1", asset_id: imageAssetId, media_type: "image" }],
      },
    ]);
    // 签名与前端同源（同一契约函数）：正文 + 有效身份 + 边序
    expect(job!.input.text_input_signature).toBe(
      textInputSignatureOf([
        { nodeId: "text-1", text: "用图片1出图", identities: [{ sourceNodeId: "media-1", assetId: imageAssetId, mediaType: "image" }] },
      ]),
    );
  });

  it("重试复用原快照：合并参考、media 映射与签名原样复制，不重读画布", async () => {
    const { projectId, imageAssetId, directAssetId } = await seedIndexedCanvas("IKFM3S retry");
    const created = await createJob(projectId, imageJobBody("gen-1", "暮色", [directAssetId]));
    expect(created.code).toBe(200);
    const original = await readJob(created.data.generation_job_id);
    // 提交后编辑画布（正文变化）：重试必须沿用原冻结输入，不读取后续编辑
    const canvasRow = await prisma.client.canvas.findUnique({ where: { project_id: BigInt(projectId) } });
    const retryNodes = canvasRow!.nodes_json as unknown as Array<{ id: string; data: Record<string, unknown> }>;
    retryNodes.find((node) => node.id === "text-1")!.data.text = "提交后改的正文";
    await saveCanvas(projectId, retryNodes, canvasRow!.edges_json as unknown as unknown[], canvasRow!.version);
    // 翻失败让任务可重试（重试入口仅对终态失败任务开放：job + 输出槽，同 IKDMQV 模式）
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
    // 前端同源预演：直接参考 + 文本素材已按合并序提交 → 后端零追加、序保持
    const created = await createJob(projectId, imageJobBody("gen-1", "暮色", [directAssetId, imageAssetId]));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.input_asset_ids).toEqual([directAssetId, imageAssetId]);
  });

  it("失效索引（textIndex 关系线缺失）阻止发送且零建任务", async () => {
    const { projectId } = await seedIndexedCanvas("IKFM3S invalid", { dropIndexEdge: true });
    const before = await jobCount(projectId);
    const created = await createJob(projectId, imageJobBody("gen-1", "暮色"));
    expect(created.code).toBe(400);
    expect(created.msg).toBe("文本索引存在失效素材，请修复来源文本后提交");
    expect(await jobCount(projectId)).toBe(before);
  });

  it("不支持媒体类型（文本索引视频素材进图片目标）阻止发送", async () => {
    const { projectId } = await seedIndexedCanvas("IKFM3S unsupported", { videoRef: true });
    const before = await jobCount(projectId);
    const created = await createJob(projectId, imageJobBody("gen-1", "暮色"));
    expect(created.code).toBe(400);
    expect(created.msg).toBe("文本索引包含目标不支持的媒体类型，请修改来源文本");
    expect(await jobCount(projectId)).toBe(before);
  });

  it("合并后超模型上限阻止发送（直接参考 + 文本带入联算）", async () => {
    const { projectId, directAssetId } = await seedIndexedCanvas("IKFM3S overflow");
    const before = await jobCount(projectId);
    const created = await createJob(projectId, imageJobBody("gen-1", "暮色", [directAssetId], LIMIT_MODEL_ID));
    expect(created.code).toBe(400);
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
    // 普通文本正文也是文本输入：签名覆盖（空媒体映射），「输入已更新」随正文变化派生
    expect(job!.input.text_input_signature).toBe(
      textInputSignatureOf([{ nodeId: "text-1", text: "赛博朋克", identities: [] }]),
    );
  });

  it("正文变化后新任务签名不同（提示清除依据）；素材删除后提交被存在性复核拒绝", async () => {
    const { projectId, imageAssetId, directAssetId } = await seedIndexedCanvas("IKFM3S signature");
    const first = await createJob(projectId, imageJobBody("gen-1", "暮色", [directAssetId]));
    expect(first.code).toBe(200);
    const firstJob = await readJob(first.data.generation_job_id);
    // 修改正文（保留索引）再提交 → 签名变化
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
    // 素材被删（软删）后提交：文本带入素材存在性复核拒绝（阻止发送，不静默丢）
    await prisma.client.assets.update({ where: { id: BigInt(imageAssetId) }, data: { is_delete: true } });
    const third = await createJob(projectId, imageJobBody("gen-1", "暮色", [directAssetId]));
    expect(third.code).toBe(400);
    expect(third.msg).toBe("参考素材不存在或无权访问");
  });

  it.runIf(process.env.IKFM3S_BROWSER)("browser: 锁定参考进栏、输入已更新提示、成功清除、编辑重现、冻结输入", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFM3S browser")).id;
    const indexedAssetId = await createAsset(projectId, "image", "https://example.com/indexed.png");
    const directAssetId = await createAsset(projectId, "image", "https://example.com/direct.png");
    // 预置：被索引素材 m1 + 直接参考 m2 + 带媒体索引的文本卡 t1（正文 @ 标签经保存 API 落库）+ 图片草稿 d1
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

      // 1) 文本卡连到图片目标：真实拖线 t1 → d1 → 右上角显眼「输入已更新」
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

      // 2) 打开目标面板：文本带入素材以锁定条目进参考栏（无移除入口、有定位入口）+ 文本附件
      await nodeById("d1").locator('[data-testid="media-content"]').click();
      await editor.waitFor();
      await vi.waitFor(async () => expect(await dockRefs.count(), "直接参考 + 文本带入参考").toBe(2));
      const locked = dockRefs.filter({ has: page.locator('button[title="此素材由文本索引提供，请修改来源文本"]') });
      const removable = dockRefs.filter({ has: page.locator('button[title="移除"]') });
      await vi.waitFor(async () => expect(await locked.count(), "文本带入条目锁定（定位入口）").toBe(1));
      await vi.waitFor(async () => expect(await removable.count(), "直接参考可移除").toBe(1));
      // 编号合并：文本素材编号 2（直接参考在前）
      expect(await dockRefs.nth(1).locator('[data-testid="ref-thumb-badge"]').textContent()).toBe("2");

      // 3) 发送：请求体含文本带入素材（前端同源预演，与 Dock 显示一致）
      await editor.click();
      await page.keyboard.type("参考这张图重新绘制");
      await page.locator('button[title="发送"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      expect(generationRequests[0].target_node_id).toBe("d1");
      expect(generationRequests[0].input_asset_ids).toEqual([directAssetId, indexedAssetId]);

      // 4) DB 翻 succeeded 模拟供应商终态：轮询拿签名回写 → 徽标清除
      const jobRow = await prisma.client.generation_jobs.findFirst({ where: { project_id: BigInt(projectId) }, orderBy: { id: "desc" } });
      expect(jobRow).not.toBeNull();
      const outputAsset = await prisma.client.assets.create({ data: { user_id: 987654n, project_id: BigInt(projectId), type: "image", url: "https://example.com/out.png", width: 640, height: 480 } });
      await prisma.client.generation_jobs.update({
        where: { id: jobRow!.id },
        data: { status: "succeeded", progress: 100, output_asset_ids: [outputAsset.id] },
      });
      await vi.waitFor(async () => expect(await badge.count(), "成功使用最新输入后清除提示").toBe(0), { timeout: 15_000 });
      // 回写落盘：目标节点 data.usedInputSignature = 快照签名
      await vi.waitFor(async () => {
        const canvas = await prisma.client.canvas.findUnique({ where: { project_id: BigInt(projectId) } });
        const saved = (canvas!.nodes_json as unknown as Array<{ id: string; data: Record<string, unknown> }>).find((n) => n.id === "d1");
        expect(saved!.data.usedInputSignature).toBe((jobRow!.input as Record<string, unknown>).text_input_signature);
        expect(saved!.data.usedInputJobId).toBe(Number(jobRow!.id));
      }, { timeout: 10_000 });

      // 5) 另一端修改来源正文（真实保存 API）→ 刷新画布：提示重现且刷新后保留
      const canvasRow = await prisma.client.canvas.findUnique({ where: { project_id: BigInt(projectId) } });
      const savedNodes = canvasRow!.nodes_json as unknown as Array<{ id: string; data: Record<string, unknown> }>;
      savedNodes.find((n) => n.id === "t1")!.data.text = "改用图片1重绘这张";
      await saveCanvas(projectId, savedNodes, canvasRow!.edges_json as unknown as unknown[], canvasRow!.version);
      await page.reload();
      await nodeById("d1").waitFor();
      await vi.waitFor(async () => expect(await badge.count(), "正文变化后提示重现（刷新恢复）").toBe(1));
      await page.screenshot({ path: "/tmp/ikfm3s-badge-reappear.png", fullPage: true });

      // 6) 断开文本 → 目标连线：仅解除文本来源，直接参考保留、提示消失
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
});
