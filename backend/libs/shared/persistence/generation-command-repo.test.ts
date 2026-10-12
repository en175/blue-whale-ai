import { describe, expect, it, vi } from "vitest";

import type { BillingChargeContext } from "@lib/shared/billing/billing-charge.js";

import {
  createGenerationCommandRepo,
  createJobWithinTx,
  type CreateJobInput,
} from "./generation-command-repo.js";
import {
  CREATE_GENERATION_JOB_OPERATION,
  type CreateJobResult,
} from "./generation-job-idempotency.js";

vi.mock("./model-capability-cache.js", () => ({
  getModelCapabilityList: vi.fn().mockResolvedValue(null),
  setModelCapabilityList: vi.fn().mockResolvedValue(undefined),
}));

const RETRY_PRICING = {
  baseUnit: "usage.seconds",
  basePrice: { kind: "const", value: 13000 },
};

function capabilityDelegate(rows: unknown[]) {
  return { findMany: vi.fn().mockResolvedValue(rows) };
}

function capabilityRow(overrides: Record<string, unknown> = {}) {
  return {
    model_id: "seedance-2.0-pro",
    capability_type: "video",
    enabled: true,
    is_delete: false,
    provider_id: "volc",
    model_label: "Seedance 2.0 Pro",
    icon: null,
    sort_order: 0,
    supported_sizes: [],
    supported_aspect_ratios: [],
    supported_formats: [],
    supported_durations: null,
    default_size: "1k",
    default_format: null,
    default_aspect_ratio: "1:1",
    default_duration: null,
    features: {},
    channel: null,
    request_mapping: null,
    is_default: false,
    version: 1,
    pricing: RETRY_PRICING,
    ...overrides,
  };
}

interface ExtraUpsertArg {
  where: {
    generation_job_id_extra_key: { generation_job_id: bigint; extra_key: string };
  };
  create: {
    generation_job_id: bigint;
    extra_key: string;
    value_type: string;
    value_text: string;
  };
  update: { value_type: string; value_text: string; gmt_modified: Date };
}

function extrasDelegate(rows: unknown[] = []) {
  return {
    upsert: vi.fn(async (_arg: ExtraUpsertArg) => ({})),
    findMany: vi.fn(async (_arg: { where: Record<string, unknown> }) => rows),
    deleteMany: vi.fn(async (_arg: { where: Record<string, unknown> }) => ({ count: 0 })),
  };
}

function expectExtraWrite(
  upsert: ReturnType<typeof vi.fn>,
  jobId: bigint,
  extra_key: string,
  value_type: string,
  value_text: string,
): void {
  expect(upsert).toHaveBeenCalledWith(
    {
      where: { generation_job_id_extra_key: { generation_job_id: jobId, extra_key } },
      create: { generation_job_id: jobId, extra_key, value_type, value_text },
      update: { value_type, value_text, gmt_modified: expect.any(Date) },
    } satisfies ExtraUpsertArg,
  );
}

describe("generation command placement anchor", () => {
  it("freezes the SceneCard output anchor in the job input", async () => {
    const createJob = vi.fn().mockResolvedValue({
      id: 300n,
      type: "video",
      source: "scene_card",
      status: "queued",
      progress: 0,
      version: 1,
    });
    const tx = {
      canvas: {
        findFirst: vi.fn().mockResolvedValue({
          viewport_json: { x: 0, y: 0, zoom: 1 },
          nodes_json: [
            {
              type: "scene_card",
              scene_card_id: "66",
              position: { x: 100, y: 200 },
              width: 400,
              height: 320,
            },
          ],
        }),
      },
      generation_jobs: { create: createJob },
      generation_job_extras: extrasDelegate(),
      generation_output_slots: { create: vi.fn().mockResolvedValue({}) },
      cost_reservations: { create: vi.fn().mockResolvedValue({}) },
      generation_job_logs: { create: vi.fn().mockResolvedValue({}) },
      project_events: {
        create: vi.fn(
          async ({ data }: { data: Record<string, unknown> }) => data,
        ),
      },
    };

    await createJobWithinTx(tx as never, {
      projectId: "55",
      userId: "9",
      type: "video",
      expectedOutputCount: 1,
      input: { prompt: "whale" },
      actionIdentity: "generate-300",
      actionType: "video.generate",
      source: "scene_card",
      sceneCardId: "66",
    });

    expect(createJob).toHaveBeenCalledWith({
      data: expect.objectContaining({
        input: {
          prompt: "whale",
          placement_anchor: { x: 100, y: 200, width: 400, height: 320 },
          expected_output_count: 1,
        },
      }),
    });
  });

  it("SceneCard 尚未落库时把无尺寸卡片视为完整兼容矩形", async () => {
    const createJob = vi.fn().mockResolvedValue({
      id: 300n,
      type: "video",
      source: "scene_card",
      status: "queued",
      progress: 0,
      version: 1,
    });
    const tx = {
      canvas: {
        findFirst: vi.fn().mockResolvedValue({
          viewport_json: { x: 0, y: 0, zoom: 1 },
          nodes_json: [
            {
              id: "blocker",
              type: "scene_card",
              position: { x: -624, y: -1104 },
            },
          ],
        }),
      },
      generation_jobs: { create: createJob },
      generation_job_extras: extrasDelegate(),
      generation_output_slots: { create: vi.fn().mockResolvedValue({}) },
      cost_reservations: { create: vi.fn().mockResolvedValue({}) },
      generation_job_logs: { create: vi.fn().mockResolvedValue({}) },
      project_events: {
        create: vi.fn(
          async ({ data }: { data: Record<string, unknown> }) => data,
        ),
      },
    };

    await createJobWithinTx(tx as never, {
      projectId: "55",
      userId: "9",
      type: "video",
      expectedOutputCount: 1,
      input: { prompt: "whale" },
      actionIdentity: "generate-300",
      actionType: "video.generate",
      source: "scene_card",
      sceneCardId: "66",
    });

    expect(createJob).toHaveBeenCalledWith({
      data: expect.objectContaining({
        input: {
          prompt: "whale",
          placement_anchor: { x: 0, y: -1104, width: 400, height: 1080 },
          expected_output_count: 1,
        },
      }),
    });
  });

  it("Canvas 行不存在时也冻结非零的兼容矩形", async () => {
    const createJob = vi.fn().mockResolvedValue({
      id: 300n,
      type: "video",
      source: "scene_card",
      status: "queued",
      progress: 0,
      version: 1,
    });
    const tx = {
      canvas: { findFirst: vi.fn().mockResolvedValue(null) },
      generation_jobs: { create: createJob },
      generation_job_extras: extrasDelegate(),
      generation_output_slots: { create: vi.fn().mockResolvedValue({}) },
      cost_reservations: { create: vi.fn().mockResolvedValue({}) },
      generation_job_logs: { create: vi.fn().mockResolvedValue({}) },
      project_events: {
        create: vi.fn(
          async ({ data }: { data: Record<string, unknown> }) => data,
        ),
      },
    };

    await createJobWithinTx(tx as never, {
      projectId: "55",
      userId: "9",
      type: "video",
      expectedOutputCount: 1,
      input: { prompt: "whale" },
      actionIdentity: "generate-300",
      actionType: "video.generate",
      source: "scene_card",
      sceneCardId: "66",
    });

    expect(createJob).toHaveBeenCalledWith({
      data: expect.objectContaining({
        input: {
          prompt: "whale",
          placement_anchor: { x: -424, y: -1104, width: 400, height: 1080 },
          expected_output_count: 1,
        },
      }),
    });
  });
});

describe("generation command repo retry", () => {
  it("keeps the logical slot index and marks its record generating", async () => {
    const createSlot = vi.fn().mockResolvedValue({});
    const updateRecord = vi.fn().mockResolvedValue({
      id: 88n,
      project_id: 55n,
      version: 2,
    });
    const tx = {
      generation_jobs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 300n,
          project_id: 55n,
          user_id: 9n,
          type: "video",
          source: "scene_card",
          status: "failed",
          input: {},
        }),
        create: vi.fn().mockResolvedValue({
          id: 301n,
          type: "video",
          source: "scene_card",
          status: "queued",
          progress: 0,
          version: 1,
        }),
      },
      generation_output_slots: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 77n,
            project_id: 55n,
            generation_job_id: 300n,
            slot_index: 3,
            status: "failed",
            retry_of_slot_id: null,
            scene_card_generation_record_id: 88n,
          },
        ]),
        create: createSlot,
      },
      scene_card_generation_records: { update: updateRecord },
      generation_job_extras: extrasDelegate(),
      cost_reservations: {
        findFirst: vi.fn().mockResolvedValue({
          reserved_amount_fen: 1234n,
          price_catalog_version: "v-pricing",
          exchange_rate_version: "usd-7.3",
          model_policy_version: "v-policy",
          cost_rule_version: "v1",
        }),
        create: vi.fn().mockResolvedValue({}),
      },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      project_events: {
        create: vi.fn(
          async ({ data }: { data: Record<string, unknown> }) => data,
        ),
      },
      generation_job_logs: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const repo = createGenerationCommandRepo(prisma as never);

    await repo.retryJob("300", "55", "9", "retry-300", "hash-300");

    expect(tx.generation_jobs.findFirst).toHaveBeenCalledWith({
      where: {
        id: 300n,
        project_id: 55n,
        user_id: 9n,
        is_delete: false,
      },
    });

    expect(createSlot).toHaveBeenCalledWith({
      data: expect.objectContaining({ slot_index: 3, retry_of_slot_id: 77n }),
    });
    expect(updateRecord).toHaveBeenCalledWith({
      where: { id: 88n },
      data: { summary_status: "generating", version: { increment: 1 } },
    });
    expect(tx.project_events.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event_type: "scene_card_generation_record.summary_changed",
        aggregate_version: 2,
        payload: { record_id: "88", summary_status: "generating" },
      }),
    });
    const jobEventCall = tx.project_events.create.mock.calls.find(
      ([args]) =>
        (args as { data: { event_type: string } }).data.event_type ===
        "generation_job.created",
    );
    const eventCursor = (
      jobEventCall?.[0] as {
        data: { cursor: bigint };
      }
    ).data.cursor;
    expect(tx.command_idempotency.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ accepted_cursor: eventCursor }),
    });
  });

  it("★ 重试是新建任务 → 对新 job 扣一次费（提交即扣）", async () => {
    const tx = {
      generation_jobs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 300n,
          project_id: 55n,
          user_id: 9n,
          type: "video",
          source: "scene_card",
          status: "failed",
          input: { prompt: "whale", model_id: "seedance-2.0-pro" },
        }),
        create: vi.fn().mockResolvedValue({
          id: 301n,
          type: "video",
          source: "scene_card",
          status: "queued",
          progress: 0,
          version: 1,
        }),
      },
      generation_output_slots: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({}),
      },
      generation_job_extras: extrasDelegate(),
      cost_reservations: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      project_events: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      },
      generation_job_logs: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
      generation_model_capability: capabilityDelegate([capabilityRow()]),
    };
    const repo = createGenerationCommandRepo(prisma as never);
    const charge = vi.fn(async () => {});
    const release = vi.fn(async () => {});

    const result = await repo.retryJob(
      "300",
      "55",
      "9",
      "retry-300",
      "hash-300",
      undefined,
      undefined,
      { charge, release },
    );

    expect(result).toMatchObject({ generation_job_id: "301" });
    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "9",
        jobId: 301,
        taskType: "video",
        modelId: "seedance-2.0-pro",
        input: { prompt: "whale", model_id: "seedance-2.0-pro" },
        ruleSnapshot: JSON.stringify(RETRY_PRICING),
      }),
    );
    expect(release).not.toHaveBeenCalled();
  });

  it("★ 重试扣费后事务失败 → 补偿返还（与创建路径同口径）", async () => {
    const tx = {
      generation_jobs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 300n,
          project_id: 55n,
          user_id: 9n,
          type: "video",
          source: "scene_card",
          status: "failed",
          input: { prompt: "whale", model_id: "seedance-2.0-pro" },
        }),
        create: vi.fn().mockResolvedValue({
          id: 301n,
          type: "video",
          source: "scene_card",
          status: "queued",
          progress: 0,
          version: 1,
        }),
      },
      generation_output_slots: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({}),
      },
      generation_job_extras: extrasDelegate(),
      cost_reservations: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      project_events: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      },
      generation_job_logs: {
        create: vi
          .fn()
          .mockRejectedValue(
            new Error("We could not serialize [object Function] value"),
          ),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
      generation_model_capability: capabilityDelegate([capabilityRow()]),
    };
    const repo = createGenerationCommandRepo(prisma as never);
    const charge = vi.fn(async () => {});
    const release = vi.fn(async () => {});

    await expect(
      repo.retryJob("300", "55", "9", "retry-300", "hash-300", undefined, undefined, {
        charge,
        release,
      }),
    ).rejects.toThrow("could not serialize");

    expect(charge).toHaveBeenCalledWith(expect.objectContaining({ jobId: 301 }));
    expect(release).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 301 }),
    );
  });

  it("再次重试根 Job 时只补仍失败的逻辑槽", async () => {
    const allSlots = [
      {
        id: 77n,
        project_id: 55n,
        generation_job_id: 300n,
        slot_index: 0,
        status: "failed",
        retry_of_slot_id: null,
        scene_card_generation_record_id: null,
      },
      {
        id: 79n,
        project_id: 55n,
        generation_job_id: 300n,
        slot_index: 1,
        status: "failed",
        retry_of_slot_id: null,
        scene_card_generation_record_id: null,
      },
      {
        id: 78n,
        project_id: 55n,
        generation_job_id: 301n,
        slot_index: 0,
        status: "succeeded",
        retry_of_slot_id: 77n,
        scene_card_generation_record_id: null,
      },
    ];
    const createSlot = vi.fn().mockResolvedValue({});
    const createJob = vi.fn().mockResolvedValue({
      id: 302n,
      type: "image",
      source: "bottom_dock",
      status: "queued",
      progress: 0,
      version: 1,
    });
    const tx = {
      generation_jobs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 300n,
          project_id: 55n,
          user_id: 9n,
          type: "image",
          source: "bottom_dock",
          status: "partially_succeeded",
          input: {},
        }),
        create: createJob,
      },
      generation_output_slots: {
        findMany: vi.fn(
          async ({ where }: { where: Record<string, unknown> }) =>
            "generation_job_id" in where
              ? allSlots.filter(
                  (slot) =>
                    slot.generation_job_id === where.generation_job_id &&
                    slot.status !== "succeeded",
                )
              : allSlots,
        ),
        create: createSlot,
      },
      generation_job_extras: extrasDelegate(),
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      cost_reservations: {
        findFirst: vi.fn().mockResolvedValue({
          reserved_amount_fen: 1234n,
          price_catalog_version: "v-pricing",
          exchange_rate_version: "usd-7.3",
          model_policy_version: "v-policy",
          cost_rule_version: "v1",
        }),
        create: vi.fn().mockResolvedValue({}),
      },
      project_events: {
        create: vi.fn(
          async ({ data }: { data: Record<string, unknown> }) => data,
        ),
      },
      generation_job_logs: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const repo = createGenerationCommandRepo(prisma as never);

    await repo.retryJob("300", "55", "9", "retry-302", "hash-302");

    expect(createJob).toHaveBeenCalledWith({
      data: expect.objectContaining({ retry_of_job_id: 300n }),
    });
    expectExtraWrite(tx.generation_job_extras.upsert, 302n, "strategy_version", "string", "image-sync-v1");
    expect(createSlot).toHaveBeenCalledTimes(1);
    expect(createSlot).toHaveBeenCalledWith({
      data: expect.objectContaining({ slot_index: 1, retry_of_slot_id: 79n }),
    });
  });

  it("逻辑槽已由历史重试补成功时不再创建重试 Job（IKIPWU：带 already_retried 原因返回）", async () => {
    const createJob = vi.fn();
    const createSlot = vi.fn();
    const tx = {
      generation_jobs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 300n,
          project_id: 55n,
          user_id: 9n,
          type: "image",
          source: "bottom_dock",
          status: "failed",
          input: {},
        }),
        create: createJob,
      },
      generation_output_slots: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 77n,
            project_id: 55n,
            generation_job_id: 300n,
            slot_index: 0,
            status: "failed",
            retry_of_slot_id: null,
            scene_card_generation_record_id: null,
          },
          {
            id: 78n,
            project_id: 55n,
            generation_job_id: 301n,
            slot_index: 0,
            status: "succeeded",
            retry_of_slot_id: 77n,
            scene_card_generation_record_id: null,
          },
        ]),
        create: createSlot,
      },
      generation_job_extras: extrasDelegate(),
      cost_reservations: {
        findFirst: vi.fn().mockResolvedValue({
          reserved_amount_fen: 1234n,
          price_catalog_version: "v-pricing",
          exchange_rate_version: "usd-7.3",
          model_policy_version: "v-policy",
          cost_rule_version: "v1",
        }),
        create: vi.fn().mockResolvedValue({}),
      },
      command_idempotency: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const repo = createGenerationCommandRepo(prisma as never);

    const result = await repo.retryJob(
      "300",
      "55",
      "9",
      "retry-303",
      "hash-303",
    );

    expect(result).toEqual({ kind: "already_retried" });
    expect(createJob).not.toHaveBeenCalled();
    expect(createSlot).not.toHaveBeenCalled();
  });

  it("原 job 状态非终态 failed/partially_succeeded 时带 not_retryable_status 原因返回（IKIPWU）", async () => {
    const createJob = vi.fn();
    const tx = {
      generation_jobs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 300n,
          project_id: 55n,
          user_id: 9n,
          type: "image",
          source: "bottom_dock",
          status: "succeeded",
          input: {},
        }),
        create: createJob,
      },
      generation_output_slots: { findMany: vi.fn(), create: vi.fn() },
      generation_job_extras: extrasDelegate(),
      cost_reservations: { findFirst: vi.fn(), create: vi.fn() },
      command_idempotency: { findUnique: vi.fn(), create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    const repo = createGenerationCommandRepo(prisma as never);

    const result = await repo.retryJob(
      "300",
      "55",
      "9",
      "retry-304",
      "hash-304",
    );

    expect(result).toEqual({ kind: "not_retryable_status" });
    expect(createJob).not.toHaveBeenCalled();
  });

  it("replays the committed receipt after a concurrent idempotency race", async () => {
    const original = {
      id: 300n,
      project_id: 55n,
      user_id: 9n,
      type: "video",
      source: "scene_card",
      status: "failed",
      input: {},
    };
    const firstTx = {
      generation_jobs: {
        findFirst: vi.fn().mockResolvedValue(original),
        create: vi.fn().mockResolvedValue({
          id: 301n,
          type: "video",
          source: "scene_card",
          status: "queued",
          progress: 0,
          version: 1,
        }),
      },
      generation_output_slots: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({}),
      },
      generation_job_extras: extrasDelegate(),
      cost_reservations: {
        findFirst: vi.fn().mockResolvedValue({
          reserved_amount_fen: 1234n,
          price_catalog_version: "v-pricing",
          exchange_rate_version: "usd-7.3",
          model_policy_version: "v-policy",
          cost_rule_version: "v1",
        }),
        create: vi.fn().mockResolvedValue({}),
      },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi
          .fn()
          .mockRejectedValue(
            Object.assign(new Error("unique"), { code: "P2002" }),
          ),
      },
      project_events: {
        create: vi.fn(
          async ({ data }: { data: Record<string, unknown> }) => data,
        ),
      },
      generation_job_logs: { create: vi.fn().mockResolvedValue({}) },
    };
    const secondTx = {
      generation_jobs: { findFirst: vi.fn().mockResolvedValue(original) },
      generation_job_extras: extrasDelegate(),
      cost_reservations: {
        findFirst: vi.fn().mockResolvedValue({
          reserved_amount_fen: 1234n,
          price_catalog_version: "v-pricing",
          exchange_rate_version: "usd-7.3",
          model_policy_version: "v-policy",
          cost_rule_version: "v1",
        }),
      },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue({
          request_hash: "hash-300",
          generation_job_id: 999n,
          accepted_cursor: 123n,
        }),
      },
    };
    let attempt = 0;
    const prisma = {
      $transaction: vi.fn(
        async (callback: (client: never) => Promise<unknown>) => {
          attempt += 1;
          return callback((attempt === 1 ? firstTx : secondTx) as never);
        },
      ),
    };
    const repo = createGenerationCommandRepo(prisma as never);

    const result = await repo.retryJob(
      "300",
      "55",
      "9",
      "retry-300",
      "hash-300",
    );

    expect(result).toEqual({
      generation_job_id: "999",
      cursor: 123,
      type: "video",
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(secondTx.command_idempotency.findUnique).toHaveBeenCalledOnce();
  });

  describe("retryJob 素材状态门（IKF YHJ）", () => {
    function retryTx(original: Record<string, unknown>) {
      const createJob = vi.fn().mockResolvedValue({
        id: 302n,
        type: "video",
        source: "scene_card",
        status: "queued",
        progress: 0,
        version: 1,
      });
      const tx = {
        generation_jobs: {
          findFirst: vi.fn().mockResolvedValue(original),
          create: createJob,
        },
        generation_job_extras: extrasDelegate(),
        generation_output_slots: {
          findMany: vi.fn().mockResolvedValue([]),
          create: vi.fn().mockResolvedValue({}),
        },
        cost_reservations: {
          findFirst: vi.fn().mockResolvedValue({
            reserved_amount_fen: 1234n,
            price_catalog_version: "v-pricing",
            exchange_rate_version: "usd-7.3",
            model_policy_version: "v-policy",
            cost_rule_version: "v1",
          }),
          create: vi.fn().mockResolvedValue({}),
        },
        command_idempotency: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
        },
        project_events: {
          create: vi.fn(
            async ({ data }: { data: Record<string, unknown> }) => data,
          ),
        },
        generation_job_logs: { create: vi.fn().mockResolvedValue({}) },
      };
      const prisma = {
        $transaction: vi.fn(
          async (callback: (client: typeof tx) => Promise<unknown>) =>
            callback(tx),
        ),
      };
      return { tx, prisma, createJob };
    }

    const failedOriginal = {
      id: 300n,
      project_id: 55n,
      user_id: 9n,
      type: "video",
      source: "scene_card",
      status: "failed",
      input: { references: [{ material_id: "asset-abc" }], expected_output_count: 1 },
      strategy_version: "seedance-2.0-v1",
    };

    it("门拒绝时不建重试 Job，并把原因带出来", async () => {
      const { prisma, createJob } = retryTx(failedOriginal);
      const repo = createGenerationCommandRepo(prisma as never);
      const guardInput = vi.fn().mockResolvedValue("该素材未审核通过，不能用于视频生成");

      const result = await repo.retryJob(
        "300",
        "55",
        "9",
        "retry-400",
        "hash-400",
        guardInput,
      );

      expect(result).toEqual({
        kind: "material_blocked",
        reason: "该素材未审核通过，不能用于视频生成",
      });
      expect(guardInput).toHaveBeenCalledWith(failedOriginal.input, "video");
      expect(createJob).not.toHaveBeenCalled();
    });

    it("门放行时照常建重试 Job", async () => {
      const { prisma, createJob } = retryTx(failedOriginal);
      const repo = createGenerationCommandRepo(prisma as never);
      const guardInput = vi.fn().mockResolvedValue(null);

      const result = await repo.retryJob(
        "300",
        "55",
        "9",
        "retry-401",
        "hash-401",
        guardInput,
      );

      expect(guardInput).toHaveBeenCalledOnce();
      expect(createJob).toHaveBeenCalledOnce();
      expect(result).toMatchObject({ generation_job_id: "302", type: "video" });
    });

    it("幂等重放命中既有回执时不跑门——不该被此刻的素材状态改写既有结果", async () => {
      const replayTx = {
        generation_jobs: {
          findFirst: vi.fn().mockResolvedValue(failedOriginal),
          create: vi.fn(),
        },
        generation_job_extras: extrasDelegate(),
        cost_reservations: {
          findFirst: vi.fn().mockResolvedValue({
            reserved_amount_fen: 1234n,
            price_catalog_version: "v-pricing",
            exchange_rate_version: "usd-7.3",
            model_policy_version: "v-policy",
            cost_rule_version: "v1",
          }),
        },
        command_idempotency: {
          findUnique: vi.fn().mockResolvedValue({
            request_hash: "hash-402",
            generation_job_id: 999n,
            accepted_cursor: 7n,
          }),
        },
      };
      const prisma = {
        $transaction: vi.fn(
          async (callback: (client: typeof replayTx) => Promise<unknown>) =>
            callback(replayTx),
        ),
      };
      const repo = createGenerationCommandRepo(prisma as never);
      const guardInput = vi.fn().mockResolvedValue(null);

      const result = await repo.retryJob(
        "300",
        "55",
        "9",
        "retry-402",
        "hash-402",
        guardInput,
      );

      expect(result).toEqual({
        generation_job_id: "999",
        cursor: 7,
        type: "video",
      });
      expect(guardInput).not.toHaveBeenCalled();
    });

    it("未接线时不跑门（缺省行为与改造前一致）", async () => {
      const { prisma, createJob } = retryTx(failedOriginal);
      const repo = createGenerationCommandRepo(prisma as never);

      const result = await repo.retryJob(
        "300",
        "55",
        "9",
        "retry-403",
        "hash-403",
      );

      expect(createJob).toHaveBeenCalledOnce();
      expect(result).toMatchObject({ generation_job_id: "302" });
    });
  });
});

describe("retryJob 计费快照（IKL406：重试的 charge 必须带 rule_snapshot）", () => {
  function retryHarness(capabilityRows: unknown[]) {
    const tx = {
      generation_jobs: {
        findFirst: vi.fn().mockResolvedValue({
          id: 300n,
          project_id: 55n,
          user_id: 9n,
          type: "video",
          source: "scene_card",
          status: "failed",
          input: { prompt: "whale", model_id: "seedance-2.0-pro" },
        }),
        create: vi.fn().mockResolvedValue({
          id: 301n,
          type: "video",
          source: "scene_card",
          status: "queued",
          progress: 0,
          version: 1,
        }),
      },
      generation_output_slots: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({}),
      },
      generation_job_extras: extrasDelegate(),
      cost_reservations: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      project_events: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      },
      generation_job_logs: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
      generation_model_capability: capabilityDelegate(capabilityRows),
    };
    const repo = createGenerationCommandRepo(prisma as never);
    const charge = vi.fn(async (_ctx: BillingChargeContext) => {});
    const release = vi.fn(async () => {});
    return { repo, charge, release, billing: { charge, release } };
  }

  it("★ charge 收到的 rule_snapshot 与能力行 pricing 的 JSON.stringify 逐字相同", async () => {
    const { repo, charge, release, billing } = retryHarness([capabilityRow()]);

    await repo.retryJob(
      "300",
      "55",
      "9",
      "retry-500",
      "hash-500",
      undefined,
      undefined,
      billing,
    );

    expect(charge).toHaveBeenCalledTimes(1);
    const ctx = charge.mock.calls[0]![0];
    expect(ctx.modelId).toBe("seedance-2.0-pro");
    expect(ctx.ruleSnapshot).toBe(JSON.stringify(RETRY_PRICING));
    expect(release).not.toHaveBeenCalled();
  });

  it("★ 查不到能力行 → 不带 rule_snapshot（与创建路径同口径：交给 billing 拒单）", async () => {
    const { repo, charge, billing } = retryHarness([]);

    await repo.retryJob(
      "300",
      "55",
      "9",
      "retry-501",
      "hash-501",
      undefined,
      undefined,
      billing,
    );

    expect(charge).toHaveBeenCalledTimes(1);
    expect(
      Object.prototype.hasOwnProperty.call(charge.mock.calls[0]![0], "ruleSnapshot"),
    ).toBe(false);
  });

  it("★ 能力行存在但没配价（pricing=null）→ 同样不带 rule_snapshot", async () => {
    const { repo, charge, billing } = retryHarness([capabilityRow({ pricing: null })]);

    await repo.retryJob(
      "300",
      "55",
      "9",
      "retry-502",
      "hash-502",
      undefined,
      undefined,
      billing,
    );

    expect(charge).toHaveBeenCalledTimes(1);
    expect(
      Object.prototype.hasOwnProperty.call(charge.mock.calls[0]![0], "ruleSnapshot"),
    ).toBe(false);
  });
});

describe("generation command repo billing（预扣与失败补偿）", () => {
  const JOB_INPUT = {
    projectId: "55",
    userId: "9",
    type: "video" as const,
    expectedOutputCount: 1,
    input: { prompt: "whale" },
    actionIdentity: "act-1",
    actionType: "generate_video",
  };

  function createTx(options: { failAtLog?: boolean } = {}) {
    const tx = {
      generation_jobs: {
        create: vi.fn().mockResolvedValue({
          id: 501n,
          type: "video",
          source: "bottom_dock",
          status: "queued",
          progress: 0,
          version: 1,
        }),
      },
      generation_output_slots: { create: vi.fn().mockResolvedValue({}) },
      generation_job_extras: extrasDelegate(),
      cost_reservations: { create: vi.fn().mockResolvedValue({}) },
      generation_job_logs: {
        create: options.failAtLog
          ? vi
              .fn()
              .mockRejectedValue(
                new Error("We could not serialize [object Function] value"),
              )
          : vi.fn().mockResolvedValue({}),
      },
      project_events: {
        create: vi.fn(
          async ({ data }: { data: Record<string, unknown> }) => data,
        ),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    };
    return { tx, prisma };
  }

  function billingOf() {
    const charge = vi.fn(async () => {});
    const release = vi.fn(async () => {});
    return { charge, release, billing: { charge, release } };
  }

  it("★ 预扣成功但事务随后失败 → 补偿返还（钱不能留在 billing 那边）", async () => {
    const { prisma } = createTx({ failAtLog: true });
    const { charge, release, billing } = billingOf();
    const repo = createGenerationCommandRepo(prisma as never);

    await expect(repo.createJob(JOB_INPUT, { billing })).rejects.toThrow(
      "could not serialize",
    );

    expect(charge).toHaveBeenCalledWith(501);
    expect(release).toHaveBeenCalledWith(
      501,
      expect.stringContaining("could not serialize"),
    );
  });

  it("成功路径不还钱（只有回滚才补偿）", async () => {
    const { prisma } = createTx();
    const { release, billing } = billingOf();
    const repo = createGenerationCommandRepo(prisma as never);

    const created = await repo.createJob(JOB_INPUT, { billing });

    expect(created).toEqual({
      generation_job_id: "501",
      cursor: expect.any(Number),
    });
    expect(release).not.toHaveBeenCalled();
  });

  it("预扣被拒（余额不足）→ 不补偿：钱没冻上，多返一条反而可能撞上别人的预留", async () => {
    const { prisma } = createTx();
    const release = vi.fn(async () => {});
    const billing = {
      charge: vi.fn().mockRejectedValue(new Error("INSUFFICIENT_CREDITS")),
      release,
    };
    const repo = createGenerationCommandRepo(prisma as never);

    await expect(repo.createJob(JOB_INPUT, { billing })).rejects.toThrow(
      "INSUFFICIENT_CREDITS",
    );

    expect(release).not.toHaveBeenCalled();
  });

  it("★ 入参混进函数 → 在预扣之前拦下（钱没动，也不会留下无主冻结）", async () => {
    const { tx, prisma } = createTx();
    const { charge, release, billing } = billingOf();
    const repo = createGenerationCommandRepo(prisma as never);

    await expect(
      repo.createJob(
        { ...JOB_INPUT, input: { prompt: "whale", onDone: () => {} } },
        { billing },
      ),
    ).rejects.toThrow(/不可序列化/);

    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it("自引用（环）同样算不可序列化：它也会在落库时才炸", async () => {
    const { tx, prisma } = createTx();
    const repo = createGenerationCommandRepo(prisma as never);
    const cyclic: Record<string, unknown> = { prompt: "whale" };
    cyclic.self = cyclic;

    await expect(
      repo.createJob({ ...JOB_INPUT, input: cyclic }),
    ).rejects.toThrow(/不可序列化/);

    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });
});

describe("建任务幂等：同一把 Idempotency-Key 只建一个 job、只扣一次钱", () => {
  const JOB_INPUT: CreateJobInput = {
    projectId: "55",
    userId: "9",
    type: "video",
    expectedOutputCount: 1,
    input: { prompt: "whale" },
    actionIdentity: "act-1",
    actionType: "generate_video",
  };
  const IDEMPOTENCY = { key: "key-1", requestHash: "hash-1" };

  interface IdemRow {
    project_id: bigint;
    operation: string;
    idempotency_key: string;
    request_hash: string;
    generation_job_id: bigint | null;
    accepted_cursor: bigint;
  }

  function rowKey(row: {
    project_id: bigint;
    operation: string;
    idempotency_key: string;
  }): string {
    return `${row.project_id}|${row.operation}|${row.idempotency_key}`;
  }

  function uniqueViolation() {
    return Object.assign(
      new Error("Unique constraint failed: uk_command_idempotency"),
      { code: "P2002" },
    );
  }

  function created(result: CreateJobResult) {
    if ("kind" in result) throw new Error("期望建成任务，实际是幂等冲突");
    return result;
  }

  function createHarness() {
    const committed = new Map<string, IdemRow>();
    const inflight = new Map<string, Promise<void>>();
    const committedJobIds: bigint[] = [];
    let nextJobId = 500n;

    const charge = vi.fn(async (_jobId: number) => {});
    const release = vi.fn(async (_jobId: number, _reason: string) => {});
    const billing = { charge, release };

    const prisma = {
      async $transaction(callback: (tx: unknown) => Promise<CreateJobResult>) {
        const pending = new Map<string, IdemRow>();
        const jobIds: bigint[] = [];
        const held: Array<{ key: string; settle: () => void }> = [];
        const tx = {
          generation_jobs: {
            create: vi.fn(async () => {
              const id = nextJobId++;
              jobIds.push(id);
              return {
                id,
                type: "video",
                source: "bottom_dock",
                status: "queued",
                progress: 0,
                version: 1,
              };
            }),
          },
          generation_output_slots: { create: vi.fn(async () => ({})) },
          generation_job_extras: extrasDelegate(),
          cost_reservations: { create: vi.fn(async () => ({})) },
          generation_job_logs: { create: vi.fn(async () => ({})) },
          project_events: {
            create: vi.fn(
              async ({ data }: { data: Record<string, unknown> }) => data,
            ),
          },
          command_idempotency: {
            create: vi.fn(async ({ data }: { data: IdemRow }) => {
              const key = rowKey(data);
              if (committed.has(key)) throw uniqueViolation();
              const prior = inflight.get(key);
              if (prior) {
                await prior;
                if (committed.has(key)) throw uniqueViolation();
              }
              let settle!: () => void;
              inflight.set(
                key,
                new Promise<void>((resolve) => {
                  settle = resolve;
                }),
              );
              held.push({ key, settle });
              pending.set(key, data);
              return data;
            }),
          },
        };
        try {
          const result = await callback(tx);
          for (const [key, row] of pending) committed.set(key, row);
          committedJobIds.push(...jobIds);
          return result;
        } finally {
          for (const { key, settle } of held) {
            inflight.delete(key);
            settle();
          }
        }
      },
      command_idempotency: {
        findUnique: vi.fn(
          async ({
            where,
          }: {
            where: {
              project_id_operation_idempotency_key: {
                project_id: bigint;
                operation: string;
                idempotency_key: string;
              };
            };
          }) => {
            const row = committed.get(
              rowKey(where.project_id_operation_idempotency_key),
            );
            return row
              ? {
                  request_hash: row.request_hash,
                  generation_job_id: row.generation_job_id,
                  accepted_cursor: row.accepted_cursor,
                }
              : null;
          },
        ),
      },
    };

    return {
      repo: createGenerationCommandRepo(prisma as never),
      committed,
      committedJobIds,
      charge,
      release,
      billing,
    };
  }

  it("★ 同一 key 提交两次 → 只建一个 job、只扣一次钱，第二次拿到第一次的结果", async () => {
    const h = createHarness();

    const first = await h.repo.createJob(JOB_INPUT, {
      billing: h.billing,
      idempotency: IDEMPOTENCY,
    });
    const second = await h.repo.createJob(JOB_INPUT, {
      billing: h.billing,
      idempotency: IDEMPOTENCY,
    });

    expect(second).toEqual(first);
    expect(created(second).generation_job_id).toBe(
      created(first).generation_job_id,
    );
    expect(h.committedJobIds).toHaveLength(1);
    expect(h.charge).toHaveBeenCalledTimes(1);
    expect(h.release).not.toHaveBeenCalled();
    const row = h.committed.get(`55|${CREATE_GENERATION_JOB_OPERATION}|key-1`);
    expect(row?.request_hash).toBe("hash-1");
    expect(row?.generation_job_id?.toString()).toBe(
      created(first).generation_job_id,
    );
  });

  it("★ 并发同键 → 两个请求同一个 job、只留一笔预扣（输家那笔被补偿退掉）", async () => {
    const h = createHarness();

    const [a, b] = await Promise.all([
      h.repo.createJob(JOB_INPUT, {
        billing: h.billing,
        idempotency: IDEMPOTENCY,
      }),
      h.repo.createJob(JOB_INPUT, {
        billing: h.billing,
        idempotency: IDEMPOTENCY,
      }),
    ]);

    expect(a).toEqual(b);
    expect(h.committedJobIds).toHaveLength(1);
    expect(h.charge).toHaveBeenCalledTimes(2);
    expect(h.release).toHaveBeenCalledTimes(1);
    expect(h.release.mock.calls[0]?.[0]).not.toBe(
      Number(h.committedJobIds[0]),
    );
  });

  it("同键异载荷 → 冲突（不建 job、不扣钱），不静默返回首次结果", async () => {
    const h = createHarness();
    await h.repo.createJob(JOB_INPUT, {
      billing: h.billing,
      idempotency: IDEMPOTENCY,
    });

    const conflict = await h.repo.createJob(JOB_INPUT, {
      billing: h.billing,
      idempotency: { key: IDEMPOTENCY.key, requestHash: "hash-2" },
    });

    expect(conflict).toEqual({ kind: "idempotency_conflict" });
    expect(h.committedJobIds).toHaveLength(1);
    expect(h.charge).toHaveBeenCalledTimes(1);
    expect(h.release).not.toHaveBeenCalled();
  });

  it("没带幂等凭据（客户端没传 Idempotency-Key）→ 两次提交就是两个 job、两笔预扣", async () => {
    const h = createHarness();

    const a = await h.repo.createJob(JOB_INPUT, { billing: h.billing });
    const b = await h.repo.createJob(JOB_INPUT, { billing: h.billing });

    expect(created(a).generation_job_id).not.toBe(created(b).generation_job_id);
    expect(h.committedJobIds).toHaveLength(2);
    expect(h.charge).toHaveBeenCalledTimes(2);
    expect(h.committed.size).toBe(0);
  });

  it("幂等行缺 generation_job_id（被外部改过）→ 明确报错，不装作重放成功", async () => {
    const h = createHarness();
    h.committed.set(`55|${CREATE_GENERATION_JOB_OPERATION}|key-1`, {
      project_id: 55n,
      operation: CREATE_GENERATION_JOB_OPERATION,
      idempotency_key: "key-1",
      request_hash: "hash-1",
      generation_job_id: null,
      accepted_cursor: 1n,
    });

    await expect(
      h.repo.createJob(JOB_INPUT, {
        billing: h.billing,
        idempotency: IDEMPOTENCY,
      }),
    ).rejects.toThrow(/generation_job_id/);
    expect(h.committedJobIds).toHaveLength(0);
  });
});

describe("generation command repo 样片阶段落库（IKIZQ8）", () => {
  function plainTx(createJob: ReturnType<typeof vi.fn>) {
    return {
      canvas: { findFirst: vi.fn().mockResolvedValue(null) },
      generation_jobs: { create: createJob },
      generation_job_extras: extrasDelegate(),
      generation_output_slots: { create: vi.fn().mockResolvedValue({}) },
      cost_reservations: { create: vi.fn().mockResolvedValue({}) },
      generation_job_logs: { create: vi.fn().mockResolvedValue({}) },
      project_events: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data) },
    };
  }

  it("videoStage='sample' → 扩展位带 video_stage 与 charge_state='charged'（原主表列已删）", async () => {
    const createJob = vi.fn().mockResolvedValue({ id: 300n, version: 1 });
    const tx = plainTx(createJob);
    await createJobWithinTx(tx as never, {
      projectId: "55",
      userId: "9",
      type: "video",
      expectedOutputCount: 1,
      input: { prompt: "whale", sample_mode: true },
      actionIdentity: "generate-300",
      actionType: "generate_video",
      videoStage: "sample",
    });
    const data = (createJob.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.video_stage).toBeUndefined();
    expect(data.charge_state).toBeUndefined();
    expect(tx.generation_job_extras.upsert.mock.calls.map((call) => call[0].create.extra_key)).toEqual([
      "strategy_version",
      "video_stage",
      "charge_state",
    ]);
    expectExtraWrite(tx.generation_job_extras.upsert, 300n, "strategy_version", "string", "seedance-2.0-v1");
    expectExtraWrite(tx.generation_job_extras.upsert, 300n, "video_stage", "string", "sample");
    expectExtraWrite(tx.generation_job_extras.upsert, 300n, "charge_state", "string", "charged");
  });

  it("未传 videoStage（普通视频/图片/音频）→ 不写阶段两键（旧行为零变化）", async () => {
    const createJob = vi.fn().mockResolvedValue({ id: 301n, version: 1 });
    const tx = plainTx(createJob);
    await createJobWithinTx(tx as never, {
      projectId: "55",
      userId: "9",
      type: "video",
      expectedOutputCount: 1,
      input: { prompt: "whale" },
      actionIdentity: "generate-301",
      actionType: "generate_video",
    });
    const data = (createJob.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.video_stage).toBeUndefined();
    expect(data.charge_state).toBeUndefined();
    expect(tx.generation_job_extras.upsert.mock.calls.map((call) => call[0].create.extra_key)).toEqual([
      "strategy_version",
    ]);
  });
});
