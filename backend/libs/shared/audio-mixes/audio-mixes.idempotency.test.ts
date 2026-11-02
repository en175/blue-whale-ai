import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioMixesService } from "./audio-mixes.service.js";

const payload = {
  source_node_id: "node-1",
  inputs: [{ asset_id: "11", node_id: "node-1" }, { asset_id: "12" }],
  output_format: "mp3",
};

afterEach(() => vi.unstubAllGlobals());

describe("audio mix create idempotency", () => {
  it("replays the same job and rejects a changed request under the same key", async () => {
    const commands = new Map<string, { request_hash: string; generation_job_id: bigint }>();
    const jobs = new Map<bigint, { id: bigint; status: string; version: number; error: null }>();
    const client = {
      project_asset: { findMany: vi.fn().mockResolvedValue([]) },
      project_command_receipts: {
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
      project_id: 5n, type: "audio", url: `https://store.test/${id}.mp3`,
      storage_key: `uploads/9/audio/${id}.mp3`, duration_ms: 1000,
    })) };
    const storage = { uploads: { inspectObject: vi.fn(async (key: string) => ({ size: 10, publicUrl: `https://store.test/${key}` })) } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 206 })));
    const service = new AudioMixesService(
      { client } as never,
      project as never,
      assets as never,
      storage as never,
      { jobBilling: vi.fn().mockResolvedValue(undefined), release: vi.fn() } as never,
    );

    const first = await service.create("9", "5", payload, { idempotencyKey: "one-click" });
    const again = await service.create("9", "5", payload, { idempotencyKey: "one-click" });
    expect(first.data).toMatchObject({ job_id: "70", replayed: false, enqueue_required: true });
    expect(again.data).toMatchObject({ job_id: "70", replayed: true, enqueue_required: false });
    expect(client.generation_jobs.create).toHaveBeenCalledOnce();
    await expect(service.create("9", "5", { ...payload, output_format: "flac" }, { idempotencyKey: "one-click" }))
      .rejects.toMatchObject({ status: 409 });
    const legacy = await service.create("9", "5", payload);
    expect(legacy.data).toMatchObject({ job_id: "71", enqueue_required: true });
  });
});
