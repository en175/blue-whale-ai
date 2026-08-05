import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { canonicalizeJsonValue } from "@blue-whale/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPlanApplicationRepo } from "./plan-application-repo.js";
import { capabilityDigest } from "./capability-digest.js";

/** 复现 agent-run-repo 冻结时的能力 digest（8 字段 canonicalize + sha256）。 */
function capabilityDigest(view: Record<string, unknown>): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalizeJsonValue(view)))
    .digest("hex")}`;
}

const CAP_FIELDS = {
  supported_sizes: [{ id: "1280x720", label: "720p", api_value: "1280x720" }],
  supported_aspect_ratios: ["16:9"],
  supported_durations: { min: 5, max: 5, step: 1 },
  supported_formats: ["mp4"],
  default_size: "1280x720",
  default_format: null,
  default_aspect_ratio: "16:9",
  default_duration: 5,
};

function buildCapabilityRow(version = 3) {
  return { version, enabled: true, is_delete: false, ...CAP_FIELDS };
}

function buildPlanMessageRow(overrides: Partial<Record<string, unknown>> = {}) {
  const snapshot = {
    schema_version: 1,
    capability_type: "video",
    model_id: "doubao-seedance-1.0",
    provider_id: "doubao",
    row_version: 3,
    digest: capabilityDigest(CAP_FIELDS),
  };
  return {
    message_id: 5001n,
    project_id: 42n,
    application_kind: "scene_card_create",
    sequence_label: "镜头一",
    content_markdown: "一只冲浪的蓝鲸 asset://101",
    derived_references: [],
    frozen_generation_parameters: {
      capability_type: "video",
      model_id: "doubao-seedance-1.0",
      provider_id: "doubao",
      size: "1280x720",
      aspect_ratio: "16:9",
      format: null,
      duration: 5,
      count: 1,
    },
    capability_snapshot_version: snapshot,
    provider_prompt_projection: {
      prompt_text: "一只冲浪的蓝鲸 asset://101",
      reference_assets: [],
      parameters: {},
    },
    ...overrides,
  };
}

function buildTx(
  overrides: Record<string, Record<string, ReturnType<typeof vi.fn>>>,
) {
  const projectEventsCreate = vi.fn().mockImplementation(({ data }) => ({
    id: 1n,
    event_id: "evt_x",
    event_type: data.event_type,
    cursor: 100n,
    project_id: data.project_id,
    aggregate_type: data.aggregate_type,
    aggregate_id: data.aggregate_id,
    aggregate_version: data.aggregate_version,
    correlation_id: data.correlation_id ?? null,
    causation_id: data.causation_id ?? null,
    occurred_at: new Date(),
    payload: data.payload,
  }));
  return {
    project: {
      findFirst: vi.fn().mockResolvedValue({ id: 42n }),
      ...overrides.project,
    },
    command_idempotency: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      ...overrides.command_idempotency,
    },
    plan_messages: {
      findUnique: vi.fn().mockResolvedValue(buildPlanMessageRow()),
      ...overrides.plan_messages,
    },
    plan_application_receipts: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 7001n }),
      ...overrides.plan_application_receipts,
    },
    generation_model_capability: {
      findUnique: vi.fn().mockResolvedValue(buildCapabilityRow()),
      ...overrides.generation_model_capability,
    },
    conversation_message_mentions: {
      findMany: vi.fn().mockResolvedValue([]),
      ...overrides.conversation_message_mentions,
    },
    assets: {
      findMany: vi.fn().mockResolvedValue([]),
      ...overrides.assets,
    },
    scene_cards: {
      create: vi.fn().mockResolvedValue({ id: 5001n }),
      findMany: vi.fn().mockResolvedValue([]),
      ...overrides.scene_cards,
    },
    scene_card_generation_presets: {
      create: vi.fn().mockResolvedValue({}),
      ...overrides.scene_card_generation_presets,
    },
    scene_card_generation_records: {
      create: vi.fn().mockResolvedValue({}),
      ...overrides.scene_card_generation_records,
    },
    generation_jobs: {
      create: vi
        .fn()
        .mockResolvedValue({
          id: 9001n,
          type: "video",
          source: "plan",
          status: "queued",
          progress: 0,
          version: 0,
        }),
      ...overrides.generation_jobs,
    },
    cost_reservations: {
      create: vi.fn().mockResolvedValue({}),
      ...overrides.cost_reservations,
    },
    generation_output_slots: {
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      ...overrides.generation_output_slots,
    },
    generation_job_logs: {
      create: vi.fn().mockResolvedValue({}),
      ...overrides.generation_job_logs,
    },
    project_events: {
      create: projectEventsCreate,
      ...overrides.project_events,
    },
  };
}

function repoWith(tx: ReturnType<typeof buildTx>) {
  const transaction = vi.fn(
    async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
  );
  const prisma = { $transaction: transaction } as unknown as PrismaClient;
  return { repo: createPlanApplicationRepo(prisma), transaction };
}

const baseInput = {
  userId: "100",
  projectId: "42",
  planMessageId: "5001",
  idempotencyKey: "cmd-1",
  requestHash: "a".repeat(64),
  providerCredential: "sealed-provider-token",
};

describe("PlanApplicationRepo.applyPlanMessage（视频分支 / IK67H9）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("成功事务原子创建五条产品事实（AC#2/#3）", async () => {
    const tx = buildTx({});
    const { repo } = repoWith(tx);

    const result = await repo.applyPlanMessage(baseInput);

    expect(result).toMatchObject({
      kind: "applied",
      scene_card_id: "5001",
      generation_job_id: "9001",
      receipt_id: "7001",
    });
    expect(tx.scene_cards.create).toHaveBeenCalledOnce();
    expect(tx.scene_card_generation_presets.create).toHaveBeenCalledOnce();
    expect(tx.scene_card_generation_records.create).toHaveBeenCalledOnce();
    expect(tx.plan_application_receipts.create).toHaveBeenCalledOnce();
    expect(tx.generation_jobs.create).toHaveBeenCalledOnce();
    expect(tx.generation_jobs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expected_output_count: 1,
        input: expect.objectContaining({
          provider_credential: "sealed-provider-token",
        }),
      }),
    });
    expect(tx.generation_output_slots.create).toHaveBeenCalledOnce();
    expect(tx.command_idempotency.create).toHaveBeenCalledOnce();
    // 回执落盘带 scene_card_id + job_id + command_id。
    const receiptArg =
      tx.plan_application_receipts.create.mock.calls[0][0].data;
    expect(receiptArg.scene_card_id).toBe(5001n);
    expect(receiptArg.command_id).toBe("cmd-1");
    expect(receiptArg.application_kind).toBe("scene_card_create");
  });

  it("重复 CommandId 命中则重放首次结果，不再创建（AC#6）", async () => {
    const tx = buildTx({
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue({
          request_hash: baseInput.requestHash,
          resource_id: 5001n,
          generation_job_id: 9001n,
        }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.applyPlanMessage(baseInput);

    expect(result).toEqual({
      kind: "replayed",
      scene_card_id: "5001",
      generation_job_id: "9001",
    });
    expect(tx.scene_cards.create).not.toHaveBeenCalled();
    expect(tx.plan_application_receipts.create).not.toHaveBeenCalled();
  });

  it("同 CommandId 不同内容拒绝（AC#6 idempotency_conflict）", async () => {
    const tx = buildTx({
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue({
          request_hash: "b".repeat(64),
          resource_id: 5001n,
          generation_job_id: 9001n,
        }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("idempotency_conflict");
  });

  it("plan_message 不存在或跨项目返回 plan_not_found", async () => {
    const tx = buildTx({
      plan_messages: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("plan_not_found");
  });

  it("application_kind 不可应用（scene_card_replace）返回 kind_unsupported", async () => {
    const tx = buildTx({
      plan_messages: {
        findUnique: vi
          .fn()
          .mockResolvedValue(
            buildPlanMessageRow({ application_kind: "scene_card_replace" }),
          ),
      },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("kind_unsupported");
  });

  it("同消息已被成功应用（不同 CommandId）返回 already_applied（CONTEXT L227）", async () => {
    const tx = buildTx({
      plan_application_receipts: {
        findUnique: vi.fn().mockResolvedValue({ id: 7001n }),
        create: vi.fn(),
      },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("already_applied");
    expect(tx.scene_cards.create).not.toHaveBeenCalled();
  });

  it("能力漂移（行版本变化）零写入（AC#4）", async () => {
    const tx = buildTx({
      generation_model_capability: {
        findUnique: vi.fn().mockResolvedValue(buildCapabilityRow(99)),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.applyPlanMessage(baseInput);

    expect(result.kind).toBe("capability_drift");
    // 原子性：五条事实一条都不写。
    expect(tx.scene_cards.create).not.toHaveBeenCalled();
    expect(tx.scene_card_generation_presets.create).not.toHaveBeenCalled();
    expect(tx.scene_card_generation_records.create).not.toHaveBeenCalled();
    expect(tx.plan_application_receipts.create).not.toHaveBeenCalled();
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
    expect(tx.command_idempotency.create).not.toHaveBeenCalled();
  });

  it("能力被禁用视为漂移零写入", async () => {
    const tx = buildTx({
      generation_model_capability: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ ...buildCapabilityRow(), enabled: false }),
      },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("capability_drift");
    expect(tx.scene_cards.create).not.toHaveBeenCalled();
  });

  it("项目不归属当前用户返回 forbidden（AC#4 授权）", async () => {
    const tx = buildTx({
      project: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("forbidden");
    expect(tx.scene_cards.create).not.toHaveBeenCalled();
  });

  it("引用素材失效返回 validation_failed 且零写入（AC#4）", async () => {
    const planRow = buildPlanMessageRow({
      derived_references: [
        {
          mention_id: "101",
          mention_seq: 0,
          type: "asset",
          first_seen_offset: 9,
        },
      ],
    });
    const tx = buildTx({
      plan_messages: { findUnique: vi.fn().mockResolvedValue(planRow) },
      conversation_message_mentions: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 101n, target_id: 201n, project_id: 42n }]),
      },
      assets: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 201n, project_id: 42n, status: "deleted", is_delete: false },
          ]),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.applyPlanMessage(baseInput);

    expect(result.kind).toBe("validation_failed");
    expect(tx.scene_cards.create).not.toHaveBeenCalled();
    expect(tx.plan_application_receipts.create).not.toHaveBeenCalled();
  });
});

// —— 图片分支（IK67H8/T10）：媒体感知分派 + 双层幂等 + 预检零写入 ——

const CAP_SUPPORTED = {
  supported_sizes: [],
  supported_aspect_ratios: ["1:1"],
  supported_durations: null,
  supported_formats: ["png"],
  default_size: "1024x1024",
  default_format: "png",
  default_aspect_ratio: "1:1",
  default_duration: null,
};

function baseImageCapability() {
  return { version: 3, enabled: true, is_delete: false, ...CAP_SUPPORTED };
}

function baseImagePlanMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 10n,
    message_id: 100n,
    conversation_id: 50n,
    project_id: 1n,
    agent_run_id: 9n,
    ordinal: 1,
    total_in_batch: 1,
    application_kind: "image_generate",
    content_markdown: "一只蓝鲸",
    derived_references: [],
    frozen_generation_parameters: {
      capability_type: "image",
      model_id: "doubao-seedream-5.0-lite",
      provider_id: "doubao",
      size: "1024x1024",
      aspect_ratio: "1:1",
      format: "png",
      duration: null,
      count: 1,
    },
    capability_snapshot_version: {
      schema_version: 1,
      capability_type: "image",
      model_id: "doubao-seedream-5.0-lite",
      provider_id: "doubao",
      row_version: 3,
      digest: capabilityDigest(CAP_SUPPORTED),
    },
    applied_at: null,
    first_generation_job_id: null,
    ...overrides,
  };
}

function baseImageReceipt() {
  return {
    id: 100n,
    message_id: 100n,
    project_id: 1n,
    conversation_id: 50n,
    agent_run_id: 9n,
    application_kind: "image_generate",
    scene_card_id: null,
    first_generation_job_id: 200n,
    command_id: "key-1",
    content_digest: `sha256:${"a".repeat(64)}`,
    result_version: null,
    preset_digest: null,
    target_scene_card_mention_id: null,
    applied_at: new Date("2026-08-05T10:00:00.000Z"),
  };
}

function makeImageTx(overrides: Record<string, unknown> = {}) {
  return {
    project: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          "project" in overrides ? overrides.project : { id: 1n },
        ),
    },
    plan_messages: {
      findUnique: vi
        .fn()
        .mockResolvedValue(overrides.planMessage ?? baseImagePlanMessage()),
      update: vi.fn().mockResolvedValue({}),
    },
    command_idempotency: {
      findUnique: vi.fn().mockResolvedValue(overrides.idem ?? null),
      create: vi.fn().mockResolvedValue({}),
    },
    plan_application_receipts: {
      findUnique: vi.fn().mockResolvedValue(overrides.existingReceipt ?? null),
      create: vi
        .fn()
        .mockResolvedValue(overrides.createdReceipt ?? baseImageReceipt()),
    },
    conversation_message_mentions: {
      findMany: vi.fn().mockResolvedValue(overrides.mentions ?? []),
    },
    assets: { findMany: vi.fn().mockResolvedValue(overrides.assets ?? []) },
    scene_cards: { findMany: vi.fn().mockResolvedValue([]) },
    generation_model_capability: {
      findFirst: vi
        .fn()
        .mockResolvedValue(
          "capability" in overrides
            ? overrides.capability
            : baseImageCapability(),
        ),
    },
    generation_jobs: {
      create: vi.fn().mockResolvedValue({
        id: 200n,
        type: "image",
        source: "plan_apply",
        status: "queued",
        progress: 0,
        version: 0,
      }),
    },
    cost_reservations: { create: vi.fn().mockResolvedValue({}) },
    generation_output_slots: {
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    generation_job_logs: { create: vi.fn().mockResolvedValue({}) },
    project_events: {
      create: vi
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          id: 11n,
          gmt_create: new Date(),
          cursor: 500n,
          ...data,
        })),
    },
  };
}

const baseImageInput = {
  userId: "100",
  projectId: "1",
  planMessageId: "100",
  idempotencyKey: "key-1",
  requestHash: "hash-1",
  providerCredential: "sealed",
  quotaCheck: vi.fn().mockResolvedValue({ sufficient: true }),
};

describe("PlanApplicationRepo.applyPlanMessage（图片分支 / IK67H8）", () => {
  it("成功应用：建 job + receipt + 标记 plan_message + 幂等行 + 事件", async () => {
    const tx = makeImageTx();
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseImageInput);
    expect(result.kind).toBe("applied_image");
    if (result.kind !== "applied_image")
      throw new Error("expected applied_image");
    expect(result.first_generation_job_id).toBe("200");
    expect(result.receipt.application_kind).toBe("image_generate");
    expect(result.receipt.scene_card_id).toBeNull();
    expect(tx.generation_jobs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: "plan_apply",
          agent_run_id: 9n,
        }),
      }),
    );
    expect(tx.plan_application_receipts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          message_id: 100n,
          command_id: "key-1",
          conversation_id: 50n,
          agent_run_id: 9n,
          scene_card_id: null,
        }),
      }),
    );
    expect(tx.plan_messages.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { message_id: 100n },
        data: expect.objectContaining({
          first_generation_job_id: 200n,
        }),
      }),
    );
    expect(tx.command_idempotency.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          operation: "plan_message.apply",
          message_id: 100n,
        }),
      }),
    );
    expect(tx.project_events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event_type: "plan_message.applied" }),
      }),
    );
  });

  it("at-most-once：已应用 → already_applied_image，换键仍回首次、不重建 job", async () => {
    const tx = makeImageTx({
      planMessage: baseImagePlanMessage({
        applied_at: new Date("2026-08-05T10:00:00.000Z"),
        first_generation_job_id: 200n,
      }),
      existingReceipt: baseImageReceipt(),
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage({
      ...baseImageInput,
      idempotencyKey: "key-2",
    });
    expect(result.kind).toBe("already_applied_image");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
    expect(tx.plan_application_receipts.create).not.toHaveBeenCalled();
  });

  it("同键同内容 → replayed_image（回首次 cursor）", async () => {
    const tx = makeImageTx({
      idem: { request_hash: "hash-1", accepted_cursor: 500n },
      existingReceipt: baseImageReceipt(),
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseImageInput);
    expect(result.kind).toBe("replayed_image");
    if (result.kind !== "replayed_image")
      throw new Error("expected replayed_image");
    expect(result.cursor).toBe("500");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });

  it("同键异内容 → idempotency_conflict", async () => {
    const tx = makeImageTx({
      idem: { request_hash: "different-hash", accepted_cursor: 500n },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseImageInput);
    expect(result.kind).toBe("idempotency_conflict");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });

  it("素材失效 → blocked_requires_new_plan(mention_unavailable)，零写入", async () => {
    const tx = makeImageTx({
      planMessage: baseImagePlanMessage({
        derived_references: [
          {
            mention_id: "999",
            mention_seq: 0,
            type: "asset",
            first_seen_offset: 0,
          },
        ],
      }),
      mentions: [
        {
          id: 999n,
          target_id: 888n,
          mention_type: "asset",
          target_version: null,
          accepted_user_id: 100n,
        },
      ],
      assets: [], // target 888 不存在 → deleted → unavailable
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseImageInput);
    expect(result.kind).toBe("blocked_requires_new_plan");
    if (result.kind !== "blocked_requires_new_plan")
      throw new Error("expected blocked");
    expect(result.blockedBy).toBe("mention_unavailable");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
    expect(tx.plan_application_receipts.create).not.toHaveBeenCalled();
    expect(tx.command_idempotency.create).not.toHaveBeenCalled();
  });

  it("余额耗尽 → blocked_retryable，零写入", async () => {
    const tx = makeImageTx();
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage({
      ...baseImageInput,
      quotaCheck: vi.fn().mockResolvedValue({ sufficient: false }),
    });
    expect(result.kind).toBe("blocked_retryable");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
    expect(tx.plan_application_receipts.create).not.toHaveBeenCalled();
    expect(tx.command_idempotency.create).not.toHaveBeenCalled();
  });

  it("能力漂移（row_version 变） → blocked_requires_new_plan(capability_drifted)", async () => {
    const tx = makeImageTx({
      capability: { ...baseImageCapability(), version: 99 },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseImageInput);
    expect(result.kind).toBe("blocked_requires_new_plan");
    if (result.kind !== "blocked_requires_new_plan")
      throw new Error("expected blocked");
    expect(result.blockedBy).toBe("capability_drifted");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });

  it("能力下线（不存在/禁用） → blocked_requires_new_plan", async () => {
    const tx = makeImageTx({ capability: null });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseImageInput);
    expect(result.kind).toBe("blocked_requires_new_plan");
  });

  it("项目不归属 → forbidden", async () => {
    const tx = makeImageTx({ project: null });
    const { repo } = repoWith(tx);
    const result = await repo.applyPlanMessage(baseImageInput);
    expect(result.kind).toBe("forbidden");
  });

  it("图片应用缺凭证 → validation_failed", async () => {
    const tx = makeImageTx();
    const { repo } = repoWith(tx);
    const { providerCredential, quotaCheck, ...rest } = baseImageInput;
    const result = await repo.applyPlanMessage(rest);
    expect(result.kind).toBe("validation_failed");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });
});
