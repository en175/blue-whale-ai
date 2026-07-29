import { fail, ok, type ResultEnvelope } from "@blue-whale/contracts";
import type { JobRepo, ProjectRepo } from "@blue-whale/persistence";

import { projectPublicError, type PublicJobError } from "./public-error";

const RESOURCE_NOT_FOUND_CODE = 100301;

export interface JobStatusData {
  job_id: string;
  status: string;
  progress: number;
  asset: { id: string; url: string; type: string } | null;
  error: PublicJobError | null;
}

/** GET /api/jobs/{id}：轮询任务状态。
 *  对齐 Java GenerationJobService.getJobStatus：归属校验（job.user_id + project 归属），
 *  succeeded 透首个产出 asset，failed 投影公开错误信封。 */
export async function handleGetJobStatus(
  userId: string,
  jobId: string,
  deps: {
    jobs: Pick<JobRepo, "findByIdForUser">;
    projects: Pick<ProjectRepo, "findOwnedById">;
  },
): Promise<ResultEnvelope<JobStatusData>> {
  const job = await deps.jobs.findByIdForUser(jobId, userId);
  if (!job) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  // 对齐 Java projectService.requireOwned：job 的 project 也必须归属当前用户。
  const owned = await deps.projects.findOwnedById(job.project_id, userId);
  if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");

  const data: JobStatusData = {
    job_id: job.job_id,
    status: job.status,
    progress: job.progress,
    asset: job.asset,
    error:
      job.status === "failed"
        ? projectPublicError(job.stored_error, job.type)
        : null,
  };
  return ok(data);
}
