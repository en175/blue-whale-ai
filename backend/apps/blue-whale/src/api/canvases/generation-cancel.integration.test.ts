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

import { createWorkerRepo } from "@lib/shared/persistence/index.js";
import { openGenerationCredential } from "@blue-whale/core";
import { ERROR_UNSUPPORTED_INPUT } from "@blue-whale/contracts";
import { processImageJobById, processAudioJobById, type WorkerDeps } from "@lib/shared/generation/worker/generation-worker.js";
import { ImageProviderError, type GenerateImageInput } from "@lib/shared/generation/worker/image-provider.js";
import { runVideoJobStep } from "@lib/shared/generation-runtime/video-job-runner.js";
import { createPassthroughVideoMediaRelay } from "@lib/shared/generation-runtime/tos-video-media-relay.js";

// IKDMQW「取消、删除与任务完成竞态」公开接口集成（契约沿用 IKDMQQ~IKDMQV）：
// 图片取消直接收敛 cancelled 并撤销写入权；视频/音频保留软取消。非本次取消形成的终态拒绝取消（100301）；
// 前端删除/取消流程的权威核对依赖 GET /api/jobs/:id 反映落库终态。
// 真 NestFactory 挂载生产控制器 + 隔离 MySQL（IKDMQW_DATABASE_URL 门控）。
// 浏览器段（IKDMQW_BROWSER=1）覆盖三类媒体的取消回待生成、删除先取消、取消失败保留与抢先成功竞态。
describe.skipIf(!process.env.IKDMQW_DATABASE_URL)("Generation cancel & delete race public API (IKDMQW)", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const IMAGE_MODEL = "ikdmqw-image-model";
  const VIDEO_MODEL = "ikdmqw-video-model";
  const AUDIO_MODEL = "ikdmqw-audio-model";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  const previousDatabase = process.env.DATABASE_URL;
  const previousSecret = process.env.GENERATION_CREDENTIAL_SECRET;
  const credentialSecret = "ikdwl8-isolated-test-credential";
  const providerRequests: GenerateImageInput[] = [];
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.IKDMQW_DATABASE_URL;
    process.env.GENERATION_CREDENTIAL_SECRET = credentialSecret;
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikdmqw-test", model_id: IMAGE_MODEL } },
      create: {
        provider_id: "ikdmqw-test",
        model_id: IMAGE_MODEL,
        capability_type: "image",
        model_label: "IKDMQW Image",
        supported_sizes: [{ id: "1024x1024", label: "1024x1024" }],
        supported_aspect_ratios: ["1:1"],
        supported_formats: ["png"],
        default_size: "1024x1024",
        default_aspect_ratio: "1:1",
        features: {},
      },
      update: { features: {} },
    });
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikdmqw-test", model_id: VIDEO_MODEL } },
      create: {
        provider_id: "ikdmqw-test",
        model_id: VIDEO_MODEL,
        capability_type: "video",
        model_label: "IKDMQW Video",
        supported_sizes: [{ id: "720p", label: "720p" }],
        supported_aspect_ratios: ["16:9"],
        supported_formats: ["mp4"],
        default_size: "720p",
        default_aspect_ratio: "16:9",
        default_duration: 5,
        supported_durations: { min: 4, max: 12, step: 1 },
        features: { reference_image: true, max_reference_images: 10, first_frame: true, last_frame: true, first_last_frame: true },
      },
      update: { features: { reference_image: true, max_reference_images: 10, first_frame: true, last_frame: true, first_last_frame: true } },
    });
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikdmqw-test", model_id: AUDIO_MODEL } },
      create: {
        provider_id: "ikdmqw-test",
        model_id: AUDIO_MODEL,
        capability_type: "audio",
        model_label: "IKDMQW Audio",
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
    if (previousSecret === undefined) delete process.env.GENERATION_CREDENTIAL_SECRET;
    else process.env.GENERATION_CREDENTIAL_SECRET = previousSecret;
    await prisma.client.$disconnect();
  });

  function mediaDraftNode(id: string, type: "image" | "video" | "audio", prompt = "") {
    const fileName = type === "video" ? "视频草稿" : type === "audio" ? "音频草稿" : "图片草稿";
    return {
      id,
      type: "mediaNode",
      position: { x: 420, y: 160 },
      data: {
        src: "",
        mediaType: type,
        fileName,
        genStatus: "draft",
        draft: true,
        prompt,
        ...(type === "image"
          ? { draftModelId: IMAGE_MODEL, draftSize: "1024x1024", draftRatio: "1:1", targetRatio: "1:1" }
          : type === "video"
            ? { draftModelId: VIDEO_MODEL, draftSize: "720p", draftRatio: "16:9", draftDuration: 5 }
            : { draftModelId: AUDIO_MODEL }),
      },
    };
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
      headers: { "content-type": "application/json", authorization: "Bearer sk-ikdwl8-test" },
      body: JSON.stringify(body),
    });
    return response.json();
  }
  async function cancelJob(projectId: string, jobId: string) {
    const response = await fetch(`${base}/api/projects/${projectId}/generation-jobs/${jobId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    return response.json();
  }
  async function getJobDetail(jobId: string) {
    const response = await fetch(`${base}/api/jobs/${jobId}`);
    return response.json();
  }
  async function readJobRow(jobId: string) {
    return prisma.client.generation_jobs.findUnique({ where: { id: BigInt(jobId) } });
  }
  /** 仅供应商端口可控；认领、快照解析、素材、输出槽和终态全部走生产 Worker/仓储。 */
  async function executeWorker(jobId: string, outcome: "succeeded" | "failed" | "cancelled", assetUrl?: string, beforeResult?: () => Promise<void>, expectedStatus = outcome) {
    const row = (await readJobRow(jobId))!;
    if (outcome === "cancelled" && !row.cancel_requested_at) {
      expect((await cancelJob(String(row.project_id), jobId)).code).toBe(200);
    }
    const repo = createWorkerRepo(prisma.client);
    const credentialVault = { open: (cipher: string) => openGenerationCredential(cipher, credentialSecret) };
    const deps: WorkerDeps = {
      repo, workerId: "ikdwl8-integration", credentialVault,
      createImageProvider: (token) => {
        expect(token).toBe("sk-ikdwl8-test");
        return { generate: async (input) => {
          providerRequests.push(input);
          await beforeResult?.();
          if (outcome === "cancelled") throw new Error("取消任务不应派发供应商");
          if (outcome === "failed") throw new ImageProviderError(ERROR_UNSUPPORTED_INPUT, "供应商拒绝输入");
          return [{ url: assetUrl ?? `https://example.com/ikdwl8-${jobId}.png`, width: 1024, height: 1024 }];
        } };
      },
      createAudioProvider: () => ({ generate: async () => { throw new Error("取消任务不应派发供应商"); } }),
    };
    await vi.waitFor(async () => {
      const current = (await readJobRow(jobId))!;
      if (current.next_action_at) expect(current.next_action_at.getTime()).toBeLessThanOrEqual(Date.now());
    }, { timeout: 2_000 });
    if (row.type === "video") {
      await runVideoJobStep({ repo, workerId: deps.workerId, jobId, credentialVault,
        createProvider: () => ({
          submit: async () => { throw new Error("取消任务不应派发供应商"); },
          poll: async () => { throw new Error("取消任务不应轮询供应商"); },
        }), mediaRelay: createPassthroughVideoMediaRelay(),
      });
    } else if (row.type === "audio") await processAudioJobById(jobId, deps);
    else await processImageJobById(jobId, deps);
    expect((await getJobDetail(jobId)).data.status).toBe(expectedStatus);
  }

  it("图片取消：200 登记 cancel_requested_at 并收敛终态，重复取消幂等", async () => {
    const projectId = (await projects.create("987654", "IKDMQW soft cancel")).id;
    expect(
      (await saveCanvas(projectId, [mediaDraftNode("d1", "image", "暮色")], [], "missing")).status,
    ).toBe(200);
    const created = await createJob(projectId, {
      type: "image",
      target_node_id: "d1",
      expected_output_count: 1,
      parameters: { prompt: "暮色", model_id: IMAGE_MODEL, aspect_ratio: "1:1" },
    });
    expect(created.code).toBe(200);
    const jobId = created.data.generation_job_id as string;

    // queued 态可取消：登记成功且落库
    const first = await cancelJob(projectId, jobId);
    expect(first.code).toBe(200);
    const row = await readJobRow(jobId);
    expect(row!.cancel_requested_at).not.toBeNull();

    // 重复已确认取消：幂等 200
    const second = await cancelJob(projectId, jobId);
    expect(second.code).toBe(200);
  });

  it("成功/失败终态拒绝取消，已确认图片取消可幂等重放", async () => {
    const projectId = (await projects.create("987654", "IKDMQW terminal reject")).id;
    expect(
      (await saveCanvas(projectId, [mediaDraftNode("d1", "image", "暮色")], [], "missing")).status,
    ).toBe(200);
    for (const terminal of ["succeeded", "failed", "cancelled"] as const) {
      const created = await createJob(projectId, {
        type: "image",
        target_node_id: "d1",
        expected_output_count: 1,
        parameters: { prompt: `暮色-${terminal}`, model_id: IMAGE_MODEL, aspect_ratio: "1:1" },
      });
      const jobId = created.data.generation_job_id as string;
      await executeWorker(jobId, terminal);
      const result = await cancelJob(projectId, jobId);
      expect(result.code).toBe(terminal === "cancelled" ? 200 : 100301);
      if (terminal !== "cancelled") expect(result.msg).toBe("资源不存在");
    }
    // 不存在的任务同样 100301
    expect((await cancelJob(projectId, "999999999")).code).toBe(100301);
  });

  it.each(["image", "video", "audio"] as const)("%s 排队取消最终收敛，不调用供应商", async (type) => {
    const model = { image: IMAGE_MODEL, video: VIDEO_MODEL, audio: AUDIO_MODEL }[type];
    const projectId = (await projects.create("987654", "IKDWL8 authority")).id;
    expect((await saveCanvas(projectId, [mediaDraftNode("d1", type, "暮色")], [], "missing")).status).toBe(200);
    const created = await createJob(projectId, {
      type, target_node_id: "d1", expected_output_count: 1,
      parameters: { prompt: "暮色", model_id: model,
        ...(type === "video" ? { size: "720p", aspect_ratio: "16:9", duration: 5 } : type === "image" ? { aspect_ratio: "1:1" } : {}),
      },
    });
    expect(created.code).toBe(200);
    const jobId = created.data.generation_job_id as string;
    expect((await cancelJob(projectId, jobId)).code).toBe(200);
    expect((await getJobDetail(jobId)).data.status).toBe(type === "image" ? "cancelled" : "queued");
    const callsBefore = providerRequests.length;
    await executeWorker(jobId, "cancelled");
    expect(providerRequests).toHaveLength(callsBefore);
    expect(await prisma.client.assets.count({ where: { generation_job_id: BigInt(jobId) } })).toBe(0);
  });

  it.each(["succeeded", "failed"] as const)("图片在途取消撤销写入权，拒绝供应商迟到的 %s", async (outcome) => {
    const projectId = (await projects.create("987654", "IKDWL8 in-flight")).id;
    expect((await saveCanvas(projectId, [mediaDraftNode("d1", "image", "冻结的提示词")], [], "missing")).status).toBe(200);
    const created = await createJob(projectId, {
      type: "image", target_node_id: "d1", expected_output_count: 1,
      parameters: { prompt: "冻结的提示词", model_id: IMAGE_MODEL, aspect_ratio: "1:1" },
    });
    expect(created.code).toBe(200);
    const jobId = created.data.generation_job_id as string;
    await executeWorker(jobId, outcome, undefined, async () => {
      expect((await getJobDetail(jobId)).data.status).toBe("processing");
      expect((await cancelJob(projectId, jobId)).code).toBe(200);
      expect((await getJobDetail(jobId)).data.status).toBe("cancelled");
      const canvas = await getCanvas(projectId);
      expect((await saveCanvas(projectId, [mediaDraftNode("d1", "image", "之后编辑")], [], canvas.version)).status).toBe(200);
    }, "cancelled");
    expect(providerRequests.at(-1)?.prompt).toBe("冻结的提示词");
    const slots = await prisma.client.generation_output_slots.findMany({ where: { generation_job_id: BigInt(jobId) } });
    expect(slots).toHaveLength(1);
    expect(slots[0].status).toBe("failed");
    expect(await prisma.client.assets.count({ where: { generation_job_id: BigInt(jobId) } })).toBe(0);
  });

  it.runIf(process.env.IKDMQW_BROWSER)("browser: 三类媒体取消回待生成、删除先取消、取消失败保留与抢先成功竞态", async () => {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    // 无 RocketMQ：切 BullMQ 入队（本机 Redis），任务停留 queued 等待 worker——卡片稳定「生成中」，
    // 真实 Worker 按 jobId 消费；仅供应商端口控制执行结果。
    const previousDriver = process.env.VIDEO_QUEUE_DRIVER;
    process.env.VIDEO_QUEUE_DRIVER = "bullmq";
    const projectId = (await projects.create("987654", "IKDMQW browser")).id;
    expect(
      (await saveCanvas(projectId, [{ id: "t1", type: "textNode", position: { x: 560, y: 80 }, data: { title: "雨夜", text: "赛博朋克" } }], [], "missing")).status,
    ).toBe(200);

    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ extraHTTPHeaders: { Authorization: "Bearer sk-ikdwl8-test" }, viewport: { width: 1440, height: 1000 } });
      const cancelRequests: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && /\/generation-jobs\/\d+\/cancel$/.test(request.url())) {
          cancelRequests.push(request.url());
        }
      });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      const mediaNodes = page.locator(".react-flow__node-mediaNode");
      const nodeById = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
      await nodeById("t1").waitFor({ timeout: 15_000 });

      const jobRows = async (type?: "image" | "video" | "audio") =>
        prisma.client.generation_jobs.findMany({
          where: { project_id: BigInt(projectId), ...(type ? { type } : {}) },
          orderBy: { id: "asc" },
        });
      const lastJobId = async (type: "image" | "video" | "audio") =>
        String((await jobRows(type)).at(-1)!.id);

      // ── 图片链 ─────────────────────────────────────────────
      // 1) 建草稿 + 文本附件连线 → 提交 → 生成中
      await page.locator('button[aria-label="图片对话"]').click();
      const draft = page.locator(".react-flow__node-mediaNode", { hasText: "待生成" });
      const draftId = (await draft.getAttribute("data-id"))!;
      await page.locator("textarea").waitFor();
      await page.getByText("IKDMQW Image").waitFor();
      await page.locator("textarea").fill("画一只蓝鲸");
      const srcHandle = page.locator('.react-flow__node[data-id="t1"] .react-flow__handle-right');
      const dstHandle = page.locator(`.react-flow__node[data-id="${draftId}"] .react-flow__handle-left`);
      const sb = (await srcHandle.boundingBox())!;
      const db = (await dstHandle.boundingBox())!;
      await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
      await page.mouse.down();
      await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2, { steps: 12 });
      await page.mouse.up();
      await page.getByText("文本附件（1）").waitFor();
      await page.locator('button[title="发送"]').click();
      await vi.waitFor(async () => expect((await jobRows()).length).toBe(1), { timeout: 10_000 });
      const imgCard = nodeById(draftId);
      await imgCard.getByRole("button", { name: "取消生成" }).waitFor({ timeout: 15_000 });

      // 2) 图片取消事务撤销写入权：权威 cancelled 后回草稿，刷新保留参数与连线。
      await imgCard.getByRole("button", { name: "取消生成" }).click();
      await vi.waitFor(() => expect(cancelRequests).toHaveLength(1), { timeout: 10_000 });
      await vi.waitFor(async () => expect((await getJobDetail(await lastJobId("image"))).data.status).toBe("cancelled"));
      await executeWorker(await lastJobId("image"), "cancelled");
      await vi.waitFor(async () => {
        const doc = await getCanvas(projectId);
        const nodes = JSON.parse(doc.nodes) as Array<{ id: string; data: Record<string, unknown> }>;
        const saved = nodes.find((n) => n.id === draftId);
        expect(saved?.data.genStatus, "取消回待生成随画布落盘").toBe("draft");
        expect(saved?.data.prompt).toBe("画一只蓝鲸");
      }, { timeout: 10_000 });
      await page.reload();
      await nodeById("t1").waitFor({ timeout: 15_000 });
      await vi.waitFor(async () => expect(await nodeById(draftId).innerText()).toContain("待生成"));
      // 连线恢复（取消不清输入关系）
      await vi.waitFor(async () => expect(await page.locator(".react-flow__edge").count()).toBe(1));
      // 草稿可继续编辑：点击卡片打开面板，提示词还在
      await nodeById(draftId).locator('[data-testid="media-content"]').click();
      await page.locator("textarea").waitFor();
      await vi.waitFor(async () => expect(await page.locator("textarea").inputValue()).toBe("画一只蓝鲸"));

      // 3) 删除抢先成功：任务先成功（终态，取消必失败）→ 停止删除保留作品，再删一次才移除
      await page.keyboard.press("Escape");
      await page.locator('button[title="发送"]').click();
      await vi.waitFor(async () => expect((await jobRows()).length).toBe(2), { timeout: 10_000 });
      await imgCard.getByRole("button", { name: "取消生成" }).waitFor({ timeout: 15_000 });
      await executeWorker(await lastJobId("image"), "succeeded", "https://example.com/ikdmqw-race.png");
      expect(providerRequests.at(-1)?.prompt).toContain("赛博朋克");
      expect(providerRequests.at(-1)?.prompt).toContain("画一只蓝鲸");
      await imgCard.locator('[data-testid="media-content"]').click();
      await page.keyboard.press("Delete");
      await vi.waitFor(() => expect(cancelRequests).toHaveLength(2), { timeout: 10_000 });
      await vi.waitFor(async () => expect(await page.getByText("任务已完成").count()).toBeGreaterThan(0), { timeout: 10_000 });
      await imgCard.locator("img").waitFor({ timeout: 15_000 });
      expect(await mediaNodes.count(), "抢先成功保留作品卡").toBe(1);
      // 用户仍需删除时再操作一次：非生成中直接移除
      await imgCard.locator('[data-testid="media-content"]').click();
      await page.keyboard.press("Delete");
      await vi.waitFor(async () =>
        expect(await page.locator(".react-flow__node-mediaNode").count()).toBe(0), { timeout: 10_000 });

      // 4) 删除取消失败：任务已失败 → 卡片保留并提示原因（仍可查看任务）
      await page.locator('button[aria-label="图片对话"]').click();
      const failDraft = page.locator(".react-flow__node-mediaNode", { hasText: "待生成" });
      const failDraftId = (await failDraft.getAttribute("data-id"))!;
      await page.locator("textarea").waitFor();
      await page.locator("textarea").fill("删除失败场景");
      await page.locator('button[title="发送"]').click();
      await vi.waitFor(async () => expect((await jobRows()).length).toBe(3), { timeout: 10_000 });
      const failCard = nodeById(failDraftId);
      await failCard.getByRole("button", { name: "取消生成" }).waitFor({ timeout: 15_000 });
      await executeWorker(await lastJobId("image"), "failed");
      await failCard.locator('[data-testid="media-content"]').click();
      await page.keyboard.press("Delete");
      await vi.waitFor(() => expect(cancelRequests).toHaveLength(3), { timeout: 10_000 });
      await vi.waitFor(async () => expect(await page.getByText("取消失败").count()).toBeGreaterThan(0), { timeout: 10_000 });
      expect(await mediaNodes.count(), "取消失败保留卡片").toBe(1);
      await failCard.getByText("输入内容不支持", { exact: true }).waitFor({ timeout: 15_000 });
      // 取消失败保留后用户再删一次：失败卡非生成中 → 直接移除
      await page.keyboard.press("Delete");
      await vi.waitFor(async () =>
        expect(await page.locator(".react-flow__node-mediaNode").count()).toBe(0), { timeout: 10_000 });

      // ── 视频链：普通取消回待生成（参数保留）───────────────
      await page.locator('button[aria-label="视频对话"]').click();
      const videoDraft = page.locator(".react-flow__node-mediaNode", { hasText: "待生成" });
      const videoDraftId = (await videoDraft.getAttribute("data-id"))!;
      const editor = page.locator('[data-testid="chip-editor"] [contenteditable="true"], [contenteditable="true"]').first();
      await editor.waitFor();
      await editor.click();
      await page.keyboard.type("追逐镜头");
      await page.locator('[data-testid="video-send"]').click();
      await vi.waitFor(async () => expect((await jobRows("video")).length).toBe(1), { timeout: 10_000 });
      const videoCard = nodeById(videoDraftId);
      await videoCard.getByRole("button", { name: "取消生成" }).waitFor({ timeout: 15_000 });
      await videoCard.getByRole("button", { name: "取消生成" }).click();
      await vi.waitFor(() => expect(cancelRequests).toHaveLength(4), { timeout: 10_000 });
      expect(await videoCard.innerText()).toContain("视频生成中");
      await vi.waitFor(async () => {
        const saved = JSON.parse((await getCanvas(projectId)).nodes).find((node: { id: string }) => node.id === videoDraftId);
        expect(saved?.data.genStatus).toBe("generating");
        expect(saved?.data.jobId).toBe(await lastJobId("video"));
      }, { timeout: 10_000 });
      await page.reload();
      await videoCard.getByRole("button", { name: "取消生成" }).waitFor({ timeout: 15_000 });
      await executeWorker(await lastJobId("video"), "cancelled");
      await vi.waitFor(async () =>
        expect(await videoCard.innerText()).toContain("视频草稿"), { timeout: 10_000 });
      await vi.waitFor(async () => expect(await videoCard.innerText()).toContain("待生成"), { timeout: 10_000 });

      // ── 音频链：删除生成中卡片 → 先取消确认后移除 ──────────
      await page.locator('button[aria-label="音频生成"]').click();
      // 视频链取消后回待生成的卡仍在画布（正确保留）：音频新建卡取最后出现的一张
      const audioDraft = page.locator(".react-flow__node-mediaNode", { hasText: "待生成" }).last();
      const audioDraftId = (await audioDraft.getAttribute("data-id"))!;
      await page.locator('[data-testid="audio-input"]').waitFor();
      await page.getByText("IKDMQW Audio").waitFor();
      await page.locator('[data-testid="audio-input"]').fill("轻快的海浪声");
      await page.locator('[data-testid="audio-send"]').click();
      await vi.waitFor(async () => expect((await jobRows("audio")).length).toBe(1), { timeout: 10_000 });
      const audioCard = nodeById(audioDraftId);
      await audioCard.getByRole("button", { name: "取消生成" }).waitFor({ timeout: 15_000 });
      await audioCard.locator('[data-testid="media-content"]').click();
      await page.keyboard.press("Delete");
      await vi.waitFor(() => expect(cancelRequests).toHaveLength(5), { timeout: 10_000 });
      // 取消登记（queued 态任务 200）但任务未终态：不抢先移除，等 worker 停止（轮询拿到 cancelled）
      await executeWorker(await lastJobId("audio"), "cancelled");
      await vi.waitFor(async () =>
        expect(await page.locator(".react-flow__node-mediaNode").count()).toBe(1), { timeout: 10_000 });

      await browser.close();
      await vite.close();
    } finally {
      if (previousDriver === undefined) delete process.env.VIDEO_QUEUE_DRIVER;
      else process.env.VIDEO_QUEUE_DRIVER = previousDriver;
      await browser.close().catch(() => {});
      await vite.close().catch(() => {});
    }
  }, 240_000);
});
