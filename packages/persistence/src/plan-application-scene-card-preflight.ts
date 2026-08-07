// IK74V8：从 plan-application-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 场景卡应用前检：能力/引用解析、预设摘要与事务内视频作业创建。
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  canonicalizeJsonValue,
  deriveVideoReferenceMode,
} from "@blue-whale/contracts";
import type { ProviderPromptAsset } from "@blue-whale/contracts";

import { createJobWithinTx } from "./generation-command-repo.js";
import { capabilityDigestFromModelCapability } from "./capability-digest.js";
import {
  OPERATION,
  validateDerivedReferences,
} from "./plan-application-internals.js";
import type {
  ApplyPlanMessageInput,
  ApplyPlanMessageResult,
  CapabilitySnapshot,
  DerivedReference,
} from "./plan-application-types.js";

export interface SceneCardApplyPlanMessage {
  message_id: bigint;
  application_kind: string;
  sequence_label: string | null;
  content_markdown: string;
  derived_references: unknown;
  frozen_generation_parameters: unknown;
  capability_snapshot_version: unknown;
  provider_prompt_projection: unknown;
  target_scene_card_mention_id: bigint | null; // replace 写入用
  base_scene_card_version: number | null; // replace 写入用
}

/** 前置校验通过后解析出的写入上下文（create/replace 共用）。 */
export interface ResolvedSceneCardPlan {
  snapshot: CapabilitySnapshot;
  frozenParameters: Record<string, unknown>;
  projection: {
    prompt_text: string;
    reference_assets: ProviderPromptAsset[];
    parameters: Record<string, unknown>;
  };
  derivedReferences: DerivedReference[];
}

export type SceneCardPreflightOutcome =
  | { kind: "early_return"; result: ApplyPlanMessageResult }
  | { kind: "proceed"; resolved: ResolvedSceneCardPlan };

/** create/replace 共享前置校验流水线：
 *  CommandId 幂等 → priorReceipt 防重复 → 快照四重转型 → 能力漂移 → 引用校验。
 *  applicationKind 参数化重放结果的 application_kind（scene_card_create / scene_card_replace）。
 *  任一失败 → early_return（调用方原样透传）；全过 → proceed + 解析上下文。 */
export async function runSceneCardApplyPreflight(
  tx: Prisma.TransactionClient,
  projectId: bigint,
  input: ApplyPlanMessageInput,
  planMessage: Pick<
    SceneCardApplyPlanMessage,
    | "message_id"
    | "derived_references"
    | "frozen_generation_parameters"
    | "capability_snapshot_version"
    | "provider_prompt_projection"
  >,
  applicationKind: "scene_card_create" | "scene_card_replace",
): Promise<SceneCardPreflightOutcome> {
  // 1. CommandId 幂等（AC#6）：命中则比对 request_hash，相同重放首次结果，不同冲突。
  const existing = await tx.command_idempotency.findUnique({
    where: {
      project_id_operation_idempotency_key: {
        project_id: projectId,
        operation: OPERATION,
        idempotency_key: input.idempotencyKey,
      },
    },
    select: { request_hash: true, resource_id: true, generation_job_id: true },
  });
  if (existing) {
    if (existing.request_hash !== input.requestHash)
      return { kind: "early_return", result: { kind: "idempotency_conflict" } };
    if (existing.resource_id === null || existing.generation_job_id === null)
      return {
        kind: "early_return",
        result: {
          kind: "validation_failed",
          reason: "idempotent record missing resources",
        },
      };
    return {
      kind: "early_return",
      result: {
        kind: "replayed",
        application_kind: applicationKind,
        scene_card_id: existing.resource_id.toString(),
        generation_job_id: existing.generation_job_id.toString(),
      },
    };
  }

  // 2. 同消息最多一次成功应用（CONTEXT L227）。
  const priorReceipt = await tx.plan_application_receipts.findUnique({
    where: { message_id: planMessage.message_id },
    select: { id: true },
  });
  if (priorReceipt)
    return { kind: "early_return", result: { kind: "already_applied" } };

  // 3. 快照四重转型（冻结 JSON → 结构化视图）。
  const snapshot = planMessage.capability_snapshot_version as unknown as CapabilitySnapshot;
  const frozenParameters =
    planMessage.frozen_generation_parameters as unknown as Record<string, unknown>;
  const projection = planMessage.provider_prompt_projection as unknown as {
    prompt_text: string;
    reference_assets: ProviderPromptAsset[];
    parameters: Record<string, unknown>;
  };
  const derivedReferences =
    (planMessage.derived_references as unknown as DerivedReference[]) ?? [];

  // 4. 能力漂移检测（AC#4）：按冻结 model_id/provider_id 查当前行，比对 row_version + digest。
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
      supported_sizes: true,
      supported_aspect_ratios: true,
      supported_durations: true,
      supported_formats: true,
      default_size: true,
      default_format: true,
      default_aspect_ratio: true,
      default_duration: true,
    },
  });
  if (!capability || !capability.enabled || capability.is_delete)
    return { kind: "early_return", result: { kind: "capability_drift" } };
  const recomputedDigest = capabilityDigestFromModelCapability(capability);
  if (capability.version !== snapshot.row_version || recomputedDigest !== snapshot.digest)
    return { kind: "early_return", result: { kind: "capability_drift" } };

  // 5. 引用素材有效性（AC#4，全部在副作用前）。
  const referenceCheck = await validateDerivedReferences(tx, projectId, derivedReferences);
  if (!referenceCheck.ok)
    return {
      kind: "early_return",
      result: { kind: "validation_failed", reason: referenceCheck.reason },
    };

  return {
    kind: "proceed",
    resolved: { snapshot, frozenParameters, projection, derivedReferences },
  };
}

/** 计算预设指纹：sha256(canonicalize({parameters, reference_mode, reference_assets, capability_snapshot_version}))。
 *  create/replace 的 receipt.preset_digest 同源，抽取消除两处逐字重复。 */
export function presetDigestFromFrozen(
  frozenParameters: Record<string, unknown>,
  referenceMode: ReturnType<typeof deriveVideoReferenceMode>,
  referenceAssets: ProviderPromptAsset[],
  snapshot: CapabilitySnapshot,
): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify(
        canonicalizeJsonValue({
          parameters: frozenParameters,
          reference_mode: referenceMode,
          reference_assets: referenceAssets,
          capability_snapshot_version: snapshot,
        }),
      ),
    )
    .digest("hex")}`;
}

/** 在事务内创建首个视频 GenerationJob（source=plan），create/replace 共用。
 *  按 applicationKind 差异化载荷：create 固定单槽（expectedOutputCount=1）、
 *  传 sceneCardId（画布节点放置）并密封 provider_credential；replace 保持原载荷。
 *  返回 job id、cursor 与 referenceMode（后者供 receipt 指纹与 preset 写入复用）。 */
export async function createPlanVideoJobWithinTx(
  tx: Prisma.TransactionClient,
  input: ApplyPlanMessageInput,
  planMessage: { message_id: bigint },
  resolved: ResolvedSceneCardPlan,
  sceneCardId: bigint,
  applicationKind: "scene_card_create" | "scene_card_replace",
): Promise<{
  generationJobId: string;
  cursor: number;
  referenceMode: ReturnType<typeof deriveVideoReferenceMode>;
}> {
  const referenceMode = deriveVideoReferenceMode(resolved.projection.reference_assets);
  const isCreate = applicationKind === "scene_card_create";
  const createdJob = await createJobWithinTx(tx, {
    projectId: input.projectId,
    userId: input.userId,
    type: "video",
    expectedOutputCount: isCreate ? 1 : Number(resolved.frozenParameters.count ?? 1),
    source: "plan",
    actionIdentity: input.idempotencyKey,
    actionType: "plan.video_generation",
    ...(isCreate ? { sceneCardId: sceneCardId.toString() } : {}),
    input: {
      scene_card_id: sceneCardId.toString(),
      plan_message_id: planMessage.message_id.toString(),
      prompt_text: resolved.projection.prompt_text,
      parameters: resolved.frozenParameters,
      reference_assets: resolved.projection.reference_assets,
      reference_mode: referenceMode,
      capability_snapshot_version: resolved.snapshot,
      ...(isCreate && input.providerCredential
        ? { provider_credential: input.providerCredential }
        : {}),
    },
  });
  return {
    generationJobId: createdJob.generation_job_id,
    cursor: createdJob.cursor,
    referenceMode,
  };
}

/** 单事务原子应用 scene_card_create PlanMessage（AC#2/#3/#4/#6）。
 *  任一前置检查失败零写入；同 CommandId 重复返回首次结果；同消息跨 CommandId 已应用拒绝。 */
