import type { Edge, Node } from '@xyflow/react';
import { AUDIO_SPEED_EDGE_ORIGIN } from './audioSpeed';
import { AUDIO_TRIM_EDGE_ORIGIN } from './audioTrim';
import { AUDIO_MIX_EDGE_ORIGIN } from './audioMix';
import { AUDIO_VIDEO_MUX_EDGE_ORIGIN } from './audioVideoMux';
import { MEDIA_EXTRACT_EDGE_ORIGIN } from '../../mediaExtract';
import { baseSourceError, cardNameOfNode, readAssetId } from '../../mediaRefs';
import { panelCanvasRefError } from '../../refSourceTypes';

export const MAX_AUDIO_MEDIA_REFS = 3;
export const MAX_AUDIO_IMAGE_REFS = 1;

export interface AudioMediaRef {
  nodeId: string;
  url: string;
  name: string;
  assetId: string;
  mediaType: 'audio' | 'image';
  textNodeId?: string;
}

export function audioRefMediaTypeOf(data: Record<string, unknown>): 'audio' | 'image' | null {
  if (data.mediaType === 'image') return 'image';
  if (data.mediaType === 'audio') return 'audio';
  return null;
}

export function audioRefItemMediaTypeOf(item: { mediaType?: string; kind?: string }): 'audio' | 'image' {
  if (item.mediaType === 'image' || item.kind === 'image') return 'image';
  return 'audio';
}

export function audioMergedRefsError(refs: AudioMediaRef[]): string | null {
  const audioCount = refs.filter((r) => r.mediaType !== 'image').length;
  const imageCount = refs.filter((r) => r.mediaType === 'image').length;
  if (audioCount > 0 && imageCount > 0) return '音频与图片参考不可混用';
  if (audioCount > MAX_AUDIO_MEDIA_REFS) return `参考音频最多 ${MAX_AUDIO_MEDIA_REFS} 段`;
  if (imageCount > MAX_AUDIO_IMAGE_REFS) return `参考图最多 ${MAX_AUDIO_IMAGE_REFS} 个`;
  return null;
}

export function isAudioDraftNode(node: Node | undefined): boolean {
  if (!node || node.type !== 'mediaNode') return false;
  const data = (node.data ?? {}) as Record<string, unknown>;
  return data.draft === true && data.mediaType === 'audio';
}

export function audioRefSourceError(node: Node | undefined): string | null {
  if (!node) return '素材不存在';
  const data = (node.data ?? {}) as Record<string, unknown>;
  const typeErr = panelCanvasRefError('audio', data.mediaType);
  if (typeErr) return typeErr;
  return baseSourceError(node);
}

export function audioMediaRefsOf(
  targetNodeId: string,
  edges: Edge[],
  mediaNodes: Node[],
): { refs: AudioMediaRef[]; invalid: Array<{ nodeId: string; name: string; reason: string }> } {
  const byId = new Map(mediaNodes.map((n) => [n.id, n]));
  const refs: AudioMediaRef[] = [];
  const invalid: Array<{ nodeId: string; name: string; reason: string }> = [];
  const seenAssetIds = new Set<string>();
  for (const edge of edges) {
    if (edge.target !== targetNodeId) continue;
    const origin = (edge.data as { origin?: string } | undefined)?.origin;
    if (origin === MEDIA_EXTRACT_EDGE_ORIGIN || origin === AUDIO_TRIM_EDGE_ORIGIN
      || origin === AUDIO_MIX_EDGE_ORIGIN || origin === AUDIO_SPEED_EDGE_ORIGIN
      || origin === AUDIO_VIDEO_MUX_EDGE_ORIGIN) continue;
    const source = byId.get(edge.source);
    if (!source || source.type !== 'mediaNode') continue;
    const reason = audioRefSourceError(source);
    if (reason) {
      invalid.push({ nodeId: source.id, name: cardNameOfNode(source) ?? source.id, reason });
      continue;
    }
    const data = (source.data ?? {}) as Record<string, unknown>;
    const assetId = readAssetId(data)!;
    if (seenAssetIds.has(assetId)) continue;
    seenAssetIds.add(assetId);
    refs.push({
      nodeId: source.id,
      url: data.src as string,
      name: cardNameOfNode(source)!,
      assetId,
      mediaType: audioRefMediaTypeOf(data) ?? 'audio',
    });
  }
  return { refs, invalid };
}

export function checkAddAudioRef(
  assetId: string | undefined,
  existing: AudioMediaRef[],
  extraLocalCount = 0,
  incomingType: 'audio' | 'image' = 'audio',
): string | null {
  if (assetId && existing.some((r) => r.assetId === assetId)) return '重复的素材已跳过';
  const existingAudioCount = existing.filter((r) => r.mediaType !== 'image').length + extraLocalCount;
  const existingImageCount = existing.filter((r) => r.mediaType === 'image').length;
  if (incomingType === 'image' && existingAudioCount > 0) return '音频与图片参考不可混用';
  if (incomingType === 'audio' && existingImageCount > 0) return '音频与图片参考不可混用';
  if (incomingType === 'audio' && existingAudioCount >= MAX_AUDIO_MEDIA_REFS) {
    return `参考音频最多 ${MAX_AUDIO_MEDIA_REFS} 段`;
  }
  if (incomingType === 'image' && existingImageCount >= MAX_AUDIO_IMAGE_REFS) {
    return `参考图最多 ${MAX_AUDIO_IMAGE_REFS} 个`;
  }
  return null;
}
