import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import {
  edgeRowFromInput,
  edgeWriteOrNull,
  nodeRowFromInput,
  nodeWriteOrNull,
  type CanvasEdgeInput,
  type CanvasEdgeRow,
  type CanvasNodeInput,
  type CanvasNodeRow,
} from "../canvas/apply-diff.js";
import { linkPromptMaterials, markOutputSlotsPlaced } from "./canvas-repo.js";
import { setJobExtras } from "./generation-jobs-extra-repo.js";

export interface CanvasApplyMaterials {
  ownerId: string;
  items: Array<{ assetId: string; mediaType: "image" | "video" | "audio" }>;
}

export interface CanvasApplyInput {
  projectId: string;
  nodes: CanvasNodeInput[];
  deleteNodeIds: string[];
  edges: CanvasEdgeInput[];
  deleteEdgeIds: string[];
  viewport?: unknown;
  actorId: string;
  materials?: CanvasApplyMaterials;
}

export interface CanvasApplyResult {
  version: number;
  upserted_node_ids: string[];
  skipped_node_ids: string[];
  deleted_node_ids: string[];
  upserted_edge_ids: string[];
  skipped_edge_ids: string[];
  deleted_edge_ids: string[];
  cascaded_edge_ids: string[];
}

export class CanvasApplyConflictError extends Error {
  constructor(readonly reason: "duplicate_edge_pair" | "duplicate_node_id" | "duplicate_edge_id") {
    super(reason);
  }
}

type Tx = Prisma.TransactionClient;

function audioMixJobId(node: { id: string; data?: Record<string, unknown> | null }): bigint | null {
  const match = /^audio-mix-([1-9][0-9]*)$/.exec(node.id);
  if (!match || String(node.data?.jobId) !== match[1]) return null;
  return BigInt(match[1]);
}

async function markAudioMixScoped(
  tx: Tx,
  projectId: bigint,
  ownerId: string,
  nodes: CanvasNodeInput[],
  deletedNodeIds: string[],
) {
  if (!/^[1-9][0-9]*$/.test(ownerId)) return;
  const present = nodes.map(audioMixJobId).filter((id): id is bigint => id !== null);
  const removed = deletedNodeIds.map((id) => audioMixJobId({ id })).filter((id): id is bigint => id !== null);
  const scope = { project_id: projectId, user_id: BigInt(ownerId), type: "audio_mix", is_delete: false };
  if (present.length > 0) {
    const jobs = await tx.generation_jobs.findMany({
      where: { ...scope, id: { in: present } },
      select: { id: true },
    });
    for (const job of jobs) {
      await setJobExtras(tx, job.id, { canvas_card_state: "present" });
    }
  }
  if (removed.length > 0) {
    const jobs = await tx.generation_jobs.findMany({
      where: { ...scope, id: { in: removed } },
      select: { id: true },
    });
    for (const job of jobs) {
      await setJobExtras(tx, job.id, { canvas_card_state: "removed" });
    }
  }
}

async function lockCanvas(tx: Tx, projectId: bigint) {
  const rows = await tx.$queryRaw<Array<{ id: bigint; version: number }>>`
    SELECT id, version FROM project_canvas WHERE project_id = ${projectId} FOR UPDATE
  `;
  if (rows.length > 0) return rows[0]!;
  return tx.project_canvas.create({
    data: { project_id: projectId, version: 0 },
    select: { id: true, version: true },
  });
}

function toNodeRow(row: {
  node_id: string;
  type: string;
  name: string | null;
  source: string;
  pos_x: number | null;
  pos_y: number | null;
  data_json: Prisma.JsonValue | null;
}): CanvasNodeRow {
  return {
    node_id: row.node_id,
    type: row.type,
    name: row.name,
    source: row.source,
    pos_x: row.pos_x,
    pos_y: row.pos_y,
    data_json: row.data_json,
  };
}

function toEdgeRow(row: {
  edge_id: string;
  source_node_id: string;
  target_node_id: string;
  ref_role: string | null;
  data_json: Prisma.JsonValue | null;
}): CanvasEdgeRow {
  return {
    edge_id: row.edge_id,
    source_node_id: row.source_node_id,
    target_node_id: row.target_node_id,
    ref_role: row.ref_role,
    data_json: row.data_json,
  };
}

async function appendRevision(
  tx: Tx,
  input: {
    projectId: bigint;
    nodeId: string;
    revision: number;
    op: "create" | "update" | "delete";
    actorId: string;
    changes: Prisma.InputJsonValue | null;
  },
) {
  await tx.project_node_revisions.create({
    data: {
      project_id: input.projectId,
      node_id: input.nodeId,
      revision: input.revision,
      op: input.op,
      actor: "user",
      actor_id: input.actorId,
      changes: input.changes as Prisma.InputJsonValue,
    },
  });
}

export async function applyCanvasChanges(
  prisma: PrismaClient,
  input: CanvasApplyInput,
): Promise<CanvasApplyResult> {
  const pid = BigInt(input.projectId);
  const nodeIds = input.nodes.map((node) => node.id);
  const deleteNodeIds = input.deleteNodeIds.filter((id) => !nodeIds.includes(id));
  if (new Set(nodeIds).size !== nodeIds.length) throw new CanvasApplyConflictError("duplicate_node_id");
  const edgeIds = input.edges.map((edge) => edge.id);
  if (new Set(edgeIds).size !== edgeIds.length) throw new CanvasApplyConflictError("duplicate_edge_id");

  return prisma.$transaction(async (tx) => {
    const canvas = await lockCanvas(tx, pid);

    const existingNodes = await tx.project_nodes.findMany({
      where: { project_id: pid, node_id: { in: [...nodeIds, ...deleteNodeIds] } },
      select: {
        node_id: true,
        type: true,
        name: true,
        source: true,
        pos_x: true,
        pos_y: true,
        data_json: true,
        is_delete: true,
        version: true,
      },
    });
    const nodeById = new Map(existingNodes.map((row) => [row.node_id, row]));

    const result: CanvasApplyResult = {
      version: canvas.version,
      upserted_node_ids: [],
      skipped_node_ids: [],
      deleted_node_ids: [],
      upserted_edge_ids: [],
      skipped_edge_ids: [],
      deleted_edge_ids: [],
      cascaded_edge_ids: [],
    };

    for (const node of input.nodes) {
      const existing = nodeById.get(node.id);
      if (existing && existing.is_delete === 0) {
        const write = nodeWriteOrNull(toNodeRow(existing), node);
        if (!write) {
          result.skipped_node_ids.push(node.id);
          continue;
        }
        const version = existing.version + 1;
        await tx.project_nodes.update({
          where: { project_id_node_id: { project_id: pid, node_id: node.id } },
          data: {
            type: write.row.type,
            name: write.row.name,
            source: write.row.source,
            pos_x: write.row.pos_x,
            pos_y: write.row.pos_y,
            data_json: write.row.data_json as Prisma.InputJsonValue,
            version,
            is_delete: 0,
          },
        });
        await appendRevision(tx, {
          projectId: pid,
          nodeId: node.id,
          revision: version,
          op: "update",
          actorId: input.actorId,
          changes: write.changes as Prisma.InputJsonValue,
        });
        result.upserted_node_ids.push(node.id);
        continue;
      }
      const next = nodeRowFromInput(node);
      if (existing) {
        const version = existing.version + 1;
        await tx.project_nodes.update({
          where: { project_id_node_id: { project_id: pid, node_id: node.id } },
          data: {
            type: next.type,
            name: next.name,
            source: next.source,
            pos_x: next.pos_x,
            pos_y: next.pos_y,
            data_json: next.data_json as Prisma.InputJsonValue,
            version,
            is_delete: 0,
          },
        });
        await appendRevision(tx, {
          projectId: pid,
          nodeId: node.id,
          revision: version,
          op: "create",
          actorId: input.actorId,
          changes: null,
        });
      } else {
        await tx.project_nodes.create({
          data: {
            project_id: pid,
            node_id: next.node_id,
            type: next.type,
            name: next.name,
            source: next.source,
            pos_x: next.pos_x,
            pos_y: next.pos_y,
            data_json: next.data_json as Prisma.InputJsonValue,
            version: 0,
            is_delete: 0,
          },
        });
        await appendRevision(tx, {
          projectId: pid,
          nodeId: node.id,
          revision: 0,
          op: "create",
          actorId: input.actorId,
          changes: null,
        });
      }
      result.upserted_node_ids.push(node.id);
    }

    for (const nodeId of deleteNodeIds) {
      const existing = nodeById.get(nodeId);
      if (!existing || existing.is_delete !== 0) continue;
      const version = existing.version + 1;
      await tx.project_nodes.update({
        where: { project_id_node_id: { project_id: pid, node_id: nodeId } },
        data: { is_delete: 1, version },
      });
      await appendRevision(tx, {
        projectId: pid,
        nodeId,
        revision: version,
        op: "delete",
        actorId: input.actorId,
        changes: { is_delete: { from: 0, to: 1 } } as Prisma.InputJsonValue,
      });
      result.deleted_node_ids.push(nodeId);
    }

    const removedNodeIds = new Set(result.deleted_node_ids);
    const cascadeCandidates = removedNodeIds.size === 0
      ? []
      : await tx.project_edges.findMany({
          where: {
            project_id: pid,
            is_delete: 0,
            OR: [
              { source_node_id: { in: [...removedNodeIds] } },
              { target_node_id: { in: [...removedNodeIds] } },
            ],
          },
          select: { edge_id: true },
        });
    for (const edge of cascadeCandidates) {
      await tx.project_edges.update({
        where: { project_id_edge_id: { project_id: pid, edge_id: edge.edge_id } },
        data: { is_delete: 1, version: { increment: 1 } },
      });
      result.cascaded_edge_ids.push(edge.edge_id);
    }
    const cascadeSet = new Set(result.cascaded_edge_ids);

    const existingEdges = await tx.project_edges.findMany({
      where: { project_id: pid, edge_id: { in: [...edgeIds, ...input.deleteEdgeIds] } },
      select: {
        edge_id: true,
        source_node_id: true,
        target_node_id: true,
        ref_role: true,
        data_json: true,
        is_delete: true,
      },
    });
    const edgeById = new Map(existingEdges.map((row) => [row.edge_id, row]));

    for (const edge of input.edges) {
      if (cascadeSet.has(edge.id)) throw new CanvasApplyConflictError("duplicate_edge_id");
      const existing = edgeById.get(edge.id);
      if (existing && existing.is_delete === 0) {
        const write = edgeWriteOrNull(toEdgeRow(existing), edge);
        if (!write) {
          result.skipped_edge_ids.push(edge.id);
          continue;
        }
        await tx.project_edges.update({
          where: { project_id_edge_id: { project_id: pid, edge_id: edge.id } },
          data: {
            source_node_id: write.row.source_node_id,
            target_node_id: write.row.target_node_id,
            ref_role: write.row.ref_role,
            data_json: write.row.data_json as Prisma.InputJsonValue,
            version: { increment: 1 },
          },
        });
        result.upserted_edge_ids.push(edge.id);
        continue;
      }
      const next = edgeRowFromInput(edge);
      try {
        if (existing) {
          await tx.project_edges.update({
            where: { project_id_edge_id: { project_id: pid, edge_id: edge.id } },
            data: {
              source_node_id: next.source_node_id,
              target_node_id: next.target_node_id,
              ref_role: next.ref_role,
              data_json: next.data_json as Prisma.InputJsonValue,
              is_delete: 0,
              version: { increment: 1 },
            },
          });
        } else {
          await tx.project_edges.create({
            data: {
              project_id: pid,
              edge_id: next.edge_id,
              source_node_id: next.source_node_id,
              target_node_id: next.target_node_id,
              ref_role: next.ref_role,
              data_json: next.data_json as Prisma.InputJsonValue,
            },
          });
        }
      } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
          throw new CanvasApplyConflictError("duplicate_edge_pair");
        }
        throw error;
      }
      result.upserted_edge_ids.push(edge.id);
    }

    for (const edgeId of input.deleteEdgeIds) {
      if (cascadeSet.has(edgeId)) continue;
      const existing = edgeById.get(edgeId);
      if (!existing || existing.is_delete !== 0) continue;
      await tx.project_edges.update({
        where: { project_id_edge_id: { project_id: pid, edge_id: edgeId } },
        data: { is_delete: 1, version: { increment: 1 } },
      });
      result.deleted_edge_ids.push(edgeId);
    }

    if (input.viewport !== undefined) {
      await tx.project_canvas.update({
        where: { id: canvas.id },
        data: {
          viewport_json: input.viewport === null ? Prisma.JsonNull : (input.viewport as Prisma.InputJsonValue),
          version: { increment: 1 },
        },
      });
    }

    if (input.materials && input.materials.items.length > 0) {
      await linkPromptMaterials(tx, pid, input.materials);
    }
    if (result.upserted_node_ids.length > 0) {
      await markOutputSlotsPlaced(tx, pid, input.nodes);
    }
    await markAudioMixScoped(tx, pid, input.actorId, input.nodes, result.deleted_node_ids);

    const row = await tx.project_canvas.findUniqueOrThrow({ where: { id: canvas.id } });
    result.version = row.version;
    return result;
  });
}
