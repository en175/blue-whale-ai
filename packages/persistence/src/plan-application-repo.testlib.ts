// IK74V8：计划应用用例的共享夹具（从 plan-application-repo.test.ts 拆出）。
// 命名 *.testlib.ts：tsconfig 排除编译、vitest 不当作用例文件收集。
// capabilityDigest 原为与 ./capability-digest.js 逐字重复的本地副本（重复绑定），
// 拆分时删除副本、统一走该模块导出。
import type { PrismaClient } from "@prisma/client";
import { vi } from "vitest";

import { createPlanApplicationRepo } from "./plan-application-repo.js";
import { capabilityDigest } from "./capability-digest.js";

export const CAP_FIELDS = {
  supported_sizes: [{ id: "1280x720", label: "720p", api_value: "1280x720" }],
  supported_aspect_ratios: ["16:9"],
  supported_durations: { min: 5, max: 5, step: 1 },
  supported_formats: ["mp4"],
  default_size: "1280x720",
  default_format: null,
  default_aspect_ratio: "16:9",
  default_duration: 5,
};

export function buildCapabilityRow(version = 3) {
  return { version, enabled: true, is_delete: false, ...CAP_FIELDS };
}

export function buildPlanMessageRow(overrides: Partial<Record<string, unknown>> = {}) {
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

export function buildTx(
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
      findUnique: vi.fn().mockResolvedValue(null),
      ...overrides.conversation_message_mentions,
    },
    assets: {
      findMany: vi.fn().mockResolvedValue([]),
      ...overrides.assets,
    },
    scene_cards: {
      create: vi.fn().mockResolvedValue({ id: 5001n }),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      ...overrides.scene_cards,
    },
    scene_card_generation_presets: {
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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

export function repoWith(tx: ReturnType<typeof buildTx>) {
  const transaction = vi.fn(
    async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
  );
  const prisma = { $transaction: transaction } as unknown as PrismaClient;
  return { repo: createPlanApplicationRepo(prisma), transaction };
}

export const baseInput = {
  userId: "100",
  projectId: "42",
  planMessageId: "5001",
  idempotencyKey: "cmd-1",
  requestHash: "a".repeat(64),
  providerCredential: "sealed-provider-token",
};

export const CAP_SUPPORTED = {
  supported_sizes: [],
  supported_aspect_ratios: ["1:1"],
  supported_durations: null,
  supported_formats: ["png"],
  default_size: "1024x1024",
  default_format: "png",
  default_aspect_ratio: "1:1",
  default_duration: null,
};

export function baseImageCapability() {
  return { version: 3, enabled: true, is_delete: false, ...CAP_SUPPORTED };
}

export function baseImagePlanMessage(overrides: Record<string, unknown> = {}) {
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

export function baseImageReceipt() {
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

export function makeImageTx(overrides: Record<string, unknown> = {}) {
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

export const baseImageInput = {
  userId: "100",
  projectId: "1",
  planMessageId: "100",
  idempotencyKey: "key-1",
  requestHash: "hash-1",
  providerCredential: "sealed",
  quotaCheck: vi.fn().mockResolvedValue({ sufficient: true }),
};

// —— 覆盖分支（IK67HA/T12）：目标重校验 + 乐观锁 CAS + 覆盖既有卡 ——
export const TARGET_MENTION_ID = 8001n;
export const TARGET_SCENE_CARD_ID = 6001n;

export function buildReplacePlanMessageRow(overrides: Partial<Record<string, unknown>> = {}) {
  return buildPlanMessageRow({
    message_id: 5001n,
    application_kind: "scene_card_replace",
    target_scene_card_mention_id: TARGET_MENTION_ID,
    base_scene_card_version: 1,
    ...overrides,
  });
}

export function buildTargetMention(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TARGET_MENTION_ID,
    target_id: TARGET_SCENE_CARD_ID,
    target_version: 1,
    accepted_user_id: 100n,
    project_id: 42n,
    mention_type: "scene_card",
    ...overrides,
  };
}

export function buildTargetSceneCard(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TARGET_SCENE_CARD_ID,
    project_id: 42n,
    version: 1,
    is_delete: 0,
    ...overrides,
  };
}
