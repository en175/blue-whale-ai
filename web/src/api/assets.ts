/* ============================================
 * assets 接口：资产库列表（分页 + 筛选）
 * ============================================ */
import { infiniteQueryOptions, queryOptions, skipToken, type QueryClient } from '@tanstack/react-query';
import { apiRequest, silentInit, type ApiRequestInit } from './http';

/** 资产类型 */
export type AssetType = 'image' | 'video' | 'audio' | 'character';

/** GET /api/assets 返回项 */
export interface AssetRecord {
  /** 资产唯一标识，用于删除操作 */
  id: number | string;
  /** 资产类型，决定预览渲染方式 */
  type: AssetType;
  /** 服务端入库状态；只有 normal 可作为音频混合输入。 */
  status?: string | null;
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
  /**
   * AI 生成素材的原始提示词（IKFSSO）。
   *
   * 上传素材、视频提取音频（media_extract）、以及生成时 prompt 为空串的素材都是 `null`。
   * **只有 `GET /api/assets/:assetId` 返回这个字段**，列表接口不带——所以从列表分页拿到的
   * 记录上恒为 `undefined`，要拿提示词必须走详情接口。
   */
  prompt?: string | null;
  /** 创建时间（ISO 8601） */
  created_at: string | null;
  /** 关联素材库条目 id；未入过库为 null */
  material_id?: string | null;
  /** 素材库校验镜像：Active 为已通过合规 */
  material_status?: 'Active' | 'Processing' | 'Failed' | null;
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

/** 素材列表缓存键：筛选类型和分页大小共同决定一个独立的无限分页缓存。 */
export const assetKeys = {
  all: ['assets'] as const,
  pages: (type: AssetType | '', size: number) =>
    [...assetKeys.all, 'pages', type || 'all', size] as const,
};

/**
 * 释放资产相关缓存：列表分页（下次挂载重新测量和加载）+ 单条详情
 * （`assetDetailKeys` 挂在 `assetKeys.all` 前缀下，顺手一并清掉，不留陈旧提示词）。
 */
export function removeCachedAssetPages(queryClient: Pick<QueryClient, 'removeQueries'>) {
  queryClient.removeQueries({ queryKey: assetKeys.all });
}

/** 单页查询：type 不传或空表示全部；页面可按展示密度指定更小的批量。 */
export function fetchAssetPage(type: AssetType | '', page: number, size = ASSET_PAGE_SIZE) {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  if (type) params.set('type', type);
  // 资产页以骨架屏承接未就绪与请求失败状态，不向用户提示瞬态请求错误。
  return apiRequest<AssetPageData>(`/api/assets?${params.toString()}`, { silent: true });
}

/**
 * 资产库分页查询配置。
 *
 * 全部、图片、视频和音频各自拥有独立缓存；切回相同筛选时由 TanStack Query
 * 复用已加载页，只有缓存过期或素材发生变更后才重新请求。
 */
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

/** 删除资产 DELETE /api/assets/:assetId（成功 data 为 null，前端移除列表项） */
export function deleteAsset(id: AssetRecord['id']) {
  return apiRequest<null>(`/api/assets/${id}`, { method: 'DELETE' });
}

/** GET /api/assets/:assetId — 获取单个资产详情（比列表多 `prompt`，见 `AssetRecord`）。 */
export function fetchAssetDetail(id: AssetRecord['id'], init?: ApiRequestInit) {
  return apiRequest<AssetRecord>(`/api/assets/${encodeURIComponent(String(id))}`, init);
}

/**
 * 单条资产详情的缓存键（IKFTQW）：`assetKeys.all` 前缀下与列表分页并列，
 * 于是资产页离开时 `removeCachedAssetPages` 会连详情一起释放，不会留下陈旧提示词。
 */
export const assetDetailKeys = {
  detail: (id: AssetRecord['id']) => [...assetKeys.all, 'detail', String(id)] as const,
};

/**
 * 资产详情查询（IKFTQW）：点开详情弹窗时补拉列表没有的字段。
 *
 * 竞态由 Query 按 id 分键结构性保证——切换资产即换 key，旧响应落不进当前弹窗，
 * 不需要手写 requestId 守卫。注意 `skipToken` / `enabled` 只挡「新请求」，挡不住
 * 已经在途的那个；在途结果只会写进它自己 id 的缓存，不会串到当前弹窗。
 *
 * 失败不 toast（`silent`）：调用方退回列表记录继续渲染，不让一次补拉失败打断弹窗。
 */
export function assetDetailQueryOptions(id: AssetRecord['id'] | null) {
  return queryOptions({
    queryKey: assetDetailKeys.detail(id ?? ''),
    // 弹窗没开（id 为 null）用 skipToken 关掉请求；闭包里也因此拿得到收窄后的 id，
    // 不用写 `id as AssetRecord['id']` 断言。
    queryFn:
      id === null
        ? skipToken
        : ({ signal }) => fetchAssetDetail(id, { silent: true, signal }),
    enabled: id !== null,
  });
}

/** GET /api/assets/:assetId/references 返回（IKCZAT） */
export interface AssetReferencesData {
  assetId: string;
  /** 引用该素材的项目数（并集去重，只计存活项目） */
  projectCount: number;
}

/**
 * 查询素材被多少项目引用（IKCZAT）：删除前确认弹窗展示用。
 * 只读接口、不拦截删除；请求失败时调用方降级为不展示引用数（silent 避免错误 toast）。
 */
export function fetchAssetReferences(id: AssetRecord['id']) {
  return apiRequest<AssetReferencesData>(
    `/api/assets/${encodeURIComponent(String(id))}/references`,
    { silent: true },
  );
}

/**
 * 素材-项目关联（幂等）：POST /api/projects/:projectId/assets/:assetId/link。
 * 把资产库素材挂到指定项目，使其进入该项目 snapshot 资产字典，
 * 画布引用跨项目素材后刷新不会被判定为"素材已被删除"。
 */
export function linkAssetToProject(projectId: string, assetId: AssetRecord['id'], init?: ApiRequestInit) {
  return apiRequest<{ projectId: string; assetId: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(String(assetId))}/link`,
    { ...init, method: 'POST' },
  );
}

/** 上传大小上限（字节）：image 20MB / video 200MB / audio 25MB */
export const UPLOAD_SIZE_LIMIT: Record<AssetType, number> = {
  image: 20 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  character: 20 * 1024 * 1024,
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

/** 上传第一步：获取对象存储预签名 URL（mime 必须以 {type}/ 开头）。
 *  init.silent 透传 apiRequest（IKI8L4 错误提示归属）：工具会话内的上传由持有发送
 *  身份的调用方决定是否提示，迟到失败不在 http 层抢弹；缺省口径（toast）不变。 */
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
  /** 文件 MD5（32 位小写 hex），落库供下次上传 md5 查重复用 */
  md5?: string;
  /** 真人人像库导入：绑定素材库 id（Asset- 前缀） */
  materialId?: string;
  /** IKGOTB 资产来源标记：'mask_erase' = 擦除遮罩中间素材（用户资产列表不可见，值与
   *  @lib/contracts/image-erase 的 IMAGE_ERASE_MASK_ASSET_SOURCE 同源）；缺省 uploaded。 */
  source?: 'mask_erase';
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
  /** 资产绑定的素材库 id；未绑定为 null。dedup / complete 恒带回。 */
  material_id?: string | null;
  /** 素材审核镜像：Active 表示已过 Seedance 校验；未绑定或无状态行为 null。 */
  material_status?: 'Active' | 'Processing' | 'Failed' | null;
}

/** 上传第三步：确认上传完成，后端校验并创建资产记录。
 *  init.silent 透传同 fetchUploadPresign（IKI8L4 错误提示归属）。 */
export function completeUpload(params: UploadCompleteParams, init?: { silent?: boolean }) {
  return apiRequest<UploadCompleteData>('/api/agent/assets/uploads/complete', {
    method: 'POST',
    body: JSON.stringify(params),
    ...silentInit(init),
  });
}

/** POST /api/agent/assets/uploads/dedup 返回 */
export interface DedupData {
  /** true 表示命中同 md5 素材，可直接复用 asset 跳过上传三步 */
  dedup: boolean;
  /** 命中时返回；形状与 complete 响应 data 完全一致 */
  asset?: UploadCompleteData;
}

/**
 * 上传 md5 去重预检（IKCNLS）：presign 之前调用。
 * 命中：直接拿 asset 复用，跳过 presign→PUT→complete；传 project_id 时后端自动建项目关联。
 * 未命中 / md5 不合法：后端一律 fail-open 返回 dedup:false，不阻断上传。
 * 请求本身失败也不应阻断上传，调用方需自行 catch（silent 避免错误 toast）。
 */
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
