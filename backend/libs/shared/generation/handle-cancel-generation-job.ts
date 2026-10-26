import {
  ERROR_JOB_NOT_CANCELABLE,
  RESOURCE_NOT_FOUND_CODE,
  errorCodeToNumeric,
  fail,
  ok,
} from "@lib/contracts";
import type {
  GenerationCommandRepo,
  ProjectRepo,
} from "@lib/shared/persistence/index.js";

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
  const outcome = await deps.command.requestCancel(jobId, userId);
  if (outcome === "not_found") return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  if (outcome === "not_cancelable") {
    return fail(errorCodeToNumeric(ERROR_JOB_NOT_CANCELABLE), "仅排队中的任务可取消");
  }
  return ok();
}
