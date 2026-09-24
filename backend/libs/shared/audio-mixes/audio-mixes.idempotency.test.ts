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
      project_id: 5n, type: "audio", url: `https://store.test/${id}.mp3`,
      storage_key: `uploads/9/audio/${id}.mp3`, duration_ms: 1000,
    })) };
    const storage = { uploads: { inspectObject: vi.fn(async (key: string) => ({ size: 10, publicUrl: `https://store.test/${key}` })) } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 206 })));
    const service = new AudioMixesService({ client } as never, project as never, assets as never, storage as never);

    const first = await service.create("9", "5", payload, { idempotencyKey: "one-click", providerCredential: "sk-old" });
    const again = await service.create("9", "5", payload, { idempotencyKey: "one-click", providerCredential: "sk-new" });
    expect(first.data).toMatchObject({ job_id: "70", replayed: false, enqueue_required: true });
    expect(again.data).toMatchObject({ job_id: "70", replayed: true, enqueue_required: false });
    expect(client.generation_jobs.create).toHaveBeenCalledOnce();
    await expect(service.create("9", "5", { ...payload, output_format: "flac" }, { idempotencyKey: "one-click" }))
      .rejects.toMatchObject({ status: 409 });
    const legacy = await service.create("9", "5", payload);
    expect(legacy.data).toMatchObject({ job_id: "71", enqueue_required: true });
  });
});

describe("audio mix retry credential refresh", () => {
  it.each([
    ["keeps the frozen media while retrying a structured 401", {
      code: "audio_mix_failed", message: "上游凭证被拒绝",
      details: { raw: "上游凭证被拒绝", http_status: 401 },
    }, "sk-new"],
    ["keeps the frozen credential for a structured non-401 status", {
      code: "audio_mix_failed", message: "上游暂时不可用",
      details: { raw: "上游暂时不可用", http_status: 500 },
    }, "sk-old"],
    ["treats the structured status as authoritative over a 401-looking message", {
      code: "audio_mix_failed", message: "任务查询失败: HTTP 401 body=unexpected",
      details: { raw: "任务查询失败: HTTP 401 body=unexpected", http_status: 500 },
    }, "sk-old"],
    ["keeps the frozen media while retrying a legacy 401 message", {
      code: "audio_mix_failed", message: "MediaKit 混音任务查询失败: HTTP 401 body=unauthorized",
    }, "sk-new"],
    ["keeps the frozen credential for a legacy non-401 message", {
      code: "audio_mix_failed", message: "MediaKit 混音任务查询失败: HTTP 500 body=unavailable",
    }, "sk-old"],
    ["keeps the frozen credential when the message mentions no 401 and no structured status", {
      code: "audio_mix_failed", message: "上游拒绝访问，请稍后重试",
    }, "sk-old"],
  ])("%s", async (_, error, expectedCredential) => {
    const originalInput = { source_node_id: "node-1", output_format: "mp3", inputs: [{ asset_id: "11", url: "https://store.test/a" }], provider_credential: "sk-old" };
    const job = { id: 70n, status: "failed", fencing_token: 3n, version: 0,
      input: originalInput, error };
    let command: { request_hash: string; generation_job_id: bigint } | null = null;
    const client = {
      generation_jobs: {
        findFirst: vi.fn(async () => job),
        findUniqueOrThrow: vi.fn(async () => job),
        updateMany: vi.fn(async ({ data }: { data: { input?: typeof originalInput } }) => {
          if (data.input) job.input = data.input;
          job.status = "queued";
          return { count: 1 };
        }),
      },
      command_idempotency: {
        findUnique: vi.fn(async () => command),
        create: vi.fn(async ({ data }: { data: { request_hash: string; generation_job_id: bigint } }) => { command = data; }),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
    };
    const service = new AudioMixesService({ client } as never, {} as never, {} as never, {} as never);
    await service.retry("9", "5", "70", "retry-one", "sk-new");
    expect(job.input).toEqual({ ...originalInput, provider_credential: expectedCredential });
    await service.retry("9", "5", "70", "retry-one", "sk-later");
    expect(job.input.provider_credential).toBe(expectedCredential);
  });
});
