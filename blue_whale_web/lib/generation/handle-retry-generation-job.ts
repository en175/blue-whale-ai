import { fail, ok } from "@blue-whale/contracts";
import type {
  GenerationCommandRepo,
  ProjectRepo,
} from "@blue-whale/persistence";

const RESOURCE_NOT_FOUND_CODE = 100301;

/** POST /api/projects/{projectId}/generation-jobs/{jobId}/retry：
 *  仅终态 failed/partially_succeeded 的 job 可重试（retryJob 内置校验——满足「真失败才允许重试」）。
 *  复制原 job 入参建新 job（retry_of_job_id 指向原 job），状态 queued；返回新 job id + type。
 *  路由拿到 type 后按 image（processJob）/ video（BullMQ）重新入队，与 create 一致。
 *  白名单（IK6T90）仅在 create 时校验：重试沿用原 job 已验证的 model_id，不复校验——
 *  若期间模型被停用/软删，该 job 会在 provider 阶段自然失败，属预期的管理员操作结果。 */
export async function handleRetryGenerationJob(
  userId: string,
  projectId: string,
  jobId: string,
  idempotencyKey: string,
  deps: {
    projects: Pick<ProjectRepo, "findOwnedById">;
    command: Pick<GenerationCommandRepo, "retryJob">;
  },
) {
  const owned = await deps.projects.findOwnedById(projectId, userId);
  if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  const retry = await deps.command.retryJob(jobId, userId, idempotencyKey);
  if (!retry) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  return ok(retry);
}
