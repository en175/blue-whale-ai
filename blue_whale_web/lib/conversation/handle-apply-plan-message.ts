import { createHash } from "node:crypto";
import {
  ASSET_UNAVAILABLE_CODE,
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  PLAN_APPLICATION_ALREADY_APPLIED_CODE,
  PLAN_APPLICATION_CAPABILITY_DRIFT_CODE,
  PLAN_APPLICATION_KIND_UNSUPPORTED_CODE,
  PLAN_APPLICATION_PLAN_NOT_FOUND_CODE,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  ok,
} from "@blue-whale/contracts";
import type { PlanApplicationRepo } from "@blue-whale/persistence";

import { isDecimalId } from "./handle-agent-run-commands";
import { wireInteger } from "../wire-integer";

/** 计划应用请求摘要（契约 §9）：方法 + 操作语义 + 资源路径 + body。
 *  同 CommandId 配同一摘要才重放，配不同摘要判冲突（AC#6）。 */
export function planApplicationRequestHash(
  projectId: string,
  messageId: string,
  body: string,
): string {
  return createHash("sha256")
    .update(
      `POST:plan.apply:/projects/${projectId}/plan-messages/${messageId}:${body}`,
    )
    .digest("hex");
}

/** 应用一条 scene_card_create PlanMessage（User 手动触发）。
 *  缺 Idempotency-Key → PARAM_MISSING；messageId 非十进制 → 当作计划不存在。 */
export async function handleApplyPlanMessage(
  userId: string,
  projectId: string,
  messageId: string,
  idempotencyKey: string | null,
  body: string,
  deps: PlanApplicationRepo,
) {
  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    return fail(PARAM_MISSING_CODE, "缺少 Idempotency-Key");
  }
  if (!isDecimalId(messageId)) {
    return fail(PLAN_APPLICATION_PLAN_NOT_FOUND_CODE, "计划不存在");
  }
  const result = await deps.applySceneCardCreatePlan({
    userId,
    projectId,
    planMessageId: messageId,
    idempotencyKey,
    requestHash: planApplicationRequestHash(projectId, messageId, body),
  });
  switch (result.kind) {
    case "applied":
      return ok({
        message_id: wireInteger(messageId),
        scene_card_id: wireInteger(result.scene_card_id),
        generation_job_id: wireInteger(result.generation_job_id),
        receipt_id: wireInteger(result.receipt_id),
        cursor: wireInteger(result.cursor),
        application_kind: "scene_card_create",
      });
    case "replayed":
      return ok({
        message_id: wireInteger(messageId),
        scene_card_id: wireInteger(result.scene_card_id),
        generation_job_id: wireInteger(result.generation_job_id),
        application_kind: "scene_card_create",
      });
    case "idempotency_conflict":
      return fail(
        IDEMPOTENCY_KEY_REUSED_CODE,
        "Idempotency-Key 已被其他请求使用",
      );
    case "already_applied":
      return fail(
        PLAN_APPLICATION_ALREADY_APPLIED_CODE,
        "该计划已被应用，不可重复应用",
      );
    case "plan_not_found":
      return fail(PLAN_APPLICATION_PLAN_NOT_FOUND_CODE, "计划不存在");
    case "forbidden":
      return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    case "kind_unsupported":
      return fail(
        PLAN_APPLICATION_KIND_UNSUPPORTED_CODE,
        "该计划类型暂不支持应用",
      );
    case "capability_drift":
      return fail(
        PLAN_APPLICATION_CAPABILITY_DRIFT_CODE,
        "生成能力已变化，需生成新计划",
      );
    case "validation_failed":
      return fail(ASSET_UNAVAILABLE_CODE, "引用素材失效，需生成新计划");
  }
}
