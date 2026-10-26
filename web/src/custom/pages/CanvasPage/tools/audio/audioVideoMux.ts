import type { Edge, Node } from '@xyflow/react';
import { AUDIO_VIDEO_MUX_RESULT_NAME_SUFFIX } from '@lib/contracts/audio-video-mux';
import { readAssetId } from '../../media/mediaRefs';

export const AUDIO_VIDEO_MUX_EDGE_ORIGIN = 'audio-video-mux';

export const AUDIO_VIDEO_MUX_TITLE = '音视频合成';

export const AUDIO_VIDEO_MUX_UNAVAILABLE_REASON = '音频不可用，无法合成';

export const AUDIO_VIDEO_MUX_UNSUPPORTED_REASON = '仅支持已完成的音频卡';

export const AUDIO_VIDEO_MUX_VIDEO_UNSUPPORTED_REASON = '仅支持绑定视频卡';

export const AUDIO_VIDEO_MUX_VIDEO_UNAVAILABLE_REASON = '视频不可用，无法绑定';

export const AUDIO_VIDEO_MUX_AUDIO_EDGE_LOCKED_REASON = '固定音频源不可移除，删除合成卡才解除';

export type AudioVideoMuxSync = 'none' | 'video' | 'audio';

export interface AudioVideoMuxBoundVideo {
  assetId: string;
  nodeId?: string;
  name: string;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  src?: string;
}

export interface AudioVideoMuxIdentity {
  sourceNodeId: string;
  sourceAssetId?: string;
  reserveAudio: boolean;
  sync: AudioVideoMuxSync;
  video?: AudioVideoMuxBoundVideo;
}

export function buildAudioVideoMuxIdentity(sourceNodeId: string, sourceAssetId?: string): AudioVideoMuxIdentity {
  return { sourceNodeId, sourceAssetId, reserveAudio: true, sync: 'none' };
}

export function audioVideoMuxInFlightSourceIdsOf(nodes: Node[]): Set<string> {
  return new Set(
    nodes
      .filter((n) => {
        if ((n.data as Record<string, unknown>).genStatus !== 'generating') return false;
        return audioVideoMuxIdentityOf(n) !== undefined;
      })
      .map((n) => audioVideoMuxIdentityOf(n)!.sourceNodeId),
  );
}

export function audioVideoMuxIdentityOf(node: Node | undefined): AudioVideoMuxIdentity | undefined {
  if (!node || node.type !== 'mediaNode') return undefined;
  const identity = ((node.data ?? {}) as Record<string, unknown>).audioVideoMux;
  if (!identity || typeof identity !== 'object') return undefined;
  const candidate = identity as AudioVideoMuxIdentity;
  return typeof candidate.sourceNodeId === 'string' && candidate.sourceNodeId !== '' ? candidate : undefined;
}

export function isAudioVideoMuxDraftNode(node: Node | undefined): boolean {
  if (audioVideoMuxIdentityOf(node) === undefined) return false;
  const data = (node!.data ?? {}) as Record<string, unknown>;
  return data.genStatus === 'draft';
}

function isFinishedCard(data: Record<string, unknown>): boolean {
  return !(typeof data.genStatus === 'string' && data.genStatus !== '');
}

export function audioVideoMuxSourceError(data: Record<string, unknown> | undefined): string | null {
  if (!data || data.mediaType !== 'audio') return AUDIO_VIDEO_MUX_UNSUPPORTED_REASON;
  if (!isFinishedCard(data)) return AUDIO_VIDEO_MUX_UNSUPPORTED_REASON;
  const src = typeof data.src === 'string' ? data.src : '';
  if (!src || src.startsWith('blob:')) return AUDIO_VIDEO_MUX_UNAVAILABLE_REASON;
  return null;
}

export function audioVideoMuxVideoError(node: Node | undefined): string | null {
  if (!node || node.type !== 'mediaNode') return AUDIO_VIDEO_MUX_VIDEO_UNSUPPORTED_REASON;
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (data.mediaType !== 'video') return AUDIO_VIDEO_MUX_VIDEO_UNSUPPORTED_REASON;
  if (!isFinishedCard(data)) return AUDIO_VIDEO_MUX_VIDEO_UNSUPPORTED_REASON;
  const src = typeof data.src === 'string' ? data.src : '';
  if (!src || src.startsWith('blob:')) return AUDIO_VIDEO_MUX_VIDEO_UNAVAILABLE_REASON;
  if (readAssetId(data) === undefined) return AUDIO_VIDEO_MUX_VIDEO_UNAVAILABLE_REASON;
  return null;
}

function isAudioVideoMuxEdgeOfDraft(edge: Edge, draft: Node | undefined): boolean {
  if (draft === undefined) return false;
  if ((edge.data as { origin?: string } | undefined)?.origin !== AUDIO_VIDEO_MUX_EDGE_ORIGIN) return false;
  return edge.target === draft.id;
}

export function isAudioVideoMuxAudioEdge(edge: Edge, draft: Node | undefined): boolean {
  const identity = audioVideoMuxIdentityOf(draft);
  if (!identity || !isAudioVideoMuxEdgeOfDraft(edge, draft)) return false;
  return edge.source === identity.sourceNodeId;
}

export function isAudioVideoMuxBindEdge(edge: Edge, draft: Node | undefined): boolean {
  const identity = audioVideoMuxIdentityOf(draft);
  if (!identity || !isAudioVideoMuxEdgeOfDraft(edge, draft)) return false;
  return edge.source !== identity.sourceNodeId;
}


export const AUDIO_VIDEO_MUX_FAIL_TEXT = '音视频合成失败，请重试';

export function audioVideoMuxResultName(videoName?: string | null): string {
  const raw = typeof videoName === 'string' ? videoName.trim() : '';
  const dot = raw.lastIndexOf('.');
  const base = (dot > 0 ? raw.slice(0, dot) : raw) || '视频';
  return `${base}${AUDIO_VIDEO_MUX_RESULT_NAME_SUFFIX}`;
}

export function audioVideoMuxErrorText(
  error?: { msg?: string | null; message?: string | null } | null,
): string {
  for (const value of [error?.msg, error?.message]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return AUDIO_VIDEO_MUX_FAIL_TEXT;
}

export function buildAudioVideoMuxPlaceholderNode(
  nodeId: string,
  identity: AudioVideoMuxIdentity,
  jobId: string | number,
  position: { x: number; y: number },
): Node {
  return {
    id: nodeId,
    type: 'mediaNode',
    position,
    data: {
      src: '',
      fileName: AUDIO_VIDEO_MUX_TITLE,
      mediaType: 'video',
      genStatus: 'generating',
      progress: 0,
      draft: true,
      jobId,
      toolMode: 'select',
      audioVideoMux: identity,
    },
  };
}
