import "reflect-metadata";
import { Module } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasesController } from "./canvases.controller.js";
import { GenerationJobsController } from "../generation/generation-jobs.controller.js";
import { GenerationModelsController } from "../generation/models.controller.js";
import { ProjectsController } from "../projects/projects.controller.js";
import { JobsController } from "../jobs/jobs.controller.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { AllExceptionsFilter } from "@lib/infra/filters/all-exceptions.filter.js";
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

        features: { reference_image: true },

        channel: "seedream-image",
      },
      update: { supported_sizes: sizes, default_size: "1024x1024", features: { reference_image: true } },
    });

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
        features: { image_reference_max: 2 },

        channel: "seedream-image",
      },
      update: { features: { image_reference_max: 2 } },
    });
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, CanvasService, MaterialService, AssetService, AssetStorageService, AccountDirectoryService], GenerationJobsController);
    Reflect.defineMetadata("design:paramtypes", [ModelCapabilityReadService], GenerationModelsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
    Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
    class HarnessModule {}
    Module({ controllers: [CanvasesController, GenerationJobsController, GenerationModelsController, ProjectsController, JobsController], providers: [


      { provide: APP_FILTER, useClass: AllExceptionsFilter },
      { provide: MaterialService, useValue: new MaterialService(prisma, new SystemSettingsService(prisma)) },
      { provide: AssetService, useValue: new AssetService(prisma, new AssetStorageService()) },
      { provide: AssetStorageService, useValue: new AssetStorageService() },
      { provide: CanvasService, useValue: canvasService },
      { provide: ProjectService, useValue: projects },
      { provide: PrismaService, useValue: prisma },
      { provide: SnapshotService, useValue: new SnapshotService(prisma) },
      { provide: JobsService, useValue: new JobsService(prisma, projects) },
      { provide: GenerationCommandService, useValue: new GenerationCommandService(prisma) },
      { provide: ModelCapabilityReadService, useValue: new ModelCapabilityReadService(prisma) },

      { provide: MaterialService, useValue: new MaterialService(prisma, new SystemSettingsService(prisma)) },
      { provide: AssetService, useValue: new AssetService(prisma, new AssetStorageService()) },
      { provide: AccountDirectoryService, useValue: new AccountDirectoryService(prisma) },
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

  function draftNode(id: string, prompt = "", x = 420, y = 160) {
    return {
      id,
      type: "mediaNode",
      position: { x, y },
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
    expect(created.code).toBe(1004);
    expect(created.msg).toContain("参考图最多 2 张");

    expect(await prisma.client.generation_jobs.count({ where: { project_id: BigInt(projectId) } })).toBe(0);
  });





  it.runIf(process.env.IKDMQR_BROWSER)("browser: dock pick ↔ edge two-way sync, immediate persist, failure retry, frozen input", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKDMQR browser")).id;
    const imageAssetId = await createAsset(projectId, "image", "https://example.com/ref-one.png");
    const imageAssetId2 = await createAsset(projectId, "image", "https://example.com/ref-two.png");
    const videoAssetId = await createAsset(projectId, "video", "https://example.com/ref-video.mp4");
    expect(
      (await saveCanvas(
        projectId,
        [
          readyImageNode("m1", imageAssetId, "参考图一", 100, 80),
          readyImageNode("m2", imageAssetId2, "参考图二", 100, 260),
          readyVideoNode("v1", videoAssetId, "参考视频", 100, 460),
          textNode("t1", "故事文案正文", "故事文案"),

          draftNode("d2", "", 1100, 60),
        ],
        [],
        "missing",
        JSON.stringify({ x: 0, y: 0, zoom: 1 }),
      )).status,
    ).toBe(200);

    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
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
      const dockTexts = page.locator('[data-testid="dock-text-ref"]');
      const editor = page.locator('[contenteditable="true"]');
      const nodeById = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
      const savedPairs = async () => {
        const canvas = await getCanvas(projectId);
        return (JSON.parse(canvas.edges) as Array<{ source: string; target: string }>).map((e) => `${e.source}->${e.target}`);
      };

      async function enterPickMode() {
        await page.locator('button[title="从资产中选择 / 从节点添加素材"]').click();
        await page.getByText("从节点添加素材", { exact: true }).click();
        await page.getByText("点击画布中的图片节点").waitFor();
      }



      async function dragConnect(sourceId: string, targetId: string) {
        const src = page.locator(`.react-flow__node[data-id="${sourceId}"] .react-flow__handle-right`);
        const dst = page.locator(`.react-flow__node[data-id="${targetId}"] .react-flow__handle-left`);
        const sb = (await src.boundingBox())!;
        const db = (await dst.boundingBox())!;
        await page.mouse.move(sb.x + sb.width * 0.75, sb.y + sb.height / 2);
        await page.mouse.down();
        await page.mouse.move(db.x + db.width * 0.25, db.y + db.height / 2, { steps: 24 });
        await page.mouse.up();
      }


      await nodeById("m1").locator("img").waitFor();
      await nodeById("m2").locator("img").waitFor();
      await nodeById("v1").locator("video").waitFor();
      await nodeById("t1").waitFor();


      await page.locator('button[aria-label="图片"]').click();
      await editor.waitFor();
      const draftNodeLocator = page.locator('.react-flow__node-mediaNode:not([data-id="d2"])', { hasText: "图片生成" });
      const draftId = (await draftNodeLocator.getAttribute("data-id"))!;
      expect(await edges.count()).toBe(0);
      expect(generationRequests, "建卡不创建生成任务").toEqual([]);


      await enterPickMode();
      await nodeById("m1").locator('[data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await edges.count(), "Dock 选择立即建立连线").toBe(1));
      await vi.waitFor(async () => expect(await dockRefs.count(), "Dock 显示连线参考").toBe(1));
      expect(await dockRefs.first().locator("img").getAttribute("alt")).toBe("参考图一");


      await vi.waitFor(async () => {
        expect(await savedPairs(), "参考连线未发送即落盘").toContain(`m1->${draftId}`);
      }, { timeout: 10_000 });
      expect(generationRequests, "保存参考不创建生成任务").toEqual([]);


      await enterPickMode();
      await nodeById("m2").locator('[data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await edges.count()).toBe(2));
      await vi.waitFor(async () => expect(await dockRefs.count()).toBe(2));
      expect(await dockRefs.nth(0).locator("img").getAttribute("alt")).toBe("参考图一");
      expect(await dockRefs.nth(1).locator("img").getAttribute("alt")).toBe("参考图二");




      await page.locator('button[title="关闭"]').dispatchEvent("click");
      await vi.waitFor(async () => expect(await editor.count(), "关闭后面板退出").toBe(0));
      await nodeById(draftId).locator('[data-testid="media-content"]').click();
      await editor.waitFor();
      await vi.waitFor(async () => expect(await dockRefs.count(), "关闭重开恢复全部参考").toBe(2));


      await nodeById("d2").locator('[data-testid="media-content"]').click();
      await editor.waitFor();
      await vi.waitFor(async () => expect(await dockRefs.count(), "B 不串入 A 的参考").toBe(0));

      await page.locator('button[title="关闭"]').dispatchEvent("click");
      await vi.waitFor(async () => expect(await editor.count()).toBe(0));
      await nodeById(draftId).locator('[data-testid="media-content"]').click();
      await editor.waitFor();
      await vi.waitFor(async () => expect(await dockRefs.count(), "切回 A 恢复全部参考").toBe(2));


      let failSave = true;
      await page.route("**/api/canvases/*", async (route) => {
        if (failSave && route.request().method() === "PUT") return route.abort();
        return route.continue();
      });
      await editor.click();
      await page.keyboard.type("失败保留");
      await page.getByText("保存失败，请重试").first().waitFor();
      expect(await dockRefs.count(), "保存失败保留当前页面选择").toBe(2);
      expect(await page.locator('button[title="发送"]').isDisabled(), "保存失败时阻止发送").toBe(true);


      const draftB = nodeById("d2");
      await draftB.locator('[data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await editor.count(), "保存失败时 B 面板不打开").toBe(0));
      await nodeById(draftId).locator('[data-testid="media-content"]').click();
      await editor.waitFor();
      await vi.waitFor(async () => expect(await dockRefs.count(), "重开原目标保留全部选择").toBe(2));

      failSave = false;
      await page.getByRole("button", { name: "重试保存" }).click();
      await page.getByText("已保存").waitFor();
      await vi.waitFor(async () => {
        const pairs = await savedPairs();
        expect(pairs).toContain(`m1->${draftId}`);
        expect(pairs).toContain(`m2->${draftId}`);
      }, { timeout: 10_000 });
      await page.unroute("**/api/canvases/*");


      await dockRefs.nth(1).locator('button[title="移除"]').click();
      await vi.waitFor(async () => expect(await edges.count(), "Dock 移除断开连线").toBe(1));
      await vi.waitFor(async () => expect(await dockRefs.count()).toBe(1));
      await nodeById("m2").locator("img").waitFor();


      await dragConnect("m2", draftId);
      await vi.waitFor(async () => expect(await page.locator(`.react-flow__edge[data-id="e-m2-${draftId}"]`).count(), "画布拖线建立 m2→草稿 连线").toBe(1));
      await vi.waitFor(async () => expect(await dockRefs.count(), "连线后 Dock 同步显示").toBe(2));


      await enterPickMode();
      await nodeById("t1").dispatchEvent("click");
      await vi.waitFor(async () => expect(await edges.count()).toBe(3));
      await vi.waitFor(async () => expect(await dockTexts.count(), "文本附件进参考栏").toBe(1));
      expect(await dockTexts.first().getAttribute("title")).toBe("故事文案");


      await enterPickMode();
      await nodeById("v1").locator('[data-testid="media-content"]').click();
      await page.getByText("图片参考仅支持图片素材").waitFor();
      expect(await edges.count(), "非法来源不产生连线").toBe(3);



      const mediaEdge = page.locator(`.react-flow__edge[data-id="e-m2-${draftId}"]`);
      await mediaEdge.waitFor();
      const srcBox = (await page.locator('.react-flow__node[data-id="m2"] .react-flow__handle-right').boundingBox())!;
      const dstBox = (await page.locator(`.react-flow__node[data-id="${draftId}"] .react-flow__handle-left`).boundingBox())!;
      await page.mouse.move(srcBox.x + (dstBox.x - srcBox.x) * 0.25, srcBox.y + (dstBox.y - srcBox.y) * 0.25);
      const cut = mediaEdge.locator('g[class*="deleteBtn"]');
      await cut.waitFor({ state: "visible" });


      await cut.dispatchEvent("click");
      await vi.waitFor(async () => expect(await edges.count(), "画布断线").toBe(2));
      await vi.waitFor(async () => expect(await dockRefs.count(), "断线后 Dock 同步移除").toBe(1));
      await vi.waitFor(async () => expect(await dockTexts.count()).toBe(1));
      await nodeById("m2").locator("img").waitFor();


      await vi.waitFor(async () => {
        expect(await savedPairs(), "断线状态落盘").toEqual(
          expect.arrayContaining([`m1->${draftId}`, `t1->${draftId}`]),
        );
      }, { timeout: 10_000 });
      await page.reload();
      await nodeById(draftId).waitFor();
      await vi.waitFor(async () => expect(await edges.count(), "刷新恢复连线").toBe(2));
      await nodeById(draftId).locator('[data-testid="media-content"]').click();
      await editor.waitFor();
      await vi.waitFor(async () => expect(await dockRefs.count(), "刷新后 Dock 显示同一参考").toBe(1));
      await vi.waitFor(async () => expect(await dockTexts.count()).toBe(1));
      expect(await page.getByText("点击画布中的图片节点").count(), "选取模式不恢复").toBe(0);


      await editor.click();
      await page.keyboard.type("参考这张图重新绘制");
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


      await page.getByText("生成中，参数与连线只读").waitFor();
      expect(await page.locator('[data-lexical-editor]').getAttribute("contenteditable"), "生成中编辑器只读").toBe("false");
      expect(await page.locator('[data-testid="dock-media-ref"] button[title="移除"]').count()).toBe(0);
      const cutDuringRun = page.locator(`.react-flow__edge[data-id="e-m1-${draftId}"] g[class*="deleteBtn"]`);
      await cutDuringRun.waitFor({ state: "visible" });
      await cutDuringRun.dispatchEvent("click");
      await page.getByText("生成中，输入连线只读").waitFor();
      await vi.waitFor(async () => expect(await edges.count(), "生成中断线被拦截").toBe(2));

      await page.screenshot({ path: "/tmp/ikdmqr-browser.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 180_000);
});
