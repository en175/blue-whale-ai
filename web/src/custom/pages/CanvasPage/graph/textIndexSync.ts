import type { Edge, Node } from '@xyflow/react';
import {
  AUDIO_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
  IMAGE_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
  TEXT_INDEX_INVALID_MESSAGE,
  TEXT_INDEX_UNSUPPORTED_MEDIA_MESSAGE,
  VIDEO_TEXT_INDEX_FRAME_CONFLICT_MESSAGE,
  textIndexOverflowMessage,
  checkAudioTextIndexSyncInput,
  checkTextIndexSyncInput,
  checkVideoTextIndexSyncInput,
  textIndexOfTarget,
  textInputSignatureOf,
  type TargetTextIndex,
  type TextProvidedRef,
} from '@lib/contracts/text-index-sync';
import { imageMediaRefsOf, type ImageMediaRef } from '../media/mediaRefs';
import { audioMediaRefsOf, audioMergedRefsError, type AudioMediaRef } from '../tools/audio/audioMediaRefs';
import { mergedVideoMediaRefsOf, type VideoMediaRef, type VideoMediaRefs } from '../tools/video/videoMediaRefs';
import { UNRESOLVED_IMAGE_REFERENCE_LIMIT } from '@/custom/utils/model-reference-limits';

export const DEFAULT_IMAGE_REFERENCE_LIMIT = UNRESOLVED_IMAGE_REFERENCE_LIMIT;

function canvasOf(nodes: Node[]): Parameters<typeof textIndexOfTarget>[0] {
  return nodes.map((node) => ({ id: node.id, type: node.type, data: node.data as Record<string, unknown> | undefined }));
}

export function imageTargetTextIndex(targetNodeId: string, edges: Edge[], nodes: Node[]): TargetTextIndex {
  return textIndexOfTarget(canvasOf(nodes), edges, targetNodeId);
}

function toMediaRef(item: TextProvidedRef): ImageMediaRef {
  return {
    nodeId: item.sourceNodeId,
    url: item.url,
    name: item.name,
    assetId: item.assetId,
    textNodeId: item.textNodeId,
    mediaType: item.mediaType,
  };
}

export function mergedImageRefsOf(targetNodeId: string, edges: Edge[], nodes: Node[]): ImageMediaRef[] {
  const direct = imageMediaRefsOf(targetNodeId, edges, nodes);
  const index = imageTargetTextIndex(targetNodeId, edges, nodes);
  const seen = new Set(direct.map((ref) => ref.assetId));
  return [...direct, ...index.refs.map(toMediaRef).filter((ref) => {
    if (seen.has(ref.assetId)) return false;
    seen.add(ref.assetId);
    return true;
  })];
}

export function imageTargetSignature(targetNodeId: string, edges: Edge[], nodes: Node[]): string {
  return textInputSignatureOf(imageTargetTextIndex(targetNodeId, edges, nodes).inputs);
}

export function hasTextInputs(targetNodeId: string, edges: Edge[], nodes: Node[]): boolean {
  return firstTextSourceOf(targetNodeId, edges, nodes) !== null;
}

export function firstTextSourceOf(targetNodeId: string, edges: Edge[], nodes: Node[]): string | null {
  const textIds = new Set(nodes.filter((n) => n.type === 'textNode').map((n) => n.id));
  for (const edge of edges) {
    if (edge.target === targetNodeId && textIds.has(edge.source)) return edge.source;
  }
  return null;
}

export function mediaInputStale(
  targetNodeId: string,
  edges: Edge[],
  nodes: Node[],
  mediaType: 'image' | 'video' | 'audio',
): boolean {
  const target = nodes.find((node) => node.id === targetNodeId);
  if (!target || target.type !== 'mediaNode') return false;
  const data = target.data as Record<string, unknown> | undefined;
  if (data?.mediaType !== mediaType) return false;
  if (!hasTextInputs(targetNodeId, edges, nodes)) return false;
  if (!data) return false;
  const used = data.usedInputSignature;
  if (typeof used !== 'string') return true;
  return used !== imageTargetSignature(targetNodeId, edges, nodes);
}

export function imageTextIndexSendError(
  targetNodeId: string,
  edges: Edge[],
  nodes: Node[],
  maxReferences: number,
): string | null {
  const index = imageTargetTextIndex(targetNodeId, edges, nodes);
  const merged = mergedImageRefsOf(targetNodeId, edges, nodes);
  const error = checkTextIndexSyncInput({
    index,
    acceptedMediaTypes: IMAGE_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
    mergedReferenceCount: merged.length,
    maxReferences,
  });
  if (!error) return null;
  if (error.kind === 'invalid_index') return TEXT_INDEX_INVALID_MESSAGE;
  if (error.kind === 'unsupported_media_type') return TEXT_INDEX_UNSUPPORTED_MEDIA_MESSAGE;
  return textIndexOverflowMessage(error.max);
}

export function nextUsedInputState(
  data: Record<string, unknown> | undefined,
  textInputSignature: string | null | undefined,
  jobId: number | string,
): { usedInputSignature: string; usedInputJobId: number } | null {
  if (typeof textInputSignature !== 'string' || textInputSignature.length === 0) return null;
  const usedJobId = typeof data?.usedInputJobId === 'number' ? data.usedInputJobId : 0;
  if (Number(jobId) <= usedJobId) return null;
  return { usedInputSignature: textInputSignature, usedInputJobId: Number(jobId) };
}


export function mergedVideoRefsWithTextIndex(
  targetNodeId: string,
  edges: Edge[],
  mediaNodes: Node[],
  textNodes: Node[],
): VideoMediaRefs {
  const base = mergedVideoMediaRefsOf(targetNodeId, edges, mediaNodes);
  const index = textIndexOfTarget(canvasOf([...mediaNodes, ...textNodes]), edges, targetNodeId);
  if (index.refs.length === 0) return base;
  const seen = new Set<string>(
    [base.first, base.last, ...base.reference]
      .filter((item): item is VideoMediaRef => item != null)
      .map((item) => item.assetId),
  );
  const appended: VideoMediaRef[] = [];
  for (const item of index.refs) {
    if (seen.has(item.assetId)) continue;
    seen.add(item.assetId);
    appended.push({
      nodeId: item.sourceNodeId,
      url: item.url,
      name: item.name,
      assetId: item.assetId,
      mediaType: item.mediaType,
      textNodeId: item.textNodeId,
    });
  }
  return appended.length > 0 ? { ...base, reference: [...base.reference, ...appended] } : base;
}

export function videoTextIndexSendError(
  targetNodeId: string,
  edges: Edge[],
  mediaNodes: Node[],
  textNodes: Node[],
): string | null {
  const index = textIndexOfTarget(canvasOf([...mediaNodes, ...textNodes]), edges, targetNodeId);
  if (index.refs.length === 0 && index.invalid.length === 0) return null;
  const direct = mergedVideoMediaRefsOf(targetNodeId, edges, mediaNodes);
  const error = checkVideoTextIndexSyncInput({
    index,
    acceptedMediaTypes: ['image', 'video', 'audio'],
    hasFrameRole: Boolean(direct.first || direct.last),
  });
  if (!error) return null;
  if (error.kind === 'invalid_index') return TEXT_INDEX_INVALID_MESSAGE;
  if (error.kind === 'frame_conflict') return VIDEO_TEXT_INDEX_FRAME_CONFLICT_MESSAGE;
  return TEXT_INDEX_UNSUPPORTED_MEDIA_MESSAGE;
}


export function mergedAudioRefsWithTextIndex(
  targetNodeId: string,
  edges: Edge[],
  mediaNodes: Node[],
  textNodes: Node[],
): { refs: AudioMediaRef[]; invalid: Array<{ nodeId: string; name: string; reason: string }> } {
  const base = audioMediaRefsOf(targetNodeId, edges, mediaNodes);
  const index = textIndexOfTarget(canvasOf([...mediaNodes, ...textNodes]), edges, targetNodeId);
  if (index.refs.length === 0) return base;
  const seen = new Set(base.refs.map((ref) => ref.assetId));
  const appended: AudioMediaRef[] = [];
  for (const item of index.refs) {
    if (seen.has(item.assetId)) continue;
    seen.add(item.assetId);
    appended.push({
      nodeId: item.sourceNodeId,
      url: item.url,
      name: item.name,
      assetId: item.assetId,
      mediaType: item.mediaType === 'image' ? 'image' : 'audio',
      textNodeId: item.textNodeId,
    });
  }
  return appended.length > 0 ? { ...base, refs: [...base.refs, ...appended] } : base;
}

export function audioTextIndexSendError(
  targetNodeId: string,
  edges: Edge[],
  mediaNodes: Node[],
  textNodes: Node[],
): string | null {
  const index = textIndexOfTarget(canvasOf([...mediaNodes, ...textNodes]), edges, targetNodeId);
  if (index.refs.length === 0 && index.invalid.length === 0) {
    return audioMergedRefsError(audioMediaRefsOf(targetNodeId, edges, mediaNodes).refs);
  }
  const error = checkAudioTextIndexSyncInput({
    index,
    acceptedMediaTypes: AUDIO_TEXT_INDEX_ACCEPTED_MEDIA_TYPES,
  });
  if (error?.kind === 'invalid_index') return TEXT_INDEX_INVALID_MESSAGE;
  if (error) return TEXT_INDEX_UNSUPPORTED_MEDIA_MESSAGE;
  return audioMergedRefsError(
    mergedAudioRefsWithTextIndex(targetNodeId, edges, mediaNodes, textNodes).refs,
  );
}
