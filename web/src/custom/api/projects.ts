import { infiniteQueryOptions } from '@tanstack/react-query';
import { apiRequest, type ApiRequestInit } from '@/shared/api/http';

export interface ProjectPreview {
  url: string;
  type: 'image' | 'video';
}

export interface ProjectPreview {
  url: string;
  type: 'image' | 'video';
}

export type ProjectSource = 'dialog' | 'canvas';

export interface ProjectRecord {
  id: number | string;
  name: string;
  previews: ProjectPreview[];
  created_at: string;
  last_opened_at: string | null;
  last_edited_at: string;
  pinned_at: string | null;
}

export interface ProjectPageData {
  records: ProjectRecord[];
  total: number;
  size: number;
  current: number;
}

export interface ProjectListQuery {
  page?: number;
  size?: number;
  limit?: number;
  keyword?: string;
  source?: ProjectSource;
}

export const PROJECT_PAGE_SIZE = 30;

export const projectKeys = {
  all: ['projects'] as const,
  pages: (size: number) => [...projectKeys.all, 'pages', size] as const,
  list: (query: ProjectListQuery) => [...projectKeys.all, 'list', query] as const,
};

let pending: Promise<ProjectRecord[]> | null = null;

export function fetchProjects() {
  if (!pending) {
    pending = apiRequest<ProjectRecord[]>('/api/projects').finally(() => {
      pending = null;
    });
  }
  return pending;
}

function projectQuery(params: ProjectListQuery) {
  const search = new URLSearchParams();
  if (params.page != null) search.set('page', String(params.page));
  if (params.size != null) search.set('size', String(params.size));
  if (params.limit != null) search.set('limit', String(params.limit));
  if (params.keyword) search.set('keyword', params.keyword);
  if (params.source) search.set('source', params.source);
  return search;
}

export function fetchProjectPage(page: number, size = PROJECT_PAGE_SIZE) {
  const params = projectQuery({ page, size });
  return apiRequest<ProjectPageData>(`/api/projects?${params.toString()}`, { silent: true });
}

export function fetchProjectListQuery(params: ProjectListQuery) {
  return apiRequest<ProjectPageData>(`/api/projects?${projectQuery(params).toString()}`, { silent: true });
}

export function fetchRecentProjects(limit = 3) {
  return apiRequest<ProjectRecord[]>(`/api/projects?${projectQuery({ limit }).toString()}`, { silent: true });
}

export function touchProjectLastOpened(id: ProjectRecord['id']): Promise<void> {
  return apiRequest<void>(`/api/projects/${encodeURIComponent(String(id))}/last-opened`, {
    method: 'PUT',
    silent: true,
  });
}

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

export function createProject(name: string, init?: ApiRequestInit, source?: ProjectSource) {
  return apiRequest<ProjectRecord>('/api/projects', {
    ...init,
    method: 'POST',
    body: JSON.stringify(source ? { name, source } : { name }),
  });
}

export function renameProject(id: ProjectRecord['id'], name: string, init?: ApiRequestInit) {
  return apiRequest<ProjectRecord>(`/api/projects/${encodeURIComponent(String(id))}`, {
    ...init,
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

export function pinProject(id: ProjectRecord['id'], pinned: boolean, init?: ApiRequestInit) {
  return apiRequest<ProjectRecord>(`/api/projects/${encodeURIComponent(String(id))}/pin`, {
    ...init,
    method: 'PUT',
    body: JSON.stringify({ pinned }),
  });
}

export function deleteProject(id: ProjectRecord['id'], init?: ApiRequestInit) {
  return apiRequest<null>(`/api/projects/${encodeURIComponent(String(id))}`, {
    ...init,
    method: 'DELETE',
  });
}

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


export interface SnapshotCanvas {
  version: number | null;
  nodes: string | null;
  viewport: string | null;
  edges?: string | null;
}

export interface SnapshotAsset {
  asset_id: number;
  type: 'image' | 'video' | 'audio';
  access_url: string;
  width: number | null;
  height: number | null;
  material_id?: string | null;
  material_status?: 'Active' | 'Processing' | 'Failed' | null;
  material_status_checked_at?: string | null;
}

export interface ProjectSnapshot {
  project: { id: number | string; name: string; created_at: string };
  canvas: SnapshotCanvas | null;
  assets: Record<string, SnapshotAsset>;
  jobs: unknown[];
}

const snapshotPending = new Map<string, Promise<ProjectSnapshot>>();

export function fetchProjectSnapshot(id: string): Promise<ProjectSnapshot> {
  const existed = snapshotPending.get(id);
  if (existed) return existed;
  const p = apiRequest<ProjectSnapshot>(`/api/projects/${id}/snapshot`, { silent: true }).finally(() => {
    snapshotPending.delete(id);
  });
  snapshotPending.set(id, p);
  return p;
}
