/* ============================================
 * projects 接口：项目列表
 * ============================================ */
import { infiniteQueryOptions } from '@tanstack/react-query';
import { apiRequest, type ApiRequestInit } from './http';
import type { LegacyMigrationReport } from '../../../packages/contracts/src/legacy-card-migration';

/** GET /api/projects 返回项 */
export interface ProjectRecord {
  /** 项目唯一标识，用于跳转 ?project= 和重命名/删除操作（规范为 number，实测后端返回字符串，两者兼容） */
  id: number | string;
  /** 项目名称 */
  name: string;
  /** 封面缩略图 URL，null 表示无封面 */
  thumb: string | null;
  /** 项目内最新的图片预览，按创建时间倒序，最多三张 */
  previews: string[];
  /** 创建时间（ISO 字符串） */
  created_at: string;
}

/** 项目分页包络：与 GET /api/assets 保持一致。 */
export interface ProjectPageData {
  records: ProjectRecord[];
  total: number;
  size: number;
  current: number;
}

/** 项目卡片页首屏和续页统一取 30 条。 */
export const PROJECT_PAGE_SIZE = 30;

/** 项目分页缓存键。无参列表仍只供画布使用，不能与卡片页缓存混用。 */
export const projectKeys = {
  all: ['projects'] as const,
  pages: (size: number) => [...projectKeys.all, 'pages', size] as const,
};

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

/**
 * 项目卡片页的单页请求。
 *
 * page 与 size 必须同时传给后端；页面通过自身的加载/错误态承接失败，避免瞬态 toast。
 */
export function fetchProjectPage(page: number, size = PROJECT_PAGE_SIZE) {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  return apiRequest<ProjectPageData>(`/api/projects?${params.toString()}`, { silent: true });
}

/** 项目卡片页的 TanStack Query 无限分页配置。 */
export function projectPageQueryOptions(size = PROJECT_PAGE_SIZE) {
  return infiniteQueryOptions({
    queryKey: projectKeys.pages(size),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchProjectPage(pageParam, size),
    getNextPageParam: (lastPage, pages) => {
      const loadedProjectIds = new Set(
        pages.flatMap((page) => page.records.map((project) => String(project.id))),
      );

      return lastPage.records.length > 0 && loadedProjectIds.size < lastPage.total
        ? lastPage.current + 1
        : undefined;
    },
  });
}

/** 创建项目 POST /api/projects；空名称交由后端生成默认时间名称。 */
export function createProject(name: string, init?: ApiRequestInit) {
  return apiRequest<ProjectRecord>('/api/projects', {
    ...init,
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

/** 重命名项目 PUT /api/projects/:id（name 后端 trim；空串返回 400） */
export function renameProject(id: ProjectRecord['id'], name: string, init?: ApiRequestInit) {
  return apiRequest<ProjectRecord>(`/api/projects/${encodeURIComponent(String(id))}`, {
    ...init,
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

/** 删除项目 DELETE /api/projects/:id（成功 data 为 null，前端移除列表项） */
export function deleteProject(id: ProjectRecord['id'], init?: ApiRequestInit) {
  return apiRequest<null>(`/api/projects/${encodeURIComponent(String(id))}`, {
    ...init,
    method: 'DELETE',
  });
}

/** 批量删除项目 POST /api/projects/batch-delete；后端允许部分成功。 */
export interface BatchDeleteProjectsResult {
  succeeded: string[];
  failed: string[];
}

export function batchDeleteProjects(
  ids: ProjectRecord['id'][],
  init?: ApiRequestInit,
) {
  return apiRequest<BatchDeleteProjectsResult>('/api/projects/batch-delete', {
    ...init,
    method: 'POST',
    body: JSON.stringify({ ids: ids.map(String) }),
  });
}

/* ============ 项目快照（画布水合） ============ */

/** 快照内画布数据（nodes/viewport/edges 为 JSON 字符串） */
export interface SnapshotCanvas {
  /** 画布版本号（乐观锁） */
  version: number | null;
  /** 节点列表 JSON 字符串 */
  nodes: string | null;
  /** 视口 JSON 字符串 {x, y, zoom} */
  viewport: string | null;
  /** 连线列表 JSON 字符串（IKDLQF，旧数据缺省视为空数组） */
  edges?: string | null;
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
  /** 已关联虚拟人像库则为素材库 id，未关联为 null */
  material_id?: string | null;
  material_group_id?: string | null;
}

/** GET /api/projects/:id/snapshot 返回：项目信息 + 画布 + 资产字典 + 任务摘要 */
export interface ProjectSnapshot {
  project: { id: number | string; name: string; created_at: string };
  canvas: SnapshotCanvas | null;
  /** 资产字典，key 为 assetId */
  assets: Record<string, SnapshotAsset>;
  /** 关联生成任务摘要列表 */
  jobs: unknown[];
  /** 旧生成卡迁移报告（IKDLQK，仅本轮发生迁移或存在失败时携带） */
  legacy_migration?: LegacyMigrationReport;
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
