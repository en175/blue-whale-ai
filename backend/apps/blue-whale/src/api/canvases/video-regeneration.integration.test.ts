import "reflect-metadata";
import { createWorkerRepo } from "@lib/shared/persistence/index.js";
import { processImageJobById } from "@lib/shared/generation/worker/generation-worker.js";
import { runVideoJobStep, type VideoTaskProvider } from "@lib/shared/generation-runtime/video-job-runner.js";
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

describe.skipIf(!process.env.IKDUHP_DATABASE_URL)("Video regeneration public API (IKDUHP)", () => {
  const secret = "ikduhp-isolated-test-secret";
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const MODEL_ID = "doubao-seedance-2-0-ikduhp";
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base = "";
  let mediaBase = "";
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZFAAAAAASUVORK5CYII=", "base64");
  let mp4: Buffer;
  const media = createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    const video = req.url?.endsWith(".mp4");
    res.setHeader("content-type", video ? "video/mp4" : "image/png");
    res.end(video ? mp4 : png);
  });
  const previousDatabase = process.env.DATABASE_URL;
  beforeAll(async () => {
    mp4 = execFileSync(ffmpeg!, ["-f", "lavfi", "-i", "color=blue:s=1280x720:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"], { stdio: ["ignore", "pipe", "ignore"] });
    vi.stubEnv("ROCKETMQ_ENDPOINTS", "");
    process.env.DATABASE_URL = process.env.IKDUHP_DATABASE_URL;
    media.listen(0, "127.0.0.1");
    await once(media, "listening");
    mediaBase = `http://127.0.0.1:${(media.address() as AddressInfo).port}`;
    const sizes = [{ id: "720p", label: "720p", api_value: "720p" }, { id: "1080p", label: "1080p", api_value: "1080p" }];
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikduhp-test", model_id: MODEL_ID } },
      create: {
        provider_id: "ikduhp-test",
        model_id: MODEL_ID,
        capability_type: "video",
        model_label: "IKDUHP Test",
        supported_sizes: sizes,
        supported_aspect_ratios: ["16:9", "9:16"],
        supported_formats: ["mp4"],
        default_size: "720p",
        default_aspect_ratio: "16:9", default_duration: 5, supported_durations: { min: 4, max: 12, step: 1 },
        features: { reference_image: true, max_reference_images: 9, first_frame: true, last_frame: true, first_last_frame: true },
      },
      update: { supported_sizes: sizes, default_size: "720p" },
    });
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikduhp-test", model_id: "ikduhp-image" } },
      create: { provider_id: "ikduhp-test", model_id: "ikduhp-image", model_label: "IKDUHP Image", capability_type: "image",
        supported_sizes: [{ id: "1024x1024", label: "1024x1024" }], supported_aspect_ratios: ["1:1"], supported_formats: ["png"],
        default_size: "1024x1024", default_aspect_ratio: "1:1", features: { reference_image: true, max_reference_images: 9 } },
      update: {},
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
      headers: { "content-type": "application/json", authorization: "Bearer sk-ikduhp-test" },
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

  async function step(jobId: string, provider: VideoTaskProvider) {
    await vi.waitFor(async () => {
      expect(await runVideoJobStep({ jobId, repo: createWorkerRepo(prisma.client), workerId: "ikduhp-worker",
        credentialVault: { open: encrypted => encrypted },
        createProvider: () => provider,
        mediaRelay: { persist: async url => ({ url, storageKey: null, mime: "video/mp4", size: 2048 }) },
      })).toBe(jobId);
    }, { timeout: 15_000 });
  }
  async function seedVideo(projectId: string, id = "original-video", extra = {}) {
    const created = await api(`projects/${projectId}/generation-jobs`, { type: "video", expected_output_count: 1,
      parameters: { prompt: "A", model_id: MODEL_ID, resolution: "720p", aspect_ratio: "16:9", duration: 5 } });
    expect(created.code).toBe(200);
    const jobId = String(created.data.generation_job_id);
    const provider: VideoTaskProvider = {
      submit: async () => ({ taskId: jobId, status: "queued" }),
      poll: async () => ({ status: "succeeded", progress: 100, url: `${mediaBase}/${jobId}.mp4`, error: null }),
    };
    await step(jobId, provider); await step(jobId, provider);
    const job = (await api(`jobs/${jobId}`)).data;
    expect(job.status).toBe("succeeded");
    return { id, type: "mediaNode", position: { x: 200, y: 100 }, data: {
      jobId, assetId: String(job.asset.id), src: job.asset.url, mediaType: "video", fileName: id,
      prompt: "A", draftModelId: MODEL_ID, draftSize: "720p", draftRatio: "16:9", draftDuration: 5, ...extra,
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
        extraHTTPHeaders: { authorization: "Bearer sk-ikduhp-test" } });
      await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
        userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
      } }, version: 0 })));
      await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
      try { await body(page); } catch (error) {
        await page.screenshot({ path: `/tmp/ikduhp-failure-${projectId}.png` });
        throw error;
      }
    } finally { await browser.close(); await vite.close(); }
  }
  it.runIf(process.env.IKDUHP_BROWSER)("browser: unavailable restored model is preserved until explicitly adjusted", async () => {
    const projectId = (await projects.create("987654", "IKDUHP unavailable model")).id;
    const original = await seedVideo(projectId, "original-video", { draftModelId: "retired-video-model", draftDuration: 99 });
    expect((await saveCanvas(projectId, [original], [], "missing")).status).toBe(200);
    await withBrowser(projectId, async page => {
      await page.locator('[data-id="original-video"]').getByTestId("media-title").click();
      await page.getByRole("alert").filter({ hasText: "模型不可用" }).waitFor({ timeout: 10_000 });
      expect(await page.getByTestId("video-send").isDisabled()).toBe(true);
      const saved = JSON.parse((await getCanvas(projectId)).nodes)[0];
      expect(saved.data).toMatchObject({ draftModelId: "retired-video-model", draftDuration: 99, prompt: "A" });
    });
  }, 60_000);
  it.runIf(process.env.IKDUHP_BROWSER)("browser: editing and Enter save without submitting, hide and reload restore the latest draft", async () => {
    const projectId = (await projects.create("987654", "IKDUHP editing")).id;
    const original = await seedVideo(projectId);
    expect((await saveCanvas(projectId, [original], [], "missing")).status).toBe(200);
    await withBrowser(projectId, async page => {
      const submissions: unknown[] = [];
      page.on("request", request => {
        if (request.method() === "POST" && request.url().endsWith("/generation-jobs")) submissions.push(request.postDataJSON());
      });
      const node = page.locator('[data-id="original-video"]');
      await node.getByTestId("media-title").click();
      await page.getByText("IKDUHP Test", { exact: true }).waitFor();
      const editor = page.locator('[contenteditable="true"]');
      await editor.fill("B"); await editor.press("End"); await editor.press("Enter"); await editor.press("C");
      await vi.waitFor(async () => {
        expect(JSON.parse((await getCanvas(projectId)).nodes)[0].data.prompt).toBe("B\nC");
      }, { timeout: 10_000 });
      expect(submissions).toEqual([]);
      await page.locator('.react-flow__pane').click({ position: { x: 100, y: 700 } });
      await vi.waitFor(async () => expect(await page.getByTestId("video-send").count()).toBe(0));
      await node.getByTestId("media-title").click();
      expect(await editor.innerText()).toBe("B\nC");
      await page.reload(); await node.getByTestId("media-title").click();
      expect(await editor.innerText()).toBe("B\nC");
      expect(submissions).toEqual([]);
    });
  }, 60_000);

  it.runIf(process.env.IKDUHP_BROWSER)("browser: pending save prevents duplicate sends and preserves the submitted edit", async () => {
    const projectId = (await projects.create("987654", "IKDUHP pending save")).id;
    const original = await seedVideo(projectId);
    expect((await saveCanvas(projectId, [original], [], "missing")).status).toBe(200);
    await withBrowser(projectId, async page => {
      await page.locator('[data-id="original-video"]').getByTestId("media-title").click();
      await page.getByText("IKDUHP Test", { exact: true }).waitFor();
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
        await page.locator('[contenteditable="true"]').fill("只发送一次");
        await page.getByTestId("video-send").click();
        await started;
        expect(submitted).toEqual([]);
        expect(await page.getByTestId("video-send").isDisabled()).toBe(true);
        await page.locator('.react-flow__pane').click({ position: { x: 100, y: 700 } });
        await page.locator('[data-id="original-video"]').getByTestId("media-title").click();
        await page.getByText("IKDUHP Test", { exact: true }).waitFor();
        expect(await page.getByTestId("video-send").isDisabled()).toBe(true);
        expect(await page.locator('[contenteditable="false"]').count()).toBe(1);
      } finally { release(); }
      await page.getByTestId("regen-overlay").waitFor();
      expect(submitted).toHaveLength(1);
      expect(JSON.parse((await getCanvas(projectId)).nodes)[0].data.prompt).toBe("只发送一次");
    });
  }, 60_000);

  async function referenceImage(projectId: string, id: string, x: number) {
    const asset = await prisma.client.assets.create({ data: { user_id: 987654n, project_id: BigInt(projectId),
      type: "image", url: `${mediaBase}/${id}.png`, width: 1024, height: 1024, size: 2048n } });
    return { id, type: "mediaNode", position: { x, y: 100 }, data: {
      assetId: String(asset.id), src: asset.url, mediaType: "image", fileName: id,
    } };
  }
  it.runIf(process.env.IKDUHP_BROWSER).each(["succeeded", "failed", "cancelled"] as const)("browser: %s keeps the original video, parameters and explicit frame roles", async outcome => {
    const projectId = (await projects.create("987654", `IKDUHP ${outcome}`)).id;
    const original = await seedVideo(projectId, "original-video", { draftMode: "keyframe" });
    const first = await referenceImage(projectId, "first", 600);
    const last = await referenceImage(projectId, "last", 1000);
    const text = { id: "text", type: "textNode", position: { x: 1000, y: 500 }, data: { title: "旁白", text: "雨夜" } };
    const edges = [
      { id: "first-edge", source: first.id, target: original.id, data: { refRole: "first" } },
      { id: "last-edge", source: last.id, target: original.id, data: { refRole: "last" } },
      { id: "text-edge", source: text.id, target: original.id },
    ];
    expect((await saveCanvas(projectId, [original, first, last, text], edges, "missing")).status).toBe(200);
    await withBrowser(projectId, async page => {
      const node = page.locator('[data-id="original-video"]');
      await node.getByTestId("media-title").click();
      await page.getByText("IKDUHP Test", { exact: true }).click();
      await page.getByRole("button", { name: "720p", exact: true }).click();
      await page.getByRole("button", { name: "1080p", exact: true }).click();
      await page.getByRole("button", { name: "9:16", exact: true }).click();
      const duration = page.locator('input[type="range"]');
      await duration.focus(); await duration.press("Home");
      for (let i = 0; i < 4; i++) await duration.press("ArrowRight");
      await page.locator('[contenteditable="true"]').fill("最新 B");
      const sent: unknown[] = [];
      page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/generation-jobs")) sent.push(request.postDataJSON()); });
      expect(await page.getByTestId("video-send").isDisabled()).toBe(false);
      const response = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/generation-jobs"));
      await page.getByTestId("video-send").click({ timeout: 10_000 });
      const accepted = await (await response).json(); expect(accepted.code).toBe(200);
      const jobId = String(accepted.data.generation_job_id);
      expect(sent).toEqual([expect.objectContaining({ expected_output_count: 1, target_node_id: original.id,
        first_frame_asset_id: first.data.assetId, last_frame_asset_id: last.data.assetId,
        parameters: expect.objectContaining({ prompt: "最新 B", duration: 8, resolution: "1080p", aspect_ratio: "9:16" }),
      })]);
      await node.getByTestId("regen-overlay").waitFor();
      expect(await node.locator("video").first().getAttribute("src")).toBe(original.data.src);
      expect(await page.getByTestId("video-send").isDisabled()).toBe(true);
      const requests: unknown[] = [];
      const provider: VideoTaskProvider = {
        submit: async input => { requests.push(input); return { taskId: jobId, status: "queued" }; },
        poll: async () => ({ status: outcome === "failed" ? "failed" : "succeeded", progress: 100,
          url: outcome === "failed" ? null : `${mediaBase}/${jobId}.mp4`, error: outcome === "failed" ? { code: "provider_failed", message: "供应商拒绝生成" } : null }),
      };
      if (outcome === "cancelled") {
        const cancellation = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/cancel"));
        await node.getByTestId("regen-overlay").getByRole("button", { name: "取消", exact: true }).click();
        expect((await (await cancellation).json()).code).toBe(200);
        expect((await api(`jobs/${jobId}`)).data.status).toBe("queued");
        expect(await node.getByTestId("regen-overlay").count()).toBe(1);
      }
      await vi.waitFor(async () => expect(JSON.parse((await getCanvas(projectId)).nodes).find((n: { id: string }) => n.id === original.id).data.jobId).toBe(jobId), { timeout: 10_000 });
      await page.reload(); await node.getByTestId("media-title").click();
      await node.getByTestId("regen-overlay").waitFor();
      expect(await node.locator("video").first().getAttribute("src")).toBe(original.data.src);
      expect(await page.locator('[contenteditable="true"]').count()).toBe(0);
      await step(jobId, provider);
      if (outcome !== "cancelled") {
        expect(requests[0]).toMatchObject({ duration: 8, resolution: "1080p", ratio: "9:16",
          firstFrameImage: first.data.src, lastFrameImage: last.data.src, references: [] });
        expect(JSON.stringify(requests[0])).toContain("雨夜");
        await step(jobId, provider);
      } else expect(requests).toEqual([]);
      const expectedSrc = outcome === "succeeded" ? `${mediaBase}/${jobId}.mp4` : original.data.src;
      await vi.waitFor(async () => {
        const nodes = JSON.parse((await getCanvas(projectId)).nodes);
        expect(nodes).toHaveLength(4);
        expect(nodes.find((n: { id: string }) => n.id === original.id)).toMatchObject({ id: original.id, position: original.position,
          data: { src: expectedSrc, prompt: "最新 B", draftSize: "1080p", draftRatio: "9:16", draftDuration: 8 } });
        expect(nodes.find((n: { id: string }) => n.id === original.id).data.genStatus).toBe(outcome === "failed" ? "failed" : undefined);
      }, { timeout: 15_000 });
      expect(JSON.parse((await getCanvas(projectId)).edges)).toEqual(edges);
      expect((await api(`jobs/${jobId}`)).data.status).toBe(outcome);
      expect((await api(`jobs/${original.data.jobId}`)).data.asset.url).toBe(original.data.src);
      await page.reload(); await node.getByTestId("media-title").click();
      expect(await node.locator("video").first().getAttribute("src")).toBe(expectedSrc);
      expect(await page.locator('[contenteditable="true"]').innerText()).toBe("最新 B");
      expect(await page.getByTestId("dock-video-ref").count()).toBe(2);
      expect(sent).toHaveLength(1);
    });
  }, 90_000);

  async function seedImage(projectId: string) {
    const created = await api(`projects/${projectId}/generation-jobs`, { type: "image", expected_output_count: 1,
      parameters: { prompt: "Image A", model_id: "ikduhp-image", size: "1024x1024", aspect_ratio: "1:1" } });
    expect(created.code).toBe(200);
    const jobId = String(created.data.generation_job_id);
    await vi.waitFor(async () => {
      expect(await processImageJobById(jobId, { repo: createWorkerRepo(prisma.client), workerId: "ikduhp-image-worker",
        credentialVault: { open: encrypted => encrypted },
        createImageProvider: () => ({ generate: async () => [{ url: `${mediaBase}/${jobId}.png`, width: 1024, height: 1024 }] }),
        createAudioProvider: () => { throw new Error("unexpected audio job"); },
      })).not.toBeNull();
    }, { timeout: 15_000 });
    const job = (await api(`jobs/${jobId}`)).data;
    expect(job.status).toBe("succeeded");
    return { id: "generated-image", type: "mediaNode", position: { x: 700, y: 100 }, data: {
      jobId, assetId: String(job.asset.id), src: job.asset.url, mediaType: "image", fileName: "图片",
      prompt: "Image A", draftModelId: "ikduhp-image", draftSize: "1024x1024", draftRatio: "1:1",
    } };
  }
  it.runIf(process.env.IKDUHP_BROWSER)("browser: image/video drafts stay independent and save failure protects target, send and project switching", async () => {
    const projectId = (await projects.create("987654", "IKDUHP switching")).id;
    const otherId = (await projects.create("987654", "IKDUHP other project")).id;
    const video = await seedVideo(projectId);
    const image = await seedImage(projectId);
    const upload = await referenceImage(projectId, "uploaded", 1100);
    expect((await saveCanvas(projectId, [video, image, upload], [], "missing")).status).toBe(200);
    await withBrowser(projectId, async page => {
      const node = (id: string) => page.locator(`[data-id="${id}"]`).getByTestId("media-title");
      const editor = page.locator('[contenteditable="true"]');
      const submitted: unknown[] = [];
      page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/generation-jobs")) submitted.push(r.postDataJSON()); });
      await node(video.id).click(); await page.getByText("IKDUHP Test", { exact: true }).waitFor();
      await editor.fill("Video B");
      await node(image.id).click(); await page.locator("textarea").fill("Image B");
      await node(video.id).click(); expect(await editor.innerText()).toBe("Video B");
      await vi.waitFor(async () => {
        const nodes = JSON.parse((await getCanvas(projectId)).nodes);
        expect(nodes.find((n: { id: string }) => n.id === video.id).data.prompt).toBe("Video B");
        expect(nodes.find((n: { id: string }) => n.id === image.id).data.prompt).toBe("Image B");
      }, { timeout: 10_000 });
      await node(upload.id).click();
      await vi.waitFor(async () => expect(await page.getByTestId("video-send").count()).toBe(0));
      expect(await page.locator("textarea").count()).toBe(0);
      await node(video.id).click(); await node(image.id).click({ modifiers: ["ControlOrMeta"] });
      await vi.waitFor(async () => {
        expect(await page.getByTestId("video-send").count()).toBe(0);
        expect(await page.locator("textarea").count()).toBe(0);
      });
      await page.locator('.react-flow__pane').click({ position: { x: 100, y: 700 } });
      await node(video.id).click();
      await page.route("**/api/canvases/*", route => route.request().method() === "PUT"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: 500, msg: "保存故障" }) }) : route.continue());
      await editor.fill("未保存 Video C");
      await page.getByRole("button", { name: "重试保存" }).waitFor();
      expect(await page.getByTestId("video-send").isDisabled()).toBe(true);
      await node(image.id).click();
      expect(await page.locator("textarea").count()).toBe(0);
      await page.locator('.react-flow__pane').click({ position: { x: 100, y: 700 } });
      await vi.waitFor(async () => expect(await page.getByTestId("video-send").count()).toBe(0));
      await node(video.id).click(); expect(await editor.innerText()).toBe("未保存 Video C");
      await page.locator("button", { hasText: "IKDUHP switching" }).first().click();
      await page.locator('div[class*="projectItem"]', { hasText: "IKDUHP other project" }).first().click();
      expect(page.url()).toContain(`project=${projectId}`);
      expect(await page.getByRole("button", { name: "重试保存" }).isVisible()).toBe(true);
      expect(submitted).toEqual([]);
      await page.unroute("**/api/canvases/*");
      await page.getByRole("button", { name: "重试保存" }).click();
      await page.getByText(/^已保存 /).waitFor();
      await node(image.id).click(); expect(await page.locator("textarea").inputValue()).toBe("Image B");
      await node(video.id).click(); expect(await editor.innerText()).toBe("未保存 Video C");
      await page.reload(); await node(video.id).click(); expect(await editor.innerText()).toBe("未保存 Video C");
      await page.locator("button", { hasText: "IKDUHP switching" }).first().click();
      await page.locator('div[class*="projectItem"]', { hasText: "IKDUHP other project" }).first().click();
      await page.waitForURL(`**project=${otherId}**`);
    });
  }, 90_000);

  it.runIf(process.env.IKDUHP_BROWSER)("browser: next manual video uses the replacement while submitted references and existing results remain unchanged", async () => {
    const projectId = (await projects.create("987654", "IKDUHP downstream")).id;
    const source = await seedVideo(projectId, "source-video");
    const target = await seedVideo(projectId, "target-video"); target.position.x = 800;
    const edges = [{ id: "video-reference", source: source.id, target: target.id, data: { refRole: "reference" } }];
    expect((await saveCanvas(projectId, [source, target], edges, "missing")).status).toBe(200);
    await withBrowser(projectId, async page => {
      const submitted: unknown[] = [];
      page.on("request", r => { if (r.method() === "POST" && r.url().endsWith("/generation-jobs")) submitted.push(r.postDataJSON()); });
      async function send(id: string, prompt: string) {
        await page.locator(`[data-id="${id}"]`).getByTestId("media-title").click();
        await page.getByText("IKDUHP Test", { exact: true }).waitFor();
        await page.locator('[contenteditable="true"]').fill(prompt);
        const accepted = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/generation-jobs"));
        await page.getByTestId("video-send").click();
        const result = await (await accepted).json(); expect(result.code).toBe(200);
        return String(result.data.generation_job_id);
      }
      function provider(id: string, requests: unknown[]): VideoTaskProvider {
        return { submit: async input => { requests.push(input); return { taskId: id, status: "queued" }; },
          poll: async () => ({ status: "succeeded", progress: 100, url: `${mediaBase}/${id}.mp4`, error: null }) };
      }
      const downstream = await send(target.id, "旧快照任务");
      const upstream = await send(source.id, "新来源素材");
      const upstreamProvider = provider(upstream, []);
      await step(upstream, upstreamProvider); await step(upstream, upstreamProvider);
      await vi.waitFor(async () => {
        const nodes = JSON.parse((await getCanvas(projectId)).nodes);
        expect(nodes.find((n: { id: string }) => n.id === source.id).data.src).toBe(`${mediaBase}/${upstream}.mp4`);
        expect(nodes.find((n: { id: string }) => n.id === target.id).data.src).toBe(target.data.src);
      }, { timeout: 15_000 });
      expect(submitted).toHaveLength(2);
      const oldRequests: unknown[] = [];
      const oldProvider = provider(downstream, oldRequests);
      await step(downstream, oldProvider);
      expect(oldRequests[0]).toMatchObject({ references: [{ type: "video", url: source.data.src }] });
      await step(downstream, oldProvider);
      await vi.waitFor(async () => expect(JSON.parse((await getCanvas(projectId)).nodes).find((n: { id: string }) => n.id === target.id).data.src).toBe(`${mediaBase}/${downstream}.mp4`), { timeout: 15_000 });
      expect(submitted).toHaveLength(2);
      const next = await send(target.id, "新参考任务");
      const newRequests: unknown[] = [];
      const nextProvider = provider(next, newRequests);
      await step(next, nextProvider);
      expect(newRequests[0]).toMatchObject({ references: [{ type: "video", url: `${mediaBase}/${upstream}.mp4` }] });
      expect((await api(`jobs/${downstream}`)).data.asset.url).toBe(`${mediaBase}/${downstream}.mp4`);
      await step(next, nextProvider);
      expect(submitted).toHaveLength(3);
      expect(JSON.parse((await getCanvas(projectId)).edges)).toEqual(edges);
    });
  }, 90_000);

  it("API: late conditional video save cannot overwrite newer parameters or roles", async () => {
    const projectId = (await projects.create("987654", "IKDUHP conditional save")).id;
    const video = await seedVideo(projectId);
    const image = await referenceImage(projectId, "frame", 700);
    const first = [{ id: "ref", source: image.id, target: video.id, data: { refRole: "first" } }];
    expect((await saveCanvas(projectId, [video, image], first, "missing")).status).toBe(200);
    const version = (await getCanvas(projectId)).version;
    const latest = { ...video, data: { ...video.data, prompt: "B", draftDuration: 8 } };
    const reference = [{ id: "ref", source: image.id, target: video.id, data: { refRole: "reference" } }];
    expect((await saveCanvas(projectId, [latest, image], reference, version)).status).toBe(200);
    expect((await saveCanvas(projectId, [video, image], first, version)).status).toBe(412);
    const saved = await getCanvas(projectId);
    expect(JSON.parse(saved.nodes)[0].data).toMatchObject({ prompt: "B", draftDuration: 8 });
    expect(JSON.parse(saved.edges)).toEqual(reference);
  }, 30_000);

  it.runIf(process.env.IKDUHP_BROWSER)("browser: incompatible video reference is kept until the model is adjusted", async () => {
    await prisma.client.generation_model_capability.upsert({
      where: { provider_id_model_id: { provider_id: "ikduhp-test", model_id: "ikduhp-images-only" } },
      create: { provider_id: "ikduhp-test", model_id: "ikduhp-images-only", model_label: "Images Only", capability_type: "video",
        supported_sizes: [{ id: "720p", label: "720p", api_value: "720p" }], supported_aspect_ratios: ["16:9"], supported_formats: ["mp4"],
        default_size: "720p", default_aspect_ratio: "16:9", default_duration: 5, supported_durations: { min: 4, max: 12, step: 1 },
        features: { reference_image: true, max_reference_images: 9 } }, update: {},
    });
    const projectId = (await projects.create("987654", "IKDUHP incompatible ref")).id;
    const source = await seedVideo(projectId, "source-video");
    const target = await seedVideo(projectId, "target-video", { draftModelId: "ikduhp-images-only" }); target.position.x = 800;
    const edges = [{ id: "reference", source: source.id, target: target.id, data: { refRole: "reference" } }];
    expect((await saveCanvas(projectId, [source, target], edges, "missing")).status).toBe(200);
    await withBrowser(projectId, async page => {
      await page.locator('[data-id="target-video"]').getByTestId("media-title").click();
      await page.getByRole("alert").filter({ hasText: "不支持视频参考" }).waitFor({ timeout: 10_000 });
      expect(await page.getByTestId("video-send").isDisabled()).toBe(true);
      expect(await page.getByTestId("dock-video-ref").count()).toBe(1);
      expect(JSON.parse((await getCanvas(projectId)).edges)).toEqual(edges);
      await page.getByRole("button", { name: /Images Only/ }).click();
      await page.getByRole("button", { name: "Images Only", exact: true }).click();
      await page.getByRole("button", { name: "IKDUHP Test", exact: true }).click();
      await vi.waitFor(async () => expect(await page.getByTestId("video-send").isDisabled()).toBe(false));
      expect(await page.getByTestId("dock-video-ref").count()).toBe(1);
    });
  }, 60_000);

});
