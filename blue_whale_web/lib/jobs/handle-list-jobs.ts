import { fail, ok } from "@blue-whale/contracts";
import type { JobRepo } from "@blue-whale/persistence";
import { projectPublicError, type PublicJobError } from "./public-error";

export interface ListJobsQuery {
  type?: string;
  status?: string;
  projectId?: string;
  ids?: string[];
  page: number;
  size: number;
}

export type PublicJobListItem = Omit<Awaited<ReturnType<JobRepo["listByUser"]>>["records"][number], "stored_error"> & {
  error: PublicJobError | null;
};

const MAX_BATCH_IDS = 100;
const VALID_ID = /^[1-9]\d*$/;

/** GET /api/jobs：当前用户任务列表（type/status/projectId 过滤 + 分页，创建时间倒序）。
 *  对齐 Java GenerationJobService.listJobs。 */
export async function handleListJobs(
  userId: string,
  query: ListJobsQuery,
  deps: { jobs: Pick<JobRepo, "listByUser"> },
) {
  const ids = query.ids;
  if (ids !== undefined) {
    const uniqueIds = [...new Set(ids)];
    if (
      uniqueIds.length === 0 ||
      uniqueIds.length > MAX_BATCH_IDS ||
      uniqueIds.some((id) => !VALID_ID.test(id))
    ) {
      return fail(400, uniqueIds.length > MAX_BATCH_IDS ? "最多查询 100 个任务" : "ids 参数无效");
    }
  }
  const page = await deps.jobs.listByUser(userId, {
    type: query.type,
    status: query.status,
    projectId: query.projectId,
    ids: query.ids ? [...new Set(query.ids)] : undefined,
    page: query.page,
    size: query.size,
  });
  return ok({
    ...page,
    records: page.records.map(({ stored_error: storedError, ...record }): PublicJobListItem => ({
      ...record,
      error: projectPublicError(storedError ?? null, record.type),
    })),
  });
}
