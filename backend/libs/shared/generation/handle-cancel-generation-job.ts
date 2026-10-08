import { RESOURCE_NOT_FOUND_CODE, fail, ok } from "@lib/contracts";
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
  const hit = await deps.command.requestCancel(jobId, userId);
  if (!hit) return fail(RESOURCE_NOT_FOUND_CODE, "资源不存在");
  return ok();
}
