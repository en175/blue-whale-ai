import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  canonicalizeJsonValue,
  type ProviderPromptAsset,
} from "@lib/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSceneCardGenerationRepo } from "./scene-card-generation-repo.js";

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

const CAPABILITY_SNAPSHOT = {
  schema_version: 1,
  capability_type: "video",
  model_id: "doubao-seedance-1.0",
  provider_id: "doubao",
  row_version: 3,
  digest: capabilityDigest(CAP_FIELDS),
};

function referenceAsset(
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

function sceneCardAsset(
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
    scene_cards: {
      findFirst: vi
        .fn()
        .mockResolvedValue({
          id: 5001n,
          content_markdown: "一只冲浪的蓝鲸",
          version: 1,
        }),
      ...overrides.scene_cards,
    },
    scene_card_generation_presets: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: 6001n, version: 1, reference_assets: [] }),
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
    // IKEEFV：conversation_message_mentions 表已删，regen 预检不再触库该表
    //（validateDerivedReferences fail-closed、resolveReferenceAssetsToFlat 不查 assets），
    // 相应 mock 随下线。
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
      create: vi
        .fn()
        .mockResolvedValue({
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

function repoWith(tx: ReturnType<typeof buildTx>) {
  const transaction = vi.fn(
    async (callback: (tx: unknown) => Promise<unknown>) => callback(tx),
  );
  const prisma = { $transaction: transaction } as unknown as PrismaClient;
  return { repo: createSceneCardGenerationRepo(prisma), transaction };
}

const baseInput = {
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

describe("SceneCardGenerationRepo.regenerateSceneCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("成功事务原子更新 preset(version+1) + 新 record + 新 job（AC#4）", async () => {
    const tx = buildTx({});
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard(baseInput);

    expect(result).toMatchObject({
      kind: "applied",
      scene_card_id: "5001",
      generation_job_id: "9001",
      record_id: "8001",
      preset_version: 2,
    });
    expect(tx.scene_card_generation_presets.updateMany).toHaveBeenCalledOnce();
    const updateArg =
      tx.scene_card_generation_presets.updateMany.mock.calls[0][0];
    expect(updateArg.where.version).toBe(1);
    expect(updateArg.data.version).toEqual({ increment: 1 });
    expect(tx.scene_card_generation_records.create).toHaveBeenCalledOnce();
    expect(tx.generation_jobs.create).toHaveBeenCalledOnce();
    expect(tx.generation_jobs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expected_output_count: 1,
        input: expect.objectContaining({
          placement_anchor: { x: 100, y: 200, width: 240, height: 135 },
        }),
      }),
    });
    expect(tx.generation_output_slots.create).toHaveBeenCalledOnce();
    expect(tx.command_idempotency.create).toHaveBeenCalledOnce();
  });

  it("新 record 来源指向首次 PlanMessage 与首次 Receipt（CONTEXT L99-101）", async () => {
    const tx = buildTx({});
    const { repo } = repoWith(tx);

    await repo.regenerateSceneCard(baseInput);

    const recordArg =
      tx.scene_card_generation_records.create.mock.calls[0][0].data;
    expect(recordArg.plan_message_id).toBe(4001n);
    expect(recordArg.application_receipt_id).toBe(7001n);
    expect(recordArg.summary_status).toBe("generating");
  });

  it("新 job source=scene_card 且不设 retry_of_job_id（AC#5 不伪装重试）", async () => {
    const tx = buildTx({});
    const { repo } = repoWith(tx);

    await repo.regenerateSceneCard(baseInput);

    const jobArg = tx.generation_jobs.create.mock.calls[0][0].data;
    expect(jobArg.source).toBe("scene_card");
    expect(jobArg.retry_of_job_id).toBeUndefined();
    expect(jobArg.input.plan_message_id).toBe("4001");
    expect(jobArg.input.parameters.duration).toBe(5);
  });

  it("重复 CommandId 命中则重放，不再写入（AC 幂等）", async () => {
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

    const result = await repo.regenerateSceneCard(baseInput);

    expect(result.kind).toBe("replayed");
    expect(tx.scene_card_generation_presets.updateMany).not.toHaveBeenCalled();
    expect(tx.scene_card_generation_records.create).not.toHaveBeenCalled();
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });

  it("同 CommandId 不同内容返回 idempotency_conflict", async () => {
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
    const result = await repo.regenerateSceneCard(baseInput);
    expect(result.kind).toBe("idempotency_conflict");
  });

  it("SceneCard 不存在返回 scene_card_not_found", async () => {
    const tx = buildTx({
      scene_cards: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const { repo } = repoWith(tx);
    const result = await repo.regenerateSceneCard(baseInput);
    expect(result.kind).toBe("scene_card_not_found");
  });

  it("scene_card 版本冲突零写入（AC#6）", async () => {
    const tx = buildTx({
      scene_cards: {
        findFirst: vi.fn().mockResolvedValue({
          id: 5001n,
          content_markdown: "x",
          version: 2,
        }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard(baseInput);

    expect(result.kind).toBe("version_conflict");
    expect(tx.scene_card_generation_presets.updateMany).not.toHaveBeenCalled();
    expect(tx.scene_card_generation_records.create).not.toHaveBeenCalled();
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });

  it("preset CAS count=0 视为并发版本冲突零写入（AC#6 乐观锁）", async () => {
    const tx = buildTx({
      scene_card_generation_presets: {
        findFirst: vi.fn().mockResolvedValue({ id: 6001n, version: 1, reference_assets: [] }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard(baseInput);

    expect(result.kind).toBe("version_conflict");
    expect(tx.scene_card_generation_records.create).not.toHaveBeenCalled();
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });

  it("能力漂移（行版本变化）零写入（AC#4）", async () => {
    const tx = buildTx({
      generation_model_capability: {
        findUnique: vi.fn().mockResolvedValue(buildCapabilityRow(99)),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard(baseInput);

    expect(result.kind).toBe("capability_drift");
    expect(tx.scene_card_generation_presets.updateMany).not.toHaveBeenCalled();
    expect(tx.scene_card_generation_records.create).not.toHaveBeenCalled();
  });

  it("参数越界（aspect_ratio 不在能力支持）返回 capability_limit 零写入（AC#1）", async () => {
    const limitCapFields = { ...CAP_FIELDS, supported_aspect_ratios: ["9:16"] };
    const tx = buildTx({
      generation_model_capability: {
        findUnique: vi.fn().mockResolvedValue({
          version: 3,
          enabled: true,
          is_delete: false,
          ...limitCapFields,
        }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      capability_snapshot_version: {
        ...CAPABILITY_SNAPSHOT,
        digest: capabilityDigest(limitCapFields),
      },
    });

    expect(result.kind).toBe("capability_limit");
    expect(tx.scene_card_generation_presets.updateMany).not.toHaveBeenCalled();
    expect(tx.scene_card_generation_records.create).not.toHaveBeenCalled();
  });

  it("参数越界（duration 不在档位数组）返回 capability_limit 零写入（AC#1）", async () => {
    const limitCapFields = { ...CAP_FIELDS, supported_durations: [3, 5, 10] };
    const tx = buildTx({
      generation_model_capability: {
        findUnique: vi.fn().mockResolvedValue({
          version: 3,
          enabled: true,
          is_delete: false,
          ...limitCapFields,
        }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      parameters: { ...baseInput.parameters, duration: 7 },
      capability_snapshot_version: {
        ...CAPABILITY_SNAPSHOT,
        digest: capabilityDigest(limitCapFields),
      },
    });

    expect(result.kind).toBe("capability_limit");
    expect(tx.scene_card_generation_presets.updateMany).not.toHaveBeenCalled();
  });

  it("duration 在档位数组内放行（数组形态不误拒）", async () => {
    const capFields = { ...CAP_FIELDS, supported_durations: [3, 5, 10] };
    const tx = buildTx({
      generation_model_capability: {
        findUnique: vi.fn().mockResolvedValue({
          version: 3,
          enabled: true,
          is_delete: false,
          ...capFields,
        }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      capability_snapshot_version: {
        ...CAPABILITY_SNAPSHOT,
        digest: capabilityDigest(capFields),
      },
    });

    expect(result.kind).toBe("applied");
  });

  it("只选尾帧不选首帧时组合规则前置拒绝并零写入", async () => {
    const tx = buildTx({
      scene_card_generation_presets: {
        findFirst: vi.fn().mockResolvedValue({
          id: 6001n,
          version: 1,
          reference_assets: [referenceAsset("reference")],
        }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      reference_mode: "last_frame",
      reference_assets: [referenceAsset("last_frame")],
    });

    expect(result).toEqual({
      kind: "validation_failed",
      reason: "尾帧必须与首帧一起使用",
    });
    expect(tx.scene_card_generation_presets.updateMany).not.toHaveBeenCalled();
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });

  it("首尾帧与普通参考素材混用时组合规则前置拒绝并零写入", async () => {
    const tx = buildTx({
      scene_card_generation_presets: {
        findFirst: vi.fn().mockResolvedValue({
          id: 6001n,
          version: 1,
          reference_assets: [
            referenceAsset("reference", "101"),
            referenceAsset("reference", "102"),
          ],
        }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      reference_mode: "first_frame",
      reference_assets: [
        referenceAsset("first_frame", "101"),
        referenceAsset("reference", "102"),
      ],
    });

    expect(result).toEqual({
      kind: "validation_failed",
      reason: "首尾帧模式不能与普通参考素材混用",
    });
    expect(tx.scene_card_generation_presets.updateMany).not.toHaveBeenCalled();
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });

  it("场景卡素材声明为首帧时前置拒绝并零写入（AC#4 不静默降级）", async () => {
    const capFields = { ...CAP_FIELDS, features: { first_frame: true } };
    const tx = buildTx({
      generation_model_capability: {
        findUnique: vi.fn().mockResolvedValue({
          version: 3,
          enabled: true,
          is_delete: false,
          ...capFields,
        }),
      },
      scene_card_generation_presets: {
        findFirst: vi.fn().mockResolvedValue({
          id: 6001n,
          version: 1,
          reference_assets: [sceneCardAsset("reference")],
        }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      reference_mode: "first_frame",
      reference_assets: [sceneCardAsset("first_frame")],
    });

    expect(result).toEqual({
      kind: "validation_failed",
      reason: "场景卡素材不能作为首帧/尾帧",
    });
    expect(tx.scene_card_generation_presets.updateMany).not.toHaveBeenCalled();
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });

  it("参考模式与素材角色派生模式不一致时拒绝并零写入", async () => {
    const tx = buildTx({
      scene_card_generation_presets: {
        findFirst: vi.fn().mockResolvedValue({
          id: 6001n,
          version: 1,
          reference_assets: [referenceAsset("reference")],
        }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      reference_assets: [referenceAsset("first_frame")],
    });

    expect(result).toEqual({
      kind: "validation_failed",
      reason:
        "reference_mode text_to_video 与素材角色派生模式 first_frame 不一致",
    });
    expect(tx.scene_card_generation_presets.updateMany).not.toHaveBeenCalled();
  });

  it("多个素材声明为首帧时拒绝并零写入", async () => {
    const tx = buildTx({
      scene_card_generation_presets: {
        findFirst: vi.fn().mockResolvedValue({
          id: 6001n,
          version: 1,
          reference_assets: [
            referenceAsset("reference", "101"),
            referenceAsset("reference", "102"),
          ],
        }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      reference_mode: "first_frame",
      reference_assets: [
        referenceAsset("first_frame", "101"),
        referenceAsset("first_frame", "102"),
      ],
    });

    expect(result).toEqual({
      kind: "validation_failed",
      reason: "首帧参考素材最多只能有一个",
    });
    expect(tx.scene_card_generation_presets.updateMany).not.toHaveBeenCalled();
  });

  // IKEEFV：conversation_message_mentions 表已删，validateDerivedReferences 对任何
  // mention 引用一律 fail-closed（不再触库）。本用例保留的价值：camelCase features 的
  // 能力校验（5b）仍在 mention 引用校验（6）之前放行——若 camelCase 判定回归，
  // 结果会是 capability_limit 而非 validation_failed("mention … not found")。
  it("模型声明 camelCase 首尾帧能力时通过能力校验，但 mention 引用 fail-closed 零写入（IKEEFV）", async () => {
    const capFields = { ...CAP_FIELDS, features: { firstLastFrame: true } };
    const tx = buildTx({
      generation_model_capability: {
        findUnique: vi.fn().mockResolvedValue({
          version: 3,
          enabled: true,
          is_delete: false,
          ...capFields,
        }),
      },
      scene_card_generation_presets: {
        findFirst: vi.fn().mockResolvedValue({
          id: 6001n,
          version: 1,
          reference_assets: [
            referenceAsset("reference", "101"),
            referenceAsset("reference", "102"),
          ],
        }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      reference_mode: "first_and_last_frame",
      reference_assets: [
        referenceAsset("first_frame", "101"),
        referenceAsset("last_frame", "102"),
      ],
      capability_snapshot_version: {
        ...CAPABILITY_SNAPSHOT,
        digest: capabilityDigest(CAP_FIELDS),
      },
    });

    expect(result).toEqual({
      kind: "validation_failed",
      reason: "mention 101 not found",
    });
    expect(tx.scene_card_generation_presets.updateMany).not.toHaveBeenCalled();
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
  });

  it("无首次 Receipt 返回 validation_failed", async () => {
    const tx = buildTx({
      plan_application_receipts: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });
    const { repo } = repoWith(tx);
    const result = await repo.regenerateSceneCard(baseInput);
    expect(result.kind).toBe("validation_failed");
  });

  // IKEEFV：mention 表已删，引用素材不再可解析——fail-closed 拒绝语义与旧
  // 「mention 行查不到」逐字一致，零写入不变。
  it("引用素材失效返回 validation_failed 零写入（AC#4）", async () => {
    const tx = buildTx({
      scene_card_generation_presets: {
        findFirst: vi.fn().mockResolvedValue({
          id: 6001n,
          version: 1,
          reference_assets: [referenceAsset("reference")],
        }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      reference_assets: [referenceAsset("reference")],
    });

    expect(result.kind).toBe("validation_failed");
    expect(tx.scene_card_generation_presets.updateMany).not.toHaveBeenCalled();
  });

  it("拒绝在角色编辑中新增参考素材并零写入", async () => {
    const tx = buildTx({});
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      reference_assets: [referenceAsset("reference")],
    });

    expect(result).toEqual({
      kind: "validation_failed",
      reason: "参考素材列表只能修改角色",
    });
    expect(tx.generation_model_capability.findUnique).not.toHaveBeenCalled();
    expect(tx.scene_card_generation_presets.updateMany).not.toHaveBeenCalled();
  });

  it("拒绝在角色编辑中改写冻结素材投影并零写入", async () => {
    const existing = referenceAsset("reference");
    const tx = buildTx({
      scene_card_generation_presets: {
        findFirst: vi.fn().mockResolvedValue({
          id: 6001n,
          version: 1,
          reference_assets: [existing],
        }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      reference_assets: [
        {
          ...existing,
          projection: { ...existing.projection, content_sha256: "tampered" },
        },
      ],
    });

    expect(result).toEqual({
      kind: "validation_failed",
      reason: "参考素材列表只能修改角色",
    });
    expect(tx.generation_model_capability.findUnique).not.toHaveBeenCalled();
    expect(tx.scene_card_generation_presets.updateMany).not.toHaveBeenCalled();
  });

  it("拒绝用另一模型参数搭配冻结能力快照并零写入", async () => {
    const tx = buildTx({});
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      parameters: { ...baseInput.parameters, model_id: "another-video-model" },
    });

    expect(result).toEqual({ kind: "capability_drift" });
    expect(tx.generation_model_capability.findUnique).not.toHaveBeenCalled();
    expect(tx.scene_card_generation_presets.updateMany).not.toHaveBeenCalled();
  });

  it("项目不归属当前用户返回 forbidden（AC#4 授权）", async () => {
    const tx = buildTx({
      project: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const { repo } = repoWith(tx);
    const result = await repo.regenerateSceneCard(baseInput);
    expect(result.kind).toBe("forbidden");
  });

});
