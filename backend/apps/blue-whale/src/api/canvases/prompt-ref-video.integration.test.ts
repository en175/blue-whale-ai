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
import { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { createWorkerRepo } from "@lib/shared/persistence/generation-worker-repo.js";
import { runVideoJobStep, type VideoTaskProvider } from "@lib/shared/generation-runtime/video-job-runner.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";
import { GenerationCommandService } from "@lib/shared/generation/generation-command.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { GenerationCostEstimatorService } from "@lib/shared/generation/cost-estimator.service.js";

// IKFA1O「生视频多媒体索引与首尾帧角色」公开接口集成：
// 真 NestFactory 挂载生产 Canvas/Generation 控制器与服务 + 隔离 MySQL（IKFA1O_DATABASE_URL 门控）。
// 链路：POST generation-jobs（video + references + prompt_doc）→ 服务端复核/按 references 结构编译
// → 库内冻结快照 → runVideoJobStep 记录式供应商消费 → 重试消费原快照。
// IKFA1O_BROWSER=1：真实浏览器 → BottomDialog @ 插入多媒体/首尾帧标签 → 发送 → worker → 供应商 → 恢复/重试。
describe.skipIf(!process.env.IKFA1O_DATABASE_URL)("Video prompt ref doc public API (IKFA1O)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "doubao-seedance-2-0-ikfa1o";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKFA1O_DATABASE_URL;
    vi.stubEnv("ROCKETMQ_ENDPOINTS", "");
    const sizes = [{ id: "720p", label: "720p", api_value: "720p" }];
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikfa1o-test", model_id: MODEL_ID } },
      create: {
        provider_id: "ikfa1o-test",
        model_id: MODEL_ID,
        capability_type: "video",
        model_label: "IKFA1O Test",
        supported_sizes: sizes,
        supported_aspect_ratios: ["16:9"],
        supported_formats: ["mp4"],
        default_size: "720p",
        default_aspect_ratio: "16:9",
        default_duration: 5,
        supported_durations: { min: 4, max: 12, step: 1 },
        features: { reference_image: true, max_reference_images: 9, first_frame: true, last_frame: true, first_last_frame: true },
      },
      update: {
        supported_sizes: sizes,
        default_size: "720p",
        features: { reference_image: true, max_reference_images: 9, first_frame: true, last_frame: true, first_last_frame: true },
      },
    });
    const canvasService = new CanvasService(prisma, projects);
    Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService, GenerationCostEstimatorService, CanvasService], GenerationJobsController);
    Reflect.defineMetadata("design:paramtypes", [ModelCapabilityReadService], GenerationModelsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
    Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
    class HarnessModule {}
    Module({ controllers: [CanvasesController, GenerationJobsController, GenerationModelsController, ProjectsController, JobsController], providers: [
      { provide: JobsService, useValue: new JobsService(prisma, projects) },
      { provide: CanvasService, useValue: canvasService },
      { provide: ProjectService, useValue: projects },
      { provide: PrismaService, useValue: prisma },
      { provide: SnapshotService, useValue: new SnapshotService(prisma) },
      { provide: GenerationCommandService, useValue: new GenerationCommandService(prisma) },
      { provide: ModelCapabilityReadService, useValue: new ModelCapabilityReadService(prisma) },
      { provide: GenerationCostEstimatorService, useValue: new GenerationCostEstimatorService() },
    ] })(HarnessModule);
    app = await NestFactory.create(HarnessModule, { logger: false, bodyParser: false });
    // 配额门（IKBD2Q）：生成前拉 /api/usage/token，harness 无该路由会 404 被当 0 拦截——直接放行充足配额
    app.use("/api/usage/token", (req: { method?: string }, res: { json: (body: unknown) => void }, next: () => void) => {
      if (req.method === "GET") {
        res.json({ code: 200, data: { quota: 50_000_000 } });
        return;
      }
      next();
    });
    app.use(json({ limit: "16mb" }));
    app.setGlobalPrefix("api");
    app.use((req: { user: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
      req.user = { userId: "987654" };
      // 生成凭证密封：请求头 sk 经 controller 写入 job.input.provider_credential（worker 解出）
      req.headers.authorization = "Bearer sk-ikfa1o-recording-provider";
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
    vi.unstubAllEnvs();
  });

  async function createAsset(projectId: string, name: string, type: "image" | "video" | "audio") {
    const asset = await prisma.client.assets.create({
      data: {
        user_id: BigInt(987654),
        project_id: BigInt(projectId),
        type,
        url: `https://example.com/${name}.${type === "image" ? "png" : type === "video" ? "mp4" : "mp3"}`,
        ...(type === "image" ? { width: 1024, height: 1024 } : {}),
        size: BigInt(2048),
      },
    });
    return asset.id.toString();
  }
  async function createJob(projectId: string, body: unknown) {
    const response = await fetch(`${base}/api/projects/${projectId}/generation-jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-ikfa1o-test" },
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

  function videoBody(references?: unknown, promptDoc?: unknown) {
    return {
      type: "video",
      expected_output_count: 1,
      parameters: { prompt: "让图片1的人物走出画面", model_id: MODEL_ID, aspect_ratio: "16:9", resolution: "720p", duration: 5 },
      ...(references !== undefined ? { references } : {}),
      ...(promptDoc !== undefined ? { prompt_doc: promptDoc } : {}),
    };
  }

  it("帧在前 references + prompt_doc → 按实际结构编译（首帧/尾帧/同类型编号）并冻结原始结构（A2/C1）", async () => {
    const projectId = (await projects.create("987654", "IKFA1O doc create")).id;
    const f1 = await createAsset(projectId, "first", "image");
    const f2 = await createAsset(projectId, "last", "image");
    const img1 = await createAsset(projectId, "img1", "image");
    const vid1 = await createAsset(projectId, "vid1", "video");
    const references = [
      { role: "first_frame", asset_id: f1, type: "image" },
      { role: "last_frame", asset_id: f2, type: "image" },
      { role: "reference", asset_id: img1, type: "image" },
      { role: "reference", asset_id: vid1, type: "video" },
    ];
    const doc = {
      version: 1,
      segments: [
        { kind: "text", text: "从" },
        { kind: "asset_ref", asset_id: f1, label: "首帧" },
        { kind: "text", text: "走向" },
        { kind: "asset_ref", asset_id: f2, label: "尾帧" },
        { kind: "text", text: "，人物参考" },
        { kind: "asset_ref", asset_id: img1, label: "图片1" },
        { kind: "text", text: "，运镜参考" },
        { kind: "asset_ref", asset_id: vid1, label: "视频1" },
      ],
    };
    const created = await createJob(projectId, videoBody(references, doc));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.prompt).toBe("从首帧走向尾帧，人物参考图片1，运镜参考视频1");
    expect(job!.input.prompt_doc).toEqual(doc);
    expect(job!.input.references).toEqual(references);
  });

  it("素材库 material 身份标签参与编译（不与本地 assetId 混用）", async () => {
    const projectId = (await projects.create("987654", "IKFA1O material identity")).id;
    const local = await createAsset(projectId, "local-img", "image");
    const references = [
      { role: "reference", asset_id: local, type: "image" },
      { role: "reference", material_id: "asset-lib-v9", type: "video" },
    ];
    const doc = {
      version: 1,
      segments: [
        { kind: "text", text: "风格跟随" },
        { kind: "asset_ref", asset_id: "asset-lib-v9", label: "视频1" },
      ],
    };
    const created = await createJob(projectId, videoBody(references, doc));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.prompt).toBe("风格跟随视频1");
  });

  it("失效标签 / 未知身份 / 缺 references / 音频携带 → 400 且零任务（服务端复核，D4）", async () => {
    const projectId = (await projects.create("987654", "IKFA1O bad doc")).id;
    const a = await createAsset(projectId, "a", "image");
    const references = [{ role: "reference", asset_id: a, type: "image" }];

    const invalidTag = await createJob(projectId, videoBody(references, {
      version: 1,
      segments: [{ kind: "asset_ref", asset_id: a, invalid_label: "图片1" }],
    }));
    expect(invalidTag.code).toBe(400);
    expect(invalidTag.msg).toBe("存在已失效的素材标签，请删除后再提交");

    const unknownAsset = await createJob(projectId, videoBody(references, {
      version: 1,
      segments: [{ kind: "asset_ref", asset_id: "999" }],
    }));
    expect(unknownAsset.code).toBe(400);
    expect(unknownAsset.msg).toBe("正文素材标签指向无效的参考素材");

    const legacyPath = await createJob(projectId, videoBody(undefined, {
      version: 1,
      segments: [{ kind: "asset_ref", asset_id: a }],
    }));
    expect(legacyPath.code).toBe(400);
    expect(legacyPath.msg).toBe("视频正文素材标签请求必须携带单数组 references");

    const audioType = await createJob(projectId, {
      type: "audio",
      expected_output_count: 1,
      parameters: { prompt: "海浪声", model_id: MODEL_ID },
      prompt_doc: { version: 1, segments: [] },
    });
    expect(audioType.code).toBe(400);
    expect(audioType.msg).toBe("正文素材标签暂仅支持图片与视频生成");

    expect(await jobCount(projectId)).toBe(0);
  });

  it("target_node_id + prompt_doc：编译正文与视频文本附件同一最终输入冻结（D5 视频部分）", async () => {
    const projectId = (await projects.create("987654", "IKFA1O doc with target")).id;
    const a = await createAsset(projectId, "ta", "image");
    const nodes = [
      { id: "draft-1", type: "mediaNode", position: { x: 0, y: 0 }, data: { mediaType: "video" } },
      { id: "text-1", type: "textNode", position: { x: 0, y: 0 }, data: { title: "运镜", text: "运镜：缓慢推进" } },
    ];
    const edges = [{ id: "e1", source: "text-1", target: "draft-1" }];
    const saved = await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"missing"' },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges), viewport: "{}" }),
    });
    expect(saved.status).toBe(200);
    const references = [{ role: "reference", asset_id: a, type: "image" }];
    const doc = {
      version: 1,
      segments: [
        { kind: "text", text: "让" },
        { kind: "asset_ref", asset_id: a, label: "图片1" },
        { kind: "text", text: "的人物走入镜头" },
      ],
    };
    const created = await createJob(projectId, { ...videoBody(references, doc), target_node_id: "draft-1" });
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.prompt).toBe("让图片1的人物走入镜头");
    expect(job!.input.text_attachments).toEqual([{ node_id: "text-1", title: "运镜", text: "运镜：缓慢推进" }]);
    expect(job!.input.references).toEqual(references);
  });

  it("无 prompt_doc 的旧视频请求：input 无该字段，prompt 原样冻结（E5 兼容）", async () => {
    const projectId = (await projects.create("987654", "IKFA1O legacy")).id;
    const created = await createJob(projectId, videoBody(undefined, undefined));
    expect(created.code).toBe(200);
    const job = await readJob(created.data.generation_job_id);
    expect(job!.input.prompt).toBe("让图片1的人物走出画面");
    expect(job!.input).not.toHaveProperty("prompt_doc");
  });

  it("接纳后改文字/删素材，重试仍消费原冻结快照（D3）", async () => {
    const projectId = (await projects.create("987654", "IKFA1O retry snapshot")).id;
    const a = await createAsset(projectId, "ra", "image");
    const references = [{ role: "reference", asset_id: a, type: "image" }];
    const doc = {
      version: 1,
      segments: [
        { kind: "text", text: "让" },
        { kind: "asset_ref", asset_id: a, label: "图片1" },
        { kind: "text", text: "起舞" },
      ],
    };
    const first = await createJob(projectId, videoBody(references, doc));
    expect(first.code).toBe(200);
    const originalJobId = first.data.generation_job_id as string;
    await prisma.client.assets.delete({ where: { id: BigInt(a) } });
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
      headers: { "content-type": "application/json", "idempotency-key": "ikfa1o-retry-1" },
      body: JSON.stringify({}),
    })).json();
    expect(retried.code).toBe(200);
    const original = await readJob(originalJobId);
    const retry = await readJob(retried.data.generation_job_id);
    expect(retry!.input).toEqual(original!.input);
    expect(retry!.input.prompt).toBe("让图片1起舞");
    expect(retry!.input.prompt_doc).toEqual(doc);
  });

  // 浏览器段（验收链路）：真实浏览器 + 真实业务 API + 隔离 MySQL + 记录式视频供应商。
  // 覆盖：all 模式混合媒体（图/视频/音频）@ 插入与编译 → worker 供应商正文/媒体角色 → 重试冻结；
  // keyframe 首尾帧角色标签；参考删除失效 → 画布重连恢复（恢复后仍验证身份）。
  it.runIf(process.env.IKFA1O_BROWSER)("browser: @ 多媒体插入 → API → DB → worker 供应商 → 恢复 → 重试冻结", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFA1O browser")).id;
    const img = await createAsset(projectId, "role", "image");
    const vid = await createAsset(projectId, "clip", "video");
    const aud = await createAsset(projectId, "vo", "audio");
    const mediaBase = "https://example.com";
    const nodes = [
      { id: "draft-1", type: "mediaNode", position: { x: 900, y: 120 }, data: { mediaType: "video", fileName: "视频草稿", draft: true, genStatus: "draft", prompt: "", draftMode: "all" } },
      { id: "ref-img", type: "mediaNode", position: { x: 140, y: 60 }, data: { mediaType: "image", fileName: "角色图", assetId: img, width: 1024, height: 1024 } },
      { id: "ref-vid", type: "mediaNode", position: { x: 140, y: 260 }, data: { mediaType: "video", fileName: "片段视频", assetId: vid } },
      { id: "ref-aud", type: "mediaNode", position: { x: 140, y: 460 }, data: { mediaType: "audio", fileName: "旁白音频", assetId: aud } },
    ];
    const edges = [
      { id: "e1", source: "ref-img", target: "draft-1" },
      { id: "e2", source: "ref-vid", target: "draft-1" },
      { id: "e3", source: "ref-aud", target: "draft-1" },
    ];
    const seeded = await (await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"missing"' },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges), viewport: JSON.stringify({ x: 0, y: 0, zoom: 1 }) }),
    })).status;
    expect(seeded).toBe(200);

    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
      const draft = page.locator('.react-flow__node-mediaNode[data-id="draft-1"]');
      await draft.waitFor();

      // 打开视频面板：@ 菜单列出图片/视频/音频（同类型编号）
      await draft.locator('[data-testid="media-content"]').click();
      const editor = page.locator('[contenteditable="true"]');
      await editor.click();
      await page.keyboard.type("综合");
      await page.keyboard.type("@");
      await page.locator('[data-testid="mention-menu"]').waitFor();
      const items = page.locator('[data-testid="mention-ref-item"]');
      expect(await items.count()).toBe(3);
      expect(await items.nth(0).innerText()).toContain("图片1");
      expect(await items.nth(1).innerText()).toContain("视频1");
      expect(await items.nth(2).innerText()).toContain("音频1");
      await items.nth(0).click();
      await page.keyboard.type("的人物，运镜参考");
      await page.keyboard.type("@");
      await page.locator('[data-testid="mention-menu"]').waitFor();
      await page.locator('[data-testid="mention-ref-item"]').nth(1).click();
      expect(generationRequests).toEqual([]);

      await page.locator('[data-testid="video-send"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      const body = generationRequests[0];
      expect(body.target_node_id).toBe("draft-1");
      expect((body.parameters as Record<string, unknown>).prompt).toBe("综合图片1的人物，运镜参考视频1");
      expect(body.prompt_doc).toMatchObject({ version: 1 });
      expect(body.references).toEqual([
        { role: "reference", type: "image", asset_id: img },
        { role: "reference", type: "video", asset_id: vid },
        { role: "reference", type: "audio", asset_id: aud },
      ]);
      await vi.waitFor(async () => expect(await jobCount(projectId)).toBe(1), { timeout: 10_000 });
      const jobRow = await prisma.client.generation_jobs.findFirst({
        where: { project_id: BigInt(projectId) }, orderBy: { id: "asc" },
      });
      const frozen = jobRow!.input as Record<string, unknown>;
      expect(frozen.prompt).toBe("综合图片1的人物，运镜参考视频1");
      expect(frozen.prompt_doc).toEqual(body.prompt_doc);

      // 记录式视频供应商：断言提交的最终正文与跨类型媒体输入
      const providerSubmits: Array<{ prompt: string; references: unknown[]; firstFrameImage?: string; lastFrameImage?: string }> = [];
      let submitCount = 0;
      const provider: VideoTaskProvider = {
        submit: async (input) => {
          providerSubmits.push(structuredClone(input));
          submitCount += 1;
          if (submitCount === 1) throw new Error("记录供应商首次拒绝请求");
          return { taskId: `ikfa1o-${submitCount}`, status: "queued" };
        },
        poll: async () => ({ status: "succeeded", progress: 100, url: `${mediaBase}/ikfa1o-result.mp4`, error: null }),
      };
      const firstJobId = jobRow!.id.toString();
      const workerArgs = {
        jobId: firstJobId, repo: createWorkerRepo(prisma.client), workerId: "ikfa1o-browser-worker",
        credentialVault: { open: (value: string) => value },
        createProvider: () => provider,
        mediaRelay: { persist: async (url: string) => ({ url, storageKey: null, mime: "video/mp4", size: 2048 }) },
      } as const;
      // 参考删除 → 正文标签失效（保留原指向，B1/C4）；画布重连同身份 → 自动恢复（B4）。
      // 任务在途（面板只读），参考增删经画布 API 模拟；每次变化后 reload 重开面板核对标签。
      async function reopenPanel() {
        await page.reload();
        await draft.waitFor();
        await draft.locator('[data-testid="media-content"]').click();
        await page.locator('[contenteditable="true"]').waitFor();
      }
      async function putCanvas(nextEdges: unknown[]) {
        const row = await prisma.client.canvas.findFirst({ where: { project_id: BigInt(projectId) } });
        await (await fetch(`${base}/api/canvases/${projectId}`, {
          method: "PUT",
          headers: { "content-type": "application/json", "if-match": `"${row!.version}"` },
          body: JSON.stringify({ nodes: JSON.stringify(row!.nodes_json), edges: JSON.stringify(nextEdges), viewport: "{}" }),
        })).json();
      }
      const currentEdges = async () => (await prisma.client.canvas.findFirst({ where: { project_id: BigInt(projectId) } }))!.edges_json as typeof edges;
      // 断开图片参考连线（等效移除附件）
      await putCanvas((await currentEdges()).filter((e) => e.id !== "e1"));
      await reopenPanel();
      await page.locator('[data-testid="asset-ref-invalid"]').first().waitFor();
      expect(await page.locator('[data-testid="asset-ref-invalid"]').first().innerText()).toContain("已失效：原图片1");
      // 画布重连同身份（模拟用户重新连线）：刷新重开后标签恢复当前编号
      await putCanvas([...(await currentEdges()), { id: "e1-again", source: "ref-img", target: "draft-1" }]);
      await reopenPanel();
      await page.locator('[data-testid="asset-ref-valid"]').first().waitFor();
      expect(await page.locator('[data-testid="asset-ref-valid"]').first().innerText()).toContain("图片1");
      // 关闭面板：后续任务失败态的卡片带重试按钮，避免误触
      await page.locator('button[title="关闭"]').first().click();

      // worker 消费首任务：首次供应商拒绝形成真实失败
      await vi.waitFor(async () => expect(await runVideoJobStep(workerArgs)).toBe(firstJobId), { timeout: 15_000 });
      await vi.waitFor(async () => expect((await readJob(firstJobId))!.status).toBe("failed"), { timeout: 5_000 });
      expect(providerSubmits).toHaveLength(1);
      expect(providerSubmits[0].prompt).toBe("综合图片1的人物，运镜参考视频1");
      // 未被正文提及的音频仍随 references 提交（既有输入语义）
      expect(providerSubmits[0].references.map((r) => (r as { type: string }).type)).toEqual(["image", "video", "audio"]);

      // 重试消费原冻结快照（正文与媒体输入不变）
      const retryResponse = await page.request.post(`${base}/api/projects/${projectId}/generation-jobs/${firstJobId}/retry`, {
        headers: { "idempotency-key": `ikfa1o-browser-retry-${firstJobId}` }, data: {},
      });
      const retried = await retryResponse.json();
      expect(retried.code).toBe(200);
      const retryJobId = String(retried.data.generation_job_id);
      expect((await readJob(retryJobId))!.input).toEqual(frozen);
      const retryWorkerArgs = { ...workerArgs, jobId: retryJobId };
      for (let i = 0; i < 6 && (await readJob(retryJobId))!.status !== "succeeded"; i += 1) {
        await vi.waitFor(async () => expect(await runVideoJobStep(retryWorkerArgs)).toBe(retryJobId), { timeout: 15_000 });
      }
      expect((await readJob(retryJobId))!.status).toBe("succeeded");
      expect(providerSubmits).toHaveLength(2);
      expect(providerSubmits[1]).toEqual(providerSubmits[0]);
      await page.screenshot({ path: "/tmp/ikfa1o-browser.png", fullPage: true });
    } finally { await browser.close(); await vite.close(); }
  }, 120_000);

  // keyframe 首尾帧：角色标签插入与最终请求的角色对应（C1）
  it.runIf(process.env.IKFA1O_BROWSER)("browser: keyframe 首尾帧角色标签 → 请求与供应商角色一致", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const projectId = (await projects.create("987654", "IKFA1O keyframe browser")).id;
    const f1 = await createAsset(projectId, "kfirst", "image");
    const f2 = await createAsset(projectId, "klast", "image");
    const nodes = [
      { id: "draft-1", type: "mediaNode", position: { x: 900, y: 120 }, data: { mediaType: "video", fileName: "帧草稿", draft: true, genStatus: "draft", prompt: "", draftMode: "keyframe" } },
      { id: "ref-f1", type: "mediaNode", position: { x: 140, y: 60 }, data: { mediaType: "image", fileName: "首帧图", assetId: f1, width: 1024, height: 1024 } },
      { id: "ref-f2", type: "mediaNode", position: { x: 140, y: 260 }, data: { mediaType: "image", fileName: "尾帧图", assetId: f2, width: 1024, height: 1024 } },
    ];
    const edges = [
      { id: "e1", source: "ref-f1", target: "draft-1", data: { refRole: "first" } },
      { id: "e2", source: "ref-f2", target: "draft-1", data: { refRole: "last" } },
    ];
    const seeded = await (await fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": '"missing"' },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges), viewport: JSON.stringify({ x: 0, y: 0, zoom: 1 }) }),
    })).status;
    expect(seeded).toBe(200);

    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
      const draft = page.locator('.react-flow__node-mediaNode[data-id="draft-1"]');
      await draft.waitFor();
      await draft.locator('[data-testid="media-content"]').click();
      const editor = page.locator('[contenteditable="true"]');
      await editor.click();
      await page.keyboard.type("从");
      await page.keyboard.type("@");
      await page.locator('[data-testid="mention-menu"]').waitFor();
      const items = page.locator('[data-testid="mention-ref-item"]');
      expect(await items.count()).toBe(2);
      expect(await items.nth(0).innerText()).toContain("首帧");
      expect(await items.nth(1).innerText()).toContain("尾帧");
      await items.nth(0).click();
      await page.keyboard.type("过渡到");
      await page.keyboard.type("@");
      await page.locator('[data-testid="mention-menu"]').waitFor();
      await page.locator('[data-testid="mention-ref-item"]').nth(1).click();

      await page.locator('[data-testid="video-send"]').click();
      await vi.waitFor(() => expect(generationRequests).toHaveLength(1), { timeout: 10_000 });
      const body = generationRequests[0]!;
      expect((body.parameters as Record<string, unknown>).prompt).toBe("从首帧过渡到尾帧");
      expect(body.references).toEqual([
        { role: "first_frame", type: "image", asset_id: f1 },
        { role: "last_frame", type: "image", asset_id: f2 },
      ]);
      await vi.waitFor(async () => expect(await jobCount(projectId)).toBe(1), { timeout: 10_000 });
      const jobRow = await prisma.client.generation_jobs.findFirst({
        where: { project_id: BigInt(projectId) }, orderBy: { id: "asc" },
      });
      const frozen = jobRow!.input as Record<string, unknown>;
      expect(frozen.prompt).toBe("从首帧过渡到尾帧");

      const providerSubmits: Array<{ prompt: string; firstFrameImage?: string; lastFrameImage?: string; references: unknown[] }> = [];
      const provider: VideoTaskProvider = {
        submit: async (input) => {
          providerSubmits.push(structuredClone(input));
          return { taskId: `ikfa1o-kf-${providerSubmits.length}`, status: "queued" };
        },
        poll: async () => ({ status: "succeeded", progress: 100, url: "https://example.com/ikfa1o-kf.mp4", error: null }),
      };
      const jobId = jobRow!.id.toString();
      const stepArgs = {
        jobId, repo: createWorkerRepo(prisma.client), workerId: "ikfa1o-kf-worker",
        credentialVault: { open: (value: string) => value },
        createProvider: () => provider,
        mediaRelay: { persist: async (url: string) => ({ url, storageKey: null, mime: "video/mp4", size: 2048 }) },
      } as const;
      // 视频 worker 为 submit/poll 两步：循环 step 至终态
      for (let i = 0; i < 6 && (await readJob(jobId))!.status !== "succeeded"; i += 1) {
        await vi.waitFor(async () => expect(await runVideoJobStep(stepArgs)).toBe(jobId), { timeout: 15_000 });
      }
      expect((await readJob(jobId))!.status).toBe("succeeded");
      expect(providerSubmits).toHaveLength(1);
      expect(providerSubmits[0].prompt).toBe("从首帧过渡到尾帧");
      // 单数组 references 语义：帧带 role 并入 references（帧身份与正文标签一致）
      const submittedRefs = providerSubmits[0].references as Array<{ url: string; role?: string }>;
      expect(submittedRefs.find((r) => r.role === "first_frame")?.url).toContain("kfirst");
      expect(submittedRefs.find((r) => r.role === "last_frame")?.url).toContain("klast");
    } finally { await browser.close(); await vite.close(); }
  }, 120_000);
});
