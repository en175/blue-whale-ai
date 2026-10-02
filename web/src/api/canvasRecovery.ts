/* ============================================
 * 画布生成任务恢复契约 v1 客户端（IKIXK9-SPEC-20261002 B 节 / IKJJR1）：
 *  - GET  /api/canvases/:projectId/generation-recovery   恢复页（游标分页）
 *  - POST /api/canvases/:projectId/generation-recovery/resolve 定向读取
 *  - PUT  /api/canvases/:projectId                        保护性保存（recoveryChanges 显式状态）
 * 形状与 backend/libs/contracts/canvas-recovery.ts 同源；客户端只做类型引用与
 * 常量复制（RECOVERY 页限制），不做 zod 运行时校验——服务端是权威。
 * ============================================ */
import { apiRequest } from './http';
import type { CanvasBinding, RecoveryChange } from '@lib/contracts/canvas-recovery';
import type { Edge, Node, Viewport } from '@xyflow/react';
import { serializeEdges, serializeNodes } from './canvas';

export type { CanvasBinding, RecoveryChange };

/** 恢复页/resolve 限制（B.5，与契约常量同值）。 */
export const RECOVERY_PAGE_LIMIT_MAX = 100;

/** 恢复项（B.5 items 项；形状与服务端 RecoveryItemView 恒等）。 */
export interface GenerationRecoveryItem {
  /** 恢复项身份 gcr:<submission_id>:<output_key>（客户端视为不透明） */
  recovery_item_id: string;
  output_key: string;
  node_id: string;
  state: 'pending' | 'present' | 'removed' | 'replaced' | 'transferred';
  revision: number;
  node_binding_revision: number;
  asset_id: string | null;
  slot_id: string | null;
}

/** 恢复页单条记录（B.5 records 项）。job 为公开投影子集（无 asset url），需要完整
 *  产物时按 job_id 走 GET /api/jobs/:id。 */
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

/** GET generation-recovery 成功 data。 */
export interface GenerationRecoveryPage {
  protocol_version: 1;
  canvas_version: number | null;
  records: GenerationRecoveryRecord[];
  next_cursor: string | null;
}

/** GET /api/canvases/:projectId/generation-recovery（受控错误 4xx 经 apiRequest 抛 ApiError，
 *  data.reason 为稳定值）。 */
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

/** POST resolve：按已保存节点标记定向回读旧输出 revision（只读、可重复、不修改状态）。 */
export function resolveGenerationRecovery(
  projectId: string,
  recoveryItemIds: string[],
): Promise<{ protocol_version: 1; records: GenerationRecoveryRecord[] }> {
  return apiRequest(
    `/api/canvases/${encodeURIComponent(projectId)}/generation-recovery/resolve`,
    { method: 'POST', silent: true, body: JSON.stringify({ recovery_item_ids: recoveryItemIds }) },
  );
}

/** 新协议保存的显式恢复字段（B.6）：由调用方（生成任务运行时）推导，随整文档 PUT 携带。 */
export interface CanvasRecoverySaveFields {
  recoveryProtocolVersion: 1;
  commandId: string;
  recoveryChanges: RecoveryChange[];
}

/** 新协议保存成功 data：紧凑回执（不回放旧文档快照）。 */
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

/** PUT /api/canvases/:projectId（新协议显式恢复保存）。
 *  与旧 saveCanvasDoc 的差异（IKJJR1 验收 8）：
 *  - 携带 recoveryProtocolVersion/commandId/recoveryChanges，成功返回紧凑回执；
 *  - 412 版本冲突不做「换版本重发」自动重试——保留本地内容由调用方提示复核；
 *  - commandId 是本次保存命令身份：同命令同载荷重放由服务端幂等回放（replayed=true），
 *    因此调用方对同一逻辑命令的完全相同重发复用同一 commandId，其余情况换新。 */
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
