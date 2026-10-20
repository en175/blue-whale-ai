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

describe.skipIf(!process.env.IKDLQH_DATABASE_URL)("Text attachment ordering public API (IKDLQH)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const IMAGE_MODEL_ID = "ikdlqh-image-model";
  const VIDEO_MODEL_ID = "ikdlqh-video-model";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKDLQH_DATABASE_URL;
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikdlqh-test", model_id: IMAGE_MODEL_ID } },
      create: {
        provider_id: "ikdlqh-test",
        model_id: IMAGE_MODEL_ID,
        capability_type: "image",
        model_label: "IKDLQH Test Image",
        supported_sizes: [{ id: "1024x1024", label: "1024x1024" }],
        supported_aspect_ratios: ["1:1"],
        supported_formats: ["png"],
        default_size: "1024x1024",
        default_aspect_ratio: "1:1",
        features: {},
        channel: "seedream-image",
      },
      update: { supported_sizes: [{ id: "1024x1024", label: "1024x1024" }], default_size: "1024x1024" },
    });
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikdlqh-test", model_id: VIDEO_MODEL_ID } },
      create: {
        provider_id: "ikdlqh-test",
        model_id: VIDEO_MODEL_ID,
        capability_type: "video",
        model_label: "IKDLQH Test Video",
        supported_sizes: [{ id: "720p", label: "720P", api_value: "720p" }],
        supported_aspect_ratios: ["16:9"],
        supported_formats: ["mp4"],
        supported_durations: { min: 5, max: 10, step: 1 },
        default_size: "720p",
        default_aspect_ratio: "16:9",
        default_duration: 5,
        features: {},
        channel: "seedream-video",
      },
      update: { supported_sizes: [{ id: "720p", label: "720P", api_value: "720p" }], default_size: "720p" },
    });
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, CanvasService, MaterialService, AssetService, AssetStorageService, IdentityService], GenerationJobsController);
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
      { provide: AssetStorageService, useValue: new AssetStorageService() },
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
  function imageJobBody(targetNodeId: string, prompt: string) {
    return {
      type: "image",
      target_node_id: targetNodeId,
      expected_output_count: 1,
      parameters: { prompt, model_id: IMAGE_MODEL_ID, aspect_ratio: "1:1" },
    };
  }
  function videoJobBody(targetNodeId: string, prompt: string) {
    return {
      type: "video",
      target_node_id: targetNodeId,
      expected_output_count: 1,
      parameters: { prompt, model_id: VIDEO_MODEL_ID, aspect_ratio: "16:9", resolution: "720p", duration: 5 },
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
  const attachmentIds = (input: Record<string, unknown>) =>
    (input.text_attachments as Array<{ node_id: string }>).map((a) => a.node_id);

  it("图片目标：多附件按 edges 顺序冻结；同名同正文不同源各自保留；重排后新任务用新顺序、历史任务快照不改写", async () => {
    const projectId = (await projects.create("987654", "IKDLQH image ordering")).id;
    const nodes = [
      mediaNode("media-1", "image"),
      textNode("text-a", "相同正文", "设定"),
      textNode("text-b", "相同正文", "设定"),
      textNode("text-c", "镜头要求", "镜头"),
    ];
    const edges = [
      { id: "e1", source: "text-a", target: "media-1" },
      { id: "e2", source: "text-b", target: "media-1" },
      { id: "e3", source: "text-c", target: "media-1" },
    ];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const first = await createJob(projectId, imageJobBody("media-1", "暮色"));
    expect(first.code).toBe(200);
    const firstJob = await readJob(first.data.generation_job_id);
    expect(attachmentIds(firstJob!.input)).toEqual(["text-a", "text-b", "text-c"]);
    expect(firstJob!.input.text_attachments).toEqual([
      { node_id: "text-a", title: "设定", text: "相同正文" },
      { node_id: "text-b", title: "设定", text: "相同正文" },
      { node_id: "text-c", title: "镜头", text: "镜头要求" },
    ]);

    const canvas = await getCanvas(projectId);
    const reordered = [
      { id: "e3", source: "text-c", target: "media-1" },
      { id: "e1", source: "text-a", target: "media-1" },
      { id: "e2", source: "text-b", target: "media-1" },
    ];
    expect((await saveCanvas(projectId, nodes, reordered, canvas.version)).status).toBe(200);
    expect(JSON.parse((await getCanvas(projectId)).edges)).toEqual(reordered);

    const second = await createJob(projectId, imageJobBody("media-1", "暮色"));
    expect(second.code).toBe(200);
    const secondJob = await readJob(second.data.generation_job_id);
    expect(attachmentIds(secondJob!.input)).toEqual(["text-c", "text-a", "text-b"]);
    expect(attachmentIds((await readJob(first.data.generation_job_id))!.input)).toEqual(["text-a", "text-b", "text-c"]);
  });

  it("同一来源连至多个目标：重排一个目标的入边不影响另一目标的冻结顺序", async () => {
    const projectId = (await projects.create("987654", "IKDLQH multi target")).id;
    const nodes = [
      mediaNode("media-1", "image"),
      mediaNode("media-2", "image"),
      textNode("text-a", "角色设定", "角色"),
      textNode("text-c", "场景设定", "场景"),
    ];
    const edges = [
      { id: "e1", source: "text-a", target: "media-1" },
      { id: "e2", source: "text-c", target: "media-1" },
      { id: "e3", source: "text-a", target: "media-2" },
      { id: "e4", source: "text-c", target: "media-2" },
    ];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const canvas = await getCanvas(projectId);
    const reordered = [
      { id: "e2", source: "text-c", target: "media-1" },
      { id: "e1", source: "text-a", target: "media-1" },
      { id: "e3", source: "text-a", target: "media-2" },
      { id: "e4", source: "text-c", target: "media-2" },
    ];
    expect((await saveCanvas(projectId, nodes, reordered, canvas.version)).status).toBe(200);

    const onFirst = await createJob(projectId, imageJobBody("media-1", "暮色"));
    expect(onFirst.code).toBe(200);
    expect(attachmentIds((await readJob(onFirst.data.generation_job_id))!.input)).toEqual(["text-c", "text-a"]);

    const onSecond = await createJob(projectId, imageJobBody("media-2", "暮色"));
    expect(onSecond.code).toBe(200);
    expect(attachmentIds((await readJob(onSecond.data.generation_job_id))!.input)).toEqual(["text-a", "text-c"]);
  });

  it("视频目标：多附件按 edges 顺序冻结；重排后新任务用新顺序、历史任务快照不改写", async () => {
    const projectId = (await projects.create("987654", "IKDLQH video ordering")).id;
    const nodes = [
      mediaNode("media-v", "video"),
      textNode("text-a", "赛博朋克", "风格"),
      textNode("text-b", "雨夜", "场景"),
    ];
    const edges = [
      { id: "e1", source: "text-a", target: "media-v" },
      { id: "e2", source: "text-b", target: "media-v" },
    ];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const first = await createJob(projectId, videoJobBody("media-v", "人物走过街角"));
    expect(first.code).toBe(200);
    expect(attachmentIds((await readJob(first.data.generation_job_id))!.input)).toEqual(["text-a", "text-b"]);

    const canvas = await getCanvas(projectId);
    const reordered = [
      { id: "e2", source: "text-b", target: "media-v" },
      { id: "e1", source: "text-a", target: "media-v" },
    ];
    expect((await saveCanvas(projectId, nodes, reordered, canvas.version)).status).toBe(200);

    const second = await createJob(projectId, videoJobBody("media-v", "人物走过街角"));
    expect(second.code).toBe(200);
    const secondJob = await readJob(second.data.generation_job_id);
    expect(attachmentIds(secondJob!.input)).toEqual(["text-b", "text-a"]);
    expect(secondJob!.input.text_attachments).toEqual([
      { node_id: "text-b", title: "场景", text: "雨夜" },
      { node_id: "text-a", title: "风格", text: "赛博朋克" },
    ]);
    expect(attachmentIds((await readJob(first.data.generation_job_id))!.input)).toEqual(["text-a", "text-b"]);
  });

  it("图片多附件不额外计数：正文短、附件合计 40000 字 → 创建成功，连线与附件不被删改", async () => {
    const projectId = (await projects.create("987654", "IKDLQH image attachments not counted")).id;
    const nodes = [
      mediaNode("media-1", "image"),
      textNode("text-a", "文".repeat(20_000)),
      textNode("text-b", "章".repeat(20_000)),
    ];
    const edges = [
      { id: "e1", source: "text-a", target: "media-1" },
      { id: "e2", source: "text-b", target: "media-1" },
    ];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const created = await createJob(projectId, imageJobBody("media-1", "暮色"));
    expect(created.code).toBe(200);
    expect(await jobCount(projectId)).toBe(1);
    expect(JSON.parse((await getCanvas(projectId)).edges)).toEqual(edges);
  });

  it("视频多附件不额外计数：正文短、附件合计 40000 字 → 创建成功，连线与附件不被删改", async () => {
    const projectId = (await projects.create("987654", "IKDLQH video attachments not counted")).id;
    const nodes = [
      mediaNode("media-v", "video"),
      textNode("text-a", "文".repeat(20_000)),
      textNode("text-b", "章".repeat(20_000)),
    ];
    const edges = [
      { id: "e1", source: "text-a", target: "media-v" },
      { id: "e2", source: "text-b", target: "media-v" },
    ];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const created = await createJob(projectId, videoJobBody("media-v", "暮色"));
    expect(created.code).toBe(200);
    expect(await jobCount(projectId)).toBe(1);
    expect(JSON.parse((await getCanvas(projectId)).edges)).toEqual(edges);
  });

  async function seedBrowserProject(name: string, mediaType: "image" | "video") {
    const projectId = (await projects.create("987654", name)).id;
    const asset = await prisma.client.assets.create({
      data: {
        user_id: BigInt(987654),
        project_id: BigInt(projectId),
        type: mediaType,
        url: `https://example.com/ikdlqh-target.${mediaType === "video" ? "mp4" : "png"}`,
        width: 1024,
        height: 1024,
        size: BigInt(2048),
      },
    });
    const seeded = await saveCanvas(projectId, [
      { id: "text-1", type: "textNode", position: { x: 140, y: 120 }, data: { title: "设定A", text: "第一正文" } },
      { id: "text-2", type: "textNode", position: { x: 140, y: 460 }, data: { title: "设定B", text: "第二正文" } },
      { id: "media-1", type: "mediaNode", position: { x: 900, y: 260 }, data: { mediaType, fileName: "目标", assetId: asset.id.toString(), width: 1024, height: 1024 } },
    ], [], "missing", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
    expect(seeded.status).toBe(200);
    return projectId;
  }

  async function dragConnect(page: import("playwright").Page, sourceId: string) {
    const source = page.locator(`.react-flow__node-textNode[data-id="${sourceId}"]`);
    const media = page.locator('.react-flow__node-mediaNode[data-id="media-1"]');
    await source.locator('[data-testid="text-title"]').click();
    const saved = page.waitForResponse((response) =>
      response.request().method() === "PUT" && response.url().includes("/api/canvases/"));
    const srcBox = (await source.locator(".react-flow__handle-right").boundingBox())!;
    const dstBox = (await media.locator(".react-flow__handle-left").boundingBox())!;
    await page.mouse.move(srcBox.x + srcBox.width / 2, srcBox.y + srcBox.height / 2);
    await page.mouse.down();
    const dstPoint = { x: dstBox.x + dstBox.width / 2, y: dstBox.y + dstBox.height / 2 };
    await page.mouse.move(dstPoint.x, dstPoint.y, { steps: 12 });
    const dstValid = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el ? el.className.includes("valid") && el.className.includes("connectingto") : false;
    }, dstPoint);
    expect(dstValid, "落点连接点应被 RF 标记为有效连接目标").toBe(true);
    await page.mouse.up();
    expect((await saved).status(), "连线增删参与自动保存").toBe(200);
  }

  async function runBrowserFlow(mediaType: "image" | "video", genButtonName: "生成图片" | "生成视频") {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = await seedBrowserProject(`IKDLQH browser ${mediaType}`, mediaType);

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
      const media = page.locator('.react-flow__node-mediaNode[data-id="media-1"]');
      await page.locator('.react-flow__node-textNode[data-id="text-1"]').waitFor();
      await page.locator('.react-flow__node-textNode[data-id="text-2"]').waitFor();
      await media.waitFor();

      await dragConnect(page, "text-1");
      await dragConnect(page, "text-2");
      await vi.waitFor(async () => {
        expect(await page.locator(".react-flow__edge").count(), "两条连线应渲染").toBe(2);
      });
      const connectedEdges = JSON.parse((await getCanvas(projectId)).edges) as Array<{ source: string; target: string }>;
      expect(connectedEdges.map((e) => `${e.source}->${e.target}`)).toEqual(["text-1->media-1", "text-2->media-1"]);
      expect(generationRequests).toEqual([]);

      await media.locator('[data-testid="media-content"]').click();
      await media.getByRole("button", { name: genButtonName }).click();
      await page.getByText("文本附件（2）").waitFor();
      const attachmentsRegion = page.locator('div:has-text("文本附件（2）")').last();
      const regionText = await attachmentsRegion.innerText();
      expect(regionText.indexOf("设定A"), "默认按连入顺序").toBeLessThan(regionText.indexOf("设定B"));

      const reorderSaved = page.waitForResponse((response) =>
        response.request().method() === "PUT" && response.url().includes("/api/canvases/"));
      await attachmentsRegion.getByRole("button", { name: "下移" }).first().click();
      const reorderedText = await attachmentsRegion.innerText();
      expect(reorderedText.indexOf("设定B"), "重排后设定B在前").toBeLessThan(reorderedText.indexOf("设定A"));
      expect((await reorderSaved).status(), "重排随自动保存持久化").toBe(200);
      const savedEdges = JSON.parse((await getCanvas(projectId)).edges) as Array<{ source: string; target: string }>;
      expect(savedEdges.map((e) => `${e.source}->${e.target}`)).toEqual(["text-2->media-1", "text-1->media-1"]);
      expect(generationRequests).toEqual([]);

      await page.locator('button[title="发送"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      expect(generationRequests[0].body.type).toBe(mediaType);
      expect(generationRequests[0].body.target_node_id).toBe("media-1");
      await vi.waitFor(async () => expect(await jobCount(projectId)).toBe(1), { timeout: 10_000 });
      const rows = await prisma.client.generation_jobs.findMany({
        where: { project_id: BigInt(projectId) }, orderBy: { id: "asc" },
      });
      expect(attachmentIds(rows[0].input as Record<string, unknown>)).toEqual(["text-2", "text-1"]);

      await page.reload();
      await media.waitFor();
      await vi.waitFor(async () => {
        expect(await page.locator(".react-flow__edge").count(), "刷新后连线恢复渲染").toBe(2);
      });
      await media.locator('[data-testid="media-content"]').click();
      await media.getByRole("button", { name: genButtonName }).click();
      await page.getByText("文本附件（2）").waitFor();
      const reloadedText = await page.locator('div:has-text("文本附件（2）")').last().innerText();
      expect(reloadedText.indexOf("设定B"), "刷新后保持重排顺序").toBeLessThan(reloadedText.indexOf("设定A"));
      await page.screenshot({ path: `/tmp/ikdlqh-browser-${mediaType}.png`, fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }

  it.runIf(process.env.IKDLQH_BROWSER)("browser image: 双文本连线 → 面板重排 → 生成冻结新顺序 → 刷新恢复", async () => {
    await runBrowserFlow("image", "生成图片");
  }, 120_000);

  it.runIf(process.env.IKDLQH_BROWSER)("browser video: 双文本连线 → 面板重排 → 生成冻结新顺序 → 刷新恢复", async () => {
    await runBrowserFlow("video", "生成视频");
  }, 120_000);
});
