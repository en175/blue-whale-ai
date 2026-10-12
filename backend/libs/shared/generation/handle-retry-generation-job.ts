import { createHash } from "node:crypto";

import {
  ERROR_FINALIZE_ALREADY_ATTEMPTED,
  ERROR_INVALID_REFERENCE,
  ERROR_JOB_ALREADY_RETRIED,
  ERROR_JOB_NOT_RETRYABLE_STATUS,
  IDEMPOTENCY_CONFLICT_CODE,
  PARAM_MISSING_CODE,
  RECOVERY_REASONS,
  RESOURCE_NOT_FOUND_CODE,
  canvasBindingSchema,
  errorCodeToNumeric,
  fail,
  messageOf,
  ok,
  type CanvasBinding,
} from "@lib/contracts";
import type {
  CanvasRecoveryAcceptance,
  GenerationCommandRepo,
  JobBillingSource,
  ProjectRepo,
} from "@lib/shared/persistence/index.js";
import type { MaterialGate } from "./handle-create-generation-job.js";

export async function handleRetryGenerationJob(
  userId: string,
  projectId: string,
  jobId: string,
  idempotencyKey: string,
  body: string,
  deps: {
    projects: Pick<ProjectRepo, "findOwnedById">;
    command: Pick<GenerationCommandRepo, "retryJob" | "canvasBindingView">;
    materialGate?: MaterialGate;
    billing?: JobBillingSource;
  },
  canvasBindingBody?: unknown,
) {
  const owned = await deps.projects.findOwnedById(projectId, userId);
  if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  if (idempotencyKey.trim() === "") {
    return fail(PARAM_MISSING_CODE, "Idempotency-Key 不能为空");
  }
  let canvasBinding: CanvasBinding | null = null;
  if (canvasBindingBody !== undefined && canvasBindingBody !== null) {
    const parsed = canvasBindingSchema.safeParse(canvasBindingBody);
    if (!parsed.success) {
      return fail(400, "canvas_binding 载荷无效", { reason: RECOVERY_REASONS.invalidPayload });
    }
    canvasBinding = parsed.data;
    if (idempotencyKey.trim() !== canvasBinding.submission_id) {
      return fail(400, "Idempotency-Key 必须等于 canvas_binding.submission_id", {
        reason: RECOVERY_REASONS.invalidPayload,
      });
    }
  }
  const requestHash = generationRetryRequestHash(projectId, jobId, body);
  const gate = deps.materialGate;
  const canvasRecovery: CanvasRecoveryAcceptance | undefined = canvasBinding
    ? {
        projectId,
        userId,
        binding: canvasBinding,
        operation: "generation.retry",
        requestHash,
        idempotencyKey: canvasBinding.submission_id,
        taskType: "",
      }
    : undefined;
  const retry = await deps.command.retryJob(
    jobId,
    projectId,
    userId,
    idempotencyKey,
    requestHash,
    gate
      ? (input, jobType) =>
          gate.assertInputUsable({ userId, jobInput: input, jobType })
      : undefined,
    canvasRecovery,
    deps.billing,
  );
  if (!retry) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  if ("generation_job_id" in retry) {
    if (!canvasBinding) return ok(retry);
    const bindingView = await deps.command.canvasBindingView(projectId, canvasBinding.submission_id);
    return ok(bindingView ? { ...retry, canvas_binding: bindingView } : retry);
  }
  if (retry.kind === "recovery_contract_error") {
    return retry.envelope;
  }
  if (retry.kind === "finalize_retry_closed") {
    return fail(
      errorCodeToNumeric(ERROR_FINALIZE_ALREADY_ATTEMPTED),
      "成片失败后暂不支持同任务重试，请重新生成样片",
      { code: ERROR_FINALIZE_ALREADY_ATTEMPTED },
    );
  }
  if (retry.kind === "material_blocked") {
    return fail(errorCodeToNumeric(ERROR_INVALID_REFERENCE), retry.reason, {
      code: ERROR_INVALID_REFERENCE,
    });
  }
  if (retry.kind === "not_retryable_status" || retry.kind === "already_retried") {
    const stringCode =
      retry.kind === "not_retryable_status"
        ? ERROR_JOB_NOT_RETRYABLE_STATUS
        : ERROR_JOB_ALREADY_RETRIED;
    const code = errorCodeToNumeric(stringCode);
    return fail(code, messageOf(code));
  }
  return fail(IDEMPOTENCY_CONFLICT_CODE, "幂等键冲突：同键异载荷");
}

export function generationRetryRequestHash(
  projectId: string,
  jobId: string,
  body: string,
): string {
  return createHash("sha256")
    .update(
      `POST:generation.retry:/projects/${projectId}/generation-jobs/${jobId}/retry:${body}`,
    )
    .digest("hex");
}
