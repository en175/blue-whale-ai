import { DATA_NOT_EXIST_CODE, fail, ok } from "@blue-whale/contracts";
import type { CanvasRepo, ProjectRepo } from "@blue-whale/persistence";

interface CanvasDeps {
  project: ProjectRepo;
  canvas: CanvasRepo;
}

/** GET /api/canvases?projectId=：先验 project 归属 → 返回 canvas（无记录 id=null）。 */
export async function handleGetCanvas(
  ownerId: string,
  projectId: string,
  deps: CanvasDeps,
) {
  const owned = await deps.project.findOwnedById(projectId, ownerId);
  if (!owned) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
  return ok(await deps.canvas.getByProject(projectId));
}

/** PUT /api/canvases/{projectId}：先验归属 → upsert canvas（viewport/nodes 字符串）。 */
export async function handleSaveCanvas(
  ownerId: string,
  projectId: string,
  body: {
    viewport?: unknown;
    nodes?: unknown;
    expectedVersion?: number | null;
  },
  deps: CanvasDeps,
) {
  const owned = await deps.project.findOwnedById(projectId, ownerId);
  if (!owned) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
  const viewport = typeof body.viewport === "string" ? body.viewport : null;
  const nodes = typeof body.nodes === "string" ? body.nodes : null;
  if (body.expectedVersion !== undefined) {
    const saved = await deps.canvas.saveIfVersion(
      projectId,
      body.expectedVersion,
      viewport,
      nodes,
    );
    if (!saved) {
      return { code: 412, msg: "Canvas 版本冲突", data: null } as const;
    }
    return ok(saved);
  }
  return ok(await deps.canvas.save(projectId, viewport, nodes));
}
