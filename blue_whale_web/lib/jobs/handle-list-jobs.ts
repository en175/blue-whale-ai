import { ok } from "@blue-whale/contracts";
import type { JobRepo } from "@blue-whale/persistence";

export interface ListJobsQuery {
  type?: string;
  status?: string;
  projectId?: string;
  page: number;
  size: number;
}

/** GET /api/jobs：当前用户任务列表（type/status/projectId 过滤 + 分页，创建时间倒序）。
 *  对齐 Java GenerationJobService.listJobs。 */
export async function handleListJobs(
  userId: string,
  query: ListJobsQuery,
  deps: { jobs: Pick<JobRepo, "listByUser"> },
) {
  const page = await deps.jobs.listByUser(userId, {
    type: query.type,
    status: query.status,
    projectId: query.projectId,
    page: query.page,
    size: query.size,
  });
  return ok(page);
}
