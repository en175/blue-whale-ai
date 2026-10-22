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
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { ProjectAssetsController } from "../project-assets/project-assets.controller.js";
import { AssetsController } from "../assets/assets.controller.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { GenerationCommandService } from "@lib/shared/generation/generation-command.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { MaterialService } from "@lib/shared/material/material.service.js";
import { SystemSettingsService } from "@lib/shared/system-settings/index.js";
import { AccountDirectoryService } from "@lib/shared/identity/account-directory.service.js";
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

describe.skipIf(!process.env.IKDMQT_DATABASE_URL)("Audio draft public API (IKDMQT)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "ikdmqt-audio-model";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKDMQT_DATABASE_URL;
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikdmqt-test", model_id: MODEL_ID } },
      create: {
        provider_id: "ikdmqt-test",
        model_id: MODEL_ID,
        capability_type: "audio",
        model_label: "IKDMQT Test",
        supported_sizes: [],
        supported_aspect_ratios: [],
        supported_formats: ["mp3"],
        default_size: "mp3",
        default_aspect_ratio: "1:1",
        features: {},
        channel: "seedream-audio",
      },
      update: { features: {} },
    });
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, CanvasService, MaterialService, AssetService, AssetStorageService, AccountDirectoryService], GenerationJobsController);
    Reflect.defineMetadata("design:paramtypes", [ModelCapabilityReadService], GenerationModelsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
    Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
    Reflect.defineMetadata("design:paramtypes", [AssetService], AssetsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, AssetService, AssetStorageService], ProjectAssetsController);
    class HarnessModule {}
    Module({ controllers: [ProjectAssetsController, AssetsController, CanvasesController, GenerationJobsController, GenerationModelsController, ProjectsController, JobsController], providers: [
      { provide: APP_FILTER, useClass: AllExceptionsFilter },
      { provide: MaterialService, useValue: new MaterialService(prisma, new SystemSettingsService(prisma)) },
      { provide: AssetStorageService, useValue: new AssetStorageService() },
      { provide: AssetService, useValue: new AssetService(prisma, new AssetStorageService()) },
      { provide: CanvasService, useValue: canvasService },
      { provide: ProjectService, useValue: projects },
      { provide: PrismaService, useValue: prisma },
      { provide: SnapshotService, useValue: new SnapshotService(prisma) },
      { provide: JobsService, useValue: new JobsService(prisma, projects) },
      { provide: GenerationCommandService, useValue: new GenerationCommandService(prisma) },
      { provide: ModelCapabilityReadService, useValue: new ModelCapabilityReadService(prisma) },
      { provide: MaterialService, useValue: new MaterialService(prisma, new SystemSettingsService(prisma)) },
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

  function audioDraftNode(id: string, prompt = "") {
    return {
      id,
      type: "mediaNode",
      position: { x: 420, y: 160 },
      data: {
        src: "",
        mediaType: "audio",
        fileName: "音频草稿",
        genStatus: "draft",
        draft: true,
        prompt,
        draftModelId: MODEL_ID,
      },
    };
  }
  function videoNode(id: string) {
    return {
      id,
      type: "mediaNode",
      position: { x: 120, y: 90 },
      data: { src: "", mediaType: "video", fileName: "视频草稿", genStatus: "draft", draft: true, prompt: "" },
    };
  }
  function textNode(id: string, text: string, title = "文本", x = 560, y = 80) {
    return { id, type: "textNode", position: { x, y }, data: { title, text } };
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
  async function createAudioAsset(projectId: string, url: string) {
    const row = await prisma.client.assets.create({
      data: {
        user_id: BigInt(987654),
        project_id: BigInt(projectId),
        type: "audio",
        url,
        size: BigInt(2048),
      },
    });
    return row.id.toString();
  }
  const audioParameters = { prompt: "海浪与海鸥", model_id: MODEL_ID };

  it("音频草稿节点（genStatus=draft、无 assetId）随 PUT 保存并原样恢复", async () => {
    const projectId = (await projects.create("987654", "IKDMQT save restore")).id;
    const draft = audioDraftNode("a1", "轻快的海浪声");
    expect(
      (await saveCanvas(projectId, [textNode("t1", "无关正文"), draft], [], "missing")).status,
    ).toBe(200);

    const canvas = await getCanvas(projectId);
    const nodes = JSON.parse(canvas.nodes) as Array<{ id: string; data: Record<string, unknown> }>;
    const saved = nodes.find((n) => n.id === "a1")!;
    expect(saved.data.genStatus).toBe("draft");
    expect(saved.data.draft).toBe(true);
    expect(saved.data.mediaType).toBe("audio");
    expect(saved.data.prompt).toBe("轻快的海浪声");
    expect(saved.data.draftModelId).toBe(MODEL_ID);
    expect(saved.data.assetId).toBeUndefined();
  });

  it("对音频草稿 target_node_id 建任务：冻结 prompt/model_id/target_node_id，文本连线推导冻结（IKFCXE）", async () => {
    const projectId = (await projects.create("987654", "IKDMQT freeze")).id;
    expect(
      (await saveCanvas(
        projectId,
        [audioDraftNode("a2", "旧描述"), textNode("t1", "故事文案正文", "故事文案")],
        [{ id: "e1", source: "t1", target: "a2" }],
        "missing",
      )).status,
    ).toBe(200);

    const created = await createJob(projectId, {
      type: "audio",
      target_node_id: "a2",
      expected_output_count: 1,
      parameters: audioParameters,
    });
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.prompt).toBe("海浪与海鸥");
    expect(job!.input.model_id).toBe(MODEL_ID);
    expect(job!.input.target_node_id).toBe("a2");
    expect(job!.input.text_attachments).toEqual([
      { node_id: "t1", title: "故事文案", text: "故事文案正文" },
    ]);
  });

  it("目标类型不匹配与目标缺失：400 明确失败，不建任务", async () => {
    const projectId = (await projects.create("987654", "IKDMQT mismatch")).id;
    expect((await saveCanvas(projectId, [videoNode("v1")], [], "missing")).status).toBe(200);

    const wrongType = await createJob(projectId, {
      type: "audio",
      target_node_id: "v1",
      expected_output_count: 1,
      parameters: audioParameters,
    });
    expect(wrongType.code).toBe(1002);
    expect(wrongType.msg).toContain("目标节点不存在或不是音频媒体节点");

    const missing = await createJob(projectId, {
      type: "audio",
      target_node_id: "a-404",
      expected_output_count: 1,
      parameters: audioParameters,
    });
    expect(missing.code).toBe(1002);
    expect(missing.msg).toContain("目标节点不存在或不是音频媒体节点");
    expect(await prisma.client.generation_jobs.count({ where: { project_id: BigInt(projectId) } })).toBe(0);
  });

  it("空 prompt → 400（音频无附件兜底）；参考素材仍被拒绝（IKA72G 回归）", async () => {
    const projectId = (await projects.create("987654", "IKDMQT invalid")).id;
    expect((await saveCanvas(projectId, [audioDraftNode("a3")], [], "missing")).status).toBe(200);

    const blank = await createJob(projectId, {
      type: "audio",
      target_node_id: "a3",
      expected_output_count: 1,
      parameters: { prompt: "   ", model_id: MODEL_ID },
    });
    expect(blank.code).toBe(1002);
    expect(blank.msg).toBe("prompt 无效");

    const withRefs = await createJob(projectId, {
      type: "audio",
      target_node_id: "a3",
      expected_output_count: 1,
      parameters: audioParameters,
      input_asset_ids: ["1"],
    });
    expect(withRefs.code).toBe(1004);
    expect(withRefs.msg).toContain("音频生成暂不支持旧参考字段");
    expect(await prisma.client.generation_jobs.count({ where: { project_id: BigInt(projectId) } })).toBe(0);
  });

  it("IKFDFZ：references 随音频任务保序冻结（身份与顺序 = 页面提交）；超限/混用/视频参考 400 明确失败", async () => {
    const projectId = (await projects.create("987654", "IKFDFZ freeze")).id;
    const audioA = await createAudioAsset(projectId, "https://example.com/ikfdfz-a.mp3");
    const audioB = await createAudioAsset(projectId, "https://example.com/ikfdfz-b.mp3");
    const imageAsset = await createAudioAsset(projectId, "https://example.com/ikfdfz-img.png");
    expect((await saveCanvas(projectId, [audioDraftNode("a4", "参考驱动")], [], "missing")).status).toBe(200);

    const created = await createJob(projectId, {
      type: "audio",
      target_node_id: "a4",
      expected_output_count: 1,
      parameters: audioParameters,
      references: [
        { role: "reference", type: "audio", asset_id: audioB },
        { role: "reference", type: "audio", asset_id: audioA },
      ],
    });
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.references).toEqual([
      { role: "reference", type: "audio", asset_id: audioB },
      { role: "reference", type: "audio", asset_id: audioA },
    ]);

    const audioC = await createAudioAsset(projectId, "https://example.com/ikfdfz-c.mp3");
    const atCap = await createJob(projectId, {
      type: "audio",
      target_node_id: "a4",
      expected_output_count: 1,
      parameters: audioParameters,
      references: [
        { role: "reference", type: "audio", asset_id: audioC },
        { role: "reference", type: "audio", asset_id: audioA },
        { role: "reference", type: "audio", asset_id: audioB },
      ],
    });
    expect(atCap.code).toBe(200);
    const capJob = await readJob(atCap.data.generation_job_id);
    expect(capJob!.input.references).toEqual([
      { role: "reference", type: "audio", asset_id: audioC },
      { role: "reference", type: "audio", asset_id: audioA },
      { role: "reference", type: "audio", asset_id: audioB },
    ]);

    const before = await prisma.client.generation_jobs.count({ where: { project_id: BigInt(projectId) } });
    const overflow = await createJob(projectId, {
      type: "audio",
      target_node_id: "a4",
      expected_output_count: 1,
      parameters: audioParameters,
      references: [audioA, audioB, audioA, imageAsset].map((id) => ({ role: "reference", type: "audio", asset_id: id })),
    });
    expect(overflow.code).toBe(1034);
    expect(overflow.msg).toContain("参考音频最多 3 个");

    const mixed = await createJob(projectId, {
      type: "audio",
      target_node_id: "a4",
      expected_output_count: 1,
      parameters: audioParameters,
      references: [
        { role: "reference", type: "audio", asset_id: audioA },
        { role: "reference", type: "image", asset_id: imageAsset },
      ],
    });
    expect(mixed.code).toBe(1034);
    expect(mixed.msg).toContain("音频与图片参考不可混用");

    const videoRef = await createJob(projectId, {
      type: "audio",
      target_node_id: "a4",
      expected_output_count: 1,
      parameters: audioParameters,
      references: [{ role: "reference", type: "video", asset_id: audioA }],
    });
    expect(videoRef.code).toBe(1034);
    expect(videoRef.msg).toContain("参考素材引用无效");

    expect(await prisma.client.generation_jobs.count({ where: { project_id: BigInt(projectId) } })).toBe(before);
  });

  it.runIf(process.env.IKDMQT_BROWSER)("browser: audio draft create → restore → save-failure gate → in-place generation", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKDMQT browser A")).id;
    const otherProjectId = (await projects.create("987654", "IKDMQT browser B")).id;

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
      const mediaNodes = page.locator(".react-flow__node-mediaNode");
      const sidebarAudio = page.locator('button[aria-label="音频"]');
      await sidebarAudio.waitFor();
      const input = page.locator('[data-testid="audio-input"]');
      const editor = page.locator('[contenteditable="true"]');
      const send = page.locator('[data-testid="audio-send"]');

      await sidebarAudio.click();
      await vi.waitFor(async () => expect(await mediaNodes.count()).toBe(1));
      await input.waitFor();
      expect(await mediaNodes.first().innerText()).toContain("待生成");
      expect(await mediaNodes.first().innerText()).not.toContain("素材已被删除");
      expect(await page.locator(".react-flow__node-mediaNode.selected").count(), "新卡自动选中").toBe(1);
      expect(generationRequests, "建卡不创建生成任务").toEqual([]);

      await sidebarAudio.click();
      await vi.waitFor(async () => expect(await mediaNodes.count()).toBe(2));
      expect(generationRequests).toEqual([]);
      const draftId = (await mediaNodes.nth(1).getAttribute("data-id"))!;
      expect(draftId).not.toBe(await mediaNodes.first().getAttribute("data-id"));

      await page.getByText("IKDMQT Test").waitFor();
      await editor.fill("轻快的海浪声");
      await vi.waitFor(async () => {
        const canvas = await getCanvas(projectId);
        const nodes = JSON.parse(canvas.nodes) as Array<{ id: string; data: Record<string, unknown> }>;
        const draft = nodes.find((n) => n.id === draftId);
        expect(draft?.data.prompt, "描述随自动保存落盘").toBe("轻快的海浪声");
        expect(draft?.data.draftModelId, "模型参数随自动保存落盘").toBe(MODEL_ID);
        expect(draft?.data.genStatus).toBe("draft");
        expect(draft?.data.draft).toBe(true);
      }, { timeout: 10_000 });
      expect(generationRequests, "编辑不创建生成任务").toEqual([]);

      await page.reload();
      await vi.waitFor(async () => expect(await mediaNodes.count()).toBe(2));
      expect(await page.locator(`.react-flow__node-mediaNode[data-id="${draftId}"]`).innerText()).toContain("待生成");
      await page.locator(`.react-flow__node-mediaNode[data-id="${draftId}"] [data-testid="media-content"]`).click();
      await input.waitFor();
      expect(await editor.innerText(), "刷新后草稿描述恢复").toBe("轻快的海浪声");
      await page.getByText("IKDMQT Test").waitFor();

      await page.route("**/api/canvases/*", (route) => {
        if (route.request().method() === "PUT") return route.fulfill({ status: 500, body: "forced failure" });
        return route.continue();
      });
      await editor.fill("轻快的海浪声，加一点海鸥");
      await page.getByText("保存失败，请重试").first().waitFor({ timeout: 10_000 });
      await vi.waitFor(async () => {
        expect(await send.isDisabled(), "保存失败禁用发送").toBe(true);
      });
      expect(generationRequests, "保存失败暂停生成").toEqual([]);
      expect(await page.locator(`.react-flow__node-mediaNode[data-id="${draftId}"]`).count(), "草稿保留").toBe(1);
      await page.locator("button", { hasText: "IKDMQT browser A" }).first().click();
      await page.locator('div[class*="projectItem"]', { hasText: "IKDMQT browser B" }).first().click();
      await page.waitForTimeout(800);
      expect(page.url(), "保存失败暂停项目切换").toContain(`project=${projectId}`);

      await page.unroute("**/api/canvases/*");
      await editor.fill("轻快的海浪声，加一点海鸥");
      await vi.waitFor(async () => expect(await send.isEnabled(), "保存重试成功恢复发送").toBe(true), { timeout: 10_000 });
      await send.click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      expect(generationRequests[0].body.target_node_id).toBe(draftId);
      expect((generationRequests[0].body.parameters as Record<string, unknown>).prompt).toBe("轻快的海浪声，加一点海鸥");
      expect((generationRequests[0].body.parameters as Record<string, unknown>).model_id).toBe(MODEL_ID);
      await vi.waitFor(async () => {
        const row = await prisma.client.generation_jobs.findFirst({
          where: { project_id: BigInt(projectId) }, orderBy: { id: "desc" },
        });
        expect(row).not.toBeNull();
        const job = await readJob(row!.id.toString());
        expect(job!.input.target_node_id).toBe(draftId);
        expect(job!.input.prompt, "任务输入按提交快照冻结").toBe("轻快的海浪声，加一点海鸥");
        expect(job!.input.model_id).toBe(MODEL_ID);
        expect((job!.input.text_attachments as unknown[]) ?? [], "音频无文本附件内容").toEqual([]);
      }, { timeout: 10_000 });
      await page.getByText("生成中，参数只读").waitFor({ timeout: 10_000 });
      expect(await mediaNodes.count(), "原位生成不新增占位卡").toBe(2);

      const jobRow = await prisma.client.generation_jobs.findFirst({
        where: { project_id: BigInt(projectId) }, orderBy: { id: "desc" },
      });
      const outputAsset = await prisma.client.assets.create({
        data: {
          user_id: BigInt(987654),
          project_id: BigInt(projectId),
          type: "audio",
          url: "https://example.com/ikdmqt-out.mp3",
          size: BigInt(2048),
        },
      });
      await prisma.client.generation_output_slots.updateMany({
        where: { generation_job_id: jobRow!.id },
        data: { status: "succeeded", asset_id: outputAsset.id },
      });
      await prisma.client.generation_jobs.update({
        where: { id: jobRow!.id },
        data: { status: "succeeded", output_asset_ids: [outputAsset.id.toString()] },
      });
      const doneCard = page.locator(`.react-flow__node-mediaNode[data-id="${draftId}"]`);
      await doneCard.locator("audio").waitFor({ state: "attached", timeout: 15_000 });
      expect(await doneCard.innerText()).not.toContain("待生成");
      expect(await mediaNodes.count(), "成功回填不新增结果卡").toBe(2);
      expect(await mediaNodes.first().innerText(), "另一张草稿保持待生成").toContain("待生成");
      await vi.waitFor(async () => expect(await page.locator('[data-testid="audio-input"]').count(), "成品卡保持面板可编辑").toBeGreaterThan(0), { timeout: 10_000 });

      await page.locator("button", { hasText: "IKDMQT browser A" }).first().click();
      await page.locator('div[class*="projectItem"]', { hasText: "IKDMQT browser B" }).first().click();
      await page.waitForURL(`**project=${otherProjectId}**`, { timeout: 10_000 });

      await page.screenshot({ path: "/tmp/ikdmqt-browser.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 120_000);

  it.runIf(process.env.IKDMQT_BROWSER)("browser: IKFDFZ audio ref pick immediate persist, restore, isolation, submit references", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFDFZ browser")).id;
    const audioA = await createAudioAsset(projectId, "https://example.com/ikfdfz-a.mp3");
    const audioB = await createAudioAsset(projectId, "https://example.com/ikfdfz-b.mp3");
    const readyAudioNode = (id: string, assetId: string, name: string, x: number, y: number) => ({
      id,
      type: "mediaNode",
      position: { x, y },
      data: { src: `https://example.com/${id}.mp3`, mediaType: "audio", fileName: name, assetId },
    });
    expect(
      (await saveCanvas(
        projectId,
        [
          readyAudioNode("u1", audioA, "海浪声", 60, 520),
          readyAudioNode("u2", audioB, "风声", 60, 780),
          audioDraftNode("d1", ""),
          { ...audioDraftNode("d2"), position: { x: 940, y: 160 } },
        ],
        [],
        "missing",
        JSON.stringify({ x: 0, y: 0, zoom: 0.7 }),
      )).status,
    ).toBe(200);

    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
      page.setDefaultTimeout(10_000);
      const generationRequests: Array<Record<string, unknown>> = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && /\/api\/projects\/\d+\/generation-jobs$/.test(request.url())) {
          generationRequests.push(request.postDataJSON() as Record<string, unknown>);
        }
      });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);

      const edges = page.locator(".react-flow__edge");
      const refThumbs = page.locator('[data-testid="audio-ref-thumb"]');
      const input = page.locator('[data-testid="audio-input"]');
      const nodeById = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
      const savedPairs = async () => {
        const canvas = await getCanvas(projectId);
        return (JSON.parse(canvas.edges) as Array<{ source: string; target: string }>)
          .map((e) => `${e.source}->${e.target}`);
      };
      async function pickAudioNode(sourceId: string) {
        await page.locator('button[title="从资产中选择 / 从节点添加素材"]').dispatchEvent("click");
        await page.getByText("从节点添加素材", { exact: true }).dispatchEvent("click");
        await nodeById(sourceId).locator('[data-testid="media-content"]').dispatchEvent("click");
      }

      await nodeById("u1").locator("audio").waitFor({ state: "attached" });
      await nodeById("u2").locator("audio").waitFor({ state: "attached" });

      await nodeById("d1").locator('[data-testid="media-content"]').click();
      await input.waitFor();
      await pickAudioNode("u1");
      await vi.waitFor(async () => expect(await edges.count(), "音频选取立即建线").toBe(1));
      await vi.waitFor(async () => expect(await refThumbs.count()).toBe(1));
      await vi.waitFor(async () => {
        expect(await savedPairs(), "参考连线未发送即落盘").toContain("u1->d1");
      }, { timeout: 10_000 });
      expect(generationRequests, "保存参考不创建生成任务").toEqual([]);

      await pickAudioNode("u2");
      await vi.waitFor(async () => expect(await edges.count()).toBe(2));
      await vi.waitFor(async () => expect(await refThumbs.count()).toBe(2));
      await vi.waitFor(async () => {
        expect(await savedPairs()).toContain("u2->d1");
      }, { timeout: 10_000 });

      await page.reload();
      await nodeById("d1").locator('[data-testid="media-content"]').click();
      await input.waitFor();
      await vi.waitFor(async () => expect(await refThumbs.count(), "重开后两项参考恢复").toBe(2));

      await nodeById("d2").locator('[data-testid="media-content"]').click();
      await input.waitFor();
      await vi.waitFor(async () => expect(await refThumbs.count(), "B 不串入 A 的参考").toBe(0));
      await pickAudioNode("u2");
      await vi.waitFor(async () => expect(await savedPairs()).toContain("u2->d2"));
      await nodeById("d1").locator('[data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await refThumbs.count(), "切回 A 完整恢复").toBe(2));

      await refThumbs.nth(1).locator('button[title="移除"]').dispatchEvent("click");
      await vi.waitFor(async () => expect(await edges.count()).toBe(2));
      await vi.waitFor(async () => {
        const pairs = await savedPairs();
        expect(pairs).toContain("u1->d1");
        expect(pairs).toContain("u2->d2");
        expect(pairs).not.toContain("u2->d1");
      }, { timeout: 10_000 });

      await page.locator('[contenteditable="true"]').fill("参考驱动的环境音");
      await page.locator('[data-testid="audio-send"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      const sent = generationRequests[0]!;
      expect(sent.target_node_id).toBe("d1");
      expect(sent.references).toEqual([{ role: "reference", type: "audio", asset_id: audioA }]);
      await vi.waitFor(async () => {
        const row = await prisma.client.generation_jobs.findFirst({
          where: { project_id: BigInt(projectId) }, orderBy: { id: "desc" },
        });
        expect(row).not.toBeNull();
        const job = await readJob(row!.id.toString());
        expect(job!.input.references).toEqual([{ role: "reference", type: "audio", asset_id: audioA }]);
      }, { timeout: 10_000 });

      await page.screenshot({ path: "/tmp/ikfdfz-browser.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 240_000);
  it.runIf(process.env.IKDMQT_BROWSER)("browser: IKFE8V audio asset source persists identity and deduplicates", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFE8V assets")).id;
    const imageAsset = await prisma.client.assets.create({ data: { user_id: BigInt(987654), project_id: BigInt(projectId), type: "image", url: "https://example.com/image.png", size: BigInt(100) } });
    const videoAsset = await prisma.client.assets.create({ data: { user_id: BigInt(987654), project_id: BigInt(projectId), type: "video", url: "https://example.com/video.mp4", size: BigInt(100) } });
    const assetId = await createAudioAsset(projectId, `https://example.com/ikfe8v-library-${projectId}.mp3`);
    expect((await saveCanvas(projectId, [audioDraftNode("d1"), { ...audioDraftNode("d2"), position: { x: 940, y: 160 } }, { id: "image", type: "mediaNode", position: { x: 50, y: 500 }, data: { src: "https://example.com/image.png", mediaType: "image", assetId: imageAsset.id.toString(), fileName: "参考图片" } }, { id: "video", type: "mediaNode", position: { x: 50, y: 750 }, data: { src: "https://example.com/video.mp4", mediaType: "video", assetId: videoAsset.id.toString(), fileName: "不支持的视频" } }, { id: "di", type: "mediaNode", position: { x: 50, y: 1000 }, data: { src: "", mediaType: "image", draft: true, genStatus: "draft", prompt: "" } }], [], "missing", JSON.stringify({ x: 0, y: 0, zoom: 0.7 }))).status).toBe(200);
    const vite = await createVite({ root: `${process.cwd()}/web`, server: { open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } } } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
      page.setDefaultTimeout(10_000);
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: { userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      const node = (id: string) => page.locator(`.react-flow__node[data-id="${id}"] [data-testid="media-content"]`);
      const thumbs = page.locator('[data-testid="audio-ref-thumb"]');
      await node("d1").click();
      const entry = page.locator('button[title="从资产中选择 / 从节点添加素材"]');
      const entryStyle = () => entry.evaluate(el => { const s = getComputedStyle(el); return { width: s.width, height: s.height, borderRadius: s.borderRadius, background: s.backgroundColor }; });
      const audioEntryStyle = await entryStyle();
      async function pickAsset() {
        await page.locator('button[title="从资产中选择 / 从节点添加素材"]').click();
        await page.screenshot({ path: "/tmp/ikfe8v-audio-menu.png", fullPage: true });
        expect(await page.getByText("本地上传", { exact: true }).count()).toBe(0);
        await page.getByText("从资产中选择", { exact: true }).click();
        await page.getByRole("button", { name: "选择音频素材", exact: true }).first().waitFor();
        expect(await page.getByRole("button", { name: "选择图片素材", exact: true }).count()).toBeGreaterThan(0);
        expect(await page.getByRole("button", { name: "选择视频素材", exact: true }).count()).toBe(0);
        await page.getByRole("button", { name: "选择音频素材", exact: true }).filter({ has: page.locator(`audio[src*="ikfe8v-library-${projectId}.mp3"]`) }).click();
        await page.getByRole("button", { name: "确定（1）", exact: true }).click();
      }
      await page.locator('button[title="从资产中选择 / 从节点添加素材"]').click();
      await page.getByText("从节点添加素材", { exact: true }).click();
      await node("video").dispatchEvent("click");
      await page.getByText("音频参考仅支持图片或音频素材", { exact: true }).waitFor();
      expect(await thumbs.count()).toBe(0);
      expect(JSON.parse((await getCanvas(projectId)).edges)).toEqual([]);
      await pickAsset();
      await vi.waitFor(async () => expect(await thumbs.count()).toBe(1));
      await vi.waitFor(async () => {
        const saved = await getCanvas(projectId);
        const nodes = JSON.parse(saved.nodes);
        const edges = JSON.parse(saved.edges);
        expect(edges).toHaveLength(1);
        expect(nodes.find((n: { id: string }) => n.id === edges[0].source).data.assetId).toBe(assetId);
        expect(edges[0].target).toBe("d1");
      }, { timeout: 10_000 });
      await pickAsset();
      expect(await thumbs.count()).toBe(1);
      await page.reload(); await node("d1").click();
      await vi.waitFor(async () => expect(await thumbs.count()).toBe(1));
      await node("d2").click();
      await vi.waitFor(async () => expect(await thumbs.count()).toBe(0));
      await node("d1").click();
      await thumbs.locator('button[title="移除"]').dispatchEvent("click");
      await vi.waitFor(async () => expect(JSON.parse((await getCanvas(projectId)).edges)).toEqual([]));
      const savedRow = await prisma.client.canvas.findFirst({ where: { project_id: BigInt(projectId) } });
      expect(savedRow!.edges_json).toEqual([]);
      await node("di").click();
      await entry.waitFor();
      await page.mouse.move(0, 0);
      expect(await entryStyle()).toEqual(audioEntryStyle);
      await entry.click();
      await page.getByText("从节点添加素材", { exact: true }).waitFor();
      await page.screenshot({ path: "/tmp/ikfe8v-image-menu.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 120_000);
});
