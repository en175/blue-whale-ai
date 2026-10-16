import type { Edge, Node } from '@xyflow/react';
import { IMAGE_CROP_EDGE_ORIGIN } from './tools/image/imageCrop';
import { IMAGE_ENHANCE_EDGE_ORIGIN } from './tools/image/imageEnhance';
import { IMAGE_ERASE_EDGE_ORIGIN } from './tools/image/imageErase';
import { IMAGE_OUTPAINT_EDGE_ORIGIN } from './tools/image/imageOutpaint';
import { IMAGE_CUTOUT_EDGE_ORIGIN } from '@lib/contracts/image-cutout';
import { VIDEO_SUBTITLE_ERASE_EDGE_ORIGIN } from '@lib/contracts/video-subtitle-erase';

const PURE_VISUAL_EDGE_ORIGINS: ReadonlySet<string> = new Set([
  IMAGE_ENHANCE_EDGE_ORIGIN,
  IMAGE_ERASE_EDGE_ORIGIN,
  IMAGE_OUTPAINT_EDGE_ORIGIN,
  IMAGE_CROP_EDGE_ORIGIN,
  IMAGE_CUTOUT_EDGE_ORIGIN,
  VIDEO_SUBTITLE_ERASE_EDGE_ORIGIN,
]);

export interface ImageMediaRef {
  nodeId: string;
  url: string;
  name: string;
  assetId: string;
  textNodeId?: string;
  planNodeId?: string;
  mediaType?: 'image' | 'video' | 'audio';
}

export function isImageDraftNode(node: Node | undefined): boolean {
  if (!node || node.type !== 'mediaNode') return false;
  const data = (node.data ?? {}) as Record<string, unknown>;
  return data.draft === true && data.mediaType === 'image';
}

export function readAssetId(data: Record<string, unknown> | undefined): string | undefined {
  const raw = data?.assetId ?? data?.asset_id ?? data?.assetID;
  return raw == null || raw === '' ? undefined : String(raw);
}

export function isMaterialLibraryId(id: string | number | undefined): boolean {
  return typeof id === 'string' && /^asset-/i.test(id);
}

export function baseSourceError(
  node: NonNullable<Node>,
  extraCheck?: (data: Record<string, unknown>) => string | null,
): string | null {
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (data.genStatus === 'draft') return '待生成的草稿不能作为参考';
  if (data.genStatus === 'generating') return '生成中的卡片不能作为参考';
  if (data.genStatus === 'failed' || data.genStatus === 'cancelled') return '生成失败的卡片不能作为参考';
  if (data.assetMissing) return '素材已被删除';
  const src = typeof data.src === 'string' ? data.src : '';
  if (src.startsWith('blob:')) return '素材上传中，请稍候再选择';
  if (!src) return '素材已被删除';
  const extra = extraCheck?.(data);
  if (extra) return extra;
  if (readAssetId(data) === undefined) return '素材未关联资产，无法作为参考';
  return null;
}

export function imageRefSourceError(node: Node | undefined): string | null {
  if (!node) return '素材不存在';
  return baseSourceError(node, (data) => (data.mediaType !== 'image' ? '图片参考仅支持图片素材' : null));
}

export function cardNameOfNode(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  const name = ((node.data ?? {}) as Record<string, unknown>).fileName;
  return typeof name === 'string' && name ? name : node.id;
}

export function localNodeIdOf(fileId: string): string | null {
  if (!fileId.startsWith('node-')) return null;
  return fileId.slice('node-'.length) || null;
}

export function imageMediaRefsOf(
  targetNodeId: string,
  edges: Edge[],
  mediaNodes: Node[],
): ImageMediaRef[] {
  const byId = new Map(mediaNodes.map((n) => [n.id, n]));
  const refs: ImageMediaRef[] = [];
  const seenAssetIds = new Set<string>();
  for (const edge of edges) {
    if (edge.target !== targetNodeId) continue;
    if (PURE_VISUAL_EDGE_ORIGINS.has((edge.data as { origin?: string } | undefined)?.origin ?? '')) continue;
    const source = byId.get(edge.source);
    if (!source || source.type !== 'mediaNode') continue;
    if (imageRefSourceError(source) !== null) continue;
    const data = (source.data ?? {}) as Record<string, unknown>;
    const assetId = readAssetId(data)!;
    if (seenAssetIds.has(assetId)) continue;
    seenAssetIds.add(assetId);
    const inputSources = (edge.data as { inputSources?: { manual?: boolean; planNodeIds?: string[] } } | undefined)?.inputSources;
    const planNodeId = inputSources && inputSources.manual === false && Array.isArray(inputSources.planNodeIds) && inputSources.planNodeIds.length > 0
      ? inputSources.planNodeIds[0]
      : undefined;
    refs.push({
      nodeId: source.id,
      url: data.src as string,
      name: cardNameOfNode(source)!,
      assetId,
      planNodeId,
    });
  }
  return refs;
}
