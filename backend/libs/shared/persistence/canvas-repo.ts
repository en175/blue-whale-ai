import { createHash } from "node:crypto";
import type { PromptPreviewSource, PromptPreviewContent, PromptMaterial } from "@lib/contracts";
import type { Prisma, PrismaClient } from "@prisma/client";

import { extraString, loadJobExtras, setJobExtras } from "./generation-jobs-extra-repo.js";

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

/** IKJJQU：画布保存事务的既有素材关联副作用（项目素材行 upsert）。
 *  原为模块私有；新协议原子保存（generation-canvas-recovery-repo）与画布同一事务复用。 */
export async function linkPromptMaterials(tx: Prisma.TransactionClient, projectId: bigint, context?: { ownerId: string; items: PromptMaterial[] }) {
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

/** IKJJQU：画布保存事务的既有 audio_mix 卡状态副作用（导出原因同 linkPromptMaterials）。 */
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
    // IKJCOE：canvas_card_state 已搬进 generation_job_extras（原主表列已删）。
    // ⚠️ 必须先过归属过滤再写：卡号来自请求体里的画布节点（node.id 与 node.data.jobId
    // 都由客户端构造），直接按 id 写扩展位就成了跨用户写——旧实现是一条
    // `updateMany({ where: { ...scope, id: { in: ids } } })`，作用域在 SQL 的 where 里，
    // 下面这次 findMany 是它的等价物（作用域必须在写之前生效）。
    const owned = await tx.generation_jobs.findMany({
      where: { ...scope, id: { in: ids } },
      select: { id: true },
    });
    for (const row of owned) {
      await setJobExtras(tx, row.id, { canvas_card_state: "present" });
    }
  }
  // 本轮不在画布上的、此前被标 'present' 的任务要改回 'removed'。
  // 原先是主表列上的 where（`canvas_card_state = 'present'`）；搬进扩展位后改成
  // 「本项目的 audio_mix 任务 → 读各自的扩展位 → 内存筛」，两次查询变成三次，
  // 但单个项目的 audio_mix 任务量很小（画布上的卡片数级）。缺键 = 'pending'，
  // 不是 'present'，故从未上过卡的任务不会被这一轮扫到。
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

/** IKJJQU：画布保存事务的既有输出槽首次放置副作用（导出原因同 linkPromptMaterials）。 */
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
        const result = await tx.canvas.updateMany({
          where: { project_id: pid, version: expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        if (result.count !== 1) return null;
        await linkPromptMaterials(tx, pid, materials);
        await markOutputSlotsPlaced(tx, pid, data.nodes_json);
        await markAudioMixCards(tx, pid, data.nodes_json, materials?.ownerId);
        const row = await tx.canvas.findFirst({ where: { project_id: pid } });
        return row ? toView(row) : null;
      });
    },
  };
}
