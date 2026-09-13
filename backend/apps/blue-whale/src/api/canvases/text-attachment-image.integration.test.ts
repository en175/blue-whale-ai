import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasesController } from "./canvases.controller.js";
import { GenerationJobsController } from "../generation/generation-jobs.controller.js";
import { GenerationModelsController } from "../generation/models.controller.js";
import { ProjectsController } from "../projects/projects.controller.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";
import { GenerationCommandService } from "@lib/shared/generation/generation-command.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { GenerationCostEstimatorService } from "@lib/shared/generation/cost-estimator.service.js";

// IKDLQF「单个文本附件驱动图片生成」公开接口集成（契约「验证」节服务端项）：
// 真 NestFactory 挂载生产 Canvas/Generation 控制器与服务 + 隔离 MySQL（IKDLQF_DATABASE_URL 门控）。
// 本切片的 API 链路不产生任何上游 HTTP 调用（无 Agent 读、供应商调用在 worker 切片），
// 故不挂内存 HTTP 替身；生成入队（RocketMQ）未配置时由控制器捕获记日志，不影响断言。
// 浏览器段（IKDLQF_BROWSER=1：连线 → 面板见附件 → 生成 → 刷新恢复）在同 describe 尾部，
// 另挂 ProjectsController（快照水合）与 GenerationModelsController（面板模型目录）。
describe.skipIf(!process.env.IKDLQF_DATABASE_URL)("Text attachment image public API (IKDLQF)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "ikdlqf-image-model";
  const VIDEO_MODEL_ID = "ikdlqf-video-model";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKDLQF_DATABASE_URL;
    // supported_sizes 用前端原生 {id,label} 形态：浏览器段 ImageDialog 按此渲染清晰度选项
    //（API 段不读模型目录；创建链路不校验 size 取值，只透传）
    const sizes = [{ id: "1024x1024", label: "1024x1024" }];
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikdlqf-test", model_id: MODEL_ID } },
      create: {
        provider_id: "ikdlqf-test",
        model_id: MODEL_ID,
        capability_type: "image",
        model_label: "IKDLQF Test",
        supported_sizes: sizes,
        supported_aspect_ratios: ["1:1"],
        supported_formats: ["png"],
        default_size: "1024x1024",
        default_aspect_ratio: "1:1",
        features: {},
      },
      update: { supported_sizes: sizes, default_size: "1024x1024" },
    });
    // 视频模型（IKDLQG 起 target_node_id 支持视频）：「视频类型携带」用例需要合法视频模型走到目标类型校验
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikdlqf-test", model_id: VIDEO_MODEL_ID } },
      create: {
        provider_id: "ikdlqf-test",
        model_id: VIDEO_MODEL_ID,
        capability_type: "video",
        model_label: "IKDLQF Test Video",
        supported_sizes: [{ id: "720p", label: "720P", api_value: "720p" }],
        supported_aspect_ratios: ["16:9"],
        supported_formats: ["mp4"],
        supported_durations: { min: 5, max: 10, step: 1 },
        default_size: "720p",
        default_aspect_ratio: "16:9",
        default_duration: 5,
        features: {},
      },
      update: {},
    });
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, GenerationCostEstimatorService, CanvasService], GenerationJobsController);
    Reflect.defineMetadata("design:paramtypes", [ModelCapabilityReadService], GenerationModelsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
    class HarnessModule {}
    Module({ controllers: [CanvasesController, GenerationJobsController, GenerationModelsController, ProjectsController], providers: [
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

  function textNode(id: string, text: string, title = "文本") {
    return { id, type: "textNode", position: { x: 0, y: 0 }, data: { title, text } };
  }
  function mediaNode(id: string, mediaType: "image" | "video") {
    return { id, type: "mediaNode", position: { x: 0, y: 0 }, data: { mediaType } };
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
  function imageJobBody(targetNodeId: string | undefined, prompt: string) {
    return {
      type: "image",
      ...(targetNodeId !== undefined ? { target_node_id: targetNodeId } : {}),
      expected_output_count: 1,
      parameters: { prompt, model_id: MODEL_ID, aspect_ratio: "1:1" },
    };
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

  it("连线随 PUT 保存并在 GET 读取时恢复（缺省为空数组）", async () => {
    const projectId = (await projects.create("987654", "IKDLQF edges roundtrip")).id;
    // e2 为媒体卡自环（素材原卡重新编辑引用自身）：合法保存并随 GET 原样恢复（契约 2026-09-11 修订）
    const edges = [
      { id: "e1", source: "text-1", target: "media-1" },
      { id: "e2", source: "media-1", target: "media-1" },
    ];
    const saved = await saveCanvas(projectId, [textNode("text-1", "正文"), mediaNode("media-1", "image")], edges, "missing");
    expect(saved.status).toBe(200);
    const canvas = await getCanvas(projectId);
    expect(JSON.parse(canvas.edges)).toEqual(edges);
    // 重新读取（等价刷新/重开）连线仍在；创建路径版本从 0 起（首次条件更新才递增）
    const reloaded = await getCanvas(projectId);
    expect(JSON.parse(reloaded.edges)).toEqual(edges);
    expect(reloaded.version).toBe(canvas.version);
  });

  it("非法边（悬空端点/重复/超 500 条）明确失败且零写入", async () => {
    const projectId = (await projects.create("987654", "IKDLQF invalid edges")).id;
    const nodes = [textNode("text-1", "正文"), mediaNode("media-1", "image")];
    expect((await saveCanvas(projectId, nodes, [], "missing")).status).toBe(200);
    const before = await getCanvas(projectId);

    const dangling = await saveCanvas(projectId, nodes, [{ id: "e9", source: "text-1", target: "ghost" }], before.version);
    expect(dangling.status).toBe(400);
    expect((await dangling.json()).message).toBe("连线端点必须引用本次保存的画布节点，原内容未改动");

    const duplicate = await saveCanvas(projectId, nodes, [
      { id: "e1", source: "text-1", target: "media-1" },
      { id: "e2", source: "text-1", target: "media-1" },
    ], before.version);
    expect(duplicate.status).toBe(400);
    expect((await duplicate.json()).message).toBe("同一对节点之间只允许一条连线，原内容未改动");

    const manyNodeIds = Array.from({ length: 24 }, (_, i) => `n${i}`);
    const manyNodes = manyNodeIds.map((id) => textNode(id, "x"));
    const tooMany: Array<{ id: string; source: string; target: string }> = [];
    for (const source of manyNodeIds) {
      for (const target of manyNodeIds) {
        if (tooMany.length < 501) tooMany.push({ id: `e${tooMany.length}`, source, target });
      }
    }
    const overLimit = await saveCanvas(projectId, manyNodes, tooMany, before.version);
    expect(overLimit.status).toBe(400);
    expect((await overLimit.json()).message).toBe("连线数量超过 500 条上限，原内容未改动");

    expect(await getCanvas(projectId)).toEqual(before);
  });

  it("携带 target_node_id 创建：冻结的 text_attachments 与当时画布一致（edges 顺序）", async () => {
    const projectId = (await projects.create("987654", "IKDLQF snapshot")).id;
    const nodes = [
      mediaNode("media-1", "image"),
      { id: "text-b", type: "textNode", position: { x: 0, y: 0 }, data: { text: "雨夜" } },
      textNode("text-a", "赛博朋克", "风格"),
      mediaNode("media-2", "image"),
    ];
    const edges = [
      { id: "e1", source: "text-b", target: "media-1" },
      { id: "e2", source: "text-a", target: "media-1" },
      { id: "e3", source: "text-a", target: "media-2" },
    ];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const created = await createJob(projectId, imageJobBody("media-1", "暮色"));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job).not.toBeNull();
    expect(job!.input.target_node_id).toBe("media-1");
    expect(job!.input.prompt).toBe("暮色");
    // 与当时画布一致：仅 target=media-1 且 source 为 textNode 的边，按 edges 数组顺序；title 缺省 ""
    expect(job!.input.text_attachments).toEqual([
      { node_id: "text-b", title: "", text: "雨夜" },
      { node_id: "text-a", title: "风格", text: "赛博朋克" },
    ]);
  });

  it("目标缺失 / 非图片 mediaNode / 视频类型携带 / 他人项目 → 明确失败不建任务", async () => {
    const projectId = (await projects.create("987654", "IKDLQF bad target")).id;
    const nodes = [mediaNode("media-1", "image"), mediaNode("media-v", "video"), textNode("text-1", "正文")];
    const edges = [{ id: "e1", source: "text-1", target: "media-1" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const missing = await createJob(projectId, imageJobBody("ghost", "暮色"));
    expect(missing.code).toBe(400);
    expect(missing.msg).toBe("目标节点不存在或不是图片媒体节点");

    const videoTarget = await createJob(projectId, imageJobBody("media-v", "暮色"));
    expect(videoTarget.code).toBe(400);
    expect(videoTarget.msg).toBe("目标节点不存在或不是图片媒体节点");

    // IKDLQG 起 target_node_id 支持视频；此处图片节点作为视频目标 → 目标类型不匹配明确失败
    const videoType = await createJob(projectId, {
      type: "video",
      target_node_id: "media-1",
      expected_output_count: 1,
      parameters: { prompt: "暮色", model_id: VIDEO_MODEL_ID, aspect_ratio: "16:9", resolution: "720p", duration: 5 },
    });
    expect(videoType.code).toBe(400);
    expect(videoType.msg).toBe("目标节点不存在或不是视频媒体节点");

    expect(await jobCount(projectId)).toBe(0);

    const otherProject = (await projects.create("987655", "IKDLQF ownership")).id;
    const denied = await createJob(otherProject, imageJobBody("media-1", "暮色"));
    expect(denied.code).toBe(100301);
    expect(await jobCount(otherProject)).toBe(0);
  });

  it("仅附件正文、prompt 为空字符串 → 创建成功，prompt 冻结为空串", async () => {
    const projectId = (await projects.create("987654", "IKDLQF empty prompt")).id;
    const nodes = [mediaNode("media-1", "image"), textNode("text-1", "独立正文", "附件")];
    const edges = [{ id: "e1", source: "text-1", target: "media-1" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const created = await createJob(projectId, imageJobBody("media-1", ""));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.prompt).toBe("");
    expect(job!.input.text_attachments).toEqual([{ node_id: "text-1", title: "附件", text: "独立正文" }]);
  });

  it("组合后超过 30000 字 → 明确失败、不创建任务", async () => {
    const projectId = (await projects.create("987654", "IKDLQF composed limit")).id;
    const nodes = [mediaNode("media-1", "image"), textNode("text-1", "文".repeat(31_000))];
    const edges = [{ id: "e1", source: "text-1", target: "media-1" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const created = await createJob(projectId, imageJobBody("media-1", ""));
    expect(created.code).toBe(400);
    expect(created.msg).toBe("文本附件与提示词组合后超过 30000 字上限");
    expect(await jobCount(projectId)).toBe(0);
  });

  it("删除来源节点与边后新任务不再消费该附件，历史任务快照不改写", async () => {
    const projectId = (await projects.create("987654", "IKDLQF detach source")).id;
    const nodes = [mediaNode("media-1", "image"), textNode("text-1", "赛博朋克", "风格")];
    const edges = [{ id: "e1", source: "text-1", target: "media-1" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const first = await createJob(projectId, imageJobBody("media-1", "暮色"));
    expect(first.code).toBe(200);

    const canvas = await getCanvas(projectId);
    const detached = await saveCanvas(projectId, [mediaNode("media-1", "image")], [], canvas.version);
    expect(detached.status).toBe(200);

    const second = await createJob(projectId, imageJobBody("media-1", "暮色"));
    expect(second.code).toBe(200);
    const secondJob = await readJob(second.data.generation_job_id);
    expect(secondJob!.input.text_attachments).toEqual([]);
    expect(secondJob!.input.prompt).toBe("暮色");

    const firstJob = await readJob(first.data.generation_job_id);
    expect(firstJob!.input.text_attachments).toEqual([{ node_id: "text-1", title: "风格", text: "赛博朋克" }]);
  });

  it("重试复制原 input 快照（含 text_attachments），不回读来源节点", async () => {
    const projectId = (await projects.create("987654", "IKDLQF retry snapshot")).id;
    const nodes = [mediaNode("media-1", "image"), textNode("text-1", "原始正文", "风格")];
    const edges = [{ id: "e1", source: "text-1", target: "media-1" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);
    const first = await createJob(projectId, imageJobBody("media-1", "暮色"));
    expect(first.code).toBe(200);
    const originalJobId = first.data.generation_job_id as string;

    // 接纳后改写正文并断开连线：重试不得回读这些变更
    const canvas = await getCanvas(projectId);
    const edited = await saveCanvas(projectId, [mediaNode("media-1", "image"), textNode("text-1", "改写后正文", "风格")], [], canvas.version);
    expect(edited.status).toBe(200);

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
      headers: { "content-type": "application/json", "idempotency-key": "ikdlqf-retry-1" },
      body: JSON.stringify({}),
    })).json();
    expect(retried.code).toBe(200);

    const original = await readJob(originalJobId);
    const retry = await readJob(retried.data.generation_job_id);
    expect(retry!.input).toEqual(original!.input);
    expect(retry!.input.text_attachments).toEqual([{ node_id: "text-1", title: "风格", text: "原始正文" }]);
  });

  // 浏览器段（契约「验证」节）：真实浏览器 + 真实业务 API + 隔离 MySQL 走完整生图路径。
  // 模式仿 IKDLQE prompt-preview 浏览器段；断言以「请求体 + 库内冻结快照」为准——
  // harness 未挂 jobs 查询控制器，创建后前端轮询 GET /api/jobs/:id 得 404，页面 toast 报错属预期。
  it.runIf(process.env.IKDLQF_BROWSER)("browser: connect → panel attachment → generate → reload restores", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKDLQF browser")).id;
    // 播种素材：快照资产字典是前端还原 mediaNode src 的唯一来源（无 assetId 会渲染「素材已被删除」）
    const asset = await prisma.client.assets.create({
      data: {
        user_id: BigInt(987654),
        project_id: BigInt(projectId),
        type: "image",
        url: "https://example.com/ikdlqf-target.png",
        width: 1024,
        height: 1024,
        size: BigInt(2048),
      },
    });
    const assetId = asset.id.toString();
    // 先建节点不带边（连线由浏览器拖线产生）；viewport 须为合法 {x,y,zoom}，"{}" 会让前端视口 NaN。
    // media-1 置于右下：选中态工具条在节点上方（须避开视口上沿），且避开出生点（视口中心 ±80）的生成占位节点。
    const seeded = await saveCanvas(projectId, [
      { id: "text-1", type: "textNode", position: { x: 140, y: 160 }, data: { title: "雨夜", text: "赛博朋克" } },
      { id: "media-1", type: "mediaNode", position: { x: 900, y: 120 }, data: { mediaType: "image", fileName: "目标图", assetId, width: 1024, height: 1024 } },
    ], [], "missing", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
    expect(seeded.status).toBe(200);

    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      // 只捕获创建调用（不含 retry/cancel 子路径），用于断言「连接/编辑不自动执行」与请求体
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
      const text = page.locator('.react-flow__node-textNode[data-id="text-1"]');
      const media = page.locator('.react-flow__node-mediaNode[data-id="media-1"]');
      await text.waitFor();
      await media.waitFor();

      // 拖线：文本节点 source handle（右）→ 图片节点 target handle（左）。
      // 命中证据用行为级断言（边渲染 + PUT 落库 + GET 边形状），不用 RF 内部 hover 类名
      // （IKFCVS 测试决策：样式类名不作为业务正确性证据；类名随 RF 版本与节点形态漂移）
      await text.locator('[data-testid="text-title"]').click();
      const connectSaved = page.waitForResponse((response) =>
        response.request().method() === "PUT" && response.url().includes("/api/canvases/"));
      const srcBox = (await text.locator(".react-flow__handle-right").boundingBox())!;
      const dstBox = (await media.locator(".react-flow__handle-left").boundingBox())!;
      await page.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
      await page.mouse.down();
      const dstPoint = { x: dstBox.x + dstBox.width / 2, y: dstBox.y + dstBox.height / 2 };
      await page.mouse.move(dstPoint.x, dstPoint.y, { steps: 12 });
      await page.mouse.up();
      await vi.waitFor(async () => {
        expect(await page.locator(".react-flow__edge").count(), "连线应渲染（showEdges 默认可见）").toBe(1);
      });
      expect((await connectSaved).status(), "连线增删参与自动保存").toBe(200);
      const connected = await getCanvas(projectId);
      expect(JSON.parse(connected.edges)).toEqual([
        expect.objectContaining({ source: "text-1", target: "media-1" }),
      ]);
      // 连线与到此为止的编辑均不触发任何生成
      expect(generationRequests).toEqual([]);

      // 从图片节点工具条打开面板：文本附件以图标进参考栏（IKFCKN 起旧独立正文块下线），
      // 悬浮浮层显示来源完整正文，目标提示词留白
      await media.locator('[data-testid="media-content"]').click();
      await media.getByRole("button", { name: "生成图片" }).click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(1));
      await page.locator('[data-testid="dock-text-ref"]').first().hover();
      const overlay = page.locator('[data-testid="ref-thumb-preview"]');
      await overlay.waitFor();
      expect(await overlay.innerText()).toContain("赛博朋克");
      expect(await page.locator("textarea").inputValue(), "目标提示词留白").toBe("");

      // 第一次发送：请求体携带 target_node_id，库内冻结附件快照与当时画布一致，prompt 冻结为 ""
      await page.locator('button[title="发送"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      expect(generationRequests[0].body.target_node_id).toBe("media-1");
      expect((generationRequests[0].body.parameters as Record<string, unknown>).prompt).toBe("");
      await vi.waitFor(async () => expect(await jobCount(projectId)).toBe(1), { timeout: 10_000 });
      const firstRows = await prisma.client.generation_jobs.findMany({
        where: { project_id: BigInt(projectId) }, orderBy: { id: "asc" },
      });
      const firstInput = firstRows[0].input as Record<string, unknown>;
      expect(firstInput.target_node_id).toBe("media-1");
      expect(firstInput.prompt).toBe("");
      expect(firstInput.text_attachments).toEqual([{ node_id: "text-1", title: "雨夜", text: "赛博朋克" }]);

      // 编辑正文 → 自动保存；编辑本身不触发第二次生成
      const editor = text.locator('[data-placeholder="输入内容..."]');
      await editor.dblclick();
      const editSaved = page.waitForResponse((response) =>
        response.request().method() === "PUT" && response.url().includes("/api/canvases/"));
      await editor.fill("霓虹都市");
      await page.locator(".react-flow__pane").click({ position: { x: 80, y: 800 } });
      expect((await editSaved).status()).toBe(200);
      expect(generationRequests, "编辑正文不自动执行").toHaveLength(1);

      // 再次从面板发送：新任务读取最新正文，历史任务快照不改写
      await media.locator('[data-testid="media-content"]').click();
      await media.getByRole("button", { name: "生成图片" }).click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(1));
      await page.locator('[data-testid="dock-text-ref"]').first().hover();
      await overlay.waitFor();
      expect(await overlay.innerText()).toContain("霓虹都市");
      await page.locator('button[title="发送"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(2), { timeout: 10_000 });
      expect(generationRequests[1].body.target_node_id).toBe("media-1");
      await vi.waitFor(async () => expect(await jobCount(projectId)).toBe(2), { timeout: 10_000 });
      const rows = await prisma.client.generation_jobs.findMany({
        where: { project_id: BigInt(projectId) }, orderBy: { id: "asc" },
      });
      expect((rows[1].input as Record<string, unknown>).text_attachments).toEqual([
        { node_id: "text-1", title: "雨夜", text: "霓虹都市" },
      ]);
      expect((rows[0].input as Record<string, unknown>).text_attachments).toEqual([
        { node_id: "text-1", title: "雨夜", text: "赛博朋克" },
      ]);

      // 刷新：连线恢复渲染，GET edges 仍为该边
      await page.reload();
      await text.waitFor();
      await media.waitFor();
      await vi.waitFor(async () => {
        expect(await page.locator(".react-flow__edge").count(), "刷新后连线恢复渲染").toBe(1);
      });
      const reloaded = await getCanvas(projectId);
      expect(JSON.parse(reloaded.edges)).toEqual([
        expect.objectContaining({ source: "text-1", target: "media-1" }),
      ]);
      await page.screenshot({ path: "/tmp/ikdlqf-browser.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 90_000);
});
