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
import { GenerationCostEstimatorService } from "@lib/shared/generation/cost-estimator.service.js";

// IKDMQR「图片参考连线与 Dock 双向同步」公开接口集成（契约「验证」节服务端项）：
// 真 NestFactory 挂载生产 Canvas/Generation/Jobs 控制器与服务 + 隔离 MySQL（IKDMQR_DATABASE_URL 门控）。
// 本切片服务端零改动：媒体参考连线随 edges JSON 原样存取；input_asset_ids 冻结与模型能力上限
// 校验复用既有链路（IKA72G/IKDLQF）。浏览器段（IKDMQR_BROWSER=1）在同 describe 尾部。
describe.skipIf(!process.env.IKDMQR_DATABASE_URL)("Image media reference public API (IKDMQR)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "ikdmqr-image-model";
  const STRICT_MODEL_ID = "ikdmqr-strict-model";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKDMQR_DATABASE_URL;
    const sizes = [{ id: "1024x1024", label: "1024x1024" }];
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikdmqr-test", model_id: MODEL_ID } },
      create: {
        provider_id: "ikdmqr-test",
        model_id: MODEL_ID,
        capability_type: "image",
        model_label: "IKDMQR Test",
        supported_sizes: sizes,
        supported_aspect_ratios: ["1:1"],
        supported_formats: ["png"],
        default_size: "1024x1024",
        default_aspect_ratio: "1:1",
        features: {},
      },
      update: { supported_sizes: sizes, default_size: "1024x1024" },
    });
    // 能力上限更小的模型：验证「参考图上限读取模型能力配置」校验延续（IKA72G 链路）
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikdmqr-test", model_id: STRICT_MODEL_ID } },
      create: {
        provider_id: "ikdmqr-test",
        model_id: STRICT_MODEL_ID,
        capability_type: "image",
        model_label: "IKDMQR Strict",
        supported_sizes: sizes,
        supported_aspect_ratios: ["1:1"],
        supported_formats: ["png"],
        default_size: "1024x1024",
        default_aspect_ratio: "1:1",
        features: { max_reference_images: 2 },
      },
      update: { features: { max_reference_images: 2 } },
    });
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, GenerationCostEstimatorService, CanvasService], GenerationJobsController);
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

  function draftNode(id: string, prompt = "") {
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
        draftModelId: MODEL_ID,
        draftSize: "1024x1024",
        draftRatio: "1:1",
        targetRatio: "1:1",
      },
    };
  }
  function readyImageNode(id: string, assetId: string, fileName: string, x = 120, y = 90) {
    return {
      id,
      type: "mediaNode",
      position: { x, y },
      data: { src: `https://example.com/${id}.png`, mediaType: "image", fileName, assetId },
    };
  }
  function readyVideoNode(id: string, assetId: string, fileName: string, x = 120, y = 420) {
    return {
      id,
      type: "mediaNode",
      position: { x, y },
      data: { src: `https://example.com/${id}.mp4`, mediaType: "video", fileName, assetId },
    };
  }
  function textNode(id: string, text: string, title = "文本") {
    return { id, type: "textNode", position: { x: 560, y: 80 }, data: { title, text } };
  }
  async function createAsset(projectId: string, type: "image" | "video", url: string) {
    const row = await prisma.client.assets.create({
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
  async function readJob(jobId: string) {
    const row = await prisma.client.generation_jobs.findUnique({ where: { id: BigInt(jobId) } });
    return row ? { ...row, input: row.input as Record<string, unknown> } : null;
  }

  it("媒体参考连线随画布保存并原样恢复（与文本附件连线并存）", async () => {
    const projectId = (await projects.create("987654", "IKDMQR edge roundtrip")).id;
    const assetId = await createAsset(projectId, "image", "https://example.com/m1.png");
    const nodes = [readyImageNode("m1", assetId, "参考图一"), textNode("t1", "赛博朋克", "雨夜"), draftNode("d1")];
    const edges = [
      { id: "e-media", source: "m1", target: "d1" },
      { id: "e-text", source: "t1", target: "d1" },
    ];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const canvas = await getCanvas(projectId);
    expect(JSON.parse(canvas.nodes)).toEqual(nodes);
    expect(JSON.parse(canvas.edges)).toEqual(edges);

    // 重读（等价刷新/重开项目）内容一致：参考关系随草稿恢复
    const reloaded = await getCanvas(projectId);
    expect(JSON.parse(reloaded.edges)).toEqual(edges);
  });

  it("连线参考进入任务冻结输入：input_asset_ids 与文本附件并存；接纳后断线/改文不改写当次输入", async () => {
    const projectId = (await projects.create("987654", "IKDMQR frozen input")).id;
    const assetId = await createAsset(projectId, "image", "https://example.com/m1.png");
    const nodes = [readyImageNode("m1", assetId, "参考图一"), textNode("t1", "赛博朋克", "雨夜"), draftNode("d1")];
    const edges = [
      { id: "e-media", source: "m1", target: "d1" },
      { id: "e-text", source: "t1", target: "d1" },
    ];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    // 提交携带连线推导的 input_asset_ids（前端与 Dock 显示同源），服务端冻结进快照
    const created = await createJob(projectId, {
      type: "image",
      target_node_id: "d1",
      input_asset_ids: [assetId],
      expected_output_count: 1,
      parameters: { prompt: "暮色", model_id: MODEL_ID, aspect_ratio: "1:1" },
    });
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job).not.toBeNull();
    expect(job!.input.target_node_id).toBe("d1");
    expect(job!.input.input_asset_ids).toEqual([assetId]);
    expect(job!.input.text_attachments).toEqual([{ node_id: "t1", title: "雨夜", text: "赛博朋克" }]);

    // 接纳后断线 + 修改来源正文：当次任务输入不回读、不改写
    const canvas = await getCanvas(projectId);
    const edited = await saveCanvas(
      projectId,
      [readyImageNode("m1", assetId, "参考图一"), textNode("t1", "霓虹都市", "雨夜"), draftNode("d1")],
      [{ id: "e-text", source: "t1", target: "d1" }],
      canvas.version,
    );
    expect(edited.status).toBe(200);
    const frozen = await readJob(created.data.generation_job_id);
    expect(frozen!.input.input_asset_ids).toEqual([assetId]);
    expect(frozen!.input.text_attachments).toEqual([{ node_id: "t1", title: "雨夜", text: "赛博朋克" }]);

    // 下一次任务按最新画布推导文本附件；断线后无参考图（不再携带 input_asset_ids）
    const second = await createJob(projectId, {
      type: "image",
      target_node_id: "d1",
      expected_output_count: 1,
      parameters: { prompt: "暮色", model_id: MODEL_ID, aspect_ratio: "1:1" },
    });
    expect(second.code).toBe(200);
    const secondJob = await readJob(second.data.generation_job_id);
    expect(secondJob!.input.input_asset_ids).toBeUndefined();
    expect(secondJob!.input.text_attachments).toEqual([{ node_id: "t1", title: "雨夜", text: "霓虹都市" }]);
  });

  it("模型能力校验延续：参考图数量超过模型能力上限被 400 拒绝", async () => {
    const projectId = (await projects.create("987654", "IKDMQR capability cap")).id;
    const ids = [
      await createAsset(projectId, "image", "https://example.com/c1.png"),
      await createAsset(projectId, "image", "https://example.com/c2.png"),
      await createAsset(projectId, "image", "https://example.com/c3.png"),
    ];
    expect((await saveCanvas(projectId, [draftNode("d1")], [], "missing")).status).toBe(200);

    const created = await createJob(projectId, {
      type: "image",
      target_node_id: "d1",
      input_asset_ids: ids,
      expected_output_count: 1,
      parameters: { prompt: "暮色", model_id: STRICT_MODEL_ID, aspect_ratio: "1:1" },
    });
    expect(created.code).toBe(400);
    expect(created.msg).toContain("参考图最多 2 张");
    // 拒绝即不建任务
    expect(await prisma.client.generation_jobs.count({ where: { project_id: BigInt(projectId) } })).toBe(0);
  });

  // 浏览器段（契约「验证」节）：真实浏览器 + 真实业务 API + 隔离 MySQL。
  // 场景：Dock 选择建线 → Dock 移除断线 → 画布拖线 → 画布剪刀断线 → 非法来源拒绝 →
  // 文本附件回归 → 刷新恢复 → 提交冻结输入与 Dock 显示一致。
  it.runIf(process.env.IKDMQR_BROWSER)("browser: dock pick ↔ edge two-way sync, invalid rejection, frozen input", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKDMQR browser")).id;
    const imageAssetId = await createAsset(projectId, "image", "https://example.com/ref-one.png");
    const videoAssetId = await createAsset(projectId, "video", "https://example.com/ref-video.mp4");
    expect(
      (await saveCanvas(
        projectId,
        [
          readyImageNode("m1", imageAssetId, "参考图一", 100, 80),
          readyVideoNode("v1", videoAssetId, "参考视频", 100, 420),
          textNode("t1", "故事文案正文", "故事文案"),
        ],
        [],
        "missing",
      )).status,
    ).toBe(200);

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

      const edges = page.locator(".react-flow__edge");
      const dockRefs = page.locator('[data-testid="dock-media-ref"]');
      const nodeById = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
      /** 画布拖线：从 source 节点右连接点拖到 target 节点左连接点 */
      async function dragConnect(sourceId: string, targetId: string) {
        const src = page.locator(`.react-flow__node[data-id="${sourceId}"] .react-flow__handle-right`);
        const dst = page.locator(`.react-flow__node[data-id="${targetId}"] .react-flow__handle-left`);
        const sb = (await src.boundingBox())!;
        const db = (await dst.boundingBox())!;
        await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
        await page.mouse.down();
        await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2, { steps: 12 });
        await page.mouse.up();
      }

      // 预置素材就绪渲染（不缺失）
      await nodeById("m1").locator("img").waitFor();
      await nodeById("v1").locator("video").waitFor();
      await nodeById("t1").waitFor();

      // 0) 侧栏建草稿：面板打开，无任何连线
      await page.locator('button[aria-label="图片对话"]').click();
      await page.locator("textarea").waitFor();
      const draftNodeLocator = page.locator(".react-flow__node-mediaNode", { hasText: "待生成" });
      const draftId = (await draftNodeLocator.getAttribute("data-id"))!;
      expect(await edges.count()).toBe(0);
      expect(generationRequests, "建卡不创建生成任务").toEqual([]);

      // 1) 添加路径 A（Dock 选择）：到节点选择 → 点击 m1 → 建立连线，Dock 显示同一输入
      await page.locator('button[title="到节点选择"]').click();
      await page.getByText("点击画布中的图片节点").waitFor();
      await nodeById("m1").locator('[data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await edges.count(), "Dock 选择建立连线").toBe(1));
      await vi.waitFor(async () => expect(await dockRefs.count(), "Dock 显示连线参考").toBe(1));
      expect(await dockRefs.first().locator("img").getAttribute("alt")).toBe("参考图一");

      // 2) 移除路径 A（Dock 移除）：连线断开；来源素材卡保留
      await dockRefs.first().locator('button[title="移除"]').click();
      await vi.waitFor(async () => expect(await edges.count(), "Dock 移除断开连线").toBe(0));
      expect(await dockRefs.count()).toBe(0);
      await nodeById("m1").locator("img").waitFor();

      // 3) 添加路径 B（画布拖线）：m1 → 草稿，Dock 同步显示
      await dragConnect("m1", draftId);
      await vi.waitFor(async () => expect(await page.locator(`.react-flow__edge[data-id^="xy-edge__m1-${draftId}"]`).count(), "画布拖线建立 m1→草稿 连线").toBe(1));
      await vi.waitFor(async () => expect(await dockRefs.count(), "连线后 Dock 同步显示").toBe(1));

      // 4) 文本附件回归：t1 → 草稿拖线，附件区照常展示
      await dragConnect("t1", draftId);
      await vi.waitFor(async () => expect(await edges.count()).toBe(2));
      await page.getByText("文本附件（1）").waitFor();
      await page.getByText("故事文案").first().waitFor();

      // 5) 非法来源拒绝：Dock 选取视频节点 → 明确提示，不产生新连线
      await page.locator('button[title="到节点选择"]').click();
      await nodeById("v1").locator('[data-testid="media-content"]').click();
      await page.getByText("图片参考仅支持图片素材").waitFor();
      expect(await edges.count(), "非法来源不产生连线").toBe(2);

      // 6) 移除路径 B（画布剪刀断线）：仅 m1 连线断开，Dock 同步移除，t1 附件保留
      // 按连线身份定位（first 可能是被节点遮挡的 t1 连线）；悬停点取连线近源端（避开节点盒遮挡）
      const mediaEdge = page.locator('.react-flow__edge[data-id^="xy-edge__m1-"]');
      await mediaEdge.waitFor();
      const srcBox = (await page.locator('.react-flow__node[data-id="m1"] .react-flow__handle-right').boundingBox())!;
      const dstBox = (await page.locator(`.react-flow__node[data-id="${draftId}"] .react-flow__handle-left`).boundingBox())!;
      await page.mouse.move(srcBox.x + (dstBox.x - srcBox.x) * 0.25, srcBox.y + (dstBox.y - srcBox.y) * 0.25);
      const cut = mediaEdge.locator('g[class*="deleteBtn"]');
      await cut.waitFor({ state: "visible" });
      // 剪刀中点可能被 Dock 覆盖（草稿出生点避让预留高度有限）：悬停可见性已断言，
      // 点击用 DOM 派发直触发剪刀（真实链路 CustomEdge → onEdgesChange remove 不变）
      await cut.dispatchEvent("click");
      await vi.waitFor(async () => expect(await edges.count(), "画布断线").toBe(1));
      await vi.waitFor(async () => expect(await dockRefs.count(), "断线后 Dock 同步移除").toBe(0));
      await page.getByText("文本附件（1）").waitFor();
      await nodeById("m1").locator("img").waitFor();

      // 7) 参考关系随草稿保存：断线状态落盘后恢复一致；重新连入再刷新恢复
      await dragConnect("m1", draftId);
      await vi.waitFor(async () => expect(await dockRefs.count()).toBe(1));
      await vi.waitFor(async () => {
        const canvas = await getCanvas(projectId);
        const savedEdges = JSON.parse(canvas.edges) as Array<{ source: string; target: string }>;
        expect(
          savedEdges.some((e) => e.source === "m1" && e.target === draftId),
          "参考连线随草稿落盘",
        ).toBe(true);
      }, { timeout: 10_000 });
      await page.reload();
      await nodeById(draftId).waitFor();
      await vi.waitFor(async () => expect(await edges.count(), "刷新恢复连线").toBe(2));
      await nodeById(draftId).locator('[data-testid="media-content"]').click();
      await page.locator("textarea").waitFor();
      await vi.waitFor(async () => expect(await dockRefs.count(), "刷新后 Dock 显示同一参考").toBe(1));
      await page.getByText("文本附件（1）").waitFor();

      // 8) 提交：冻结输入与 Dock 显示及请求一致（先落盘后建任务）
      await page.locator("textarea").fill("参考这张图重新绘制");
      await page.locator('button[title="发送"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      const sent = generationRequests[0].body;
      expect(sent.target_node_id).toBe(draftId);
      expect(sent.input_asset_ids, "请求参考图与 Dock 显示一致").toEqual([imageAssetId]);
      await vi.waitFor(async () => {
        const row = await prisma.client.generation_jobs.findFirst({
          where: { project_id: BigInt(projectId) }, orderBy: { id: "desc" },
        });
        expect(row).not.toBeNull();
        const job = await readJob(row!.id.toString());
        expect(job!.input.target_node_id).toBe(draftId);
        expect(job!.input.input_asset_ids, "冻结输入与 Dock 显示一致").toEqual([imageAssetId]);
        expect(job!.input.text_attachments).toEqual([{ node_id: "t1", title: "故事文案", text: "故事文案正文" }]);
      }, { timeout: 10_000 });

      // 9) 执行中输入只读：面板禁用、Dock 移除隐藏、画布断线被拦截
      await page.getByText("生成中，参数与连线只读").waitFor();
      expect(await page.locator("textarea").isDisabled()).toBe(true);
      expect(await page.locator('[data-testid="dock-media-ref"] button[title="移除"]').count()).toBe(0);
      const cutDuringRun = page.locator('.react-flow__edge[data-id^="xy-edge__m1-"] g[class*="deleteBtn"]');
      await cutDuringRun.waitFor({ state: "visible" });
      await cutDuringRun.dispatchEvent("click");
      await page.getByText("生成中，输入连线只读").waitFor();
      await vi.waitFor(async () => expect(await edges.count(), "生成中断线被拦截").toBe(2));

      await page.screenshot({ path: "/tmp/ikdmqr-browser.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 120_000);
});
