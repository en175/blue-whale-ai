/* ============================================
 * assets 接口：资产库列表（分页 + 筛选）
 * ============================================ */
import { apiRequest } from './http';

/** 资产类型 */
export type AssetType = 'image' | 'video' | 'audio';

/** GET /api/assets 返回项 */
export interface AssetRecord {
  /** 资产唯一标识，用于删除操作 */
  id: number | string;
  /** 资产类型，决定预览渲染方式 */
  type: AssetType;
  /** 资产访问 URL：image→<img>，video→<video>，audio→<audio> */
  url: string;
  /** 图片/视频宽度（像素），null 表示未知 */
  width: number | null;
  /** 图片/视频高度（像素），null 表示未知 */
  height: number | null;
  /** 视频/音频时长（秒），图片为 null */
  duration: number | null;
  /** 文件大小（字节）；旧响应可能暂未返回 */
  size?: number | null;
  /** 资产来源，uploaded 表示用户上传 */
  source: string | null;
  /** 生成资产使用的模型；上传资产为 null */
  model: string | null;
  /** 创建时间（ISO 8601） */
  created_at: string | null;
}

/** 分页包络 */
export interface AssetPageData {
  records: AssetRecord[];
  /** 总记录数，前端用于全量拉取分页计算 */
  total: number;
  size: number;
  current: number;
}

/** 资产页每页条数（规范指定 60） */
export const ASSET_PAGE_SIZE = 60;

/** 单页查询：type 不传或空表示全部 */
export function fetchAssetPage(type: AssetType | '', page: number) {
  const params = new URLSearchParams({ page: String(page), size: String(ASSET_PAGE_SIZE) });
  if (type) params.set('type', type);
  return apiRequest<AssetPageData>(`/api/assets?${params.toString()}`);
}

/** 删除资产 DELETE /api/assets/:assetId（成功 data 为 null，前端移除列表项） */
export function deleteAsset(id: AssetRecord['id']) {
  return apiRequest<null>(`/api/assets/${id}`, { method: 'DELETE' });
}

/** GET /api/assets/:assetId — 获取单个资产详情。 */
export function fetchAssetDetail(id: AssetRecord['id']) {
  return apiRequest<AssetRecord>(`/api/assets/${encodeURIComponent(String(id))}`);
}

/** 上传大小上限（字节）：image 20MB / video 200MB / audio 25MB */
export const UPLOAD_SIZE_LIMIT: Record<AssetType, number> = {
  image: 20 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
};

/** POST /api/agent/assets/uploads/presign 返回 */
export interface PresignData {
  /** 对象存储键，complete 时回传，前端不直接使用 */
  storage_key: string;
  /** 预签名上传 URL，PUT 直传文件到此地址 */
  upload_url: string;
  /** PUT 上传时需携带的请求头 */
  headers: Record<string, string>;
  /** 预签名 URL 有效期（秒） */
  expires_in: number;
}

/** 上传第一步：获取对象存储预签名 URL（mime 必须以 {type}/ 开头） */
export function fetchUploadPresign(params: { type: AssetType; mime: string; size: number }) {
  return apiRequest<PresignData>('/api/agent/assets/uploads/presign', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/** PUT 直传文件到预签名 URL（不经 http 层，原样携带返回头）
 * 开发模式下通过 Vite /__tos-upload 代理转发，避免 TOS CORS 限制 */
export async function putToPresignedUrl(presign: PresignData, file: File) {
  if (!presign.upload_url) throw new Error('预签名上传地址为空');

  // Dev 模式：走 Vite dev server 代理同域转发到 TOS，绕过浏览器 CORS
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

/** POST /api/agent/assets/uploads/complete 请求体（type/mime/size/storage_key 必须与 presign 一致） */
export interface UploadCompleteParams {
  type: AssetType;
  mime: string;
  size: number;
  /** presign 返回的 storage_key */
  storage_key: string;
  /** 关联项目 ID，资产页上传不传 */
  project_id?: string;
  width?: number;
  height?: number;
  duration?: number;
}

/** POST /api/agent/assets/uploads/complete 返回 */
export interface UploadCompleteData {
  /** 新创建的资产 ID */
  asset_id: string;
  /** 资产状态，ready 表示可用 */
  status: string;
  type: AssetType;
  /** 资产永久访问 URL */
  url: string;
  width: number;
  height: number;
  duration: number | null;
  mime: string;
  size: number;
}

/** 上传第三步：确认上传完成，后端校验并创建资产记录 */
export function completeUpload(params: UploadCompleteParams) {
  return apiRequest<UploadCompleteData>('/api/agent/assets/uploads/complete', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/** 并发控制工具：限制同时在途请求数量，避免浏览器同域名并发上限（HTTP/1.1 = 6）导致请求排队或失败 */
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
        // 单个失败不阻塞其他任务，记录为 undefined
        console.warn(`concurrentFetch 任务 ${i} 失败:`, err);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => workerLoop()),
  );
  return results;
}

/** 全量拉取：首页后按 total 计算页数并发拉余页拼接（按筛选类型在途去重，并发数 6 匹配浏览器 HTTP/1.1 上限） */
const pendingAll = new Map<string, Promise<AssetRecord[]>>();

/** 并发分页拉取（每页一个请求，并发 6 个） */
const ASSET_FETCH_CONCURRENCY = 6;

/** 分页数据偶有重叠时按资产 ID 去重，避免重复渲染同一张资产卡片。 */
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
