import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  CapabilitySnapshotVersion,
  FrozenGenerationParameters,
  ProviderPromptAsset,
  VideoReferenceMode,
} from "@lib/contracts";
import {
  aspectRatioIds,
  canonicalizeJsonValue,
  referenceModeToRequiredFeature,
  validateVideoReferenceConfiguration,
} from "@lib/contracts";

import { createJobWithinTx } from "./generation-command-repo.js";
import { capabilityDigestFromModelCapability } from "./capability-digest.js";
import { toFeatures, type ModelFeatures } from "./model-capability-repo.js";
import { appendProjectEvent } from "./product-event-repo.js";
import { transactionWithUniqueRetry } from "./conversation-repo.js";
import {
  validateDerivedReferences,
  type CapabilitySnapshot,
  type DerivedReference,
} from "./plan-application-repo.js";
import { validateStoryboardFrames } from "./storyboard-preview-repo.js";
import { checkReferenceLimits } from "../generation-runtime/reference-limits.js";
import {
  freezeReferenceLimits,
  type FrozenReferenceLimits,
} from "../generation-runtime/video-reference-validation.js";

const OPERATION = "scene_card.regenerate";

/** SceneCard 再生成 repo 入参（CONTEXT L49-63 / L84-89）：User 在编辑器调整参数后点"生成"。
 *  idempotencyKey 即 CommandId；requestHash 由 handler 按 method/path/body 计算。
 *  base 版本用于乐观并发；parameters/reference_* 为本次提交的新参数快照。 */
export interface RegenerateSceneCardInput {
  userId: string;
  projectId: string;
  sceneCardId: string;
  idempotencyKey: string;
  requestHash: string;
  base_scene_card_version: number;
  base_preset_version: number;
  parameters: FrozenGenerationParameters;
  reference_mode: VideoReferenceMode;
  reference_assets: ProviderPromptAsset[];
  capability_snapshot_version: CapabilitySnapshotVersion;
  /** 明文供应商 sk token（修正四：去密，与 Dock 生成链路一致）；worker 直接取用调网关。 */
  provider_credential?: string;
  /**
   * IKF YHJ（ADR-0087）：素材校验门。
   * <p>
   * 场景卡再生成是**第三条视频创建路径**（另两条是 `handleCreateGenerationJob` 与 `retryJob`），
   * 它同样会产出一个 `source=scene_card` 的视频 job，其冻结 input 带 `first_frame_asset_id` /
   * `last_frame_asset_id` / `reference_asset_ids`——正是 worker 执行时会转成
   * `asset://<material_id>` 的那批字段。不过门的话，预设保存之后变成 `Failed` 的素材
   * 仍能从这里进生成（届时由上游拒），与 ADR 决策 3 想避免的「点了生成再白跑一次」同形。
   * <p>
   * 只能放**事务内、建 job 之前**调用：那几个扁平字段是在事务内由
   * `resolveReferenceAssetsToFlat` 从 slot 解析出来的，事务外拿不到。
   * 返回非 null 字符串即拒绝，本方法返回 `{ kind: "material_blocked" }`，零写入。
   */
  guardInput?: (
    jobInput: Record<string, unknown>,
  ) => Promise<string | null>;
}

export type RegenerateSceneCardResult =
  | {
      kind: "applied";
      scene_card_id: string;
      generation_job_id: string;
      record_id: string;
      preset_version: number;
      cursor: string;
    }
  | {
      kind: "replayed";
      scene_card_id: string;
      generation_job_id: string;
      record_id: string;
    }
  | { kind: "idempotency_conflict" }
  | { kind: "scene_card_not_found" }
  | {
      kind: "version_conflict";
      current_scene_card_version: number;
      current_preset_version: number;
    }
  | { kind: "capability_drift" }
  | { kind: "capability_limit"; reason: string }
  | { kind: "validation_failed"; reason: string }
  | { kind: "material_blocked"; reason: string }
  | { kind: "forbidden" };

/** SceneCard 生成预设只读视图（IK67HB，T13）：编辑器打开时按需 GET，完整 Preset 参数不进 Snapshot。 */
export interface SceneCardGenerationPresetView {
  scene_card: {
    scene_card_id: string;
    version: number;
    title: string;
    content_markdown: string;
  };
  preset: {
    version: number;
    parameters: unknown;
    reference_mode: string;
    reference_assets: unknown;
    capability_snapshot_version: unknown;
  };
}

export type SceneCardGenerationPresetViewResult =
  | ({ kind: "found" } & SceneCardGenerationPresetView)
  | { kind: "not_found" }
  | { kind: "forbidden" };

export interface SceneCardGenerationRepo {
  regenerateSceneCard(
    input: RegenerateSceneCardInput,
  ): Promise<RegenerateSceneCardResult>;
  /** 编辑器只读端点：返回当前 Preset 完整参数 + SceneCard 版本与权威正文。 */
  getSceneCardGenerationPreset(
    projectId: string,
    sceneCardId: string,
    userId: string,
  ): Promise<SceneCardGenerationPresetViewResult>;
}

/** 参数越界校验（AC#1 能力约束）：返回拒绝原因或 null。
 *  除尺寸、比例、时长、数量外，参考模式必须由当前模型显式声明支持；未知能力按 false
 *  处理。features 兼容 snake_case / camelCase（DB 可能两种形态）。 */
function checkCapabilityLimit(
  parameters: FrozenGenerationParameters,
  referenceMode: VideoReferenceMode,
  capability: {
    supported_sizes: unknown;
    supported_aspect_ratios: unknown;
    supported_durations: unknown;
    features: unknown;
  },
): string | null {
  const f = (capability.features ?? {}) as Record<string, unknown>;
  // IKFPYX：任务类型约束（scene-card 与 Dock 提交同源口径）——首帧/首尾帧按 features.task_types
  // 覆盖比例/时长；未配则回落基础能力行。VideoReferenceMode 无 edit/prolong，故不涉及 duration=-1。
  const taskType =
    referenceMode === "first_and_last_frame"
      ? "first_last_frame"
      : referenceMode === "first_frame" || referenceMode === "last_frame"
        ? "first_frame"
        : "default";
  const taskMap = f.task_types ?? f.taskTypes;
  const taskEntry =
    taskMap && typeof taskMap === "object" && !Array.isArray(taskMap)
      ? ((taskMap as Record<string, unknown>)[taskType] as
          | Record<string, unknown>
          | undefined)
      : undefined;
  const taskRatios = Array.isArray(taskEntry?.allowed_ratios)
    ? (taskEntry.allowed_ratios as string[])
    : null;
  const taskDurations = Array.isArray(taskEntry?.allowed_durations)
    ? (taskEntry.allowed_durations as number[])
    : null;

  const ratios =
    taskRatios ?? aspectRatioIds(capability.supported_aspect_ratios);
  if (!ratios.includes(parameters.aspect_ratio))
    return `aspect_ratio ${parameters.aspect_ratio} 不在能力支持范围`;
  const sizes = Array.isArray(capability.supported_sizes)
    ? (capability.supported_sizes as Array<{
        id?: string;
        api_value?: string;
      }>)
    : [];
  if (
    !sizes.some(
      (s) => s.id === parameters.size || s.api_value === parameters.size,
    )
  )
    return `size ${parameters.size} 不在能力支持范围`;
  // DB 存在两种形态：档位数组 [3,5,10]（种子数据即此形态）与 {min,max} 范围对象。
  const durations = taskDurations ?? capability.supported_durations;
  if (Array.isArray(durations)) {
    if (!durations.includes(parameters.duration))
      return `duration ${parameters.duration} 不在能力支持档位`;
  } else {
    const durRange = durations as { min?: number; max?: number } | null;
    if (
      durRange &&
      typeof durRange.min === "number" &&
      typeof durRange.max === "number" &&
      (parameters.duration! < durRange.min ||
        parameters.duration! > durRange.max)
    )
      return `duration ${parameters.duration} 超出能力范围`;
  }
  const quantityMax = Number(f.quantity_max ?? f.quantityMax ?? 1);
  if (parameters.count > quantityMax)
    return `count ${parameters.count} 超过 quantity_max ${quantityMax}`;
  const required = referenceModeToRequiredFeature(referenceMode);
  if (required) {
    // features 兼容 snake_case / camelCase（DB 可能两种形态）。
    const camel = required.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (!(f[required] === true || f[camel] === true)) {
      const label =
        required === "first_last_frame"
          ? "首尾帧"
          : required === "first_frame"
            ? "首帧"
            : "尾帧";
      return `当前模型不支持${label}参考模式`;
    }
  }
  return null;
}

/** 参考素材数量上限（IKHBDO）：数量判定必须落在**手握能力行的这一层**——契约层
 *  （validateVideoReferenceConfiguration）拿不到能力行，此前写死「参考素材最多 12 个」，
 *  配了 30 的模型在第 13 个素材就被拦掉。此处改用与接纳侧同一份 checkReferenceLimits。
 *
 *  计数口径与 worker 执行期 validateReferences 一致——只数**真正会送到上游**的参考：
 *  - 计数对象 = flatReferences.reference_asset_ids（scene_card mention 无 asset 映射、不进
 *    worker，故不计数；首/尾帧在 worker 侧单独走帧字段，也不占参考额度）；
 *  - 媒体类型/时长取库中真实素材行（请求里的 ProviderPromptAsset 不带媒体类型，库里才有）；
 *  - 上限与文案由能力行 features 派生，随运营配置走。
 *  必须放在任何写入之前（本事务 return 即提交）。 */
async function checkReferenceCountLimits(
  tx: Prisma.TransactionClient,
  features: ModelFeatures,
  flatReferences: { reference_asset_ids?: string[] },
): Promise<string | null> {
  const ids = flatReferences.reference_asset_ids ?? [];
  if (ids.length === 0) return null;
  const rows = await tx.assets.findMany({
    where: { id: { in: ids.map((id) => BigInt(id)) } },
    select: { type: true, duration_ms: true },
  });
  const references: Array<{
    type: "image" | "video" | "audio";
    duration?: number;
  }> = [];
  for (const row of rows) {
    if (row.type !== "image" && row.type !== "video" && row.type !== "audio")
      continue;
    references.push({
      type: row.type,
      ...(row.type === "video" && row.duration_ms !== null
        ? { duration: row.duration_ms / 1000 }
        : {}),
    });
  }
  return checkReferenceLimits(features, references, "video");
}

/** 把请求带来的 mention 派生素材折成 validateDerivedReferences 需要的 DerivedReference 形态：
 *  复用同一套 mention→asset/scene_card 有效性校验（CONTEXT L223 应用前重新验证冻结素材）。
 *  仅收 mention 组（asset/scene_card）；画格无 mention_id，不在此处理。 */
function toDerivedReferences(
  assets: Extract<ProviderPromptAsset, { mention_id: string }>[],
): DerivedReference[] {
  return assets.map((asset) => ({
    mention_id: asset.mention_id,
    mention_seq: 0,
    type: asset.type,
    first_seen_offset: 0,
  }));
}

/** PlanMessage 派生素材（asset/scene_card）：携带 mention_id 的引用单元。 */
function isMentionAsset(
  asset: ProviderPromptAsset,
): asset is Extract<ProviderPromptAsset, { mention_id: string }> {
  return asset.type === "asset" || asset.type === "scene_card";
}

/** StoryboardPreview 画格：携带 slot_id，无 mention_id。 */
function isFrameAsset(
  asset: ProviderPromptAsset,
): asset is Extract<ProviderPromptAsset, { type: "storyboard_frame" }> {
  return asset.type === "storyboard_frame";
}

/** preset.reference_assets（JSON 列）中的 mention 项窄化（type=asset/scene_card 的对象）。 */
function isMentionAssetEntry(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const type = (value as Record<string, unknown>).type;
  return type === "asset" || type === "scene_card";
}

/** IK70LQ：把提交的 reference_assets 与当前 preset 比对分两组——
 *  PlanMessage 派生组（asset/scene_card）保留身份+顺序不变、只许改 role（防 Agent/前端偷换单元身份）；
 *  画格组（storyboard_frame）允许新增/移除/改 role（身份校验交 validateStoryboardFrames）。
 *  画格组自由编辑是相对 T14 onlyReferenceRolesChanged 的唯一放宽，零写入语义不变。 */
function validateReferenceAssetChanges(
  current: unknown,
  submitted: ProviderPromptAsset[],
): { ok: true } | { ok: false; reason: string } {
  if (!Array.isArray(current))
    return { ok: false, reason: "参考素材列表只能修改角色" };
  const currentMentions = current.filter(isMentionAssetEntry);
  const submittedMentions = submitted.filter(isMentionAsset);
  if (currentMentions.length !== submittedMentions.length)
    return { ok: false, reason: "参考素材列表只能修改角色" };
  const unchanged = submittedMentions.every((asset, index) => {
    const currentAsset = currentMentions[index];
    if (!currentAsset) return false;
    const immutableCurrent = Object.fromEntries(
      Object.entries(currentAsset).filter(([key]) => key !== "role"),
    );
    const immutableSubmitted = Object.fromEntries(
      Object.entries(asset).filter(([key]) => key !== "role"),
    );
    return (
      JSON.stringify(canonicalizeJsonValue(immutableCurrent)) ===
      JSON.stringify(canonicalizeJsonValue(immutableSubmitted))
    );
  });
  return unchanged
    ? { ok: true }
    : { ok: false, reason: "参考素材列表只能修改角色" };
}

/** IK70LQ：把结构化 reference_assets 按角色解析为 worker 读取的扁平字段（写入 job.input）。
 *  - storyboard_frame → generation_output_slots.asset_id；
 *  - scene_card mention 无 asset 映射，不进扁平字段（内容经投影进 prompt）；其首/尾帧角色
 *    已由 validateVideoReferenceConfiguration 前置拒绝，此处仅剩 reference 角色，跳过不降级。
 *  按 role 分配：first_frame→first_frame_asset_id（至多 1）、last_frame→last_frame_asset_id（至多 1）、
 *  reference→reference_asset_ids[]。身份已由 validateDerivedReferences/validateStoryboardFrames 校验。
 *  IK70LQ→IKEEFV：asset mention → conversation_message_mentions.target_id 的映射已移除——
 *  该表随旧内嵌引擎删除（写入点已没了，删除时全库 0 行），mention 目标不再可解析，
 *  等价于旧「mention 行查不到 → 不降级进扁平字段」行为。SceneCard 迁移（IKDMQM）重定来源后恢复。 */
async function resolveReferenceAssetsToFlat(
  tx: Prisma.TransactionClient,
  referenceAssets: ProviderPromptAsset[],
): Promise<{
  first_frame_asset_id?: string;
  last_frame_asset_id?: string;
  reference_asset_ids?: string[];
}> {
  const frameSlotIds = referenceAssets
    .filter(isFrameAsset)
    .map((asset) => BigInt(asset.slot_id));
  const mentionTargetById = new Map<bigint, bigint>();
  const slotAssetById = new Map<bigint, bigint>();
  if (frameSlotIds.length > 0) {
    const slots = await tx.generation_output_slots.findMany({
      where: { id: { in: frameSlotIds } },
      select: { id: true, asset_id: true },
    });
    for (const slot of slots)
      if (slot.asset_id !== null) slotAssetById.set(slot.id, slot.asset_id);
  }
  const toAssetId = (asset: ProviderPromptAsset): string | null => {
    if (asset.type === "asset") {
      const target = mentionTargetById.get(BigInt(asset.mention_id));
      return target ? target.toString() : null;
    }
    if (asset.type === "storyboard_frame") {
      const target = slotAssetById.get(BigInt(asset.slot_id));
      return target ? target.toString() : null;
    }
    return null;
  };
  let firstFrameAssetId: string | undefined;
  let lastFrameAssetId: string | undefined;
  const referenceAssetIds: string[] = [];
  // 首/尾帧各 ≤1 由前置 validateVideoReferenceConfiguration 保证，故 firstFrameAssetId/
  // lastFrameAssetId 至多赋值一次，无覆盖风险；reference 无数量上限（worker 侧再校验）。
  for (const asset of referenceAssets) {
    const assetId = toAssetId(asset);
    if (assetId === null) continue;
    if (asset.role === "first_frame") firstFrameAssetId = assetId;
    else if (asset.role === "last_frame") lastFrameAssetId = assetId;
    else referenceAssetIds.push(assetId);
  }
  const flat: {
    first_frame_asset_id?: string;
    last_frame_asset_id?: string;
    reference_asset_ids?: string[];
  } = {};
  if (firstFrameAssetId) flat.first_frame_asset_id = firstFrameAssetId;
  if (lastFrameAssetId) flat.last_frame_asset_id = lastFrameAssetId;
  if (referenceAssetIds.length > 0)
    flat.reference_asset_ids = referenceAssetIds;
  return flat;
}

/** 单事务原子再生成（AC#4/#5/#6）：前置检查全部通过才 UPDATE preset(version+1) + 新 record + 新 job。
 *  任一前置失败零写入；同 CommandId 重放首次结果；版本冲突零写入保留草稿。 */
async function regenerateSceneCardInTransaction(
  tx: Prisma.TransactionClient,
  input: RegenerateSceneCardInput,
): Promise<RegenerateSceneCardResult> {
  const projectId = BigInt(input.projectId);
  const userId = BigInt(input.userId);
  const sceneCardId = BigInt(input.sceneCardId);

  // 0. 前置授权：校验项目归属当前用户，不泄漏存在性。
  const project = await tx.project.findFirst({
    where: { id: projectId, owner_id: userId, is_delete: 0 },
    select: { id: true },
  });
  if (!project) return { kind: "forbidden" } as const;

  // 1. CommandId 幂等：命中则比对 request_hash，相同重放首次结果，不同冲突。
  const existing = await tx.command_idempotency.findUnique({
    where: {
      project_id_operation_idempotency_key: {
        project_id: projectId,
        operation: OPERATION,
        idempotency_key: input.idempotencyKey,
      },
    },
    select: {
      request_hash: true,
      resource_id: true,
      generation_job_id: true,
    },
  });
  if (existing) {
    if (existing.request_hash !== input.requestHash)
      return { kind: "idempotency_conflict" };
    if (existing.resource_id === null || existing.generation_job_id === null)
      return {
        kind: "validation_failed",
        reason: "idempotent record missing resources",
      };
    return {
      kind: "replayed",
      scene_card_id: existing.resource_id.toString(),
      generation_job_id: existing.generation_job_id.toString(),
      // 幂等表不存 record id；"0" 为哨兵值，handler 侧不消费该字段。
      record_id: "0",
    };
  }

  // 2. 读 SceneCard（校验项目归属 + 未删除）；读 Preset（1:1）。
  const sceneCard = await tx.scene_cards.findFirst({
    where: { id: sceneCardId, project_id: projectId, is_delete: 0 },
    select: { id: true, content_markdown: true, version: true },
  });
  if (!sceneCard) return { kind: "scene_card_not_found" } as const;

  const preset = await tx.scene_card_generation_presets.findFirst({
    where: { scene_card_id: sceneCardId, is_delete: 0 },
    select: { id: true, version: true, reference_assets: true },
  });
  if (!preset) return { kind: "scene_card_not_found" } as const;

  // 3. 版本冲突（AC#6 乐观并发）：base 版本与当前不一致零写入。
  if (
    sceneCard.version !== input.base_scene_card_version ||
    preset.version !== input.base_preset_version
  ) {
    return {
      kind: "version_conflict",
      current_scene_card_version: sceneCard.version,
      current_preset_version: preset.version,
    };
  }

  const referenceChanges = validateReferenceAssetChanges(
    preset.reference_assets,
    input.reference_assets,
  );
  if (!referenceChanges.ok)
    return { kind: "validation_failed", reason: referenceChanges.reason };

  // 画格组独立校验（无 mention_id，不走 validateDerivedReferences）。
  const frameAssets = input.reference_assets.filter(isFrameAsset);
  const frameCheck = await validateStoryboardFrames(
    tx,
    projectId,
    sceneCardId,
    frameAssets,
  );
  if (!frameCheck.ok)
    return { kind: "validation_failed", reason: frameCheck.reason };

  const referenceRoleReason = validateVideoReferenceConfiguration(
    input.reference_mode,
    input.reference_assets,
  );
  if (referenceRoleReason)
    return { kind: "validation_failed", reason: referenceRoleReason };

  const snapshot =
    input.capability_snapshot_version as unknown as CapabilitySnapshot;
  if (
    input.parameters.capability_type !== snapshot.capability_type ||
    input.parameters.model_id !== snapshot.model_id ||
    input.parameters.provider_id !== snapshot.provider_id
  )
    return { kind: "capability_drift" } as const;

  // （原「4. 反查首次 Receipt」已随计划通道退役删除：Receipt 的写入方在 IKCKOW/IKD806 就已删掉，
  //   这条门槛只会把「无回执的场景卡」（如经素材库 copySceneCardToProject 复制来的）挡在生成之外。
  //   它原本只是溯源用途——「重试不创建新 Receipt，来源指向首次应用」——不是权限校验，
  //   所有权与预设校验在本函数更前面，去掉不削弱授权边界。）

  // 5. 能力漂移检测（AC#4）：按提交的 model_id/provider_id 查当前行，比对 row_version + digest。
  const capability = await tx.generation_model_capability.findUnique({
    where: {
      provider_id_model_id: {
        provider_id: snapshot.provider_id,
        model_id: snapshot.model_id,
      },
    },
    select: {
      version: true,
      enabled: true,
      is_delete: true,
      // IKHEXG：toFeatures 按行类型选 image_reference_max 的缺省（音频 1 / 其余 10）。
      // 不影响 digest——capabilityDigestFromModelCapability 只取固定的 8 个参数字段。
      capability_type: true,
      supported_sizes: true,
      supported_aspect_ratios: true,
      supported_durations: true,
      supported_formats: true,
      default_size: true,
      default_format: true,
      default_aspect_ratio: true,
      default_duration: true,
      features: true,
    },
  });
  if (!capability || !capability.enabled || capability.is_delete)
    return { kind: "capability_drift" } as const;
  const recomputedDigest = capabilityDigestFromModelCapability(capability);
  if (
    capability.version !== snapshot.row_version ||
    recomputedDigest !== snapshot.digest
  )
    return { kind: "capability_drift" } as const;

  // IKHBDO：库中 features 原始 JSON → 归一能力集（snake_case + 缺省补齐）。
  // 冻结快照与参考数量判定都读这份归一值，避免 camelCase 历史行「配置输给写死的缺省」。
  // IKHEXG：传行的 capability_type——`image_reference_max` 的缺省按生成类型分（音频 1 / 其余 10）。
  const features = toFeatures(capability.features, capability.capability_type);

  // 5b. 参数越界（AC#1 能力约束）：提交参数与参考模式必须在当前能力支持范围内。
  const limitReason = checkCapabilityLimit(
    input.parameters,
    input.reference_mode,
    capability,
  );
  if (limitReason) return { kind: "capability_limit", reason: limitReason };

  // 6. 引用素材有效性（AC#4，全部在副作用前）。画格无 mention_id，只校验 mention 派生组。
  const mentionAssets = input.reference_assets.filter(isMentionAsset);
  const referenceCheck = await validateDerivedReferences(
    tx,
    projectId,
    toDerivedReferences(mentionAssets),
  );
  if (!referenceCheck.ok)
    return { kind: "validation_failed", reason: referenceCheck.reason };

  // IK70LQ 桥接：结构化→扁平，把首/尾帧/参考图 asset_id 并入 job.input 供 video-job-runner 读取。
  const flatReferences = await resolveReferenceAssetsToFlat(
    tx,
    input.reference_assets,
  );

  // 5c. 参考数量上限（IKHBDO）：数量判定只能在拿到能力行 + 素材类型之后做——契约层不再自带
  // 12 兜底（那会让配了 30 的模型在第 13 个素材被拒）。仍在任何写入之前（本事务 return 即提交）。
  const referenceCountReason = await checkReferenceCountLimits(
    tx,
    features,
    flatReferences,
  );
  if (referenceCountReason)
    return { kind: "capability_limit", reason: referenceCountReason } as const;

  // 本次 job 的执行期参考上限快照（能力行 → 冻结值）：与接纳侧同一份 freezeReferenceLimits。
  const frozenLimits: FrozenReferenceLimits = freezeReferenceLimits(features);

  // IKF YHJ（ADR-0087）：素材校验门。**必须放在这一组前置检查里**——下面那行注释以下就有写入了
  // （先 UPDATE preset 再建 job），而本事务在 return 时是正常提交的：门要是放到 preset 更新之后，
  // 一次被拒的再生成会把 preset 版本推进、却不建任何 job，留下脏状态。
  // 位置也只能在事务内——flatReferences 是上面从 slot 解出来的，事务外拿不到。
  if (input.guardInput) {
    const reason = await input.guardInput({ ...flatReferences });
    if (reason !== null) {
      return { kind: "material_blocked", reason } as const;
    }
  }

  // === 前置检查全部通过，开始原子更新（AC#4）===

  // 7. UPDATE preset（CAS：where version=base，increment；count===0 视为并发冲突）。
  const updateResult = await tx.scene_card_generation_presets.updateMany({
    where: {
      scene_card_id: sceneCardId,
      version: input.base_preset_version,
      is_delete: 0,
    },
    data: {
      parameters: input.parameters as unknown as Prisma.InputJsonValue,
      reference_mode: input.reference_mode,
      reference_assets:
        input.reference_assets as unknown as Prisma.InputJsonValue,
      capability_snapshot_version:
        input.capability_snapshot_version as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });
  if (updateResult.count === 0) {
    return {
      kind: "version_conflict",
      current_scene_card_version: sceneCard.version,
      current_preset_version: preset.version,
    };
  }
  const newPresetVersion = input.base_preset_version + 1;

  // 8. 创建新视频 GenerationJob（source=scene_card，不设 retry_of_job_id → 不伪装重试，AC#5）。
  const createdJob = await createJobWithinTx(tx, {
    projectId: input.projectId,
    userId: input.userId,
    type: "video",
    expectedOutputCount: 1,
    source: "scene_card",
    actionIdentity: input.idempotencyKey,
    actionType: "scene_card.video_regeneration",
    sceneCardId: sceneCardId.toString(),
    input: {
      scene_card_id: sceneCardId.toString(),
      prompt_text: sceneCard.content_markdown,
      parameters: input.parameters,
      reference_assets: input.reference_assets,
      reference_mode: input.reference_mode,
      capability_snapshot_version: input.capability_snapshot_version,
      // IKHBDO：参考上限冻结进快照——worker 不含模型知识，执行期只读这份配置
      //（对齐接纳侧 videoStrategy.composeInput 与 generate_audio 的冻结口径）。
      // 少了这一步，新 job 会让 worker 回落 LEGACY 常量（9 图 / 3 视频 / 15 秒），
      // 配了 video_reference_max=5 的模型第 4 条参考视频会被「参考视频最多 3 个」拒掉。
      reference_limits: frozenLimits,
      ...flatReferences,
      ...(input.provider_credential
        ? { provider_credential: input.provider_credential }
        : {}),
    },
  });
  // IKJJQU：该路径不携带 canvasRecovery，返回值恒为 CreatedJob；窄化仅为类型收束。
  if ("kind" in createdJob) throw new Error("unreachable: scene_card job creation never conflicts idempotency");
  let cursor = createdJob.cursor;

  // 9. INSERT scene_card_generation_records（新记录，summary_status=generating）。
  //    plan_message_id / application_receipt_id 两列随计划通道退役不再写入（列为 NOT NULL，
  //    迁移已放宽为 NULL-able；历史行保持原值不动）。
  const record = await tx.scene_card_generation_records.create({
    data: {
      scene_card_id: sceneCardId,
      project_id: projectId,
      summary_status: "generating",
      first_generation_job_id: BigInt(createdJob.generation_job_id),
    },
  });
  // IK67HE/T14：回填首个 job 的输出槽绑定 record（createJobWithinTx 早于 record 创建）。
  await tx.generation_output_slots.updateMany({
    where: { generation_job_id: BigInt(createdJob.generation_job_id) },
    data: { scene_card_generation_record_id: record.id },
  });

  // 10. INSERT command_idempotency（operation=scene_card.regenerate，resource_id=scene_card_id）。
  await tx.command_idempotency.create({
    data: {
      project_id: projectId,
      operation: OPERATION,
      idempotency_key: input.idempotencyKey,
      request_hash: input.requestHash,
      generation_job_id: BigInt(createdJob.generation_job_id),
      resource_id: sceneCardId,
      accepted_cursor: BigInt(cursor),
    },
  });

  // 11. project_events：scene_card.preset_updated + scene_card_generation_record.created。
  const presetEvent = await appendProjectEvent(tx, {
    projectId: input.projectId,
    eventType: "scene_card.preset_updated",
    aggregateType: "scene_card_generation_preset",
    aggregateId: sceneCardId.toString(),
    aggregateVersion: newPresetVersion,
    correlationId: input.idempotencyKey,
    payload: {
      scene_card_id: sceneCardId.toString(),
      preset_version: newPresetVersion,
      generation_job_id: createdJob.generation_job_id,
    },
  });
  const recordEvent = await appendProjectEvent(tx, {
    projectId: input.projectId,
    eventType: "scene_card_generation_record.created",
    aggregateType: "scene_card_generation_record",
    aggregateId: record.id.toString(),
    aggregateVersion: 1,
    correlationId: input.idempotencyKey,
    payload: {
      record_id: record.id.toString(),
      scene_card_id: sceneCardId.toString(),
      generation_job_id: createdJob.generation_job_id,
    },
  });
  cursor = Math.max(
    cursor,
    Number(presetEvent.cursor),
    Number(recordEvent.cursor),
  );

  return {
    kind: "applied",
    scene_card_id: sceneCardId.toString(),
    generation_job_id: createdJob.generation_job_id,
    record_id: record.id.toString(),
    preset_version: newPresetVersion,
    cursor: cursor.toString(),
  };
}

export function createSceneCardGenerationRepo(
  prisma: PrismaClient,
): SceneCardGenerationRepo {
  return {
    regenerateSceneCard(input) {
      return transactionWithUniqueRetry(
        prisma,
        (tx) => regenerateSceneCardInTransaction(tx, input),
        // 素材门（guardInput）在事务内发 HTTP，Prisma 默认 5s 的交互事务超时会把它掐成
        // P2028/500，而不是设计好的 400。与 retryJob / createJob 同口径放宽。
        { maxWait: 10_000, timeout: 30_000 },
      );
    },
    async getSceneCardGenerationPreset(projectId, sceneCardId, userId) {
      const pid = BigInt(projectId);
      const uid = BigInt(userId);
      const sid = BigInt(sceneCardId);
      const project = await prisma.project.findFirst({
        where: { id: pid, owner_id: uid, is_delete: 0 },
        select: { id: true },
      });
      if (!project) return { kind: "forbidden" } as const;
      const sceneCard = await prisma.scene_cards.findFirst({
        where: { id: sid, project_id: pid, is_delete: 0 },
        select: {
          id: true,
          title: true,
          content_markdown: true,
          version: true,
        },
      });
      if (!sceneCard) return { kind: "not_found" } as const;
      const preset = await prisma.scene_card_generation_presets.findFirst({
        where: { scene_card_id: sid, is_delete: 0 },
        select: {
          version: true,
          parameters: true,
          reference_mode: true,
          reference_assets: true,
          capability_snapshot_version: true,
        },
      });
      if (!preset) return { kind: "not_found" } as const;
      // （原「首个 PlanMessage 的 ProviderPromptProjection」读取已随计划通道退役删除：
      //   它的数据源 plan_messages 零写入方，且该字段的唯一消费者是前端一个从未被调用的 fetch。）
      return {
        kind: "found",
        scene_card: {
          scene_card_id: sceneCard.id.toString(),
          version: sceneCard.version,
          title: sceneCard.title,
          content_markdown: sceneCard.content_markdown,
        },
        preset: {
          version: preset.version,
          parameters: preset.parameters,
          reference_mode: preset.reference_mode,
          reference_assets: preset.reference_assets,
          capability_snapshot_version: preset.capability_snapshot_version,
        },
      };
    },
  };
}
