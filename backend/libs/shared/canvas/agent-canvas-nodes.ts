import type { PrismaClient } from "@prisma/client";

import { createCanvasRepo } from "@lib/shared/persistence/canvas-repo.js";

export const AGENT_CANVAS_PAGE_LIMIT_DEFAULT = 50;
export const AGENT_CANVAS_PAGE_LIMIT_MAX = 200;
export const AGENT_CANVAS_DETAIL_IDS_MAX = 200;

export interface AgentCanvasNodeFilters {
  name?: string;
  tags?: string[];
  type?: string;
  nodeId?: string;
  parentNodeId?: string;
}

export interface AgentCanvasNodeView {
  id: string;
  type: string;
  name: string | null;
  tags: string[];
  parent_node_id: string | null;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface AgentCanvasEdgeView {
  id: string;
  source: string;
  target: string;
  data?: Record<string, unknown>;
}

export interface AgentCanvasSearchResult {
  items: AgentCanvasNodeView[];
  next_cursor: string | null;
  total: number;
}

export interface AgentCanvasDetailsResult {
  nodes: AgentCanvasNodeView[];
  edges: AgentCanvasEdgeView[];
  missing: string[];
}

export type AgentCanvasRequestReason = "filter_required" | "invalid_request";

export class AgentCanvasRequestError extends Error {
  constructor(readonly reason: AgentCanvasRequestReason) {
    super(reason);
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nodeName(data: Record<string, unknown>): string | null {
  const candidate = data.title ?? data.name;
  return typeof candidate === "string" && candidate.length > 0 ? candidate.slice(0, 255) : null;
}

function nodeTags(data: Record<string, unknown>): string[] {
  return Array.isArray(data.tags)
    ? data.tags.filter((tag): tag is string => typeof tag === "string" && tag.length > 0)
    : [];
}

function parentNodeId(data: Record<string, unknown>): string | null {
  const candidate = data.parentNodeId ?? data.parent_node_id;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function toNodeView(node: Record<string, unknown>): AgentCanvasNodeView | null {
  if (typeof node.id !== "string" || node.id.length === 0) return null;
  const data = asObject(node.data);
  const position = asObject(node.position);
  return {
    id: node.id,
    type: typeof node.type === "string" ? node.type : "",
    name: nodeName(data),
    tags: nodeTags(data),
    parent_node_id: parentNodeId(data),
    position: {
      x: typeof position.x === "number" && Number.isFinite(position.x) ? position.x : 0,
      y: typeof position.y === "number" && Number.isFinite(position.y) ? position.y : 0,
    },
    data,
  };
}

function toEdgeView(edge: Record<string, unknown>): AgentCanvasEdgeView | null {
  if (typeof edge.id !== "string" || typeof edge.source !== "string" || typeof edge.target !== "string") {
    return null;
  }
  const data = asObject(edge.data);
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(Object.keys(data).length > 0 ? { data } : {}),
  };
}

async function readCanvas(prisma: PrismaClient, projectId: string) {
  const view = await createCanvasRepo(prisma).getByProject(projectId);
  const rawNodes = JSON.parse(view.nodes ?? "[]") as unknown;
  const rawEdges = JSON.parse(view.edges ?? "[]") as unknown;
  const nodes = (Array.isArray(rawNodes) ? rawNodes : [])
    .map((node) => (node !== null && typeof node === "object" && !Array.isArray(node) ? toNodeView(node as Record<string, unknown>) : null))
    .filter((node): node is AgentCanvasNodeView => node !== null);
  const edges = (Array.isArray(rawEdges) ? rawEdges : [])
    .map((edge) => (edge !== null && typeof edge === "object" && !Array.isArray(edge) ? toEdgeView(edge as Record<string, unknown>) : null))
    .filter((edge): edge is AgentCanvasEdgeView => edge !== null);
  return { nodes, edges };
}

export function hasAgentCanvasFilters(filters: AgentCanvasNodeFilters): boolean {
  return Boolean(
    filters.name?.length
    || filters.tags?.length
    || filters.type?.length
    || filters.nodeId?.length
    || filters.parentNodeId?.length,
  );
}

function matches(node: AgentCanvasNodeView, filters: AgentCanvasNodeFilters): boolean {
  if (filters.nodeId !== undefined && node.id !== filters.nodeId) return false;
  if (filters.type !== undefined && node.type !== filters.type) return false;
  if (filters.parentNodeId !== undefined && node.parent_node_id !== filters.parentNodeId) return false;
  if (filters.tags !== undefined && !filters.tags.every((tag) => node.tags.includes(tag))) return false;
  if (filters.name !== undefined) {
    const needle = filters.name.toLowerCase();
    if (!(node.name ?? "").toLowerCase().includes(needle)) return false;
  }
  return true;
}

export function parseAgentCanvasCursor(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 128) {
    throw new AgentCanvasRequestError("invalid_request");
  }
  return raw;
}

export function parseAgentCanvasLimit(raw: unknown): number {
  if (raw === undefined || raw === null) return AGENT_CANVAS_PAGE_LIMIT_DEFAULT;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > AGENT_CANVAS_PAGE_LIMIT_MAX) {
    throw new AgentCanvasRequestError("invalid_request");
  }
  return raw;
}

export async function searchAgentCanvasNodes(
  prisma: PrismaClient,
  projectId: string,
  filters: AgentCanvasNodeFilters,
  cursor: string | null,
  limit: number,
): Promise<AgentCanvasSearchResult> {
  if (!hasAgentCanvasFilters(filters)) throw new AgentCanvasRequestError("filter_required");
  const { nodes } = await readCanvas(prisma, projectId);
  const matched = nodes
    .filter((node) => matches(node, filters))
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const afterCursor = cursor === null ? matched : matched.filter((node) => node.id > cursor);
  const items = afterCursor.slice(0, limit);
  const next = afterCursor.length > items.length ? items[items.length - 1]!.id : null;
  return { items, next_cursor: next, total: matched.length };
}

export async function readAgentCanvasNodeDetails(
  prisma: PrismaClient,
  projectId: string,
  nodeIds: string[],
): Promise<AgentCanvasDetailsResult> {
  const { nodes, edges } = await readCanvas(prisma, projectId);
  const aliveIds = new Set(nodes.map((node) => node.id));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const found = nodeIds.filter((id) => byId.has(id));
  const missing = nodeIds.filter((id) => !byId.has(id));
  const foundIds = new Set(found);
  return {
    nodes: found.map((id) => byId.get(id)!),
    edges: edges.filter((edge) =>
      aliveIds.has(edge.source)
      && aliveIds.has(edge.target)
      && (foundIds.has(edge.source) || foundIds.has(edge.target))),
    missing,
  };
}
