import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from './http';
import type { CanvasBinding, RecoveryChange } from '@lib/contracts/canvas-recovery';
import type { Edge, Node, Viewport } from '@xyflow/react';
import { serializeEdges, serializeNodes } from './canvas';

export type { CanvasBinding, RecoveryChange };

export const RECOVERY_PAGE_LIMIT_MAX = 100;

export interface GenerationRecoveryItem {
  recovery_item_id: string;
  output_key: string;
  node_id: string;
  state: 'pending' | 'present' | 'removed' | 'replaced' | 'transferred';
  revision: number;
  node_binding_revision: number;
  asset_id: string | null;
  slot_id: string | null;
}

export interface GenerationRecoveryRecord {
  submission_id: string;
  target_node_id: string;
  job_id: string;
  task_type: string;
  binding_revision: number;
  is_current: boolean;
  job: {
    job_id: string;
    type: string;
    status: string;
    progress: number;
    output_asset_ids: unknown;
    stored_error: unknown;
    created_at: string;
  } | null;
  recovery_seed: CanvasBinding['recovery_seed'] | null;
  previous_target_snapshot: Record<string, unknown> | null;
  items: GenerationRecoveryItem[];
}

export interface GenerationRecoveryPage {
  protocol_version: 1;
  canvas_version: number | null;
  records: GenerationRecoveryRecord[];
  next_cursor: string | null;
}

export function fetchGenerationRecoveryPage(
  projectId: string,
  options: { limit?: number; cursor?: string | null } = {},
): Promise<GenerationRecoveryPage> {
  const qs = new URLSearchParams();
  if (options.limit != null) qs.set('limit', String(options.limit));
  if (options.cursor) qs.set('cursor', options.cursor);
  const suffix = qs.toString();
  return apiRequest<GenerationRecoveryPage>(
    `/api/canvases/${encodeURIComponent(projectId)}/generation-recovery${suffix ? `?${suffix}` : ''}`,
    { silent: true },
  );
}

export const generationRecoveryKeys = {
  all: ['canvases', 'generation-recovery'] as const,
  page: (projectId: string, options: { cursor?: string | null; limit?: number } = {}) => [
    ...generationRecoveryKeys.all,
    projectId,
    { cursor: options.cursor ?? null, ...(options.limit != null ? { limit: options.limit } : {}) },
  ] as const,
};

export function generationRecoveryPageOptions(
  projectId: string,
  options: { limit?: number; cursor?: string | null } = {},
) {
  return queryOptions({
    queryKey: generationRecoveryKeys.page(projectId, options),
    queryFn: () => fetchGenerationRecoveryPage(projectId, options),
    staleTime: 0,
    retry: false,
  });
}

export function resolveGenerationRecovery(
  projectId: string,
  recoveryItemIds: string[],
): Promise<{ protocol_version: 1; records: GenerationRecoveryRecord[] }> {
  return apiRequest(
    `/api/canvases/${encodeURIComponent(projectId)}/generation-recovery/resolve`,
    { method: 'POST', silent: true, body: JSON.stringify({ recovery_item_ids: recoveryItemIds }) },
  );
}

export interface CanvasRecoverySaveFields {
  recoveryProtocolVersion: 1;
  commandId: string;
  recoveryChanges: RecoveryChange[];
}

export interface CanvasRecoverySaveData {
  project_id: string;
  version: number;
  recoveryReceipt: {
    commandId: string;
    replayed: boolean;
    changes: Array<{
      recoveryItemId: string;
      revision: number;
      nodeBindingRevision: number;
      state: 'pending' | 'present' | 'removed' | 'replaced' | 'transferred';
    }>;
  };
}

export function putCanvasDocWithRecovery(
  projectId: string,
  payload: { viewport: Viewport; nodes: Node[]; edges: Edge[]; confirmEmpty?: boolean },
  version: number | null,
  recovery: CanvasRecoverySaveFields,
): Promise<CanvasRecoverySaveData> {
  return apiRequest<CanvasRecoverySaveData>(`/api/canvases/${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    silent: true,
    headers: { 'If-Match': version === null ? '"missing"' : `"${version}"` },
    body: JSON.stringify({
      viewport: JSON.stringify(payload.viewport),
      nodes: serializeNodes(payload.nodes),
      edges: serializeEdges(payload.edges),
      ...(payload.confirmEmpty ? { confirmEmpty: true } : {}),
      recoveryProtocolVersion: recovery.recoveryProtocolVersion,
      commandId: recovery.commandId,
      recoveryChanges: recovery.recoveryChanges,
    }),
  });
}
