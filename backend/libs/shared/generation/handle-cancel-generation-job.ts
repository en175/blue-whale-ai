import { RESOURCE_NOT_FOUND_CODE, fail, ok } from "@blue-whale/contracts";
import type {
  GenerationCommandRepo,
  ProjectRepo,
} from "@lib/shared/persistence/index.js";

/** POST /api/projects/{projectId}/generation-jobs/{jobId}/cancel：软取消（置 cancel_requested_at）。
 *  worker 读到后停止；仅归属当前用户的 queued/processing 任务可取消。 */
export async function handleCancelGenerationJob(
  userId: string,
  projectId: string,
  jobId: string,
  deps: {
    projects: Pick<ProjectRepo, "findOwnedById">;
    command: Pick<GenerationCommandRepo, "requestCancel">;
  },
) {
  const owned = await deps.projects.findOwnedById(projectId, userId);
  if (!owned) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  const hit = await deps.command.requestCancel(jobId, userId);
  if (!hit) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  return ok();
}
