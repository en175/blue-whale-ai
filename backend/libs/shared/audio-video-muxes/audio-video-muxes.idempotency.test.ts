import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioVideoMuxesService } from "./audio-video-muxes.service.js";

const payload = {
  audio: { assetId: "11", nodeId: "node-audio" },
  video: { assetId: "12" },
};

afterEach(() => vi.unstubAllGlobals());

describe("audio video mux create idempotency", () => {
  it("replays the same job and rejects a changed request under the same key", async () => {
    const commands = new Map<string, { request_hash: string; generation_job_id: bigint }>();
    const jobs = new Map<bigint, { id: bigint; status: string; version: number; error: null }>();
    const client = {
      project_asset: { findMany: vi.fn().mockResolvedValue([]) },
      command_idempotency: {
        findUnique: vi.fn(async ({ where }: { where: { project_id_operation_idempotency_key: { idempotency_key: string } } }) =>
          commands.get(where.project_id_operation_idempotency_key.idempotency_key) ?? null),
        create: vi.fn(async ({ data }: { data: { idempotency_key: string; request_hash: string; generation_job_id: bigint } }) => {
          if (commands.has(data.idempotency_key)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
          commands.set(data.idempotency_key, data);
        }),
      },
      generation_jobs: {
        create: vi.fn(async () => {
          const job = { id: BigInt(jobs.size + 70), status: "queued", version: 0, error: null };
          jobs.set(job.id, job);
          return job;
        }),
        findFirst: vi.fn(async ({ where }: { where: { id: bigint } }) => jobs.get(where.id) ?? null),
        findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: bigint } }) => jobs.get(where.id)!),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
    };
    const project = { findOwnedById: vi.fn().mockResolvedValue({ id: 5n }) };
    const assets = { findOwnedSource: vi.fn(async (id: string) => ({
      project_id: 5n, type: id === "11" ? "audio" : "video", url: `https://store.test/${id}.mp4`,
      storage_key: `${id}.mp4`, duration_ms: 10_000, width: 1920, height: 1080,
    })) };
    const storage = { uploads: { inspectObject: vi.fn(async (key: string) => ({ size: 10, publicUrl: `https://store.test/${key}` })) } };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, body: { cancel: vi.fn() } })));
    const service = new AudioVideoMuxesService({ client } as never, project as never, assets as never, storage as never, { jobBilling: vi.fn().mockResolvedValue(undefined), release: vi.fn() } as never);

    const first = await service.create("9", "5", payload, { idempotencyKey: "one-click" });
    const again = await service.create("9", "5", payload, { idempotencyKey: "one-click" });
    expect(first.data).toMatchObject({ job_id: "70", replayed: false, enqueue_required: true });
    expect(again.data).toMatchObject({ job_id: "70", replayed: true, enqueue_required: false });
    expect(client.generation_jobs.create).toHaveBeenCalledOnce();
    expect(storage.uploads.inspectObject.mock.calls).toEqual([["11.mp4"], ["12.mp4"]]);
    await expect(service.create("9", "5", { ...payload, sync: "video" }, { idempotencyKey: "one-click" }))
      .rejects.toMatchObject({ status: 409 });
    const legacy = await service.create("9", "5", payload);
    expect(legacy.data).toMatchObject({ job_id: "71", enqueue_required: true });
  });

  it("create replay does not resume a failed enqueue; a retry must create a new job", async () => {
    const job = { id: 70n, status: "queued", version: 0, error: null as object | null, input: { duration: 1, resolution: "1080p" } };
    let command: { request_hash: string; generation_job_id: bigint } | null = null;
    const client = {
      project_asset: { findMany: vi.fn().mockResolvedValue([]) },
      command_idempotency: {
        findUnique: vi.fn(async () => command),
        create: vi.fn(async ({ data }: { data: { request_hash: string; generation_job_id: bigint } }) => {
          command = data;
        }),
      },
      generation_jobs: {
        create: vi.fn(async () => job),
        findFirst: vi.fn(async () => job),
        findUniqueOrThrow: vi.fn(async () => job),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
    };
    const project = { findOwnedById: vi.fn().mockResolvedValue({ id: 5n }) };
    const assets = { findOwnedSource: vi.fn(async (id: string) => ({
      project_id: 5n, type: id === "11" ? "audio" : "video", url: `https://store.test/${id}.mp4`,
      storage_key: `${id}.mp4`, duration_ms: 10_000, width: 1920, height: 1080,
    })) };
    const storage = { uploads: { inspectObject: vi.fn(async (key: string) => ({ size: 10, publicUrl: `https://store.test/${key}` })) } };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, body: { cancel: vi.fn() } })));
    const service = new AudioVideoMuxesService({ client } as never, project as never, assets as never, storage as never, { jobBilling: vi.fn().mockResolvedValue(undefined), release: vi.fn() } as never);

    const first = await service.create("9", "5", payload, { idempotencyKey: "recover-key" });
    expect(first.data).toMatchObject({ job_id: "70", replayed: false, enqueue_required: true });
    Object.assign(job, { status: "failed", version: 1, error: { code: "enqueue_failed", message: "任务入队失败" } });
    const replayed = await service.create("9", "5", payload, { idempotencyKey: "recover-key" });
    expect(replayed.data).toMatchObject({ job_id: "70", status: "failed", replayed: true, enqueue_required: false });
    expect(client.generation_jobs.create).toHaveBeenCalledOnce();
    expect(client.generation_jobs.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["over 128 chars", "k".repeat(129)],
    ["with whitespace", "bad key"],
  ])("rejects an %s idempotency key before probing anything", async (_reason, idempotencyKey) => {
    const client = {
      project_asset: { findMany: vi.fn().mockResolvedValue([]) },
      command_idempotency: { findUnique: vi.fn(), create: vi.fn() },
      generation_jobs: { create: vi.fn() },
    };
    const project = { findOwnedById: vi.fn().mockResolvedValue({ id: 5n }) };
    const assets = { findOwnedSource: vi.fn() };
    const storage = { uploads: { inspectObject: vi.fn() } };
    const service = new AudioVideoMuxesService({ client } as never, project as never, assets as never, storage as never, { jobBilling: vi.fn().mockResolvedValue(undefined), release: vi.fn() } as never);
    await expect(service.create("9", "5", payload, { idempotencyKey })).rejects.toMatchObject({ status: 400 });
    expect(storage.uploads.inspectObject).not.toHaveBeenCalled();
    expect(client.generation_jobs.create).not.toHaveBeenCalled();
  });
});
