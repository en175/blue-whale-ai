import type { Edge, Node } from '@xyflow/react';
import { DEFAULT_VIDEO_REFERENCE_MAX, videoReferenceMaxForMode } from '@/custom/utils/model-reference-limits';
import { VIDEO_REFERENCE_NOT_APPROVED_MESSAGE } from '@/custom/utils/video-reference-compliance';
import { baseSourceError, cardNameOfNode, isMaterialLibraryId, readAssetId } from './mediaRefs';
import { type VideoRefRole } from '@/custom/enums';

export function asVideoRefMediaType(type: unknown): 'image' | 'video' | 'audio' {
  return type === 'video' ? 'video' : type === 'audio' ? 'audio' : 'image';
}

export const hasAnyMediaRef = (refs: VideoMediaRefs): boolean =>
  refs.reference.length > 0 || Boolean(refs.first || refs.last);

export interface VideoMediaRef {
  nodeId: string;
  url: string;
  name: string;
  assetId: string;
  mediaType: 'image' | 'video' | 'audio';
  materialId?: string;
  duration?: number;
  textNodeId?: string;
  planNodeId?: string;
}

export interface VideoMediaRefs {
  reference: VideoMediaRef[];
  first?: VideoMediaRef;
  last?: VideoMediaRef;
  invalid?: Array<{ nodeId: string; name: string; role: VideoRefRole; reason: string; materialId?: string }>;
}

export interface VideoMaterialRefData {
  materialId: string;
  url: string;
  name: string;
  mediaType: 'image' | 'video';
  role: VideoRefRole;
}

export function readDraftMaterialRefs(node: Node | undefined): VideoMaterialRefData[] {
  if (!node) return [];
  const raw = ((node.data ?? {}) as Record<string, unknown>).draftMaterialRefs;
  if (!Array.isArray(raw)) return [];
  const items: VideoMaterialRefData[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const d = item as Record<string, unknown>;
    if (typeof d.materialId !== 'string' || !d.materialId) continue;
    if (typeof d.url !== 'string' || !d.url) continue;
    if (d.mediaType !== 'image' && d.mediaType !== 'video') continue;
    if (d.role !== 'reference' && d.role !== 'first' && d.role !== 'last') continue;
    items.push({
      materialId: d.materialId,
      url: d.url,
      name: typeof d.name === 'string' && d.name ? d.name : d.materialId,
      mediaType: d.mediaType,
      role: d.role,
    });
  }
  return items;
}

export function videoRefIdentityIds(item: Pick<VideoMediaRef, 'assetId' | 'materialId'>): string[] {
  const ids = new Set<string>();
  if (item.assetId) ids.add(item.assetId);
  if (item.materialId) ids.add(item.materialId);
  return [...ids];
}

export function occupiedVideoRefIds(refs: VideoMediaRefs): Set<string> {
  const ids = new Set<string>();
  for (const item of [...refs.reference, refs.first, refs.last]) {
    if (!item) continue;
    for (const id of videoRefIdentityIds(item)) ids.add(id);
  }
  return ids;
}

export function incomingVideoRefOccupied(
  refs: VideoMediaRefs,
  incomingIds: ReadonlyArray<string | undefined>,
): boolean {
  const occupied = occupiedVideoRefIds(refs);
  return incomingIds.some((id) => Boolean(id && occupied.has(id)));
}

export function mergeVideoMaterialRefs(
  refs: VideoMediaRefs,
  materials: VideoMaterialRefData[],
): VideoMediaRefs {
  if (materials.length === 0) return refs;
  const merged: VideoMediaRefs = { ...refs, reference: [...refs.reference] };
  const seenMaterialIds = new Set<string>();
  for (const m of materials) {
    if (seenMaterialIds.has(m.materialId) || incomingVideoRefOccupied(merged, [m.materialId])) continue;
    seenMaterialIds.add(m.materialId);
    const item: VideoMediaRef = {
      nodeId: m.materialId,
      url: m.url,
      name: m.name,
      assetId: m.materialId,
      mediaType: m.mediaType,
      materialId: m.materialId,
    };
    if (m.role === 'reference') {
      merged.reference.push(item);
    } else if (m.role === 'first') {
      if (!merged.first) merged.first = item;
      else (merged.invalid ??= []).push({ nodeId: m.materialId, name: m.name, role: 'first', reason: '首帧已指定', materialId: m.materialId });
    } else {
      if (!merged.last) merged.last = item;
      else (merged.invalid ??= []).push({ nodeId: m.materialId, name: m.name, role: 'last', reason: '尾帧已指定', materialId: m.materialId });
    }
  }
  return merged;
}

export function isLibraryOnlyVideoRef(
  item: Pick<VideoMediaRef, 'nodeId' | 'materialId'>,
): item is { nodeId: string; materialId: string } {
  return item.materialId != null && item.nodeId === item.materialId;
}

export function mergedVideoMediaRefsOf(
  targetNodeId: string,
  edges: Edge[],
  mediaNodes: Node[],
): VideoMediaRefs {
  const byId = new Map(mediaNodes.map((n) => [n.id, n]));
  return mergeVideoMaterialRefs(
    videoMediaRefsOf(targetNodeId, edges, mediaNodes),
    readDraftMaterialRefs(byId.get(targetNodeId)),
  );
}

export function freshVideoCanvasRefs(refs: VideoMediaRefs, mediaNodes: Node[]): VideoMediaRefs {
  const byId = new Map(mediaNodes.map((n) => [n.id, n]));
  const fresh = (ref: VideoMediaRef): VideoMediaRef => {
    if (ref.materialId != null) return ref;
    const current = cardNameOfNode(byId.get(ref.nodeId));
    return current === undefined || current === ref.name ? ref : { ...ref, name: current };
  };
  const next: VideoMediaRefs = { reference: refs.reference.map(fresh) };
  if (refs.first) next.first = fresh(refs.first);
  if (refs.last) next.last = fresh(refs.last);
  if (refs.invalid) next.invalid = [...refs.invalid];
  return next;
}

export function isVideoDraftNode(node: Node | undefined): boolean {
  if (!node || node.type !== 'mediaNode') return false;
  const data = (node.data ?? {}) as Record<string, unknown>;
  return data.draft === true && data.mediaType === 'video';
}

export function readRefRole(edge: Edge): VideoRefRole {
  const role = (edge.data as Record<string, unknown> | undefined)?.refRole;
  return role === 'first' || role === 'last' ? role : 'reference';
}

export function videoRefSourceError(node: Node | undefined, role: VideoRefRole): string | null {
  if (!node) return '素材不存在';
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (role !== 'reference' && data.mediaType !== 'image') return '首尾帧仅支持图片素材';
  if (data.mediaType !== 'image' && data.mediaType !== 'video' && data.mediaType !== 'audio') return '视频参考仅支持图片、视频或音频素材';
  if (data.complianceFailed === true) return VIDEO_REFERENCE_NOT_APPROVED_MESSAGE;
  return baseSourceError(node);
}

export function videoMediaRefsOf(
  targetNodeId: string,
  edges: Edge[],
  mediaNodes: Node[],
): VideoMediaRefs {
  const byId = new Map(mediaNodes.map((n) => [n.id, n]));
  const refs: VideoMediaRefs = { reference: [] };
  const seenAssetIds = new Set<string>();
  for (const edge of edges) {
    if (edge.target !== targetNodeId) continue;
    const source = byId.get(edge.source);
    if (!source || source.type !== 'mediaNode') continue;
    const role = readRefRole(edge);
    const reason = videoRefSourceError(source, role);
    if (reason) {
      (refs.invalid ??= []).push({
        nodeId: source.id,
        name: String(source.data.fileName || source.id),
        role,
        reason,
      });
      continue;
    }
    const data = (source.data ?? {}) as Record<string, unknown>;
    const assetId = readAssetId(data)!;
    const materialId =
      typeof data.materialId === 'string' && data.materialId
        ? data.materialId
        : isMaterialLibraryId(assetId)
          ? assetId
          : undefined;
    if (seenAssetIds.has(assetId) || (materialId && seenAssetIds.has(materialId))) continue;
    if (role !== 'reference' && (role === 'first' ? refs.first : refs.last)) continue;
    seenAssetIds.add(assetId);
    if (materialId) seenAssetIds.add(materialId);
    const inputSources = (edge.data as { inputSources?: { manual?: boolean; planNodeIds?: string[] } } | undefined)?.inputSources;
    const planNodeId = inputSources && inputSources.manual === false && Array.isArray(inputSources.planNodeIds) && inputSources.planNodeIds.length > 0
      ? inputSources.planNodeIds[0]
      : undefined;
    const item: VideoMediaRef = {
      nodeId: source.id,
      url: data.src as string,
      name: typeof data.fileName === 'string' && data.fileName ? data.fileName : source.id,
      assetId,
      mediaType: data.mediaType as 'image' | 'video' | 'audio',
      materialId,
      duration: typeof data.duration === 'number' && data.duration > 0 ? data.duration : undefined,
      planNodeId,
    };
    if (role === 'reference') refs.reference.push(item);
    else if (role === 'first') refs.first = item;
    else refs.last = item;
  }
  return refs;
}

export interface VideoRefCapabilities {
  firstFrame: boolean;
  lastFrame: boolean;
  firstLastFrame: boolean;
  referenceImage: boolean;
  videoReference?: boolean;
  audioReference?: boolean;
  videoReferenceMax?: number;
  audioReferenceMax?: number;
  imageReferenceMax?: number;
  imageMax?: number;
  maxReferenceDurationSec?: number | null;
}

export function videoRefConflict(
  refs: VideoMediaRefs,
  caps: VideoRefCapabilities,
  mode?: string | null,
): string | null {
  if (refs.invalid?.length) return '参考素材不可用，请恢复素材或移除失效引用后发送';
  if ((refs.first || refs.last) && refs.reference.length > 0) {
    return '首尾帧与普通参考不能混用，请移除其中一类输入';
  }
  if (refs.first || refs.last) {
    if (mode === 'first_frame' && refs.last) return '图生视频只使用首帧，请先移除尾帧';
    if (!refs.first) return '请补充首帧';
    if (!refs.last && mode !== 'first_frame') return '请补充尾帧';
  }
  if (refs.reference.length > 0 && !caps.referenceImage) {
    return '当前模型不支持图片参考，请移除普通参考';
  }
  return null;
}

export function canAddRefRole(
  role: VideoRefRole,
  refs: VideoMediaRefs,
  caps: VideoRefCapabilities,
): boolean {
  if (role === 'first') return caps.firstFrame && !refs.first;
  if (role === 'last') return caps.lastFrame && !refs.last;
  return caps.referenceImage;
}

export function checkAddVideoRef(
  role: VideoRefRole,
  mediaType: 'image' | 'video' | 'audio',
  assetId: string | undefined,
  refs: VideoMediaRefs,
  caps?: VideoRefCapabilities | null,
  relatedIds?: ReadonlyArray<string | undefined>,
  duration?: number,
  mode?: string | null,
): string | null {
  if (role !== 'reference' && mediaType !== 'image') return '首尾帧仅支持图片素材';
  if (role === 'first' && refs.first) return '首帧已指定，请先移除现有首帧';
  if (role === 'last' && refs.last) return '尾帧已指定，请先移除现有尾帧';
  if (incomingVideoRefOccupied(refs, [assetId, ...(relatedIds ?? [])])) {
    return role !== 'reference' ? '素材重复' : '重复的素材已跳过';
  }
  if (role === 'reference') {
    const videoMax = videoReferenceMaxForMode(caps?.videoReferenceMax ?? DEFAULT_VIDEO_REFERENCE_MAX, mode);
    const audioMax = caps?.audioReferenceMax ?? 3;
    const imageMax = caps?.imageMax ?? 9;
    if (mediaType === 'video') {
      const videoCount = refs.reference.filter((r) => r.mediaType === 'video').length;
      if (videoCount >= videoMax) return `参考视频最多 ${videoMax} 个`;
    } else if (mediaType === 'audio') {
      if (refs.reference.filter(r => r.mediaType === 'audio').length >= audioMax) return `参考音频最多 ${audioMax} 个`;
    } else if (refs.reference.filter(r => r.mediaType === 'image').length >= imageMax) {
      return `参考图最多 ${imageMax} 张`;
    }
    const maxDuration = caps?.maxReferenceDurationSec ?? null;
    if (maxDuration != null) {
      const total = refs.reference.reduce((sum, r) => sum + (r.duration ?? 0), 0) + (duration ?? 0);
      if (total > maxDuration) return `加入后参考素材总时长超过 ${maxDuration} 秒，请减少素材`;
    }
  }
  return null;
}
