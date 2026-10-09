import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
  const createdJobs: bigint[] = [];
  const createdAssets: bigint[] = [];
  let snapshot: Record<string, unknown>;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/ikihpl") {
      throw new Error("IKIHPL retry test requires the dedicated local ikihpl database");
    }
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    const project = await prisma.client.project.create({ data: { owner_id: 9n, name: "IKIHPL retry" } });
    projectId = String(project.id);
    const audio = await prisma.client.assets.create({ data: {
      user_id: 9n, project_id: project.id, type: "audio", source: "uploaded", status: "normal",
      storage_key: "uploads/9/audio/source.mp3", url: "https://our-tos/audio.mp3", duration_ms: 7_200_000,
    } });
    const video = await prisma.client.assets.create({ data: {
      user_id: 9n, project_id: project.id, type: "video", source: "uploaded", status: "normal",
      storage_key: "uploads/9/video/source.mp4", url: "https://our-tos/video.mp4", duration_ms: 7_200_000,
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
    service = new AudioVideoMuxesService(prisma, {} as never, {} as never, {} as never);
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
    await prisma.client.generation_jobs.deleteMany({ where: { id: { in: createdJobs } } });
    await prisma.client.assets.deleteMany({ where: { id: { in: createdAssets } } });
    await prisma.client.project.delete({ where: { id: BigInt(projectId) } });
    await prisma.client.$disconnect();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });


  async function failedJob(frozenInput: object | null = snapshot) {
    const job = await prisma.client.generation_jobs.create({ data: {
      project_id: BigInt(projectId), user_id: 9n, type: "audio_video_mux", source: "dock",
      status: "failed", error: { message: "previous failure" },
      provider_task_id: "old-provider-task", poll_count: 12, fencing_token: 7n,
      next_action_at: null,
      ...(frozenInput ? { input: frozenInput } : {}),
    } });
    createdJobs.push(job.id);
    return job;
  }

  it("replays one retry key once while bumping submit_attempt of the frozen snapshot only", async () => {
    const original = await failedJob();
    const first = await service.retry("9", projectId, String(original.id), "same-click");
    const replay = await service.retry("9", projectId, String(original.id), "same-click");
    const row = await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: original.id } });

    expect(first).toMatchObject({ code: 200, data: { job_id: String(original.id), status: "queued", replayed: false } });
    expect(replay).toMatchObject({ code: 200, data: { job_id: String(original.id), replayed: true } });

    expect(row.input).toEqual({ ...snapshot, submit_attempt: 2 });
    expect(row.provider_task_id).toBeNull();
    expect(row.error).toBeNull();
    expect(row.poll_count).toBe(0);
    expect(row.retry_count).toBe(1);
    expect(row.fencing_token).toBe(8n);

    const [{ seconds_to_deadline }] = await prisma.client.$queryRaw<[{ seconds_to_deadline: number }]>
      `SELECT TIMESTAMPDIFF(SECOND, NOW(), execution_deadline_at) AS seconds_to_deadline FROM generation_jobs WHERE id = ${original.id}`;
    expect(seconds_to_deadline).toBeGreaterThan(86_300);
    expect(seconds_to_deadline).toBeLessThan(86_500);
    expect(await prisma.client.generation_jobs.count({ where: { id: original.id } })).toBe(1);
    expect(await prisma.client.cost_reservations.count({ where: { generation_job_id: original.id } })).toBe(0);
    expect(await prisma.client.generation_output_slots.count({ where: { generation_job_id: original.id } })).toBe(0);
    await expect(service.retry("9", projectId, String(original.id), "different-click"))
      .rejects.toMatchObject({ status: 409 });
  });

  it("rejects reusing one idempotency key for another mux job", async () => {
    const first = await failedJob();
    const other = await failedJob();
    await service.retry("9", projectId, String(first.id), "shared-key");
    await expect(service.retry("9", projectId, String(other.id), "shared-key"))
      .rejects.toMatchObject({ status: 409 });
  });

  it("deduplicates simultaneous double clicks against the same failed job", async () => {
    const original = await failedJob();
    const calls = await Promise.all([
      service.retry("9", projectId, String(original.id), "double-click"),
      service.retry("9", projectId, String(original.id), "double-click"),
    ]);
    expect(calls.map((call) => call.data?.job_id)).toEqual([String(original.id), String(original.id)]);
    const row = await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: original.id } });
    expect(row.retry_count).toBe(1);
    expect((row.input as { submit_attempt: number }).submit_attempt).toBe(2);
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
    const gone = await prisma.client.assets.create({ data: {
      user_id: 9n, project_id: BigInt(projectId), type: "video", source: "uploaded", status: "normal",
      storage_key: "uploads/9/video/gone.mp4", url: "https://our-tos/gone.mp4", duration_ms: 33_000,
    } });
    createdAssets.push(gone.id);
    const original = await failedJob({
      ...snapshot,
      video: { assetId: String(gone.id), nodeId: "node-video", url: "https://our-tos/gone.mp4" },
    });
    await prisma.client.assets.update({ where: { id: gone.id }, data: { is_delete: true } });
    await expect(service.retry("9", projectId, String(original.id), "gone-asset"))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining("输入资产已删除") });
  });

  it("accepts one business API retry and only enqueues the first request", async () => {
    const original = await failedJob();
    vi.mocked(enqueueAudioVideoMuxJob).mockClear();
    const url = `${baseUrl}/api/projects/${projectId}/audio-video-muxes/${original.id}/retry`;
    const send = () => fetch(url, { method: "POST", headers: { "Idempotency-Key": "browser-double-click" } });
    const first = await send();
    const second = await send();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await first.json()).toMatchObject({ data: { job_id: String(original.id), replayed: false } });
    expect(await second.json()).toMatchObject({ data: { job_id: String(original.id), replayed: true } });
    expect(vi.mocked(enqueueAudioVideoMuxJob).mock.calls).toEqual([[String(original.id)]]);
  });

  it("reports an enqueue failure and recovers once with the same key", async () => {
    const original = await failedJob();
    vi.mocked(enqueueAudioVideoMuxJob).mockReset();
    vi.mocked(enqueueAudioVideoMuxJob).mockRejectedValueOnce(new Error("MQ down"));
    vi.mocked(enqueueAudioVideoMuxJob).mockResolvedValue(undefined);
    const url = `${baseUrl}/api/projects/${projectId}/audio-video-muxes/${original.id}/retry`;
    const send = () => fetch(url, { method: "POST", headers: { "Idempotency-Key": "recover-mq" } });

    const failed = await send();
    expect(failed.status).toBeGreaterThanOrEqual(500);
    const failedRow = await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: original.id } });
    expect(failedRow.status).toBe("failed");
    expect(failedRow.error).toMatchObject({ code: "enqueue_failed" });
    const recovered = await send();
    const replay = await send();
    expect(recovered.status).toBe(201);
    expect(await recovered.json()).toMatchObject({ data: { job_id: String(original.id), status: "queued", replayed: true } });
    expect(await replay.json()).toMatchObject({ data: { job_id: String(original.id), status: "queued", replayed: true } });
    expect(vi.mocked(enqueueAudioVideoMuxJob).mock.calls).toEqual([[String(original.id)], [String(original.id)]]);
    const row = await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: original.id } });
    expect(row.retry_count).toBe(1);
    expect(row.fencing_token).toBe(8n);

    expect(row.input).toEqual({ ...snapshot, submit_attempt: 2 });
    expect(row.error).toBeNull();
  });

  it("lets only one concurrent same-key replay resume a failed enqueue", async () => {
    const original = await failedJob();
    vi.mocked(enqueueAudioVideoMuxJob).mockReset();
    vi.mocked(enqueueAudioVideoMuxJob).mockRejectedValueOnce(new Error("MQ down"));
    vi.mocked(enqueueAudioVideoMuxJob).mockResolvedValue(undefined);
    const url = `${baseUrl}/api/projects/${projectId}/audio-video-muxes/${original.id}/retry`;
    const send = () => fetch(url, { method: "POST", headers: { "Idempotency-Key": "concurrent-recovery" } });
    expect((await send()).status).toBeGreaterThanOrEqual(500);

    const responses = await Promise.all([send(), send()]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(vi.mocked(enqueueAudioVideoMuxJob).mock.calls).toEqual([[String(original.id)], [String(original.id)]]);
    expect((await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: original.id } })).retry_count).toBe(1);
  });

  it("replays the actual failed worker status without re-enqueueing", async () => {
    const original = await failedJob();
    await service.retry("9", projectId, String(original.id), "worker-failure-key");
    await prisma.client.generation_jobs.update({ where: { id: original.id }, data: {
      status: "failed", error: { code: "audio_video_mux_failed", message: "provider rejected" },
    } });
    const replay = await service.retry("9", projectId, String(original.id), "worker-failure-key");
    expect(replay.data).toMatchObject({ job_id: String(original.id), status: "failed", replayed: true });
    expect(replay.data?.enqueue_required).toBe(false);
  });
});
