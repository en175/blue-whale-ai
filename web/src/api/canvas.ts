import type { PromptPreviewSource } from '../../../packages/contracts/src/prompt-preview';
/* ============================================
 * canvas 接口：画布加载 GET /api/canvases + 保存 PUT /api/canvases/:projectId
 * nodes/viewport 均为 JSON 字符串；保存支持 If-Match 乐观锁（412 版本冲突）
 * ============================================ */
import { apiRequest } from './http';
import type { Node, Viewport } from '@xyflow/react';

export function applyPromptPreview(input: { projectId: string; source: PromptPreviewSource; position: { x: number; y: number } }) {
  return apiRequest<{ node: Node; canvas: CanvasRecord; reused: boolean }>(
    `/api/canvases/${encodeURIComponent(input.projectId)}/prompt-previews/apply`, {
      method: 'POST', silent: true,
      body: JSON.stringify({ source: input.source, position: input.position }),
    },
  );
}

/** GET /api/canvases 返回（无记录时 id/version/viewport/nodes 均为 null） */
export interface CanvasRecord {
  /** 画布记录ID，无记录为 null */
  id: number | null;
  /** 关联项目ID */
  project_id: number;
  /** 乐观锁版本号，无记录为 null */
  version: number | null;
  /** 视口状态 JSON 字符串：{x, y, zoom} */
  viewport: string | null;
  /** 节点列表 JSON 字符串 */
  nodes: string | null;
}

/** 解析后的画布文档 */
export interface CanvasDoc {
  /** 画布记录ID（无记录为 null，保存时用于区分新建/更新） */
  id: number | null;
  /** 乐观锁版本号 */
  version: number | null;
  /** 视口（无记录默认原点 1 倍） */
  viewport: Viewport;
  /** 节点列表（无记录为空数组） */
  nodes: Node[];
}

/** 在途去重：StrictMode 双挂载只发一次请求；完成后释放 */
const pendingMap = new Map<string, Promise<CanvasDoc>>();

/** 安全解析 JSON，失败返回 fallback */
function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 加载画布数据：GET /api/canvases?projectId=（无记录返回空文档，不视为错误） */
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
      };
    })
    .finally(() => {
      pendingMap.delete(projectId);
    });
  pendingMap.set(projectId, p);
  return p;
}

/** PUT /api/canvases/:projectId 返回：保存后的新版本号 */
export interface CanvasSaveData {
  id: number;
  project_id: number;
  /** 保存后新版本号（下次保存 If-Match 携带） */
  version: number;
  viewport: string;
  nodes: string;
}

/** 序列化节点：剥离回调函数、内部测量字段与派生的素材缺失标记，仅保留 id/type/position/data */
export function serializeNodes(nodes: Node[]): string {
  const clean = nodes.map((n) => {
    const data: Record<string, unknown> = {};
    Object.entries((n.data ?? {}) as Record<string, unknown>).forEach(([k, v]) => {
      if (typeof v === 'function') return;
      // 派生标记不持久化：重新进画布时按 snapshot 资产字典重新计算
      if (k === 'assetMissing') return;
      // 运行期上下文不持久化：水合时由 CanvasPage 按当前项目重新注入
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

/**
 * 保存画布 PUT /api/canvases/:projectId
 * @param version 乐观锁版本号：null 时 If-Match: "missing"（首次保存）
 * @throws ApiError status=412 表示版本冲突，调用方需重新加载
 */
export function saveCanvasDoc(
  projectId: string,
  payload: { viewport: Viewport; nodes: Node[] },
  version: number | null,
): Promise<CanvasSaveData> {
  return apiRequest<CanvasSaveData>(`/api/canvases/${encodeURIComponent(projectId)}`, {
    method: 'PUT',
    silent: true,
    headers: { 'If-Match': version === null ? '"missing"' : `"${version}"` },
    body: JSON.stringify({
      viewport: JSON.stringify(payload.viewport),
      nodes: serializeNodes(payload.nodes),
    }),
  });
}
