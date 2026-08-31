/* ============================================
 * projects 接口：项目列表
 * ============================================ */
import { apiRequest } from './http';

/** GET /api/projects 返回项 */
export interface ProjectRecord {
  /** 项目唯一标识，用于跳转 ?project= 和重命名/删除操作（规范为 number，实测后端返回字符串，两者兼容） */
  id: number | string;
  /** 项目名称 */
  name: string;
  /** 封面缩略图 URL，null 表示无封面 */
  thumb: string | null;
  /** 创建时间（ISO 字符串） */
  created_at: string;
}

/** 在途去重：StrictMode 双挂载只发一次请求；完成后释放，再次进入页面拉最新 */
let pending: Promise<ProjectRecord[]> | null = null;

export function fetchProjects() {
  if (!pending) {
    pending = apiRequest<ProjectRecord[]>('/api/projects').finally(() => {
      pending = null;
    });
  }
  return pending;
}

/** 创建项目 POST /api/projects（name 后端 trim；空串返回 400 “项目名不能为空”） */
export function createProject(name: string) {
  return apiRequest<ProjectRecord>('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/** 重命名项目 PUT /api/projects/:id（name 后端 trim；空串返回 400） */
export function renameProject(id: ProjectRecord['id'], name: string) {
  return apiRequest<ProjectRecord>(`/api/projects/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

/** 删除项目 DELETE /api/projects/:id（成功 data 为 null，前端移除列表项） */
export function deleteProject(id: ProjectRecord['id']) {
  return apiRequest<null>(`/api/projects/${id}`, { method: 'DELETE' });
}

/* ============ 项目快照（画布水合） ============ */

/** 快照内画布数据（nodes/viewport 为 JSON 字符串） */
export interface SnapshotCanvas {
  /** 画布版本号（乐观锁） */
  version: number | null;
  /** 节点列表 JSON 字符串 */
  nodes: string | null;
  /** 视口 JSON 字符串 {x, y, zoom} */
  viewport: string | null;
}

/** 快照内资产字典项（key 为 assetId） */
export interface SnapshotAsset {
  asset_id: number;
  /** 资产类型：image/video/audio */
  type: 'image' | 'video' | 'audio';
  /** 访问 URL */
  access_url: string;
  width: number | null;
  height: number | null;
}

/** GET /api/projects/:id/snapshot 返回：项目信息 + 画布 + 资产字典 + 任务摘要 */
export interface ProjectSnapshot {
  project: { id: number | string; name: string; created_at: string };
  canvas: SnapshotCanvas | null;
  /** 资产字典，key 为 assetId */
  assets: Record<string, SnapshotAsset>;
  /** 关联生成任务摘要列表 */
  jobs: unknown[];
}

/** 在途去重：StrictMode 双挂载只发一次；完成后释放 */
const snapshotPending = new Map<string, Promise<ProjectSnapshot>>();

/** 获取项目快照 GET /api/projects/:id/snapshot（画布水合入口） */
export function fetchProjectSnapshot(id: string): Promise<ProjectSnapshot> {
  const existed = snapshotPending.get(id);
  if (existed) return existed;
  const p = apiRequest<ProjectSnapshot>(`/api/projects/${id}/snapshot`, { silent: true }).finally(() => {
    snapshotPending.delete(id);
  });
  snapshotPending.set(id, p);
  return p;
}

/* ============ 复制资产到项目 ============ */

/** 复制资产返回：新副本资产记录 */
export interface CopiedAsset {
  /** 新副本资产ID */
  id: number;
  type: 'image' | 'video' | 'audio';
  url: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  /** 来源：copied 表示复制而来 */
  source: string;
  created_at: string;
}

/** 复制资产到项目 POST /api/projects/:id/assets（资产库「添加到项目」） */
export function copyAssetToProject(
  projectId: string,
  sourceAssetId: number,
): Promise<CopiedAsset> {
  return apiRequest<CopiedAsset>(
    `/api/projects/${encodeURIComponent(projectId)}/assets`,
    {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ source_asset_id: sourceAssetId }),
    },
  );
}
