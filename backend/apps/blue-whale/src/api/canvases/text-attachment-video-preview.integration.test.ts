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

// IKFCXC「视频文本附件完整预览与生成回归」公开接口集成（IKFCVS 规格）：
// 真 NestFactory 挂载生产 Canvas/Generation 控制器与服务 + 隔离 MySQL（IKFCXC_DATABASE_URL 门控）。
// API 段覆盖「文本附件与媒体参考共存冻结」；浏览器段（IKFCXC_BROWSER=1：完整正文浮层 →
// 长文滚动 → 移入保持/移出关闭 → 面板移除断边（普通附件 ×，IKFCXC）→ 来源更新预览当前正文 →
// 发送冻结完整文本与媒体角色 → 刷新恢复）在同 describe 尾部。
// 本切片不触发任何上游供应商调用，不挂 HTTP 替身；提交后供应商边界的文本消费由
// worker-java VideoJobProcessorTest（记录式供应商边界）覆盖。
describe.skipIf(!process.env.IKFCXC_DATABASE_URL)("Text attachment video preview consistency (IKFCXC)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "ikfcxc-video-model";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKFCXC_DATABASE_URL;
    const sizes = [{ id: "720p", label: "720P", api_value: "720p" }];
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikfcxc-test", model_id: MODEL_ID } },
      create: {
        provider_id: "ikfcxc-test",
        model_id: MODEL_ID,
        capability_type: "video",
        model_label: "IKFCXC Test Video",
        supported_sizes: sizes,
        supported_aspect_ratios: ["16:9"],
        supported_formats: ["mp4"],
        supported_durations: { min: 5, max: 10, step: 1 },
        default_size: "720p",
        default_aspect_ratio: "16:9",
        default_duration: 5,
        features: {},
      },
      update: { supported_sizes: sizes, default_size: "720p" },
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
  async function readJob(jobId: string) {
    const row = await prisma.client.generation_jobs.findUnique({ where: { id: BigInt(jobId) } });
    return row ? { ...row, input: row.input as Record<string, unknown> } : null;
  }

  it("文本附件与媒体参考共存冻结：text_attachments 与 references 各就各位，文本不混入媒体参考（API 段）", async () => {
    const projectId = (await projects.create("987654", "IKFCXC coexist")).id;
    const videoAsset = await prisma.client.assets.create({
      data: { user_id: BigInt(987654), project_id: BigInt(projectId), type: "video", url: "https://example.com/ikfcxc-target.mp4", width: 1280, height: 720, size: BigInt(2048) },
    });
    const firstAsset = await prisma.client.assets.create({
      data: { user_id: BigInt(987654), project_id: BigInt(projectId), type: "image", url: "https://example.com/ikfcxc-first.png", width: 1024, height: 1024, size: BigInt(1024) },
    });
    const nodes = [
      { id: "media-1", type: "mediaNode", position: { x: 900, y: 120 }, data: { mediaType: "video", fileName: "目标视频", assetId: videoAsset.id.toString(), width: 1280, height: 720 } },
      { id: "text-1", type: "textNode", position: { x: 120, y: 140 }, data: { title: "场景描述", text: "赛博朋克" } },
      { id: "text-2", type: "textNode", position: { x: 120, y: 460 }, data: { title: "雨夜", text: "青石板路" } },
      { id: "img-1", type: "mediaNode", position: { x: 520, y: 700 }, data: { mediaType: "image", fileName: "首帧图", assetId: firstAsset.id.toString(), width: 1024, height: 1024 } },
    ];
    const edges = [
      { id: "e-t1-m1", source: "text-1", target: "media-1" },
      { id: "e-t2-m1", source: "text-2", target: "media-1" },
      { id: "e-img-m1", source: "img-1", target: "media-1", data: { refRole: "first" } },
    ];
    expect((await saveCanvas(projectId, nodes, edges, "missing", JSON.stringify({ x: 0, y: 0, zoom: 1 }))).status).toBe(200);

    const created = await createJob(projectId, {
      type: "video",
      target_node_id: "media-1",
      expected_output_count: 1,
      references: [
        { role: "first_frame", asset_id: firstAsset.id.toString(), type: "image" },
      ],
      parameters: { prompt: "", model_id: MODEL_ID, aspect_ratio: "16:9", resolution: "720p", duration: 5 },
    });
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job).not.toBeNull();
    // 冻结的完整文本：按画布连入边序；文本附件不进媒体参考
    expect(job!.input.text_attachments).toEqual([
      { node_id: "text-1", title: "场景描述", text: "赛博朋克" },
      { node_id: "text-2", title: "雨夜", text: "青石板路" },
    ]);
    // 冻结的媒体角色：首帧身份保序，无文本混入（references 无 text 类型）
    expect(job!.input.references).toEqual([
      { role: "first_frame", asset_id: firstAsset.id.toString(), type: "image" },
    ]);
    expect(job!.input.prompt).toBe("");
  });

  // 浏览器段（真实浏览器 + 真实业务 API + 隔离 MySQL）：视频面板完整操作至生成输入闭环。
  // 断言以「请求体 + 库内冻结快照 + 画布边形状」为准——harness 未挂 jobs 查询控制器，
  // 创建后前端轮询 GET /api/jobs/:id 得 404，页面 toast 报错属预期。
  it.runIf(process.env.IKFCXC_BROWSER)("browser: 视频文本附件完整预览与生成回归（悬浮滚动/移入保持/面板移除断边/来源更新/发送冻结/刷新恢复）", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFCXC browser")).id;
    // 长正文：多段落撑出滚动（textCard 上限 280px 高）；末尾标记用于断言滚动到底
    const longBody = Array.from({ length: 24 }, (_, i) => `第${i + 1}段落：蓝鲸在深海里缓慢游动，霓虹灯映在浪尖。`).join("\n");
    const LONG_TAIL_MARK = "末尾标记-VZ9";
    // 首尾帧来源素材（视频目标为草稿卡无需资产；图片参考卡需资产 + src 才能通过来源有效性校验）
    const firstAsset = await prisma.client.assets.create({
      data: { user_id: BigInt(987654), project_id: BigInt(projectId), type: "image", url: "https://example.com/ikfcxc-b-first.png", width: 1024, height: 1024, size: BigInt(1024) },
    });
    const lastAsset = await prisma.client.assets.create({
      data: { user_id: BigInt(987654), project_id: BigInt(projectId), type: "image", url: "https://example.com/ikfcxc-b-last.png", width: 1024, height: 1024, size: BigInt(1024) },
    });
    // 播种：text-1 同时服务两目标（多目标移除断边的持久关系基线），text-2 只进 media-1，
    // text-3 未连线（「从画布选择」加入路径的候选卡）；img-1/img-2 以首帧/尾帧角色连线 media-1
    // （媒体参考与文本附件共存的生成一致性基线——首尾帧需齐全才可发送，enabledVideoFollowModes
    // 的 keyframe 需要 imageCount≥2）。
    // 目标为视频草稿卡（draft: true，IKDMQS 统一草稿绑定）：单击即原位打开面板，且草稿卡是
    // 合法连线目标（成品卡 genKindOf 为 null，@ 新文本建线会被静默拒绝）；draftMode 经
    // videoSeed.params 恢复模式（media-2 用全能参考——无首尾帧连线，keyframe 会被「请补充首帧」阻止发送）。
    // 拖线建立连线的行为已由 IKDLQF 图片浏览器段覆盖，本片聚焦面板侧交互与关系一致性。
    const seeded = await saveCanvas(projectId, [
      { id: "text-1", type: "textNode", position: { x: 120, y: 120 }, data: { title: "场景描述", text: `${longBody}\n${LONG_TAIL_MARK}` } },
      { id: "text-2", type: "textNode", position: { x: 120, y: 440 }, data: { title: "雨夜", text: "青石板路，油纸伞" } },
      { id: "text-3", type: "textNode", position: { x: 120, y: 720 }, data: { title: "旁白草稿", text: "远处灯塔的光扫过海面" } },
      { id: "media-1", type: "mediaNode", position: { x: 880, y: 120 }, data: { mediaType: "video", fileName: "目标视频一", draft: true, draftMode: "keyframe", width: 1280, height: 720 } },
      { id: "media-2", type: "mediaNode", position: { x: 880, y: 460 }, data: { mediaType: "video", fileName: "目标视频二", draft: true, draftMode: "all", width: 1280, height: 720 } },
      { id: "img-1", type: "mediaNode", position: { x: 480, y: 700 }, data: { mediaType: "image", fileName: "首帧图", assetId: firstAsset.id.toString(), src: "https://example.com/ikfcxc-b-first.png", width: 1024, height: 1024 } },
      { id: "img-2", type: "mediaNode", position: { x: 760, y: 700 }, data: { mediaType: "image", fileName: "尾帧图", assetId: lastAsset.id.toString(), src: "https://example.com/ikfcxc-b-last.png", width: 1024, height: 1024 } },
    ], [
      { id: "e-t1-m1", source: "text-1", target: "media-1" },
      { id: "e-t1-m2", source: "text-1", target: "media-2" },
      { id: "e-t2-m1", source: "text-2", target: "media-1" },
      { id: "e-img1-m1", source: "img-1", target: "media-1", data: { refRole: "first" } },
      { id: "e-img2-m1", source: "img-2", target: "media-1", data: { refRole: "last" } },
    ], "missing", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
    expect(seeded.status).toBe(200);

    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const generationRequests: Array<{ body: Record<string, unknown> }> = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && /\/api\/projects\/\d+\/generation-jobs$/.test(request.url())) {
          generationRequests.push({ body: request.postDataJSON() as Record<string, unknown> });
        }
      });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      const text1 = page.locator('.react-flow__node-textNode[data-id="text-1"]');
      const text2 = page.locator('.react-flow__node-textNode[data-id="text-2"]');
      const media1 = page.locator('.react-flow__node-mediaNode[data-id="media-1"]');
      const media2 = page.locator('.react-flow__node-mediaNode[data-id="media-2"]');
      await text1.waitFor();
      await text2.waitFor();
      await media1.waitFor();
      await media2.waitFor();
      await vi.waitFor(async () => expect(await page.locator(".react-flow__edge").count()).toBe(5));

      // 单击视频草稿卡打开面板：文本附件以图标进参考栏（两枚）与首尾帧缩略图共存，无旧独立正文块
      await media1.locator('[data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(2));
      await vi.waitFor(async () =>
        expect(await page.locator('[data-testid="dock-video-ref"] [data-testid="ref-thumb-badge"]').allInnerTexts())
          .toEqual(["首帧", "尾帧"]));
      expect(await page.getByText("文本附件（").count()).toBe(0);

      // 悬浮 text-1 图标：浮层显示完整正文（含末尾标记）、无来源标题；长文可滚动至末尾
      const textThumbs = page.locator('[data-testid="dock-text-ref"]');
      const longThumb = textThumbs.first();
      await longThumb.hover();
      const overlay = page.locator('[data-testid="ref-thumb-preview"]');
      await overlay.waitFor();
      const overlayText = await overlay.innerText();
      expect(overlayText).toContain(longBody.split("\n")[0]!);
      expect(overlayText, "浮层无标题（来源名称不进浮层）").not.toContain("场景描述");
      const scrollable = await overlay.evaluate((el) => {
        const inner = el.firstElementChild as HTMLElement | null;
        return inner ? { scrollHeight: inner.scrollHeight, clientHeight: inner.clientHeight } : null;
      });
      expect(scrollable, "长文超出浮层上限形成滚动区").not.toBeNull();
      expect(scrollable!.scrollHeight).toBeGreaterThan(scrollable!.clientHeight);
      await overlay.evaluate((el) => {
        const inner = el.firstElementChild as HTMLElement;
        inner.scrollTop = inner.scrollHeight;
      });
      await overlay.locator(`text=${LONG_TAIL_MARK}`).waitFor();
      // 移入浮层保持打开；移出图标与浮层后关闭
      const overlayBox = (await overlay.boundingBox())!;
      await page.mouse.move(overlayBox.x + overlayBox.width / 2, overlayBox.y + overlayBox.height / 2);
      await page.waitForTimeout(400);
      expect(await overlay.count(), "鼠标移入浮层保持打开").toBe(1);
      await page.mouse.move(120, 60);
      await page.waitForTimeout(400);
      expect(await overlay.count(), "移出图标与浮层后关闭").toBe(0);

      // 面板移除 text-1（IKFCXC 普通附件 ×）：仅断 text-1→media-1；其余目标关系与首尾帧连线保留，来源卡仍在
      const removeSaved = page.waitForResponse((response) =>
        response.request().method() === "PUT" && response.url().includes("/api/canvases/"));
      await longThumb.locator('button[title="移除"]').click();
      expect((await removeSaved).status(), "面板移除断边参与自动保存").toBe(200);
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(1));
      const afterRemove = await getCanvas(projectId);
      const edgePairs = (JSON.parse(afterRemove.edges) as Array<{ source: string; target: string }>)
        .map((e) => `${e.source}->${e.target}`).sort();
      expect(edgePairs, "画布断线得到相同结果").toEqual(["img-1->media-1", "img-2->media-1", "text-1->media-2", "text-2->media-1"]);
      expect(await text1.count(), "来源文本卡保留").toBe(1);
      expect(await page.locator(".react-flow__edge").count()).toBe(4);

      // 从画布选择加入（@ 菜单 → 引用画布素材）：已在附件中的文本直接插标签不重复建线（同一来源去重）
      const panelEditor = page.locator("[contenteditable=true]");
      await panelEditor.click();
      await page.keyboard.type("@");
      await page.locator('[data-testid="mention-menu"]').waitFor();
      await page.getByRole("button", { name: "引用画布素材" }).click();
      const canvasMenu = page.getByPlaceholder("搜索");
      await canvasMenu.fill("雨夜");
      await page.locator('[data-testid="at-mention-canvas-item"]', { hasText: "雨夜" }).click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count(), "已在附件中的文本不重复建线").toBe(1));
      expect(await page.locator(".react-flow__edge").count(), "提及不新增连线").toBe(4);

      // 从画布选择新文本卡：建线加入附件栏（多来源各自独立），连线参与自动保存
      const connectSaved = page.waitForResponse((response) =>
        response.request().method() === "PUT" && response.url().includes("/api/canvases/"));
      await panelEditor.click();
      await page.keyboard.type("@");
      await page.locator('[data-testid="mention-menu"]').waitFor();
      await page.getByRole("button", { name: "引用画布素材" }).click();
      await canvasMenu.fill("旁白草稿");
      await page.locator('[data-testid="at-mention-canvas-item"]', { hasText: "旁白草稿" }).click();
      expect((await connectSaved).status(), "新文本卡连线参与自动保存").toBe(200);
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count(), "新来源独立加入附件栏").toBe(2));
      expect(await page.locator(".react-flow__edge").count()).toBe(5);

      // 来源编辑：text-2 改文后面板预览使用当前正文（草稿绑定实时跟随连线）
      await text2.locator('[data-testid="text-title"]').click();
      const editor = text2.locator('[data-placeholder="输入内容..."]');
      await editor.dblclick();
      const editSaved = page.waitForResponse((response) =>
        response.request().method() === "PUT" && response.url().includes("/api/canvases/"));
      await editor.fill("雨后的巷子，猫在檐下躲雨");
      await page.locator(".react-flow__pane").click({ position: { x: 60, y: 250 } });
      expect((await editSaved).status(), "来源正文编辑自动保存").toBe(200);
      // 回到目标面板（单击目标重绑定刷新快照；草稿绑定下附件实时跟随连线），预览使用当前正文
      await media1.locator('[data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(2));
      await page.locator('[data-testid="dock-text-ref"]').first().hover();
      await overlay.waitFor();
      expect(await overlay.innerText(), "来源正文修改后再次预览使用当前正文").toContain("雨后的巷子，猫在檐下躲雨");

      // 发送（清空 @ 插入的正文标签，空提示词、附件驱动）：请求体带 target/references（首尾帧），
      // 库内冻结完整文本与媒体角色
      await panelEditor.click();
      await page.keyboard.press("Meta+a");
      await page.keyboard.press("Backspace");
      expect(generationRequests).toEqual([]);
      await page.locator('button[title="发送"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      expect(generationRequests[0].body.type).toBe("video");
      expect(generationRequests[0].body.target_node_id).toBe("media-1");
      expect(generationRequests[0].body.references).toEqual([
        { role: "first_frame", type: "image", asset_id: firstAsset.id.toString() },
        { role: "last_frame", type: "image", asset_id: lastAsset.id.toString() },
      ]);
      await vi.waitFor(async () =>
        expect(await prisma.client.generation_jobs.count({ where: { project_id: BigInt(projectId) } })).toBe(1), { timeout: 10_000 });
      const rows = await prisma.client.generation_jobs.findMany({
        where: { project_id: BigInt(projectId) }, orderBy: { id: "asc" },
      });
      const input = rows[0].input as Record<string, unknown>;
      expect(input.target_node_id).toBe("media-1");
      expect(input.prompt).toBe("");
      expect(input.text_attachments, "任务冻结移除后剩余附件的最新正文（连入边序：text-2 播种在先、text-3 新连在后）").toEqual([
        { node_id: "text-2", title: "雨夜", text: "雨后的巷子，猫在檐下躲雨" },
        { node_id: "text-3", title: "旁白草稿", text: "远处灯塔的光扫过海面" },
      ]);
      expect(input.references, "媒体角色冻结：首尾帧保留，文本不成为媒体参考").toEqual([
        { role: "first_frame", asset_id: firstAsset.id.toString(), type: "image" },
        { role: "last_frame", asset_id: lastAsset.id.toString(), type: "image" },
      ]);

      // 刷新画布：关系随保存恢复，media-2 面板图标与连线一致（text-1 多目标另一侧）
      await page.reload();
      await text1.waitFor();
      await media2.waitFor();
      await vi.waitFor(async () => expect(await page.locator(".react-flow__edge").count()).toBe(5));
      await media2.locator('[data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(1));
      await page.locator('[data-testid="dock-text-ref"]').first().hover();
      await overlay.waitFor();
      expect(await overlay.innerText()).toContain(longBody.split("\n")[0]!);
      const reloaded = await getCanvas(projectId);
      expect((JSON.parse(reloaded.edges) as Array<{ source: string; target: string }>)
        .map((e) => `${e.source}->${e.target}`).sort()).toEqual(["img-1->media-1", "img-2->media-1", "text-1->media-2", "text-2->media-1", "text-3->media-1"]);

      // 目标切换后的第二目标发送（多目标各自独立）：media-2 任务只冻结自己的附件（text-1 长文），
      // 无媒体参考；media-1 历史任务快照不被后续编辑/新任务改写
      await page.locator('button[title="发送"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(2), { timeout: 10_000 });
      expect(generationRequests[1].body.target_node_id).toBe("media-2");
      expect(generationRequests[1].body.references, "media-2 无媒体参考，正文不携带 references").toBeUndefined();
      await vi.waitFor(async () =>
        expect(await prisma.client.generation_jobs.count({ where: { project_id: BigInt(projectId) } })).toBe(2), { timeout: 10_000 });
      const allRows = await prisma.client.generation_jobs.findMany({
        where: { project_id: BigInt(projectId) }, orderBy: { id: "asc" },
      });
      const secondInput = allRows[1].input as Record<string, unknown>;
      expect(secondInput.target_node_id).toBe("media-2");
      expect(secondInput.prompt).toBe("");
      expect(secondInput.text_attachments).toEqual([
        { node_id: "text-1", title: "场景描述", text: `${longBody}\n${LONG_TAIL_MARK}` },
      ]);
      const firstInputAfter = allRows[0].input as Record<string, unknown>;
      expect(firstInputAfter.text_attachments, "历史任务快照不改写").toEqual([
        { node_id: "text-2", title: "雨夜", text: "雨后的巷子，猫在檐下躲雨" },
        { node_id: "text-3", title: "旁白草稿", text: "远处灯塔的光扫过海面" },
      ]);
      await page.screenshot({ path: "/tmp/ikfcxc-browser.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 150_000);
});
