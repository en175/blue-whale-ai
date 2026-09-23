import "reflect-metadata";
import { createServer, type Server } from "node:http";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasesController } from "./canvases.controller.js";
import { ProjectsController } from "../projects/projects.controller.js";
import { JobsController } from "../jobs/jobs.controller.js";
import { AudioMixesController } from "../audio-mixes/audio-mixes.controller.js";
import { AssetsController } from "../assets/assets.controller.js";
import { ProjectAssetsController } from "../project-assets/project-assets.controller.js";
import { GenerationModelsController } from "../generation/models.controller.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { AudioMixesService } from "@lib/shared/audio-mixes/audio-mixes.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";

vi.mock("@lib/shared/generation/generation-queue.js", () => ({
  enqueueAudioMixJob: vi.fn(async () => {}),
  loadRocketMqConfig: vi.fn(() => ({ endpoints: "", sslEnabled: false })),
  createRocketMqGenerationProducer: vi.fn(() => ({ enqueue: vi.fn(async () => {}) })),
  closeGenerationQueue: vi.fn(async () => {}),
}));

/** 浏览器→真实业务 API→隔离库；对象存储的可读性检查和供应商执行为本地替身。 */
describe.skipIf(!process.env.IKI68W_DATABASE_URL || process.env.IKI68W_BROWSER !== "1")(
  "IKI68W browser audio mix",
  () => {
    const previousDatabase = process.env.DATABASE_URL;
    const originalFetch = globalThis.fetch;
    let prisma: PrismaService;
    let projects: ProjectService;
    let app: Awaited<ReturnType<typeof NestFactory.create>>;
    let base = "";
    let mediaServer: Server;
    let mediaBase = "";
    let rejectObject = false;

    // 有效 1 秒 PCM WAV，Chromium 可真实解码，供输入播放和成功结果播放/下载。
    const wav = (() => {
      const samples = 8000;
      const bytes = Buffer.alloc(44 + samples * 2);
      bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
      bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
      bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32);
      bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(samples * 2, 40);
      for (let i = 0; i < samples; i += 1) bytes.writeInt16LE(Math.round(Math.sin(i / 16) * 6000), 44 + i * 2);
      return bytes;
    })();

    beforeAll(async () => {
      process.env.DATABASE_URL = process.env.IKI68W_DATABASE_URL;
      mediaServer = createServer((_request, response) => {
        response.writeHead(200, { "content-type": "audio/wav", "content-length": wav.length, "access-control-allow-origin": "*" });
        response.end(wav);
      });
      await new Promise<void>((resolve) => mediaServer.listen(0, "127.0.0.1", resolve));
      mediaBase = `http://127.0.0.1:${(mediaServer.address() as { port: number }).port}`;
      vi.stubGlobal("fetch", (url: string | URL | Request, options?: RequestInit) => {
        if (!String(url).startsWith("https://mix-object.test/")) return originalFetch(url, options);
        return Promise.resolve(new Response(wav.subarray(0, 1), { status: 206 }));
      });
      prisma = new PrismaService();
      projects = new ProjectService(prisma);
      const canvas = new CanvasService(prisma, projects);
      const storage = { uploads: { inspectObject: async (key: string) => rejectObject ? null : ({
        size: wav.length, mime: "audio/wav", publicUrl: `https://mix-object.test/${key}`,
      }) } } as unknown as AssetStorageService;
      const assets = new AssetService(prisma, storage);
      const mixes = new AudioMixesService(prisma, projects, assets, storage);
      Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
      Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
      Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
      Reflect.defineMetadata("design:paramtypes", [AudioMixesService], AudioMixesController);
      Reflect.defineMetadata("design:paramtypes", [AssetService], AssetsController);
      Reflect.defineMetadata("design:paramtypes", [ProjectService, AssetService, AssetStorageService], ProjectAssetsController);
      Reflect.defineMetadata("design:paramtypes", [ModelCapabilityReadService], GenerationModelsController);
      class HarnessModule {}
      Module({ controllers: [CanvasesController, ProjectsController, JobsController, AudioMixesController,
        AssetsController, ProjectAssetsController, GenerationModelsController], providers: [
        { provide: CanvasService, useValue: canvas },
        { provide: ProjectService, useValue: projects },
        { provide: PrismaService, useValue: prisma },
        { provide: SnapshotService, useValue: new SnapshotService(prisma) },
        { provide: JobsService, useValue: new JobsService(prisma, projects) },
        { provide: AudioMixesService, useValue: mixes },
        { provide: AssetService, useValue: assets },
        { provide: AssetStorageService, useValue: storage },
        { provide: ModelCapabilityReadService, useValue: new ModelCapabilityReadService(prisma) },
      ] })(HarnessModule);
      app = await NestFactory.create(HarnessModule, { logger: false, bodyParser: false });
      app.use(json({ limit: "16mb" }));
      app.setGlobalPrefix("api");
      app.use((request: { user: unknown }, _response: unknown, next: () => void) => {
        request.user = { userId: "987654" }; next();
      });
      await app.listen(0, "127.0.0.1");
      base = await app.getUrl();
    }, 30_000);

    afterAll(async () => {
      await app?.close();
      await new Promise<void>((resolve) => mediaServer?.close(() => resolve()));
      await prisma?.client.$disconnect();
      vi.unstubAllGlobals();
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
    });

    it("拒绝保留编辑；受理后持久化双来源；刷新恢复；成功同卡可播放下载", async () => {
      const { chromium } = await import("playwright");
      const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
      const projectId = (await projects.create("987654", "IKI68W browser")).id;
      const createAsset = async (name: string, durationMs: number) => {
        const row = await prisma.client.assets.create({ data: {
          user_id: 987654n, project_id: BigInt(projectId), type: "audio", source: "uploaded", status: "normal",
          storage_key: `uploads/987654/${name}.wav`, url: `${mediaBase}/${name}.wav`,
          duration_ms: durationMs, size: BigInt(wav.length),
        } });
        return row.id.toString();
      };
      const firstAsset = await createAsset("first", 10_000);
      const secondAsset = await createAsset("second", 18_000);
      const nodes = [
        { id: "source", type: "mediaNode", position: { x: 280, y: 380 }, data: {
          src: `${mediaBase}/first.wav`, mediaType: "audio", fileName: "人声.wav", assetId: firstAsset, duration: 10,
        } },
        { id: "second", type: "mediaNode", position: { x: 820, y: 380 }, data: {
          src: `${mediaBase}/second.wav`, mediaType: "audio", fileName: "背景声.wav", assetId: secondAsset, duration: 18,
        } },
      ];
      const save = await originalFetch(`${base}/api/canvases/${projectId}`, {
        method: "PUT", headers: { "content-type": "application/json", "if-match": '"missing"' },
        body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: "[]", viewport: JSON.stringify({ x: 0, y: 0, zoom: 0.7 }) }),
      });
      expect(save.status).toBe(200);
      const readCanvas = async () => {
        const response = await originalFetch(`${base}/api/canvases?projectId=${projectId}`);
        return (await response.json() as { data: { nodes: string; edges: string } }).data;
      };
      const vite = await createVite({ root: `${process.cwd()}/web`, plugins: [{
        name: "isolated-audio-object-read",
        configureServer(server) {
          server.middlewares.use("/__tos-fetch", (_request, response) => {
            response.writeHead(200, { "content-type": "audio/wav", "content-length": wav.length });
            response.end(wav);
          });
        },
      }], server: {
        open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
      } });
      await vite.listen();
      const proxyCheck = await originalFetch(`${vite.resolvedUrls!.local[0]}__tos-fetch?url=${encodeURIComponent(`${mediaBase}/output.wav`)}`);
      expect(proxyCheck.status, await proxyCheck.text()).toBe(200);
      expect(proxyCheck.headers.get("content-type")).toContain("audio/wav");
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const mixRequests: string[] = [];
        page.on('request', (request) => { if (request.method() === 'POST' && request.url().includes('/audio-mixes')) mixRequests.push(request.url()); });
        page.setDefaultTimeout(12_000);
        await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
          userId: 987654, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
        } }, version: 0 })));
        await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
        const source = page.locator('.react-flow__node-mediaNode[data-id="source"]');
        const second = page.locator('.react-flow__node-mediaNode[data-id="second"]');
        await source.waitFor();
        await second.waitFor();
        await source.click();
        expect(await page.locator('[data-testid="audio-tool-mix"]').getAttribute('aria-disabled'),
          await page.locator('[data-testid="audio-tool-mix"]').getAttribute('title')).toBeNull();
        await page.locator('[data-testid="audio-tool-mix"]').click();
        expect(await page.locator('[data-testid="audio-mix-send-bar"]').count()).toBe(1);
        expect(await source.getAttribute("class")).toContain("selected");
        expect(await second.getAttribute("class")).not.toContain("selected");
        const send = page.locator('[data-testid="audio-mix-send"]');
        expect(await send.isDisabled()).toBe(true);
        await page.locator('[data-testid="audio-mix-add"]').click();
        await page.locator('[data-testid="audio-mix-candidate-second"]').click();
        expect(await send.isEnabled()).toBe(true);
        expect(await source.locator("audio").count()).toBe(1);
        expect(await second.locator("audio").count()).toBe(1);

        rejectObject = true;
        await send.click();
        await vi.waitFor(async () => expect(mixRequests, (await page.locator('body').innerText()).slice(0, 700)).toHaveLength(1), { timeout: 10_000 });
        expect(await page.locator('[data-testid="audio-mix-send-bar"]').count()).toBe(1);
        expect(await page.locator('.react-flow__node-mediaNode[data-id^="audio-mix-"]').count()).toBe(0);
        expect(await prisma.client.generation_jobs.count({ where: { project_id: BigInt(projectId), type: "audio_mix" } })).toBe(0);
        rejectObject = false;
        await send.click();
        let jobId = "";
        await vi.waitFor(async () => {
          const job = await prisma.client.generation_jobs.findFirst({ where: { project_id: BigInt(projectId), type: "audio_mix" } });
          expect(job).not.toBeNull();
          jobId = job!.id.toString();
          expect(job!.input).toMatchObject({ source_node_id: "source", output_format: "mp3", inputs: [
            { asset_id: firstAsset, node_id: "source" }, { asset_id: secondAsset, node_id: "second" },
          ] });
        }, { timeout: 10_000 });
        const result = page.locator(`.react-flow__node-mediaNode[data-id="audio-mix-${jobId}"]`);
        await result.waitFor();
        expect(await result.locator("audio").count()).toBe(0);
        const assertSaved = async () => {
          const doc = await readCanvas();
          const savedNodes = JSON.parse(doc.nodes) as Array<{ id: string; data: Record<string, unknown> }>;
          const savedEdges = JSON.parse(doc.edges) as Array<{ source: string; target: string; data?: { origin?: string } }>;
          expect(savedNodes.find((node) => node.id === `audio-mix-${jobId}`)?.data.genStatus).toBe("generating");
          expect(savedEdges.filter((edge) => edge.target === `audio-mix-${jobId}`).map((edge) => [edge.source, edge.data?.origin]))
            .toEqual([["source", "audio-mix"], ["second", "audio-mix"]]);
        };
        await vi.waitFor(assertSaved, { timeout: 10_000 });
        await page.reload();
        await result.waitFor();
        expect(await result.locator("audio").count()).toBe(0);

        const output = await prisma.client.assets.create({ data: {
          user_id: 987654n, project_id: BigInt(projectId), type: "audio", source: "generated", status: "normal",
          url: `${mediaBase}/output.wav`, duration_ms: 42_750, size: BigInt(wav.length),
        } });
        await prisma.client.generation_jobs.update({ where: { id: BigInt(jobId) }, data: {
          status: "succeeded", progress: 100, output_asset_ids: [output.id.toString()],
        } });
        const status = await (await fetch(`${base}/api/jobs/${jobId}`)).json() as { data: { asset: { duration?: number } } };
        expect(status.data.asset.duration).toBe(42.75);
        const player = result.locator("audio");
        await player.waitFor({ state: "attached", timeout: 15_000 });
        expect(await player.getAttribute("src")).toContain("output.wav");
        expect(await result.innerText()).toContain("混合结果.mp3");
        expect(await source.locator("audio").count()).toBe(1);
        expect(await second.locator("audio").count()).toBe(1);
        await vi.waitFor(async () => {
          const saved = await readCanvas();
          expect((JSON.parse(saved.nodes) as Array<{ id: string; data: { duration?: number } }>).find((node) => node.id === `audio-mix-${jobId}`)?.data.duration).toBe(42.75);
        }, { timeout: 10_000 });
        await page.reload();
        await result.locator("audio").waitFor({ state: "attached" });
        await result.locator("audio").evaluate(async (audio: HTMLAudioElement) => {
          await audio.play().catch((error: unknown) => { throw new Error(JSON.stringify({ error: String(error), src: audio.src, currentSrc: audio.currentSrc, readyState: audio.readyState, networkState: audio.networkState, mediaError: audio.error?.code })); });
          if (audio.paused || audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) throw new Error("混合结果无法播放");
          audio.pause();
        });
        await result.click();
        const download = page.waitForEvent("download");
        await page.locator('button[title="下载"]').click();
        expect((await download).suggestedFilename()).toMatch(/^混合结果\./);
        await second.click();
        expect(await second.getAttribute("class")).toContain("selected");
        expect(await source.getAttribute("class")).not.toContain("selected");
        expect(await result.getAttribute("class")).not.toContain("selected");
        const saved = await readCanvas();
        expect((JSON.parse(saved.nodes) as Array<{ id: string; data: { duration?: number } }>).find((node) => node.id === `audio-mix-${jobId}`)?.data.duration).toBe(42.75);
      } finally {
        await browser.close();
        await vite.close();
      }
    }, 120_000);
  },
);
