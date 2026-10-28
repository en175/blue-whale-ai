import { createHash } from "node:crypto";
import type { PromptPreviewSource, PromptPreviewContent, PromptMaterial } from "@lib/contracts";
import type { Prisma, PrismaClient } from "@prisma/client";

import { extraString, loadJobExtras, setJobExtras } from "./generation-jobs-extra-repo.js";


export interface CanvasView {
  id: string | null;
  project_id: string;
  version: number | null;
  viewport: string | null;
  nodes: string | null;
  edges: string | null;
}

export interface CanvasRepo {
  getPromptSnapshot(projectId: string, source: PromptPreviewSource): Promise<PromptPreviewContent | null>;
  rememberPromptSnapshot(projectId: string, source: PromptPreviewSource, content: PromptPreviewContent): Promise<PromptPreviewContent>;

  getByProject(projectId: string): Promise<CanvasView>;
  isRowsAuthoritative(projectId: string): Promise<boolean>;
  save(
    projectId: string,
    viewport: string | null,
    nodes: string | null,
  ): Promise<CanvasView>;
  saveIfVersion(
    projectId: string,
    expectedVersion: number | null,
    viewport: string | null,
    nodes: string | null,
    edges: string | null,
    materials?: { ownerId: string; items: PromptMaterial[] },
  ): Promise<CanvasView | null>;
}

export class PromptMaterialUnavailableError extends Error {
  constructor(readonly assetId: string) { super("Prompt material unavailable"); }
}

export async function linkPromptMaterials(tx: Prisma.TransactionClient, projectId: bigint, context?: { ownerId: string; items: PromptMaterial[] }) {
  if (!context) return;
  for (const material of [...context.items].sort((a, b) => a.assetId.localeCompare(b.assetId))) {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT id FROM user_assets WHERE id = ${BigInt(material.assetId)} AND user_id = ${BigInt(context.ownerId)} AND is_delete = false AND status = 'normal' AND type = ${material.mediaType} FOR UPDATE`;
    if (rows.length !== 1) throw new PromptMaterialUnavailableError(material.assetId);
    const key = { user_id: BigInt(context.ownerId), project_id: projectId, asset_id: BigInt(material.assetId) };
    await tx.project_asset.upsert({ where: { user_id_asset_id_project_id: key }, create: { ...key, is_delete: 0 }, update: { is_delete: 0 } });
  }
}

export function nodeFromRow(row: {
  node_id: string;
  type: string;
  pos_x: number | null;
  pos_y: number | null;
  data_json: unknown;
}): Record<string, unknown> {
  return {
    id: row.node_id,
    type: row.type,
    position: { x: row.pos_x ?? 0, y: row.pos_y ?? 0 },
    data: row.data_json ?? {},
  };
}

export function edgeFromRow(row: {
  edge_id: string;
  source_node_id: string;
  target_node_id: string;
  ref_role: string | null;
  data_json: unknown;
}): Record<string, unknown> {
  const data =
    row.data_json && typeof row.data_json === "object" && !Array.isArray(row.data_json)
      ? (row.data_json as Record<string, unknown>)
      : {};
  return {
    id: row.edge_id,
    source: row.source_node_id,
    target: row.target_node_id,
    ...(Object.keys(data).length > 0 || row.ref_role
      ? { data: { ...data, ...(row.ref_role ? { refRole: row.ref_role } : {}) } }
      : {}),
  };
}

function emptyView(projectId: string): CanvasView {
  return {
    id: null,
    project_id: projectId,
    version: null,
    viewport: null,
    nodes: null,
    edges: null,
  };
}

function toView(row: {
  id: bigint;
  project_id: bigint;
  version: number;
  viewport_json: unknown;
  nodes_json: unknown;
  edges_json: unknown;
}): CanvasView {
  return {
    id: row.id.toString(),
    project_id: row.project_id.toString(),
    version: row.version,
    viewport:
      row.viewport_json == null ? null : JSON.stringify(row.viewport_json),
    nodes: row.nodes_json == null ? null : JSON.stringify(row.nodes_json),
    edges: row.edges_json == null ? null : JSON.stringify(row.edges_json),
  };
}

function outputSlotIds(nodes: unknown): bigint[] {
  if (!Array.isArray(nodes)) return [];
  const ids = new Set<bigint>();
  for (const node of nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) continue;
    const id = (node as Record<string, unknown>).id;
    if (typeof id !== "string") continue;
    const match =
      /^(?:generation-output|storyboard-frame):([1-9][0-9]*)$/.exec(id);
    if (match?.[1]) ids.add(BigInt(match[1]));
  }
  return [...ids];
}

function audioMixCardIds(nodes: unknown): bigint[] {
  if (!Array.isArray(nodes)) return [];
  const ids = new Set<bigint>();
  for (const node of nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node) || node.type !== "mediaNode") continue;
    const match = typeof node.id === "string" ? /^audio-mix-([1-9][0-9]*)$/.exec(node.id) : null;
    if (!match || String(node.data?.jobId) !== match[1]) continue;
    ids.add(BigInt(match[1]));
  }
  return [...ids];
}

export async function markAudioMixCards(
  tx: Prisma.TransactionClient,
  projectId: bigint,
  nodes: unknown,
  ownerId?: string,
): Promise<void> {
  if (!ownerId || !/^[1-9][0-9]*$/.test(ownerId)) return;
  const ids = audioMixCardIds(nodes);
  const scope = { project_id: projectId, user_id: BigInt(ownerId), type: "audio_mix", is_delete: false };
  if (ids.length > 0) {
    const owned = await tx.generation_jobs.findMany({
      where: { ...scope, id: { in: ids } },
      select: { id: true },
    });
    for (const row of owned) {
      await setJobExtras(tx, row.id, { canvas_card_state: "present" });
    }
  }
  const candidates = await tx.generation_jobs.findMany({
    where: ids.length > 0 ? { ...scope, id: { notIn: ids } } : scope,
    select: { id: true },
  });
  if (candidates.length === 0) return;
  const extrasByJob = await loadJobExtras(
    tx,
    candidates.map((c) => c.id.toString()),
  );
  for (const candidate of candidates) {
    const state = extraString(extrasByJob.get(candidate.id.toString()), "canvas_card_state");
    if (state === "present") {
      await setJobExtras(tx, candidate.id, { canvas_card_state: "removed" });
    }
  }
}

export async function markOutputSlotsPlaced(
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
  const snapshotWhere = (projectId: string, source: PromptPreviewSource) => ({
    project_id: BigInt(projectId),
    source_key: createHash("sha256").update(JSON.stringify([source.sessionId, source.revisionId, source.shotNo])).digest("hex"),
  });
  return {
    async getPromptSnapshot(projectId, source) {
      const row = await prisma.project_prompt_preview_snapshots.findUnique({
        where: { project_id_source_key: snapshotWhere(projectId, source) },
        select: { title: true, text: true, content_json: true },
      });
      return row ? (row.content_json as unknown as PromptPreviewContent | null) ?? { title: row.title, text: row.text } : null;
    },
    async rememberPromptSnapshot(projectId, source, content) {
      const key = snapshotWhere(projectId, source);
      await prisma.project_prompt_preview_snapshots.createMany({
        data: [{ ...key, source_json: source, title: content.title, text: content.text, content_json: content as unknown as Prisma.InputJsonValue }], skipDuplicates: true,
      });
      const row = await prisma.project_prompt_preview_snapshots.findUniqueOrThrow({
        where: { project_id_source_key: key }, select: { title: true, text: true, content_json: true },
      });
      return (row.content_json as unknown as PromptPreviewContent | null) ?? { title: row.title, text: row.text };
    },
    async getByProject(projectId) {
      const pid = BigInt(projectId);
      const row = await prisma.project_canvas.findFirst({
        where: { project_id: pid },
      });
      if (!row) return emptyView(projectId);
      if (row.rows_authoritative !== 1) return toView(row);
      const [nodes, edges] = await Promise.all([
        prisma.project_nodes.findMany({
          where: { project_id: pid, is_delete: 0 },
          orderBy: { id: "asc" },
        }),
        prisma.project_edges.findMany({
          where: { project_id: pid, is_delete: 0 },
          orderBy: { id: "asc" },
        }),
      ]);
      return {
        id: row.id.toString(),
        project_id: projectId,
        version: row.version,
        viewport:
          row.viewport_json == null ? null : JSON.stringify(row.viewport_json),
        nodes: JSON.stringify(nodes.map(nodeFromRow)),
        edges: JSON.stringify(edges.map(edgeFromRow)),
      };
    },
    async isRowsAuthoritative(projectId) {
      const row = await prisma.project_canvas.findFirst({
        where: { project_id: BigInt(projectId) },
        select: { rows_authoritative: true },
      });
      return row?.rows_authoritative === 1;
    },
    async save(projectId, viewport, nodes) {
      const pid = BigInt(projectId);
      const data = {
        viewport_json: viewport ? JSON.parse(viewport) : null,
        nodes_json: nodes ? JSON.parse(nodes) : null,
      };
      return prisma.$transaction(async (tx) => {
        const row = await tx.project_canvas.upsert({
          where: { project_id: pid },
          create: { project_id: pid, ...data },
          update: { ...data, version: { increment: 1 } },
        });
        await markOutputSlotsPlaced(tx, pid, data.nodes_json);
        return toView(row);
      });
    },
    async saveIfVersion(projectId, expectedVersion, viewport, nodes, edges, materials) {
      const pid = BigInt(projectId);
      const data = {
        viewport_json: viewport ? JSON.parse(viewport) : null,
        nodes_json: nodes ? JSON.parse(nodes) : null,
        edges_json: edges ? JSON.parse(edges) : null,
      };
      if (expectedVersion === null) {
        try {
          return await prisma.$transaction(async (tx) => {
            const row = await tx.project_canvas.create({
              data: { project_id: pid, ...data },
            });
            await linkPromptMaterials(tx, pid, materials);
            await markOutputSlotsPlaced(tx, pid, data.nodes_json);
            await markAudioMixCards(tx, pid, data.nodes_json, materials?.ownerId);
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
        const result = await tx.project_canvas.updateMany({
          where: { project_id: pid, version: expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        if (result.count !== 1) return null;
        await linkPromptMaterials(tx, pid, materials);
        await markOutputSlotsPlaced(tx, pid, data.nodes_json);
        await markAudioMixCards(tx, pid, data.nodes_json, materials?.ownerId);
        const row = await tx.project_canvas.findFirst({ where: { project_id: pid } });
        return row ? toView(row) : null;
      });
    },
  };
}
