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

// 计费基线起建任务必接 billing Hold（fail closed、无开关），控制器第 7 参也新增 IdentityService。
// 本套件被测对象不是计费：进程内假客户端放行 hold/quote。
vi.mock("@lib/shared/billing/billing-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lib/shared/billing/billing-client.js")>();
  return {
    ...actual,
    sharedBillingClient: () => ({
      hold: async () => ({ reservedCredits: 1, catalogVersion: 1, duplicated: false }),
      quote: async () => ({ credits: BigInt(1), catalogVersion: 1 }),
      queryBalance: async () => ({ availableCredits: 0, frozenCredits: 0, expiring: [] }),
      listTransactions: async () => ({ items: [], nextPageToken: "" }),
    }),
  };
});

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
        // channel 为必填封闭枚举；audio 行的渠道就是媒介本身（无解析器/协议之分）
        channel: "seedream-audio",
      },
      update: { features: {} },
    });
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, CanvasService, MaterialService, AssetService, IdentityService], GenerationJobsController);
    Reflect.defineMetadata("design:paramtypes", [ModelCapabilityReadService], GenerationModelsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
    Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
    Reflect.defineMetadata("design:paramtypes", [AssetService], AssetsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, AssetService, AssetStorageService], ProjectAssetsController);
    class HarnessModule {}
    Module({ controllers: [ProjectAssetsController, AssetsController, CanvasesController, GenerationJobsController, GenerationModelsController, ProjectsController, JobsController], providers: [
      // IKIPWT：业务失败经 DomainError → AllExceptionsFilter 统一投影（与 app.module 的 APP_FILTER 同款），
      // 台架不挂过滤器时 DomainError 落 Nest 默认 500 处理，信封 code/msg 均不可见。
      { provide: APP_FILTER, useClass: AllExceptionsFilter },
      { provide: MaterialService, useValue: new MaterialService(prisma) },
      { provide: AssetStorageService, useValue: new AssetStorageService() },
      { provide: AssetService, useValue: new AssetService(prisma, new AssetStorageService()) },
      { provide: CanvasService, useValue: canvasService },
      { provide: ProjectService, useValue: projects },
      { provide: PrismaService, useValue: prisma },
      { provide: SnapshotService, useValue: new SnapshotService(prisma) },
      { provide: JobsService, useValue: new JobsService(prisma, projects) },
      { provide: GenerationCommandService, useValue: new GenerationCommandService(prisma) },
      { provide: ModelCapabilityReadService, useValue: new ModelCapabilityReadService(prisma) },
      { provide: MaterialService, useValue: new MaterialService(prisma) },
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
    // IKE4GC 起文案为现行口径（音频仅支持单数组 references），旧 IKDMQT 文案已废弃
    expect(withRefs.msg).toContain("音频生成暂不支持旧参考字段");
    expect(await prisma.client.generation_jobs.count({ where: { project_id: BigInt(projectId) } })).toBe(0);
  });

  it("IKFDFZ：references 随音频任务保序冻结（身份与顺序 = 页面提交）；超限/混用/视频参考 400 明确失败", async () => {
    const projectId = (await projects.create("987654", "IKFDFZ freeze")).id;
    const audioA = await createAudioAsset(projectId, "https://example.com/ikfdfz-a.mp3");
    const audioB = await createAudioAsset(projectId, "https://example.com/ikfdfz-b.mp3");
    const imageAsset = await createAudioAsset(projectId, "https://example.com/ikfdfz-img.png");
    expect((await saveCanvas(projectId, [audioDraftNode("a4", "参考驱动")], [], "missing")).status).toBe(200);

    // 合法边界：两段音频按提交顺序冻结
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

    // 合法上限：满 3 段音频同样通过并按提交顺序冻结（边界值 = 契约上限，不只测上限之下）
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

    // 超限（>3）/ 音频与图片混用 / 视频参考：服务端按契约明确拒绝，不静默截断
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
      // 侧栏音频按钮 aria-label 已随「直开音频生成对话框」改版从「音频生成」改为「音频」
      const sidebarAudio = page.locator('button[aria-label="音频"]');
      await sidebarAudio.waitFor();
      const input = page.locator('[data-testid="audio-input"]');
      const editor = page.locator('[contenteditable="true"]');
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

      // 4) 刷新恢复：草稿与参数原样回来，点击卡片重开面板
      await page.reload();
      await vi.waitFor(async () => expect(await mediaNodes.count()).toBe(2));
      expect(await page.locator(`.react-flow__node-mediaNode[data-id="${draftId}"]`).innerText()).toContain("待生成");
      await page.locator(`.react-flow__node-mediaNode[data-id="${draftId}"] [data-testid="media-content"]`).click();
      await input.waitFor();
      expect(await editor.innerText(), "刷新后草稿描述恢复").toBe("轻快的海浪声");
      await page.getByText("IKDMQT Test").waitFor();

      // 5) 保存故障：阻断生成与项目切换，保留当前编辑与草稿
      await page.route("**/api/canvases/*", (route) => {
        if (route.request().method() === "PUT") return route.fulfill({ status: 500, body: "forced failure" });
        return route.continue();
      });
      await editor.fill("轻快的海浪声，加一点海鸥");
      await page.getByText("保存失败，请重试").first().waitFor({ timeout: 10_000 });
      // 保存失败时发送按钮禁用（更强的拦截：disabled 于回调拦截）
      await vi.waitFor(async () => {
        expect(await send.isDisabled(), "保存失败禁用发送").toBe(true);
      });
      expect(generationRequests, "保存失败暂停生成").toEqual([]);
      expect(await page.locator(`.react-flow__node-mediaNode[data-id="${draftId}"]`).count(), "草稿保留").toBe(1);
      // 项目切换被阻断：选择另一项目后仍停留在当前项目
      await page.locator("button", { hasText: "IKDMQT browser A" }).first().click();
      await page.locator('div[class*="projectItem"]', { hasText: "IKDMQT browser B" }).first().click();
      await page.waitForTimeout(800);
      expect(page.url(), "保存失败暂停项目切换").toContain(`project=${projectId}`);

      // 6) 保存恢复后原位提交：重试保存成功解除禁用，再落盘建任务；生成中面板只读
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
        // IKFCXE 起音频支持文本附件（字段恒冻结，无连线时空数组）
        expect((job!.input.text_attachments as unknown[]) ?? [], "音频无文本附件内容").toEqual([]);
      }, { timeout: 10_000 });
      // IKFCKS 起输入为 Lexical contenteditable（只读不体现在 disabled）；「生成中，参数只读」提示即权威只读信号
      await page.getByText("生成中，参数只读").waitFor({ timeout: 10_000 });
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
      await doneCard.locator("audio").waitFor({ state: "attached", timeout: 15_000 });
      expect(await doneCard.innerText()).not.toContain("待生成");
      expect(await mediaNodes.count(), "成功回填不新增结果卡").toBe(2);
      expect(await mediaNodes.first().innerText(), "另一张草稿保持待生成").toContain("待生成");
      // IKDMQU P1 起成品卡保持生成面板（编辑写回原卡，重新生成中/失败态可打开查看），转成品后不再自动收起
      await vi.waitFor(async () => expect(await page.locator('[data-testid="audio-input"]').count(), "成品卡保持面板可编辑").toBeGreaterThan(0), { timeout: 10_000 });

      // 8) 保存状态正常：项目切换放行
      await page.locator("button", { hasText: "IKDMQT browser A" }).first().click();
      await page.locator('div[class*="projectItem"]', { hasText: "IKDMQT browser B" }).first().click();
      await page.waitForURL(`**project=${otherProjectId}**`, { timeout: 10_000 });

      await page.screenshot({ path: "/tmp/ikdmqt-browser.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 120_000);

  // IKFDFZ 浏览器段（工单「音频生成验收」「共通验收边界」）：真实浏览器 + 真实业务 API + 隔离 MySQL。
  // 场景：画布选取即建线落盘（不等待发送）→ 刷新重开按连线恢复 → A→B→A 隔离 → 面板移除断线 →
  // 提交 references（身份与顺序 = 面板显示）→ DB 冻结核对。无真实供应商执行（替身边界：任务停在 queued）。
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
      /** 「添加参考音频」→「从画布选择」进入选取模式后点击来源节点（跟随面板与素材卡
       *  在 Playwright 命中检测上重叠，统一 DOM 派发直触发，真实链路不变） */
      async function pickAudioNode(sourceId: string) {
        await page.locator('button[title="从资产中选择 / 从节点添加素材"]').dispatchEvent("click");
        await page.getByText("从节点添加素材", { exact: true }).dispatchEvent("click");
        await nodeById(sourceId).locator('[data-testid="media-content"]').dispatchEvent("click");
      }

      // 音频卡的 <audio> 元素为隐藏原生控件（自定义播放器 UI），按挂载态等待
      await nodeById("u1").locator("audio").waitFor({ state: "attached" });
      await nodeById("u2").locator("audio").waitFor({ state: "attached" });

      // 1) 打开草稿 d1：画布选取 u1 → 立即建线（不等待发送），随自动保存落盘
      await nodeById("d1").locator('[data-testid="media-content"]').click();
      await input.waitFor();
      await pickAudioNode("u1");
      await vi.waitFor(async () => expect(await edges.count(), "音频选取立即建线").toBe(1));
      await vi.waitFor(async () => expect(await refThumbs.count()).toBe(1));
      await vi.waitFor(async () => {
        expect(await savedPairs(), "参考连线未发送即落盘").toContain("u1->d1");
      }, { timeout: 10_000 });
      expect(generationRequests, "保存参考不创建生成任务").toEqual([]);

      // 2) 再选 u2：第二条连线，面板两项按边序；等第二条连线落盘后再刷新
      await pickAudioNode("u2");
      await vi.waitFor(async () => expect(await edges.count()).toBe(2));
      await vi.waitFor(async () => expect(await refThumbs.count()).toBe(2));
      await vi.waitFor(async () => {
        expect(await savedPairs()).toContain("u2->d1");
      }, { timeout: 10_000 });

      // 3) 刷新重开：参考按连线完整恢复（保存后恢复，即使从未生成）
      await page.reload();
      await nodeById("d1").locator('[data-testid="media-content"]').click();
      await input.waitFor();
      await vi.waitFor(async () => expect(await refThumbs.count(), "重开后两项参考恢复").toBe(2));

      // 4) A→B→A 隔离：B 面板干净，B 独立积累；切回 A 完整恢复
      await nodeById("d2").locator('[data-testid="media-content"]').click();
      await input.waitFor();
      await vi.waitFor(async () => expect(await refThumbs.count(), "B 不串入 A 的参考").toBe(0));
      await pickAudioNode("u2");
      await vi.waitFor(async () => expect(await savedPairs()).toContain("u2->d2"));
      await nodeById("d1").locator('[data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await refThumbs.count(), "切回 A 完整恢复").toBe(2));

      // 5) 面板移除 u2：断线并落盘，重开不复活；u1 连线与 B 的引用保持完整
      await refThumbs.nth(1).locator('button[title="移除"]').dispatchEvent("click");
      await vi.waitFor(async () => expect(await edges.count()).toBe(2));
      await vi.waitFor(async () => {
        const pairs = await savedPairs();
        expect(pairs).toContain("u1->d1");
        expect(pairs).toContain("u2->d2");
        expect(pairs).not.toContain("u2->d1");
      }, { timeout: 10_000 });

      // 6) 提交：references 按面板顺序（连线顺序）组装，DB 冻结身份与顺序
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
        // DB 冻结输入 = 请求 references（IKFDFZ：身份与顺序 = 页面提交）
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
