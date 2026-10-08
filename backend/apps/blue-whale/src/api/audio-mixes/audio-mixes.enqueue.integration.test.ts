import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AllExceptionsFilter } from "@lib/infra/filters/all-exceptions.filter.js";
import { FAILURE_CODE } from "@lib/contracts";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { AudioMixesService } from "@lib/shared/audio-mixes/audio-mixes.service.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { GenerationCommandService } from "@lib/shared/generation/generation-command.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { enqueueAudioMixJob } from "@lib/shared/generation/generation-queue.js";
import { IdentityService } from "@lib/shared/identity/identity.service.js";
import { MaterialService } from "@lib/shared/material/material.service.js";
import { SystemSettingsService } from "@lib/shared/system-settings/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AudioMixesController } from "./audio-mixes.controller.js";
import { GenerationJobsController } from "../generation/generation-jobs.controller.js";

vi.mock("@lib/shared/generation/generation-queue.js", () => ({ enqueueAudioMixJob: vi.fn() }));



vi.mock("@lib/shared/billing/billing-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lib/shared/billing/billing-client.js")>();
  return {
    ...actual,
    sharedBillingClient: () => ({
      hold: async () => ({ reservedCredits: 1, catalogVersion: 1, duplicated: false }),
      quote: async () => ({ credits: BigInt(1), catalogVersion: 1 }),
      queryBalance: async () => ({ availableCredits: 0, frozenCredits: 0, expiring: [] }),
      listTransactions: async () => ({ items: [], total: 0 }),
    }),
  };
});

const databaseUrl = process.env.IKI5ZC_TEST_DATABASE_URL;
const previousDatabaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("audio mix creation when enqueue fails", () => {
  let prisma: PrismaService;
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let baseUrl: string;
  let projectId: bigint;
  let sourceId: bigint;
  let otherId: bigint;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/iki5zc") {
      throw new Error("IKI5ZC enqueue test requires the dedicated local iki5zc database");
    }
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    const projects = new ProjectService(prisma);
    const storage = { uploads: { inspectObject: async (key: string) => ({
      size: 16, mime: "audio/mpeg", publicUrl: `https://audio-mix.test/${key}`,
    }) } };
    const assets = new AssetService(prisma, storage as never);
    const service = new AudioMixesService(prisma, projects, assets, storage as never);
    Reflect.defineMetadata("design:paramtypes", [AudioMixesService], AudioMixesController);
    Reflect.defineMetadata("design:paramtypes", [
      ProjectService, GenerationCommandService, ModelCapabilityReadService,
      CanvasService, MaterialService, AssetService, IdentityService,
    ], GenerationJobsController);
    class HarnessModule {}
    Module({ controllers: [AudioMixesController, GenerationJobsController], providers: [
      { provide: AudioMixesService, useValue: service },
      { provide: ProjectService, useValue: projects },
      { provide: GenerationCommandService, useValue: new GenerationCommandService(prisma) },
      { provide: CanvasService, useValue: new CanvasService(prisma, projects) },
      { provide: ModelCapabilityReadService, useValue: new ModelCapabilityReadService(prisma) },


      { provide: MaterialService, useValue: new MaterialService(prisma, new SystemSettingsService(prisma)) },
      { provide: AssetService, useValue: new AssetService(prisma, new AssetStorageService()) },
      { provide: IdentityService, useValue: new IdentityService(prisma) },
    ] })(HarnessModule);
    app = await NestFactory.create(HarnessModule, { logger: false, bodyParser: false });
    app.use(json());
    app.useGlobalFilters(new AllExceptionsFilter());
    app.setGlobalPrefix("api");
    app.use((request: { user: unknown }, _response: unknown, next: () => void) => {
      request.user = { userId: "9" };
      next();
    });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
      String(input).startsWith("https://audio-mix.test/")
        ? Promise.resolve(new Response("a", { status: 206 }))
        : originalFetch(input, init));
    const project = await prisma.client.project.create({ data: { owner_id: 9n, name: "IKI5ZC enqueue failure" } });
    projectId = project.id;
    const source = await prisma.client.assets.create({ data: {
      user_id: 9n, project_id: projectId, type: "audio", source: "uploaded", status: "normal",
      storage_key: "uploads/9/audio/source.mp3", url: "https://audio-mix.test/source.mp3", duration_ms: 10_000,
    } });
    sourceId = source.id;
    const other = await prisma.client.assets.create({ data: {
      user_id: 9n, project_id: projectId, type: "audio", source: "uploaded", status: "normal",
      storage_key: "uploads/9/audio/other.mp3", url: "https://audio-mix.test/other.mp3", duration_ms: 12_000,
    } });
    otherId = other.id;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await app?.close();
    if (prisma && projectId) {
      await prisma.client.command_idempotency.deleteMany({ where: { project_id: projectId } });
      await prisma.client.generation_jobs.deleteMany({ where: { project_id: projectId, type: "audio_mix" } });
      await prisma.client.assets.deleteMany({ where: { id: { in: [sourceId, otherId] } } });
      await prisma.client.project.delete({ where: { id: projectId } });
      await prisma.client.$disconnect();
    }
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("rejects the HTTP create request while preserving a failed audit job", async () => {
    vi.mocked(enqueueAudioMixJob).mockRejectedValueOnce(new Error("MQ unavailable"));
    const response = await fetch(`${baseUrl}/api/projects/${projectId}/audio-mixes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_node_id: "source-node", inputs: [
        { asset_id: String(sourceId), node_id: "source-node" },
        { asset_id: String(otherId) },
      ] }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: FAILURE_CODE, msg: "任务入队失败", data: null });
    const jobs = await prisma.client.generation_jobs.findMany({ where: { project_id: projectId, type: "audio_mix" } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "failed", error: { code: "enqueue_failed" } });
  });

  it("入队失败后同键重放恢复原任务并再次入队", async () => {
    vi.mocked(enqueueAudioMixJob).mockReset();
    vi.mocked(enqueueAudioMixJob).mockRejectedValueOnce(new Error("MQ unavailable"));
    const send = () => fetch(`${baseUrl}/api/projects/${projectId}/audio-mixes`, {
      method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "enqueue-recover" },
      body: JSON.stringify({ source_node_id: "source-node", inputs: [
        { asset_id: String(sourceId), node_id: "source-node" }, { asset_id: String(otherId) },
      ] }),
    });
    const failed = await send();
    expect(failed.status).toBe(400);
    const record = await prisma.client.command_idempotency.findUniqueOrThrow({
      where: { project_id_operation_idempotency_key: {
        project_id: projectId, operation: "audio_mix.create", idempotency_key: "enqueue-recover",
      } },
    });
    const jobId = record.generation_job_id!;
    expect((await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: jobId } })).status)
      .toBe("failed");

    vi.mocked(enqueueAudioMixJob).mockResolvedValue(undefined);
    const recovered = await send();
    expect(recovered.status).toBe(201);
    const data = (await recovered.json()).data;
    expect(data).toMatchObject({ job_id: jobId.toString(), status: "queued", replayed: true, enqueue_required: true });
    expect(vi.mocked(enqueueAudioMixJob).mock.calls).toEqual([[jobId.toString()], [jobId.toString()]]);
    const job = await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("queued");
    expect(job.error).toBeNull();
    expect(await prisma.client.generation_jobs.count({ where: { id: jobId } })).toBe(1);
  });

  it("同键并发创建仅产生一个任务，重放不重复入队，请求变化返回 409", async () => {
    vi.mocked(enqueueAudioMixJob).mockReset();
    vi.mocked(enqueueAudioMixJob).mockResolvedValue(undefined);
    const url = `${baseUrl}/api/projects/${projectId}/audio-mixes`;
    const body = { source_node_id: "source-node", inputs: [
      { asset_id: String(sourceId), node_id: "source-node" }, { asset_id: String(otherId) },
    ] };
    const send = (payload: typeof body & { output_format?: string } = body) => fetch(url, {
      method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": "one-create" },
      body: JSON.stringify(payload),
    });
    const responses = await Promise.all([send(), send()]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const data = await Promise.all(responses.map(async (response) => (await response.json()).data));
    expect(data[0].job_id).toBe(data[1].job_id);
    expect(data.map((item) => item.replayed).sort()).toEqual([false, true]);
    expect(vi.mocked(enqueueAudioMixJob).mock.calls).toEqual([[data[0].job_id]]);
    expect(await prisma.client.generation_jobs.count({ where: { id: BigInt(data[0].job_id) } })).toBe(1);
    const conflict = await send({ ...body, output_format: "flac" });
    expect(conflict.status).toBe(409);
  });

  it("HTTP 软取消请求写入标记，供 worker 收敛为 cancelled", async () => {
    vi.mocked(enqueueAudioMixJob).mockResolvedValue(undefined);
    const created = await fetch(`${baseUrl}/api/projects/${projectId}/audio-mixes`, {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": "cancel-card" },
      body: JSON.stringify({ source_node_id: "source-node", inputs: [
        { asset_id: String(sourceId), node_id: "source-node" },
        { asset_id: String(otherId) },
      ] }),
    });
    expect(created.status).toBe(201);
    const jobId = (await created.json()).data.job_id as string;

    const cancelled = await fetch(`${baseUrl}/api/projects/${projectId}/generation-jobs/${jobId}/cancel`, {
      method: "POST",
    });
    expect(cancelled.status).toBe(201);
    const job = await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(jobId) } });
    expect(job.cancel_requested_at).toBeInstanceOf(Date);
    expect(job.status).toBe("queued");
  });
});
