import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioMixesController } from "../../../apps/blue-whale/src/api/audio-mixes/audio-mixes.controller.js";
import { enqueueAudioMixJob } from "../generation/generation-queue.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AudioMixesService } from "./audio-mixes.service.js";

const databaseUrl = process.env.IKI696_TEST_DATABASE_URL;
const previousDatabaseUrl = process.env.DATABASE_URL;
vi.mock("../generation/generation-queue.js", () => ({ enqueueAudioMixJob: vi.fn(async () => {}) }));

describe.skipIf(!databaseUrl)("audio mix retry in an isolated MySQL database", () => {
  let prisma: PrismaService;
  let service: AudioMixesService;
  let projectId: string;
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let baseUrl: string;
  let charge: ReturnType<typeof vi.fn>;
  let release: ReturnType<typeof vi.fn>;
  const snapshot = {
    source_node_id: "source-node",
    output_format: "flac",
    estimated_duration_ms: 7200000,
    inputs: [
      { asset_id: "11", node_id: "source-node", url: "https://our-tos/11.flac" },
      { asset_id: "12", url: "https://our-tos/12.flac" },
    ],
  };

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/iki696") {
      throw new Error("IKI696 retry test requires the dedicated local iki696 database");
    }
    process.env.DATABASE_URL = databaseUrl;
    prisma = new PrismaService();
    charge = vi.fn().mockResolvedValue(undefined);
    release = vi.fn().mockResolvedValue(undefined);
    const project = await prisma.client.project.create({ data: { owner_id: 9n, name: "IKI696 retry" } });
    projectId = String(project.id);
    service = new AudioMixesService(
      prisma,
      {} as never,
      {} as never,
      {} as never,
      { jobBilling: vi.fn().mockResolvedValue({ charge, release }), release } as never,
    );
    Reflect.defineMetadata("design:paramtypes", [AudioMixesService], AudioMixesController);
    class HarnessModule {}
    Module({ controllers: [AudioMixesController], providers: [
      { provide: AudioMixesService, useValue: service },
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
    await prisma.client.project_command_receipts.deleteMany({ where: { project_id: BigInt(projectId) } });
    await prisma.client.generation_jobs.deleteMany({ where: { project_id: BigInt(projectId) } });
    await prisma.client.project.delete({ where: { id: BigInt(projectId) } });
    await prisma.client.$disconnect();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  beforeEach(() => {
    charge?.mockClear();
    release?.mockClear();
  });

  async function failedJob() {
    return prisma.client.generation_jobs.create({ data: {
      project_id: BigInt(projectId), user_id: 9n, type: "audio_mix", source: "dock",
      status: "failed", input: snapshot, error: { message: "previous failure" },
      provider_task_id: "old-provider-task", poll_count: 12, fencing_token: 7n,
      next_action_at: null,
    } });
  }

  it("creates a new retry job and leaves the original failed", async () => {
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
    expect(retryRow.input).toEqual({ ...snapshot, duration: 7200 });

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

  it("deduplicates simultaneous double clicks against the same retry key", async () => {
    const original = await failedJob();
    const calls = await Promise.all([
      service.retry("9", projectId, String(original.id), "double-click"),
      service.retry("9", projectId, String(original.id), "double-click"),
    ]);
    expect(calls[0]?.data?.job_id).toBe(calls[1]?.data?.job_id);
    expect(await prisma.client.generation_jobs.count({ where: { retry_of_job_id: original.id } })).toBe(1);
  });

  it("enqueues the new job once through the business API", async () => {
    const original = await failedJob();
    vi.mocked(enqueueAudioMixJob).mockClear();
    const url = `${baseUrl}/api/projects/${projectId}/audio-mixes/${original.id}/retry`;
    const send = () => fetch(url, { method: "POST", headers: { "Idempotency-Key": "browser-double-click" } });
    const first = await send();
    const second = await send();
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(firstBody.data.job_id).not.toBe(String(original.id));
    expect(secondBody.data).toMatchObject({ job_id: firstBody.data.job_id, replayed: true });
    expect(vi.mocked(enqueueAudioMixJob).mock.calls).toEqual([[firstBody.data.job_id]]);
  });

  it("fails the new job on enqueue failure without resuming it on replay", async () => {
    const original = await failedJob();
    vi.mocked(enqueueAudioMixJob).mockReset();
    vi.mocked(enqueueAudioMixJob).mockRejectedValueOnce(new Error("MQ down"));
    vi.mocked(enqueueAudioMixJob).mockResolvedValue(undefined);
    const url = `${baseUrl}/api/projects/${projectId}/audio-mixes/${original.id}/retry`;
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
    expect(vi.mocked(enqueueAudioMixJob).mock.calls).toHaveLength(1);

    const next = await send("recover-mq-next");
    expect(await next.json()).toMatchObject({ data: { replayed: false, enqueue_required: true } });
    expect(vi.mocked(enqueueAudioMixJob).mock.calls).toHaveLength(2);
    expect(await prisma.client.generation_jobs.count({ where: { retry_of_job_id: original.id } })).toBe(2);
  });

  it("replays the retry job's worker status without enqueueing", async () => {
    const original = await failedJob();
    const first = await service.retry("9", projectId, String(original.id), "worker-failure-key");
    const newJobId = BigInt(String(first.data?.job_id));
    await prisma.client.generation_jobs.update({ where: { id: newJobId }, data: {
      status: "failed", error: { code: "audio_mix_failed", message: "provider rejected" },
    } });
    const replay = await service.retry("9", projectId, String(original.id), "worker-failure-key");
    expect(replay.data).toMatchObject({ job_id: String(newJobId), status: "failed", replayed: true });
    expect(replay.data?.enqueue_required).toBe(false);
  });
});
