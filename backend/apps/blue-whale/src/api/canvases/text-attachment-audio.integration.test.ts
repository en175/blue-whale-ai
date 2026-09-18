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

// IKFCXE「音频文本上下文生成闭环」公开接口集成（接纳段）：
// 真 NestFactory 挂载生产 Canvas/Generation 控制器与服务 + 隔离 MySQL（IKFCXE_DATABASE_URL 门控）。
// 音频与图片/视频同构——画布文本连线在接纳当下推导并冻结 text_attachments 快照；
// 差异契约：主提示词为空仍拒绝（音频不引入「仅附件生成」）。
// 本切片不产生上游 HTTP 调用（供应商组合消费由 generation-worker 单测与 Java AudioJobProcessor 测试覆盖）；
// 生成入队（RocketMQ）未配置时由控制器捕获记日志，不影响断言。
// 浏览器段（IKFCXE_BROWSER=1：连线 → 面板见附件 → 发送 → 刷新恢复）在同 describe 尾部。
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
      },
      update: { features: {} },
    });
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, GenerationCostEstimatorService, CanvasService], GenerationJobsController);
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
    // 与当时画布一致：仅 target=media-1 且 source 为 textNode 的边，按 edges 数组顺序；title 缺省 ""
    expect(job!.input.text_attachments).toEqual([
      { node_id: "text-b", title: "", text: "雨夜街道，两个人争吵" },
      { node_id: "text-a", title: "风格", text: "赛博朋克城市" },
    ]);
    expect(job!.input.model_id).toBe(MODEL_ID);
    // 音频无 aspect_ratio（validateCommon 跳过）
    expect(job!.input.aspect_ratio).toBeUndefined();
  });

  it("目标缺失 / 视频与图片 mediaNode → 明确失败不建任务", async () => {
    const projectId = (await projects.create("987654", "IKFCXE bad target")).id;
    const nodes = [mediaNode("media-v", "video"), mediaNode("media-i", "image"), textNode("text-1", "正文")];
    const edges = [{ id: "e1", source: "text-1", target: "media-v" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const missing = await createJob(projectId, audioJobBody("ghost", "哼一段旋律"));
    expect(missing.code).toBe(400);
    expect(missing.msg).toBe("目标节点不存在或不是音频媒体节点");

    const videoTarget = await createJob(projectId, audioJobBody("media-v", "哼一段旋律"));
    expect(videoTarget.code).toBe(400);
    expect(videoTarget.msg).toBe("目标节点不存在或不是音频媒体节点");

    expect(await jobCount(projectId)).toBe(0);
  });

  it("主提示词为空（即便附件正文非空）→ 保持既有音频校验明确拒绝，不引入仅附件生成", async () => {
    const projectId = (await projects.create("987654", "IKFCXE empty prompt")).id;
    const nodes = [mediaNode("media-1", "audio"), textNode("text-1", "独立正文", "附件")];
    const edges = [{ id: "e1", source: "text-1", target: "media-1" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const created = await createJob(projectId, audioJobBody("media-1", ""));
    expect(created.code).toBe(400);
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

  it("组合后超过 30000 字 → 明确失败、不创建任务", async () => {
    const projectId = (await projects.create("987654", "IKFCXE composed limit")).id;
    const nodes = [mediaNode("media-1", "audio"), textNode("text-1", "文".repeat(31_000))];
    const edges = [{ id: "e1", source: "text-1", target: "media-1" }];
    expect((await saveCanvas(projectId, nodes, edges, "missing")).status).toBe(200);

    const created = await createJob(projectId, audioJobBody("media-1", "读一下"));
    expect(created.code).toBe(400);
    expect(created.msg).toBe("文本附件与提示词组合后超过 30000 字上限");
    expect(await jobCount(projectId)).toBe(0);
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

    // 断开 text-1 → media-1（保留 text-1 → media-2）
    const canvas = await getCanvas(projectId);
    const detached = await saveCanvas(projectId, nodes, [{ id: "e2", source: "text-1", target: "media-2" }], canvas.version);
    expect(detached.status).toBe(200);

    const second = await createJob(projectId, audioJobBody("media-1", "环境音"));
    expect(second.code).toBe(200);
    const secondJob = await readJob(second.data.generation_job_id);
    expect(secondJob!.input.text_attachments).toEqual([]);

    // 其他目标关系保留：media-2 仍消费附件
    const otherTarget = await createJob(projectId, audioJobBody("media-2", "配音"));
    expect(otherTarget.code).toBe(200);
    const otherJob = await readJob(otherTarget.data.generation_job_id);
    expect(otherJob!.input.text_attachments).toEqual([{ node_id: "text-1", title: "风格", text: "雨夜街道" }]);

    // 历史任务快照不改写
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

    // 接纳后改写正文并断开连线：重试不得回读这些变更
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

  // 浏览器段（工单「验收证据」节）：真实浏览器 + 真实业务 API + 隔离 MySQL 走完整音频提交路径。
  // 断言以「创建请求体 + 库内冻结快照」为准——连线驱动附件进参考栏、发送后冻结、刷新恢复关系。
  // 播种成品卡身份（jobId）：点击卡自动打开音频草稿面板（与图片/视频浏览器段同构）。
  it.runIf(process.env.IKFCXE_BROWSER)("browser: connect → panel attachment → send freezes → reload restores", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFCXE browser")).id;
    // 直接播种连线（IKFCXC 起改）：拖线与「到节点选择」交互由图片浏览器段覆盖，本段聚焦
    // 音频面板附件展示（FileText 缩略图 + 完整正文预览）→ 发送 → 冻结快照 → 刷新恢复的音频闭环。
    const seeded = await saveCanvas(projectId, [
      { id: "text-1", type: "textNode", position: { x: 140, y: 160 }, data: { title: "雨夜", text: "雨夜街道，两个人争吵" } },
      { id: "media-1", type: "mediaNode", position: { x: 900, y: 120 }, data: { mediaType: "audio", fileName: "目标音频", jobId: "ikfcxe-seed-job", draftModelId: MODEL_ID } },
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

      // 播种连线恢复渲染；页面加载不触发任何生成
      await vi.waitFor(async () => {
        expect(await page.locator(".react-flow__edge").count(), "连线应渲染（showEdges 默认可见）").toBe(1);
      });
      expect(generationRequests).toEqual([]);

      // 点击音频成品卡自动打开草稿面板：连线文本卡以 FileText 缩略图进参考栏，
      // 悬浮浮层显示来源完整正文（无标题、只读）
      await media.locator('[data-testid="media-content"]').click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="dock-text-ref"]').count()).toBe(1));
      await page.locator('[data-testid="dock-text-ref"]').first().hover();
      const overlay = page.locator('[data-testid="ref-thumb-preview"]');
      await overlay.waitFor();
      expect(await overlay.innerText()).toContain("雨夜街道，两个人争吵");

      // 发送：主提示词非空（音频不允许仅附件发送，前端禁用与后端拒绝一致）；
      // 请求体携带 target_node_id 且 type=audio
      await page.locator('[data-testid="audio-input"] [contenteditable]').fill('生成环境音，参考');
      await page.getByRole('button', { name: '插入引用 雨夜', exact: true }).click();
      await vi.waitFor(async () => expect(await page.locator('[data-testid="asset-ref-valid"]').innerText()).toBe('文本1'));
      await page.locator('[data-testid="audio-send"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      expect(generationRequests[0].body.type).toBe("audio");
      expect(generationRequests[0].body.target_node_id).toBe("media-1");
      expect((generationRequests[0].body.parameters as Record<string, unknown>).prompt).toBe("生成环境音，参考文本1");

      // 库内冻结：附件完整正文与主提示词共同进入任务快照
      await vi.waitFor(async () => expect(await jobCount(projectId)).toBe(1), { timeout: 10_000 });
      const rows = await prisma.client.generation_jobs.findMany({
        where: { project_id: BigInt(projectId) }, orderBy: { id: "asc" },
      });
      const input = rows[0].input as Record<string, unknown>;
      expect(input.target_node_id).toBe("media-1");
      expect(input.prompt).toBe("生成环境音，参考文本1");
      // IKG6EK / ADR-0088：composed_prompt 与 prompt_doc 均已退役——前者是编号清单组合，
      // 后者整体惰性化（不读、不冻结）。正文一律取 parameters.prompt。
      expect(input).not.toHaveProperty("composed_prompt");
      expect(input).not.toHaveProperty("prompt_doc");
      expect(input.text_attachments).toEqual([
        { node_id: "text-1", title: "雨夜", text: "雨夜街道，两个人争吵" },
      ]);

      // 刷新：连线恢复渲染；重新打开面板附件回归（关系持久恢复）
      await page.reload();
      await text.waitFor();
      await media.waitFor();
      await vi.waitFor(async () => {
        expect(await page.locator(".react-flow__edge").count(), "刷新后连线恢复渲染").toBe(1);
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
