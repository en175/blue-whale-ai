import { createHash } from "node:crypto";

import { ERROR_INVALID_REFERENCE, RESOURCE_NOT_FOUND_CODE, fail, ok } from "@lib/contracts";
import type {
  GenerationCommandRepo,
  ProjectRepo,
} from "@lib/shared/persistence/index.js";
import type { MaterialGate } from "./handle-create-generation-job.js";

const IDEMPOTENCY_CONFLICT_CODE = 100409;

/** POST /api/projects/{projectId}/generation-jobs/{jobId}/retry（IK67HE/T14）：
 *  仅终态 failed/partially_succeeded 的 job 可重试；只补 failed/missing 槽，不覆盖成功输出。
 *  接入 command_idempotency：同 Key 同摘要重放首次结果，同 Key 异摘要判冲突（409）。
 *  重试沿用原 job 已验证的 model_id，不重复白名单校验；模型后续停用时由 provider 阶段失败。
 *  路由拿到 type 后按 image（RocketMQ）/ video（RocketMQ）/ audio（RocketMQ）重新入队。
 *
 *  IKF YHJ（ADR-0087 决策 7）：原 job 的参数快照照搬，但快照里那批素材的校验状态可能
 *  在首次生成之后变了。重过同一道素材状态门（`materialGate`），不通过则不建重试行。 */
export async function handleRetryGenerationJob(
  userId: string,
  projectId: string,
  jobId: string,
  idempotencyKey: string,
  body: string,
  deps: {
    projects: Pick<ProjectRepo, "findOwnedById">;
    command: Pick<GenerationCommandRepo, "retryJob">;
    /** 缺省则不做素材校验（接线方未提供——调用方必须显式知道这个取舍）。 */
    materialGate?: MaterialGate;
  },
) {
  const owned = await deps.projects.findOwnedById(projectId, userId);
  if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  if (idempotencyKey.trim() === "") {
    return fail(400, "Idempotency-Key 不能为空");
  }
  const requestHash = generationRetryRequestHash(projectId, jobId, body);
  const gate = deps.materialGate;
  const retry = await deps.command.retryJob(
    jobId,
    projectId,
    userId,
    idempotencyKey,
    requestHash,
    gate
      ? (input) => gate.assertInputUsable({ userId, jobInput: input })
      : undefined,
  );
  if (!retry) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  if ("generation_job_id" in retry) {
    return ok(retry);
  }
  if (retry.kind === "material_blocked") {
    return fail(400, retry.reason, { code: ERROR_INVALID_REFERENCE });
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
