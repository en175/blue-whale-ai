import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
  const createdJobs: bigint[] = [];
  const snapshot = {
    source_node_id: "source-node",
    output_format: "flac",
    estimated_duration_ms: 7200000,
    provider_credential: "frozen-secret",
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
    const project = await prisma.client.project.create({ data: { owner_id: 9n, name: "IKI696 retry" } });
    projectId = String(project.id);
    service = new AudioMixesService(prisma, {} as never, {} as never, {} as never);
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
    await prisma.client.command_idempotency.deleteMany({ where: { project_id: BigInt(projectId) } });
    await prisma.client.generation_jobs.deleteMany({ where: { id: { in: createdJobs } } });
    await prisma.client.project.delete({ where: { id: BigInt(projectId) } });
    await prisma.client.$disconnect();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  async function failedJob() {
    const job = await prisma.client.generation_jobs.create({ data: {
      project_id: BigInt(projectId), user_id: 9n, type: "audio_mix", source: "dock",
      status: "failed", input: snapshot, error: { message: "previous failure" },
      provider_task_id: "old-provider-task", poll_count: 12, fencing_token: 7n,
      next_action_at: null,
    } });
    createdJobs.push(job.id);
    return job;
  }

  it("keeps the original identity and frozen inputs while replaying one retry key only once", async () => {
    const original = await failedJob();
    const first = await service.retry("9", projectId, String(original.id), "same-click");
    const replay = await service.retry("9", projectId, String(original.id), "same-click");
    const row = await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: original.id } });

    expect(first).toMatchObject({ code: 200, data: { job_id: String(original.id), status: "queued", replayed: false } });
    expect(replay).toMatchObject({ code: 200, data: { job_id: String(original.id), replayed: true } });
    expect(row.input).toEqual(snapshot);
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

  it("deduplicates simultaneous double clicks against the same failed job", async () => {
    const original = await failedJob();
    const calls = await Promise.all([
      service.retry("9", projectId, String(original.id), "double-click"),
      service.retry("9", projectId, String(original.id), "double-click"),
    ]);
    expect(calls.map((call) => call.data?.job_id)).toEqual([String(original.id), String(original.id)]);
    const row = await prisma.client.generation_jobs.findUniqueOrThrow({ where: { id: original.id } });
    expect(row.retry_count).toBe(1);
  });

  it("rejects retry after success", async () => {
    const original = await failedJob();
    await prisma.client.generation_jobs.update({ where: { id: original.id }, data: { status: "succeeded" } });
    await expect(service.retry("9", projectId, String(original.id), "late-retry"))
      .rejects.toMatchObject({ status: 409 });
  });

  it("accepts one business API retry and only enqueues the first request", async () => {
    const original = await failedJob();
    vi.mocked(enqueueAudioMixJob).mockClear();
    const url = `${baseUrl}/api/projects/${projectId}/audio-mixes/${original.id}/retry`;
    const send = () => fetch(url, { method: "POST", headers: { "Idempotency-Key": "browser-double-click" } });
    const first = await send();
    const second = await send();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await first.json()).toMatchObject({ data: { job_id: String(original.id), replayed: false } });
    expect(await second.json()).toMatchObject({ data: { job_id: String(original.id), replayed: true } });
    expect(vi.mocked(enqueueAudioMixJob).mock.calls).toEqual([[String(original.id)]]);
  });
});
