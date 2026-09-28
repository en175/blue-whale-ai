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
import { AudioMixesController } from "./audio-mixes.controller.js";
import { AudioMixesService } from "@lib/shared/audio-mixes/audio-mixes.service.js";
import { AssetsController } from "../assets/assets.controller.js";
import { JobsController } from "../jobs/jobs.controller.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { enqueueAudioMixJob } from "@lib/shared/generation/generation-queue.js";
import { ProjectService } from "@lib/shared/project/project.service.js";

vi.mock("@lib/shared/generation/generation-queue.js", () => ({ enqueueAudioMixJob: vi.fn(async () => {}) }));

// IKI68N: true Nest HTTP + MySQL + Java Worker, with only MediaKit/MQ/object storage replaced locally.
describe.skipIf(process.env.IKI68N_CROSS_RUNTIME !== "1")("audio_mix cross runtime acceptance", () => {
  it("freezes inputs through HTTP, survives worker failure/restart and double-click retry, then publishes durable audio", async () => {
    const repo = resolve(import.meta.dirname, "../../../../../..");
    const schema = join(repo, "server/blue-whale-worker/src/test/resources/db/bluewhale-schema.sql");
    const databaseName = `iki68n_test_${randomBytes(6).toString("hex")}`;
    const guardToken = randomBytes(16).toString("hex");
    const temp = mkdtempSync(join(tmpdir(), "iki68n-cross-runtime-"));
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
        ["/generated/9/audio/other.mp3", Buffer.from("ID3-other")],
      ]);
      inputServer = createHttpsServer({ key: readFileSync(join(temp, "key.pem")), cert: readFileSync(join(temp, "cert.pem")) },
        (request, response) => {
          const bytes = inputBytes.get(request.url ?? "");
          if (!bytes) { response.writeHead(404).end(); return; }
          response.writeHead(206, { "content-type": "audio/mpeg", "content-range": `bytes 0-0/${bytes.length}` });
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
        if (request.url !== "/stored/out.mp3") { response.writeHead(404).end(); return; }
        if (request.method === "PUT") {
          const chunks: Buffer[] = [];
          request.on("data", (chunk: Buffer) => chunks.push(chunk));
          request.on("end", () => { stored = Buffer.concat(chunks); response.writeHead(200).end(); });
        } else if (stored) {
          response.writeHead(200, { "content-type": "audio/mpeg" }).end(stored);
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
      // 建库走金标 DDL（含手工追加列）；只在此临时库补执行金标尚未收录的 09-19 纯新增列迁移。
      const additiveSql = readFileSync(join(repo,
        "backend/prisma/migrations/20260919190000_ikh1yi_project_last_opened_pinned/migration.sql"));
      execFileSync("docker", ["exec", "-i", mysqlId, "mysql", "-utest", "-ptest", databaseName],
        { input: additiveSql, stdio: ["pipe", "pipe", "pipe"] });
      execFileSync("docker", ["exec", mysqlId, "mysql", "-utest", "-ptest", databaseName,
        "-e", `CREATE TABLE iki68n_test_guard (guard_token CHAR(32) PRIMARY KEY); INSERT INTO iki68n_test_guard VALUES ('${guardToken}')`],
      { stdio: "pipe" });
      prisma = new PrismaService();
      const projects = new ProjectService(prisma);
      const storage = { uploads: { inspectObject: async (key: string) => {
        const bytes = inputBytes.get(`/${key}`);
        return bytes ? { size: bytes.length, mime: "audio/mpeg", publicUrl: `${inputBase}/${key}` } : null;
      } } } as unknown as AssetStorageService;
      const assets = new AssetService(prisma, storage);
      const audioMixes = new AudioMixesService(prisma, projects, assets, storage);
      Reflect.defineMetadata("design:paramtypes", [AudioMixesService], AudioMixesController);
      Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
      Reflect.defineMetadata("design:paramtypes", [AssetService], AssetsController);
      class HarnessModule {}
      Module({ controllers: [AudioMixesController, JobsController, AssetsController], providers: [
        { provide: AudioMixesService, useValue: audioMixes },
        { provide: JobsService, useValue: new JobsService(prisma, projects) },
        { provide: AssetService, useValue: assets },
      ] })(HarnessModule);
      app = await NestFactory.create(HarnessModule, { logger: false, bodyParser: false });
      app.use(json());
      app.setGlobalPrefix("api");
      app.use((request: { user: unknown }, _response: unknown, next: () => void) => { request.user = { userId: "9" }; next(); });
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();

      const project = await prisma.client.project.create({ data: { owner_id: 9n, name: "IKI68N cross runtime" } });
      const source = await prisma.client.assets.create({ data: { user_id: 9n, project_id: project.id,
        type: "audio", source: "uploaded", status: "normal", storage_key: "uploads/9/audio/source.mp3",
        url: `${inputBase}/uploads/9/audio/source.mp3`, duration_ms: 10_000 } });
      const other = await prisma.client.assets.create({ data: { user_id: 9n, project_id: 0n,
        type: "audio", source: "generated", status: "normal", storage_key: "generated/9/audio/other.mp3",
        url: `${inputBase}/generated/9/audio/other.mp3`, duration_ms: 12_500 } });
      const createdResponse = await originalFetch(`${base}/api/projects/${project.id}/audio-mixes`, {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer sk-test" },
        body: JSON.stringify({ source_node_id: "source-node", inputs: [
          { asset_id: String(source.id), node_id: "source-node" }, { asset_id: String(other.id) },
        ] }),
      });
      expect(createdResponse.status).toBe(201);
      const created = await createdResponse.json() as { code: number; data: { job_id: string } };
      expect(created.code).toBe(200);
      const job = await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(created.data.job_id) } });
      expect(job.input).toMatchObject({ source_node_id: "source-node", output_format: "mp3",
        estimated_duration_ms: 12_500, provider_credential: "sk-test", inputs: [
          { asset_id: String(source.id), node_id: "source-node", url: `${inputBase}/uploads/9/audio/source.mp3` },
          { asset_id: String(other.id), url: `${inputBase}/generated/9/audio/other.mp3` },
        ] });
      for (const input of (job.input as { inputs: { url: string }[] }).inputs) {
        expect((await fetch(input.url)).status).toBe(206);
      }

      const runWorker = async (token: string, phase: "fail" | "succeed", oldFence?: bigint) => {
        const worker = spawn("docker", ["run", "--rm", "-e", "IKI68N_CROSS_RUNTIME=1",
          "-e", `IKI68N_DB_GUARD_TOKEN=${token}`,
          "-e", `IKI68N_CROSS_RUNTIME_PHASE=${phase}`,
          ...(oldFence === undefined ? [] : ["-e", `IKI68N_OLD_FENCE=${oldFence}`]),
          "-e", `IKI68N_EXTERNAL_DB_URL=jdbc:mysql://host.docker.internal:${port}/${databaseName}?allowPublicKeyRetrieval=true&useSSL=false`,
          "-e", `IKI68N_CROSS_RUNTIME_JOB_ID=${created.data.job_id}`,
          "-e", `IKI68N_STORAGE_UPLOAD_URL=http://host.docker.internal:${outputPort}/stored/out.mp3`,
          "-e", `IKI68N_STORAGE_PUBLIC_URL=http://127.0.0.1:${outputPort}/stored/out.mp3`,
          "-v", `${repo}:/workspace`, "-w", "/workspace/server",
          "-v", `${process.env.HOME}/.m2:/root/.m2`,
          "maven:3.9-eclipse-temurin-21", "mvn", "-q",
          // 从聚合根跑并带 -pl/-am：worker 依赖同 reactor 的 server/blue-whale-common，
          // 直接进模块目录 `mvn test` 解析不到该依赖（verification-policy 同款约束）。
          "-pl", "blue-whale-worker", "-am", "-DfailIfNoSpecifiedTests=false",
          "-Dtest=AudioMixCrossRuntimeMySqlIntegrationTest", "test"],
        { cwd: repo });
        let output = "";
        worker.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        worker.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
        const exitCode = await new Promise<number | null>((done) => worker.on("close", done));
        return { exitCode, output };
      };
      const rejected = await runWorker("0".repeat(32), "fail");
      expect(rejected.exitCode).not.toBe(0);
      expect(rejected.output).toContain("隔离库标记不匹配");
      expect((await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("queued");
      expect(await prisma.client.assets.count({ where: { generation_job_id: job.id } })).toBe(0);

      const failedRun = await runWorker(guardToken, "fail");
      expect(failedRun.exitCode, failedRun.output).toBe(0);
      const failedJob = await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: job.id } });
      expect(failedJob.status).toBe("failed");
      expect(failedJob.error).toMatchObject({ code: "audio_mix_failed", message: expect.stringContaining("request-cross-fail") });
      expect(await prisma.client.assets.count({ where: { generation_job_id: job.id } })).toBe(0);
      const failedResponse = await originalFetch(`${base}/api/jobs/${created.data.job_id}`);
      const failedView = await failedResponse.json() as { code: number; msg: string; data: { status: string } };
      expect(failedView.data.status).toBe("failed");
      expect(failedView.code).toBe(1051);
      expect(failedView.msg).toBe("音频混合失败，请重试");

      vi.mocked(enqueueAudioMixJob).mockClear();
      const retryUrl = `${base}/api/projects/${project.id}/audio-mixes/${job.id}/retry`;
      const retry = () => originalFetch(retryUrl, { method: "POST", headers: { "Idempotency-Key": "cross-runtime-double-click" } });
      const retryResponses = await Promise.all([retry(), retry()]);
      expect(retryResponses.map((response) => response.status)).toEqual([201, 201]);
      const retryBodies = await Promise.all(retryResponses.map((response) => response.json())) as Array<{
        data: { job_id: string; status: string; replayed: boolean }
      }>;
      expect(retryBodies.map((body) => body.data.job_id)).toEqual([created.data.job_id, created.data.job_id]);
      expect(retryBodies.map((body) => body.data.status)).toEqual(["queued", "queued"]);
      expect(retryBodies.filter((body) => !body.data.replayed)).toHaveLength(1);
      expect(vi.mocked(enqueueAudioMixJob).mock.calls).toEqual([[created.data.job_id]]);
      const retriedJob = await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: job.id } });
      expect(retriedJob.input).toEqual(job.input);
      expect(retriedJob.provider_task_id).toBeNull();
      expect(retriedJob.retry_count).toBe(1);
      expect(retriedJob.fencing_token).toBe(failedJob.fencing_token + 1n);
      expect(await prisma.client.generation_jobs.count({ where: { id: job.id } })).toBe(1);
      expect(await prisma.client.cost_reservations.count({ where: { generation_job_id: job.id } })).toBe(0);

      const accepted = await runWorker(guardToken, "succeed", failedJob.fencing_token);
      expect(accepted.exitCode, accepted.output).toBe(0);

      const jobResponse = await originalFetch(`${base}/api/jobs/${created.data.job_id}`);
      const jobView = await jobResponse.json() as { code: number; data: { status: string; asset: { id: string; url: string } } };
      expect(jobView).toMatchObject({ code: 200, data: { status: "succeeded" } });
      const assetId = jobView.data.asset.id;
      const assetResponse = await originalFetch(`${base}/api/assets/${assetId}`);
      const assetView = await assetResponse.json() as { code: number; data: { url: string; duration: number } };
      expect(assetView.code).toBe(200);
      expect(assetView.data.url).toBe(`http://127.0.0.1:${outputPort}/stored/out.mp3`);
      expect(assetView.data.duration).toBe(37.25);
      const playable = await originalFetch(assetView.data.url);
      expect(playable.status).toBe(200);
      expect(playable.headers.get("content-type")).toBe("audio/mpeg");
      expect(Buffer.from(await playable.arrayBuffer()).toString()).toBe("ID3-cross-runtime-output");
      const finalReplay = await retry();
      expect((await finalReplay.json() as { data: { status: string; replayed: boolean } }).data)
        .toMatchObject({ status: "succeeded", replayed: true });
      expect(vi.mocked(enqueueAudioMixJob).mock.calls).toEqual([[created.data.job_id]]);
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
  }, 180_000);
});
