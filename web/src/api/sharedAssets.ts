/* ============================================
 * sharedAssets 接口：画布共享资产 CRUD
 * 对齐后端 shared-assets 模块契约（IK9QKP）
 * ============================================ */
import { apiRequest } from './http';

/** 第一层：资产大类 */
export type SharedAssetType = 'card' | 'media' | 'goods' | 'scene' | 'text';

/** 第二层：子类型（卡片 kind + 媒体 kind） */
export type SharedAssetKind =
  | 'style'
  | 'character'
  | 'object'
  | 'environment'
  | 'custom'
  | 'image'
  | 'video'
  | 'audio';

/** 卡片快照（风格/角色/物体/环境/自定义） */
export interface SharedAssetCardSnapshot {
  /** 参考图列表，每项含 id + src */
  referenceImages: Array<{ id: string; src: string }>;
  /** 描述文本 */
  description?: string;
  /** 角色卡音色，仅 character 类型需要 */
  voice?: { name: string; src: string };
}

/** 媒体快照（由后端从 assets 源行抓取，自包含） */
export interface SharedAssetMediaSnapshot {
  /** 素材访问 URL */
  url: string;
  mime?: string | null;
  size?: number | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
}

/** 商品快照 */
export interface SharedAssetGoodsSnapshot {
  name: string;
  detail?: string;
  images: Array<{ id: string; src: string; enabled?: boolean }>;
}

/** 文本快照 */
export interface SharedAssetTextSnapshot {
  /** 富文本 HTML */
  html: string;
}

/** 场景卡快照 */
export interface SharedAssetSceneSnapshot {
  title: string;
  summary?: string | null;
  contentMarkdown: string;
  generationPreset?: {
    parameters: unknown;
    referenceMode: string;
    referenceAssets: unknown[];
    capabilitySnapshotVersion: unknown;
  } | null;
}

/** 快照联合类型 */
export type SharedAssetSnapshot =
  | SharedAssetCardSnapshot
  | SharedAssetMediaSnapshot
  | SharedAssetGoodsSnapshot
  | SharedAssetTextSnapshot
  | SharedAssetSceneSnapshot;

/** 共享资产视图（列表项 + 详情通用） */
export interface SharedAssetView {
  id: string;
  /** 第一层：大类 */
  assetType: SharedAssetType;
  /** 第二层：子类型，goods/scene/text 为 null */
  kind: SharedAssetKind | null;
  /** 显示名称 */
  name: string;
  /** 缩略图 URL，无封面为 null */
  thumbnailUrl: string | null;
  /** 快照数据，结构取决于 assetType */
  snapshot: SharedAssetSnapshot;
  /** 状态：normal 正常 / invalid 失效 */
  status: 'normal' | 'invalid';
  /** 创建时间（ISO 8601） */
  createdAt: string;
}

/** 保存请求 - 卡片 */
export interface SaveSharedAssetCardRequest {
  assetType: 'card';
  kind: Exclude<SharedAssetKind, 'image' | 'video' | 'audio'>;
  snapshot: SharedAssetCardSnapshot;
}

/** 保存请求 - 媒体 */
export interface SaveSharedAssetMediaRequest {
  assetType: 'media';
  kind: 'image' | 'video' | 'audio';
  /** 源资产 ID（画布 mediaNode 的 assetId，后端抓取快照） */
  sourceAssetId: string;
  /** 可选，默认取文件名 */
  name?: string;
}

/** 保存请求 - 商品 */
export interface SaveSharedAssetGoodsRequest {
  assetType: 'goods';
  snapshot: SharedAssetGoodsSnapshot;
}

/** 保存请求 - 场景卡 */
export interface SaveSharedAssetSceneRequest {
  assetType: 'scene';
  /** 源场景卡 ID */
  sourceSceneCardId: string;
}

/** 保存请求 - 文本 */
export interface SaveSharedAssetTextRequest {
  assetType: 'text';
  snapshot: SharedAssetTextSnapshot;
}

/** 保存请求联合 */
export type SaveSharedAssetRequest =
  | SaveSharedAssetCardRequest
  | SaveSharedAssetMediaRequest
  | SaveSharedAssetGoodsRequest
  | SaveSharedAssetSceneRequest
  | SaveSharedAssetTextRequest;

/** 保存响应 */
export interface SaveSharedAssetResult {
  /** true=新建；false=已存在（幂等/去重/复活） */
  created: boolean;
  item: SharedAssetView;
}

/** 列表查询参数 */
export interface SharedAssetListQuery {
  /** 第一层过滤，缺省=全部 */
  assetType?: SharedAssetType;
  /** 第二层过滤，缺省=全部 */
  kind?: SharedAssetKind;
  /** 页码，从 1 开始，默认 1 */
  page?: number;
  /** 每页条数，1-100，默认 20 */
  size?: number;
}

/** 列表响应 */
export interface SharedAssetPageData {
  records: SharedAssetView[];
  total: number;
  size: number;
  current: number;
}

/** 场景卡添加到项目请求 */
export interface AddSceneToProjectRequest {
  /** 目标项目 ID */
  projectId: string;
}

/** 场景卡添加到项目响应 */
export interface AddSceneToProjectResult {
  /** 新建的场景卡 ID */
  sceneCardId: string;
}

/** 列表查询（带参数编码） */
function buildQuery(params: SharedAssetListQuery): string {
  const qs = new URLSearchParams();
  if (params.assetType) qs.set('assetType', params.assetType);
  if (params.kind) qs.set('kind', params.kind);
  qs.set('page', String(params.page ?? 1));
  qs.set('size', String(params.size ?? 20));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

/* ============ API 方法 ============ */

/** POST /api/shared-assets/save — 保存到共享资产 */
export function saveSharedAsset(req: SaveSharedAssetRequest): Promise<SaveSharedAssetResult> {
  return apiRequest<SaveSharedAssetResult>('/api/shared-assets/save', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

/** GET /api/shared-assets — 列表（分页 + 双维过滤） */
export function fetchSharedAssetList(params: SharedAssetListQuery = {}): Promise<SharedAssetPageData> {
  return apiRequest<SharedAssetPageData>(`/api/shared-assets${buildQuery(params)}`);
}

/** GET /api/shared-assets/:id — 详情 */
export function fetchSharedAssetDetail(id: string): Promise<SharedAssetView> {
  return apiRequest<SharedAssetView>(`/api/shared-assets/${encodeURIComponent(id)}`);
}

/** POST /api/shared-assets/:id/add-to-project — 场景卡添加回画布 */
export function addSceneToProject(
  id: string,
  projectId: string,
): Promise<AddSceneToProjectResult> {
  return apiRequest<AddSceneToProjectResult>(`/api/shared-assets/${encodeURIComponent(id)}/add-to-project`, {
    method: 'POST',
    body: JSON.stringify({ projectId }),
  });
}

/** DELETE /api/shared-assets/:id — 移除共享条目 */
export function removeSharedAsset(id: string): Promise<null> {
  return apiRequest<null>(`/api/shared-assets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/* ============ 错误码映射 ============ */

/** 后端错误码 → 友好提示文案 */
export const SHARED_ASSET_ERROR_MAP: Record<number, string> = {
  100202: '源素材不可用或不存在',
  100301: '共享资产不存在',
  100408: '请先为卡片补充参考图或描述',
  100410: '不支持的共享资产类型',
};

/** 构建保存请求的辅助函数 */

/** 从画布节点数据构建卡片保存请求 */
export function buildCardSaveRequest(
  kind: 'style' | 'character' | 'object' | 'environment' | 'custom',
  data: {
    referenceImages: Array<{ id: string; src: string }>;
    description?: string;
    voice?: { name: string; src: string };
  },
): SaveSharedAssetCardRequest {
  return {
    assetType: 'card',
    kind,
    snapshot: {
      referenceImages: data.referenceImages,
      description: data.description,
      ...(kind === 'character' && data.voice ? { voice: data.voice } : {}),
    },
  };
}

/** 从媒体节点数据构建媒体保存请求 */
export function buildMediaSaveRequest(
  mediaType: 'image' | 'video' | 'audio',
  assetId: string | number,
  fileName?: string,
): SaveSharedAssetMediaRequest {
  return {
    assetType: 'media',
    kind: mediaType,
    sourceAssetId: String(assetId),
    name: fileName,
  };
}

/** 从商品节点数据构建商品保存请求 */
export function buildGoodsSaveRequest(data: {
  name: string;
  detail?: string;
  images: Array<{ id: string; src: string; enabled?: boolean }>;
}): SaveSharedAssetGoodsRequest {
  return {
    assetType: 'goods',
    snapshot: {
      name: data.name,
      detail: data.detail,
      images: data.images,
    },
  };
}

/** 从文本节点数据构建文本保存请求 */
export function buildTextSaveRequest(html: string): SaveSharedAssetTextRequest {
  return {
    assetType: 'text',
    snapshot: { html },
  };
}
