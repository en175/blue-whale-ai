import "reflect-metadata";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
import { GenerationJobsController } from "../generation/generation-jobs.controller.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { AudioMixesService } from "@lib/shared/audio-mixes/audio-mixes.service.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { GenerationCommandService } from "@lib/shared/generation/generation-command.service.js";
import { MaterialService } from "@lib/shared/material/material.service.js";

vi.mock("@lib/shared/generation/generation-queue.js", () => ({
  enqueueAudioMixJob: vi.fn(async () => {}),
  loadRocketMqConfig: vi.fn(() => ({ endpoints: "", sslEnabled: false })),
  createRocketMqGenerationProducer: vi.fn(() => ({ enqueue: vi.fn(async () => {}) })),
  closeGenerationQueue: vi.fn(async () => {}),
}));

/** 浏览器→Nest→隔离 MySQL→Java Worker→本地 MediaKit/存储替身→浏览器播放。 */
describe.skipIf(process.env.IKI697_BROWSER !== "1")(
  "IKI697 browser audio mix recovery",
  () => {
    const previousDatabase = process.env.DATABASE_URL;
    const originalFetch = globalThis.fetch;
    let prisma: PrismaService;
    let projects: ProjectService;
    let app: Awaited<ReturnType<typeof NestFactory.create>>;
    let base = "";
    let mediaServer: Server;
    let mediaBase = "";
    let mysqlId = "";
    let mysqlPort = 0;
    let temp = "";
    let storedOutput: Buffer | undefined;
    let expectedOutput: Buffer;
    const servedOutputHashes: string[] = [];
    const repo = resolve(import.meta.dirname, "../../../../../..");
    const databaseName = `iki68n_test_${randomBytes(6).toString("hex")}`;
    const guardToken = randomBytes(16).toString("hex");
    const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

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
      temp = mkdtempSync(join(tmpdir(), "iki697-browser-"));
      // 混合结果夹具 = 检入的 1 秒 440Hz mp3（生成命令见 fixtures/README.md）。
      // worker 只读取/转发这些字节、不解析音频，容器内仍要求挂成 /fixture/result.mp3。
      copyFileSync(resolve(import.meta.dirname, "fixtures/sine-440-1s.mp3"), join(temp, "result.mp3"));
      expectedOutput = readFileSync(join(temp, "result.mp3"));
      const schema = join(repo, "server/blue-whale-worker/src/test/resources/db/bluewhale-schema.sql");
      mysqlId = execFileSync("docker", ["run", "-d", "--rm", "-e", "MYSQL_ROOT_PASSWORD=root",
        "-e", `MYSQL_DATABASE=${databaseName}`, "-e", "MYSQL_USER=test", "-e", "MYSQL_PASSWORD=test",
        "-p", "127.0.0.1::3306", "-v", `${schema}:/docker-entrypoint-initdb.d/init.sql:ro`, "mysql:8.0"],
      { encoding: "utf8" }).trim();
      mysqlPort = Number(execFileSync("docker", ["port", mysqlId, "3306/tcp"], { encoding: "utf8" }).trim().split(":").at(-1));
      let ready = false;
      for (let attempt = 0; attempt < 60 && !ready; attempt++) {
        try { execFileSync("docker", ["exec", mysqlId, "mysqladmin", "ping", "-h127.0.0.1", "-utest", "-ptest", "--silent"], { stdio: "ignore" }); ready = true; }
        catch { await new Promise((done) => setTimeout(done, 500)); }
      }
      expect(ready).toBe(true);
      process.env.DATABASE_URL = `mysql://test:test@127.0.0.1:${mysqlPort}/${databaseName}`;
      const additiveSql = readFileSync(join(repo,
        "backend/prisma/migrations/20260919190000_ikh1yi_project_last_opened_pinned/migration.sql"));
      execFileSync("docker", ["exec", "-i", mysqlId, "mysql", "-utest", "-ptest", databaseName],
        { input: additiveSql, stdio: ["pipe", "pipe", "pipe"] });
      execFileSync("docker", ["exec", mysqlId, "mysql", "-utest", "-ptest", databaseName,
        "-e", `CREATE TABLE iki68n_test_guard (guard_token CHAR(32) PRIMARY KEY); INSERT INTO iki68n_test_guard VALUES ('${guardToken}')`],
      { stdio: "pipe" });
      mediaServer = createServer((request, response) => {
        if (request.url === "/stored/out.mp3") {
          if (request.method === "PUT") {
            const chunks: Buffer[] = [];
            request.on("data", (chunk: Buffer) => chunks.push(chunk));
            request.on("end", () => { storedOutput = Buffer.concat(chunks); response.writeHead(200).end(); });
          } else if (storedOutput) {
            response.writeHead(200, { "content-type": "audio/mpeg", "content-length": storedOutput.length,
              "access-control-allow-origin": "*" }).end(storedOutput);
          } else response.writeHead(404).end();
          return;
        }
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
      const storage = { uploads: { inspectObject: async (key: string) => ({
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
      Reflect.defineMetadata("design:paramtypes", [ProjectService, GenerationCommandService, ModelCapabilityReadService,
        CanvasService, MaterialService, AssetService], GenerationJobsController);
      class HarnessModule {}
      Module({ controllers: [CanvasesController, ProjectsController, JobsController, AudioMixesController,
        AssetsController, ProjectAssetsController, GenerationModelsController, GenerationJobsController], providers: [
        { provide: CanvasService, useValue: canvas },
        { provide: ProjectService, useValue: projects },
        { provide: PrismaService, useValue: prisma },
        { provide: SnapshotService, useValue: new SnapshotService(prisma) },
        { provide: JobsService, useValue: new JobsService(prisma, projects) },
        { provide: AudioMixesService, useValue: mixes },
        { provide: AssetService, useValue: assets },
        { provide: AssetStorageService, useValue: storage },
        { provide: ModelCapabilityReadService, useValue: new ModelCapabilityReadService(prisma) },
        { provide: GenerationCommandService, useValue: new GenerationCommandService(prisma) },
        { provide: MaterialService, useValue: {} },
      ] })(HarnessModule);
      app = await NestFactory.create(HarnessModule, { logger: false, bodyParser: false });
      app.use(json({ limit: "16mb" }));
      app.setGlobalPrefix("api");
      app.use((request: { user: unknown; headers: Record<string, string> }, _response: unknown, next: () => void) => {
        request.user = { userId: "9" };
        request.headers.authorization = "Bearer sk-test";
        next();
      });
      await app.listen(0, "127.0.0.1");
      base = await app.getUrl();
    }, 30_000);

    afterAll(async () => {
      await app?.close();
      await new Promise<void>((resolve) => mediaServer?.close(() => resolve()));
      await prisma?.client.$disconnect();
      vi.unstubAllGlobals();
      if (mysqlId) execFileSync("docker", ["stop", mysqlId], { stdio: "ignore" });
      if (temp) rmSync(temp, { recursive: true, force: true });
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
    }, 90_000);

    it("已受理未落卡、失败重试、成功与主动删除都在重载后保持同一结果卡身份", async () => {
      const { chromium } = await import("playwright");
      const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
      const projectId = (await projects.create("9", "IKI697 browser")).id;
      const createAsset = async (name: string) => {
        const row = await prisma.client.assets.create({ data: {
          user_id: 9n, project_id: BigInt(projectId), type: "audio", source: "uploaded", status: "normal",
          storage_key: `uploads/9/${name}.wav`, url: `${mediaBase}/${name}.wav`,
          duration_ms: 10_000, size: BigInt(wav.length),
        } });
        return row.id.toString();
      };
      const firstAsset = await createAsset("first");
      const secondAsset = await createAsset("second");
      const nodes = [
        { id: "source", type: "mediaNode", position: { x: 280, y: 380 }, data: {
          src: `${mediaBase}/first.wav`, mediaType: "audio", fileName: "人声.wav", assetId: firstAsset, duration: 10,
        } },
        { id: "second", type: "mediaNode", position: { x: 820, y: 380 }, data: {
          src: `${mediaBase}/second.wav`, mediaType: "audio", fileName: "背景声.wav", assetId: secondAsset, duration: 10,
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
          server.middlewares.use("/__tos-fetch", (request, response) => {
            const url = new URL(request.url ?? "", "http://localhost").searchParams.get("url");
            if (url === `${mediaBase}/stored/out.mp3` && storedOutput) {
              servedOutputHashes.push(hash(storedOutput));
              response.writeHead(200, { "content-type": "audio/mpeg", "content-length": storedOutput.length });
              response.end(storedOutput);
            } else if (url?.startsWith(`${mediaBase}/`) && url.endsWith(".wav")) {
              response.writeHead(200, { "content-type": "audio/wav", "content-length": wav.length });
              response.end(wav);
            } else response.writeHead(404).end();
          });
        },
      }], server: { open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } } } });
      await vite.listen();
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        page.setDefaultTimeout(15_000);
        await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
          userId: 9, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
        } }, version: 0 })));
        const url = `${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`;
        await page.goto(url);
        await page.locator('.react-flow__node-mediaNode[data-id="source"]').waitFor();
        // 浏览器收到 POST 受理后立即离开：原页面还没有机会写结果卡。
        const created = await page.evaluate(async ({ projectId, firstAsset, secondAsset }) => {
          const response = await fetch(`/api/projects/${projectId}/audio-mixes`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ source_node_id: "source", inputs: [
              { asset_id: firstAsset, node_id: "source" }, { asset_id: secondAsset, node_id: "second" },
            ], output_format: "mp3" }),
          });
          return response.json();
        }, { projectId, firstAsset, secondAsset }) as { data: { job_id: string } };
        const jobId = created.data.job_id;
        const nodeId = `audio-mix-${jobId}`;
        expect((await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(jobId) } })).canvas_card_state).toBe("pending");
        await page.goto("about:blank");
        await page.goto(url);
        const result = page.locator(`.react-flow__node-mediaNode[data-id="${nodeId}"]`);
        await result.waitFor();
        expect(await result.locator("audio").count()).toBe(0);
        await vi.waitFor(async () => {
          const doc = await readCanvas();
          expect((JSON.parse(doc.nodes) as Array<{ id: string }>).filter((node) => node.id === nodeId)).toHaveLength(1);
          expect((JSON.parse(doc.edges) as Array<{ source: string; target: string; data?: { origin: string } }>).
            filter((edge) => edge.target === nodeId).map((edge) => [edge.source, edge.data?.origin]))
            .toEqual([["source", "audio-mix"], ["second", "audio-mix"]]);
          expect((await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(jobId) } })).canvas_card_state).toBe("present");
        }, { timeout: 15_000 });
        await page.reload();
        await result.waitFor();
        expect(await result.locator("audio").count()).toBe(0);
        const initialInput = (await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(jobId) } })).input;
        const runWorker = async (phase: "fail" | "succeed") => {
          const worker = spawn("docker", ["run", "--rm", "-e", "IKI68N_CROSS_RUNTIME=1",
            "-e", `IKI68N_DB_GUARD_TOKEN=${guardToken}`,
            "-e", `IKI68N_CROSS_RUNTIME_PHASE=${phase}`,
            "-e", "IKI68N_CROSS_RUNTIME_AUDIO_FILE=/fixture/result.mp3",
            "-e", `IKI68N_EXTERNAL_DB_URL=jdbc:mysql://host.docker.internal:${mysqlPort}/${databaseName}?allowPublicKeyRetrieval=true&useSSL=false`,
            "-e", `IKI68N_CROSS_RUNTIME_JOB_ID=${jobId}`,
            "-e", `IKI68N_STORAGE_UPLOAD_URL=http://host.docker.internal:${(mediaServer.address() as { port: number }).port}/stored/out.mp3`,
            "-e", `IKI68N_STORAGE_PUBLIC_URL=${mediaBase}/stored/out.mp3`,
            "-v", `${repo}:/workspace`, "-w", "/workspace/server",
            "-v", `${temp}:/fixture:ro`, "-v", `${process.env.HOME}/.m2:/root/.m2`,
            "maven:3.9-eclipse-temurin-21", "mvn", "-q",
            // 从聚合根跑并带 -pl/-am：worker 依赖同 reactor 的 server/blue-whale-common，
            // 直接进模块目录 `mvn test` 解析不到该依赖（verification-policy 同款约束）。
            "-pl", "blue-whale-worker", "-am", "-DfailIfNoSpecifiedTests=false",
            "-Dtest=AudioMixCrossRuntimeMySqlIntegrationTest", "test"], { cwd: repo });
          let output = "";
          worker.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
          worker.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
          const exit = await new Promise<number | null>((done) => worker.on("close", done));
          expect(exit, output).toBe(0);
        };
        await runWorker("fail");
        await vi.waitFor(async () => expect(await result.innerText()).toContain("音频混合失败，请重试"), { timeout: 15_000 });
        expect(await result.locator("audio").count()).toBe(0);
        await page.reload();
        await result.waitFor();
        await vi.waitFor(async () => expect(await result.innerText()).toContain("音频混合失败，请重试"), { timeout: 15_000 });
        const retryRequests: string[] = [];
        page.on("request", (request) => {
          if (request.method() === "POST" && request.url().endsWith(`/audio-mixes/${jobId}/retry`)) retryRequests.push(request.url());
        });
        await result.getByRole("button", { name: "重试" }).evaluate((button: HTMLButtonElement) => {
          button.click(); button.click();
        });
        await vi.waitFor(async () => {
          expect(retryRequests).toHaveLength(1);
          expect((await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(jobId) } })).status).toBe("queued");
        }, { timeout: 10_000 });
        expect((await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(jobId) } })).input).toEqual(initialInput);
        await page.reload();
        await result.waitFor();
        expect(await result.locator("audio").count()).toBe(0);
        expect(await page.locator(`.react-flow__node-mediaNode[data-id="${nodeId}"]`).count()).toBe(1);
        await runWorker("succeed");
        await result.locator("audio").waitFor({ state: "attached", timeout: 15_000 });
        expect(storedOutput).toEqual(expectedOutput);
        await page.reload();
        await result.locator("audio").waitFor({ state: "attached" });
        await result.locator("audio").evaluate(async (audio: HTMLAudioElement) => {
          await audio.play();
          if (audio.paused || audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) throw new Error("混合结果不可播放");
          audio.pause();
        });
        expect(servedOutputHashes).toContain(hash(storedOutput!));
        expect(await prisma.client.assets.count({ where: { generation_job_id: BigInt(jobId) } })).toBe(1);
        // 删除其中一张来源卡只收该悬空线，产物卡与独立 Asset 继续存在。
        await page.locator('.react-flow__node-mediaNode[data-id="source"]').click();
        await page.keyboard.press("Delete");
        await vi.waitFor(async () => {
          const doc = await readCanvas();
          expect((JSON.parse(doc.edges) as Array<{ source: string; target: string }>).
            filter((edge) => edge.target === nodeId).map((edge) => edge.source)).toEqual(["second"]);
        }, { timeout: 10_000 });
        await page.reload();
        await result.waitFor();
        expect(await prisma.client.assets.count({ where: { generation_job_id: BigInt(jobId) } })).toBe(1);
        await result.click();
        await page.keyboard.press("Delete");
        await vi.waitFor(async () => {
          expect(await result.count()).toBe(0);
          expect((await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(jobId) } })).canvas_card_state).toBe("removed");
        }, { timeout: 10_000 });
        await page.reload();
        expect(await result.count()).toBe(0);
        expect(await prisma.client.assets.count({ where: { generation_job_id: BigInt(jobId) } })).toBe(1);
      } finally {
        await browser.close();
        await vite.close();
      }
    }, 360_000);

    it("删除生成中卡后软取消由 Worker 落终态，刷新不复活", async () => {
      const { chromium } = await import("playwright");
      const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
      const projectId = (await projects.create("9", "IKI8AZ cancel browser")).id;
      const source = await prisma.client.assets.create({ data: {
        user_id: 9n, project_id: BigInt(projectId), type: "audio", source: "uploaded", status: "normal",
        storage_key: "uploads/9/cancel-source.wav", url: `${mediaBase}/cancel-source.wav`, duration_ms: 10_000,
      } });
      const other = await prisma.client.assets.create({ data: {
        user_id: 9n, project_id: BigInt(projectId), type: "audio", source: "uploaded", status: "normal",
        storage_key: "uploads/9/cancel-other.wav", url: `${mediaBase}/cancel-other.wav`, duration_ms: 10_000,
      } });
      const sourceId = source.id.toString();
      const otherId = other.id.toString();
      const nodes = [
        { id: "source", type: "mediaNode", position: { x: 280, y: 380 }, data: {
          src: `${mediaBase}/cancel-source.wav`, mediaType: "audio", fileName: "人声.wav", assetId: sourceId, duration: 10,
        } },
        { id: "second", type: "mediaNode", position: { x: 820, y: 380 }, data: {
          src: `${mediaBase}/cancel-other.wav`, mediaType: "audio", fileName: "背景声.wav", assetId: otherId, duration: 10,
        } },
      ];
      const saved = await originalFetch(`${base}/api/canvases/${projectId}`, {
        method: "PUT", headers: { "content-type": "application/json", "if-match": '"missing"' },
        body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: "[]", viewport: JSON.stringify({ x: 0, y: 0, zoom: 0.7 }) }),
      });
      expect(saved.status).toBe(200);
      const created = await originalFetch(`${base}/api/projects/${projectId}/audio-mixes`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ source_node_id: "source", inputs: [
          { asset_id: sourceId, node_id: "source" }, { asset_id: otherId, node_id: "second" },
        ], output_format: "mp3" }),
      });
      expect(created.status).toBe(201);
      const jobId = (await created.json() as { data: { job_id: string } }).data.job_id;
      const vite = await createVite({ root: `${process.cwd()}/web`, server: {
        open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
      } });
      await vite.listen();
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        page.setDefaultTimeout(15_000);
        await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
          userId: 9, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
        } }, version: 0 })));
        const url = `${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`;
        await page.goto(url);
        const result = page.locator(`.react-flow__node-mediaNode[data-id="audio-mix-${jobId}"]`);
        await result.waitFor();
        await result.click();
        await page.keyboard.press("Delete");
        await vi.waitFor(async () => {
          expect((await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(jobId) } })).cancel_requested_at)
            .toBeInstanceOf(Date);
          expect(await result.innerText()).toContain("正在取消");
        }, { timeout: 15_000 });
        await page.reload();
        await vi.waitFor(async () => expect(await result.innerText()).toContain("正在取消"), { timeout: 15_000 });
        const worker = spawn("docker", ["run", "--rm", "-e", "IKI68N_CROSS_RUNTIME=1",
          "-e", `IKI68N_DB_GUARD_TOKEN=${guardToken}`,
          "-e", "IKI68N_CROSS_RUNTIME_PHASE=cancel",
          "-e", `IKI68N_EXTERNAL_DB_URL=jdbc:mysql://host.docker.internal:${mysqlPort}/${databaseName}?allowPublicKeyRetrieval=true&useSSL=false`,
          "-e", `IKI68N_CROSS_RUNTIME_JOB_ID=${jobId}`,
          "-e", `IKI68N_STORAGE_UPLOAD_URL=http://host.docker.internal:${(mediaServer.address() as { port: number }).port}/stored/out.mp3`,
          "-e", `IKI68N_STORAGE_PUBLIC_URL=${mediaBase}/stored/out.mp3`,
          "-v", `${repo}:/workspace`, "-w", "/workspace/server",
          "-v", `${process.env.HOME}/.m2:/root/.m2`,
          "maven:3.9-eclipse-temurin-21", "mvn", "-q",
          // 从聚合根跑并带 -pl/-am：worker 依赖同 reactor 的 server/blue-whale-common，
          // 直接进模块目录 `mvn test` 解析不到该依赖（verification-policy 同款约束）。
          "-pl", "blue-whale-worker", "-am", "-DfailIfNoSpecifiedTests=false",
          "-Dtest=AudioMixCrossRuntimeMySqlIntegrationTest", "test"], { cwd: repo });
        let output = "";
        worker.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        worker.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        const exit = await new Promise<number | null>((done) => worker.on("close", done));
        expect(exit, output).toBe(0);
        const job = await originalFetch(`${base}/api/jobs/${jobId}`);
        expect((await job.json() as { data: { status: string } }).data.status).toBe("cancelled");
        await result.waitFor({ state: "detached", timeout: 15_000 });
        await page.reload();
        expect(await result.count()).toBe(0);
        expect((await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(jobId) } })).canvas_card_state)
          .toBe("removed");
        expect(await prisma.client.assets.count({ where: { generation_job_id: BigInt(jobId) } })).toBe(0);
      } finally {
        await browser.close();
        await vite.close();
      }
    }, 120_000);

    it("同秒 101 个任务分页时，第二页 pending 结果仍由浏览器补卡", async () => {
      const { chromium } = await import("playwright");
      const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
      const projectId = (await projects.create("9", "IKI697 same-second jobs")).id;
      const sameSecond = new Date("2026-09-23T12:00:00Z");
      await prisma.client.generation_jobs.createMany({ data: Array.from({ length: 101 }, () => ({
        user_id: 9n, project_id: BigInt(projectId), type: "audio_mix", source: "media_kit",
        status: "queued", progress: 0, canvas_card_state: "removed", gmt_create: sameSecond,
        input: { source_node_id: "source", inputs: [], output_format: "mp3" },
      })) });
      const rows = await prisma.client.generation_jobs.findMany({
        where: { project_id: BigInt(projectId), type: "audio_mix" }, orderBy: { id: "desc" }, select: { id: true },
      });
      const lastId = rows.at(-1)!.id;
      await prisma.client.generation_jobs.update({ where: { id: lastId }, data: { canvas_card_state: "pending" } });
      const save = await originalFetch(`${base}/api/canvases/${projectId}`, {
        method: "PUT", headers: { "content-type": "application/json", "if-match": '"missing"' },
        body: JSON.stringify({ nodes: "[]", edges: "[]", viewport: JSON.stringify({ x: 0, y: 0, zoom: 1 }) }),
      });
      expect(save.status).toBe(200);
      const readPage = async (page: number) => {
        const response = await originalFetch(`${base}/api/jobs?projectId=${projectId}&type=audio_mix&size=100&page=${page}`);
        return (await response.json() as { data: { records: Array<{ job_id: string }> } }).data.records;
      };
      const first = await readPage(1);
      const second = await readPage(2);
      expect(first).toHaveLength(100);
      expect(second).toHaveLength(1);
      expect([...first, ...second].map((job) => job.job_id)).toEqual(rows.map((row) => row.id.toString()));
      expect(second[0]?.job_id).toBe(lastId.toString());
      const vite = await createVite({ root: `${process.cwd()}/web`, server: {
        open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } },
      } });
      await vite.listen();
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        page.setDefaultTimeout(15_000);
        await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
          userId: 9, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
        } }, version: 0 })));
        await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
        await page.locator(`.react-flow__node-mediaNode[data-id="audio-mix-${lastId}"]`).waitFor();
        await vi.waitFor(async () => {
          const response = await originalFetch(`${base}/api/canvases?projectId=${projectId}`);
          const doc = (await response.json() as { data: { nodes: string } }).data;
          expect((JSON.parse(doc.nodes) as Array<{ id: string }>).map((node) => node.id)).toEqual([`audio-mix-${lastId}`]);
          expect((await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: lastId } })).canvas_card_state).toBe("present");
        }, { timeout: 15_000 });
      } finally {
        await browser.close();
        await vite.close();
      }
    }, 60_000);
  },
);
