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

vi.mock("@lib/shared/generation/generation-queue.js", () => ({
  enqueueVideoGenerationJob: vi.fn(async () => {}),
  enqueueImageGenerationJob: vi.fn(async () => {}),
  enqueueAudioGenerationJob: vi.fn(async () => {}),
  enqueueMediaExtractJob: vi.fn(async () => {}),
  loadRocketMqConfig: vi.fn(() => ({ endpoints: "", sslEnabled: false })),
  createRocketMqGenerationProducer: vi.fn(() => ({ enqueue: vi.fn(async () => {}) })),
  closeGenerationQueue: vi.fn(async () => {}),
}));



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








describe.skipIf(!process.env.IKFCXE_DATABASE_URL)("Text attachment audio public API (IKFCXE)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "ikfcxe-audio-model";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKFCXE_DATABASE_URL;
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikfcxe-test", model_id: MODEL_ID } },
      create: {
        provider_id: "ikfcxe-test",
        model_id: MODEL_ID,
        capability_type: "audio",
        model_label: "IKFCXE Test Audio",
        supported_sizes: [],
        supported_aspect_ratios: [],
        supported_formats: ["mp3"],
        default_size: "",
        default_aspect_ratio: "",
        features: {},

        channel: "seedream-audio",
      },
      update: { features: {} },
    });
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, CanvasService, MaterialService, AssetService, AssetStorageService, IdentityService], GenerationJobsController);
    Reflect.defineMetadata("design:paramtypes", [ModelCapabilityReadService], GenerationModelsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
    class HarnessModule {}
    Module({ controllers: [CanvasesController, GenerationJobsController, GenerationModelsController, ProjectsController], providers: [


      { provide: APP_FILTER, useClass: AllExceptionsFilter },
      { provide: MaterialService, useValue: new MaterialService(prisma, new SystemSettingsService(prisma)) },
      { provide: AssetService, useValue: new AssetService(prisma, new AssetStorageService()) },
      { provide: AssetStorageService, useValue: new AssetStorageService() },
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
  function mediaNode(id: string, mediaType: "image" | "video" | "audio") {
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
  function audioJobBody(targetNodeId: string | undefined, prompt: string, modelId = MODEL_ID) {
    return {
      type: "audio",
      ...(targetNodeId !== undefined ? { target_node_id: targetNodeId } : {}),
      expected_output_count: 1,
      parameters: { prompt, model_id: modelId },
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

  it("携带 target_node_id 创建音频任务：冻结的 text_attachments 与当时画布一致（edges 顺序），音频参数保持", async () => {
    const projectId = (await projects.create("987654", "IKFCXE snapshot")).id;
    const nodes = [
      mediaNode("media-1", "audio"),
      { id: "text-b", type: "textNode", position: { x: 0, y: 0 }, data: { text: "雨夜街道，两个人争吵" } },
      textNode("text-a", "赛博朋克城市", "风格"),
      mediaNode("media-2", "audio"),
    ];
    const edges = [
      { id: "e1", source: "text-b", target: "media-1" },
      { id: "e2", source: "text-a", target: "media-1" },
      { id: "e3", source: "text-a", target: "media-2" },
    ];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const created = await createJob(projectId, audioJobBody("media-1", "生成环境音"));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job).not.toBeNull();
    expect(job!.input.target_node_id).toBe("media-1");
    expect(job!.input.prompt).toBe("生成环境音");

    expect(job!.input.text_attachments).toEqual([
      { node_id: "text-b", title: "", text: "雨夜街道，两个人争吵" },
      { node_id: "text-a", title: "风格", text: "赛博朋克城市" },
    ]);
    expect(job!.input.model_id).toBe(MODEL_ID);

    expect(job!.input.aspect_ratio).toBeUndefined();
  });

  it("目标缺失 / 视频与图片 mediaNode → 明确失败不建任务", async () => {
    const projectId = (await projects.create("987654", "IKFCXE bad target")).id;
    const nodes = [mediaNode("media-v", "video"), mediaNode("media-i", "image"), textNode("text-1", "正文")];
    const edges = [{ id: "e1", source: "text-1", target: "media-v" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const missing = await createJob(projectId, audioJobBody("ghost", "哼一段旋律"));
    expect(missing.code).toBe(1002);
    expect(missing.msg).toBe("目标节点不存在或不是音频媒体节点");

    const videoTarget = await createJob(projectId, audioJobBody("media-v", "哼一段旋律"));
    expect(videoTarget.code).toBe(1002);
    expect(videoTarget.msg).toBe("目标节点不存在或不是音频媒体节点");

    expect(await jobCount(projectId)).toBe(0);
  });

  it("主提示词为空（即便附件正文非空）→ 保持既有音频校验明确拒绝，不引入仅附件生成", async () => {
    const projectId = (await projects.create("987654", "IKFCXE empty prompt")).id;
    const nodes = [mediaNode("media-1", "audio"), textNode("text-1", "独立正文", "附件")];
    const edges = [{ id: "e1", source: "text-1", target: "media-1" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const created = await createJob(projectId, audioJobBody("media-1", ""));
    expect(created.code).toBe(1002);
    expect(created.msg).toBe("prompt 无效");
    expect(await jobCount(projectId)).toBe(0);
  });

  it("无 target_node_id 的旧式音频任务（无附件）→ 原规则创建成功，input 无 text_attachments 字段", async () => {
    const projectId = (await projects.create("987654", "IKFCXE legacy no target")).id;
    const created = await createJob(projectId, audioJobBody(undefined, "纯音乐，节奏轻快"));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.text_attachments).toBeUndefined();
    expect(job!.input.target_node_id).toBeUndefined();
    expect(job!.input.prompt).toBe("纯音乐，节奏轻快");
  });


  it("长附件不额外计数：正文短、附件 31000 字 → 创建成功", async () => {
    const projectId = (await projects.create("987654", "IKFCXE attachments not counted")).id;
    const nodes = [mediaNode("media-1", "audio"), textNode("text-1", "文".repeat(31_000))];
    const edges = [{ id: "e1", source: "text-1", target: "media-1" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const created = await createJob(projectId, audioJobBody("media-1", "读一下"));
    expect(created.code).toBe(200);
    expect(await jobCount(projectId)).toBe(1);
  });

  it("移除来源连线（仅断当前目标）后新任务不再消费该附件；其他目标关系保留；历史任务快照不改写", async () => {
    const projectId = (await projects.create("987654", "IKFCXE detach source")).id;
    const nodes = [
      mediaNode("media-1", "audio"),
      mediaNode("media-2", "audio"),
      textNode("text-1", "雨夜街道", "风格"),
    ];
    const edges = [
      { id: "e1", source: "text-1", target: "media-1" },
      { id: "e2", source: "text-1", target: "media-2" },
    ];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const first = await createJob(projectId, audioJobBody("media-1", "环境音"));
    expect(first.code).toBe(200);


    const canvas = await getCanvas(projectId);
    const detached = await saveCanvas(projectId, nodes, [{ id: "e2", source: "text-1", target: "media-2" }], canvas.version);
    expect(detached.status).toBe(200);

    const second = await createJob(projectId, audioJobBody("media-1", "环境音"));
    expect(second.code).toBe(200);
    const secondJob = await readJob(second.data.generation_job_id);
    expect(secondJob!.input.text_attachments).toEqual([]);


    const otherTarget = await createJob(projectId, audioJobBody("media-2", "配音"));
    expect(otherTarget.code).toBe(200);
    const otherJob = await readJob(otherTarget.data.generation_job_id);
    expect(otherJob!.input.text_attachments).toEqual([{ node_id: "text-1", title: "风格", text: "雨夜街道" }]);


    const firstJob = await readJob(first.data.generation_job_id);
    expect(firstJob!.input.text_attachments).toEqual([{ node_id: "text-1", title: "风格", text: "雨夜街道" }]);
  });

  it("提交后修改来源正文并断线：重试复制原 input 快照（含 text_attachments），不回读当前文本卡", async () => {
    const projectId = (await projects.create("987654", "IKFCXE retry snapshot")).id;
    const nodes = [mediaNode("media-1", "audio"), textNode("text-1", "原始正文", "风格")];
    const edges = [{ id: "e1", source: "text-1", target: "media-1" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);
    const first = await createJob(projectId, audioJobBody("media-1", "环境音"));
    expect(first.code).toBe(200);
    const originalJobId = first.data.generation_job_id as string;


    const canvas = await getCanvas(projectId);
    const edited = await saveCanvas(projectId, [mediaNode("media-1", "audio"), textNode("text-1", "改写后正文", "风格")], [], canvas.version);
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
      headers: { "content-type": "application/json", "idempotency-key": "ikfcxe-retry-1" },
      body: JSON.stringify({}),
    })).json();
    expect(retried.code).toBe(200);

    const original = await readJob(originalJobId);
    const retry = await readJob(retried.data.generation_job_id);
    expect(retry!.input).toEqual(original!.input);
    expect(retry!.input.text_attachments).toEqual([{ node_id: "text-1", title: "风格", text: "原始正文" }]);
  });

  it("同名文本卡各自独立不串用：按 node_id 身份冻结各自正文", async () => {
    const projectId = (await projects.create("987654", "IKFCXE same title")).id;
    const nodes = [
      mediaNode("media-1", "audio"),
      textNode("text-a", "雨夜的争吵", "场景"),
      textNode("text-b", "清晨的鸟鸣", "场景"),
    ];
    const edges = [
      { id: "e1", source: "text-a", target: "media-1" },
      { id: "e2", source: "text-b", target: "media-1" },
    ];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const created = await createJob(projectId, audioJobBody("media-1", "生成环境音"));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);

    expect(job!.input.text_attachments).toEqual([
      { node_id: "text-a", title: "场景", text: "雨夜的争吵" },
      { node_id: "text-b", title: "场景", text: "清晨的鸟鸣" },
    ]);
  });

  it("来源更新后的新提交冻结新正文；历史任务快照不被改写", async () => {
    const projectId = (await projects.create("987654", "IKFCXE source update")).id;
    const nodes = [mediaNode("media-1", "audio"), textNode("text-1", "原始正文", "场景")];
    const edges = [{ id: "e1", source: "text-1", target: "media-1" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const first = await createJob(projectId, audioJobBody("media-1", "生成环境音"));
    expect(first.code).toBe(200);

    const canvas = await getCanvas(projectId);
    const updated = await saveCanvas(projectId, [
      mediaNode("media-1", "audio"),
      textNode("text-1", "改写后的正文", "场景"),
    ], edges, canvas.version);
    expect(updated.status).toBe(200);

    const second = await createJob(projectId, audioJobBody("media-1", "生成环境音"));
    expect(second.code).toBe(200);
    const secondJob = await readJob(second.data.generation_job_id);
    expect(secondJob!.input.text_attachments).toEqual([{ node_id: "text-1", title: "场景", text: "改写后的正文" }]);


    const firstJob = await readJob(first.data.generation_job_id);
    expect(firstJob!.input.text_attachments).toEqual([{ node_id: "text-1", title: "场景", text: "原始正文" }]);
  });




  it.runIf(process.env.IKFCXE_BROWSER)("browser: pick → dedupe → same-title preview → long-text scroll/hover-into → target switch → remove → send freezes → reload restores", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFCXE browser")).id;



    const longBody = Array.from({ length: 24 }, (_, i) => `第${i + 1}段落：雷声滚过屋顶，雨点砸在窗台上。`).join("\n");
    const LONG_TAIL_MARK = "末尾标记-QZ3";
    const seeded = await saveCanvas(projectId, [
      { id: "text-1", type: "textNode", position: { x: 140, y: 160 }, data: { title: "雨夜", text: "雨夜街道，两个人争吵" } },
      { id: "text-2", type: "textNode", position: { x: 140, y: 420 }, data: { title: "雨夜", text: `${longBody}\n远处有雷声\n${LONG_TAIL_MARK}` } },
      { id: "media-1", type: "mediaNode", position: { x: 900, y: 120 }, data: { mediaType: "audio", fileName: "目标音频", jobId: "ikfcxe-seed-job", draftModelId: MODEL_ID } },
      { id: "media-2", type: "mediaNode", position: { x: 900, y: 460 }, data: { mediaType: "audio", fileName: "目标音频二", jobId: "ikfcxe-seed-job-2", draftModelId: MODEL_ID } },
    ], [
      { id: "e-t1-m1", source: "text-1", target: "media-1" },
      { id: "e-t1-m2", source: "text-1", target: "media-2" },
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
      const text2 = page.locator('.react-flow__node-textNode[data-id="text-2"]');
      const media = page.locator('.react-flow__node-mediaNode[data-id="media-1"]');
      const media2 = page.locator('.react-flow__node-mediaNode[data-id="media-2"]');
      await text2.waitFor();
      await media.waitFor();
      await media2.waitFor();
      await vi.waitFor(async () => {
        expect(await page.locator(".react-flow__edge").count(), "播种连线应渲染").toBe(2);
      });
      expect(generationRequests).toEqual([]);


      await media.locator('[data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(1));
      await page.locator('[data-testid="dock-text-ref"]').first().hover();
      const overlay = page.locator('[data-testid="ref-thumb-preview"]');
      await overlay.waitFor();
      expect(await overlay.innerText()).toContain("雨夜街道，两个人争吵");


      async function pickFromCanvas() {
        const add = page.locator('button[title="从资产中选择 / 从节点添加素材"]');
        await add.click({ timeout: 5000 });
        await page.getByRole("button", { name: "从节点添加素材", exact: true }).click({ timeout: 5000 });
      }
      await pickFromCanvas();

      await vi.waitFor(async () => {
        expect(await page.locator("text=到节点选择").count()).toBeGreaterThan(0);
      }, { timeout: 5000 });
      await text2.click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(2));


      await media2.locator('[data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(1));
      await media.locator('[data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(2));


      await page.locator('[data-testid="dock-text-ref"]').nth(1).hover();
      await vi.waitFor(async () => expect(await overlay.innerText()).toContain("远处有雷声"));
      expect(await overlay.innerText(), "浮层无标题（来源名称不进浮层）").not.toContain("雨夜");


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
      const tailVisible = await overlay.evaluate((el) => {
        const inner = el.firstElementChild as HTMLElement;
        return Math.abs(inner.scrollHeight - inner.scrollTop - inner.clientHeight) < 8;
      });
      expect(tailVisible, "长文本可滚动至末尾").toBe(true);


      const overlayBox = (await overlay.boundingBox())!;
      await page.mouse.move(overlayBox.x + overlayBox.width / 2, overlayBox.y + overlayBox.height / 2);
      await page.waitForTimeout(400);
      expect(await overlay.count(), "鼠标移入浮层保持打开").toBe(1);
      await page.mouse.move(120, 60);
      await page.waitForTimeout(400);
      expect(await overlay.count(), "移出图标与浮层后关闭").toBe(0);


      await pickFromCanvas();
      await text2.click();
      await page.waitForTimeout(300);
      expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(2);


      await page.locator('[data-testid="dock-text-ref"]').nth(1).hover();
      await page.locator('[data-testid="dock-text-ref"]').nth(1).locator('button[title="移除"]').click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(1));
      await vi.waitFor(async () => {
        expect(await page.locator(".react-flow__edge").count(), "断线后画布连线归 2（text-1 仍连两目标）").toBe(2);
      });



      await page.locator('[data-testid="audio-input"] [contenteditable]').fill('生成环境音，参考');
      await page.getByRole('button', { name: '插入引用 雨夜', exact: true }).click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="asset-ref-valid"]').innerText()).toBe('文本1'));
      await page.locator('[data-testid="audio-send"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      expect(generationRequests[0].body.type).toBe("audio");
      expect(generationRequests[0].body.target_node_id).toBe("media-1");
      expect((generationRequests[0].body.parameters as Record<string, unknown>).prompt).toBe("生成环境音，参考文本1");


      await vi.waitFor(async () => expect(await jobCount(projectId)).toBe(1), { timeout: 10_000 });
      const rows = await prisma.client.generation_jobs.findMany({
        where: { project_id: BigInt(projectId) }, orderBy: { id: "asc" },
      });
      const input = rows[0].input as Record<string, unknown>;
      expect(input.target_node_id).toBe("media-1");
      expect(input.prompt).toBe("生成环境音，参考文本1");


      expect(input).not.toHaveProperty("composed_prompt");
      expect(input).not.toHaveProperty("prompt_doc");
      expect(input.text_attachments).toEqual([
        { node_id: "text-1", title: "雨夜", text: "雨夜街道，两个人争吵" },
      ]);


      await page.reload();
      await text2.waitFor();
      await media.waitFor();
      await vi.waitFor(async () => {
        expect(await page.locator(".react-flow__edge").count(), "刷新后连线恢复渲染").toBe(2);
      });
      await media.locator('[data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(1));
      await vi.waitFor(async () => expect(await page.locator('[data-testid="asset-ref-valid"]').innerText()).toBe("文本1"));
      await page.screenshot({ path: "/tmp/ikfcxe-browser.png", fullPage: true });
    } finally {
      await browser.close();
      await vite.close();
    }
  }, 120_000);
});
