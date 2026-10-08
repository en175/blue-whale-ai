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

/** IKHBDO：画格参考桩——画格是 scene_card 路径上**唯一真正会送到 worker** 的参考形态
 *  （mention 组走 validateDerivedReferences fail-closed；scene_card 组无 asset 映射）。
 *  一次性造出 validateStoryboardFrames / resolveReferenceAssetsToFlat / checkReferenceCountLimits
 *  三处都要读的行（slot → asset_id → assets.type）。 */
function frameOverrides(
  types: Array<"image" | "video" | "audio">,
  durationsMs: Array<number | null> = [],
) {
  const frames: ProviderPromptAsset[] = [];
  const slots: Array<Record<string, unknown>> = [];
  const assetRows: Array<Record<string, unknown>> = [];
  types.forEach((type, index) => {
    const slotId = BigInt(701 + index);
    const assetId = BigInt(9100 + index);
    frames.push({
      slot_id: slotId.toString(),
      type: "storyboard_frame",
      role: "reference",
    });
    slots.push({
      id: slotId,
      asset_id: assetId,
      status: "succeeded",
      generation_job_id: 9001n,
    });
    assetRows.push({ id: assetId, type, duration_ms: durationsMs[index] ?? null });
  });
  return {
    frames,
    overrides: {
      generation_output_slots: { findMany: vi.fn().mockResolvedValue(slots) },
      storyboard_previews: {
        findMany: vi.fn().mockResolvedValue([{ first_generation_job_id: 9001n }]),
      },
      assets: { findMany: vi.fn().mockResolvedValue(assetRows) },
    },
  };
}

/** 能力行桩（digest 固定 8 字段，不含 features——与 capabilityDigestFromModelCapability 一致）。 */
function capabilityWith(features: Record<string, unknown>, base = CAP_FIELDS) {
  return {
    generation_model_capability: {
      findUnique: vi.fn().mockResolvedValue({
        version: 3,
        enabled: true,
        is_delete: false,
        ...base,
        features,
      }),
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
    // IKJCOE：任务特有字段（strategy_version 等）走扩展位（原主表列已删）；默认无键 = 缺省语义。
    generation_job_extras: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      ...overrides.generation_job_extras,
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
    // IKHBDO：画格路径的素材归属校验（findAccessibleAssetIds）与参考数量判定
    //（checkReferenceCountLimits）都读这张表——前者要 id、后者要 type/duration_ms。
    assets: {
      findMany: vi.fn().mockResolvedValue([]),
      ...overrides.assets,
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
        input: expect.objectContaining({
          placement_anchor: { x: 100, y: 200, width: 240, height: 135 },
        }),
      }),
    });
    // IKJCOE：建行时的策略版本快照进扩展位（原主表 strategy_version 列已删）。
    expect(tx.generation_job_extras.upsert).toHaveBeenCalledWith({
      where: {
        generation_job_id_extra_key: { generation_job_id: 9001n, extra_key: "strategy_version" },
      },
      create: {
        generation_job_id: 9001n,
        extra_key: "strategy_version",
        value_type: "string",
        value_text: "seedance-2.0-v1",
      },
      update: {
        value_type: "string",
        value_text: "seedance-2.0-v1",
        gmt_modified: expect.any(Date),
      },
    });
    // expectedOutputCount=1 → 恰好一个输出槽（原主表 expected_output_count 列的权威在槽行数上）。
    expect(tx.generation_output_slots.create).toHaveBeenCalledOnce();
    expect(tx.generation_output_slots.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        generation_job_id: 9001n,
        slot_index: 0,
        status: "pending",
      }),
    });
    expect(tx.command_idempotency.create).toHaveBeenCalledOnce();
  });

  it("新 record 不再写 plan 溯源列（计划通道已退役）", async () => {
    const tx = buildTx({});
    const { repo } = repoWith(tx);

    await repo.regenerateSceneCard(baseInput);

    const recordArg =
      tx.scene_card_generation_records.create.mock.calls[0][0].data;
    expect(recordArg.plan_message_id).toBeUndefined();
    expect(recordArg.application_receipt_id).toBeUndefined();
    expect(recordArg.summary_status).toBe("generating");
  });

  it("新 job source=scene_card 且不设 retry_of_job_id（AC#5 不伪装重试）", async () => {
    const tx = buildTx({});
    const { repo } = repoWith(tx);

    await repo.regenerateSceneCard(baseInput);

    const jobArg = tx.generation_jobs.create.mock.calls[0][0].data;
    expect(jobArg.source).toBe("scene_card");
    expect(jobArg.retry_of_job_id).toBeUndefined();
    expect(jobArg.input.plan_message_id).toBeUndefined();
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

  it("★ ADR-0123：比例档是 { id, label } 形态时同样能过白名单（不会因元素变对象而误拒）", async () => {
    const labelledCapFields = {
      ...CAP_FIELDS,
      supported_aspect_ratios: [{ id: "16:9", label: "横屏 16:9" }],
    };
    const tx = buildTx({
      generation_model_capability: {
        findUnique: vi.fn().mockResolvedValue({
          version: 3,
          enabled: true,
          is_delete: false,
          ...labelledCapFields,
        }),
      },
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      capability_snapshot_version: {
        ...CAPABILITY_SNAPSHOT,
        digest: capabilityDigest(labelledCapFields),
      },
    });

    expect(result.kind).not.toBe("capability_limit");
  });

  it("IKFPYX：首尾帧模式按 task_types 约束校验——基础比例含 16:9，但 first_last_frame 仅允许 adaptive", async () => {
    const frames = [referenceAsset("first_frame", "101"), referenceAsset("last_frame", "102")];
    const capFields = {
      ...CAP_FIELDS,
      supported_aspect_ratios: ["16:9", "adaptive"],
      features: {
        first_last_frame: true,
        task_types: { first_last_frame: { allowed_ratios: ["adaptive"] } },
      },
    };
    // digest 有意不含 features（capabilityDigestFromModelCapability 固定 8 字段）
    const { features: _features, ...digestFields } = capFields;
    const tx = buildTx({
      scene_card_generation_presets: {
        findFirst: vi.fn().mockResolvedValue({ id: 6001n, version: 1, reference_assets: frames }),
      },
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
      reference_mode: "first_and_last_frame",
      reference_assets: frames,
      capability_snapshot_version: {
        ...CAPABILITY_SNAPSHOT,
        digest: capabilityDigest(digestFields),
      },
    });

    // 16:9 在基础比例列表内，但首尾帧任务的 task_types 只允许 adaptive → 拒
    expect(result.kind).toBe("capability_limit");
    expect(tx.scene_card_generation_records.create).not.toHaveBeenCalled();
  });

  it("IKFPYX：首尾帧 + adaptive 通过 task_types 校验（进入后续校验）", async () => {
    const frames = [referenceAsset("first_frame", "101"), referenceAsset("last_frame", "102")];
    const capFields = {
      ...CAP_FIELDS,
      supported_aspect_ratios: ["16:9", "adaptive"],
      features: {
        first_last_frame: true,
        task_types: { first_last_frame: { allowed_ratios: ["adaptive"] } },
      },
    };
    // digest 有意不含 features（capabilityDigestFromModelCapability 固定 8 字段）
    const { features: _features, ...digestFields } = capFields;
    const tx = buildTx({
      scene_card_generation_presets: {
        findFirst: vi.fn().mockResolvedValue({ id: 6001n, version: 1, reference_assets: frames }),
      },
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
      parameters: { ...VIDEO_PARAMETERS, aspect_ratio: "adaptive" },
      reference_mode: "first_and_last_frame",
      reference_assets: frames,
      capability_snapshot_version: {
        ...CAPABILITY_SNAPSHOT,
        digest: capabilityDigest(digestFields),
      },
    });

    expect(result.kind).not.toBe("capability_limit");
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

  // ★ 回归：拆除「首次 Receipt」门槛后，无回执的场景卡（如经素材库
  //   copySceneCardToProject 复制来的——它是 scene_cards 全仓唯一的创建点，但不写回执）
  //   必须也能生成。改动前这里返回 validation_failed("missing first application receipt")。
  it("★ 无首次 Receipt 也能生成（复制来的场景卡不再被挡）", async () => {
    const tx = buildTx({});
    const { repo } = repoWith(tx);
    const result = await repo.regenerateSceneCard(baseInput);
    expect(result.kind).toBe("applied");
    expect(tx.generation_jobs.create).toHaveBeenCalledOnce();
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

// IKF YHJ（ADR-0087）：场景卡再生成是第三条视频创建路径，与创建期/重试期共用同一个素材门。
// 门必须在事务内、建 job 之前——那几个扁平引用字段是事务内从 slot 解析出来的。
describe("SceneCardGenerationRepo.regenerateSceneCard 素材门（IKFYHJ）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("门拒绝：返回 material_blocked，且**零写入**（不建 job / 不更新 preset / 不建 record）", async () => {
    const tx = buildTx({});
    const { repo } = repoWith(tx);
    const guardInput = vi.fn().mockResolvedValue("该素材未审核通过，不能用于视频生成");

    const result = await repo.regenerateSceneCard({ ...baseInput, guardInput });

    expect(result).toEqual({
      kind: "material_blocked",
      reason: "该素材未审核通过，不能用于视频生成",
    });
    expect(tx.generation_jobs.create).not.toHaveBeenCalled();
    expect(tx.scene_card_generation_presets.updateMany).not.toHaveBeenCalled();
    expect(tx.scene_card_generation_records.create).not.toHaveBeenCalled();
  });

  it("门拿到的是事务内解析出的扁平引用（worker 会转 asset:// 的那批字段）", async () => {
    const tx = buildTx({});
    const { repo } = repoWith(tx);
    const guardInput = vi.fn().mockResolvedValue(null);

    const result = await repo.regenerateSceneCard({ ...baseInput, guardInput });

    expect(result.kind).toBe("applied");
    expect(guardInput).toHaveBeenCalledOnce();
    // 建 job 用的 input 与喂给门的对象必须同源，否则门可能在查一批、执行时用另一批。
    const jobInput = tx.generation_jobs.create.mock.calls[0][0].data.input;
    const guarded = guardInput.mock.calls[0][0] as Record<string, unknown>;
    for (const key of ["first_frame_asset_id", "last_frame_asset_id", "reference_asset_ids"]) {
      expect(guarded[key]).toEqual(jobInput[key]);
    }
  });

  it("未接线时不跑门（缺省行为与改造前一致）", async () => {
    const tx = buildTx({});
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard(baseInput);

    expect(result.kind).toBe("applied");
    expect(tx.generation_jobs.create).toHaveBeenCalledOnce();
  });

  // ===== IKHBDO：参考上限由能力行驱动（scene_card 再生成路径）=====
  // 背景：这条路径原先手搓 job.input，不写 reference_limits → worker 回落 LEGACY 常量
  //（9 图 / 3 视频 / 15 秒）；契约层还自带「参考素材最多 12 个」。两处都让配置输给写死的值。

  it("参考上限按能力行冻结进新 job（与接纳侧同一份 freezeReferenceLimits）", async () => {
    const { frames, overrides } = frameOverrides(["image"]);
    const tx = buildTx({
      ...overrides,
      ...capabilityWith({
        image_reference_max: 30,
        video_reference: true,
        video_reference_max: 5,
        audio_reference: true,
        audio_reference_max: 2,
        max_reference_duration_sec: 60,
      }),
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      reference_assets: frames,
    });

    expect(result.kind).toBe("applied");
    const input = tx.generation_jobs.create.mock.calls[0][0].data.input;
    expect(input.reference_limits).toEqual({
      image_reference_max: 30,
      video_reference_max: 5,
      audio_reference_max: 2,
      max_reference_duration_sec: 60,
    });
  });

  it("4 条参考视频：能力行配 5 放行并冻结 5、配 3 在接纳侧就拒（上限随配置，不再写死）", async () => {
    const { frames, overrides } = frameOverrides([
      "video",
      "video",
      "video",
      "video",
    ]);

    // 配 5：必须过（旧 job 快照口径下会被 worker 的 LEGACY 3 拦掉）
    const looseTx = buildTx({
      ...overrides,
      ...capabilityWith({ video_reference: true, video_reference_max: 5 }),
    });
    const loose = await repoWith(looseTx).repo.regenerateSceneCard({
      ...baseInput,
      reference_assets: frames,
    });
    expect(loose.kind).toBe("applied");
    expect(
      looseTx.generation_jobs.create.mock.calls[0][0].data.input.reference_limits,
    ).toMatchObject({ video_reference_max: 5 });

    // 配 3：同一份请求必须在**接纳侧**就被拒，判词带配置值
    const strictTx = buildTx({
      ...overrides,
      ...capabilityWith({ video_reference: true, video_reference_max: 3 }),
    });
    const strict = await repoWith(strictTx).repo.regenerateSceneCard({
      ...baseInput,
      reference_assets: frames,
    });
    expect(strict).toEqual({
      kind: "capability_limit",
      reason: "参考视频最多 3 个",
    });
    expect(strictTx.generation_jobs.create).not.toHaveBeenCalled();
    expect(
      strictTx.scene_card_generation_presets.updateMany,
    ).not.toHaveBeenCalled();
  });

  it("参考图数量按能力行判定：配 3 时第 4 张拒、配 5 时放行", async () => {
    const { frames, overrides } = frameOverrides([
      "image",
      "image",
      "image",
      "image",
    ]);

    const strict = await repoWith(
      buildTx({ ...overrides, ...capabilityWith({ image_reference_max: 3 }) }),
    ).repo.regenerateSceneCard({ ...baseInput, reference_assets: frames });
    expect(strict).toEqual({
      kind: "capability_limit",
      reason: "参考图最多 3 张",
    });

    const looseTx = buildTx({
      ...overrides,
      ...capabilityWith({ image_reference_max: 5 }),
    });
    const loose = await repoWith(looseTx).repo.regenerateSceneCard({
      ...baseInput,
      reference_assets: frames,
    });
    expect(loose.kind).toBe("applied");
  });

  it("camelCase features 历史行同样冻结出上限（归一在前，配置不丢）", async () => {
    const { frames, overrides } = frameOverrides(["image"]);
    const tx = buildTx({
      ...overrides,
      ...capabilityWith({
        imageReferenceMax: 30,
        videoReference: true,
        videoReferenceMax: 5,
      }),
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      reference_assets: frames,
    });

    expect(result.kind).toBe("applied");
    const input = tx.generation_jobs.create.mock.calls[0][0].data.input;
    expect(input.reference_limits).toMatchObject({
      image_reference_max: 30,
      video_reference_max: 5,
    });
  });

  it("参考素材超过能力行总时长上限时接纳侧拒绝（数量之外的另一条配置口径）", async () => {
    const { frames, overrides } = frameOverrides(
      ["video", "video"],
      [10_000, 10_000],
    );
    const tx = buildTx({
      ...overrides,
      ...capabilityWith({
        video_reference: true,
        video_reference_max: 3,
        max_reference_duration_sec: 15,
      }),
    });
    const { repo } = repoWith(tx);

    const result = await repo.regenerateSceneCard({
      ...baseInput,
      reference_assets: frames,
    });

    expect(result).toEqual({
      kind: "capability_limit",
      reason: "参考素材总时长超过 15 秒，请减少素材",
    });
  });
});
