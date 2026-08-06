import { createHash } from "node:crypto";

import { fail, ok } from "@blue-whale/contracts";
import type {
  GenerationCommandRepo,
  ProjectRepo,
} from "@blue-whale/persistence";

const RESOURCE_NOT_FOUND_CODE = 100301;
const IDEMPOTENCY_CONFLICT_CODE = 100409;

/** POST /api/projects/{projectId}/generation-jobs/{jobId}/retry（IK67HE/T14）：
 *  仅终态 failed/partially_succeeded 的 job 可重试；只补 failed/missing 槽，不覆盖成功输出。
 *  接入 command_idempotency：同 Key 同摘要重放首次结果，同 Key 异摘要判冲突（409）。
 *  重试沿用原 job 已验证的 model_id，不重复白名单校验；模型后续停用时由 provider 阶段失败。
 *  路由拿到 type 后按 image（processJob）/ video（BullMQ）重新入队。 */
export async function handleRetryGenerationJob(
  userId: string,
  projectId: string,
  jobId: string,
  idempotencyKey: string,
  body: string,
  deps: {
    projects: Pick<ProjectRepo, "findOwnedById">;
    command: Pick<GenerationCommandRepo, "retryJob">;
  },
) {
  const owned = await deps.projects.findOwnedById(projectId, userId);
  if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  if (idempotencyKey.trim() === "") {
    return fail(400, "Idempotency-Key 不能为空");
  }
  const requestHash = generationRetryRequestHash(projectId, jobId, body);
  const retry = await deps.command.retryJob(
    jobId,
    projectId,
    userId,
    idempotencyKey,
    requestHash,
  );
  if (!retry) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  if ("generation_job_id" in retry) {
    return ok(retry);
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
