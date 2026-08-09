// IK74V8：从 agent-run-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 计划卡验证与冻结准备（T09）：只读与冻结计算，零消息/计划写入。
import { Prisma } from "@prisma/client";
import {
  assetContextProjectionSchema,
  deriveProviderPromptProjection,
  mentionInputSnapshotSchema,
  type CapabilitySnapshotVersion,
  type DerivedReference,
  type FrozenGenerationParameters,
  type PlanApplicationKind,
  type PlanCardCandidate,
  type ProviderPromptProjection,
} from "@blue-whale/contracts";

import { capabilityDigestFromModelCapability } from "./capability-digest.js";
import { classifyMentionAvailability } from "./mention-availability.js";
import { loadMentionTargetFacts } from "./agent-run-repo-internals.js";

export function capabilityTypeForKind(kind: string): "image" | "video" {
  return kind === "image_generate" ? "image" : "video";
}

/** 从 content_markdown 解析 asset://<mention_id> 引用，按首次出现去重并记录偏移。 */
export function parseAssetReferences(contentMarkdown: string): Array<{
  mentionId: string;
  firstSeenOffset: number;
}> {
  const pattern = /asset:\/\/([0-9]+)/g;
  const seen = new Map<string, number>();
  for (let match = pattern.exec(contentMarkdown); match !== null; match = pattern.exec(contentMarkdown)) {
    const mentionId = match[1];
    if (mentionId !== undefined && !seen.has(mentionId)) {
      seen.set(mentionId, match.index);
    }
  }
  return [...seen.entries()].map(([mentionId, firstSeenOffset]) => ({
    mentionId,
    firstSeenOffset,
  }));
}

export function includesValue(list: unknown, value: unknown): boolean {
  // 枚举项存在两种形态：字符串数组与 [{id, api_value, ...}] 对象数组（生产数据即对象形态）。
  return (
    Array.isArray(list) &&
    list.some((entry) => {
      if (entry === value) return true;
      if (entry && typeof entry === "object") {
        const item = entry as { id?: unknown; api_value?: unknown };
        return item.id === value || item.api_value === value;
      }
      return false;
    })
  );
}

export interface PreparedPlanMessage {
  readonly applicationKind: PlanApplicationKind;
  readonly contentMarkdown: string;
  readonly sequenceLabel: string | null;
  readonly targetSceneCardMentionId: string | null;
  readonly baseSceneCardVersion: number | null;
  readonly basePlanMessageId: string | null;
  readonly sourcePlanMessageId: string | null;
  readonly derivedReferences: DerivedReference[];
  readonly frozenParameters: FrozenGenerationParameters;
  readonly capabilitySnapshotVersion: CapabilitySnapshotVersion;
  readonly providerPromptProjection: ProviderPromptProjection;
}

export interface MentionRecheckRow {
  readonly mention_id: string;
  readonly mention_seq: number;
  readonly type: "asset" | "scene_card";
  readonly target_id: bigint;
  readonly target_version: number | null;
  readonly currentAvailability: "available" | "stale" | "unavailable";
  readonly projection: unknown;
}

/** 计划卡验证 + 冻结准备（T09，AC#2/#5/#6/#7）。**零消息/计划写入**——只读与冻结计算。
 *  任一失败返回 failureMessage，调用方据此走 failed commit（零 plan 行）。
 *  - 结构：scene_card_replace 独占单卡；快照条目任一当前 unavailable → FAIL（AC#5 实时闸门）；
 *  - 引用：content_markdown 的 asset:// 必须命中本轮快照（幻觉 → FAIL），按首次出现去重；
 *    scene_card_replace 的 target 必须是本轮当前 available 的 scene_card mention，base 版本取其 target_version；
 *  - 能力：按 kind 选 image/video 能力行，overrides + defaults 冻结并校验 ∈ 枚举（AC#6）；
 *  - 投影：ProviderPromptProjection 由权威 Markdown 确定性派生（AC#7）。 */
export async function validateAndPreparePlanCards(
  tx: Prisma.TransactionClient,
  run: { project_id: bigint; user_id: bigint },
  advance: { mention_input_snapshot: unknown },
  cards: readonly PlanCardCandidate[],
): Promise<
  | { ok: true; plans: PreparedPlanMessage[] }
  | { ok: false; failureMessage: string }
> {
  // 结构：scene_card_replace 必须独占单卡（CONTEXT：不能与其他类型混合，也不能多张 replace）。
  const replaceCards = cards.filter(
    (card) => card.application_kind === "scene_card_replace",
  );
  if (replaceCards.length > 1 || (replaceCards.length === 1 && cards.length > 1)) {
    return {
      ok: false,
      failureMessage:
        "scene_card_replace must be exclusive: exactly one card per submission",
    };
  }

  // 解析本轮 MentionInputSnapshot + 重查当前可用性（AC#5：读当前事实，不读冻结值）。
  const snapshotParse = mentionInputSnapshotSchema.safeParse(
    advance.mention_input_snapshot,
  );
  if (!snapshotParse.success) {
    return {
      ok: false,
      failureMessage: "mention input snapshot missing or invalid for advance",
    };
  }
  const snapshotEntries = snapshotParse.data.entries;
  const mentionRows = await tx.conversation_message_mentions.findMany({
    where: {
      id: { in: snapshotEntries.map((entry) => BigInt(entry.mention_id)) },
    },
    select: {
      id: true,
      mention_type: true,
      target_id: true,
      target_version: true,
      accepted_user_id: true,
    },
  });
  const mentionRowById = new Map(
    mentionRows.map((row) => [row.id.toString(), row]),
  );
  const { assetById, sceneCardById } = await loadMentionTargetFacts(
    tx,
    mentionRows,
  );
  const rechecked = new Map<string, MentionRecheckRow>();
  for (const entry of snapshotEntries) {
    const row = mentionRowById.get(entry.mention_id);
    if (
      !row ||
      (row.mention_type !== "asset" && row.mention_type !== "scene_card")
    ) {
      return {
        ok: false,
        failureMessage: `mention ${entry.mention_id} no longer resolvable`,
      };
    }
    const { availability } = classifyMentionAvailability({
      type: row.mention_type,
      targetVersion: row.target_version,
      acceptedUserId: row.accepted_user_id,
      asset: assetById.get(row.target_id.toString()),
      sceneCard: sceneCardById.get(row.target_id.toString()),
      projectId: run.project_id,
      userId: run.user_id,
    });
    // AC#5：任一快照条目当前 unavailable → 整批不得接纳。
    if (availability === "unavailable") {
      return {
        ok: false,
        failureMessage: `mention ${entry.mention_id} is currently unavailable`,
      };
    }
    rechecked.set(entry.mention_id, {
      mention_id: entry.mention_id,
      mention_seq: entry.mention_seq,
      type: row.mention_type,
      target_id: row.target_id,
      target_version: row.target_version,
      currentAvailability: availability,
      projection: entry.projection,
    });
  }

  // 血缘指针必须指向已接纳的 PlanMessage（幻觉 ID → 整批 FAIL，AC#2 原子性）。
  const lineageIds = [...new Set(
    cards.flatMap((card) => [
      card.base_plan_message_id,
      card.source_plan_message_id,
    ]),
  )].filter((id): id is string => Boolean(id));
  const existingPlanMessageIds = new Set(
    lineageIds.length === 0
      ? []
      : (
          await tx.plan_messages.findMany({
            where: { id: { in: lineageIds.map((id) => BigInt(id)) } },
            select: { id: true },
          })
        ).map((row) => row.id.toString()),
  );

  // 按应用类型预取能力行（image / video），同一批次同类型复用。
  const capabilityCache = new Map<"image" | "video", CapabilityRow>();
  const plans: PreparedPlanMessage[] = [];
  for (const card of cards) {
    for (const [label, lineageId] of [
      ["base_plan_message_id", card.base_plan_message_id],
      ["source_plan_message_id", card.source_plan_message_id],
    ] as const) {
      if (lineageId && !existingPlanMessageIds.has(lineageId)) {
        return {
          ok: false,
          failureMessage: `${label} ${lineageId} does not reference an existing plan message`,
        };
      }
    }
    const capabilityType = capabilityTypeForKind(card.application_kind);
    let capability = capabilityCache.get(capabilityType);
    if (!capability) {
      const found = await resolveCapability(tx, capabilityType);
      if (!found) {
        return {
          ok: false,
          failureMessage: `no enabled ${capabilityType} generation capability available`,
        };
      }
      capabilityCache.set(capabilityType, found);
      capability = found;
    }

    // content_markdown 的 asset:// 引用去重 → derived_references（幻觉 → FAIL）。
    const references = parseAssetReferences(card.content_markdown);
    const derivedReferences: DerivedReference[] = [];
    for (const reference of references) {
      const recheck = rechecked.get(reference.mentionId);
      if (!recheck) {
        return {
          ok: false,
          failureMessage: `card references unknown mention asset://${reference.mentionId}`,
        };
      }
      if (recheck.type !== "asset") {
        return {
          ok: false,
          failureMessage: `asset:// reference ${reference.mentionId} is not an asset mention`,
        };
      }
      const projectionParse = assetContextProjectionSchema.safeParse(
        recheck.projection,
      );
      if (!projectionParse.success) {
        return {
          ok: false,
          failureMessage: `mention ${reference.mentionId} projection missing for reference`,
        };
      }
      derivedReferences.push({
        mention_id: recheck.mention_id,
        mention_seq: recheck.mention_seq,
        type: "asset",
        first_seen_offset: reference.firstSeenOffset,
        projection: projectionParse.data,
      });
    }

    // scene_card_replace 的 target 必须是本轮当前 available 的 scene_card mention（非 stale）。
    let targetSceneCardMentionId: string | null = null;
    let baseSceneCardVersion: number | null = null;
    if (card.application_kind === "scene_card_replace") {
      const target = rechecked.get(card.target_scene_card_mention_id);
      if (!target || target.type !== "scene_card") {
        return {
          ok: false,
          failureMessage:
            "scene_card_replace target is not a scene_card mention in this round",
        };
      }
      if (target.currentAvailability !== "available") {
        return {
          ok: false,
          failureMessage:
            "scene_card_replace target scene card is stale or unavailable",
        };
      }
      targetSceneCardMentionId = target.mention_id;
      baseSceneCardVersion = target.target_version;
    }

    // 冻结生成参数（overrides + 能力 defaults，校验 ∈ 枚举，AC#6）。
    const overrides = card.parameter_overrides ?? {};
    const size = overrides.size ?? capability.default_size;
    if (!includesValue(capability.supported_sizes, size)) {
      return { ok: false, failureMessage: `unsupported size: ${size}` };
    }
    const aspectRatio =
      overrides.aspect_ratio ?? capability.default_aspect_ratio;
    if (!includesValue(capability.supported_aspect_ratios, aspectRatio)) {
      return {
        ok: false,
        failureMessage: `unsupported aspect_ratio: ${aspectRatio}`,
      };
    }
    const format =
      capabilityType === "image"
        ? (overrides.format ?? capability.default_format ?? null)
        : null;
    if (format !== null && !includesValue(capability.supported_formats, format)) {
      return { ok: false, failureMessage: `unsupported format: ${format}` };
    }
    const duration =
      capabilityType === "video"
        ? (overrides.duration ?? capability.default_duration ?? null)
        : null;
    if (
      duration !== null &&
      !includesValue(capability.supported_durations, duration)
    ) {
      return { ok: false, failureMessage: `unsupported duration: ${duration}` };
    }
    const count = overrides.count ?? 1;
    const frozenParameters: FrozenGenerationParameters = {
      capability_type: capabilityType,
      model_id: capability.model_id,
      provider_id: capability.provider_id,
      size,
      aspect_ratio: aspectRatio,
      format,
      duration,
      count,
    };

    const capabilitySnapshotVersion: CapabilitySnapshotVersion = {
      schema_version: 1,
      capability_type: capabilityType,
      model_id: capability.model_id,
      provider_id: capability.provider_id,
      row_version: capability.row_version,
      digest: capabilityDigestFromModelCapability(capability),
    };

    // AC#5：首/尾帧角色只能指向已验证的 derived_references（CONTEXT L179）。
    // 越界/不存在的 seq 不得静默降级为 reference，整批 FAIL。
    const firstFrameSeq = overrides.first_frame_mention_seq ?? null;
    const lastFrameSeq = overrides.last_frame_mention_seq ?? null;
    const validFrameSeqs = new Set(derivedReferences.map((ref) => ref.mention_seq));
    for (const [label, seq] of [
      ["first_frame_mention_seq", firstFrameSeq],
      ["last_frame_mention_seq", lastFrameSeq],
    ] as const) {
      if (seq !== null && !validFrameSeqs.has(seq)) {
        return {
          ok: false,
          failureMessage: `${label} ${seq} does not point to a verified derived reference`,
        };
      }
    }

    const providerPromptProjection = deriveProviderPromptProjection({
      content_markdown: card.content_markdown,
      derived_references: derivedReferences,
      frozen_generation_parameters: frozenParameters,
      first_frame_mention_seq: firstFrameSeq,
      last_frame_mention_seq: lastFrameSeq,
    });

    plans.push({
      applicationKind: card.application_kind,
      contentMarkdown: card.content_markdown,
      sequenceLabel: card.sequence_label_noun ?? null,
      targetSceneCardMentionId,
      baseSceneCardVersion,
      basePlanMessageId: card.base_plan_message_id ?? null,
      sourcePlanMessageId: card.source_plan_message_id ?? null,
      derivedReferences,
      frozenParameters,
      capabilitySnapshotVersion,
      providerPromptProjection,
    });
  }

  return { ok: true, plans };
}

export interface CapabilityRow {
  readonly model_id: string;
  readonly provider_id: string;
  readonly row_version: number;
  readonly supported_sizes: unknown;
  readonly supported_aspect_ratios: unknown;
  readonly supported_durations: unknown;
  readonly supported_formats: unknown;
  readonly default_size: string;
  readonly default_format: string | null;
  readonly default_aspect_ratio: string;
  readonly default_duration: number | null;
}

/** 事务内按类型取首个启用能力（sort_order/id 升序），确定性选择。 */
export async function resolveCapability(
  tx: Prisma.TransactionClient,
  capabilityType: "image" | "video",
): Promise<CapabilityRow | null> {
  const row = await tx.generation_model_capability.findFirst({
    where: { capability_type: capabilityType, enabled: true, is_delete: false },
    orderBy: [{ sort_order: "asc" }, { id: "asc" }],
  });
  if (!row) return null;
  return {
    model_id: row.model_id,
    provider_id: row.provider_id,
    row_version: row.version,
    supported_sizes: row.supported_sizes,
    supported_aspect_ratios: row.supported_aspect_ratios,
    supported_durations: row.supported_durations,
    supported_formats: row.supported_formats,
    default_size: row.default_size,
    default_format: row.default_format,
    default_aspect_ratio: row.default_aspect_ratio,
    default_duration: row.default_duration,
  };
}

