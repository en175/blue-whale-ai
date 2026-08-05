import { createHash } from "node:crypto";

import {
  IDEMPOTENCY_KEY_REUSED_CODE,
  PARAM_MISSING_CODE,
  PLAN_APPLY_CONFLICT_CODE,
  QUOTA_INSUFFICIENT_CODE,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  ok,
} from "@blue-whale/contracts";
import type { PlanApplicationRepo } from "@blue-whale/persistence";

import { isDecimalId } from "./handle-agent-run-commands";

/** 手动应用请求摘要：方法 + 操作语义 + 资源路径（对齐 agentRunCommandRequestHash）。 */
export function planApplyRequestHash(
  projectId: string,
  planMessageId: string,
): string {
  return createHash("sha256")
    .update(
      `POST:plan_message.apply:/projects/${projectId}/plan-messages/${planMessageId}`,
    )
    .digest("hex");
}

export interface ApplyPlanMessageDeps {
  applyPlanMessage: PlanApplicationRepo["applyPlanMessage"];
  /** 余额预检（调用方闭包 sk token 调 new-api）；sufficient=false → retryable_blocked。 */
  quotaCheck: () => Promise<{ sufficient: boolean }>;
}

/** 手动应用 image_generate 计划卡：kind → envelope（镜像 handleStopAgentRun/handleRetryAgentRun）。
 *  apply 成功（首次/replay/at-most-once）一律 envelope code 200，route 据此回 202。 */
export async function handleApplyPlanMessage(
  userId: string,
  projectId: string,
  planMessageId: string,
  idempotencyKey: string | null,
  deps: ApplyPlanMessageDeps,
  internal: { providerCredential?: string } = {},
) {
  if (!idempotencyKey || idempotencyKey.trim() === "") {
    return fail(PARAM_MISSING_CODE, "缺少 Idempotency-Key");
  }
  if (!isDecimalId(projectId) || !isDecimalId(planMessageId)) {
    return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  }
  if (!internal.providerCredential) {
    return fail(PARAM_MISSING_CODE, "缺少生成凭证");
  }
  const result = await deps.applyPlanMessage({
    userId,
    projectId,
    planMessageId,
    idempotencyKey,
    requestHash: planApplyRequestHash(projectId, planMessageId),
    providerCredential: internal.providerCredential,
    quotaCheck: deps.quotaCheck,
  });
  switch (result.kind) {
    case "applied":
    case "replayed":
    case "already_applied":
      // 三个成功分支统一形状（at-most-once / replay / 首次对前端同效）。
      // cursor 不暴露：前端用 plan_message.applied 事件水位做 SSE 同步。
      return ok({
        receipt: result.receipt,
        first_generation_job_id: result.firstGenerationJobId,
      });
    case "not_found":
      return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
    case "idempotency_conflict":
      return fail(
        IDEMPOTENCY_KEY_REUSED_CODE,
        "Idempotency-Key 已被其他请求使用",
      );
    case "blocked_requires_new_plan":
      // 计划与当前事实冲突（素材失效/能力漂移），重试无意义，需重新对话生成。
      return fail(PLAN_APPLY_CONFLICT_CODE, result.reason);
    case "blocked_retryable":
      // 余额不足，充值后用新 CommandId 重试。
      return fail(QUOTA_INSUFFICIENT_CODE, result.reason);
  }
}
