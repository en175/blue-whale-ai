import { DATA_NOT_EXIST_CODE, fail, ok } from "@blue-whale/contracts";
import type { ProjectRepo } from "@blue-whale/persistence";

/** DELETE /api/projects/{id}：逻辑删除（验归属）→ ok 或 100100。 */
export async function handleDeleteProject(ownerId: string, id: string, deps: { db: ProjectRepo }) {
  const deleted = await deps.db.delete(id, ownerId);
  if (!deleted) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
  return ok();
}
