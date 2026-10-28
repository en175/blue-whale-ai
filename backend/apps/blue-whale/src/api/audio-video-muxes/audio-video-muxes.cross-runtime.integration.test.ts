import "reflect-metadata";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer, request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { describe, expect, it, vi } from "vitest";
import { AudioVideoMuxesController } from "./audio-video-muxes.controller.js";
import { AudioVideoMuxesService } from "@lib/shared/audio-video-muxes/audio-video-muxes.service.js";
import { AssetsController } from "../assets/assets.controller.js";
import { JobsController } from "../jobs/jobs.controller.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { enqueueAudioVideoMuxJob } from "@lib/shared/generation/generation-queue.js";
import { ProjectService } from "@lib/shared/project/project.service.js";

vi.mock("@lib/shared/generation/generation-queue.js", () => ({ enqueueAudioVideoMuxJob: vi.fn(async () => {}) }));

describe.skipIf(process.env.IKIHPJ_CROSS_RUNTIME !== "1")("audio_video_mux cross runtime acceptance", () => {
  it("freezes inputs through HTTP and proves api → job → worker → gateway fake → durable video asset", async () => {
    const repo = resolve(import.meta.dirname, "../../../../../..");
    const schema = join(repo, "server/blue-whale-worker/src/test/resources/db/bluewhale-schema.sql");
    const databaseName = `ikihpj_test_${randomBytes(6).toString("hex")}`;
    const guardToken = randomBytes(16).toString("hex");
    const temp = mkdtempSync(join(tmpdir(), "ikihpj-cross-runtime-"));
    const originalDatabase = process.env.DATABASE_URL;
    const originalFetch = globalThis.fetch;
    let mysqlId = "";
    let prisma: PrismaService | undefined;
    let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
    let inputServer: ReturnType<typeof createHttpsServer> | undefined;
    let outputServer: ReturnType<typeof createHttpServer> | undefined;
    try {
      execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", join(temp, "key.pem"), "-out", join(temp, "cert.pem"), "-days", "1",
        "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
      const inputBytes = new Map([
        ["/uploads/9/audio/source.mp3", Buffer.from("ID3-source")],
        ["/uploads/9/video/my_vlog.mp4", Buffer.from("ftyp-source")],
      ]);
      inputServer = createHttpsServer({ key: readFileSync(join(temp, "key.pem")), cert: readFileSync(join(temp, "cert.pem")) },
        (request, response) => {
          const bytes = inputBytes.get(request.url ?? "");
          if (!bytes) { response.writeHead(404).end(); return; }
          response.writeHead(206, { "content-type": request.url?.endsWith(".mp4") ? "video/mp4" : "audio/mpeg", "content-range": `bytes 0-0/${bytes.length}` });
          response.end(bytes.subarray(0, 1));
        });
      await new Promise<void>((done) => inputServer!.listen(0, "127.0.0.1", done));
      const inputBase = `https://127.0.0.1:${(inputServer.address() as { port: number }).port}`;
      vi.stubGlobal("fetch", (url: string | URL | Request, options?: RequestInit) => {
        if (!String(url).startsWith(inputBase)) return originalFetch(url, options);
        return new Promise<Response>((done, reject) => {
          const request = httpsRequest(String(url), { method: options?.method ?? "GET", headers: options?.headers as Record<string, string>, rejectUnauthorized: false }, (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () => done(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 500 })));
          });
          request.on("error", reject);
          request.end();
        });
      });
      let stored: Buffer | undefined;
      outputServer = createHttpServer((request, response) => {
        if (request.url !== "/stored/out.mp4") { response.writeHead(404).end(); return; }
        if (request.method === "PUT") {
          const chunks: Buffer[] = [];
          request.on("data", (chunk: Buffer) => chunks.push(chunk));
          request.on("end", () => { stored = Buffer.concat(chunks); response.writeHead(200).end(); });
        } else if (stored) {
          response.writeHead(200, { "content-type": "video/mp4" }).end(stored);
        } else response.writeHead(404).end();
      });
      await new Promise<void>((done) => outputServer!.listen(0, "127.0.0.1", done));
      const outputPort = (outputServer.address() as { port: number }).port;

      mysqlId = execFileSync("docker", ["run", "-d", "--rm", "-e", "MYSQL_ROOT_PASSWORD=root",
        "-e", `MYSQL_DATABASE=${databaseName}`, "-e", "MYSQL_USER=test", "-e", "MYSQL_PASSWORD=test",
        "-p", "127.0.0.1::3306", "-v", `${schema}:/docker-entrypoint-initdb.d/init.sql:ro`, "mysql:8.0"],
      { encoding: "utf8" }).trim();
      const port = Number(execFileSync("docker", ["port", mysqlId, "3306/tcp"], { encoding: "utf8" }).trim().split(":").at(-1));
      let ready = false;
      for (let attempt = 0; attempt < 60 && !ready; attempt++) {
        try { execFileSync("docker", ["exec", mysqlId, "mysqladmin", "ping", "-h127.0.0.1", "-utest", "-ptest", "--silent"], { stdio: "ignore" }); ready = true; }
        catch { await new Promise((done) => setTimeout(done, 500)); }
      }
      expect(ready).toBe(true);
      process.env.DATABASE_URL = `mysql://test:test@127.0.0.1:${port}/${databaseName}`;
      const additiveSql = readFileSync(join(repo,
        "backend/prisma/migrations/20260919190000_ikh1yi_project_last_opened_pinned/migration.sql"));
      execFileSync("docker", ["exec", "-i", mysqlId, "mysql", "-utest", "-ptest", databaseName],
        { input: additiveSql, stdio: ["pipe", "pipe", "pipe"] });
      execFileSync("docker", ["exec", mysqlId, "mysql", "-utest", "-ptest", databaseName,
        "-e", `CREATE TABLE ikihpj_test_guard (guard_token CHAR(32) PRIMARY KEY); INSERT INTO ikihpj_test_guard VALUES ('${guardToken}')`],
      { stdio: "pipe" });
      prisma = new PrismaService();
      const projects = new ProjectService(prisma);
      const storage = { uploads: { inspectObject: async (key: string) => {
        const bytes = inputBytes.get(`/${key}`);
        return bytes ? { size: bytes.length, mime: key.endsWith(".mp4") ? "video/mp4" : "audio/mpeg", publicUrl: `${inputBase}/${key}` } : null;
      } } } as unknown as AssetStorageService;
      const assets = new AssetService(prisma, storage);
      const muxes = new AudioVideoMuxesService(prisma, projects, assets, storage, { jobBilling: async () => undefined, release: async () => {} } as never);
      Reflect.defineMetadata("design:paramtypes", [AudioVideoMuxesService], AudioVideoMuxesController);
      Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
      Reflect.defineMetadata("design:paramtypes", [AssetService], AssetsController);
      class HarnessModule {}
      Module({ controllers: [AudioVideoMuxesController, JobsController, AssetsController], providers: [
        { provide: AudioVideoMuxesService, useValue: muxes },
        { provide: JobsService, useValue: new JobsService(prisma, projects) },
        { provide: AssetService, useValue: assets },
      ] })(HarnessModule);
      app = await NestFactory.create(HarnessModule, { logger: false, bodyParser: false });
      app.use(json());
      app.setGlobalPrefix("api");
      app.use((request: { user: unknown }, _response: unknown, next: () => void) => { request.user = { userId: "9" }; next(); });
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();

      const project = await prisma.client.project.create({ data: { owner_id: 9n, name: "IKIHPJ cross runtime" } });
      const audio = await prisma.client.user_assets.create({ data: { user_id: 9n, project_id: project.id,
        type: "audio", source: "uploaded", status: "normal", storage_key: "uploads/9/audio/source.mp3",
        url: `${inputBase}/uploads/9/audio/source.mp3`, duration_ms: 10_000 } });
      const video = await prisma.client.user_assets.create({ data: { user_id: 9n, project_id: project.id,
        type: "video", source: "uploaded", status: "normal", storage_key: "uploads/9/video/my_vlog.mp4",
        url: `${inputBase}/uploads/9/video/my_vlog.mp4`, duration_ms: 33_000,
        width: 1280, height: 720, name: "my_vlog.mp4" } });

      const createJob = (body: object) => originalFetch(`${base}/api/projects/${project.id}/audio-video-muxes`, {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer sk-test" },
        body: JSON.stringify({
          audio: { assetId: String(audio.id), nodeId: "node-audio" },
          video: { assetId: String(video.id), nodeId: "node-video" },
          ...body,
        }),
      });

      const failResponse = await createJob({ sync: "video" });
      expect(failResponse.status).toBe(201);
      const failJobId = ((await failResponse.json()) as { data: { job_id: string } }).data.job_id;
      const succeedResponse = await createJob({});
      expect(succeedResponse.status).toBe(201);
      const succeedJobId = ((await succeedResponse.json()) as { data: { job_id: string } }).data.job_id;

      for (const [jobId, sync] of [[failJobId, "video"], [succeedJobId, "none"]] as const) {
        const job = await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(jobId) } });
        expect(job.input).toMatchObject({
          audio: { assetId: String(audio.id), nodeId: "node-audio", url: `${inputBase}/uploads/9/audio/source.mp3` },
          video: { assetId: String(video.id), nodeId: "node-video", url: `${inputBase}/uploads/9/video/my_vlog.mp4` },
          is_audio_reserve: true,
          sync,
          estimated_duration_ms: 33_000,
          submit_attempt: 1,
        });
        const frozen = job.input as { audio: { url: string }; video: { url: string } };
        for (const slot of [frozen.audio, frozen.video]) {
          expect((await fetch(slot.url)).status).toBe(206);
        }
      }

      const runWorker = async (token: string, phase: "fail" | "succeed" | "cancel", jobId: string, oldFence?: bigint) => {
        const worker = spawn("docker", ["run", "--rm", "-e", "IKIHPJ_CROSS_RUNTIME=1",
          "-e", `IKIHPJ_DB_GUARD_TOKEN=${token}`,
          "-e", `IKIHPJ_CROSS_RUNTIME_PHASE=${phase}`,
          ...(oldFence === undefined ? [] : ["-e", `IKIHPJ_OLD_FENCE=${oldFence}`]),
          "-e", `IKIHPJ_EXTERNAL_DB_URL=jdbc:mysql://host.docker.internal:${port}/${databaseName}?allowPublicKeyRetrieval=true&useSSL=false`,
          "-e", `IKIHPJ_CROSS_RUNTIME_JOB_ID=${jobId}`,
          "-e", `IKIHPJ_STORAGE_UPLOAD_URL=http://host.docker.internal:${outputPort}/stored/out.mp4`,
          "-e", `IKIHPJ_STORAGE_PUBLIC_URL=http://127.0.0.1:${outputPort}/stored/out.mp4`,
          "-v", `${repo}:/workspace`, "-w", "/workspace/server",
          "-v", `${process.env.HOME}/.m2:/root/.m2`,
          "maven:3.9-eclipse-temurin-21", "mvn", "-q",
          "-pl", "blue-whale-worker", "-am", "-DfailIfNoSpecifiedTests=false",
          "-Dsurefire.failIfNoSpecifiedTests=false",
          "-Dtest=AudioVideoMuxCrossRuntimeMySqlIntegrationTest", "test"],
        { cwd: repo });
        let output = "";
        worker.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        worker.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        const exitCode = await new Promise<number | null>((done) => worker.on("close", done));
        return { exitCode, output };
      };

      const rejected = await runWorker("0".repeat(32), "fail", failJobId);
      expect(rejected.exitCode).not.toBe(0);
      expect(rejected.output).toContain("隔离库标记不匹配");
      expect((await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(failJobId) } })).status).toBe("queued");
      expect(await prisma.client.user_assets.count({ where: { generation_job_id: BigInt(failJobId) } })).toBe(0);

      const failedRun = await runWorker(guardToken, "fail", failJobId);
      expect(failedRun.exitCode, failedRun.output).toBe(0);
      const failedJob = await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(failJobId) } });
      expect(failedJob.status).toBe("failed");
      expect(failedJob.error).toMatchObject({ code: "audio_video_mux_failed", message: expect.stringContaining("request-cross-fail") });
      expect(await prisma.client.user_assets.count({ where: { generation_job_id: BigInt(failJobId) } })).toBe(0);
      const failedResponse = await originalFetch(`${base}/api/jobs/${failJobId}`);
      const failedView = await failedResponse.json() as { code: number; msg: string; data: { status: string } };
      expect(failedView.data.status).toBe("failed");
      expect(failedView.code).toBe(1053);
      expect(failedView.msg).toBe("音视频合成失败，请重试");

      const accepted = await runWorker(guardToken, "succeed", succeedJobId,
        (await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(succeedJobId) } })).fencing_token + 5n);
      expect(accepted.exitCode, accepted.output).toBe(0);

      const jobResponse = await originalFetch(`${base}/api/jobs/${succeedJobId}`);
      const jobView = await jobResponse.json() as { code: number; data: { status: string; asset: { id: string; url: string } } };
      expect(jobView).toMatchObject({ code: 200, data: { status: "succeeded" } });
      const assetId = jobView.data.asset.id;
      const assetResponse = await originalFetch(`${base}/api/assets/${assetId}`);
      const assetView = await assetResponse.json() as { code: number; data: { url: string; duration: number; name?: string } };
      expect(assetView.code).toBe(200);
      expect(assetView.data.url).toBe(`http://127.0.0.1:${outputPort}/stored/out.mp4`);
      expect(assetView.data.duration).toBe(227);
      expect(await prisma.client.user_assets.findUniqueOrThrow({ where: { id: BigInt(assetId) } }))
        .toMatchObject({ name: "my_vlog(音视频合成).mp4", width: 1920, height: 1080, duration_ms: 227_000 });
      const playable = await originalFetch(assetView.data.url);
      expect(playable.status).toBe(200);
      expect(playable.headers.get("content-type")).toBe("video/mp4");
      expect(Buffer.from(await playable.arrayBuffer()).toString()).toBe("ftypisom-cross-runtime-output");
    } finally {
      vi.unstubAllGlobals();
      await app?.close();
      await prisma?.client.$disconnect();
      if (inputServer) await new Promise<void>((done) => inputServer!.close(() => done()));
      if (outputServer) await new Promise<void>((done) => outputServer!.close(() => done()));
      if (mysqlId) execFileSync("docker", ["stop", mysqlId], { stdio: "ignore" });
      rmSync(temp, { recursive: true, force: true });
      if (originalDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabase;
    }
  }, 600_000);
});
