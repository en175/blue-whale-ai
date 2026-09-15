import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  canonicalizeJsonValue,
  type ProviderPromptAsset,
} from "@lib/contracts";
import { vi } from "vitest";

import { createSceneCardGenerationRepo } from "./scene-card-generation-repo.js";

export function capabilityDigest(view: Record<string, unknown>): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(canonicalizeJsonValue(view)))
    .digest("hex")}`;
}

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

function buildCapabilityRow(version = 3) {
  return { version, enabled: true, is_delete: false, ...CAP_FIELDS };
}

const VIDEO_PARAMETERS = {
  capability_type: "video",
  model_id: "doubao-seedance-1.0",
  provider_id: "doubao",
  size: "1280x720",
  aspect_ratio: "16:9",
  format: null,
  duration: 5,
  count: 1,
};

export const CAPABILITY_SNAPSHOT = {
  schema_version: 1,
  capability_type: "video",
  model_id: "doubao-seedance-1.0",
  provider_id: "doubao",
  row_version: 3,
  digest: capabilityDigest(CAP_FIELDS),
};

export function referenceAsset(
  role: ProviderPromptAsset["role"],
  mentionId = "101",
): ProviderPromptAsset {
  return {
    mention_id: mentionId,
    type: "asset",
    role,
    projection: {
      asset_type: "image",
      mime: "image/png",
      size: "1024",
      width: 1280,
      height: 720,
      duration_ms: null,
      content_sha256: "asset-content",
    },
  };
}

export function sceneCardAsset(
  role: ProviderPromptAsset["role"],
  mentionId = "201",
): ProviderPromptAsset {
  return {
    mention_id: mentionId,
    type: "scene_card",
    role,
    projection: {
      title: "场景卡",
      summary: null,
      content_markdown: "# 正文",
      version: 1,
    },
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
    scene_cards: {
      findFirst: vi.fn().mockResolvedValue({
        id: 5001n,
        content_markdown: "一只冲浪的蓝鲸",
        version: 1,
      }),
      ...overrides.scene_cards,
    },
    scene_card_generation_presets: {
      findFirst: vi.fn().mockResolvedValue({
        id: 6001n,
        version: 1,
        reference_assets: [],
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      ...overrides.scene_card_generation_presets,
    },
    scene_card_generation_records: {
      create: vi.fn().mockResolvedValue({ id: 8001n }),
      ...overrides.scene_card_generation_records,
    },
    plan_application_receipts: {
      findFirst: vi.fn().mockResolvedValue({ id: 7001n, message_id: 4001n }),
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
    canvas: {
      findFirst: vi.fn().mockResolvedValue({
        viewport_json: { x: 0, y: 0, zoom: 1 },
        nodes_json: [
          {
            type: "scene_card",
            scene_card_id: "5001",
            position: { x: 100, y: 200 },
            width: 240,
            height: 135,
          },
        ],
      }),
      ...overrides.canvas,
    },
    generation_jobs: {
      create: vi.fn().mockResolvedValue({
        id: 9001n,
        type: "video",
        source: "scene_card",
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
      findMany: vi.fn().mockResolvedValue([]),
      ...overrides.generation_output_slots,
    },
    storyboard_previews: {
      findMany: vi.fn().mockResolvedValue([]),
      ...overrides.storyboard_previews,
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
  return { repo: createSceneCardGenerationRepo(prisma), transaction };
}

export const baseInput = {
  userId: "100",
  projectId: "42",
  sceneCardId: "5001",
  idempotencyKey: "cmd-1",
  requestHash: "a".repeat(64),
  base_scene_card_version: 1,
  base_preset_version: 1,
  parameters: VIDEO_PARAMETERS,
  reference_mode: "text_to_video" as const,
  reference_assets: [] as ProviderPromptAsset[],
  capability_snapshot_version: CAPABILITY_SNAPSHOT,
};
