import { DATA_NOT_EXIST_CODE, FAILURE_CODE, fail, ok } from "@blue-whale/contracts";
import type { ProjectRepo } from "@blue-whale/persistence";

/** PUT /api/projects/{id}：重命名（验归属）→ ok 或 400(空名) / 100100(不存在)。 */
export async function handleRenameProject(
  ownerId: string,
  id: string,
  body: { name?: unknown },
  deps: { db: ProjectRepo },
) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return fail(FAILURE_CODE, "项目名不能为空");
  const project = await deps.db.rename(id, ownerId, name);
  if (!project) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
  return ok(project);
}
