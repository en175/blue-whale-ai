import { describe, expect, it, vi } from "vitest";

import {
  createGenerationCommandRepo,
  createJobWithinTx,
} from "./generation-command-repo.js";

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
          expected_output_count: 4,
          strategy_version: "seedance-2.0-v1",
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
      // IK7G9X：retry 复用原 job 预留快照 + 为 retry job 补预留行。
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
          expected_output_count: 2,
          strategy_version: "image-sync-v1",
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
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      // IK7G9X：retry 复用原 job 预留快照 + 为 retry job 补预留行。
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
      data: expect.objectContaining({ expected_output_count: 1 }),
    });
    expect(createSlot).toHaveBeenCalledTimes(1);
    expect(createSlot).toHaveBeenCalledWith({
      data: expect.objectContaining({ slot_index: 1, retry_of_slot_id: 79n }),
    });
  });

  it("逻辑槽已由历史重试补成功时不再创建重试 Job", async () => {
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
          expected_output_count: 1,
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
      // IK7G9X：retry 复用原 job 预留快照 + 为 retry job 补预留行。
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

    expect(result).toBeNull();
    expect(createJob).not.toHaveBeenCalled();
    expect(createSlot).not.toHaveBeenCalled();
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
      expected_output_count: 1,
      strategy_version: "seedance-2.0-v1",
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
      // IK7G9X：retry 复用原 job 预留快照 + 为 retry job 补预留行。
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

  // IKF YHJ（ADR-0087 决策 7）：重试复用原 job 的参数快照，但素材校验状态可能在那之后变了。
  describe("retryJob 素材状态门（IKF YHJ）", () => {
    /** 能走到 create 的最小事务形状：无输出槽 → retryCount 取 expected_output_count。 */
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
      input: { references: [{ material_id: "asset-abc" }] },
      expected_output_count: 1,
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
