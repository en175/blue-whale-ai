import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AllExceptionsFilter } from "@lib/infra/filters/all-exceptions.filter.js";
import { FAILURE_CODE } from "@lib/contracts";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AudioMixesService } from "@lib/shared/audio-mixes/audio-mixes.service.js";
import { enqueueAudioMixJob } from "@lib/shared/generation/generation-queue.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { AudioMixesController } from "./audio-mixes.controller.js";

vi.mock("@lib/shared/generation/generation-queue.js", () => ({ enqueueAudioMixJob: vi.fn() }));

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
    class HarnessModule {}
    Module({ controllers: [AudioMixesController], providers: [
      { provide: AudioMixesService, useValue: service },
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
});
