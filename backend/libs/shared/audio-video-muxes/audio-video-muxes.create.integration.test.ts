import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AllExceptionsFilter } from "@lib/infra/filters/all-exceptions.filter.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AudioVideoMuxesController } from "../../../apps/blue-whale/src/api/audio-video-muxes/audio-video-muxes.controller.js";
import { enqueueAudioVideoMuxJob } from "../generation/generation-queue.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AudioVideoMuxesService } from "./audio-video-muxes.service.js";

const databaseUrl = process.env.IKIHPL_TEST_DATABASE_URL;
const previousDatabaseUrl = process.env.DATABASE_URL;
vi.mock("../generation/generation-queue.js", () => ({ enqueueAudioVideoMuxJob: vi.fn(async () => {}) }));

describe.skipIf(!databaseUrl)("audio video mux create idempotency in an isolated MySQL database", () => {
  let prisma: PrismaService;
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let baseUrl: string;
  let projectId: string;
  let audioId: bigint;
  let videoId: bigint;
  let foreignVideoId: bigint;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/ikihpl") {
      throw new Error("IKILVF create test requires the dedicated local ikihpl database");
    }
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    const projects = new ProjectService(prisma);
    const storage = { uploads: { inspectObject: async (key: string) => ({
      size: 16, mime: "video/mp4", publicUrl: `https://mux.test/${key}`,
    }) } };
    const assets = new AssetService(prisma, storage as never);
    const service = new AudioVideoMuxesService(prisma, projects, assets, storage as never);
    Reflect.defineMetadata("design:paramtypes", [AudioVideoMuxesService], AudioVideoMuxesController);
    class HarnessModule {}
    Module({ controllers: [AudioVideoMuxesController], providers: [
      { provide: AudioVideoMuxesService, useValue: service },
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
    // 公开读取探测替身：只放行我方测试桶域名，其余透传真实 fetch。
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) =>
      String(input).startsWith("https://mux.test/")
        ? Promise.resolve(new Response("x", { status: 206 }))
        : originalFetch(input, init));
    const project = await prisma.client.project.create({ data: { owner_id: 9n, name: "IKILVF create idempotency" } });
    projectId = String(project.id);
    const audio = await prisma.client.assets.create({ data: {
      user_id: 9n, project_id: project.id, type: "audio", source: "uploaded", status: "normal",
      storage_key: "uploads/9/audio/source.mp3", url: "https://mux.test/audio.mp3", duration_ms: 7_200_000,
    } });
    const video = await prisma.client.assets.create({ data: {
      user_id: 9n, project_id: project.id, type: "video", source: "uploaded", status: "normal",
      storage_key: "uploads/9/video/source.mp4", url: "https://mux.test/video.mp4", duration_ms: 7_200_000,
    } });
    // 归属校验样本：属于同用户但挂在别的项目且未建立 project_asset 链接。
    const foreign = await prisma.client.assets.create({ data: {
      user_id: 9n, project_id: 999_999n, type: "video", source: "uploaded", status: "normal",
      storage_key: "uploads/9/video/foreign.mp4", url: "https://mux.test/foreign.mp4", duration_ms: 33_000,
    } });
    audioId = audio.id;
    videoId = video.id;
    foreignVideoId = foreign.id;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await app?.close();
    if (prisma && projectId) {
      await prisma.client.command_idempotency.deleteMany({ where: { project_id: BigInt(projectId) } });
      await prisma.client.generation_jobs.deleteMany({ where: { project_id: BigInt(projectId), type: "audio_video_mux" } });
      await prisma.client.assets.deleteMany({ where: { id: { in: [audioId, videoId, foreignVideoId] } } });
      await prisma.client.project.delete({ where: { id: BigInt(projectId) } });
      await prisma.client.$disconnect();
    }
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  const ownedBody = (videoAssetId: bigint = videoId) => ({
    audio: { assetId: String(audioId), nodeId: "node-audio" },
    video: { assetId: String(videoAssetId) },
  });
  const send = (idempotencyKey: string, payload: object = ownedBody()) => fetch(
    `${baseUrl}/api/projects/${projectId}/audio-video-muxes`,
    { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload) },
  );

  async function counts() {
    return {
      jobs: await prisma.client.generation_jobs.count({ where: { project_id: BigInt(projectId), type: "audio_video_mux" } }),
      commands: await prisma.client.command_idempotency.count({
        where: { project_id: BigInt(projectId), operation: "audio_video_mux.create" },
      }),
    };
  }

  it("replays the same key serially: one job, one command row, enqueue once", async () => {
    vi.mocked(enqueueAudioVideoMuxJob).mockClear();
    const before = await counts();
    const first = await send("serial-click");
    const replay = await send("serial-click");
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    const firstData = (await first.json()).data;
    expect(firstData).toMatchObject({ job_id: expect.any(String), replayed: false, enqueue_required: true });
    expect(await replay.json()).toMatchObject({
      data: { job_id: firstData.job_id, replayed: true, enqueue_required: false },
    });
    expect(vi.mocked(enqueueAudioVideoMuxJob).mock.calls).toHaveLength(1);
    expect(await counts()).toEqual({ jobs: before.jobs + 1, commands: before.commands + 1 });
  });

  it("deduplicates concurrent same-key creations into exactly one job", async () => {
    vi.mocked(enqueueAudioVideoMuxJob).mockClear();
    const before = await counts();
    const responses = await Promise.all([send("concurrent-click"), send("concurrent-click")]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const data = await Promise.all(responses.map(async (response) => (await response.json()).data));
    expect(data[0].job_id).toBe(data[1].job_id);
    expect(data.map((item) => item.replayed).sort()).toEqual([false, true]);
    expect(vi.mocked(enqueueAudioVideoMuxJob).mock.calls).toHaveLength(1);
    expect(await counts()).toEqual({ jobs: before.jobs + 1, commands: before.commands + 1 });
  });

  it("returns 409 for a changed request under the same key without creating a second job", async () => {
    const first = await send("changed-click");
    expect(first.status).toBe(201);
    const before = await counts();
    const conflict = await send("changed-click", { ...ownedBody(), sync: "video" });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ msg: expect.stringContaining("幂等键") });
    expect(await counts()).toEqual(before);
  });

  it("keeps the failed-enqueue job recoverable with the same key and never double-enqueues", async () => {
    vi.mocked(enqueueAudioVideoMuxJob).mockReset();
    vi.mocked(enqueueAudioVideoMuxJob).mockRejectedValueOnce(new Error("MQ down"));
    vi.mocked(enqueueAudioVideoMuxJob).mockResolvedValue(undefined);
    const before = await counts();
    const failed = await send("enqueue-recover");
    expect(failed.status).toBe(400);
    expect(await failed.json()).toMatchObject({ msg: "任务入队失败", data: null });
    const record = await prisma.client.command_idempotency.findUniqueOrThrow({
      where: { project_id_operation_idempotency_key: {
        project_id: BigInt(projectId), operation: "audio_video_mux.create", idempotency_key: "enqueue-recover",
      } },
    });
    const jobId = record.generation_job_id!;
    // 首次入队失败保留原任务的明确失败状态
    const failedRow = await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: jobId } });
    expect(failedRow.status).toBe("failed");
    expect(failedRow.error).toMatchObject({ code: "enqueue_failed" });

    const recovered = await send("enqueue-recover");
    expect(recovered.status).toBe(201);
    expect(await recovered.json()).toMatchObject({
      data: { job_id: jobId.toString(), status: "queued", replayed: true, enqueue_required: true },
    });
    // 恢复后的重放不再入队、不产生第二个任务
    const replay = await send("enqueue-recover");
    expect(await replay.json()).toMatchObject({
      data: { job_id: jobId.toString(), status: "queued", replayed: true, enqueue_required: false },
    });
    expect(vi.mocked(enqueueAudioVideoMuxJob).mock.calls).toEqual([[jobId.toString()], [jobId.toString()]]);
    const row = await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: jobId } });
    expect(row.status).toBe("queued");
    expect(row.error).toBeNull();
    expect(await counts()).toEqual({ jobs: before.jobs + 1, commands: before.commands + 1 });
  });

  it("lets only one concurrent recovery resume the failed enqueue", async () => {
    vi.mocked(enqueueAudioVideoMuxJob).mockReset();
    vi.mocked(enqueueAudioVideoMuxJob).mockRejectedValueOnce(new Error("MQ down"));
    vi.mocked(enqueueAudioVideoMuxJob).mockResolvedValue(undefined);
    expect((await send("concurrent-recovery")).status).toBe(400);
    const before = await counts();

    const responses = await Promise.all([send("concurrent-recovery"), send("concurrent-recovery")]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const jobIds = new Set((await Promise.all(responses.map(async (response) => (await response.json()).data.job_id))));
    expect(jobIds.size).toBe(1);
    // 失败一次 + 恢复一次：并发重放不产生第二次执行
    const jobId = [...jobIds][0]!;
    expect(vi.mocked(enqueueAudioVideoMuxJob).mock.calls).toEqual([[jobId], [jobId]]);
    // 并发恢复不产生第二个任务或第二条幂等记录
    expect(await counts()).toEqual(before);
  });

  it("does not bypass asset ownership checks under an idempotency key", async () => {
    const before = await counts();
    const rejected = await send("foreign-asset", ownedBody(foreignVideoId));
    expect(rejected.status).toBe(404);
    expect(await counts()).toEqual(before);
    // 拒绝不落幂等记录：同键随后仍可受理合法请求
    const accepted = await send("foreign-asset");
    expect(accepted.status).toBe(201);
  });

  it("still creates a job without an idempotency key (legacy clients)", async () => {
    vi.mocked(enqueueAudioVideoMuxJob).mockClear();
    const response = await fetch(`${baseUrl}/api/projects/${projectId}/audio-video-muxes`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ownedBody()),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ data: { status: "queued", enqueue_required: true } });
    expect(vi.mocked(enqueueAudioVideoMuxJob)).toHaveBeenCalledTimes(1);
  });
});
