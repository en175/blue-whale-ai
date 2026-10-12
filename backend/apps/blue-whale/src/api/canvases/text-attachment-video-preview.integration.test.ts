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
import { MaterialService } from "@lib/shared/material/material.service.js";
import { SystemSettingsService } from "@lib/shared/system-settings/index.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { IdentityService } from "@lib/shared/identity/identity.service.js";
import { AllExceptionsFilter } from "@lib/infra/filters/all-exceptions.filter.js";

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
        channel: "seedream-video",
      },
      update: { supported_sizes: sizes, default_size: "720p" },
    });
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, CanvasService, MaterialService, AssetService, IdentityService], GenerationJobsController);
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
      parameters: { prompt: "镜头缓推", model_id: MODEL_ID, aspect_ratio: "16:9", resolution: "720p", duration: 5 },
    });
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job).not.toBeNull();
    expect(job!.input.text_attachments).toEqual([
      { node_id: "text-1", title: "场景描述", text: "赛博朋克" },
      { node_id: "text-2", title: "雨夜", text: "青石板路" },
    ]);
    expect(job!.input.references).toEqual([
      { role: "first_frame", asset_id: firstAsset.id.toString(), type: "image" },
    ]);
    expect(job!.input.prompt).toBe("镜头缓推");
  });

  it.runIf(process.env.IKFCXC_BROWSER)("browser: 视频文本附件完整预览与生成回归（悬浮滚动/移入保持/面板移除断边/来源更新/发送冻结/刷新恢复）", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFCXC browser")).id;
    const longBody = Array.from({ length: 24 }, (_, i) => `第${i + 1}段落：蓝鲸在深海里缓慢游动，霓虹灯映在浪尖。`).join("\n");
    const LONG_TAIL_MARK = "末尾标记-VZ9";
    const firstAsset = await prisma.client.assets.create({
      data: { user_id: BigInt(987654), project_id: BigInt(projectId), type: "image", url: "https://example.com/ikfcxc-b-first.png", width: 1024, height: 1024, size: BigInt(1024) },
    });
    const lastAsset = await prisma.client.assets.create({
      data: { user_id: BigInt(987654), project_id: BigInt(projectId), type: "image", url: "https://example.com/ikfcxc-b-last.png", width: 1024, height: 1024, size: BigInt(1024) },
    });
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

      await media1.locator('[data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(2));
      await vi.waitFor(async () =>
        expect(await page.locator('[data-testid="dock-video-ref"] [data-testid="ref-thumb-badge"]').allInnerTexts())
          .toEqual(["首帧", "尾帧"]));
      expect(await page.getByText("文本附件（").count()).toBe(0);

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
      const overlayBox = (await overlay.boundingBox())!;
      await page.mouse.move(overlayBox.x + overlayBox.width / 2, overlayBox.y + overlayBox.height / 2);
      await page.waitForTimeout(400);
      expect(await overlay.count(), "鼠标移入浮层保持打开").toBe(1);
      await page.mouse.move(120, 60);
      await page.waitForTimeout(400);
      expect(await overlay.count(), "移出图标与浮层后关闭").toBe(0);

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

      await text2.locator('[data-testid="text-title"]').click();
      const editor = text2.locator('[data-placeholder="输入内容..."]');
      await editor.dblclick();
      const editSaved = page.waitForResponse((response) =>
        response.request().method() === "PUT" && response.url().includes("/api/canvases/"));
      await editor.fill("雨后的巷子，猫在檐下躲雨");
      await page.locator(".react-flow__pane").click({ position: { x: 60, y: 250 } });
      expect((await editSaved).status(), "来源正文编辑自动保存").toBe(200);
      await media1.locator('[data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(2));
      await page.locator('[data-testid="dock-text-ref"]').first().hover();
      await overlay.waitFor();
      expect(await overlay.innerText(), "来源正文修改后再次预览使用当前正文").toContain("雨后的巷子，猫在檐下躲雨");

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
      expect(input.prompt, "附件正文已由提交方拼进正文").toContain("雨后的巷子，猫在檐下躲雨");
      expect(input.text_attachments, "任务冻结移除后剩余附件的最新正文（连入边序：text-2 播种在先、text-3 新连在后）").toEqual([
        { node_id: "text-2", title: "雨夜", text: "雨后的巷子，猫在檐下躲雨" },
        { node_id: "text-3", title: "旁白草稿", text: "远处灯塔的光扫过海面" },
      ]);
      expect(input.references, "媒体角色冻结：首尾帧保留，文本不成为媒体参考").toEqual([
        { role: "first_frame", asset_id: firstAsset.id.toString(), type: "image" },
        { role: "last_frame", asset_id: lastAsset.id.toString(), type: "image" },
      ]);

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
