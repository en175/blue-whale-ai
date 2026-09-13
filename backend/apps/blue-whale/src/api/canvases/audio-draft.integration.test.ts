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

vi.mock("@lib/shared/generation/video-queue.js", () => ({
  enqueueVideoGenerationJob: vi.fn(async () => {}),
  enqueueImageGenerationJob: vi.fn(async () => {}),
  enqueueAudioGenerationJob: vi.fn(async () => {}),
  enqueueMediaExtractJob: vi.fn(async () => {}),
  loadRocketMqConfig: vi.fn(() => ({
    endpoints: "", sslEnabled: false, topic: "generation-video", tag: "step",
  })),
  createRocketMqVideoProducer: vi.fn(() => ({ enqueue: vi.fn(async () => {}) })),
  closeVideoGenerationQueue: vi.fn(async () => {}),
}));

// IKDMQT「音频草稿完整流程」公开接口集成（工单「范围与测试约定」节）：
// 真 NestFactory 挂载生产 Canvas/Generation/Jobs 控制器与服务 + 隔离 MySQL（IKDMQT_DATABASE_URL 门控）。
// 服务端改动：target_node_id 扩展支持音频（校验目标为 audio 媒体节点、冻结快照、不推导文本附件）。
// 浏览器段（IKDMQT_BROWSER=1）在尾部。
describe.skipIf(!process.env.IKDMQT_DATABASE_URL)("Audio draft public API (IKDMQT)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "ikdmqt-audio-model";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKDMQT_DATABASE_URL;
    // 入队函数在测试中被 stub，任务停在 queued 驱动「生成中只读」；结果仍由测试直接翻 DB 状态。
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
      },
      update: { features: {} },
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
    // IKFCXE：音频与图片/视频同构——连线文本卡推导冻结为创作上下文快照
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
    expect(wrongType.code).toBe(400);
    expect(wrongType.msg).toContain("目标节点不存在或不是音频媒体节点");

    const missing = await createJob(projectId, {
      type: "audio",
      target_node_id: "a-404",
      expected_output_count: 1,
      parameters: audioParameters,
    });
    expect(missing.code).toBe(400);
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
    expect(blank.code).toBe(400);
    expect(blank.msg).toBe("prompt 无效");

    const withRefs = await createJob(projectId, {
      type: "audio",
      target_node_id: "a3",
      expected_output_count: 1,
      parameters: audioParameters,
      input_asset_ids: ["1"],
    });
    expect(withRefs.code).toBe(400);
    // IKE4GC 起文案为现行口径（音频仅支持单数组 references），旧 IKDMQT 文案已废弃
    expect(withRefs.msg).toContain("音频生成暂不支持旧参考字段");
    expect(await prisma.client.generation_jobs.count({ where: { project_id: BigInt(projectId) } })).toBe(0);
  });

  // 浏览器段（工单「范围与测试约定」）：真实浏览器 + 真实业务 API + 隔离 MySQL；
  // 仅记录提交请求（无真实供应商执行，任务停在 pending 驱动「生成中只读」）。
  // 场景：侧栏建音频草稿 → 重复创建 → 描述编辑落盘 → 刷新恢复 → 保存故障阻断生成与项目切换 →
  // 恢复后原位提交（冻结输入=请求=面板显示）→ 生成中只读 → DB 翻 succeeded 同卡回填不新增结果卡。
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
      // 只捕获创建调用（不含 retry/cancel 子路径）：断言「建卡与编辑不自动执行」与请求体
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
      const sidebarAudio = page.locator('button[aria-label="音频生成"]');
      await sidebarAudio.waitFor();
      const input = page.locator('[data-testid="audio-input"]');
      const send = page.locator('[data-testid="audio-send"]');

      // 1) 侧栏点击：先出现音频草稿卡、自动选中并打开面板；不创建任务
      await sidebarAudio.click();
      await vi.waitFor(async () => expect(await mediaNodes.count()).toBe(1));
      await input.waitFor();
      expect(await mediaNodes.first().innerText()).toContain("待生成");
      expect(await mediaNodes.first().innerText()).not.toContain("素材已被删除");
      expect(await page.locator(".react-flow__node-mediaNode.selected").count(), "新卡自动选中").toBe(1);
      expect(generationRequests, "建卡不创建生成任务").toEqual([]);

      // 2) 重复点击：每次新增独立草稿（面板绑定最新一张，后续编辑与提交都以它为准）
      await sidebarAudio.click();
      await vi.waitFor(async () => expect(await mediaNodes.count()).toBe(2));
      expect(generationRequests).toEqual([]);
      const draftId = (await mediaNodes.nth(1).getAttribute("data-id"))!;
      expect(draftId).not.toBe(await mediaNodes.first().getAttribute("data-id"));

      // 3) 面板编辑：描述实时写回并落盘；模型目录就位
      await page.getByText("IKDMQT Test").waitFor();
      await input.fill("轻快的海浪声");
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

      // 4) 刷新恢复：草稿与参数原样回来，点击卡片重开面板
      await page.reload();
      await vi.waitFor(async () => expect(await mediaNodes.count()).toBe(2));
      expect(await page.locator(`.react-flow__node-mediaNode[data-id="${draftId}"]`).innerText()).toContain("待生成");
      await page.locator(`.react-flow__node-mediaNode[data-id="${draftId}"] [data-testid="media-content"]`).click();
      await input.waitFor();
      expect(await input.inputValue(), "刷新后草稿描述恢复").toBe("轻快的海浪声");
      await page.getByText("IKDMQT Test").waitFor();

      // 5) 保存故障：阻断生成与项目切换，保留当前编辑与草稿
      await page.route("**/api/canvases/*", (route) => {
        if (route.request().method() === "PUT") return route.fulfill({ status: 500, body: "forced failure" });
        return route.continue();
      });
      await input.fill("轻快的海浪声，加一点海鸥");
      await page.getByText("保存失败，请重试").first().waitFor({ timeout: 10_000 });
      await send.click();
      await vi.waitFor(async () => {
        expect(await page.getByText("保存失败，请重试").count(), "落盘失败提示").toBeGreaterThan(0);
      });
      expect(generationRequests, "保存失败暂停生成").toEqual([]);
      expect(await page.locator(`.react-flow__node-mediaNode[data-id="${draftId}"]`).count(), "草稿保留").toBe(1);
      // 项目切换被阻断：选择另一项目后仍停留在当前项目
      await page.locator("button", { hasText: "IKDMQT browser A" }).first().click();
      await page.locator('div[class*="projectItem"]', { hasText: "IKDMQT browser B" }).first().click();
      await page.waitForTimeout(800);
      expect(page.url(), "保存失败暂停项目切换").toContain(`project=${projectId}`);
      await page.unroute("**/api/canvases/*");

      // 6) 保存恢复后原位提交：先落盘再建任务；生成中面板只读
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
        expect(job!.input, "音频无文本附件").not.toHaveProperty("text_attachments");
      }, { timeout: 10_000 });
      await vi.waitFor(async () => {
        expect(await input.isDisabled(), "生成中参数只读").toBe(true);
      }, { timeout: 10_000 });
      await page.getByText("生成中，参数只读").waitFor();
      expect(await mediaNodes.count(), "原位生成不新增占位卡").toBe(2);

      // 7) 任务成功：结果填回同一张卡（身份不变、不新增结果卡），另一张草稿不受影响
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
      await doneCard.locator("audio").waitFor({ timeout: 15_000 });
      expect(await doneCard.innerText()).not.toContain("待生成");
      expect(await mediaNodes.count(), "成功回填不新增结果卡").toBe(2);
      expect(await mediaNodes.first().innerText(), "另一张草稿保持待生成").toContain("待生成");
      // 草稿转成品卡后面板自动收起
      await vi.waitFor(async () => expect(await page.locator('[data-testid="audio-input"]').count()).toBe(0));

      // 8) 保存状态正常：项目切换放行
      await page.locator("button", { hasText: "IKDMQT browser A" }).first().click();
      await page.locator('div[class*="projectItem"]', { hasText: "IKDMQT browser B" }).first().click();
      await page.waitForURL(`**project=${otherProjectId}**`, { timeout: 10_000 });

      await page.screenshot({ path: "/tmp/ikdmqt-browser.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 120_000);
});
