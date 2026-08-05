import type { Prisma, PrismaClient } from "@prisma/client";

/** Canvas db port（Prisma-backed），复用部署的 canvas 表（project_id 唯一 / viewport_json / nodes_json）。
 *  对齐 Java CanvasDto：{id, project_id, viewport, nodes}——viewport/nodes 是 JSON 字符串（前端 JSON.parse）。
 *  repo 负责 Json 列 ↔ 字符串转换。 */

export interface CanvasView {
  id: string | null;
  project_id: string;
  version: number | null;
  viewport: string | null;
  nodes: string | null;
}

export interface CanvasRepo {
  getByProject(projectId: string): Promise<CanvasView>;
  save(
    projectId: string,
    viewport: string | null,
    nodes: string | null,
  ): Promise<CanvasView>;
  /** 仅当 Canvas 仍是调用方读取的版本时保存；冲突返回 null，由调用方重读并重算。 */
  saveIfVersion(
    projectId: string,
    expectedVersion: number | null,
    viewport: string | null,
    nodes: string | null,
  ): Promise<CanvasView | null>;
}

function emptyView(projectId: string): CanvasView {
  return {
    id: null,
    project_id: projectId,
    version: null,
    viewport: null,
    nodes: null,
  };
}

function toView(row: {
  id: bigint;
  project_id: bigint;
  version: number;
  viewport_json: unknown;
  nodes_json: unknown;
}): CanvasView {
  return {
    id: row.id.toString(),
    project_id: row.project_id.toString(),
    version: row.version,
    viewport:
      row.viewport_json == null ? null : JSON.stringify(row.viewport_json),
    nodes: row.nodes_json == null ? null : JSON.stringify(row.nodes_json),
  };
}

function outputSlotIds(nodes: unknown): bigint[] {
  if (!Array.isArray(nodes)) return [];
  const ids = new Set<bigint>();
  for (const node of nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    const id = (node as Record<string, unknown>).id;
    if (typeof id !== "string") continue;
    const match = /^generation-output:([1-9][0-9]*)$/.exec(id);
    if (match?.[1]) ids.add(BigInt(match[1]));
  }
  return [...ids];
}

async function markOutputSlotsPlaced(
  tx: Prisma.TransactionClient,
  projectId: bigint,
  nodes: unknown,
): Promise<void> {
  const ids = outputSlotIds(nodes);
  if (ids.length === 0) return;
  await tx.generation_output_slots.updateMany({
    where: {
      id: { in: ids },
      project_id: projectId,
      status: "succeeded",
      initial_placement_status: "pending",
    },
    data: { initial_placement_status: "placed" },
  });
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
      const pid = BigInt(projectId);
      const data = {
        viewport_json: viewport ? JSON.parse(viewport) : null,
        nodes_json: nodes ? JSON.parse(nodes) : null,
      };
      return prisma.$transaction(async (tx) => {
        const row = await tx.canvas.upsert({
          where: { project_id: pid },
          create: { project_id: pid, ...data },
          update: { ...data, version: { increment: 1 } },
        });
        await markOutputSlotsPlaced(tx, pid, data.nodes_json);
        return toView(row);
      });
    },
    async saveIfVersion(projectId, expectedVersion, viewport, nodes) {
      const pid = BigInt(projectId);
      const data = {
        viewport_json: viewport ? JSON.parse(viewport) : null,
        nodes_json: nodes ? JSON.parse(nodes) : null,
      };
      if (expectedVersion === null) {
        try {
          return await prisma.$transaction(async (tx) => {
            const row = await tx.canvas.create({
              data: { project_id: pid, ...data },
            });
            await markOutputSlotsPlaced(tx, pid, data.nodes_json);
            return toView(row);
          });
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "P2002"
          ) {
            return null;
          }
          throw error;
        }
      }
      return prisma.$transaction(async (tx) => {
        const result = await tx.canvas.updateMany({
          where: { project_id: pid, version: expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        if (result.count !== 1) return null;
        await markOutputSlotsPlaced(tx, pid, data.nodes_json);
        const row = await tx.canvas.findFirst({ where: { project_id: pid } });
        return row ? toView(row) : null;
      });
    },
  };
}
