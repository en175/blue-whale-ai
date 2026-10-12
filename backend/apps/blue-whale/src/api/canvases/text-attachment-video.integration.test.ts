import "reflect-metadata";
import { Module } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
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

describe.skipIf(!process.env.IKDLQG_DATABASE_URL)("Text attachment video public API (IKDLQG)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "ikdlqg-video-model";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKDLQG_DATABASE_URL;
    const sizes = [{ id: "720p", label: "720P", api_value: "720p" }];
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikdlqg-test", model_id: MODEL_ID } },
      create: {
        provider_id: "ikdlqg-test",
        model_id: MODEL_ID,
        capability_type: "video",
        model_label: "IKDLQG Test Video",
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
      { provide: APP_FILTER, useClass: AllExceptionsFilter },
      { provide: MaterialService, useValue: new MaterialService(prisma, new SystemSettingsService(prisma)) },
      { provide: AssetService, useValue: new AssetService(prisma, new AssetStorageService()) },
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
  function videoJobBody(targetNodeId: string | undefined, prompt: string) {
    return {
      type: "video",
      ...(targetNodeId !== undefined ? { target_node_id: targetNodeId } : {}),
      expected_output_count: 1,
      parameters: { prompt, model_id: MODEL_ID, aspect_ratio: "16:9", resolution: "720p", duration: 5 },
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

  it("携带 target_node_id 创建视频任务：冻结的 text_attachments 与当时画布一致（edges 顺序），视频参数保持", async () => {
    const projectId = (await projects.create("987654", "IKDLQG snapshot")).id;
    const nodes = [
      mediaNode("media-1", "video"),
      { id: "text-b", type: "textNode", position: { x: 0, y: 0 }, data: { text: "雨夜" } },
      textNode("text-a", "赛博朋克", "风格"),
      mediaNode("media-2", "video"),
    ];
    const edges = [
      { id: "e1", source: "text-b", target: "media-1" },
      { id: "e2", source: "text-a", target: "media-1" },
      { id: "e3", source: "text-a", target: "media-2" },
    ];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const created = await createJob(projectId, videoJobBody("media-1", "人物走过街角"));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job).not.toBeNull();
    expect(job!.input.target_node_id).toBe("media-1");
    expect(job!.input.prompt).toBe("人物走过街角");
    expect(job!.input.text_attachments).toEqual([
      { node_id: "text-b", title: "", text: "雨夜" },
      { node_id: "text-a", title: "风格", text: "赛博朋克" },
    ]);
    expect(job!.input.resolution).toBe("720p");
    expect(job!.input.duration).toBe(5);
  });

  it("目标缺失 / 图片 mediaNode / 音频类型携带 / 他人项目 → 明确失败不建任务", async () => {
    const projectId = (await projects.create("987654", "IKDLQG bad target")).id;
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikdlqg-test", model_id: "any-audio-model" } },
      create: {
        provider_id: "ikdlqg-test",
        model_id: "any-audio-model",
        capability_type: "audio",
        model_label: "IKDLQG Test Audio",
        supported_sizes: [],
        supported_aspect_ratios: [],
        supported_formats: ["mp3"],
        default_size: "",
        default_aspect_ratio: "",
        features: {},
        channel: "seedream-audio",
      },
      update: {},
    });
    const nodes = [mediaNode("media-1", "video"), mediaNode("media-i", "image"), textNode("text-1", "正文")];
    const edges = [{ id: "e1", source: "text-1", target: "media-1" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const missing = await createJob(projectId, videoJobBody("ghost", "暮色"));
    expect(missing.code).toBe(1002);
    expect(missing.msg).toBe("目标节点不存在或不是视频媒体节点");

    const imageTarget = await createJob(projectId, videoJobBody("media-i", "暮色"));
    expect(imageTarget.code).toBe(1002);
    expect(imageTarget.msg).toBe("目标节点不存在或不是视频媒体节点");

    const audioType = await createJob(projectId, {
      type: "audio",
      target_node_id: "media-1",
      expected_output_count: 1,
      parameters: { prompt: "哼一段旋律", model_id: "any-audio-model" },
    });
    expect(audioType.code).toBe(1002);
    expect(audioType.msg).toBe("目标节点不存在或不是音频媒体节点");

    expect(await jobCount(projectId)).toBe(0);

    const otherProject = (await projects.create("987655", "IKDLQG ownership")).id;
    const denied = await createJob(otherProject, videoJobBody("media-1", "暮色"));
    expect(denied.code).toBe(100301);
    expect(await jobCount(otherProject)).toBe(0);
  });

  it("正文为空 → 400 prompt 无效，不创建任务", async () => {
    const projectId = (await projects.create("987654", "IKDLQG empty prompt rejected")).id;
    const nodes = [mediaNode("media-1", "video"), textNode("text-1", "独立正文", "附件")];
    const edges = [{ id: "e1", source: "text-1", target: "media-1" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const created = await createJob(projectId, videoJobBody("media-1", ""));
    expect(created.code).toBe(1002);
    expect(created.msg).toBe("prompt 无效");
    expect(await jobCount(projectId)).toBe(0);
  });

  it("长附件不额外计数：正文短、附件 31000 字 → 创建成功", async () => {
    const projectId = (await projects.create("987654", "IKDLQG attachments not counted")).id;
    const nodes = [mediaNode("media-1", "video"), textNode("text-1", "文".repeat(31_000))];
    const edges = [{ id: "e1", source: "text-1", target: "media-1" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const created = await createJob(projectId, videoJobBody("media-1", "暮色"));
    expect(created.code).toBe(200);
    expect(await jobCount(projectId)).toBe(1);
  });

  it("删除来源节点与边后新任务不再消费该附件，历史任务快照不改写", async () => {
    const projectId = (await projects.create("987654", "IKDLQG detach source")).id;
    const nodes = [mediaNode("media-1", "video"), textNode("text-1", "赛博朋克", "风格")];
    const edges = [{ id: "e1", source: "text-1", target: "media-1" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const first = await createJob(projectId, videoJobBody("media-1", "暮色"));
    expect(first.code).toBe(200);

    const canvas = await getCanvas(projectId);
    const detached = await saveCanvas(projectId, [mediaNode("media-1", "video")], [], canvas.version);
    expect(detached.status).toBe(200);

    const second = await createJob(projectId, videoJobBody("media-1", "暮色"));
    expect(second.code).toBe(200);
    const secondJob = await readJob(second.data.generation_job_id);
    expect(secondJob!.input.text_attachments).toEqual([]);
    expect(secondJob!.input.prompt).toBe("暮色");

    const firstJob = await readJob(first.data.generation_job_id);
    expect(firstJob!.input.text_attachments).toEqual([{ node_id: "text-1", title: "风格", text: "赛博朋克" }]);
  });

  it("重试复制原 input 快照（含 text_attachments 与视频参数），不回读来源节点", async () => {
    const projectId = (await projects.create("987654", "IKDLQG retry snapshot")).id;
    const nodes = [mediaNode("media-1", "video"), textNode("text-1", "原始正文", "风格")];
    const edges = [{ id: "e1", source: "text-1", target: "media-1" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);
    const first = await createJob(projectId, videoJobBody("media-1", "暮色"));
    expect(first.code).toBe(200);
    const originalJobId = first.data.generation_job_id as string;

    const canvas = await getCanvas(projectId);
    const edited = await saveCanvas(projectId, [mediaNode("media-1", "video"), textNode("text-1", "改写后正文", "风格")], [], canvas.version);
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
      headers: { "content-type": "application/json", "idempotency-key": "ikdlqg-retry-1" },
      body: JSON.stringify({}),
    })).json();
    expect(retried.code).toBe(200);

    const original = await readJob(originalJobId);
    const retry = await readJob(retried.data.generation_job_id);
    expect(retry!.input).toEqual(original!.input);
    expect(retry!.input.text_attachments).toEqual([{ node_id: "text-1", title: "风格", text: "原始正文" }]);
    expect(retry!.input.duration).toBe(5);
    expect(retry!.input.resolution).toBe("720p");
  });

  it.runIf(process.env.IKDLQG_BROWSER)("browser: connect → panel attachment → generate → reload restores", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKDLQG browser")).id;
    const asset = await prisma.client.assets.create({
      data: {
        user_id: BigInt(987654),
        project_id: BigInt(projectId),
        type: "video",
        url: "https://example.com/ikdlqg-target.mp4",
        width: 1280,
        height: 720,
        size: BigInt(2048),
      },
    });
    const assetId = asset.id.toString();
    const seeded = await saveCanvas(projectId, [
      { id: "text-1", type: "textNode", position: { x: 140, y: 160 }, data: { title: "雨夜", text: "赛博朋克" } },
      { id: "media-1", type: "mediaNode", position: { x: 900, y: 120 }, data: { mediaType: "video", fileName: "目标视频", assetId, width: 1280, height: 720, jobId: "ikdlqg-seed-job", draftModelId: MODEL_ID, draftSize: "720p", draftRatio: "16:9", draftDuration: 5 } },
    ], [
      { id: "e-t1-m1", source: "text-1", target: "media-1" },
    ], "missing", JSON.stringify({ x: 0, y: 0, zoom: 1 }));
    expect(seeded.status).toBe(200);

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
      const text = page.locator('.react-flow__node-textNode[data-id="text-1"]');
      const media = page.locator('.react-flow__node-mediaNode[data-id="media-1"]');
      await text.waitFor();
      await media.waitFor();

      await vi.waitFor(async () => {
        expect(await page.locator(".react-flow__edge").count(), "连线应渲染（showEdges 默认可见）").toBe(1);
      });
      const connected = await getCanvas(projectId);
      expect(JSON.parse(connected.edges)).toEqual([
        expect.objectContaining({ source: "text-1", target: "media-1" }),
      ]);
      expect(generationRequests).toEqual([]);

      await media.locator('[data-testid="media-content"]').click();
      await media.getByRole("button", { name: "生成视频" }).click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(1));
      await page.locator('[data-testid="dock-text-ref"]').first().hover();
      const overlay = page.locator('[data-testid="ref-thumb-preview"]');
      await overlay.waitFor();
      expect(await overlay.innerText()).toContain("赛博朋克");

      await page.locator('button[title="发送"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      expect(generationRequests[0].body.type).toBe("video");
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
      expect(firstInput.duration).toBe(5);
      expect(firstInput.resolution).toBe("720p");

      const editor = text.locator('[data-placeholder="输入内容..."]');
      await editor.dblclick();
      const editSaved = page.waitForResponse((response) =>
        response.request().method() === "PUT" && response.url().includes("/api/canvases/"));
      await editor.fill("霓虹都市");
      await page.locator(".react-flow__pane").click({ position: { x: 60, y: 250 } });
      expect((await editSaved).status()).toBe(200);
      expect(generationRequests, "编辑正文不自动执行").toHaveLength(1);

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
      await page.screenshot({ path: "/tmp/ikdlqg-browser.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 90_000);
});
