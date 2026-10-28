import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioVideoMuxesController } from "../../../apps/blue-whale/src/api/audio-video-muxes/audio-video-muxes.controller.js";
import { enqueueAudioVideoMuxJob } from "../generation/generation-queue.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AudioVideoMuxesService } from "./audio-video-muxes.service.js";

const databaseUrl = process.env.IKIHPL_TEST_DATABASE_URL;
const previousDatabaseUrl = process.env.DATABASE_URL;
vi.mock("../generation/generation-queue.js", () => ({ enqueueAudioVideoMuxJob: vi.fn(async () => {}) }));

describe.skipIf(!databaseUrl)("audio video mux retry in an isolated MySQL database", () => {
  let prisma: PrismaService;
  let service: AudioVideoMuxesService;
  let projectId: string;
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let baseUrl: string;
  let charge: ReturnType<typeof vi.fn>;
  let release: ReturnType<typeof vi.fn>;
  const createdAssets: bigint[] = [];
  let snapshot: Record<string, unknown>;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/ikihpl") {
      throw new Error("IKIHPL retry test requires the dedicated local ikihpl database");
    }
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    charge = vi.fn().mockResolvedValue(undefined);
    release = vi.fn().mockResolvedValue(undefined);
    const project = await prisma.client.project.create({ data: { owner_id: 9n, name: "IKIHPL retry" } });
    projectId = String(project.id);
    const audio = await prisma.client.user_assets.create({ data: {
      user_id: 9n, project_id: project.id, type: "audio", source: "uploaded", status: "normal",
      storage_key: "uploads/9/audio/source.mp3", url: "https://our-tos/audio.mp3", duration_ms: 7_200_000,
    } });
    const video = await prisma.client.user_assets.create({ data: {
      user_id: 9n, project_id: project.id, type: "video", source: "uploaded", status: "normal",
      storage_key: "uploads/9/video/source.mp4", url: "https://our-tos/video.mp4",
      duration_ms: 7_200_000, width: 1920, height: 1080,
    } });
    createdAssets.push(audio.id, video.id);

    snapshot = {
      audio: { assetId: String(audio.id), nodeId: "node-audio", url: "https://our-tos/audio.mp3" },
      video: { assetId: String(video.id), nodeId: "node-video", url: "https://our-tos/video.mp4" },
      is_audio_reserve: true,
      sync: "video",
      estimated_duration_ms: 7_200_000,
      submit_attempt: 1,
    };
    service = new AudioVideoMuxesService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      { jobBilling: vi.fn().mockResolvedValue({ charge, release }), release } as never,
    );
    Reflect.defineMetadata("design:paramtypes", [AudioVideoMuxesService], AudioVideoMuxesController);
    class HarnessModule {}
    Module({ controllers: [AudioVideoMuxesController], providers: [
      { provide: AudioVideoMuxesService, useValue: service },
    ] })(HarnessModule);
    app = await NestFactory.create(HarnessModule, { logger: false, bodyParser: false });
    app.use(json());
    app.setGlobalPrefix("api");
    app.use((request: { user: unknown }, _response: unknown, next: () => void) => {
      request.user = { userId: "9" };
      next();
    });
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    if (!prisma) return;
    await app?.close();
    await prisma.client.command_idempotency.deleteMany({ where: { project_id: BigInt(projectId) } });
    await prisma.client.generation_jobs.deleteMany({ where: { project_id: BigInt(projectId) } });
    await prisma.client.user_assets.deleteMany({ where: { id: { in: createdAssets } } });
    await prisma.client.project.delete({ where: { id: BigInt(projectId) } });
    await prisma.client.$disconnect();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  beforeEach(() => {
    charge?.mockClear();
    release?.mockClear();
  });

  async function failedJob(frozenInput: object | null = snapshot) {
    return prisma.client.generation_jobs.create({ data: {
      project_id: BigInt(projectId), user_id: 9n, type: "audio_video_mux", source: "dock",
      status: "failed", error: { message: "previous failure" },
      provider_task_id: "old-provider-task", poll_count: 12, fencing_token: 7n,
      next_action_at: null,
      ...(frozenInput ? { input: frozenInput } : {}),
    } });
  }

  it("creates a new retry job with a bumped submit_attempt and leaves the original failed", async () => {
    const original = await failedJob();
    const first = await service.retry("9", projectId, String(original.id), "same-click");
    const replay = await service.retry("9", projectId, String(original.id), "same-click");
    const newJobId = String(first.data?.job_id);
    expect(newJobId).not.toBe(String(original.id));
    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge).toHaveBeenCalledWith(Number(newJobId));
    expect(charge).not.toHaveBeenCalledWith(Number(original.id));
    expect(replay).toMatchObject({ code: 200, data: { job_id: newJobId, replayed: true } });
    expect(charge).toHaveBeenCalledTimes(1);

    const retryRow = await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(newJobId) } });
    expect(retryRow.retry_of_job_id).toBe(original.id);
    expect(retryRow.status).toBe("queued");
    expect(retryRow.input).toEqual({
      ...snapshot,
      duration: 7200,
      resolution: "1080p",
      submit_attempt: 2,
    });

    const originalRow = await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: original.id } });
    expect(originalRow.status).toBe("failed");
    expect(originalRow.provider_task_id).toBe("old-provider-task");
    expect(await prisma.client.generation_jobs.count({ where: { retry_of_job_id: original.id } })).toBe(1);
  });

  it("creates another attempt for a different retry key", async () => {
    const original = await failedJob();
    const first = await service.retry("9", projectId, String(original.id), "click-a");
    const second = await service.retry("9", projectId, String(original.id), "click-b");
    expect(first.data?.job_id).not.toBe(second.data?.job_id);
    expect(await prisma.client.generation_jobs.count({ where: { retry_of_job_id: original.id } })).toBe(2);
  });

  it("rejects retry after success", async () => {
    const original = await failedJob();
    await prisma.client.generation_jobs.update({ where: { id: original.id }, data: { status: "succeeded" } });
    await expect(service.retry("9", projectId, String(original.id), "late-retry"))
      .rejects.toMatchObject({ status: 409 });
  });

  it.each([
    ["absent", null],
    ["dirty without submit_attempt", {
      audio: { assetId: "11", nodeId: "node-audio", url: "https://our-tos/audio.mp3" },
      video: { assetId: "12", url: "https://our-tos/video.mp4" },
      is_audio_reserve: true, sync: "none",
    }],
  ] as const)("rejects retry when the frozen snapshot is %s", async (_label, input) => {
    const original = await failedJob(input as object | null);
    await expect(service.retry("9", projectId, String(original.id), "no-snapshot"))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("冻结快照缺失") });
    const row = await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: original.id } });
    expect(row.status).toBe("failed");
  });

  it("rejects retry when a frozen input asset has been deleted", async () => {
    const gone = await prisma.client.user_assets.create({ data: {
      user_id: 9n, project_id: BigInt(projectId), type: "video", source: "uploaded", status: "normal",
      storage_key: "uploads/9/video/gone.mp4", url: "https://our-tos/gone.mp4", duration_ms: 33_000,
      width: 1920, height: 1080,
    } });
    createdAssets.push(gone.id);
    const original = await failedJob({
      ...snapshot,
      video: { assetId: String(gone.id), nodeId: "node-video", url: "https://our-tos/gone.mp4" },
    });
    await prisma.client.user_assets.update({ where: { id: gone.id }, data: { is_delete: true } });
    await expect(service.retry("9", projectId, String(original.id), "gone-asset"))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("输入资产已删除") });
  });

  it("enqueues the new job once through the business API", async () => {
    const original = await failedJob();
    vi.mocked(enqueueAudioVideoMuxJob).mockClear();
    const url = `${baseUrl}/api/projects/${projectId}/audio-video-muxes/${original.id}/retry`;
    const send = () => fetch(url, { method: "POST", headers: { "Idempotency-Key": "browser-double-click" } });
    const first = await send();
    const second = await send();
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(firstBody.data.job_id).not.toBe(String(original.id));
    expect(secondBody.data).toMatchObject({ job_id: firstBody.data.job_id, replayed: true });
    expect(vi.mocked(enqueueAudioVideoMuxJob).mock.calls).toEqual([[firstBody.data.job_id]]);
  });

  it("fails the new job on enqueue failure without resuming it on replay", async () => {
    const original = await failedJob();
    vi.mocked(enqueueAudioVideoMuxJob).mockReset();
    vi.mocked(enqueueAudioVideoMuxJob).mockRejectedValueOnce(new Error("MQ down"));
    vi.mocked(enqueueAudioVideoMuxJob).mockResolvedValue(undefined);
    const url = `${baseUrl}/api/projects/${projectId}/audio-video-muxes/${original.id}/retry`;
    const send = (key: string) => fetch(url, { method: "POST", headers: { "Idempotency-Key": key } });

    expect((await send("recover-mq")).status).toBeGreaterThanOrEqual(500);
    const retryRow = await prisma.client.generation_jobs.findFirstOrThrow({
      where: { retry_of_job_id: original.id },
    });
    expect(retryRow.status).toBe("failed");
    expect(retryRow.error).toMatchObject({ code: "enqueue_failed" });
    expect(release).toHaveBeenCalledWith(Number(retryRow.id));

    const replay = await send("recover-mq");
    expect(await replay.json()).toMatchObject({ data: { job_id: String(retryRow.id), status: "failed", replayed: true, enqueue_required: false } });
    expect(vi.mocked(enqueueAudioVideoMuxJob).mock.calls).toHaveLength(1);

    const next = await send("recover-mq-next");
    expect(await next.json()).toMatchObject({ data: { replayed: false, enqueue_required: true } });
    expect(vi.mocked(enqueueAudioVideoMuxJob).mock.calls).toHaveLength(2);
    expect(await prisma.client.generation_jobs.count({ where: { retry_of_job_id: original.id } })).toBe(2);
  });

  it("replays the retry job's worker status without enqueueing", async () => {
    const original = await failedJob();
    const first = await service.retry("9", projectId, String(original.id), "worker-failure-key");
    const newJobId = BigInt(String(first.data?.job_id));
    await prisma.client.generation_jobs.update({ where: { id: newJobId }, data: {
      status: "failed", error: { code: "audio_video_mux_failed", message: "provider rejected" },
    } });
    const replay = await service.retry("9", projectId, String(original.id), "worker-failure-key");
    expect(replay.data).toMatchObject({ job_id: String(newJobId), status: "failed", replayed: true });
    expect(replay.data?.enqueue_required).toBe(false);
  });
});
