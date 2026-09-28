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
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { AllExceptionsFilter } from "@lib/infra/filters/all-exceptions.filter.js";

// IKFA8X「卡片名称编辑、持久保存与生成保留」验收（父规格 IKFA8U A01–A18、A23）：
// 真实浏览器（Playwright Chromium）→ 真实业务 API（生产控制器）→ 隔离 MySQL（IKFA8X_DATABASE_URL 门控）→ 刷新恢复。
// 名称字段约定（供后续子任务消费）：媒体节点 data.fileName / 文本节点 data.title；
// 显式自定义状态 data.customName === true（不靠名称内容推断），自动命名路径前置跳过。
// 浏览器段（IKFA8X_BROWSER=1）驱动真实生成生命周期：DB 翻 succeeded/failed 模拟供应商终态。
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
    await prisma.client.generation_model_capability.upsert({
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
      },
      update: { supported_sizes: sizes, default_size: "1024x1024" },
    });
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, CanvasService, MaterialService, AssetService], GenerationJobsController);
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
        // 造素材校验门（IKFYHJ / ADR-0087）自 MaterialService 取仓库面、自 AssetService 解析
        // 本地素材绑定；无输入素材的建单路径只建门不发起上游调用。
        { provide: MaterialService, useValue: new MaterialService(prisma) },
        { provide: AssetService, useValue: new AssetService(prisma, new AssetStorageService()) },
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

  function mediaNode(id: string, mediaType: "image" | "video" | "audio", fileName: string, assetId: string, x: number, extra: Record<string, unknown> = {}): SeedNode {
    return {
      id,
      type: "mediaNode",
      position: { x, y: 90 },
      data: { src: `https://example.com/${id}.bin`, mediaType, fileName, assetId, width: 640, height: 480, ...extra },
    };
  }
  function textNode(id: string, title: string, x: number): SeedNode {
    return { id, type: "textNode", position: { x, y: 90 }, data: { title, html: "<p>正文</p>" } };
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
    const asset = await prisma.client.assets.create({
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
  /** 直接落库把任务翻为 succeeded（输出槽挂产物资产），模拟供应商执行成功 */
  async function succeedJob(projectId: string, jobId: string, url: string) {
    const asset = await prisma.client.assets.create({
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
  /** 直接落库把任务翻为 failed（job + 输出槽），模拟供应商执行失败 */
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
    // 重读（等价刷新/重开项目）内容一致
    const reloaded = await getCanvas(projectId);
    expect(JSON.parse(reloaded.nodes)).toEqual(stored);
  });

  it.runIf(process.env.IKFA8X_BROWSER)("browser: 四类卡片改名、编辑边界、独立性与刷新恢复（A01–A13、A23）", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFA8X browser rename")).id;
    const assetA = await createAsset(projectId, "image", "https://example.com/shared.png");
    const assetV = await createAsset(projectId, "video", "https://example.com/clip.mp4");
    const assetU = await createAsset(projectId, "audio", "https://example.com/bgm.mp3");
    const initialNodes = [
      mediaNode("img-a", "image", "上传图.png", assetA, 0),
      mediaNode("img-b", "image", "上传图.png", assetA, 380),
      mediaNode("vid", "video", "素材视频.mp4", assetV, 760),
      mediaNode("aud", "audio", "配乐.mp3", assetU, 1140),
      textNode("txt", "需求笔记", 1520),
    ];
    expect((await saveCanvas(projectId, initialNodes, [], "missing")).status).toBe(200);

    const vite = await createVite({
      root: `${process.cwd()}/web`,
      server: { open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base }, "/agent": { target: base } } },
    });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      await page.locator('[data-id="img-a"] [data-testid="media-title"]').waitFor();

      const titleOf = (id: string) => page.locator(`[data-id="${id}"] [data-testid="media-title"], [data-id="${id}"] [data-testid="text-title"]`);
      const nameInputOf = (id: string) => titleOf(id).locator("input");
      const nameSpanOf = (id: string) => titleOf(id).locator("span").first();

      /** 双击名称进入编辑并填入新值 */
      async function startRename(id: string, value?: string) {
        await nameSpanOf(id).dblclick();
        await nameInputOf(id).waitFor();
        if (value !== undefined) await nameInputOf(id).fill(value);
      }
      /** 等自动保存把某节点名称与 customName 落进隔离库 */
      async function waitPersisted(id: string, name: string, key: "fileName" | "title") {
        await vi.waitFor(async () => {
          const node = await canvasNode(projectId, id);
          expect(node?.data[key]).toBe(name);
          expect(node?.data.customName).toBe(true);
        }, { timeout: 10_000 });
      }

      // A01+A02+A07：图片双击原位编辑，回车保存（首尾空格被去掉），不产生画布缩放
      const zoomBefore = await page.locator(".react-flow__viewport").getAttribute("style");
      await startRename("img-a", "  海边日落  ");
      await nameInputOf("img-a").press("Enter");
      await waitPersisted("img-a", "海边日落", "fileName");
      expect(await page.locator(".react-flow__viewport").getAttribute("style"), "双击改名不触发画布缩放").toBe(zoomBefore);

      // A03：视频改名后点击画布空白保存
      await startRename("vid", "片头素材");
      await page.locator(".react-flow__pane").click({ position: { x: 800, y: 700 } });
      await waitPersisted("vid", "片头素材", "fileName");

      // A04：音频改名后点击其他卡片（失焦路径）保存
      await startRename("aud", "旁白配音");
      await page.locator('[data-id="vid"] [data-testid="media-content"]').click();
      await waitPersisted("aud", "旁白配音", "fileName");

      // A01+A02：文本卡改名（既有入口回归）
      await startRename("txt", "分镜大纲");
      await nameInputOf("txt").press("Enter");
      await waitPersisted("txt", "分镜大纲", "title");

      // A05：Esc 恢复编辑前名称，取消内容不保存
      await startRename("img-a", "被放弃的名字");
      await nameInputOf("img-a").press("Escape");
      await vi.waitFor(async () => expect(await nameInputOf("img-a").count()).toBe(0));
      expect(await nameSpanOf("img-a").textContent()).toBe("海边日落");
      await page.waitForTimeout(1200); // 越过 800ms 自动保存窗口
      expect((await canvasNode(projectId, "img-a"))?.data.fileName).toBe("海边日落");

      // A06：全空格提交保留原名
      await startRename("img-a", "   ");
      await nameInputOf("img-a").press("Enter");
      expect(await nameSpanOf("img-a").textContent()).toBe("海边日落");
      expect((await canvasNode(projectId, "img-a"))?.data.fileName).toBe("海边日落");

      // A08：100 字符可保存；101 字符提示超长、保留编辑内容、不保存不截断
      const name100 = "鲸".repeat(100);
      await startRename("vid", name100);
      await nameInputOf("vid").press("Enter");
      await waitPersisted("vid", name100, "fileName");
      const name101 = "鲸".repeat(101);
      await startRename("vid", name101);
      await nameInputOf("vid").press("Enter");
      await page.getByRole("alert").filter({ hasText: "100" }).waitFor();
      expect(await nameInputOf("vid").inputValue(), "超长后保留编辑内容").toBe(name101);
      await page.waitForTimeout(1200);
      expect((await canvasNode(projectId, "vid"))?.data.fileName, "超长不写入").toBe(name100);
      // Esc 收起超长草稿后再改名验证恢复
      await nameInputOf("vid").press("Escape");

      // A10：中文输入法组合期间回车不提前提交
      await startRename("aud", "拼音候选");
      await nameInputOf("aud").dispatchEvent("keydown", { key: "Enter", isComposing: true });
      expect(await nameInputOf("aud").count(), "组合中回车不退出编辑").toBe(1);
      await nameInputOf("aud").press("Enter");
      await waitPersisted("aud", "拼音候选", "fileName");

      // A09：两张卡改为同名，身份与持久化互不混淆
      await startRename("aud", "海边日落");
      await nameInputOf("aud").press("Enter");
      await waitPersisted("aud", "海边日落", "fileName");
      expect((await canvasNode(projectId, "img-a"))?.data.fileName).toBe("海边日落");
      expect((await canvasNode(projectId, "img-a"))?.id).toBe("img-a");
      expect((await canvasNode(projectId, "aud"))?.id).toBe("aud");

      // A13：同素材两张卡只改一张，另一张保持；素材库资产行不被触碰
      const assetRowBefore = await prisma.client.assets.findUnique({ where: { id: BigInt(assetA) } });
      expect((await canvasNode(projectId, "img-b"))?.data.fileName).toBe("上传图.png");
      expect((await canvasNode(projectId, "img-b"))?.data.customName).toBeUndefined();
      const assetRowAfter = await prisma.client.assets.findUnique({ where: { id: BigInt(assetA) } });
      expect(assetRowAfter?.gmt_modified).toEqual(assetRowBefore?.gmt_modified);

      // A11：新建普通文本立即改名，无需刷新
      await page.getByRole("button", { name: "添加文本" }).click();
      const newText = page.locator(".react-flow__node-textNode", { hasNot: page.locator('[data-id="txt"]') }).last();
      const newTextId = await newText.getAttribute("data-id");
      expect(newTextId).toBeTruthy();
      await startRename(newTextId!, "新建即改");
      await nameInputOf(newTextId!).press("Enter");
      await waitPersisted(newTextId!, "新建即改", "title");

      // A17：先给 img-b 自定义名再复制：副本继承名称与自定义状态；此后分别改名互不影响
      await startRename("img-b", "母版名");
      await nameInputOf("img-b").press("Enter");
      await waitPersisted("img-b", "母版名", "fileName");
      await page.locator('[data-id="img-b"] [data-testid="media-content"]').click({ button: "right" });
      await page.getByRole("button", { name: "创建副本" }).click();
      let namedCopyId = "";
      await vi.waitFor(async () => {
        const canvas = await getCanvas(projectId);
        const nodes = JSON.parse(canvas.nodes) as Array<SeedNode>;
        const copy = nodes.find((n) => n.id !== "img-b" && n.data.fileName === "母版名");
        expect(copy, "复制继承自定义名与标记").toBeTruthy();
        expect(copy!.data.customName).toBe(true);
        namedCopyId = copy!.id;
      }, { timeout: 10_000 });
      // 副本与源卡错位 40px 堆叠且源卡仍处于选中高 z 序：先点空白取消选中，让副本标题行可点
      await page.locator(".react-flow__pane").click({ position: { x: 800, y: 760 } });
      await startRename(namedCopyId, "副本改名");
      await nameInputOf(namedCopyId).press("Enter");
      await waitPersisted(namedCopyId, "副本改名", "fileName");
      expect((await canvasNode(projectId, "img-b"))?.data.fileName).toBe("母版名");

      // A12：刷新后从真实保存链路恢复全部新名称
      await page.reload();
      await page.locator('[data-id="img-a"] [data-testid="media-title"]').waitFor();
      expect(await nameSpanOf("img-a").textContent()).toBe("海边日落");
      expect(await nameSpanOf("img-b").textContent()).toBe("母版名");
      expect(await nameSpanOf("vid").textContent()).toBe(name100);
      expect(await nameSpanOf("aud").textContent()).toBe("海边日落");
      expect(await nameSpanOf("txt").textContent()).toBe("分镜大纲");
      expect(await nameSpanOf(newTextId!).textContent()).toBe("新建即改");
      expect(await nameSpanOf(namedCopyId).textContent()).toBe("副本改名");

      // A23：常用缩放下名称可编辑，普通拖动不退化（缩小一档后 vid 仍在视口内）
      await page.getByRole("button", { name: "缩小" }).click(); // ZoomControl 缩小一档
      await startRename("vid", "缩放下改名");
      await nameInputOf("vid").press("Enter");
      await waitPersisted("vid", "缩放下改名", "fileName");
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
      await browser.close();
      await vite.close();
    }
  }, 180_000);

  it.runIf(process.env.IKFA8X_BROWSER)("browser: 自定义名跨首次生成、重新生成、失败重试保留（A14–A16）", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFA8X browser generation")).id;
    const initialNodes = [
      imageDraftNode("d-custom", "我的封面图", 0, { customName: true }),
      imageDraftNode("d-auto", "图片草稿", 380),
    ];
    expect((await saveCanvas(projectId, initialNodes, [], "missing")).status).toBe(200);

    const vite = await createVite({
      root: `${process.cwd()}/web`,
      server: { open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base }, "/agent": { target: base } } },
    });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      const customCard = page.locator('[data-id="d-custom"]');
      const autoCard = page.locator('[data-id="d-auto"]');
      await customCard.waitFor();
      const customTitle = () => customCard.locator('[data-testid="media-title"]');
      const autoTitle = () => autoCard.locator('[data-testid="media-title"]');

      // 面板输入框为 PromptRefEditor 富文本编辑器（contenteditable），不再是 textarea（IKFA1M 起）。
      // 先全选清空再逐字键入，走浏览器真实输入路径
      const promptEditor = () => page.locator('[contenteditable="true"]').first();
      async function fillPrompt(text: string) {
        const editor = promptEditor();
        await editor.click();
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.press("Backspace");
        await page.waitForTimeout(150);
        await editor.pressSequentially(text, { delay: 30 });
      }
      /** 打开草稿绑定面板并发送（真实业务 API 建任务） */
      async function sendDraft(id: string, prompt: string) {
        await page.locator(`[data-id="${id}"] [data-testid="media-content"]`).click();
        await promptEditor().waitFor();
        await page.getByText("IKFA8X Test", { exact: true }).waitFor();
        await fillPrompt(prompt);
        await page.locator('button[title="发送"]').click();
        await vi.waitFor(async () => {
          const job = await readJob(await latestJobId(projectId));
          expect(job!.input.target_node_id).toBe(id);
          expect(job!.input.prompt).toBe(prompt);
        }, { timeout: 10_000 });
        return latestJobId(projectId);
      }

      // A14 首次生成：自定义名草稿原位转生成中 → DB 翻 succeeded → 同卡回填，名称保留
      const firstJobId = await sendDraft("d-custom", "画一只蓝鲸");
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

      // 刷新后名称与自定义状态仍在（持久状态恢复）
      await page.reload();
      await customCard.waitFor();
      expect(await customTitle().textContent()).toContain("我的封面图");

      // A15 重新生成失败：名称与重试入口保留
      await customCard.locator('[data-testid="media-content"]').click();
      await page.getByText("重新编辑", { exact: true }).click();
      await promptEditor().waitFor();
      await page.getByText("IKFA8X Test", { exact: true }).waitFor();
      await fillPrompt("换成深海");
      await page.locator('button[title="发送"]').click();
      const regenJobId = await (async () => {
        await vi.waitFor(async () => {
          expect((await readJob(await latestJobId(projectId)))!.input.prompt).toBe("换成深海");
        }, { timeout: 10_000 });
        return latestJobId(projectId);
      })();
      expect(await customTitle().textContent(), "重新生成中仍保留自定义名").toContain("我的封面图");
      await failJob(regenJobId);
      await customCard.locator('[data-testid="fail-overlay"]').waitFor({ timeout: 15_000 });
      expect(await customTitle().textContent(), "失败保留自定义名").toContain("我的封面图");

      // A15 失败重试：沿用冻结快照建任务，成功后名称与自定义状态保留
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

      // A16 对照：未自定义草稿沿用自动命名（生成-<jobId>）
      const autoJobId = await sendDraft("d-auto", "自动命名对照");
      await succeedJob(projectId, autoJobId, "https://example.com/ikfa8x-out-auto.png");
      await vi.waitFor(async () => {
        const node = await canvasNode(projectId, "d-auto");
        expect(node?.data.fileName).toBe(`生成-${autoJobId}`);
        expect(node?.data.customName).toBeUndefined();
      }, { timeout: 15_000 });
      expect(await autoTitle().textContent()).toContain(`生成-${autoJobId}`);

      await page.screenshot({ path: "/tmp/ikfa8x-generation.png", fullPage: true });
    } finally {
      await browser.close();
      await vite.close();
    }
  }, 180_000);

  // IKIQ2E（父决策 IKIQ2D「生成中允许改名」分支）：生成进行中当刻执行改名这个动作本身，
  // 此前只在「改名前置已完成」的终态断言里被间接覆盖。这里把改名动作落到 genStatus='generating'
  // 当刻，走与 A14–A16 同一条接缝：真实浏览器 → 真实业务 API → 隔离 MySQL → 刷新恢复。
  it.runIf(process.env.IKFA8X_BROWSER)("browser: 生成进行中改名覆盖编辑入口、终态保留、引用同步与刷新恢复（IKIQ2E）", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKIQ2E generating rename")).id;
    const assetA = await createAsset(projectId, "image", "https://example.com/gen-shared.png");
    // d1：生成中改名主用例卡；img-a/img-b：同素材两张卡做归属隔离对照；d2：引用 d1 的草稿卡
    const initialNodes = [
      mediaNode("img-a", "image", "上传图.png", assetA, 0, { mime: "image/png" }),
      mediaNode("img-b", "image", "上传图.png", assetA, 380, { mime: "image/png" }),
      imageDraftNode("d1", "图片草稿", 760),
      imageDraftNode("d2", "引用方草稿", 1140),
    ];
    const initialEdges = [{ id: "e-d1-d2", source: "d1", target: "d2" }];
    expect((await saveCanvas(projectId, initialNodes, initialEdges, "missing")).status).toBe(200);

    const vite = await createVite({
      root: `${process.cwd()}/web`,
      server: { open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base }, "/agent": { target: base } } },
    });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);

      const d1Card = page.locator('[data-id="d1"]');
      await d1Card.locator('[data-testid="media-title"]').waitFor();
      const titleOf = (id: string) => page.locator(`[data-id="${id}"] [data-testid="media-title"]`);
      const nameInputOf = (id: string) => titleOf(id).locator("input");
      const nameSpanOf = (id: string) => titleOf(id).locator("span").first();

      const promptEditor = () => page.locator('[contenteditable="true"]').first();
      async function fillPrompt(text: string) {
        const editor = promptEditor();
        await editor.click();
        await page.keyboard.press("ControlOrMeta+A");
        await page.keyboard.press("Backspace");
        await page.waitForTimeout(150);
        await editor.pressSequentially(text, { delay: 30 });
      }
      /** 双击名称进入原位编辑并填值（不提交，交给各段决定回车 / Esc） */
      async function startRename(id: string, value: string) {
        await nameSpanOf(id).dblclick();
        await nameInputOf(id).waitFor();
        await nameInputOf(id).fill(value);
      }
      /** 双击 → 回车保存，等自动保存把名称与 customName 标记落进隔离库 */
      async function rename(id: string, value: string) {
        await startRename(id, value);
        await nameInputOf(id).press("Enter");
        await vi.waitFor(async () => {
          const node = await canvasNode(projectId, id);
          expect(node?.data.fileName).toBe(value);
          expect(node?.data.customName, "改名后须显式标记 customName，不靠名称内容推断").toBe(true);
        }, { timeout: 10_000 });
      }
      /** 发送一次生成并等任务落库，返回任务号。
       *  草稿卡与有生成记录的成品卡同路径：点卡即自动打开其生成面板（IKDMQU），发送后原卡承接任务。
       *  生成终态由直接改库驱动，任务停在 processing 期间卡片稳定处于生成中。 */
      async function sendDraft(id: string, prompt: string) {
        await page.locator(`[data-id="${id}"] [data-testid="media-content"]`).click();
        await promptEditor().waitFor();
        await page.getByText("IKFA8X Test", { exact: true }).waitFor();
        await fillPrompt(prompt);
        await page.locator('button[title="发送"]').click();
        await vi.waitFor(async () => {
          const job = await readJob(await latestJobId(projectId));
          expect(job!.input.target_node_id, "任务落在目标卡上").toBe(id);
          expect(job!.input.prompt).toBe(prompt);
        }, { timeout: 10_000 });
        return latestJobId(projectId);
      }

      // 生成中编辑入口：草稿卡进入生成中后双击仍进原位编辑，回车落库，画布不放大
      const firstJobId = await sendDraft("d1", "画一只蓝鲸");
      expect(await nameSpanOf("d1").textContent(), "未自定义草稿生成中沿用自动占位名").toContain("图片生成中");
      const zoomBefore = await page.locator(".react-flow__viewport").getAttribute("style");
      await rename("d1", "生成中起的名");
      expect(await page.locator(".react-flow__viewport").getAttribute("style"), "生成中双击改名不触发画布缩放").toBe(zoomBefore);
      expect(await nameSpanOf("d1").textContent(), "改名当刻不被自动名回写").toContain("生成中起的名");
      const nodeWhileGenerating = await canvasNode(projectId, "d1");
      expect(nodeWhileGenerating?.id, "原位生成保持同一卡身份").toBe("d1");
      expect(nodeWhileGenerating?.data.genStatus, "改名当刻卡片确在生成中").toBe("generating");

      // Esc 取消：编辑内容丢弃，随后真实失焦不提交已取消内容
      await startRename("d1", "被放弃的名字");
      await nameInputOf("d1").press("Escape");
      await vi.waitFor(async () => expect(await nameInputOf("d1").count()).toBe(0));
      expect(await nameSpanOf("d1").textContent()).toContain("生成中起的名");
      await page.locator('[data-id="img-a"] [data-testid="media-content"]').click(); // 触发真实失焦
      await page.waitForTimeout(1200); // 越过 800ms 自动保存窗口
      expect((await canvasNode(projectId, "d1"))?.data.fileName, "Esc 取消后失焦不提交").toBe("生成中起的名");

      // 成功回填：生成中改的名不被自动名覆盖
      await succeedJob(projectId, firstJobId, "https://example.com/ikiq2e-out-1.png");
      await vi.waitFor(async () => {
        const node = await canvasNode(projectId, "d1");
        expect(node?.data.src).toBe("https://example.com/ikiq2e-out-1.png");
        expect(node?.data.fileName, "成功回填保留生成中改的名").toBe("生成中起的名");
        expect(node?.data.customName).toBe(true);
        expect(node?.data.draft).toBeUndefined();
      }, { timeout: 15_000 });
      expect(await nameSpanOf("d1").textContent()).toContain("生成中起的名");

      // 失败重试：重新生成进入生成中后再改名，失败态与重试后的成功回填都保留
      const regenJobId = await sendDraft("d1", "换成深海");
      await rename("d1", "重试前改的名");
      await failJob(regenJobId);
      await d1Card.locator('[data-testid="fail-overlay"]').waitFor({ timeout: 15_000 });
      expect(await nameSpanOf("d1").textContent(), "失败态保留生成中改的名").toContain("重试前改的名");
      await d1Card.locator('[data-testid="fail-overlay"] button', { hasText: "重试" }).click();
      const retryJobId = await (async () => {
        await vi.waitFor(async () => expect(await latestJobId(projectId)).not.toBe(regenJobId), { timeout: 10_000 });
        return latestJobId(projectId);
      })();
      expect(await nameSpanOf("d1").textContent(), "重试生成中保留名称").toContain("重试前改的名");
      await succeedJob(projectId, retryJobId, "https://example.com/ikiq2e-out-2.png");
      await vi.waitFor(async () => {
        const node = await canvasNode(projectId, "d1");
        expect(node?.data.src).toBe("https://example.com/ikiq2e-out-2.png");
        expect(node?.data.fileName, "重试成功回填保留名称与自定义状态").toBe("重试前改的名");
        expect(node?.data.customName).toBe(true);
      }, { timeout: 15_000 });

      // 成品卡重新生成中改名：重新生成成功后不被自动名覆盖
      const regen2JobId = await sendDraft("d1", "第三次重画");
      await rename("d1", "成品重生成中改的名");
      await succeedJob(projectId, regen2JobId, "https://example.com/ikiq2e-out-3.png");
      await vi.waitFor(async () => {
        const node = await canvasNode(projectId, "d1");
        expect(node?.data.src).toBe("https://example.com/ikiq2e-out-3.png");
        expect(node?.data.fileName, "成品卡重新生成成功保留改名").toBe("成品重生成中改的名");
        expect(node?.data.customName).toBe(true);
      }, { timeout: 15_000 });

      // 归属隔离：改的是与 img-b 同素材的 img-a，img-b 名称与自定义状态、素材库资产行都不被联动
      const assetRowBefore = await prisma.client.assets.findUnique({ where: { id: BigInt(assetA) } });
      await rename("img-a", "只改这张");
      expect((await canvasNode(projectId, "img-a"))?.data.fileName).toBe("只改这张");
      expect((await canvasNode(projectId, "img-b"))?.data.fileName, "同素材另一张卡名称不被联动").toBe("上传图.png");
      expect((await canvasNode(projectId, "img-b"))?.data.customName, "同素材另一张卡自定义状态不被联动").toBeUndefined();
      const assetRowAfter = await prisma.client.assets.findUnique({ where: { id: BigInt(assetA) } });
      expect(assetRowAfter?.gmt_modified, "素材库资产行不被改名触碰").toEqual(assetRowBefore?.gmt_modified);

      // 生成中改名的卡仍是被 d2 引用的那张：连线与引用身份不变，生成结束后参考显示同步新名称
      const regen3JobId = await sendDraft("d1", "第四次重画");
      const beforeRename = (await canvasNode(projectId, "d1"))!;
      await rename("d1", "被引用的生成中卡");
      // 生成中改名不扰动连线与卡片身份。
      // 注：生成中的卡片按 mediaRefs 口径不能作为参考（mediaRefs.ts「生成中的卡片不能作为参考」），
      // 所以参考显示同步只能在生成结束后观察；此处先钉住改名当刻连线与身份不变。
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

      // 参考显示同步当前名称：改名是在生成中做的，此处读回的是它落库后的结果
      await page.locator('[data-id="d2"] [data-testid="media-content"]').click();
      await promptEditor().waitFor();
      const dockRefNames = () => page.locator('[data-testid="dock-media-ref"] img').evaluateAll(
        (imgs) => imgs.map((img) => img.getAttribute("alt")),
      );
      await vi.waitFor(async () => {
        expect(await dockRefNames(), "参考显示同步生成中改的名").toEqual(["被引用的生成中卡"]);
      }, { timeout: 10_000 });
      expect(await edgePairs(), "参考显示更新不改变连线").toEqual(["d1->d2"]);
      const referencedNode = await canvasNode(projectId, "d1");
      expect(referencedNode?.id, "引用对象仍是同一节点").toBe("d1");
      // 本轮重新生成成功后卡片指向新产物资产是预期行为；「改名不改素材绑定」由上方生成中
      // 当刻的 assetId 断言承担，此处回读引用已跟随到本轮产物。
      expect(referencedNode?.data.assetId, "参考跟随本轮新产物资产").not.toBe(beforeRename.data.assetId);

      // 刷新恢复：名称与「用户自定义过」状态同时从真实保存链路恢复
      await page.reload();
      await d1Card.waitFor();
      expect(await nameSpanOf("d1").textContent(), "刷新后恢复生成中改的名").toContain("被引用的生成中卡");
      const reloadedNode = await canvasNode(projectId, "d1");
      expect(reloadedNode?.data.customName, "刷新后自定义状态随名称一起恢复").toBe(true);

      await page.screenshot({ path: "/tmp/ikiq2e-generating-rename.png", fullPage: true });
    } finally {
      await browser.close();
      await vite.close();
    }
  }, 300_000);

  it.runIf(process.env.IKFA8X_BROWSER)("browser: 保存失败沿用现有反馈，不把本地变化误报为已落库（A18）", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFA8X browser save-failure")).id;
    const assetA = await createAsset(projectId, "image", "https://example.com/fail-shared.png");
    expect((await saveCanvas(projectId, [mediaNode("img-a", "image", "原名.png", assetA, 0)], [], "missing")).status).toBe(200);

    const vite = await createVite({
      root: `${process.cwd()}/web`,
      server: { open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base }, "/agent": { target: base } } },
    });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      const titleRow = page.locator('[data-id="img-a"] [data-testid="media-title"]');
      await titleRow.waitFor();

      // 保存故障注入：PUT 画布一律 500
      await page.route("**/api/canvases/*", (route) => {
        if (route.request().method() === "PUT") return route.fulfill({ status: 500, body: "forced failure" });
        return route.continue();
      });
      await titleRow.locator("span").first().dblclick();
      const input = titleRow.locator("input");
      await input.waitFor();
      await input.fill("故障期新名");
      await input.press("Enter");
      // 现有错误反馈：左下角保存失败提示出现；本地显示变化不视为持久化成功
      await page.getByText("保存失败，请重试").first().waitFor({ timeout: 10_000 });
      await page.waitForTimeout(300);
      expect((await canvasNode(projectId, "img-a"))?.data.fileName, "故障期名称不落库").toBe("原名.png");

      // 恢复后再次编辑名称即可随自动保存落库
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
      await browser.close();
      await vite.close();
    }
  }, 60_000);

  it.runIf(process.env.IKFA8X_BROWSER)("browser: 改名同步当前参考显示与下载命名（IKFA8Y A19–A22）", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFA8Y browser reference sync")).id;
    const assetA = await createAsset(projectId, "image", "https://example.com/shared.png");
    const assetV = await createAsset(projectId, "video", "https://example.com/clip.mp4");
    // 两张卡共享同一 Asset 身份，改名只影响被选择的节点。
    const initialNodes = [
      mediaNode("img-a", "image", "上传图.png", assetA, 0, { mime: "image/png" }),
      mediaNode("img-b", "image", "上传图.png", assetA, 380, { mime: "image/png" }),
      mediaNode("vid", "video", "片头.mp4", assetV, 760, { mime: "video/mp4" }),
      imageDraftNode("draft", "图片草稿", 1140),
    ];
    // 当前生成面板已引用两张卡：草稿绑定面板按连线实时推导参考
    const initialEdges = [
      { id: "e-img-a-draft", source: "img-a", target: "draft" },
      { id: "e-vid-draft", source: "vid", target: "draft" },
    ];
    expect((await saveCanvas(projectId, initialNodes, initialEdges, "missing")).status).toBe(200);

    // A21：改名前通过真实生成 API 创建历史输入；稍后验证改名与刷新不改写落库快照。
    const created = await createJob(projectId, {
      type: "image", expected_output_count: 1, input_asset_ids: [assetA],
      parameters: { prompt: "参考上传图.png", model_id: MODEL_ID, aspect_ratio: "1:1" },
    });
    expect(created.code).toBe(200);
    const historicalJobId = created.data.generation_job_id;
    const historicalInput = (await readJob(historicalJobId))!.input;
    expect(historicalInput.prompt).toBe("参考上传图.png");

    const vite = await createVite({
      root: `${process.cwd()}/web`,
      server: { open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base }, "/agent": { target: base } } },
    });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      // 独立 Agent 服务用契约快照夹具；画布改名、保存和刷新仍走真实业务 API + MySQL。
      // 这里只验前端保留历史名称，不作为 Agent 真实落库证明。
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
      // 素材地址在测试域外：开发模式下前端经 Vite /__tos-fetch 代理取素材，
      // 路由内按目标地址返回真实类型响应，走与生产一致的 fetch→blob→下载分支
      await page.route("**/__tos-fetch**", (route) => {
        const target = decodeURIComponent(new URL(route.request().url()).searchParams.get("url") ?? "");
        const contentType = target.endsWith(".mp4") ? "video/mp4" : "image/png";
        return route.fulfill({ status: 200, contentType, body: "stub-bytes" });
      });
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      await page.locator('[data-id="img-a"] [data-testid="media-title"]').waitFor();

      const nameSpanOf = (id: string) => page.locator(`[data-id="${id}"] [data-testid="media-title"] span`).first();
      /** 双击名称进入编辑、填值并回车保存 */
      async function rename(id: string, value: string) {
        await nameSpanOf(id).dblclick();
        const input = page.locator(`[data-id="${id}"] [data-testid="media-title"] input`);
        await input.waitFor();
        await input.fill(value);
        await input.press("Enter");
      }
      async function waitPersisted(id: string, name: string) {
        await vi.waitFor(async () => {
          const node = await canvasNode(projectId, id);
          expect(node?.data.fileName).toBe(name);
          expect(node?.data.customName).toBe(true);
        }, { timeout: 10_000 });
      }
      /** 检查浏览器下载事件、实际文件字节与建议文件名，不替换 DOM 下载行为。 */
      async function downloadVia(id: string) {
        await page.locator(`[data-id="${id}"] [data-testid="media-content"]`).click();
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          page.locator(`[data-id="${id}"] button[title="下载"]`).click(),
        ]);
        expect(await download.failure()).toBeNull();
        const { readFile } = await import("node:fs/promises");
        expect(await readFile((await download.path())!, "utf8")).toBe("stub-bytes");
        return download.suggestedFilename();
      }

      // A22：改名后下载用当前卡片名称 + 真实类型扩展名（素材地址 .png 决定扩展名）
      expect(await downloadVia("img-a"), "原名下载：名称即卡片名").toBe("上传图.png");
      await rename("img-a", "海边日落");
      await waitPersisted("img-a", "海边日落");
      expect(await downloadVia("img-a"), "改名后下载：当前卡片名 + 真实扩展名").toBe("海边日落.png");
      // A22 边界：名称自带别的扩展名时按真实类型替换，不出现「.mp4.png」
      await rename("img-a", "海边日落.mp4");
      await waitPersisted("img-a", "海边日落.mp4");
      expect(await downloadVia("img-a"), "名称带异类扩展名：按真实类型替换").toBe("海边日落.png");
      // A22：同素材另一张卡下载名称不被联动
      expect(await downloadVia("img-b"), "同素材其他卡不联动").toBe("上传图.png");
      // 视频卡按各自真实类型命名
      await rename("vid", "片头素材");
      await waitPersisted("vid", "片头素材");
      expect(await downloadVia("vid"), "视频按真实类型命名").toBe("片头素材.mp4");

      // A19：改名已被当前生成面板引用的卡片 → 参考显示同步新名称，连线与引用身份不变
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

      // A19+A22：保存成功并刷新恢复后，参考显示与下载都使用持久恢复的新名称
      await page.reload();
      await page.locator('[data-id="img-a"] [data-testid="media-title"]').waitFor();
      expect(await nameSpanOf("img-a").textContent(), "刷新后恢复新名称").toBe("海边日落.mp4");
      await page.locator('[data-id="draft"] [data-testid="media-content"]').click();
      await vi.waitFor(async () => {
        expect(await dockRefNames(), "刷新后参考显示仍为持久名称").toEqual(["海边日落.mp4"]);
      }, { timeout: 10_000 });
      expect(await downloadVia("img-a"), "刷新后下载仍用持久名称").toBe("海边日落.png");

      // A20/A21：新加入聊天用当前名；已有聊天与生成方案仍显示历史名称。
      await page.locator('[data-id="img-a"] [data-testid="media-content"]').click();
      await page.locator('[data-id="img-a"] button[title="添加到 Agent 聊天"]').click();
      const composer = page.locator('[contenteditable="true"][role="textbox"]').last();
      await vi.waitFor(async () => expect(await composer.textContent()).toContain("海边日落.mp4"));
      const bubbles = page.locator('[class*="userBubble"]');
      await vi.waitFor(async () => expect(await bubbles.first().textContent()).toContain("上传图.png"));
      await page.getByText("改名前的方案", { exact: true }).waitFor();
      expect(await page.locator('[class*="_generationCard_"]').textContent()).toContain("参考上传图.png");
      await page.reload();
      await page.locator('[data-id="img-a"] [data-testid="media-title"]').waitFor();
      // 重新打开 Agent 后从快照恢复，旧消息及方案不得变成当前卡名。
      await page.locator('[data-id="img-a"] [data-testid="media-content"]').click();
      await page.locator('[data-id="img-a"] button[title="添加到 Agent 聊天"]').click();
      await vi.waitFor(async () => {
        expect(await bubbles.first().textContent()).toContain("上传图.png");
        expect(await composer.textContent()).toContain("海边日落.mp4");
      });
      await page.getByText("改名前的方案", { exact: true }).waitFor();
      expect(await page.locator('[class*="_generationCard_"]').textContent()).toContain("参考上传图.png");
      expect((await readJob(historicalJobId))!.input).toEqual(historicalInput);

      await page.screenshot({ path: "/tmp/ikfa8y-reference-download.png", fullPage: true });
    } finally {
      await browser.close();
      await vite.close();
    }
  }, 180_000);
});
