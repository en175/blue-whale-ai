import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createPlanApplicationRepo } from "./plan-application-repo.js";
import { capabilityDigest } from "./agent-run-repo.js";

/** 未漂移能力行字段（digest 与 snapshot 一致，row_version=3）。 */
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

function baseCapability() {
  return { version: 3, enabled: true, is_delete: false, ...CAP_SUPPORTED };
}

function basePlanMessage(overrides: Record<string, unknown> = {}) {
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

function baseReceipt() {
  return {
    id: 100n,
    plan_message_id: 100n,
    project_id: 1n,
    conversation_id: 50n,
    agent_run_id: 9n,
    application_kind: "image_generate",
    first_generation_job_id: 200n,
    content_digest: `sha256:${"a".repeat(64)}`,
    applied_at: new Date("2026-08-05T10:00:00.000Z"),
    scene_card_id: null,
    result_scene_card_version: null,
    generation_preset_digest: null,
  };
}

function makeTx(overrides: Record<string, unknown> = {}) {
  const tx = {
    project: {
      findFirst: vi
        .fn()
        .mockResolvedValue("project" in overrides ? overrides.project : { id: 1n }),
    },
    plan_messages: {
      findUnique: vi
        .fn()
        .mockResolvedValue(overrides.planMessage ?? basePlanMessage()),
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
        .mockResolvedValue(overrides.createdReceipt ?? baseReceipt()),
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
          "capability" in overrides ? overrides.capability : baseCapability(),
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
    project_event_stream: {
      upsert: vi.fn(),
      update: vi.fn().mockResolvedValue({ high_watermark: 1n }),
    },
  };
  return tx;
}

function makeRepo(tx: Record<string, unknown>) {
  const prisma = {
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb(tx),
    ),
  } as unknown as PrismaClient;
  return { prisma, repo: createPlanApplicationRepo(prisma) };
}

const baseInput = {
  userId: "100",
  projectId: "1",
  planMessageId: "100",
  idempotencyKey: "key-1",
  requestHash: "hash-1",
  providerCredential: "sealed",
  quotaCheck: vi.fn().mockResolvedValue({ sufficient: true }),
};

describe("PlanApplicationRepo.applyPlanMessage", () => {
  it("成功应用：建 job + receipt + 标记 plan_message + 幂等行 + 事件", async () => {
    const tx = makeTx();
    const { repo } = makeRepo(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("applied");
    if (result.kind !== "applied") throw new Error("expected applied");
    expect(result.firstGenerationJobId).toBe("200");
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
    expect(tx.plan_application_receipts.create).toHaveBeenCalled();
    expect(tx.plan_messages.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { message_id: 100n },
        data: expect.objectContaining({
          first_generation_job_id: 200n,
        }),
      }),
    );
    expect(tx.command_idempotency.create).toHaveBeenCalled();
    expect(tx.project_events.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ event_type: "plan_message.applied" }),
      }),
    );
  });

  it("at-most-once：已应用 → already_applied，换键仍回首次、不重建 job", async () => {
    const tx = makeTx({
      planMessage: basePlanMessage({
        applied_at: new Date("2026-08-05T10:00:00.000Z"),
        first_generation_job_id: 200n,
      }),
      existingReceipt: baseReceipt(),
    });
    const { repo } = makeRepo(tx);
    const result = await repo.applyPlanMessage({
      ...baseInput,
      idempotencyKey: "key-2",
    });
    expect(result.kind).toBe("already_applied");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
    expect(tx.plan_application_receipts.create).not.toHaveBeenCalled();
  });

  it("同键同内容 → replayed（回首次 cursor）", async () => {
    const tx = makeTx({
      idem: { request_hash: "hash-1", accepted_cursor: 500n },
      existingReceipt: baseReceipt(),
    });
    const { repo } = makeRepo(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("replayed");
    if (result.kind !== "replayed") throw new Error("expected replayed");
    expect(result.cursor).toBe(500);
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });

  it("同键异内容 → idempotency_conflict", async () => {
    const tx = makeTx({
      idem: { request_hash: "different-hash", accepted_cursor: 500n },
    });
    const { repo } = makeRepo(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("idempotency_conflict");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });

  it("素材失效 → blocked_requires_new_plan，零写入", async () => {
    const tx = makeTx({
      planMessage: basePlanMessage({
        derived_references: [
          { mention_id: "999", mention_seq: 0, type: "asset", first_seen_offset: 0 },
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
    const { repo } = makeRepo(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("blocked_requires_new_plan");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
    expect(tx.plan_application_receipts.create).not.toHaveBeenCalled();
    expect(tx.command_idempotency.create).not.toHaveBeenCalled();
  });

  it("余额耗尽 → blocked_retryable，零写入", async () => {
    const tx = makeTx();
    const { repo } = makeRepo(tx);
    const result = await repo.applyPlanMessage({
      ...baseInput,
      quotaCheck: vi.fn().mockResolvedValue({ sufficient: false }),
    });
    expect(result.kind).toBe("blocked_retryable");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
    expect(tx.plan_application_receipts.create).not.toHaveBeenCalled();
    expect(tx.command_idempotency.create).not.toHaveBeenCalled();
  });

  it("能力漂移（row_version 变） → blocked_requires_new_plan", async () => {
    const tx = makeTx({
      capability: { ...baseCapability(), version: 99 },
    });
    const { repo } = makeRepo(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("blocked_requires_new_plan");
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });

  it("能力下线（不存在/禁用） → blocked_requires_new_plan", async () => {
    const tx = makeTx({ capability: null });
    const { repo } = makeRepo(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("blocked_requires_new_plan");
  });

  it("项目不归属 → not_found", async () => {
    const tx = makeTx({ project: null });
    const { repo } = makeRepo(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("not_found");
  });

  it("计划非 image_generate → not_found（本期只图片）", async () => {
    const tx = makeTx({
      planMessage: basePlanMessage({ application_kind: "scene_card_create" }),
    });
    const { repo } = makeRepo(tx);
    const result = await repo.applyPlanMessage(baseInput);
    expect(result.kind).toBe("not_found");
  });
});
