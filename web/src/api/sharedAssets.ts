import { apiRequest } from './http';

export type SharedAssetType = 'card' | 'media' | 'goods' | 'scene' | 'text';

export type SharedAssetKind =
  | 'style'
  | 'character'
  | 'object'
  | 'environment'
  | 'custom'
  | 'image'
  | 'video'
  | 'audio';

export interface SharedAssetCardSnapshot {
  referenceImages: Array<{ id: string; src: string }>;
  description?: string;
  voice?: { name: string; src: string };
}

export interface SharedAssetMediaSnapshot {
  url: string;
  mime?: string | null;
  size?: number | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
}

export interface SharedAssetGoodsSnapshot {
  name: string;
  detail?: string;
  images: Array<{ id: string; src: string; enabled?: boolean }>;
}

export interface SharedAssetTextSnapshot {
  text: string;
  html?: string;
}

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

export type SharedAssetSnapshot =
  | SharedAssetCardSnapshot
  | SharedAssetMediaSnapshot
  | SharedAssetGoodsSnapshot
  | SharedAssetTextSnapshot
  | SharedAssetSceneSnapshot;

export interface SharedAssetView {
  id: string;
  assetType: SharedAssetType;
  kind: SharedAssetKind | null;
  name: string;
  thumbnailUrl: string | null;
  snapshot: SharedAssetSnapshot;
  status: 'normal' | 'invalid';
  createdAt: string;
}

export interface SaveSharedAssetCardRequest {
  assetType: 'card';
  kind: Exclude<SharedAssetKind, 'image' | 'video' | 'audio'>;
  snapshot: SharedAssetCardSnapshot;
}

export interface SaveSharedAssetMediaRequest {
  assetType: 'media';
  kind: 'image' | 'video' | 'audio';
  sourceAssetId: string;
  name?: string;
}

export interface SaveSharedAssetGoodsRequest {
  assetType: 'goods';
  snapshot: SharedAssetGoodsSnapshot;
}

export interface SaveSharedAssetSceneRequest {
  assetType: 'scene';
  sourceSceneCardId: string;
}

export interface SaveSharedAssetTextRequest {
  assetType: 'text';
  snapshot: SharedAssetTextSnapshot;
}

export type SaveSharedAssetRequest =
  | SaveSharedAssetCardRequest
  | SaveSharedAssetMediaRequest
  | SaveSharedAssetGoodsRequest
  | SaveSharedAssetSceneRequest
  | SaveSharedAssetTextRequest;

export interface SaveSharedAssetResult {
  created: boolean;
  item: SharedAssetView;
}

export interface SharedAssetListQuery {
  assetType?: SharedAssetType;
  kind?: SharedAssetKind;
  page?: number;
  size?: number;
}

export interface SharedAssetPageData {
  records: SharedAssetView[];
  total: number;
  size: number;
  current: number;
}

export interface AddSceneToProjectRequest {
  projectId: string;
}

export interface AddSceneToProjectResult {
  sceneCardId: string;
}

function buildQuery(params: SharedAssetListQuery): string {
  const qs = new URLSearchParams();
  if (params.assetType) qs.set('assetType', params.assetType);
  if (params.kind) qs.set('kind', params.kind);
  qs.set('page', String(params.page ?? 1));
  qs.set('size', String(params.size ?? 20));
  const s = qs.toString();
  return s ? `?${s}` : '';
}


export function saveSharedAsset(req: SaveSharedAssetRequest): Promise<SaveSharedAssetResult> {
  return apiRequest<SaveSharedAssetResult>('/api/shared-assets/save', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export function fetchSharedAssetList(params: SharedAssetListQuery = {}): Promise<SharedAssetPageData> {
  return apiRequest<SharedAssetPageData>(`/api/shared-assets${buildQuery(params)}`);
}

export function fetchSharedAssetDetail(id: string): Promise<SharedAssetView> {
  return apiRequest<SharedAssetView>(`/api/shared-assets/${encodeURIComponent(id)}`);
}

export function addSceneToProject(
  id: string,
  projectId: string,
): Promise<AddSceneToProjectResult> {
  return apiRequest<AddSceneToProjectResult>(`/api/shared-assets/${encodeURIComponent(id)}/add-to-project`, {
    method: 'POST',
    body: JSON.stringify({ projectId }),
  });
}

export function removeSharedAsset(id: string): Promise<null> {
  return apiRequest<null>(`/api/shared-assets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}


export const SHARED_ASSET_ERROR_MAP: Record<number, string> = {
  100202: '源素材不可用或不存在',
  100301: '共享资产不存在',
  100408: '请先为卡片补充参考图或描述',
  100410: '不支持的共享资产类型',
};


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

export function buildTextSaveRequest(text: string): SaveSharedAssetTextRequest {
  return {
    assetType: 'text',
    snapshot: { text },
  };
}
