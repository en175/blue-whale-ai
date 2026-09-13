import { createHash } from "node:crypto";
import {
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  PLAN_APPLICATION_CAPABILITY_DRIFT_CODE,
  PLAN_APPLICATION_QUOTA_INSUFFICIENT_CODE,
  RESOURCE_NOT_FOUND_CODE,
  SCENE_CARD_VERSION_CONFLICT_CODE,
  fail,
  ok,
  storyboardPreviewCreateRequestSchema,
} from "@lib/contracts";
import type { StoryboardPreviewRepo } from "@lib/shared/persistence/index.js";
import type { CostReservationSnapshot } from "@lib/core";

import { wireInteger } from "@lib/shared/wire-integer.js";
import type { GenerationCostEstimator } from "./cost-estimator.js";

function isDecimalId(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value);
}

/** StoryboardPreview 创建请求摘要（契约 §9 / CONTEXT L43-47）：方法 + 操作语义 + 资源路径 + body。
 *  同 CommandId 配同一摘要才重放，配不同摘要判冲突（100302）。 */
export function storyboardPreviewRequestHash(
  projectId: string,
  sceneCardId: string,
  body: string,
): string {
  return createHash("sha256")
    .update(
      `POST:scene_card.storyboard_preview:/projects/${projectId}/scene-cards/${sceneCardId}:${body}`,
    )
    .digest("hex");
}

/** 从 SceneCard 显式触发分镜预览（CONTEXT L43-47，可选旁路）。
 *  缺 Idempotency-Key → PARAM_MISSING；sceneCardId 非十进制 → 当作不存在；
 *  body 非 StoryboardPreviewCreateRequest → 400；能力漂移 → 100403；
 *  版本冲突 → 100406 附当前 SceneCard 版本；余额不足 → 100405。 */
export async function handleStoryboardPreviewCreate(
  userId: string,
  projectId: string,
  sceneCardId: string,
  idempotencyKey: string | null,
  body: string,
  deps: StoryboardPreviewRepo,
  options?: {
    providerCredential?: string;
    quotaCheck?: () => Promise<{ sufficient: boolean }>;
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
  const parsed = storyboardPreviewCreateRequestSchema.safeParse(jsonBody);
  if (!parsed.success) return fail(400, "请求参数无效");
  // URL 路径资源身份为权威，body 的 scene_card_id 必须与之相符。
  if (parsed.data.scene_card_id !== sceneCardId)
    return fail(400, "场景卡不一致");
  // 图片 worker 必须持有密封凭证；缺失时在任何事务写入前拒绝，避免创建必然失败的预览与 Job。
  if (!options?.providerCredential) {
    return fail(PARAM_MISSING_CODE, "缺少生成凭证");
  }

  // IK7G9X：建预留时写真实预估金额（数量级口径；new-api 定价不可达 → 降级 0 + dev）。
  let costReservation: CostReservationSnapshot | undefined;
  if (options?.costEstimator) {
    costReservation =
      (await options.costEstimator({
        modelId: parsed.data.parameters.model_id,
        type: "image",
        expectedOutputCount: parsed.data.parameters.count,
      })) ?? undefined;
  }

  const result = await deps.createStoryboardPreview({
    userId,
    projectId,
    sceneCardId,
    idempotencyKey,
    requestHash: storyboardPreviewRequestHash(projectId, sceneCardId, body),
    base_scene_card_version: parsed.data.base_scene_card_version,
    parameters: parsed.data.parameters,
    capability_snapshot_version: parsed.data.capability_snapshot_version,
    provider_credential: options.providerCredential,
    ...(options?.quotaCheck ? { quotaCheck: options.quotaCheck } : {}),
    ...(costReservation ? { costReservation } : {}),
  });
  switch (result.kind) {
    case "applied":
      return ok({
        preview_id: wireInteger(result.preview_id),
        scene_card_id: wireInteger(result.scene_card_id),
        generation_job_id: wireInteger(result.generation_job_id),
        cursor: wireInteger(result.cursor),
      });
    case "replayed":
      return ok({
        preview_id: wireInteger(result.preview_id),
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
      });
    case "capability_drift":
      return fail(
        PLAN_APPLICATION_CAPABILITY_DRIFT_CODE,
        "生成能力已变化，需刷新能力后重试",
      );
    case "capability_limit":
      return fail(400, result.reason);
    case "quota_insufficient":
      return fail(PLAN_APPLICATION_QUOTA_INSUFFICIENT_CODE, "余额不足");
    case "forbidden":
      return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  }
}
