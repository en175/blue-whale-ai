import { Prisma } from "@prisma/client";

import {
  edgeRowFromInput,
  nodeRowFromInput,
  type CanvasEdgeInput,
  type CanvasNodeInput,
} from "../canvas/apply-diff.js";

export type CanvasRowsWriteReason =
  | "invalid_node"
  | "invalid_edge"
  | "duplicate_node_id"
  | "duplicate_edge_id"
  | "duplicate_edge_pair"
  | "missing_endpoint";

export class CanvasRowsWriteError extends Error {
  constructor(
    readonly reason: CanvasRowsWriteReason,
    readonly detail: string,
  ) {
    super(`${reason}: ${detail}`);
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseNodes(raw: unknown): CanvasNodeInput[] {
  if (!Array.isArray(raw)) throw new CanvasRowsWriteError("invalid_node", "节点不是数组");
  const seen = new Set<string>();
  return raw.map((item, index) => {
    const node = asObject(item);
    if (!node) throw new CanvasRowsWriteError("invalid_node", `nodes[${index}] 不是对象`);
    if (typeof node.id !== "string" || node.id.length === 0) {
      throw new CanvasRowsWriteError("invalid_node", `nodes[${index}] 缺少 id`);
    }
    if (typeof node.type !== "string" || node.type.length === 0) {
      throw new CanvasRowsWriteError("invalid_node", `nodes[${index}] 缺少 type`);
    }
    const data = node.data == null ? {} : asObject(node.data);
    if (!data) throw new CanvasRowsWriteError("invalid_node", `nodes[${index}] 的 data 不是对象`);
    if (seen.has(node.id)) throw new CanvasRowsWriteError("duplicate_node_id", node.id);
    seen.add(node.id);
    const position = asObject(node.position);
    return {
      id: node.id,
      type: node.type,
      position: position ? { x: position.x, y: position.y } : null,
      data,
    };
  });
}

function parseEdges(raw: unknown): CanvasEdgeInput[] {
  if (!Array.isArray(raw)) throw new CanvasRowsWriteError("invalid_edge", "连线不是数组");
  const seenIds = new Set<string>();
  const seenPairs = new Set<string>();
  return raw.map((item, index) => {
    const edge = asObject(item);
    if (!edge) throw new CanvasRowsWriteError("invalid_edge", `edges[${index}] 不是对象`);
    if (typeof edge.id !== "string" || edge.id.length === 0) {
      throw new CanvasRowsWriteError("invalid_edge", `edges[${index}] 缺少 id`);
    }
    if (typeof edge.source !== "string" || typeof edge.target !== "string") {
      throw new CanvasRowsWriteError("invalid_edge", `edges[${index}] 缺少端点`);
    }
    const id = edge.id;
    const source = edge.source;
    const target = edge.target;
    const data = edge.data == null ? {} : asObject(edge.data);
    if (!data) throw new CanvasRowsWriteError("invalid_edge", `edges[${index}] 的 data 不是对象`);
    if (seenIds.has(id)) throw new CanvasRowsWriteError("duplicate_edge_id", id);
    seenIds.add(id);
    const pair = `${source}\0${target}`;
    if (seenPairs.has(pair)) throw new CanvasRowsWriteError("duplicate_edge_pair", id);
    seenPairs.add(pair);
    return { ...edge, id, source, target, data };
  });
}

export async function replaceCanvasRows(
  tx: Prisma.TransactionClient,
  projectId: bigint,
  rawNodes: unknown,
  rawEdges: unknown,
): Promise<void> {
  const nodes = parseNodes(rawNodes);
  const edges = parseEdges(rawEdges);
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      throw new CanvasRowsWriteError("missing_endpoint", edge.id);
    }
  }

  const existingNodes = await tx.project_nodes.findMany({
    where: { project_id: projectId },
    select: { node_id: true, is_delete: true, version: true },
  });
  const existingNodeById = new Map(existingNodes.map((row) => [row.node_id, row]));
  for (const node of nodes) {
    const row = nodeRowFromInput(node);
    const existing = existingNodeById.get(row.node_id);
    const data = {
      type: row.type,
      name: row.name,
      source: row.source,
      pos_x: row.pos_x,
      pos_y: row.pos_y,
      data_json: row.data_json as Prisma.InputJsonValue,
      is_delete: 0,
      version: existing ? existing.version + 1 : 0,
    };
    if (existing) {
      await tx.project_nodes.update({
        where: { project_id_node_id: { project_id: projectId, node_id: row.node_id } },
        data,
      });
    } else {
      await tx.project_nodes.create({
        data: { project_id: projectId, node_id: row.node_id, ...data },
      });
    }
  }
  for (const row of existingNodes) {
    if (row.is_delete !== 0 || nodeIds.has(row.node_id)) continue;
    await tx.project_nodes.update({
      where: { project_id_node_id: { project_id: projectId, node_id: row.node_id } },
      data: { is_delete: 1, version: row.version + 1 },
    });
  }

  const existingEdges = await tx.project_edges.findMany({
    where: { project_id: projectId },
    select: { edge_id: true, is_delete: true },
  });
  const existingEdgeById = new Map(existingEdges.map((row) => [row.edge_id, row]));
  const edgeIds = new Set(edges.map((edge) => edge.id));
  for (const edge of edges) {
    const row = edgeRowFromInput(edge);
    const existing = existingEdgeById.get(row.edge_id);
    const data = {
      source_node_id: row.source_node_id,
      target_node_id: row.target_node_id,
      ref_role: row.ref_role,
      data_json: row.data_json as Prisma.InputJsonValue,
      is_delete: 0,
    };
    try {
      if (existing) {
        await tx.project_edges.update({
          where: { project_id_edge_id: { project_id: projectId, edge_id: row.edge_id } },
          data: { ...data, version: { increment: 1 } },
        });
      } else {
        await tx.project_edges.create({
          data: { project_id: projectId, edge_id: row.edge_id, ...data },
        });
      }
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        throw new CanvasRowsWriteError("duplicate_edge_pair", row.edge_id);
      }
      throw error;
    }
  }
  for (const row of existingEdges) {
    if (row.is_delete !== 0 || edgeIds.has(row.edge_id)) continue;
    await tx.project_edges.update({
      where: { project_id_edge_id: { project_id: projectId, edge_id: row.edge_id } },
      data: { is_delete: 1, version: { increment: 1 } },
    });
  }
}
