import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AllExceptionsFilter } from "@lib/infra/filters/all-exceptions.filter.js";
import { FAILURE_CODE } from "@lib/contracts";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";
import { AudioVideoMuxesService } from "@lib/shared/audio-video-muxes/audio-video-muxes.service.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { GenerationCommandService } from "@lib/shared/generation/generation-command.service.js";
import { ModelCapabilityReadService } from "@lib/shared/generation/model-capability.service.js";
import { enqueueAudioVideoMuxJob } from "@lib/shared/generation/generation-queue.js";
import { IdentityService } from "@lib/shared/identity/identity.service.js";
import { MaterialService } from "@lib/shared/material/material.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AudioVideoMuxesController } from "./audio-video-muxes.controller.js";
import { GenerationJobsController } from "../generation/generation-jobs.controller.js";

vi.mock("@lib/shared/generation/generation-queue.js", () => ({ enqueueAudioVideoMuxJob: vi.fn() }));

// 计费基线起建任务必接 billing Hold（fail closed、无开关），控制器第 7 参也新增 IdentityService。
// 本套件被测对象不是计费：进程内假客户端放行 hold/quote。
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

const databaseUrl = process.env.IKIHPJ_TEST_DATABASE_URL;
const previousDatabaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("audio video mux creation when enqueue fails", () => {
  let prisma: PrismaService;
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let baseUrl: string;
  let projectId: bigint;
  let audioId: bigint;
  let videoId: bigint;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/ikihpj") {
      throw new Error("IKIHPJ enqueue test requires the dedicated local ikihpj database");
    }
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    const projects = new ProjectService(prisma);
    const storage = { uploads: { inspectObject: async (key: string) => ({
      size: 16, mime: key.endsWith(".mp4") ? "video/mp4" : "audio/mpeg", publicUrl: `https://audio-video-mux.test/${key}`,
    }) } };
    const assets = new AssetService(prisma, storage as never);
    const service = new AudioVideoMuxesService(prisma, projects, assets, storage as never);
    Reflect.defineMetadata("design:paramtypes", [AudioVideoMuxesService], AudioVideoMuxesController);
    Reflect.defineMetadata("design:paramtypes", [
      ProjectService, GenerationCommandService, ModelCapabilityReadService,
      CanvasService, MaterialService, AssetService, IdentityService,
    ], GenerationJobsController);
    class HarnessModule {}
    Module({ controllers: [AudioVideoMuxesController, GenerationJobsController], providers: [
      { provide: AudioVideoMuxesService, useValue: service },
      { provide: ProjectService, useValue: projects },
      { provide: GenerationCommandService, useValue: new GenerationCommandService(prisma) },
      { provide: CanvasService, useValue: new CanvasService(prisma, projects) },
      { provide: ModelCapabilityReadService, useValue: new ModelCapabilityReadService(prisma) },
      // 造素材校验门（IKFYHJ / ADR-0087）自 MaterialService 取仓库面、自 AssetService 解析
      // 本地素材绑定；无输入素材的建单路径只建门不发起上游调用。
      { provide: MaterialService, useValue: new MaterialService(prisma) },
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
      String(input).startsWith("https://audio-video-mux.test/")
        ? Promise.resolve(new Response("a", { status: 206 }))
        : originalFetch(input, init));
    const project = await prisma.client.project.create({ data: { owner_id: 9n, name: "IKIHPJ enqueue failure" } });
    projectId = project.id;
    const audio = await prisma.client.assets.create({ data: {
      user_id: 9n, project_id: projectId, type: "audio", source: "uploaded", status: "normal",
      storage_key: "uploads/9/audio/source.mp3", url: "https://audio-video-mux.test/source.mp3", duration_ms: 10_000,
    } });
    audioId = audio.id;
    const video = await prisma.client.assets.create({ data: {
      user_id: 9n, project_id: projectId, type: "video", source: "uploaded", status: "normal",
      storage_key: "uploads/9/video/source.mp4", url: "https://audio-video-mux.test/source.mp4", duration_ms: 33_000,
    } });
    videoId = video.id;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await app?.close();
    if (prisma && projectId) {
      await prisma.client.generation_jobs.deleteMany({ where: { project_id: projectId, type: "audio_video_mux" } });
      await prisma.client.assets.deleteMany({ where: { id: { in: [audioId, videoId] } } });
      await prisma.client.project.delete({ where: { id: projectId } });
      await prisma.client.$disconnect();
    }
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  const body = () => JSON.stringify({
    audio: { assetId: String(audioId), nodeId: "node-audio" },
    video: { assetId: String(videoId), nodeId: "node-video" },
    sync: "video",
  });

  it("rejects the HTTP create request while preserving a failed audit job", async () => {
    vi.mocked(enqueueAudioVideoMuxJob).mockRejectedValueOnce(new Error("MQ unavailable"));
    const response = await fetch(`${baseUrl}/api/projects/${projectId}/audio-video-muxes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body(),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: FAILURE_CODE, msg: "任务入队失败", data: null });
    const jobs = await prisma.client.generation_jobs.findMany({ where: { project_id: projectId, type: "audio_video_mux" } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: "failed", error: { code: "enqueue_failed" } });
  });

  it("persists the frozen camel snapshot through the HTTP create request", async () => {
    vi.mocked(enqueueAudioVideoMuxJob).mockReset();
    vi.mocked(enqueueAudioVideoMuxJob).mockResolvedValue(undefined);
    const created = await fetch(`${baseUrl}/api/projects/${projectId}/audio-video-muxes`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-test" },
      body: body(),
    });
    expect(created.status).toBe(201);
    const data = (await created.json()).data;
    expect(data).toMatchObject({ job_id: expect.any(String), status: "queued", enqueue_required: true });
    expect(vi.mocked(enqueueAudioVideoMuxJob).mock.calls).toEqual([[data.job_id]]);
    const job = await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(data.job_id) } });
    // 冻结 URL 是 inspectObject 桩返回的 publicUrl（域名 + storage_key），不是 assets 行的原始 url。
    expect(job.input).toMatchObject({
      audio: { assetId: String(audioId), nodeId: "node-audio", url: "https://audio-video-mux.test/uploads/9/audio/source.mp3" },
      video: { assetId: String(videoId), nodeId: "node-video", url: "https://audio-video-mux.test/uploads/9/video/source.mp4" },
      is_audio_reserve: true,
      sync: "video",
      estimated_duration_ms: 33_000,
      submit_attempt: 1,
      provider_credential: "sk-test",
    });
  });

  it("HTTP 软取消请求写入标记，供 worker 收敛为 cancelled", async () => {
    vi.mocked(enqueueAudioVideoMuxJob).mockResolvedValue(undefined);
    const created = await fetch(`${baseUrl}/api/projects/${projectId}/audio-video-muxes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body(),
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
