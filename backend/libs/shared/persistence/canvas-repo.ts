import { createHash } from "node:crypto";
import type { PromptPreviewSource, PromptPreviewContent, PromptMaterial } from "@blue-whale/contracts";
import type { Prisma, PrismaClient } from "@prisma/client";

/** Canvas db port（Prisma-backed），复用部署的 canvas 表（project_id 唯一 / viewport_json / nodes_json / edges_json）。
 *  对齐 Java CanvasDto：{id, project_id, viewport, nodes}——viewport/nodes 是 JSON 字符串（前端 JSON.parse）。
 *  edges（IKDLQF）同构：JSON 字符串，缺省 null 由调用侧视为空数组。
 *  repo 负责 Json 列 ↔ 字符串转换。 */

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
  save(
    projectId: string,
    viewport: string | null,
    nodes: string | null,
  ): Promise<CanvasView>;
  /** 仅当 Canvas 仍是调用方读取的版本时保存；冲突返回 null，由调用方重读并重算。
   *  edges 与 nodes 同一次条件写入（IKDLQF）；调用方须显式传入（保留旧值或新值）。 */
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

async function linkPromptMaterials(tx: Prisma.TransactionClient, projectId: bigint, context?: { ownerId: string; items: PromptMaterial[] }) {
  if (!context) return;
  for (const material of [...context.items].sort((a, b) => a.assetId.localeCompare(b.assetId))) {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT id FROM assets WHERE id = ${BigInt(material.assetId)} AND user_id = ${BigInt(context.ownerId)} AND is_delete = false AND status = 'normal' AND type = ${material.mediaType} FOR UPDATE`;
    if (rows.length !== 1) throw new PromptMaterialUnavailableError(material.assetId);
    const key = { user_id: BigInt(context.ownerId), project_id: projectId, asset_id: BigInt(material.assetId) };
    await tx.project_asset.upsert({ where: { user_id_asset_id_project_id: key }, create: { ...key, is_delete: 0 }, update: { is_delete: 0 } });
  }
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
    // 普通生成输出与分镜画格都映射回 output_slot，复用 initial_placement_status 标 placed。
    const match =
      /^(?:generation-output|storyboard-frame):([1-9][0-9]*)$/.exec(id);
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
  const snapshotWhere = (projectId: string, source: PromptPreviewSource) => ({
    project_id: BigInt(projectId),
    source_key: createHash("sha256").update(JSON.stringify([source.sessionId, source.revisionId, source.shotNo])).digest("hex"),
  });
  return {
    async getPromptSnapshot(projectId, source) {
      const row = await prisma.prompt_preview_snapshots.findUnique({
        where: { project_id_source_key: snapshotWhere(projectId, source) },
        select: { title: true, text: true, content_json: true },
      });
      return row ? (row.content_json as unknown as PromptPreviewContent | null) ?? { title: row.title, text: row.text } : null;
    },
    async rememberPromptSnapshot(projectId, source, content) {
      const key = snapshotWhere(projectId, source);
      await prisma.prompt_preview_snapshots.createMany({
        data: [{ ...key, source_json: source, title: content.title, text: content.text, content_json: content as unknown as Prisma.InputJsonValue }], skipDuplicates: true,
      });
      const row = await prisma.prompt_preview_snapshots.findUniqueOrThrow({
        where: { project_id_source_key: key }, select: { title: true, text: true, content_json: true },
      });
      return (row.content_json as unknown as PromptPreviewContent | null) ?? { title: row.title, text: row.text };
    },
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
            const row = await tx.canvas.create({
              data: { project_id: pid, ...data },
            });
            await linkPromptMaterials(tx, pid, materials);
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
        await linkPromptMaterials(tx, pid, materials);
        await markOutputSlotsPlaced(tx, pid, data.nodes_json);
        const row = await tx.canvas.findFirst({ where: { project_id: pid } });
        return row ? toView(row) : null;
      });
    },
  };
}
