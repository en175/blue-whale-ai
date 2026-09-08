import "reflect-metadata";
import { createWorkerRepo } from "@lib/shared/persistence/index.js";
import { openGenerationCredential } from "@blue-whale/core";
import { processAudioJobById, processImageJobById } from "@lib/shared/generation/worker/generation-worker.js";
import { AudioProviderError, type AudioProvider } from "@lib/shared/generation-runtime/audio-provider.js";
import { runVideoJobStep } from "@lib/shared/generation-runtime/video-job-runner.js";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
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
import { AllExceptionsFilter } from "@lib/infra/filters/all-exceptions.filter.js";

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

describe.skipIf(!process.env.IKDUHQ_DATABASE_URL)("Audio regeneration public API (IKDUHQ)", () => {
  const secret = "ikduhq-isolated-test-secret";
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "ikduhq-audio";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  let mediaBase = "";
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZFAAAAAASUVORK5CYII=", "base64");
  let mp3: Buffer;
  let mp4: Buffer;
  const storedMedia = new Map<string, Buffer>();
  const media = createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      storedMedia.set(req.url!, Buffer.concat(chunks));
      res.end();
      return;
    }
    res.setHeader("content-type", req.url?.endsWith(".mp3") ? "audio/mpeg" : req.url?.endsWith(".mp4") ? "video/mp4" : "image/png");
    res.end(storedMedia.get(req.url!) ?? (req.url?.endsWith(".mp4") ? mp4 : png));
  });
  const previousDatabase = process.env.DATABASE_URL;
  beforeAll(async () => {
    mp3 = execFileSync(ffmpeg!, ["-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-f", "mp3", "pipe:1"], { stdio: ["ignore", "pipe", "ignore"] });
    mp4 = execFileSync(ffmpeg!, ["-f", "lavfi", "-i", "color=blue:s=1280x720:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"], { stdio: ["ignore", "pipe", "ignore"] });
    vi.stubEnv("GENERATION_CREDENTIAL_SECRET", secret);
    process.env.DATABASE_URL = process.env.IKDUHQ_DATABASE_URL;
    media.listen(0, "127.0.0.1");
    await once(media, "listening");
    mediaBase = `http://127.0.0.1:${(media.address() as AddressInfo).port}`;
    for (const modelId of [MODEL_ID, "ikduhq-audio-other"]) {
      await prisma.client.generation_model_capability.upsert({
        where: { provider_id_model_id: { provider_id: "ikduhq-test", model_id: modelId } },
        create: { provider_id: "ikduhq-test", model_id: modelId, capability_type: "audio", model_label: modelId,
          supported_sizes: [], supported_aspect_ratios: [], supported_formats: ["mp3"],
          default_size: "mp3", default_aspect_ratio: "1:1", features: {} }, update: {},
      });
    }
    for (const type of ["image", "video"]) {
      await prisma.client.generation_model_capability.upsert({
        where: { provider_id_model_id: { provider_id: "ikduhq-test", model_id: `ikduhq-${type}` } },
        create: { provider_id: "ikduhq-test", model_id: `ikduhq-${type}`, capability_type: type, model_label: `ikduhq-${type}`,
          supported_sizes: [{ id: type === "image" ? "1024x1024" : "720p", label: type === "image" ? "1024x1024" : "720p" }],
          supported_aspect_ratios: ["1:1"], supported_formats: [type === "image" ? "png" : "mp4"],
          default_size: type === "image" ? "1024x1024" : "720p", default_aspect_ratio: "1:1",
          ...(type === "video" ? { default_duration: 5, supported_durations: { min: 4, max: 12, step: 1 } } : {}), features: {} }, update: {},
      });
    }
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
    media.close();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    await prisma.client.$disconnect();
    vi.unstubAllEnvs();
  });

  async function api(path: string, body?: unknown) {
    const response = await fetch(`${base}/api/${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-ikduhq-test" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return response.json();
  }
  async function getCanvas(projectId: string) {
    return (await api(`canvases?projectId=${projectId}`)).data;
  }
  async function saveCanvas(projectId: string, nodes: unknown[], edges: unknown[], version: number | "missing") {
    return fetch(`${base}/api/canvases/${projectId}`, {
      method: "PUT", headers: { "content-type": "application/json", "if-match": `"${version}"` },
      body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: JSON.stringify(edges), viewport: "{}" }),
    });
  }

  async function runAudio(jobId: string, provider: AudioProvider) {
    await vi.waitFor(async () => {
      expect(await processAudioJobById(jobId, { repo: createWorkerRepo(prisma.client), workerId: "ikduhq-worker",
        credentialVault: { open: encrypted => openGenerationCredential(encrypted, secret) },
        createAudioProvider: () => provider,
        createImageProvider: () => { throw new Error("unexpected image job"); },
        mediaStorage: {
          prepareUpload: async () => ({ uploadUrl: `${mediaBase}/${jobId}.mp3`, publicUrl: `${mediaBase}/${jobId}.mp3`,
            storageKey: `${jobId}.mp3`, method: "PUT" as const, headers: {} }),
          makePublic: async () => {},
        },
      })).toBe(jobId);
    }, { timeout: 15_000 });
  }
  async function seedAudio(projectId: string, id = "original-audio", extra = {}) {
    const created = await api(`projects/${projectId}/generation-jobs`, { type: "audio", expected_output_count: 1,
      parameters: { prompt: "A", model_id: MODEL_ID } });
    expect(created.code).toBe(200);
    const jobId = String(created.data.generation_job_id);
    await runAudio(jobId, { generate: async () => ({ url: null, data: mp3, mime: "audio/mpeg", duration: 1 }) });
    const job = (await api(`jobs/${jobId}`)).data;
    expect(job.status).toBe("succeeded");
    return { id, type: "mediaNode", position: { x: 200, y: 100 }, data: {
      jobId, assetId: String(job.asset.id), src: job.asset.url, mediaType: "audio", fileName: id,
      prompt: "A", draftModelId: MODEL_ID, ...extra,
    } };
  }
  async function seedOtherMedia(projectId: string, type: "image" | "video") {
    const created = await api(`projects/${projectId}/generation-jobs`, { type, expected_output_count: 1,
      parameters: { prompt: `${type} A`, model_id: `ikduhq-${type}`, aspect_ratio: "1:1",
        ...(type === "image" ? { size: "1024x1024" } : { resolution: "720p", duration: 5 }) } });
    expect(created.code).toBe(200);
    const jobId = String(created.data.generation_job_id);
    const deps = { repo: createWorkerRepo(prisma.client), workerId: "ikduhq-other-worker",
      credentialVault: { open: (encrypted: string) => openGenerationCredential(encrypted, secret) } };
    if (type === "image") {
      expect(await processImageJobById(jobId, { ...deps,
        createImageProvider: () => ({ generate: async () => [{ url: `${mediaBase}/${jobId}.png`, width: 1024, height: 1024 }] }),
        createAudioProvider: () => { throw new Error("unexpected audio job"); },
      })).toBe(jobId);
    } else {
      const provider = { submit: async () => ({ taskId: jobId, status: "queued" as const }),
        poll: async () => ({ status: "succeeded" as const, progress: 100, url: `${mediaBase}/${jobId}.mp4`, error: null }) };
      for (let step = 0; step < 2; step++) {
        await vi.waitFor(async () => expect(await runVideoJobStep({ ...deps, jobId, createProvider: () => provider,
          mediaRelay: { persist: async url => ({ url, storageKey: null, mime: "video/mp4", size: mp4.length }) },
        })).toBe(jobId), { timeout: 15_000 });
      }
    }
    const job = (await api(`jobs/${jobId}`)).data;
    expect(job.status).toBe("succeeded");
    return { id: `generated-${type}`, type: "mediaNode", position: { x: type === "image" ? 600 : 1000, y: 100 }, data: {
      jobId, assetId: String(job.asset.id), src: job.asset.url, mediaType: type, fileName: type,
      prompt: `${type} A`, draftModelId: `ikduhq-${type}`, draftSize: type === "image" ? "1024x1024" : "720p", draftRatio: "1:1",
      ...(type === "video" ? { draftDuration: 5 } : {}),
    } };
  }
  async function withBrowser(projectId: string, body: (page: import("playwright").Page) => Promise<void>) {
    const { chromium } = await import("playwright");
    const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
    const vite = await createVite({ root: `${process.cwd()}/web`, server: {
      open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
    } });
    await vite.listen();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 },
        extraHTTPHeaders: { authorization: "Bearer sk-ikduhq-test" } });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      try { await body(page); } catch (error) {
        await page.screenshot({ path: `/tmp/ikduhq-failure-${projectId}.png` });
        throw error;
      }
    } finally { await browser.close(); await vite.close(); }
  }
  it.runIf(process.env.IKDUHQ_BROWSER)("browser: unavailable audio model is preserved until explicitly adjusted", async () => {
    const projectId = (await projects.create("987654", "IKDUHQ unavailable")).id;
    const original = await seedAudio(projectId, "original-audio", { draftModelId: "retired-audio-model" });
    expect((await saveCanvas(projectId, [original], [], "missing")).status).toBe(200);
    await withBrowser(projectId, async page => {
      await page.locator('[data-id="original-audio"]').getByTestId("media-title").click();
      await page.getByRole("alert").filter({ hasText: "模型不可用" }).waitFor({ timeout: 10_000 });
      expect(await page.getByTestId("audio-send").isDisabled()).toBe(true);
      expect(JSON.parse((await getCanvas(projectId)).nodes)[0].data).toMatchObject({ draftModelId: "retired-audio-model", prompt: "A" });
      await page.getByRole("button", { name: "选择模型", exact: true }).click();
      await page.getByRole("button", { name: MODEL_ID, exact: true }).click();
      await vi.waitFor(async () => expect(await page.getByTestId("audio-send").isDisabled()).toBe(false));
      await vi.waitFor(async () => expect(JSON.parse((await getCanvas(projectId)).nodes)[0].data.draftModelId).toBe(MODEL_ID));
    });
  }, 60_000);
  it.runIf(process.env.IKDUHQ_BROWSER)("browser: pending save prevents duplicate sends and preserves the submitted edit", async () => {
    const projectId = (await projects.create("987654", "IKDUHQ pending save")).id;
    const original = await seedAudio(projectId);
    expect((await saveCanvas(projectId, [original], [], "missing")).status).toBe(200);
    await withBrowser(projectId, async page => {
      await page.locator('[data-id="original-audio"]').getByTestId("media-title").click();
      await page.getByText("ikduhq-audio", { exact: true }).waitFor();
      const submitted: unknown[] = [];
      page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/generation-jobs")) submitted.push(r.postDataJSON()); });
      let release!: () => void;
      const barrier = new Promise<void>(resolve => { release = resolve; });
      let saving!: () => void;
      const started = new Promise<void>(resolve => { saving = resolve; });
      await page.route("**/api/canvases/*", async route => {
        if (route.request().method() === "PUT") { saving(); await barrier; }
        await route.continue();
      });
      try {
        await page.getByTestId("audio-input").fill("只发送一次");
        await page.getByTestId("audio-send").click();
        await started;
        expect(submitted).toEqual([]);
        expect(await page.getByTestId("audio-send").isDisabled()).toBe(true);
        await page.locator('.react-flow__pane').click({ position: { x: 100, y: 700 } });
        await page.locator('[data-id="original-audio"]').getByTestId("media-title").click();
        await page.getByText("ikduhq-audio", { exact: true }).waitFor();
        expect(await page.getByTestId("audio-send").isDisabled()).toBe(true);
        expect(await page.getByTestId("audio-input").isDisabled()).toBe(true);
      } finally { release(); }
      await page.getByTestId("regen-overlay").waitFor();
      expect(submitted).toHaveLength(1);
      expect(JSON.parse((await getCanvas(projectId)).nodes)[0].data.prompt).toBe("只发送一次");
    });
  }, 60_000);

  it.runIf(process.env.IKDUHQ_BROWSER)("browser: failed audio save protects target, send and project switching until retry", async () => {
    const projectId = (await projects.create("987654", "IKDUHQ save failure")).id;
    const otherId = (await projects.create("987654", "IKDUHQ other project")).id;
    const original = await seedAudio(projectId);
    const other = await seedAudio(projectId, "other-audio"); other.position.x = 800;
    expect((await saveCanvas(projectId, [original, other], [], "missing")).status).toBe(200);
    await withBrowser(projectId, async page => {
      const node = (id: string) => page.locator(`[data-id="${id}"]`).getByTestId("media-title");
      const editor = page.getByTestId("audio-input");
      const submitted: unknown[] = [];
      page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/generation-jobs")) submitted.push(r.postDataJSON()); });
      await node(original.id).click(); await page.getByText(MODEL_ID, { exact: true }).waitFor();
      await page.route("**/api/canvases/*", route => route.request().method() === "PUT"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: 500, msg: "保存故障" }) }) : route.continue());
      await editor.fill("未保存 B");
      await page.getByRole("button", { name: "重试保存" }).waitFor();
      expect(await page.getByTestId("audio-send").isDisabled()).toBe(true);
      await node(other.id).click();
      await page.locator('.react-flow__pane').click({ position: { x: 100, y: 700 } });
      await vi.waitFor(async () => expect(await page.getByTestId("audio-send").count()).toBe(0));
      await node(original.id).click(); expect(await editor.inputValue()).toBe("未保存 B");
      await page.locator("button", { hasText: "IKDUHQ save failure" }).first().click();
      await page.locator('div[class*="projectItem"]', { hasText: "IKDUHQ other project" }).first().click();
      expect(page.url()).toContain(`project=${projectId}`);
      expect(submitted).toEqual([]);
      expect(JSON.parse((await getCanvas(projectId)).nodes)[0].data.prompt).toBe("A");
      await page.unroute("**/api/canvases/*");
      await page.getByRole("button", { name: "重试保存" }).click();
      await page.getByText(/^已保存 /).waitFor();
      await node(other.id).click(); expect(await editor.inputValue()).toBe("A");
      await node(original.id).click(); expect(await editor.inputValue()).toBe("未保存 B");
      expect(await page.getByTestId("audio-send").isDisabled()).toBe(false);
      await page.reload(); await node(original.id).click(); expect(await editor.inputValue()).toBe("未保存 B");
      await page.locator("button", { hasText: "IKDUHQ save failure" }).first().click();
      await page.locator('div[class*="projectItem"]', { hasText: "IKDUHQ other project" }).first().click();
      await page.waitForURL(`**project=${otherId}**`);
    });
  }, 90_000);
  it.runIf(process.env.IKDUHQ_BROWSER).each(["succeeded", "failed", "cancelled"] as const)("browser: %s preserves audio identity, links and latest configuration", async outcome => {
    const projectId = (await projects.create("987654", `IKDUHQ ${outcome}`)).id;
    const original = await seedAudio(projectId);
    const text = { id: "text", type: "textNode", position: { x: 850, y: 100 }, data: { title: "文字", text: "不作为音频参考" } };
    const edges = [{ id: "text-link", source: text.id, target: original.id }];
    expect((await saveCanvas(projectId, [original, text], edges, "missing")).status).toBe(200);
    await withBrowser(projectId, async page => {
      const node = page.locator('[data-id="original-audio"]');
      await node.getByTestId("media-title").click();
      await page.getByRole("button", { name: MODEL_ID, exact: true }).click();
      await page.getByRole("button", { name: "ikduhq-audio-other", exact: true }).click();
      await page.getByTestId("audio-input").fill("最新 B");
      const sent: unknown[] = [];
      page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/generation-jobs")) sent.push(r.postDataJSON()); });
      const response = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/generation-jobs"));
      await page.getByTestId("audio-send").click();
      const accepted = await (await response).json(); expect(accepted.code).toBe(200);
      const jobId = String(accepted.data.generation_job_id);
      expect(sent).toEqual([{ type: "audio", expected_output_count: 1, target_node_id: original.id,
        parameters: { prompt: "最新 B", model_id: "ikduhq-audio-other" } }]);
      await node.getByTestId("regen-overlay").waitFor();
      expect(await node.locator("audio").getAttribute("src")).toBe(original.data.src);
      expect(await page.getByTestId("audio-input").isDisabled()).toBe(true);
      expect(await page.getByTestId("audio-send").isDisabled()).toBe(true);
      await vi.waitFor(async () => expect(JSON.parse((await getCanvas(projectId)).nodes).find((n: { id: string }) => n.id === original.id).data.jobId).toBe(jobId), { timeout: 10_000 });
      await page.reload(); await node.getByTestId("media-title").click();
      await node.getByTestId("regen-overlay").waitFor();
      expect(await node.locator("audio").getAttribute("src")).toBe(original.data.src);
      expect(await page.getByTestId("audio-input").isDisabled()).toBe(true);
      if (outcome === "cancelled") {
        const cancellation = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/cancel"));
        await node.getByTestId("regen-overlay").getByRole("button", { name: "取消", exact: true }).click();
        expect((await (await cancellation).json()).code).toBe(200);
      }
      const requests: unknown[] = [];
      await runAudio(jobId, { generate: async input => {
        requests.push(input);
        if (outcome === "failed") throw new AudioProviderError("provider_timeout", "fixture audio timeout");
        return { url: null, data: mp3, mime: "audio/mpeg", duration: 1 };
      } });
      expect(requests).toEqual(outcome === "cancelled" ? [] : [{ model: "ikduhq-audio-other", prompt: "最新 B" }]);
      const expectedSrc = outcome === "succeeded" ? `${mediaBase}/${jobId}.mp3` : original.data.src;
      await vi.waitFor(async () => {
        const nodes = JSON.parse((await getCanvas(projectId)).nodes);
        expect(nodes).toHaveLength(2);
        const audio = nodes.find((n: { id: string }) => n.id === original.id);
        expect(audio).toMatchObject({ id: original.id, position: original.position,
          data: { src: expectedSrc, prompt: "最新 B", draftModelId: "ikduhq-audio-other" } });
        expect(audio.data.genStatus).toBe(outcome === "failed" ? "failed" : undefined);
      }, { timeout: 15_000 });
      expect(JSON.parse((await getCanvas(projectId)).edges)).toEqual(edges);
      expect((await api(`jobs/${jobId}`)).data.status).toBe(outcome);
      expect((await api(`jobs/${original.data.jobId}`)).data.asset.url).toBe(original.data.src);
      if (outcome === "failed") await node.getByTestId("fail-overlay").filter({ hasText: "生成服务响应超时" }).waitFor();
      await page.reload(); await node.getByTestId("media-title").click();
      expect(await node.locator("audio").getAttribute("src")).toBe(expectedSrc);
      expect(await page.getByTestId("audio-input").inputValue()).toBe("最新 B");
      expect(await page.getByTestId("audio-input").isDisabled()).toBe(false);
      expect(sent).toHaveLength(1);
    });
  }, 90_000);
  it.runIf(process.env.IKDUHQ_BROWSER)("browser: audio Enter and cross-media editing survive hide, multi-select, reload and reopening", async () => {
    const projectId = (await projects.create("987654", "IKDUHQ editing")).id;
    const audio = await seedAudio(projectId);
    const image = await seedOtherMedia(projectId, "image");
    const video = await seedOtherMedia(projectId, "video");
    const asset = await prisma.client.assets.create({ data: { user_id: 987654n, project_id: BigInt(projectId), type: "audio", url: audio.data.src } });
    const upload = { id: "upload", type: "mediaNode", position: { x: 1050, y: 520 }, data: { assetId: String(asset.id), src: asset.url, mediaType: "audio", fileName: "上传音频" } };
    expect((await saveCanvas(projectId, [audio, image, video, upload], [], "missing")).status).toBe(200);
    await withBrowser(projectId, async page => {
      const node = (id: string) => page.locator(`[data-id="${id}"]`).getByTestId("media-title");
      const submitted: unknown[] = [];
      page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/generation-jobs")) submitted.push(r.postDataJSON()); });
      await node(audio.id).click();
      await page.getByRole("button", { name: MODEL_ID, exact: true }).click();
      await page.getByRole("button", { name: "ikduhq-audio-other", exact: true }).click();
      const editor = page.getByTestId("audio-input");
      await editor.fill("B"); await editor.press("End"); await editor.press("Enter"); await editor.press("C");
      await node(image.id).click(); await page.locator("textarea").fill("image B");
      await node(video.id).click(); await page.locator('[contenteditable="true"]').fill("video B");
      await node(audio.id).click(); expect(await editor.inputValue()).toBe("B\nC");
      await page.locator('.react-flow__pane').click({ position: { x: 100, y: 700 } });
      await vi.waitFor(async () => expect(await editor.count()).toBe(0));
      await page.getByText(/^已保存 /).waitFor();
      expect(await editor.count()).toBe(0);
      await node(audio.id).click(); expect(await editor.inputValue()).toBe("B\nC");
      await node(upload.id).click(); await vi.waitFor(async () => expect(await editor.count()).toBe(0));
      await node(audio.id).click(); await node(image.id).click({ modifiers: ["ControlOrMeta"] });
      await vi.waitFor(async () => expect(await page.locator("textarea").count()).toBe(0));
      await page.reload(); await node(audio.id).click(); expect(await editor.inputValue()).toBe("B\nC");
      await page.getByRole("button", { name: "ikduhq-audio-other", exact: true }).waitFor();
      await node(image.id).click(); expect(await page.locator("textarea").inputValue()).toBe("image B");
      await node(video.id).click(); expect(await page.locator('[contenteditable="true"]').innerText()).toBe("video B");
      await page.goto(page.url()); await node(audio.id).click(); expect(await editor.inputValue()).toBe("B\nC");
      expect(submitted).toEqual([]);
      const saved = JSON.parse((await getCanvas(projectId)).nodes);
      expect(saved).toHaveLength(4);
      expect(saved.find((n: { id: string }) => n.id === audio.id).data).toMatchObject({ prompt: "B\nC", draftModelId: "ikduhq-audio-other" });
    });
  }, 90_000);
  it("API: late conditional audio save cannot overwrite newer edits or an accepted input snapshot", async () => {
    const projectId = (await projects.create("987654", "IKDUHQ conditional save")).id;
    const audio = await seedAudio(projectId);
    expect((await saveCanvas(projectId, [audio], [], "missing")).status).toBe(200);
    const version = (await getCanvas(projectId)).version;
    const latest = { ...audio, data: { ...audio.data, prompt: "B", draftModelId: "ikduhq-audio-other" } };
    expect((await saveCanvas(projectId, [latest], [], version)).status).toBe(200);
    expect((await saveCanvas(projectId, [audio], [], version)).status).toBe(412);
    expect(JSON.parse((await getCanvas(projectId)).nodes)[0].data).toMatchObject({ prompt: "B", draftModelId: "ikduhq-audio-other" });
    const accepted = await api(`projects/${projectId}/generation-jobs`, { type: "audio", expected_output_count: 1,
      target_node_id: audio.id, parameters: { prompt: "B", model_id: "ikduhq-audio-other" } });
    expect(accepted.code).toBe(200);
    const before = await getCanvas(projectId);
    const edited = JSON.parse(before.nodes);
    edited[0].data.prompt = "C";
    expect((await saveCanvas(projectId, edited, [], before.version)).status).toBe(200);
    const requests: unknown[] = [];
    await runAudio(String(accepted.data.generation_job_id), { generate: async input => {
      requests.push(input); return { url: null, data: mp3, mime: "audio/mpeg", duration: 1 };
    } });
    expect(requests).toEqual([{ model: "ikduhq-audio-other", prompt: "B" }]);
    expect(JSON.parse((await getCanvas(projectId)).nodes)[0].data.prompt).toBe("C");
    expect((await api(`jobs/${audio.data.jobId}`)).data.asset.url).toBe(audio.data.src);
  }, 30_000);
});
