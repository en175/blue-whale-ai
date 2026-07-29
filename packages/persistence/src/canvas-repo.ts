import type { PrismaClient } from "@prisma/client";

/** Canvas db port（Prisma-backed），复用部署的 canvas 表（project_id 唯一 / viewport_json / nodes_json）。
 *  对齐 Java CanvasDto：{id, project_id, viewport, nodes}——viewport/nodes 是 JSON 字符串（前端 JSON.parse）。
 *  repo 负责 Json 列 ↔ 字符串转换。 */

export interface CanvasView {
  id: string | null;
  project_id: string;
  viewport: string | null;
  nodes: string | null;
}

export interface CanvasRepo {
  getByProject(projectId: string): Promise<CanvasView>;
  save(projectId: string, viewport: string | null, nodes: string | null): Promise<CanvasView>;
}

function emptyView(projectId: string): CanvasView {
  return { id: null, project_id: projectId, viewport: null, nodes: null };
}

function toView(row: {
  id: bigint;
  project_id: bigint;
  viewport_json: unknown;
  nodes_json: unknown;
}): CanvasView {
  return {
    id: row.id.toString(),
    project_id: row.project_id.toString(),
    viewport: row.viewport_json == null ? null : JSON.stringify(row.viewport_json),
    nodes: row.nodes_json == null ? null : JSON.stringify(row.nodes_json),
  };
}

export function createCanvasRepo(prisma: PrismaClient): CanvasRepo {
  return {
    async getByProject(projectId) {
      const row = await prisma.canvas.findFirst({
        where: { project_id: BigInt(projectId) },
      });
      return row ? toView(row) : emptyView(projectId);
    },
    async save(projectId, viewport, nodes) {
      const data = {
        viewport_json: viewport ? JSON.parse(viewport) : null,
        nodes_json: nodes ? JSON.parse(nodes) : null,
      };
      const row = await prisma.canvas.upsert({
        where: { project_id: BigInt(projectId) },
        create: { project_id: BigInt(projectId), ...data },
        update: data,
      });
      return toView(row);
    },
  };
}
