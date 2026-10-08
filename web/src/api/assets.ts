import { infiniteQueryOptions, queryOptions, skipToken, type QueryClient } from '@tanstack/react-query';
import { apiRequest, silentInit, type ApiRequestInit } from './http';

export type AssetType = 'image' | 'video' | 'audio' | 'character';

export interface AssetRecord {
  id: number | string;
  name?: string | null;
  type: AssetType;
  status?: string | null;
  url: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  size?: number | null;
  source: string | null;
  model: string | null;
  prompt?: string | null;
  created_at: string | null;
  material_id?: string | null;
  material_status?: 'Active' | 'Processing' | 'Failed' | null;
  video_stage?: 'video' | 'sample' | 'final';
  source_sample_job_id?: string | null;
  final_job_id?: string | null;
}

export interface AssetPageData {
  records: AssetRecord[];
  total: number;
  size: number;
  current: number;
}

export const ASSET_PAGE_SIZE = 60;

export const assetKeys = {
  all: ['assets'] as const,
  pages: (type: AssetType | '', size: number) =>
    [...assetKeys.all, 'pages', type || 'all', size] as const,
};

export function removeCachedAssetPages(queryClient: Pick<QueryClient, 'removeQueries'>) {
  queryClient.removeQueries({ queryKey: assetKeys.all });
}

export function fetchAssetPage(type: AssetType | '', page: number, size = ASSET_PAGE_SIZE) {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  if (type) params.set('type', type);
  return apiRequest<AssetPageData>(`/api/assets?${params.toString()}`, { silent: true });
}

export function assetPageQueryOptions(type: AssetType | '', size = ASSET_PAGE_SIZE) {
  return infiniteQueryOptions({
    queryKey: assetKeys.pages(type, size),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchAssetPage(type, pageParam, size),
    getNextPageParam: (lastPage, pages) => {
      const loadedAssetIds = new Set(
        pages.flatMap((page) => page.records.map((record) => String(record.id))),
      );

      return lastPage.records.length > 0 && loadedAssetIds.size < lastPage.total
        ? lastPage.current + 1
        : undefined;
    },
  });
}

export function deleteAsset(id: AssetRecord['id']) {
  return apiRequest<null>(`/api/assets/${id}`, { method: 'DELETE' });
}

export function fetchAssetDetail(id: AssetRecord['id'], init?: ApiRequestInit) {
  return apiRequest<AssetRecord>(`/api/assets/${encodeURIComponent(String(id))}`, init);
}

export const assetDetailKeys = {
  detail: (id: AssetRecord['id']) => [...assetKeys.all, 'detail', String(id)] as const,
};

export function assetDetailQueryOptions(id: AssetRecord['id'] | null) {
  return queryOptions({
    queryKey: assetDetailKeys.detail(id ?? ''),
    queryFn:
      id === null
        ? skipToken
        : ({ signal }) => fetchAssetDetail(id, { silent: true, signal }),
    enabled: id !== null,
  });
}

export interface AssetReferencesData {
  assetId: string;
  projectCount: number;
}

export function fetchAssetReferences(id: AssetRecord['id']) {
  return apiRequest<AssetReferencesData>(
    `/api/assets/${encodeURIComponent(String(id))}/references`,
    { silent: true },
  );
}

export function linkAssetToProject(projectId: string, assetId: AssetRecord['id'], init?: ApiRequestInit) {
  return apiRequest<{ projectId: string; assetId: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(String(assetId))}/link`,
    { ...init, method: 'POST' },
  );
}

export const UPLOAD_SIZE_LIMIT: Record<AssetType, number> = {
  image: 20 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  character: 20 * 1024 * 1024,
};

export interface PresignData {
  storage_key: string;
  upload_url: string;
  headers: Record<string, string>;
  expires_in: number;
}

export function fetchUploadPresign(
  params: { type: AssetType; mime: string; size: number },
  init?: { silent?: boolean },
) {
  return apiRequest<PresignData>('/api/agent/assets/uploads/presign', {
    method: 'POST',
    body: JSON.stringify(params),
    ...silentInit(init),
  });
}

export async function putToPresignedUrl(presign: PresignData, file: File) {
  if (!presign.upload_url) throw new Error('预签名上传地址为空');

  const uploadUrl = import.meta.env.DEV
    ? `/__tos-upload?url=${encodeURIComponent(presign.upload_url)}`
    : presign.upload_url;

  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: presign.headers,
    body: file,
  });
  if (!res.ok) throw new Error(`直传对象存储失败（${res.status}）`);
}

export interface UploadCompleteParams {
  type: AssetType;
  mime: string;
  size: number;
  name?: string;
  storage_key: string;
  project_id?: string;
  width?: number;
  height?: number;
  duration?: number;
  md5?: string;
  materialId?: string;
  source?: 'mask_erase';
}

export interface UploadCompleteData {
  asset_id: string;
  status: string;
  type: AssetType;
  url: string;
  width: number;
  height: number;
  duration: number | null;
  mime: string;
  size: number;
  material_id?: string | null;
  material_status?: 'Active' | 'Processing' | 'Failed' | null;
}

export function completeUpload(params: UploadCompleteParams, init?: { silent?: boolean }) {
  return apiRequest<UploadCompleteData>('/api/agent/assets/uploads/complete', {
    method: 'POST',
    body: JSON.stringify(params),
    ...silentInit(init),
  });
}

export interface DedupData {
  dedup: boolean;
  asset?: UploadCompleteData;
}

export function dedupUpload(params: {
  type: AssetType;
  mime: string;
  size: number;
  md5: string;
  project_id?: string;
  materialId?: string;
}) {
  return apiRequest<DedupData>('/api/agent/assets/uploads/dedup', {
    method: 'POST',
    body: JSON.stringify(params),
    silent: true,
  });
}

async function concurrentFetch<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function workerLoop() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        console.warn(`concurrentFetch 任务 ${i} 失败:`, err);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => workerLoop()),
  );
  return results;
}

const pendingAll = new Map<string, Promise<AssetRecord[]>>();

const ASSET_FETCH_CONCURRENCY = 6;

function uniqueAssetRecords(records: AssetRecord[]): AssetRecord[] {
  const seenIds = new Set<string>();
  return records.filter((record) => {
    const id = String(record.id);
    if (seenIds.has(id)) return false;
    seenIds.add(id);
    return true;
  });
}

export function fetchAllAssets(type: AssetType | '') {
  const key = type || 'all';
  let pending = pendingAll.get(key);
  if (!pending) {
    pending = (async () => {
      const first = await fetchAssetPage(type, 1);
      const pages = Math.max(1, Math.ceil(first.total / first.size));
      if (pages <= 1) return uniqueAssetRecords(first.records);
      const restPages = Array.from({ length: pages - 1 }, (_, i) => i + 2);
      const restResults = await concurrentFetch(
        restPages,
        (page) => fetchAssetPage(type, page),
        ASSET_FETCH_CONCURRENCY,
      );
      const restRecords = restResults.flatMap((r) => (r ? r.records : []));
      return uniqueAssetRecords([...first.records, ...restRecords]);
    })().finally(() => {
      pendingAll.delete(key);
    });
    pendingAll.set(key, pending);
  }
  return pending;
}
