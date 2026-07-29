import { ok } from "@blue-whale/contracts";
import type { ProjectRepo, ProjectView } from "@blue-whale/persistence";

/** GET /api/projects：列出当前用户的画布项目 → ok(ProjectView[])。 */
export async function handleListProjects(ownerId: string, deps: { db: ProjectRepo }) {
  const projects: ProjectView[] = await deps.db.listByOwner(ownerId);
  return ok(projects);
}
