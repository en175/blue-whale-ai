import type { PromptBinding } from '@lib/contracts/prompt-target';
import type { PromptPreviewSource } from '@lib/contracts/prompt-preview';
import type { LegacyCardHistoryItem, LegacyMigrationReport } from '@lib/contracts/legacy-card-migration';
import { apiRequest, isApiError } from '@/api/http';
import { queryOptions } from '@tanstack/react-query';
import type { Edge, Node, Viewport } from '@xyflow/react';

export type { LegacyCardHistoryItem, LegacyMigrationReport };

export function listLegacyCardHistory(projectId: string) {
  return apiRequest<{ items: LegacyCardHistoryItem[] }>(
    `/api/canvases/${encodeURIComponent(projectId)}/legacy-card-history`,
    { silent: true },
  );
}

export function legacyCardHistoryOptions(projectId: string) {
  return queryOptions({
    queryKey: ['canvas', projectId, 'legacy-history'],
    queryFn: () => listLegacyCardHistory(projectId),
    retry: false,
  });
}

export function applyPromptPreview(input: { projectId: string; source: PromptPreviewSource; position: { x: number; y: number } }) {
  return apiRequest<{ node: Node; canvas: CanvasRecord; reused: boolean }>(
    `/api/canvases/${encodeURIComponent(input.projectId)}/prompt-previews/apply`, {
      method: 'POST', silent: true,
      body: JSON.stringify({ source: input.source, position: input.position }),
    },
  );
}

export function referencePromptPlan(input: { projectId: string; planNodeId: string; targetNodeId: string; expectedVersion: number; syncBindings?: PromptBinding[] }) {
  const { projectId, ...body } = input;
  return apiRequest<CanvasRecord>(`/api/canvases/${encodeURIComponent(projectId)}/prompt-references`, {
    method: 'POST', silent: true, body: JSON.stringify(body),
  });
}

export interface ConversationQuote {
  quoteId: string;
  nodeId: string;
  title: string;
  text: string;
  source: PromptPreviewSource | null;
  quotedAt: string;
}

export function createConversationQuote(input: {
  projectId: string;
  nodeId: string;
  title: string;
  text: string;
  source?: PromptPreviewSource | null;
}) {
  return apiRequest<{ quote: ConversationQuote; reused: boolean }>(
    `/api/canvases/${encodeURIComponent(input.projectId)}/conversation-quotes`, {
      method: 'POST', silent: true,
      body: JSON.stringify({ nodeId: input.nodeId, title: input.title, text: input.text, source: input.source ?? null }),
    },
  );
}

export function listConversationQuotes(projectId: string, ids: string[]) {
  return apiRequest<{ items: ConversationQuote[] }>(
    `/api/canvases/${encodeURIComponent(projectId)}/conversation-quotes?ids=${ids.map(encodeURIComponent).join(',')}`,
    { silent: true },
  );
}

export interface CanvasRecord {
  id: number | null;
  project_id: number;
  version: number | null;
  viewport: string | null;
  nodes: string | null;
  edges?: string | null;
  legacy_migration?: LegacyMigrationReport;
}

export interface CanvasDoc {
  id: number | null;
  version: number | null;
  viewport: Viewport;
  nodes: Node[];
  edges: Edge[];
  legacyMigration?: LegacyMigrationReport;
}

const pendingMap = new Map<string, Promise<CanvasDoc>>();

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function fetchCanvasDoc(projectId: string): Promise<CanvasDoc> {
  const existed = pendingMap.get(projectId);
  if (existed) return existed;
  const p = apiRequest<CanvasRecord | null>(
    `/api/canvases?projectId=${encodeURIComponent(projectId)}`,
    { silent: true },
  )
    .then((rec): CanvasDoc => {
      const nodes = safeParse<Node[]>(rec?.nodes ?? null, []).map((n) => ({
        ...n,
        position: n.position ?? { x: 0, y: 0 },
        data: n.data ?? {},
      }));
      return {
        id: rec?.id ?? null,
        version: rec?.version ?? null,
        viewport: safeParse<Viewport>(rec?.viewport ?? null, { x: 0, y: 0, zoom: 1.1 }),
        nodes,
        edges: safeParse<Edge[]>(rec?.edges ?? null, []),
        ...(rec?.legacy_migration ? { legacyMigration: rec.legacy_migration } : {}),
      };
    })
    .finally(() => {
      pendingMap.delete(projectId);
    });
  pendingMap.set(projectId, p);
  return p;
}

export interface CanvasSaveData {
  id: number;
  project_id: number;
  version: number;
  viewport: string;
  nodes: string;
  edges?: string;
}

export function serializeNodes(nodes: Node[]): string {
  const clean = nodes.map((n) => {
    const data: Record<string, unknown> = {};
    Object.entries((n.data ?? {}) as Record<string, unknown>).forEach(([k, v]) => {
      if (typeof v === 'function') return;
      if (k === 'assetMissing') return;
      if (k === 'complianceBusy') return;
      if (k === 'projectId') return;
      if ((k === 'images' || k === 'initialRefs') && Array.isArray(v)) {
        data[k] = v.map((item) => {
          if (item == null || typeof item !== 'object') return item;
          const copy = { ...(item as Record<string, unknown>) };
          delete copy.missing;
          return copy;
        });
        return;
      }
      data[k] = v;
    });
    return { id: n.id, type: n.type, position: n.position, data };
  });
  return JSON.stringify(clean);
}

export function serializeEdges(edges: Edge[]): string {
  return JSON.stringify(
    edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...(e.data ? { data: e.data } : {}) })),
  );
}

const CANVAS_VERSION_CONFLICT_MSG = 'Canvas 版本冲突';
const CANVAS_SAVE_CONFLICT_RETRIES = 2;

export function readCanvasConflictVersion(error: unknown): number | null | undefined {
  if (!isApiError(error) || error.message !== CANVAS_VERSION_CONFLICT_MSG) return undefined;
  const version = (error.data as { version?: unknown } | null | undefined)?.version;
  if (version === null) return null;
  if (typeof version === 'number' && Number.isInteger(version) && version >= 0) return version;
  return undefined;
}

function putCanvasDoc(
  projectId: string,
  payload: { viewport: Viewport; nodes: Node[]; edges: Edge[]; confirmEmpty?: boolean },
  version: number | null,
): Promise<CanvasSaveData> {
  return apiRequest<CanvasSaveData>(`/api/canvases/${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    silent: true,
    headers: { 'If-Match': version === null ? '"missing"' : `"${version}"` },
    body: JSON.stringify({
      viewport: JSON.stringify(payload.viewport),
      nodes: serializeNodes(payload.nodes),
      edges: serializeEdges(payload.edges),
      ...(payload.confirmEmpty ? { confirmEmpty: true } : {}),
    }),
  });
}

export async function saveCanvasDoc(
  projectId: string,
  payload: { viewport: Viewport; nodes: Node[]; edges: Edge[]; confirmEmpty?: boolean },
  version: number | null,
): Promise<CanvasSaveData> {
  let expected = version;
  let lastError: unknown;
  for (let attempt = 0; attempt <= CANVAS_SAVE_CONFLICT_RETRIES; attempt += 1) {
    try {
      return await putCanvasDoc(projectId, payload, expected);
    } catch (error) {
      lastError = error;
      const recovered = readCanvasConflictVersion(error);
      if (recovered === undefined) throw error;
      if (payload.confirmEmpty) throw error;
      expected = recovered;
    }
  }
  throw lastError;
}
