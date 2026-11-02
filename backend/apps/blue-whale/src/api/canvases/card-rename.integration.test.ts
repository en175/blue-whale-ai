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
import { AllExceptionsFilter } from "@lib/infra/filters/all-exceptions.filter.js";
import { AccountDirectoryService } from "@lib/shared/identity/account-directory.service.js";




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






describe.skipIf(!process.env.IKFA8X_DATABASE_URL)("Card rename public API (IKFA8X)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "ikfa8x-image-model";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKFA8X_DATABASE_URL;
    const sizes = [{ id: "1024x1024", label: "1024x1024" }];
    await prisma.client.catalog_models.upsert({
      where: { provider_id_model_id: { provider_id: "ikfa8x-test", model_id: MODEL_ID } },
      create: {
        provider_id: "ikfa8x-test",
        model_id: MODEL_ID,
        capability_type: "image",
        model_label: "IKFA8X Test",
        supported_sizes: sizes,
        supported_aspect_ratios: ["1:1"],
        supported_formats: ["png"],
        default_size: "1024x1024",
        default_aspect_ratio: "1:1",
        features: {},

        channel: "seedream-image",
      },
      update: { supported_sizes: sizes, default_size: "1024x1024" },
    });
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, CanvasService, MaterialService, AssetService, AssetStorageService, AccountDirectoryService], GenerationJobsController);
    Reflect.defineMetadata("design:paramtypes", [ModelCapabilityReadService], GenerationModelsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
    Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
    class HarnessModule {}
    Module({
      controllers: [CanvasesController, GenerationJobsController, GenerationModelsController, ProjectsController, JobsController],
      providers: [
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
      ],
    })(HarnessModule);
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

  interface SeedNode {
    id: string;
    type: string;
    position: { x: number; y: number };
    data: Record<string, unknown>;
  }

  function mediaNode(id: string, mediaType: "image" | "video" | "audio", fileName: string, assetId: string, x: number, extra: Record<string, unknown> = {}, y = 90): SeedNode {
    return {
      id,
      type: "mediaNode",
      position: { x, y },
      data: { src: `https://example.com/${id}.bin`, mediaType, fileName, assetId, width: 640, height: 480, ...extra },
    };
  }
  function textNode(id: string, title: string, x: number, y = 90): SeedNode {
    return { id, type: "textNode", position: { x, y }, data: { title, html: "<p>正文</p>" } };
  }
  function imageDraftNode(id: string, fileName: string, x: number, extra: Record<string, unknown> = {}): SeedNode {
    return {
      id,
      type: "mediaNode",
      position: { x, y: 520 },
      data: {
        src: "",
        mediaType: "image",
        fileName,
        genStatus: "draft",
        draft: true,
        prompt: "",
        draftModelId: MODEL_ID,
        draftSize: "1024x1024",
        draftRatio: "1:1",
        targetRatio: "1:1",
        ...extra,
      },
    };
  }

  async function saveCanvas(projectId: string, nodes: unknown[], edges: unknown[], version: number | "missing") {
    return fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": version === "missing" ? '"missing"' : `"${version}"` },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges), viewport: "{}" }),
    });
  }
  async function getCanvas(projectId: string) {
    const response = await fetch(`${base}/api/canvases?projectId=${projectId}`);
    return (await response.json()).data;
  }
  async function canvasNode(projectId: string, nodeId: string) {
    const canvas = await getCanvas(projectId);
    const nodes = JSON.parse(canvas.nodes) as Array<SeedNode>;
    return nodes.find((n) => n.id === nodeId);
  }
  async function createAsset(projectId: string, type: string, url: string) {
    const asset = await prisma.client.user_assets.create({
      data: { user_id: BigInt(987654), project_id: BigInt(projectId), type, url, width: 640, height: 480 },
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

  async function succeedJob(projectId: string, jobId: string, url: string) {
    const asset = await prisma.client.user_assets.create({
      data: { user_id: BigInt(987654), project_id: BigInt(projectId), type: "image", url, width: 1024, height: 1024, size: BigInt(2048) },
    });
    await prisma.client.generation_output_slots.updateMany({
      where: { generation_job_id: BigInt(jobId) },
      data: { status: "succeeded", asset_id: asset.id },
    });
    await prisma.client.generation_jobs.update({
      where: { id: BigInt(jobId) },
      data: { status: "succeeded", output_asset_ids: [asset.id.toString()] },
    });
  }

  async function failJob(jobId: string) {
    await prisma.client.generation_output_slots.updateMany({
      where: { generation_job_id: BigInt(jobId) },
      data: { status: "failed" },
    });
    await prisma.client.generation_jobs.update({
      where: { id: BigInt(jobId) },
      data: { status: "failed" },
    });
  }
  async function latestJobId(projectId: string) {
    const row = await prisma.client.generation_jobs.findFirst({
      where: { project_id: BigInt(projectId) },
      orderBy: { id: "desc" },
    });
    expect(row).not.toBeNull();
    return row!.id.toString();
  }





  async function bootCanvas(projectId: string, opts: { acceptDownloads?: boolean } = {}) {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const vite = await createVite({
      root: `${process.cwd()}/web`,
      server: { open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base }, "/agent": { target: base } } },
    });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: opts.acceptDownloads });
    await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
      userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
    } }, version: 0 })));
    return {
      page,
      open: () => page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`),
      close: async () => { await browser.close(); await vite.close(); },
    };
  }

  type BrowserPage = Awaited<ReturnType<typeof bootCanvas>>["page"];


  const nameRowOf = (page: BrowserPage, id: string) =>
    page.locator(`[data-id="${id}"] [data-testid="media-title"], [data-id="${id}"] [data-testid="text-title"]`);
  const nameInputOf = (page: BrowserPage, id: string) => nameRowOf(page, id).locator("input");
  const nameSpanOf = (page: BrowserPage, id: string) => nameRowOf(page, id).locator("span").first();


  async function startRename(page: BrowserPage, id: string, value?: string) {
    await nameSpanOf(page, id).dblclick();
    await nameInputOf(page, id).waitFor();
    if (value !== undefined) await nameInputOf(page, id).fill(value);
  }

  async function waitPersisted(projectId: string, id: string, name: string, key: "fileName" | "title" = "fileName") {
    await vi.waitFor(async () => {
      const node = await canvasNode(projectId, id);
      expect(node?.data[key]).toBe(name);
      expect(node?.data.customName, "改名后须显式标记 customName，不靠名称内容推断").toBe(true);
    }, { timeout: 10_000 });
  }

  async function renameCard(page: BrowserPage, projectId: string, id: string, value: string) {
    await startRename(page, id, value);
    await nameInputOf(page, id).press("Enter");
    await waitPersisted(projectId, id, value);
  }


  const promptEditorOf = (page: BrowserPage) => page.locator('[contenteditable="true"]').first();

  async function fillPrompt(page: BrowserPage, text: string) {
    const editor = promptEditorOf(page);
    await editor.click();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(150);
    await editor.pressSequentially(text, { delay: 30 });
  }



  async function sendDraft(page: BrowserPage, projectId: string, id: string, prompt: string) {
    await page.locator(`[data-id="${id}"] [data-testid="media-content"]`).click();
    await promptEditorOf(page).waitFor();
    await page.getByText("IKFA8X Test", { exact: true }).waitFor();
    await fillPrompt(page, prompt);
    await page.locator('button[title="发送"]').click();
    await vi.waitFor(async () => {
      const job = await readJob(await latestJobId(projectId));
      expect(job!.input.target_node_id, "任务落在目标卡上").toBe(id);
      expect(job!.input.prompt).toBe(prompt);
    }, { timeout: 10_000 });
    return latestJobId(projectId);
  }

  it("API：名称与显式 customName 标记随画布保存原样恢复（持久化通道契约）", async () => {
    const projectId = (await projects.create("987654", "IKFA8X rename roundtrip")).id;
    const nodes = [
      mediaNode("m1", "image", "海边日落", "a1", 0, { customName: true }),
      textNode("t1", "分镜大纲", 400),
    ];
    expect((await saveCanvas(projectId, nodes, [], "missing")).status).toBe(200);

    const canvas = await getCanvas(projectId);
    const stored = JSON.parse(canvas.nodes) as Array<SeedNode>;
    expect(stored).toEqual(nodes);

    const reloaded = await getCanvas(projectId);
    expect(JSON.parse(reloaded.nodes)).toEqual(stored);
  });

  it.runIf(process.env.IKFA8X_BROWSER)("browser: 四类卡片改名、编辑边界、独立性与刷新恢复（A01–A13、A23）", async () => {
    const projectId = (await projects.create("987654", "IKFA8X browser rename")).id;
    const assetA = await createAsset(projectId, "image", "https://example.com/shared.png");
    const assetV = await createAsset(projectId, "video", "https://example.com/clip.mp4");
    const assetU = await createAsset(projectId, "audio", "https://example.com/bgm.mp3");


    const initialNodes = [
      mediaNode("img-a", "image", "上传图.png", assetA, 0),
      mediaNode("img-b", "image", "上传图.png", assetA, 420),
      mediaNode("vid", "video", "素材视频.mp4", assetV, 840),
      mediaNode("aud", "audio", "配乐.mp3", assetU, 0, {}, 520),
      textNode("txt", "需求笔记", 560, 520),
    ];
    expect((await saveCanvas(projectId, initialNodes, [], "missing")).status).toBe(200);

    const { page, open, close } = await bootCanvas(projectId);
    try {
      await open();
      await page.locator('[data-id="img-a"] [data-testid="media-title"]').waitFor();


      const zoomBefore = await page.locator(".react-flow__viewport").getAttribute("style");
      await startRename(page, "img-a", "  海边日落  ");
      await nameInputOf(page, "img-a").press("Enter");
      await waitPersisted(projectId, "img-a", "海边日落");
      expect(await page.locator(".react-flow__viewport").getAttribute("style"), "双击改名不触发画布缩放").toBe(zoomBefore);


      await startRename(page, "vid", "片头素材");
      await page.locator(".react-flow__pane").click({ position: { x: 1400, y: 700 } });
      await waitPersisted(projectId, "vid", "片头素材");


      await startRename(page, "aud", "旁白配音");
      await page.locator('[data-id="vid"] [data-testid="media-content"]').click();
      await waitPersisted(projectId, "aud", "旁白配音");


      await startRename(page, "txt", "分镜大纲");
      await nameInputOf(page, "txt").press("Enter");
      await waitPersisted(projectId, "txt", "分镜大纲", "title");


      await startRename(page, "img-a", "被放弃的名字");
      await nameInputOf(page, "img-a").press("Escape");
      await vi.waitFor(async () => expect(await nameInputOf(page, "img-a").count()).toBe(0));
      expect(await nameSpanOf(page, "img-a").textContent()).toBe("海边日落");
      await page.waitForTimeout(1200);
      expect((await canvasNode(projectId, "img-a"))?.data.fileName).toBe("海边日落");


      await startRename(page, "img-a", "   ");
      await nameInputOf(page, "img-a").press("Enter");
      expect(await nameSpanOf(page, "img-a").textContent()).toBe("海边日落");
      expect((await canvasNode(projectId, "img-a"))?.data.fileName).toBe("海边日落");


      const name100 = "鲸".repeat(100);
      await startRename(page, "vid", name100);
      await nameInputOf(page, "vid").press("Enter");
      await waitPersisted(projectId, "vid", name100);
      const name101 = "鲸".repeat(101);
      await startRename(page, "vid", name101);
      await nameInputOf(page, "vid").press("Enter");
      await page.getByRole("alert").filter({ hasText: "100" }).waitFor();
      expect(await nameInputOf(page, "vid").inputValue(), "超长后保留编辑内容").toBe(name101);
      await page.waitForTimeout(1200);
      expect((await canvasNode(projectId, "vid"))?.data.fileName, "超长不写入").toBe(name100);

      await nameInputOf(page, "vid").press("Escape");


      await startRename(page, "aud", "拼音候选");
      await nameInputOf(page, "aud").dispatchEvent("keydown", { key: "Enter", isComposing: true });
      expect(await nameInputOf(page, "aud").count(), "组合中回车不退出编辑").toBe(1);
      await nameInputOf(page, "aud").press("Enter");
      await waitPersisted(projectId, "aud", "拼音候选");


      await startRename(page, "aud", "海边日落");
      await nameInputOf(page, "aud").press("Enter");
      await waitPersisted(projectId, "aud", "海边日落");
      expect((await canvasNode(projectId, "img-a"))?.data.fileName).toBe("海边日落");
      expect((await canvasNode(projectId, "img-a"))?.id).toBe("img-a");
      expect((await canvasNode(projectId, "aud"))?.id).toBe("aud");


      const assetRowBefore = await prisma.client.user_assets.findUnique({ where: { id: BigInt(assetA) } });
      expect((await canvasNode(projectId, "img-b"))?.data.fileName).toBe("上传图.png");
      expect((await canvasNode(projectId, "img-b"))?.data.customName).toBeUndefined();
      const assetRowAfter = await prisma.client.user_assets.findUnique({ where: { id: BigInt(assetA) } });
      expect(assetRowAfter?.gmt_modified).toEqual(assetRowBefore?.gmt_modified);


      await page.getByRole("button", { name: "添加文本" }).click();
      const newText = page.locator(".react-flow__node-textNode", { hasNot: page.locator('[data-id="txt"]') }).last();
      const newTextId = await newText.getAttribute("data-id");
      expect(newTextId).toBeTruthy();
      await startRename(page, newTextId!, "新建即改");
      await nameInputOf(page, newTextId!).press("Enter");
      await waitPersisted(projectId, newTextId!, "新建即改", "title");


      await startRename(page, "img-b", "母版名");
      await nameInputOf(page, "img-b").press("Enter");
      await waitPersisted(projectId, "img-b", "母版名");
      await page.locator('[data-id="img-b"] [data-testid="media-content"]').click({ button: "right" });



      await page.getByRole("button", { name: "创建副本" }).dispatchEvent("click");
      let namedCopyId = "";
      await vi.waitFor(async () => {
        const canvas = await getCanvas(projectId);
        const nodes = JSON.parse(canvas.nodes) as Array<SeedNode>;
        const copy = nodes.find((n) => n.id !== "img-b" && n.data.fileName === "母版名");
        expect(copy, "复制继承自定义名与标记").toBeTruthy();
        expect(copy!.data.customName).toBe(true);
        namedCopyId = copy!.id;
      }, { timeout: 10_000 });

      await page.locator(".react-flow__pane").click({ position: { x: 1400, y: 760 } });
      await startRename(page, namedCopyId, "副本改名");
      await nameInputOf(page, namedCopyId).press("Enter");
      await waitPersisted(projectId, namedCopyId, "副本改名");
      expect((await canvasNode(projectId, "img-b"))?.data.fileName).toBe("母版名");


      await page.reload();
      await page.locator('[data-id="img-a"] [data-testid="media-title"]').waitFor();
      expect(await nameSpanOf(page, "img-a").textContent()).toBe("海边日落");
      expect(await nameSpanOf(page, "img-b").textContent()).toBe("母版名");
      expect(await nameSpanOf(page, "vid").textContent()).toBe(name100);
      expect(await nameSpanOf(page, "aud").textContent()).toBe("海边日落");
      expect(await nameSpanOf(page, "txt").textContent()).toBe("分镜大纲");
      expect(await nameSpanOf(page, newTextId!).textContent()).toBe("新建即改");
      expect(await nameSpanOf(page, namedCopyId).textContent()).toBe("副本改名");


      await page.getByRole("button", { name: "缩小" }).click();
      await startRename(page, "vid", "缩放下改名");
      await nameInputOf(page, "vid").press("Enter");
      await waitPersisted(projectId, "vid", "缩放下改名");
      const beforeDrag = (await canvasNode(projectId, "vid"))!.position;
      const vidBox = (await page.locator('[data-id="vid"] [data-testid="media-title"]').boundingBox())!;
      await page.mouse.move(vidBox.x + 40, vidBox.y + 8);
      await page.mouse.down();
      await page.mouse.move(vidBox.x + 240, vidBox.y + 108, { steps: 12 });
      await page.mouse.up();
      await vi.waitFor(async () => {
        const after = (await canvasNode(projectId, "vid"))!.position;
        expect(after).not.toEqual(beforeDrag);
      }, { timeout: 10_000 });

      await page.screenshot({ path: "/tmp/ikfa8x-rename.png", fullPage: true });
    } finally {
      await close();
    }
  }, 180_000);

  it.runIf(process.env.IKFA8X_BROWSER)("browser: 自定义名跨首次生成、重新生成、失败重试保留（A14–A16）", async () => {
    const projectId = (await projects.create("987654", "IKFA8X browser generation")).id;
    const initialNodes = [
      imageDraftNode("d-custom", "我的封面图", 0, { customName: true }),
      imageDraftNode("d-auto", "图片草稿", 380),
    ];
    expect((await saveCanvas(projectId, initialNodes, [], "missing")).status).toBe(200);

    const { page, open, close } = await bootCanvas(projectId);
    try {
      await open();
      const customCard = page.locator('[data-id="d-custom"]');
      const autoCard = page.locator('[data-id="d-auto"]');
      await customCard.waitFor();
      const customTitle = () => customCard.locator('[data-testid="media-title"]');
      const autoTitle = () => autoCard.locator('[data-testid="media-title"]');


      const firstJobId = await sendDraft(page, projectId, "d-custom", "画一只蓝鲸");
      expect(await customTitle().textContent(), "生成中不被自动改名").toContain("我的封面图");
      await succeedJob(projectId, firstJobId, "https://example.com/ikfa8x-out-1.png");
      await customCard.locator("img").waitFor({ timeout: 15_000 });
      expect(await customTitle().textContent(), "成功回填保留自定义名").toContain("我的封面图");
      await vi.waitFor(async () => {
        const node = await canvasNode(projectId, "d-custom");
        expect(node?.data.fileName).toBe("我的封面图");
        expect(node?.data.customName).toBe(true);
        expect(node?.data.draft).toBeUndefined();
        expect(node?.data.src).toBe("https://example.com/ikfa8x-out-1.png");
      }, { timeout: 10_000 });


      await page.reload();
      await customCard.waitFor();
      expect(await customTitle().textContent()).toContain("我的封面图");




      const regenJobId = await sendDraft(page, projectId, "d-custom", "换成深海");
      expect(await customTitle().textContent(), "重新生成中仍保留自定义名").toContain("我的封面图");
      await failJob(regenJobId);
      await customCard.locator('[data-testid="fail-overlay"]').waitFor({ timeout: 15_000 });
      expect(await customTitle().textContent(), "失败保留自定义名").toContain("我的封面图");


      await customCard.locator('[data-testid="fail-overlay"] button', { hasText: "重试" }).click();
      let retryJobId = "";
      await vi.waitFor(async () => {
        const latest = await latestJobId(projectId);
        expect(latest).not.toBe(regenJobId);
        retryJobId = latest;
      }, { timeout: 10_000 });
      expect(await customTitle().textContent(), "重试生成中保留自定义名").toContain("我的封面图");
      await succeedJob(projectId, retryJobId, "https://example.com/ikfa8x-out-3.png");
      await vi.waitFor(async () => {
        const node = await canvasNode(projectId, "d-custom");
        expect(node?.data.fileName).toBe("我的封面图");
        expect(node?.data.customName).toBe(true);
        expect(node?.data.src).toBe("https://example.com/ikfa8x-out-3.png");
      }, { timeout: 15_000 });


      const autoJobId = await sendDraft(page, projectId, "d-auto", "自动命名对照");
      await succeedJob(projectId, autoJobId, "https://example.com/ikfa8x-out-auto.png");
      await vi.waitFor(async () => {
        const node = await canvasNode(projectId, "d-auto");
        expect(node?.data.fileName).toBe(`生成-${autoJobId}`);
        expect(node?.data.customName).toBeUndefined();
      }, { timeout: 15_000 });
      expect(await autoTitle().textContent()).toContain(`生成-${autoJobId}`);

      await page.screenshot({ path: "/tmp/ikfa8x-generation.png", fullPage: true });
    } finally {
      await close();
    }
  }, 180_000);




  it.runIf(process.env.IKFA8X_BROWSER)("browser: 生成进行中改名覆盖编辑入口、终态保留、引用同步与刷新恢复（IKIQ2E）", async () => {
    const projectId = (await projects.create("987654", "IKIQ2E generating rename")).id;
    const assetA = await createAsset(projectId, "image", "https://example.com/gen-shared.png");

    const initialNodes = [
      mediaNode("img-a", "image", "上传图.png", assetA, 0, { mime: "image/png" }),
      mediaNode("img-b", "image", "上传图.png", assetA, 380, { mime: "image/png" }),
      imageDraftNode("d1", "图片草稿", 760),
      imageDraftNode("d2", "引用方草稿", 1140),
    ];
    const initialEdges = [{ id: "e-d1-d2", source: "d1", target: "d2" }];
    expect((await saveCanvas(projectId, initialNodes, initialEdges, "missing")).status).toBe(200);

    const { page, open, close } = await bootCanvas(projectId);
    try {
      await open();

      const d1Card = page.locator('[data-id="d1"]');
      await d1Card.locator('[data-testid="media-title"]').waitFor();


      const firstJobId = await sendDraft(page, projectId, "d1", "画一只蓝鲸");
      expect(await nameSpanOf(page, "d1").textContent(), "未自定义草稿生成中沿用自动占位名").toContain("图片生成中");
      const zoomBefore = await page.locator(".react-flow__viewport").getAttribute("style");
      await renameCard(page, projectId, "d1", "生成中起的名");
      expect(await page.locator(".react-flow__viewport").getAttribute("style"), "生成中双击改名不触发画布缩放").toBe(zoomBefore);
      expect(await nameSpanOf(page, "d1").textContent(), "改名当刻不被自动名回写").toContain("生成中起的名");
      const nodeWhileGenerating = await canvasNode(projectId, "d1");
      expect(nodeWhileGenerating?.id, "原位生成保持同一卡身份").toBe("d1");
      expect(nodeWhileGenerating?.data.genStatus, "改名当刻卡片确在生成中").toBe("generating");


      await startRename(page, "d1", "被放弃的名字");
      await nameInputOf(page, "d1").press("Escape");
      await vi.waitFor(async () => expect(await nameInputOf(page, "d1").count()).toBe(0));
      expect(await nameSpanOf(page, "d1").textContent()).toContain("生成中起的名");
      await page.locator('[data-id="img-a"] [data-testid="media-content"]').click();
      await page.waitForTimeout(1200);
      expect((await canvasNode(projectId, "d1"))?.data.fileName, "Esc 取消后失焦不提交").toBe("生成中起的名");


      await succeedJob(projectId, firstJobId, "https://example.com/ikiq2e-out-1.png");
      await vi.waitFor(async () => {
        const node = await canvasNode(projectId, "d1");
        expect(node?.data.src).toBe("https://example.com/ikiq2e-out-1.png");
        expect(node?.data.fileName, "成功回填保留生成中改的名").toBe("生成中起的名");
        expect(node?.data.customName).toBe(true);
        expect(node?.data.draft).toBeUndefined();
      }, { timeout: 15_000 });
      expect(await nameSpanOf(page, "d1").textContent()).toContain("生成中起的名");


      const regenJobId = await sendDraft(page, projectId, "d1", "换成深海");
      await renameCard(page, projectId, "d1", "重试前改的名");
      await failJob(regenJobId);
      await d1Card.locator('[data-testid="fail-overlay"]').waitFor({ timeout: 15_000 });
      expect(await nameSpanOf(page, "d1").textContent(), "失败态保留生成中改的名").toContain("重试前改的名");
      await d1Card.locator('[data-testid="fail-overlay"] button', { hasText: "重试" }).click();
      const retryJobId = await (async () => {
        await vi.waitFor(async () => expect(await latestJobId(projectId)).not.toBe(regenJobId), { timeout: 10_000 });
        return latestJobId(projectId);
      })();
      expect(await nameSpanOf(page, "d1").textContent(), "重试生成中保留名称").toContain("重试前改的名");
      await succeedJob(projectId, retryJobId, "https://example.com/ikiq2e-out-2.png");
      await vi.waitFor(async () => {
        const node = await canvasNode(projectId, "d1");
        expect(node?.data.src).toBe("https://example.com/ikiq2e-out-2.png");
        expect(node?.data.fileName, "重试成功回填保留名称与自定义状态").toBe("重试前改的名");
        expect(node?.data.customName).toBe(true);
      }, { timeout: 15_000 });


      const regen2JobId = await sendDraft(page, projectId, "d1", "第三次重画");
      await renameCard(page, projectId, "d1", "成品重生成中改的名");
      await succeedJob(projectId, regen2JobId, "https://example.com/ikiq2e-out-3.png");
      await vi.waitFor(async () => {
        const node = await canvasNode(projectId, "d1");
        expect(node?.data.src).toBe("https://example.com/ikiq2e-out-3.png");
        expect(node?.data.fileName, "成品卡重新生成成功保留改名").toBe("成品重生成中改的名");
        expect(node?.data.customName).toBe(true);
      }, { timeout: 15_000 });


      const assetRowBefore = await prisma.client.user_assets.findUnique({ where: { id: BigInt(assetA) } });
      await renameCard(page, projectId, "img-a", "只改这张");
      expect((await canvasNode(projectId, "img-a"))?.data.fileName).toBe("只改这张");
      expect((await canvasNode(projectId, "img-b"))?.data.fileName, "同素材另一张卡名称不被联动").toBe("上传图.png");
      expect((await canvasNode(projectId, "img-b"))?.data.customName, "同素材另一张卡自定义状态不被联动").toBeUndefined();
      const assetRowAfter = await prisma.client.user_assets.findUnique({ where: { id: BigInt(assetA) } });
      expect(assetRowAfter?.gmt_modified, "素材库资产行不被改名触碰").toEqual(assetRowBefore?.gmt_modified);


      const regen3JobId = await sendDraft(page, projectId, "d1", "第四次重画");
      const beforeRename = (await canvasNode(projectId, "d1"))!;
      await renameCard(page, projectId, "d1", "被引用的生成中卡");



      const edgePairs = async () => {
        const canvas = await getCanvas(projectId);
        return (JSON.parse(canvas.edges) as Array<{ source: string; target: string }>)
          .map((e) => `${e.source}->${e.target}`).sort();
      };
      const referencedWhileGenerating = await canvasNode(projectId, "d1");
      expect(await edgePairs(), "生成中改名不改变连线").toEqual(["d1->d2"]);
      expect(referencedWhileGenerating?.id, "生成中改名后仍是同一节点").toBe("d1");
      expect(referencedWhileGenerating?.data.src, "生成中改名不改变素材地址").toBe(beforeRename.data.src);
      expect(referencedWhileGenerating?.data.assetId, "生成中改名不改变素材绑定").toBe(beforeRename.data.assetId);

      await succeedJob(projectId, regen3JobId, "https://example.com/ikiq2e-out-4.png");
      await vi.waitFor(async () => {
        expect((await canvasNode(projectId, "d1"))?.data.src).toBe("https://example.com/ikiq2e-out-4.png");
      }, { timeout: 15_000 });


      await page.locator('[data-id="d2"] [data-testid="media-content"]').click();
      await promptEditorOf(page).waitFor();
      const dockRefNames = () => page.locator('[data-testid="dock-media-ref"] img').evaluateAll(
        (imgs) => imgs.map((img) => img.getAttribute("alt")),
      );
      await vi.waitFor(async () => {
        expect(await dockRefNames(), "参考显示同步生成中改的名").toEqual(["被引用的生成中卡"]);
      }, { timeout: 10_000 });
      expect(await edgePairs(), "参考显示更新不改变连线").toEqual(["d1->d2"]);
      const referencedNode = await canvasNode(projectId, "d1");
      expect(referencedNode?.id, "引用对象仍是同一节点").toBe("d1");


      expect(referencedNode?.data.assetId, "参考跟随本轮新产物资产").not.toBe(beforeRename.data.assetId);


      await page.reload();
      await d1Card.waitFor();
      expect(await nameSpanOf(page, "d1").textContent(), "刷新后恢复生成中改的名").toContain("被引用的生成中卡");
      const reloadedNode = await canvasNode(projectId, "d1");
      expect(reloadedNode?.data.customName, "刷新后自定义状态随名称一起恢复").toBe(true);

      await page.screenshot({ path: "/tmp/ikiq2e-generating-rename.png", fullPage: true });
    } finally {
      await close();
    }
  }, 300_000);

  it.runIf(process.env.IKFA8X_BROWSER)("browser: 保存失败沿用现有反馈，不把本地变化误报为已落库（A18）", async () => {
    const projectId = (await projects.create("987654", "IKFA8X browser save-failure")).id;
    const assetA = await createAsset(projectId, "image", "https://example.com/fail-shared.png");
    expect((await saveCanvas(projectId, [mediaNode("img-a", "image", "原名.png", assetA, 0)], [], "missing")).status).toBe(200);

    const { page, open, close } = await bootCanvas(projectId);
    try {
      await open();
      const titleRow = page.locator('[data-id="img-a"] [data-testid="media-title"]');
      await titleRow.waitFor();


      await page.route("**/api/canvases/*", (route) => {
        if (route.request().method() === "PUT") return route.fulfill({ status: 500, body: "forced failure" });
        return route.continue();
      });
      await titleRow.locator("span").first().dblclick();
      const input = titleRow.locator("input");
      await input.waitFor();
      await input.fill("故障期新名");
      await input.press("Enter");

      await page.getByText("保存失败，请重试").first().waitFor({ timeout: 10_000 });
      await page.waitForTimeout(300);
      expect((await canvasNode(projectId, "img-a"))?.data.fileName, "故障期名称不落库").toBe("原名.png");


      await page.unroute("**/api/canvases/*");
      await titleRow.locator("span").first().dblclick();
      await input.waitFor();
      await input.fill("恢复后新名");
      await input.press("Enter");
      await vi.waitFor(async () => {
        const node = await canvasNode(projectId, "img-a");
        expect(node?.data.fileName).toBe("恢复后新名");
        expect(node?.data.customName).toBe(true);
      }, { timeout: 10_000 });
    } finally {
      await close();
    }
  }, 60_000);

  it.runIf(process.env.IKFA8X_BROWSER)("browser: 改名同步当前参考显示与下载命名（IKFA8Y A19–A22）", async () => {
    const projectId = (await projects.create("987654", "IKFA8Y browser reference sync")).id;
    const assetA = await createAsset(projectId, "image", "https://example.com/shared.png");
    const assetV = await createAsset(projectId, "video", "https://example.com/clip.mp4");

    const initialNodes = [
      mediaNode("img-a", "image", "上传图.png", assetA, 0, { mime: "image/png" }),
      mediaNode("img-b", "image", "上传图.png", assetA, 380, { mime: "image/png" }),
      mediaNode("vid", "video", "片头.mp4", assetV, 760, { mime: "video/mp4" }),
      imageDraftNode("draft", "图片草稿", 1140),
    ];

    const initialEdges = [
      { id: "e-img-a-draft", source: "img-a", target: "draft" },
      { id: "e-vid-draft", source: "vid", target: "draft" },
    ];
    expect((await saveCanvas(projectId, initialNodes, initialEdges, "missing")).status).toBe(200);


    const created = await createJob(projectId, {
      type: "image", expected_output_count: 1, input_asset_ids: [assetA],
      parameters: { prompt: "参考上传图.png", model_id: MODEL_ID, aspect_ratio: "1:1" },
    });
    expect(created.code).toBe(200);
    const historicalJobId = created.data.generation_job_id;
    const historicalInput = (await readJob(historicalJobId))!.input;
    expect(historicalInput.prompt).toBe("参考上传图.png");

    const { page, open, close } = await bootCanvas(projectId, { acceptDownloads: true });
    try {


      const session = { session_id: "rename-session", title: "改名验收", phase: "idle", lifecycle: "active" };
      const messages = [{
        message_id: "old-user", sequence: 1, role: "user", input_batch_id: "old-batch",
        content: [{ type: "asset_ref", asset_id: assetA, media_type: "image", display_label: "上传图.png" }],
      }, {
        message_id: "old-assistant", sequence: 2, role: "assistant", input_batch_id: "old-batch", source_run_id: "old-run",
        content: [{ type: "text", text: "历史生成方案" }],
      }];
      const promptCards = [{
        card_id: "old-card", session_id: session.session_id,
        active_revision: { revision_id: "old-revision", authoring_run_id: "old-run", payload: {
          schema_version: 3, target_media: "image", overview: "历史方案",
          assets: [{ asset_ref_id: "original", asset_id: assetA, media_type: "image", display_label: "上传图.png" }],
          shots: [{ shot_no: 1, title: "改名前的方案", frame_description: "海边", prompt_text: "参考上传图.png", asset_bindings: [{ asset_ref_id: "original" }] }],
        } },
      }];
      await page.route(`**/api/agent/v1/projects/${projectId}/**`, async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/events")) {
          return route.fulfill({ contentType: "text/event-stream", body: ": connected\n\n" });
        }
        if (path.endsWith("/snapshot")) return route.fulfill({ json: { session, messages, prompt_cards: promptCards, event_cursor: "3" } });
        return route.fulfill({ json: { items: path.endsWith("/sessions") ? [session] : [] } });
      });


      await page.route("**/__tos-fetch**", (route) => {
        const target = decodeURIComponent(new URL(route.request().url()).searchParams.get("url") ?? "");
        const contentType = target.endsWith(".mp4") ? "video/mp4" : "image/png";
        return route.fulfill({ status: 200, contentType, body: "stub-bytes" });
      });
      await open();
      await page.locator('[data-id="img-a"] [data-testid="media-title"]').waitFor();




      async function downloadVia(id: string) {
        await page.locator(`[data-id="${id}"] [data-testid="media-content"]`).click();
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          page.locator('button[title="下载"]').click(),
        ]);
        expect(await download.failure()).toBeNull();
        const { readFile } = await import("node:fs/promises");
        expect(await readFile((await download.path())!, "utf8")).toBe("stub-bytes");
        return download.suggestedFilename();
      }


      expect(await downloadVia("img-a"), "原名下载：名称即卡片名").toBe("上传图.png");
      await renameCard(page, projectId, "img-a", "海边日落");
      expect(await downloadVia("img-a"), "改名后下载：当前卡片名 + 真实扩展名").toBe("海边日落.png");

      await renameCard(page, projectId, "img-a", "海边日落.mp4");
      expect(await downloadVia("img-a"), "名称带异类扩展名：按真实类型替换").toBe("海边日落.png");

      expect(await downloadVia("img-b"), "同素材其他卡不联动").toBe("上传图.png");

      await renameCard(page, projectId, "vid", "片头素材");
      expect(await downloadVia("vid"), "视频按真实类型命名").toBe("片头素材.mp4");


      await page.locator('[data-id="draft"] [data-testid="media-content"]').click();
      const dockRefNames = () => page.locator('[data-testid="dock-media-ref"] img').evaluateAll(
        (imgs) => imgs.map((img) => img.getAttribute("alt")),
      );
      await vi.waitFor(async () => {
        expect(await dockRefNames(), "面板参考显示当前卡片名").toEqual(["海边日落.mp4"]);
      }, { timeout: 10_000 });
      const edgePairs = async () => {
        const canvas = await getCanvas(projectId);
        return (JSON.parse(canvas.edges) as Array<{ source: string; target: string }>)
          .map((e) => `${e.source}->${e.target}`).sort();
      };
      expect(await edgePairs(), "参考显示更新不改变连线").toEqual(["img-a->draft", "vid->draft"]);
      const renamedNode = await canvasNode(projectId, "img-a");
      expect(renamedNode?.data.assetId, "引用对象仍是原先明确选择的素材").toBe(assetA);
      expect(renamedNode?.data.id ?? renamedNode?.id).toBe("img-a");


      await page.reload();
      await page.locator('[data-id="img-a"] [data-testid="media-title"]').waitFor();
      expect(await nameSpanOf(page, "img-a").textContent(), "刷新后恢复新名称").toBe("海边日落.mp4");
      await page.locator('[data-id="draft"] [data-testid="media-content"]').click();
      await vi.waitFor(async () => {
        expect(await dockRefNames(), "刷新后参考显示仍为持久名称").toEqual(["海边日落.mp4"]);
      }, { timeout: 10_000 });
      expect(await downloadVia("img-a"), "刷新后下载仍用持久名称").toBe("海边日落.png");


      await page.locator('[data-id="img-a"] [data-testid="media-content"]').click();
      await page.locator('button[title="添加到 Agent 聊天"]').click();
      const composer = page.locator('[contenteditable="true"][role="textbox"]').last();
      await vi.waitFor(async () => expect(await composer.textContent()).toContain("海边日落.mp4"));
      const bubbles = page.locator('[class*="userBubble"]');
      await vi.waitFor(async () => expect(await bubbles.first().textContent()).toContain("上传图.png"));
      await page.getByText("改名前的方案", { exact: true }).waitFor();
      expect(await page.locator('[class*="_generationCard_"]').textContent()).toContain("参考上传图.png");
      await page.reload();
      await page.locator('[data-id="img-a"] [data-testid="media-title"]').waitFor();

      await page.locator('[data-id="img-a"] [data-testid="media-content"]').click();
      await page.locator('button[title="添加到 Agent 聊天"]').click();
      await vi.waitFor(async () => {
        expect(await bubbles.first().textContent()).toContain("上传图.png");
        expect(await composer.textContent()).toContain("海边日落.mp4");
      });
      await page.getByText("改名前的方案", { exact: true }).waitFor();
      expect(await page.locator('[class*="_generationCard_"]').textContent()).toContain("参考上传图.png");
      expect((await readJob(historicalJobId))!.input).toEqual(historicalInput);

      await page.screenshot({ path: "/tmp/ikfa8y-reference-download.png", fullPage: true });
    } finally {
      await close();
    }
  }, 180_000);
});
