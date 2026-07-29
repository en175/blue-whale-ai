import { FAILURE_CODE, fail, ok } from "@blue-whale/contracts";
import type { ProjectRepo } from "@blue-whale/persistence";

/** POST /api/projects：校验 name → 建 project → ok(ProjectView)。 */
export async function handleCreateProject(
  ownerId: string,
  body: { name?: unknown },
  deps: { db: ProjectRepo },
) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return fail(FAILURE_CODE, "项目名不能为空");
  const project = await deps.db.create(ownerId, name);
  return ok(project);
}
