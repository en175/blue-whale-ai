import type { CapabilitySnapshotVersion } from "@blue-whale/contracts";

import { capabilityDigestFromModelCapability } from "./capability-digest.js";
import {
  classifyMentionAvailability,
  type MentionClassificationInput,
} from "./mention-availability.js";

/** 计划冻结的某个 asset 引用对应的 mention 数据行在库里找不到时的处置策略。
 *
 *  这是写/读两路径一个真实的语义分歧（本次重构如实固化，非擅自统一）：
 *  - "ignore"：跳过该引用，不阻断应用。写路径 `applyImageGenerateInTransaction` 原义——
 *    它遍历的是 mention 查询结果，缺失的行根本不进循环，故静默忽略。
 *  - "unavailable"：判为失效。读路径 snapshot `plan_messages` 投影原义——
 *    它遍历的是冻结引用列表，取不到 mention 即判失效，前端展示「需重新计划」。
 *
 *  ⚠️ 写路径「缺失即忽略」可能是潜在的乐观漏判（引用素材行已不在库却仍允许应用），
 *  但本次纯重构不改写路径行为；若未来要统一两侧语义，需独立工单 + 产品评估（见 IK6MZU）。 */
export type MissingMentionPolicy = "unavailable" | "ignore";

/** 调用方已查得的 mention 行事实子集（key = mention_id 字符串）。
 *  刻意用结构子集，让写路径的本地 mention 行 / 读路径的 contracts 行都能直接传入。 */
export interface PlanApplicationMentionFact {
  readonly target_id: bigint;
  readonly target_version: number | null;
  readonly accepted_user_id: bigint;
}

/** 能力行当前事实（写路径 findFirst / 读路径 findMany 取得；undefined = 行缺失）。 */
export interface PlanApplicationCapabilityFact {
  readonly version: number;
  readonly enabled: boolean;
  readonly is_delete: boolean;
  readonly supported_sizes: unknown;
  readonly supported_aspect_ratios: unknown;
  readonly supported_durations: unknown;
  readonly supported_formats: unknown;
  readonly default_size: unknown;
  readonly default_format: unknown;
  readonly default_aspect_ratio: unknown;
  readonly default_duration: unknown;
}

export interface LoadPlanApplicationFactsInput {
  /** 计划冻结的引用列表；helper 仅处理 type==="asset"，scene_card 引用跳过。 */
  readonly derivedReferences: readonly {
    readonly type: "asset" | "scene_card";
    readonly mention_id: string;
  }[];
  /** 调用方已查得的 mention 行（key = mention_id 字符串）。 */
  readonly mentionFacts: ReadonlyMap<string, PlanApplicationMentionFact>;
  /** 调用方已查得的 asset 当前事实（key = target_id 字符串）。 */
  readonly assetById: ReadonlyMap<string, MentionClassificationInput["asset"]>;
  /** mention 数据行缺失时的处置策略（见 MissingMentionPolicy）。 */
  readonly missingMention: MissingMentionPolicy;
  readonly projectId: bigint;
  readonly userId: bigint;
  readonly capabilitySnapshot: CapabilitySnapshotVersion;
  readonly currentCapability: PlanApplicationCapabilityFact | undefined;
}

export interface PlanApplicationFacts {
  readonly mentionUnavailable: boolean;
  readonly capabilityDrifted: boolean;
}

/** 采集「一条计划消息能否应用」的两个布尔事实（mention 是否失效 / 能力是否漂移）。
 *
 *  纯函数，自身不发 SQL——所有事实由调用方查得后传入。这样单条（写路径事务内预检）/
 *  批量（读路径 plan_messages 投影）两个入口自然合一，且批量读路径不会从 1 轮查询退化成 N 轮。
 *
 *  判定树与原两处逐字等价：
 *  - mention：仅处理 type==="asset" 引用；缺失行按 missingMention 处置；余者经
 *    classifyMentionAvailability 判为 "unavailable" 即失效（任一失效即整体失效）。
 *  - capability：行缺失 / is_delete / disabled 即漂移；否则 version !== snapshot.row_version
 *    或重算 digest !== snapshot.digest 即漂移。
 *
 *  两处原差异已证明等价或由 missingMention 固化：
 *  - 读路径 SQL `where is_delete:false` 已过滤删除行，helper 多判一个恒为 false 的 is_delete 无损。
 *  - mention 缺失的处置分歧由 missingMention 参数保留两侧原义。
 *  - mention 分类 type 硬编码为 "asset"：与写路径原用 DB 的 m.mention_type 等价。因 derived_references
 *    的 type==="asset" 由 plan-commit 构造期（agent-run-repo 的 asset:// 引用 type 校验）保证其对应
 *    mention 行的 mention_type 必为 "asset"，二者结构上不会错配，故无需透传 DB mention_type。 */
export function loadPlanApplicationFacts(
  input: LoadPlanApplicationFactsInput,
): PlanApplicationFacts {
  const {
    derivedReferences,
    mentionFacts,
    assetById,
    missingMention,
    projectId,
    userId,
    capabilitySnapshot,
    currentCapability,
  } = input;

  let mentionUnavailable = false;
  for (const ref of derivedReferences) {
    if (ref.type !== "asset") continue;
    const fact = mentionFacts.get(ref.mention_id);
    if (!fact) {
      if (missingMention === "unavailable") {
        mentionUnavailable = true;
        break;
      }
      // "ignore"：写路径原义——缺失 mention 静默跳过，不阻断应用。
      continue;
    }
    const { availability } = classifyMentionAvailability({
      type: "asset",
      targetVersion: fact.target_version,
      acceptedUserId: fact.accepted_user_id,
      asset: assetById.get(fact.target_id.toString()),
      projectId,
      userId,
    });
    if (availability === "unavailable") {
      mentionUnavailable = true;
      break;
    }
  }

  let capabilityDrifted: boolean;
  if (
    !currentCapability ||
    currentCapability.is_delete ||
    !currentCapability.enabled
  ) {
    capabilityDrifted = true;
  } else {
    const currentDigest =
      capabilityDigestFromModelCapability(currentCapability);
    capabilityDrifted =
      currentCapability.version !== capabilitySnapshot.row_version ||
      currentDigest !== capabilitySnapshot.digest;
  }

  return { mentionUnavailable, capabilityDrifted };
}
