import "reflect-metadata";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ffmpegPath from "ffmpeg-static";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CanvasesController } from "./canvases.controller.js";
import { ProjectsController } from "../projects/projects.controller.js";
import { JobsController } from "../jobs/jobs.controller.js";
import { AudioMixesController } from "../audio-mixes/audio-mixes.controller.js";
import { AssetsController } from "../assets/assets.controller.js";
import { AgentAssetsController } from "../agent-assets/agent-assets.controller.js";
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
import { MaterialService } from "@lib/shared/material/material.service.js";

vi.mock("@lib/shared/generation/generation-queue.js", () => ({
  enqueueAudioMixJob: vi.fn(async () => {}),
  loadRocketMqConfig: vi.fn(() => ({ endpoints: "", sslEnabled: false })),
  createRocketMqGenerationProducer: vi.fn(() => ({ enqueue: vi.fn(async () => {}) })),
  closeGenerationQueue: vi.fn(async () => {}),
}));

/** 浏览器→Nest→隔离 MySQL→Java Worker→本地 MediaKit/存储替身→浏览器播放。 */
describe.skipIf(process.env.IKI68X_BROWSER !== "1")(
  "IKI68X browser multi-source audio mix",
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
    let mysqlId = "";
    let mysqlPort = 0;
    let temp = "";
    let storedOutput: Buffer | undefined;
    let expectedOutput: Buffer;
    const uploadedObjects = new Map<string, Buffer>();
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
      temp = mkdtempSync(join(tmpdir(), "iki68x-browser-"));
      if (!ffmpegPath) throw new Error("ffmpeg-static 缺少可执行文件");
      execFileSync(ffmpegPath, ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
        "-codec:a", "libmp3lame", "-q:a", "9", join(temp, "result.mp3")]);
      expectedOutput = readFileSync(join(temp, "result.mp3"));
      const schema = join(repo, "worker-java/src/test/resources/db/bluewhale-schema.sql");
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
      const assetNameSql = readFileSync(join(repo,
        "backend/prisma/migrations/20260923153000_iki8az_asset_name/migration.sql"));
      execFileSync("docker", ["exec", "-i", mysqlId, "mysql", "-utest", "-ptest", databaseName],
        { input: assetNameSql, stdio: ["pipe", "pipe", "pipe"] });
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
      const storage = { uploads: {
        prepareUpload: async () => {
          const storageKey = `uploads/9/audio/browser-${randomBytes(6).toString("hex")}.wav`;
          return { storageKey, publicUrl: `https://mix-object.test/${storageKey}`,
            uploadUrl: `${mediaBase}/${storageKey}`, headers: {}, expiresIn: 600 };
        },
        inspectObject: async (key: string) => rejectObject || (key.includes("/browser-") && !uploadedObjects.has(key)) ? null : ({
          size: uploadedObjects.get(key)?.length ?? wav.length, mime: "audio/wav", publicUrl: `https://mix-object.test/${key}`,
        }),
        readHead: async (key: string, length: number) => uploadedObjects.get(key)?.subarray(0, length) ?? null,
        makePublic: async () => {},
        deleteMultiObjects: async (keys: string[]) => { keys.forEach((key) => uploadedObjects.delete(key)); },
      } } as unknown as AssetStorageService;
      const assets = new AssetService(prisma, storage);
      const material = new MaterialService(prisma);
      const mixes = new AudioMixesService(prisma, projects, assets, storage);
      Reflect.defineMetadata("design:paramtypes", [CanvasService], CanvasesController);
      Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
      Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
      Reflect.defineMetadata("design:paramtypes", [AudioMixesService], AudioMixesController);
      Reflect.defineMetadata("design:paramtypes", [AssetService], AssetsController);
      Reflect.defineMetadata("design:paramtypes", [AssetService, ProjectService, AssetStorageService, MaterialService], AgentAssetsController);
      Reflect.defineMetadata("design:paramtypes", [ProjectService, AssetService, AssetStorageService], ProjectAssetsController);
      Reflect.defineMetadata("design:paramtypes", [ModelCapabilityReadService], GenerationModelsController);
      class HarnessModule {}
      Module({ controllers: [CanvasesController, ProjectsController, JobsController, AudioMixesController,
        AssetsController, AgentAssetsController, ProjectAssetsController, GenerationModelsController], providers: [
        { provide: CanvasService, useValue: canvas },
        { provide: ProjectService, useValue: projects },
        { provide: PrismaService, useValue: prisma },
        { provide: SnapshotService, useValue: new SnapshotService(prisma) },
        { provide: JobsService, useValue: new JobsService(prisma, projects) },
        { provide: AudioMixesService, useValue: mixes },
        { provide: AssetService, useValue: assets },
        { provide: MaterialService, useValue: material },
        { provide: AssetStorageService, useValue: storage },
        { provide: ModelCapabilityReadService, useValue: new ModelCapabilityReadService(prisma) },
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

    it("画布、素材库、上传入库后按四段顺序提交并由真实 Worker 产出", async () => {
      const { chromium } = await import("playwright");
      const { createServer: createVite } = await import("../../../../../../web/node_modules/vite/dist/node/index.js");
      const projectId = (await projects.create("9", "IKI68X browser")).id;
      const foreignProjectId = (await projects.create("9", "IKI68X other project")).id;
      const createAsset = async (name: string, assetProjectId = projectId, status = "normal") => {
        const row = await prisma.client.assets.create({ data: {
          user_id: 9n, project_id: BigInt(assetProjectId), type: "audio", source: "uploaded", status,
          storage_key: `uploads/9/${name}.wav`, url: `${mediaBase}/${name}.wav`,
          duration_ms: 10_000, size: BigInt(wav.length),
        } });
        return row.id.toString();
      };
      const sourceAsset = await createAsset("source");
      const canvasAsset = await createAsset("canvas");
      const libraryAsset = await createAsset("library", foreignProjectId);
      const pendingAsset = await createAsset("pending", projectId, "uploading");
      const nodes = [
        { id: "source", type: "mediaNode", position: { x: 280, y: 380 }, data: {
          src: `${mediaBase}/source.wav`, mediaType: "audio", fileName: "画布源.wav", assetId: sourceAsset, duration: 10,
        } },
        { id: "canvas", type: "mediaNode", position: { x: 820, y: 380 }, data: {
          src: `${mediaBase}/canvas.wav`, mediaType: "audio", fileName: "画布第二段.wav", assetId: canvasAsset, duration: 10,
        } },
      ];
      const saved = await originalFetch(`${base}/api/canvases/${projectId}`, {
        method: "PUT", headers: { "content-type": "application/json", "if-match": '"missing"' },
        body: JSON.stringify({ nodes: JSON.stringify(nodes), edges: "[]", viewport: JSON.stringify({ x: 0, y: 0, zoom: 0.7 }) }),
      });
      expect(saved.status).toBe(200);
      const vite = await createVite({ root: `${process.cwd()}/web`, plugins: [{
        name: "isolated-audio-object-read",
        configureServer(server) {
          server.middlewares.use("/__tos-upload", (request, response) => {
            const url = new URL(request.url ?? "", "http://localhost").searchParams.get("url");
            const key = url?.startsWith(`${mediaBase}/`) ? url.slice(mediaBase.length + 1) : null;
            if (request.method !== "PUT" || !key?.startsWith("uploads/9/audio/")) { response.writeHead(404).end(); return; }
            const chunks: Buffer[] = [];
            request.on("data", (chunk: Buffer) => chunks.push(chunk));
            request.on("end", () => { uploadedObjects.set(key, Buffer.concat(chunks)); response.writeHead(200).end(); });
          });
          server.middlewares.use("/__tos-fetch", (request, response) => {
            const url = new URL(request.url ?? "", "http://localhost").searchParams.get("url");
            if (url === `${mediaBase}/stored/out.mp3` && storedOutput) {
              servedOutputHashes.push(hash(storedOutput));
              response.writeHead(200, { "content-type": "audio/mpeg", "content-length": storedOutput.length }).end(storedOutput);
            } else if (url?.startsWith(`${mediaBase}/`) && url.endsWith(".wav")) {
              response.writeHead(200, { "content-type": "audio/wav", "content-length": wav.length }).end(wav);
            } else response.writeHead(404).end();
          });
        },
      }], server: { open: false, host: "127.0.0.1", port: 0, proxy: { "/api": { target: base } } } });
      await vite.listen();
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        const apiFailures: string[] = [];
        const uploadResponses: string[] = [];
        page.on("response", (response) => {
          const path = new URL(response.url()).pathname;
          if (path.startsWith("/api/agent/assets/uploads/")) uploadResponses.push(`${path}:${response.status()}`);
          if (response.url().includes("/api/") && response.status() >= 400) {
            void response.text().then((body) => apiFailures.push(`${response.status()} ${response.url()} ${body}`));
          }
        });
        page.setDefaultTimeout(15_000);
        await page.addInitScript(() => localStorage.setItem("bw-auth", JSON.stringify({ state: { user: {
          userId: 9, username: "integration", email: "", phone: "", hasPassword: true, isAdmin: false,
        } }, version: 0 })));
        await page.goto(`${vite.resolvedUrls!.local[0]}canvas?project=${projectId}`);
        const source = page.locator('.react-flow__node-mediaNode[data-id="source"]');
        await source.waitFor();
        await source.click();
        await page.locator('[data-testid="audio-tool-mix"]').click();
        const send = page.locator('[data-testid="audio-mix-send"]');
        expect(await send.isDisabled()).toBe(true);
        await page.locator('[data-testid="audio-mix-add"]').click();
        await page.locator('[data-testid="audio-mix-candidate-canvas"]').click();
        await page.locator('[data-testid="audio-mix-tab-library"]').click();
        expect(await page.locator(`[data-testid="audio-mix-library-${pendingAsset}"]`).isDisabled()).toBe(true);
        await page.locator(`[data-testid="audio-mix-library-${libraryAsset}"]`).click();
        expect(await prisma.client.project_asset.count({ where: {
          user_id: 9n, asset_id: BigInt(libraryAsset), project_id: BigInt(projectId), is_delete: 0,
        } })).toBe(0);
        await page.locator('[data-testid="audio-mix-tab-upload"]').click();
        await page.locator('[data-testid="audio-mix-upload-input"]').setInputFiles({
          name: "本地音频.wav", mimeType: "audio/wav", buffer: wav,
        });
        await page.locator('[data-testid="audio-mix-add"]').getByText("音频 4/100").waitFor();
        const uploaded = await prisma.client.assets.findFirst({ where: {
          user_id: 9n, project_id: BigInt(projectId), type: "audio", status: "normal",
          storage_key: { startsWith: "uploads/9/audio/browser-" },
        } });
        expect(uploaded).not.toBeNull();
        const uploadedAsset = uploaded!.id.toString();
        expect(uploadedObjects.get(uploaded!.storage_key!)).toEqual(wav);
        expect(uploadResponses).toEqual(expect.arrayContaining([
          "/api/agent/assets/uploads/dedup:201",
          "/api/agent/assets/uploads/presign:201",
          "/api/agent/assets/uploads/complete:201",
        ]));
        expect(await send.isEnabled()).toBe(true);
        await page.locator('[data-testid="audio-mix-format-trigger"]').click();
        await page.locator('[data-testid="audio-mix-format-mp3"]').click();
        await send.click();
        await vi.waitFor(async () => expect(await prisma.client.project_asset.count({ where: {
          user_id: 9n, asset_id: BigInt(libraryAsset), project_id: BigInt(projectId), is_delete: 0,
        } })).toBe(1));
        let jobId = "";
        await vi.waitFor(async () => {
          const job = await prisma.client.generation_jobs.findFirst({ where: { project_id: BigInt(projectId), type: "audio_mix" } });
          expect(job, `API failures: ${apiFailures.join(" | ")}; page: ${await page.locator("body").innerText()}`).not.toBeNull();
          jobId = job!.id.toString();
          expect(job!.input).toMatchObject({ source_node_id: "source", output_format: "mp3", inputs: [
            { asset_id: sourceAsset, node_id: "source" },
            { asset_id: canvasAsset, node_id: "canvas" },
            { asset_id: libraryAsset },
            { asset_id: uploadedAsset },
          ] });
        }, { timeout: 10_000 });
        const result = page.locator(`.react-flow__node-mediaNode[data-id="audio-mix-${jobId}"]`);
        await result.waitFor();
        const readCanvas = async () => (await (await originalFetch(`${base}/api/canvases?projectId=${projectId}`)).json() as
          { data: { nodes: string; edges: string } }).data;
        await vi.waitFor(async () => {
          const doc = await readCanvas();
          expect((JSON.parse(doc.edges) as Array<{ source: string; target: string; data?: { origin?: string } }>)
            .filter((edge) => edge.target === `audio-mix-${jobId}`).map((edge) => [edge.source, edge.data?.origin]))
            .toEqual([["source", "audio-mix"], ["canvas", "audio-mix"]]);
        }, { timeout: 10_000 });
        await page.reload();
        await result.waitFor();
        const worker = spawn("docker", ["run", "--rm", "-e", "IKI68N_CROSS_RUNTIME=1",
          "-e", `IKI68N_DB_GUARD_TOKEN=${guardToken}`,
          "-e", "IKI68N_CROSS_RUNTIME_PHASE=succeed",
          "-e", "IKI68N_CROSS_RUNTIME_EXPECTED_INPUT_COUNT=4",
          "-e", "IKI68N_CROSS_RUNTIME_AUDIO_FILE=/fixture/result.mp3",
          "-e", `IKI68N_EXTERNAL_DB_URL=jdbc:mysql://host.docker.internal:${mysqlPort}/${databaseName}?allowPublicKeyRetrieval=true&useSSL=false`,
          "-e", `IKI68N_CROSS_RUNTIME_JOB_ID=${jobId}`,
          "-e", `IKI68N_STORAGE_UPLOAD_URL=http://host.docker.internal:${(mediaServer.address() as { port: number }).port}/stored/out.mp3`,
          "-e", `IKI68N_STORAGE_PUBLIC_URL=${mediaBase}/stored/out.mp3`,
          "-v", `${repo}:/workspace`, "-w", "/workspace/worker-java",
          "-v", `${temp}:/fixture:ro`, "-v", `${process.env.HOME}/.m2:/root/.m2`,
          "maven:3.9-eclipse-temurin-21", "mvn", "-q",
          "-Dtest=AudioMixCrossRuntimeMySqlIntegrationTest", "test"], { cwd: repo });
        let workerOutput = "";
        worker.stdout.on("data", (chunk: Buffer) => { workerOutput += chunk.toString(); });
        worker.stderr.on("data", (chunk: Buffer) => { workerOutput += chunk.toString(); });
        expect(await new Promise<number | null>((done) => worker.on("close", done)), workerOutput).toBe(0);
        expect(storedOutput).toEqual(expectedOutput);
        await result.locator("audio").waitFor({ state: "attached", timeout: 15_000 });
        expect(await result.locator("audio").getAttribute("src")).toContain("stored%2Fout.mp3");
        await page.reload();
        await result.locator("audio").waitFor({ state: "attached" });
        await result.locator("audio").evaluate(async (audio: HTMLAudioElement) => {
          await audio.play();
          if (audio.paused || audio.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) throw new Error("混合结果无法播放");
          audio.pause();
        });
        expect(servedOutputHashes).toContain(hash(storedOutput!));
      } finally {
        await browser.close();
        await vite.close();
      }
    }, 240_000);
  },
);
