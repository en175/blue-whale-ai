import type { Prisma } from "@prisma/client";

export interface CanvasNodeInput {
  id: string;
  type: string;
  position?: { x?: unknown; y?: unknown } | null;
  data?: Record<string, unknown> | null;
}

export interface CanvasNodeRow {
  node_id: string;
  type: string;
  name: string | null;
  source: string;
  pos_x: number | null;
  pos_y: number | null;
  data_json: Prisma.JsonValue | null;
}

export interface CanvasEdgeInput {
  id: string;
  source: string;
  target: string;
  [key: string]: unknown;
}

export interface CanvasEdgeRow {
  edge_id: string;
  source_node_id: string;
  target_node_id: string;
  ref_role: string | null;
  data_json: Prisma.JsonValue | null;
}

export type FieldChange = { from: unknown; to: unknown };

export type NodeChanges = Record<string, FieldChange>;

export interface NodeWrite {
  row: CanvasNodeRow;
  changes: NodeChanges;
}

export interface EdgeWrite {
  row: Omit<CanvasEdgeRow, "edge_id"> & { edge_id: string };
  changes: NodeChanges;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.fromEntries(entries.map(([key, item]) => [key, sortValue(item)]));
  }
  return value;
}

export function coordinate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function nodeName(data: Record<string, unknown> | null | undefined): string | null {
  const title = data?.title;
  return typeof title === "string" && title.length > 0 ? title.slice(0, 255) : null;
}

export function nodeRowFromInput(input: CanvasNodeInput): CanvasNodeRow {
  return {
    node_id: input.id,
    type: input.type,
    name: nodeName(input.data),
    source: "user",
    pos_x: coordinate(input.position?.x),
    pos_y: coordinate(input.position?.y),
    data_json: (input.data ?? {}) as unknown as Prisma.JsonValue,
  };
}

function nodeChanges(row: CanvasNodeRow, next: CanvasNodeRow): NodeChanges {
  const changes: NodeChanges = {};
  for (const field of [
    "type",
    "name",
    "source",
    "pos_x",
    "pos_y",
  ] as const) {
    if (row[field] !== next[field]) {
      changes[field] = { from: row[field], to: next[field] };
    }
  }
  const previousData = stableJson(row.data_json ?? {});
  const nextData = stableJson(next.data_json ?? {});
  if (previousData !== nextData) {
    changes.data = { from: JSON.parse(previousData), to: JSON.parse(nextData) };
  }
  return changes;
}

export function nodeWriteOrNull(row: CanvasNodeRow, input: CanvasNodeInput): NodeWrite | null {
  const next = nodeRowFromInput(input);
  const changes = nodeChanges(row, next);
  return Object.keys(changes).length === 0 ? null : { row: next, changes };
}

export function edgeRowFromInput(
  input: CanvasEdgeInput,
): Omit<CanvasEdgeRow, "edge_id"> & { edge_id: string } {
  const data =
    input.data && typeof input.data === "object" && !Array.isArray(input.data)
      ? (input.data as Record<string, unknown>)
      : {};
  const role =
    typeof data.refRole === "string"
      ? data.refRole
      : typeof input.ref_role === "string"
        ? input.ref_role
        : null;
  return {
    edge_id: input.id,
    source_node_id: input.source,
    target_node_id: input.target,
    ref_role: role,
    data_json: data as unknown as Prisma.JsonValue,
  };
}

function edgeChanges(
  row: CanvasEdgeRow,
  next: Omit<CanvasEdgeRow, "edge_id"> & { edge_id: string },
): NodeChanges {
  const changes: NodeChanges = {};
  for (const field of ["source_node_id", "target_node_id", "ref_role"] as const) {
    if (row[field] !== next[field]) {
      changes[field] = { from: row[field], to: next[field] };
    }
  }
  const previousData = stableJson(row.data_json ?? {});
  const nextData = stableJson(next.data_json ?? {});
  if (previousData !== nextData) {
    changes.data = { from: JSON.parse(previousData), to: JSON.parse(nextData) };
  }
  return changes;
}

export function edgeWriteOrNull(
  row: CanvasEdgeRow,
  input: CanvasEdgeInput,
): EdgeWrite | null {
  const next = edgeRowFromInput(input);
  const changes = edgeChanges(row, next);
  return Object.keys(changes).length === 0 ? null : { row: next, changes };
}
