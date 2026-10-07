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
  ProjectRepo,
} from "@lib/shared/persistence/index.js";
import type { MaterialGate } from "./handle-create-generation-job.js";

/** POST /api/projects/{projectId}/generation-jobs/{jobId}/retry（IK67HE/T14）：
 *  仅终态 failed/partially_succeeded 的 job 可重试；只补 failed/missing 槽，不覆盖成功输出。
 *  接入 command_idempotency：同 Key 同摘要重放首次结果，同 Key 异摘要判冲突（409）。
 *  重试沿用原 job 已验证的 model_id，不重复白名单校验；模型后续停用时由 provider 阶段失败。
 *  路由拿到 type 后按 image（RocketMQ）/ video（RocketMQ）/ audio（RocketMQ）重新入队。
 *
 *  IKF YHJ（ADR-0087 决策 7）：原 job 的参数快照照搬，但快照里那批素材的校验状态可能
 *  在首次生成之后变了。重过同一道素材状态门（`materialGate`），不通过则不建重试行。
 *
 *  IKJJQU（B.3）：通用重试可携带 canvas_binding（新 submission_id 独立提交身份）。
 *  原 job 无可信受理关联或目标不一致时拒绝迁移（不建行）；绑定版本核对在重试事务
 *  锁内，冲突在重试行写入前拒绝。 */
export async function handleRetryGenerationJob(
  userId: string,
  projectId: string,
  jobId: string,
  idempotencyKey: string,
  body: string,
  deps: {
    projects: Pick<ProjectRepo, "findOwnedById">;
    command: Pick<GenerationCommandRepo, "retryJob" | "canvasBindingView">;
    /** 缺省则不做素材校验（接线方未提供——调用方必须显式知道这个取舍）。 */
    materialGate?: MaterialGate;
  },
  canvasBindingBody?: unknown,
) {
  const owned = await deps.projects.findOwnedById(projectId, userId);
  if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  if (idempotencyKey.trim() === "") {
    return fail(PARAM_MISSING_CODE, "Idempotency-Key 不能为空");
  }
  // IKJJQU：canvas_binding 纯载荷校验（Idempotency-Key 必须等于 submission_id）。
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
  // canvas_binding 的请求摘要与幂等 body 摘要同源（body 序列化已覆盖 canvas_binding 字段）。
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
  );
  if (!retry) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  if ("generation_job_id" in retry) {
    // IKJJQU：携带 canvas_binding 时在成功 data 上追加 canvas_binding 字段（受理与重放同形）。
    if (!canvasBinding) return ok(retry);
    const bindingView = await deps.command.canvasBindingView(projectId, canvasBinding.submission_id);
    return ok(bindingView ? { ...retry, canvas_binding: bindingView } : retry);
  }
  if (retry.kind === "recovery_contract_error") {
    // B.8：新协议受控错误信封直写（code=HTTP 状态）。
    return retry.envelope;
  }
  if (retry.kind === "finalize_retry_closed") {
    // IKIZQC（G08）：首版关闭同 Draft ID 成片重试——失败成片保留占位，继续创作走
    // 「重新生成样片」。与来源唯一约束共用 1057 码（同一产品语义：该样片已有成片尝试）。
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
    // IKIPWU：任务存在但不可重试——专用错误码 + 码表文案，与「资源不存在」分开可区分。
    // null 仍只留给不存在/非本人（越权隐藏口径），不泄露存在性。
    const stringCode =
      retry.kind === "not_retryable_status"
        ? ERROR_JOB_NOT_RETRYABLE_STATUS
        : ERROR_JOB_ALREADY_RETRIED;
    const code = errorCodeToNumeric(stringCode);
    return fail(code, messageOf(code));
  }
  // 剩余分支：{ kind: "idempotency_conflict" }
  return fail(IDEMPOTENCY_CONFLICT_CODE, "幂等键冲突：同键异载荷");
}

/** 重试请求摘要（method + operation + 资源路径 + body）。
 *  重试无请求 body 时仍参与摘要（空串稳定），同 Key 重放即命中。 */
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
