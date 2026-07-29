import { DATA_NOT_EXIST_CODE, fail, ok } from "@blue-whale/contracts";
import type { ProjectRepo } from "@blue-whale/persistence";

/** GET /api/projects/{id}：取单个项目（验归属）→ ok 或 100100。 */
export async function handleGetProject(ownerId: string, id: string, deps: { db: ProjectRepo }) {
  const project = await deps.db.findOwnedById(id, ownerId);
  if (!project) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
  return ok(project);
}
