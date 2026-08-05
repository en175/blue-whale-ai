import { createHash } from "node:crypto";
import {
  ASSET_UNAVAILABLE_CODE,
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  PLAN_APPLICATION_ALREADY_APPLIED_CODE,
  PLAN_APPLICATION_CAPABILITY_DRIFT_CODE,
  PLAN_APPLICATION_KIND_UNSUPPORTED_CODE,
  PLAN_APPLICATION_PLAN_NOT_FOUND_CODE,
  PLAN_APPLICATION_QUOTA_INSUFFICIENT_CODE,
  PLAN_APPLICATION_TARGET_STALE_CODE,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  ok,
} from "@blue-whale/contracts";
import type { PlanApplicationRepo } from "@blue-whale/persistence";

import { isDecimalId } from "./handle-agent-run-commands";
import { wireInteger } from "../wire-integer";

/** 计划应用请求摘要（契约 §9）：方法 + 操作语义 + 资源路径 + body。
 *  同 CommandId 配同一摘要才重放，配不同摘要判冲突（AC#6）。
 *  图片应用无请求体，body 传空串。 */
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

export interface ApplyPlanMessageInternal {
  /** 图片应用必需：密封后的 sk token（建首图 job 的 provider_credential）。 */
  providerCredential?: string;
  /** 图片应用必需：余额预检（调用方闭包 sk token 调 new-api）；sufficient=false → retryable_blocked。 */
  quotaCheck?: () => Promise<{ sufficient: boolean }>;
}

/** 应用一条 PlanMessage（User 手动触发，媒体感知）：
 *  scene_card_create 建场景卡 + 首视频 job（T11）；image_generate 直接建首图 job（T10）。
 *  缺 Idempotency-Key → PARAM_MISSING；id 非十进制 → 当作计划不存在。 */
export async function handleApplyPlanMessage(
  userId: string,
  projectId: string,
  messageId: string,
  idempotencyKey: string | null,
  body: string,
  deps: PlanApplicationRepo,
  internal: ApplyPlanMessageInternal = {},
) {
  if (!idempotencyKey || idempotencyKey.trim().length === 0) {
    return fail(PARAM_MISSING_CODE, "缺少 Idempotency-Key");
  }
  if (!isDecimalId(projectId) || !isDecimalId(messageId)) {
    return fail(PLAN_APPLICATION_PLAN_NOT_FOUND_CODE, "计划不存在");
  }
  const result = await deps.applyPlanMessage({
    userId,
    projectId,
    planMessageId: messageId,
    idempotencyKey,
    requestHash: planApplicationRequestHash(projectId, messageId, body),
    providerCredential: internal.providerCredential,
    quotaCheck: internal.quotaCheck,
  });
  switch (result.kind) {
    // —— 视频分支（T11）——
    case "applied":
      return ok({
        message_id: wireInteger(messageId),
        scene_card_id: wireInteger(result.scene_card_id),
        generation_job_id: wireInteger(result.generation_job_id),
        receipt_id: wireInteger(result.receipt_id),
        cursor: wireInteger(result.cursor),
        application_kind: result.application_kind,
      });
    case "replayed":
      return ok({
        message_id: wireInteger(messageId),
        scene_card_id: wireInteger(result.scene_card_id),
        generation_job_id: wireInteger(result.generation_job_id),
        application_kind: result.application_kind,
      });
    case "already_applied":
      return fail(
        PLAN_APPLICATION_ALREADY_APPLIED_CODE,
        "该计划已被应用，不可重复应用",
      );
    case "capability_drift":
      return fail(
        PLAN_APPLICATION_CAPABILITY_DRIFT_CODE,
        "生成能力已变化，需生成新计划",
      );
    // —— 覆盖分支（scene_card_replace，T12）：目标场景卡已变化，需生成新计划 ——
    case "target_stale":
      return fail(
        PLAN_APPLICATION_TARGET_STALE_CODE,
        "目标场景卡已变化，需生成新计划",
      );
    // —— 图片分支（T10）：成功三分支统一形状（at-most-once / replay / 首次对前端同效）。
    case "applied_image":
    case "replayed_image":
    case "already_applied_image":
      return ok({
        receipt: result.receipt,
        first_generation_job_id: result.first_generation_job_id,
      });
    case "blocked_requires_new_plan":
      // 素材失效与能力漂移同属 requires_new_plan，按 blockedBy 分错误码。
      return fail(
        result.blockedBy === "mention_unavailable"
          ? ASSET_UNAVAILABLE_CODE
          : PLAN_APPLICATION_CAPABILITY_DRIFT_CODE,
        result.reason,
      );
    case "blocked_retryable":
      // 余额不足，充值后用新 CommandId 重试。
      return fail(PLAN_APPLICATION_QUOTA_INSUFFICIENT_CODE, result.reason);
    // —— 公共 ——
    case "idempotency_conflict":
      return fail(
        IDEMPOTENCY_KEY_REUSED_CODE,
        "Idempotency-Key 已被其他请求使用",
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
    case "validation_failed":
      return fail(ASSET_UNAVAILABLE_CODE, result.reason);
  }
}
