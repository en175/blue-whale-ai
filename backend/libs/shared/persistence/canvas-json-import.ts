import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import {
  coordinate,
  edgeRowFromInput,
  nodeRowFromInput,
  stableJson,
  type CanvasEdgeRow,
  type CanvasNodeRow,
} from "../canvas/apply-diff.js";
import {
  isLegacyGenerationCard,
  planLegacyCardMigration,
  type CanvasNodeLike,
} from "../canvas/legacy-card-migration.js";
import { createCanvasRepo, edgeFromRow, nodeFromRow } from "./canvas-repo.js";
import type { LegacyCardHistoryDraft } from "./legacy-card-history-repo.js";

type Tx = Prisma.TransactionClient;

export type CanvasRowsImportReason = "rows_without_marker" | "parse_failure";

export class CanvasRowsImportError extends Error {
  constructor(
    readonly reason: CanvasRowsImportReason,
    readonly detail: string,
  ) {
    super(`${reason}: ${detail}`);
  }
}

export interface CanvasRowsImportReport {
  already_authoritative: boolean;
  imported_nodes: number;
  imported_edges: number;
  duplicate_node_ids: string[];
  duplicate_edge_ids: string[];
  duplicate_edge_pairs: string[];
  migrated_cards: string[];
  failed_cards: Array<{ nodeId: string; title: string; reason: string }>;
}

export interface CanvasComparison {
  consistent: boolean;
  differences: string[];
}

export interface CanvasRowsImportOutcome {
  report: CanvasRowsImportReport;
  legacy: { nodes: unknown; edges: unknown };
  view: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
}

interface CanvasSourceRow {
  id: bigint;
  nodes_json: Prisma.JsonValue | null;
  edges_json: Prisma.JsonValue | null;
  rows_authoritative: number;
}

interface CanvasRowsPlan {
  report: CanvasRowsImportReport;
  nodeRows: CanvasNodeRow[];
  edgeRows: CanvasEdgeRow[];
  historyDrafts: LegacyCardHistoryDraft[];
}

function emptyReport(): CanvasRowsImportReport {
  return {
    already_authoritative: false,
    imported_nodes: 0,
    imported_edges: 0,
    duplicate_node_ids: [],
    duplicate_edge_ids: [],
    duplicate_edge_pairs: [],
    migrated_cards: [],
    failed_cards: [],
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseLegacyNodes(raw: Prisma.JsonValue | null): {
  nodes: CanvasNodeLike[];
  duplicateIds: string[];
} {
  if (raw === null) return { nodes: [], duplicateIds: [] };
  if (!Array.isArray(raw)) throw new CanvasRowsImportError("parse_failure", "nodes_json 不是数组");
  const seen = new Set<string>();
  const nodes: CanvasNodeLike[] = [];
  const duplicateIds: string[] = [];
  for (const [index, item] of raw.entries()) {
    const node = asObject(item);
    if (!node) throw new CanvasRowsImportError("parse_failure", `nodes_json[${index}] 不是对象`);
    if (typeof node.id !== "string" || node.id.length === 0) {
      throw new CanvasRowsImportError("parse_failure", `nodes_json[${index}] 缺少 id`);
    }
    if (typeof node.type !== "string" || node.type.length === 0) {
      throw new CanvasRowsImportError("parse_failure", `nodes_json[${index}] 缺少 type`);
    }
    if (node.id.length > 128 || node.type.length > 32) {
      throw new CanvasRowsImportError("parse_failure", `nodes_json[${index}] 的 id 或 type 超长`);
    }
    const extraKeys = Object.keys(node).filter((key) => !["id", "type", "position", "data"].includes(key));
    if (extraKeys.length > 0) {
      throw new CanvasRowsImportError(
        "parse_failure",
        `nodes_json[${index}] 含无法落行的顶层字段：${extraKeys.join(",")}`,
      );
    }
    const data = node.data == null ? {} : asObject(node.data);
    if (!data) throw new CanvasRowsImportError("parse_failure", `nodes_json[${index}] 的 data 不是对象`);
    if (seen.has(node.id)) {
      duplicateIds.push(node.id);
      continue;
    }
    seen.add(node.id);
    nodes.push({ id: node.id, type: node.type, position: node.position ?? null, data });
  }
  return { nodes, duplicateIds };
}

function parseLegacyEdges(raw: Prisma.JsonValue | null): {
  edges: Array<{ id: string; source: string; target: string; data: Record<string, unknown> }>;
  duplicateIds: string[];
  duplicatePairs: string[];
} {
  if (raw === null) return { edges: [], duplicateIds: [], duplicatePairs: [] };
  if (!Array.isArray(raw)) throw new CanvasRowsImportError("parse_failure", "edges_json 不是数组");
  const seenIds = new Set<string>();
  const seenPairs = new Set<string>();
  const edges: Array<{ id: string; source: string; target: string; data: Record<string, unknown> }> = [];
  const duplicateIds: string[] = [];
  const duplicatePairs: string[] = [];
  for (const [index, item] of raw.entries()) {
    const edge = asObject(item);
    if (!edge) throw new CanvasRowsImportError("parse_failure", `edges_json[${index}] 不是对象`);
    if (typeof edge.id !== "string" || edge.id.length === 0) {
      throw new CanvasRowsImportError("parse_failure", `edges_json[${index}] 缺少 id`);
    }
    if (typeof edge.source !== "string" || typeof edge.target !== "string") {
      throw new CanvasRowsImportError("parse_failure", `edges_json[${index}] 缺少端点`);
    }
    if (edge.id.length > 128 || edge.source.length > 128 || edge.target.length > 128) {
      throw new CanvasRowsImportError("parse_failure", `edges_json[${index}] 的 id 或端点超长`);
    }
    const data = edge.data == null ? {} : asObject(edge.data);
    if (!data) throw new CanvasRowsImportError("parse_failure", `edges_json[${index}] 的 data 不是对象`);
    if (seenIds.has(edge.id)) {
      duplicateIds.push(edge.id);
      continue;
    }
    const pair = `${edge.source}\0${edge.target}`;
    if (seenPairs.has(pair)) {
      duplicatePairs.push(edge.id);
      continue;
    }
    seenIds.add(edge.id);
    seenPairs.add(pair);
    edges.push({ id: edge.id, source: edge.source, target: edge.target, data });
  }
  return { edges, duplicateIds, duplicatePairs };
}

async function buildCanvasRowsPlan(
  tx: Tx,
  projectId: bigint,
  canvas: CanvasSourceRow,
): Promise<CanvasRowsPlan> {
  const report = emptyReport();
  if (canvas.rows_authoritative === 1) {
    report.already_authoritative = true;
    return { report, nodeRows: [], edgeRows: [], historyDrafts: [] };
  }
  const [nodeCount, edgeCount] = await Promise.all([
    tx.project_nodes.count({ where: { project_id: projectId } }),
    tx.project_edges.count({ where: { project_id: projectId } }),
  ]);
  if (nodeCount > 0 || edgeCount > 0) {
    throw new CanvasRowsImportError(
      "rows_without_marker",
      `project=${projectId} 已有节点行 ${nodeCount}、连线行 ${edgeCount}，但 rows_authoritative 未开启`,
    );
  }

  const parsedNodes = parseLegacyNodes(canvas.nodes_json);
  const parsedEdges = parseLegacyEdges(canvas.edges_json);
  report.duplicate_node_ids = parsedNodes.duplicateIds;
  report.duplicate_edge_ids = parsedEdges.duplicateIds;
  report.duplicate_edge_pairs = parsedEdges.duplicatePairs;

  let nodes = parsedNodes.nodes;
  let historyDrafts: LegacyCardHistoryDraft[] = [];
  if (nodes.some(isLegacyGenerationCard)) {
    const history = await tx.project_card_migration_history.findMany({
      where: { project_id: projectId },
      orderBy: { id: "asc" },
    });
    const plan = planLegacyCardMigration(nodes, history);
    if (plan) {
      nodes = plan.nodes;
      historyDrafts = plan.historyDrafts;
      report.migrated_cards = plan.migrated;
      report.failed_cards = plan.failed;
    }
  }

  const nodeRows = nodes.map((node) =>
    nodeRowFromInput({
      id: node.id,
      type: node.type,
      position: node.position as { x?: unknown; y?: unknown } | null,
      data: node.data ?? {},
    }),
  );
  const edgeRows = parsedEdges.edges.map((edge) => edgeRowFromInput(edge));
  report.imported_nodes = nodeRows.length;
  report.imported_edges = edgeRows.length;
  return { report, nodeRows, edgeRows, historyDrafts };
}

export async function importCanvasJsonToRows(
  tx: Tx,
  projectId: bigint,
  canvas: CanvasSourceRow,
): Promise<CanvasRowsImportReport> {
  const plan = await buildCanvasRowsPlan(tx, projectId, canvas);
  if (plan.report.already_authoritative) return plan.report;

  if (plan.historyDrafts.length > 0) {
    await tx.project_card_migration_history.createMany({
      data: plan.historyDrafts.map((row) => ({
        project_id: projectId,
        node_id: row.nodeId,
        title: row.title,
        prompt_text: row.promptText,
        visual_text: row.visualText,
        ...(row.source != null ? { source_json: row.source as Prisma.InputJsonValue } : {}),
        card_json: (row.cardJson ?? {}) as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    });
  }
  if (plan.nodeRows.length > 0) {
    await tx.project_nodes.createMany({
      data: plan.nodeRows.map((row) => ({
        project_id: projectId,
        node_id: row.node_id,
        type: row.type,
        name: row.name,
        source: row.source,
        pos_x: row.pos_x,
        pos_y: row.pos_y,
        data_json: row.data_json as Prisma.InputJsonValue,
        version: 0,
        is_delete: 0,
      })),
    });
  }
  if (plan.edgeRows.length > 0) {
    await tx.project_edges.createMany({
      data: plan.edgeRows.map((row) => ({
        project_id: projectId,
        edge_id: row.edge_id,
        source_node_id: row.source_node_id,
        target_node_id: row.target_node_id,
        ref_role: row.ref_role,
        data_json: row.data_json as Prisma.InputJsonValue,
        version: 0,
        is_delete: 0,
      })),
    });
  }
  await tx.project_canvas.update({
    where: { id: canvas.id },
    data: { rows_authoritative: 1, version: { increment: 1 } },
  });
  return plan.report;
}

async function readLegacy(prisma: PrismaClient, projectId: bigint) {
  const canvas = await prisma.project_canvas.findUnique({
    where: { project_id: projectId },
    select: { nodes_json: true, edges_json: true },
  });
  return { nodes: canvas?.nodes_json ?? null, edges: canvas?.edges_json ?? null };
}

export async function inspectCanvasRowsImport(
  prisma: PrismaClient,
  projectId: bigint,
): Promise<CanvasRowsImportOutcome | null> {
  const planned = await prisma.$transaction(async (tx) => {
    const canvas = await tx.project_canvas.findUnique({ where: { project_id: projectId } });
    if (!canvas) return null;
    const plan = await buildCanvasRowsPlan(tx, projectId, canvas);
    return { plan, legacy: { nodes: canvas.nodes_json, edges: canvas.edges_json } };
  });
  if (!planned) return null;
  return {
    report: planned.plan.report,
    legacy: planned.legacy,
    view: {
      nodes: planned.plan.nodeRows.map((row) => nodeFromRow(row)),
      edges: planned.plan.edgeRows.map((row) => edgeFromRow(row)),
    },
  };
}

export async function ensureCanvasRowsImported(
  prisma: PrismaClient,
  projectId: bigint,
): Promise<CanvasRowsImportOutcome | null> {
  const report = await prisma.$transaction(async (tx) => {
    const projects = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM project WHERE id = ${projectId} FOR UPDATE
    `;
    if (projects.length === 0) return null;
    await tx.$queryRaw`SELECT id FROM project_canvas WHERE project_id = ${projectId} FOR UPDATE`;
    const canvas = await tx.project_canvas.findUnique({ where: { project_id: projectId } });
    if (!canvas) return null;
    return importCanvasJsonToRows(tx, projectId, canvas);
  }, { maxWait: 10_000, timeout: 30_000 });
  if (!report) return null;
  const view = await createCanvasRepo(prisma).getByProject(projectId.toString());
  return {
    report,
    legacy: await readLegacy(prisma, projectId),
    view: {
      nodes: JSON.parse(view.nodes ?? "[]") as Array<Record<string, unknown>>,
      edges: JSON.parse(view.edges ?? "[]") as Array<Record<string, unknown>>,
    },
  };
}

function normalizePosition(position: unknown): { x: number; y: number } {
  const record = asObject(position);
  return { x: coordinate(record?.x) ?? 0, y: coordinate(record?.y) ?? 0 };
}

function normalizeNode(node: Record<string, unknown>, skipMigrationFields: boolean): Record<string, unknown> {
  return {
    ...(skipMigrationFields ? {} : { type: node.type }),
    position: normalizePosition(node.position),
    ...(skipMigrationFields ? {} : { data: stableJson(asObject(node.data) ?? {}) }),
  };
}

function normalizeEdge(edge: Record<string, unknown>): Record<string, unknown> {
  return {
    source: edge.source,
    target: edge.target,
    data: stableJson(asObject(edge.data) ?? {}),
  };
}

function firstById(list: unknown, field: "id"): Map<string, Record<string, unknown>> {
  const byId = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(list)) return byId;
  for (const item of list) {
    const record = asObject(item);
    const id = typeof record?.[field] === "string" ? (record[field] as string) : null;
    if (record && id && !byId.has(id)) byId.set(id, record);
  }
  return byId;
}

export function compareCanvasJson(
  legacyNodesJson: unknown,
  legacyEdgesJson: unknown,
  viewNodes: Array<Record<string, unknown>>,
  viewEdges: Array<Record<string, unknown>>,
  skipDataNodeIds: ReadonlySet<string> = new Set(),
): CanvasComparison {
  const differences: string[] = [];
  const legacyNodes = firstById(legacyNodesJson, "id");
  const viewNodeById = firstById(viewNodes, "id");
  for (const [id, node] of legacyNodes) {
    const view = viewNodeById.get(id);
    if (!view) {
      differences.push(`node:${id}:missing`);
      continue;
    }
    const skipData = skipDataNodeIds.has(id);
    const expected = normalizeNode(node, skipData);
    const actual = normalizeNode(view, skipData);
    for (const key of Object.keys(expected)) {
      if (stableJson(expected[key]) !== stableJson(actual[key])) differences.push(`node:${id}:${key}`);
    }
  }
  for (const id of viewNodeById.keys()) {
    if (!legacyNodes.has(id)) differences.push(`node:${id}:extra`);
  }

  const legacyEdges = firstById(legacyEdgesJson, "id");
  const viewEdgeById = firstById(viewEdges, "id");
  for (const [id, edge] of legacyEdges) {
    const view = viewEdgeById.get(id);
    if (!view) {
      differences.push(`edge:${id}:missing`);
      continue;
    }
    const expected = normalizeEdge(edge);
    const actual = normalizeEdge(view);
    for (const key of Object.keys(expected)) {
      if (stableJson(expected[key]) !== stableJson(actual[key])) differences.push(`edge:${id}:${key}`);
    }
  }
  for (const id of viewEdgeById.keys()) {
    if (!legacyEdges.has(id)) differences.push(`edge:${id}:extra`);
  }
  return { consistent: differences.length === 0, differences };
}
