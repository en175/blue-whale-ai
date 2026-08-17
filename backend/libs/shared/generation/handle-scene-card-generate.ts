import { createHash } from "node:crypto";
import {
  ASSET_UNAVAILABLE_CODE,
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  PLAN_APPLICATION_CAPABILITY_DRIFT_CODE,
  RESOURCE_NOT_FOUND_CODE,
  SCENE_CARD_VERSION_CONFLICT_CODE,
  fail,
  ok,
  sceneCardRegenerationRequestSchema,
} from "@blue-whale/contracts";
import type { SceneCardGenerationRepo } from "@blue-whale/persistence";
import type { CostReservationSnapshot } from "@blue-whale/core";

import { wireInteger } from "@lib/shared/wire-integer.js";
import type { GenerationCostEstimator } from "./cost-estimator.js";

function isDecimalId(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value);
}

/** SceneCard 再生成请求摘要（契约 §9 / CONTEXT L84-89）：方法 + 操作语义 + 资源路径 + body。
 *  同 CommandId 配同一摘要才重放，配不同摘要判冲突。 */
export function sceneCardGenerateRequestHash(
  projectId: string,
  sceneCardId: string,
  body: string,
): string {
  return createHash("sha256")
    .update(
      `POST:scene_card.generate:/projects/${projectId}/scene-cards/${sceneCardId}:${body}`,
    )
    .digest("hex");
}

/** 已有 SceneCard 受能力约束的再生成（User 在编辑器点"生成"）。
 *  缺 Idempotency-Key → PARAM_MISSING；sceneCardId 非十进制 → 当作不存在；
 *  body 非 SceneCardRegenerationRequest → 400；版本冲突 → 100406 附当前双版本。 */
export async function handleSceneCardGenerate(
  userId: string,
  projectId: string,
  sceneCardId: string,
  idempotencyKey: string | null,
  body: string,
  deps: SceneCardGenerationRepo,
  options?: {
    providerCredential?: string;
    /** IK7G9X：成本估算器（可选）。提供时建预留写真实预估金额。 */
    costEstimator?: GenerationCostEstimator;
  },
) {
  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    return fail(PARAM_MISSING_CODE, "缺少 Idempotency-Key");
  }
  if (!isDecimalId(sceneCardId)) {
    return fail(RESOURCE_NOT_FOUND_CODE, "场景卡不存在");
  }

  let jsonBody: unknown;
  try {
    jsonBody = JSON.parse(body);
  } catch {
    return fail(400, "请求参数无效");
  }
  const parsed = sceneCardRegenerationRequestSchema.safeParse(jsonBody);
  if (!parsed.success) return fail(400, "请求参数无效");
  // URL 路径资源身份为权威，body 的 scene_card_id 必须与之相符。
  if (parsed.data.scene_card_id !== sceneCardId)
    return fail(400, "场景卡不一致");

  // IK7G9X：建预留时写真实预估金额（数量级口径；new-api 定价不可达 → 降级 0 + dev）。
  let costReservation: CostReservationSnapshot | undefined;
  if (options?.costEstimator) {
    costReservation =
      (await options.costEstimator({
        modelId: parsed.data.parameters.model_id,
        type: "video",
        expectedOutputCount: 1,
      })) ?? undefined;
  }

  const result = await deps.regenerateSceneCard({
    userId,
    projectId,
    sceneCardId,
    idempotencyKey,
    requestHash: sceneCardGenerateRequestHash(projectId, sceneCardId, body),
    base_scene_card_version: parsed.data.base_scene_card_version,
    base_preset_version: parsed.data.base_preset_version,
    parameters: parsed.data.parameters,
    reference_mode: parsed.data.reference_mode,
    reference_assets: parsed.data.reference_assets,
    capability_snapshot_version: parsed.data.capability_snapshot_version,
    ...(options?.providerCredential
      ? { provider_credential: options.providerCredential }
      : {}),
    ...(costReservation ? { costReservation } : {}),
  });
  switch (result.kind) {
    case "applied":
      return ok({
        scene_card_id: wireInteger(result.scene_card_id),
        generation_job_id: wireInteger(result.generation_job_id),
        record_id: wireInteger(result.record_id),
        preset_version: result.preset_version,
        cursor: wireInteger(result.cursor),
      });
    case "replayed":
      return ok({
        scene_card_id: wireInteger(result.scene_card_id),
        generation_job_id: wireInteger(result.generation_job_id),
      });
    case "idempotency_conflict":
      return fail(
        IDEMPOTENCY_KEY_REUSED_CODE,
        "Idempotency-Key 已被其他请求使用",
      );
    case "scene_card_not_found":
      return fail(RESOURCE_NOT_FOUND_CODE, "场景卡不存在");
    case "version_conflict":
      return fail(SCENE_CARD_VERSION_CONFLICT_CODE, "版本冲突，请刷新后重试", {
        current_scene_card_version: result.current_scene_card_version,
        current_preset_version: result.current_preset_version,
      });
    case "capability_drift":
      return fail(
        PLAN_APPLICATION_CAPABILITY_DRIFT_CODE,
        "生成能力已变化，需刷新能力后重试",
      );
    case "capability_limit":
      return fail(400, result.reason);
    case "validation_failed":
      return fail(ASSET_UNAVAILABLE_CODE, "引用素材失效或来源缺失");
    case "forbidden":
      return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  }
}
