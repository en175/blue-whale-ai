import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { canonicalizeJsonValue } from "@blue-whale/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPlanApplicationRepo } from "./plan-application-repo.js";

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

function buildTx(overrides: Record<string, Record<string, ReturnType<typeof vi.fn>>>) {
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
      create: vi.fn().mockResolvedValue({ id: 9001n, type: "video", source: "plan", status: "queued", progress: 0, version: 0 }),
      ...overrides.generation_jobs,
    },
    cost_reservations: { create: vi.fn().mockResolvedValue({}), ...overrides.cost_reservations },
    generation_job_logs: { create: vi.fn().mockResolvedValue({}), ...overrides.generation_job_logs },
    project_events: { create: projectEventsCreate, ...overrides.project_events },
  };
}

function repoWith(tx: ReturnType<typeof buildTx>) {
  const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx));
  const prisma = { $transaction: transaction } as unknown as PrismaClient;
  return { repo: createPlanApplicationRepo(prisma), transaction };
}

const baseInput = {
  userId: "100",
  projectId: "42",
  planMessageId: "5001",
  idempotencyKey: "cmd-1",
  requestHash: "a".repeat(64),
};

describe("PlanApplicationRepo.applySceneCardCreatePlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("成功事务原子创建五条产品事实（AC#2/#3）", async () => {
    const tx = buildTx({});
    const { repo } = repoWith(tx);

    const result = await repo.applySceneCardCreatePlan(baseInput);

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
    expect(tx.command_idempotency.create).toHaveBeenCalledOnce();
    // 回执落盘带 scene_card_id + job_id + command_id。
    const receiptArg = tx.plan_application_receipts.create.mock.calls[0][0].data;
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

    const result = await repo.applySceneCardCreatePlan(baseInput);

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

    const result = await repo.applySceneCardCreatePlan(baseInput);
    expect(result.kind).toBe("idempotency_conflict");
  });

  it("plan_message 不存在或跨项目返回 plan_not_found", async () => {
    const tx = buildTx({
      plan_messages: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applySceneCardCreatePlan(baseInput);
    expect(result.kind).toBe("plan_not_found");
  });

  it("application_kind 非 scene_card_create 返回 kind_unsupported", async () => {
    const tx = buildTx({
      plan_messages: {
        findUnique: vi.fn().mockResolvedValue(
          buildPlanMessageRow({ application_kind: "image_generate" }),
        ),
      },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applySceneCardCreatePlan(baseInput);
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
    const result = await repo.applySceneCardCreatePlan(baseInput);
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

    const result = await repo.applySceneCardCreatePlan(baseInput);

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
        findUnique: vi.fn().mockResolvedValue({ ...buildCapabilityRow(), enabled: false }),
      },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applySceneCardCreatePlan(baseInput);
    expect(result.kind).toBe("capability_drift");
    expect(tx.scene_cards.create).not.toHaveBeenCalled();
  });

  it("项目不归属当前用户返回 forbidden（AC#4 授权）", async () => {
    const tx = buildTx({
      project: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const { repo } = repoWith(tx);
    const result = await repo.applySceneCardCreatePlan(baseInput);
    expect(result.kind).toBe("forbidden");
    expect(tx.scene_cards.create).not.toHaveBeenCalled();
  });

  it("引用素材失效返回 validation_failed 且零写入（AC#4）", async () => {
    const planRow = buildPlanMessageRow({
      derived_references: [
        { mention_id: "101", mention_seq: 0, type: "asset", first_seen_offset: 9 },
      ],
    });
    const tx = buildTx({
      plan_messages: { findUnique: vi.fn().mockResolvedValue(planRow) },
      conversation_message_mentions: {
        findMany: vi.fn().mockResolvedValue([{ id: 101n, target_id: 201n, project_id: 42n }]),
      },
      assets: {
        findMany: vi.fn().mockResolvedValue([
          { id: 201n, project_id: 42n, status: "deleted", is_delete: false },
        ]),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.applySceneCardCreatePlan(baseInput);

    expect(result.kind).toBe("validation_failed");
    expect(tx.scene_cards.create).not.toHaveBeenCalled();
    expect(tx.plan_application_receipts.create).not.toHaveBeenCalled();
  });
});
