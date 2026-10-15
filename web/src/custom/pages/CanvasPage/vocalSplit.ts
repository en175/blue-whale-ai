
import {
  VOCAL_SPLIT_DEFAULT_OUTPUT_FORMAT,
  VOCAL_SPLIT_DEFAULT_SCENE,
  VOCAL_SPLIT_OUTPUT_FORMATS,
  VOCAL_SPLIT_SCENE_TRACKS,
  type VocalSplitOutputFormat,
  type VocalSplitScene,
  type VocalSplitTrackType,
} from '@lib/contracts/vocal-split';
import { readJobFailText } from '@/custom/api/jobs';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';


export const VOCAL_SPLIT_FORMATS = VOCAL_SPLIT_OUTPUT_FORMATS;
export type VocalSplitFormat = VocalSplitOutputFormat;
export type { VocalSplitScene };
export const VOCAL_SPLIT_DEFAULT_FORMAT: VocalSplitFormat = VOCAL_SPLIT_DEFAULT_OUTPUT_FORMAT;

import { VOCAL_SPLIT_TRACK_LABELS } from '@/custom/enums';
export const VOCAL_SPLIT_DEFAULT_SESSION_SCENE: VocalSplitScene = VOCAL_SPLIT_DEFAULT_SCENE;

export function vocalSplitSceneLabel(scene: VocalSplitScene): string {
  const labels: Record<VocalSplitScene, string> = {
    audio: '通用',
    music: '音乐',
    drama: '短剧',
    narrate: '口播',
  };
  return labels[scene];
}

export function vocalSplitSceneHint(scene: VocalSplitScene): string {
  const tracks = VOCAL_SPLIT_SCENE_TRACKS[scene];
  return tracks.length >= 3 ? '人声/音乐/音效三轨' : '人声+背景音两轨';
}


export const VOCAL_SPLIT_NODE_PREFIX = 'vocal-split-';

export const VOCAL_SPLIT_EDGE_ORIGIN = 'vocal-split';

export const VOCAL_SPLIT_NODE_GAP = 60;

export interface VocalSplitIdentity {
  sourceAssetId: string;
  lastInput: { source_asset_id: string; scene: VocalSplitScene; output_format: VocalSplitFormat };
}

export function vocalSplitNodeId(jobId: string | number): string {
  return `${VOCAL_SPLIT_NODE_PREFIX}${jobId}`;
}

export function isVocalSplitNodeId(id: string): boolean {
  return id.startsWith(VOCAL_SPLIT_NODE_PREFIX);
}

export function vocalSplitDisplayName(videoFileName: unknown): string {
  const name = typeof videoFileName === 'string' ? videoFileName.trim() : '';
  if (!name) return '人声背景分离';
  return `${name.replace(/\.[^./]+$/, '')}(人声背景分离)`;
}

export function buildVocalSplitPlaceholderNode(input: {
  nodeId: string;
  scene: VocalSplitScene;
  outputFormat: VocalSplitFormat;
  sourceAssetId?: string | number | null;
  jobId?: string | number | null;
  source?: { position?: { x?: number; y?: number }; data?: Record<string, unknown> } | null;
}): {
  id: string;
  type: 'mediaNode';
  position: { x: number; y: number };
  data: Record<string, unknown>;
} {
  const x = Number(input.source?.position?.x ?? 0);
  const y = Number(input.source?.position?.y ?? 0);
  const data = input.source?.data ?? {};
  const box = mediaContentBox({
    mediaType: data.mediaType as 'image' | 'video' | 'audio' | undefined,
    width: typeof data.width === 'number' ? data.width : undefined,
    height: typeof data.height === 'number' ? data.height : undefined,
    ratio: typeof data.targetRatio === 'string' ? data.targetRatio : undefined,
  });
  const sourceAssetId =
    input.sourceAssetId != null ? String(input.sourceAssetId) : '';
  const left = Number.isFinite(x) ? x : 0;
  const top = Number.isFinite(y) ? y : 0;
  return {
    id: input.nodeId,
    type: 'mediaNode',
    position: {
      x: Math.round(left + box.width + VOCAL_SPLIT_NODE_GAP),
      y: Math.round(top),
    },
    data: {
      src: '',
      fileName: vocalSplitDisplayName(data.fileName),
      mediaType: 'audio',
      genStatus: 'generating',
      progress: 0,
      ...(input.jobId != null ? { jobId: input.jobId } : {}),
      toolMode: 'select',
      ...(sourceAssetId
        ? { vocalSplit: { sourceAssetId, lastInput: { source_asset_id: sourceAssetId, scene: input.scene, output_format: input.outputFormat } } }
        : {}),
    },
  };
}


const ERROR_CODE_TEXT: Record<string, string> = {
  vocal_split_failed: '人声背景分离失败，请重试',
  source_asset_unavailable: '源视频资产不可用，请刷新画布后重试',
  enqueue_failed: '任务入队失败，请重试',
};

export function vocalSplitErrorText(
  error?: { code?: string | number; message?: string; msg?: string } | null,
): string {
  const text = readJobFailText(error);
  if (text) return text;
  if (error?.code != null && ERROR_CODE_TEXT[String(error.code)]) {
    return ERROR_CODE_TEXT[String(error.code)];
  }
  return '人声背景分离失败';
}

export function vocalSplitTerminalPatch(detail: {
  status: string;
  error?: { code?: string | number; message?: string; msg?: string } | null;
}): Record<string, unknown> | null {
  if (detail.status === 'failed') {
    return {
      genStatus: 'failed',
      errorText: vocalSplitErrorText(detail.error),
    };
  }
  if (detail.status === 'cancelled') {
    return { genStatus: 'cancelled' };
  }
  return null;
}


export const VOCAL_SPLIT_TRACK_NODE_PREFIX = 'vocal-track-';

export function vocalSplitTrackNodeId(
  jobId: string | number,
  trackType: VocalSplitTrackType,
): string {
  return `${VOCAL_SPLIT_TRACK_NODE_PREFIX}${jobId}-${trackType}`;
}

export function vocalSplitSourceName(placeholderFileName: unknown): string {
  const name = typeof placeholderFileName === 'string' ? placeholderFileName.trim() : '';
  const suffix = '(人声背景分离)';
  if (!name.endsWith(suffix)) return '';
  return name.slice(0, name.length - suffix.length).trim();
}

export function vocalSplitTrackDisplayName(
  sourceName: unknown,
  trackType: VocalSplitTrackType,
  format: VocalSplitFormat,
): string {
  const base = typeof sourceName === 'string' ? sourceName.trim() : '';
  const label = VOCAL_SPLIT_TRACK_LABELS[trackType];
  if (!base) return `人声背景分离(${label}).${format}`;
  return `${base}(${label}).${format}`;
}

export interface VocalSplitTrackNodePlan {
  trackType: VocalSplitTrackType;
  node: {
    id: string;
    type: 'mediaNode';
    position: { x: number; y: number };
    data: Record<string, unknown>;
  };
}

export function buildVocalSplitTrackNodes(input: {
  jobId: string | number;
  outputFormat: VocalSplitFormat;
  tracks: ReadonlyArray<{
    track_type: VocalSplitTrackType;
    asset_id: string;
    url: string;
    duration: number | null;
  }>;
  sourceName: string;
  anchor: { x: number; y: number };
}): VocalSplitTrackNodePlan[] {
  const box = mediaContentBox({ mediaType: 'audio' });
  const left = Number.isFinite(input.anchor.x) ? input.anchor.x : 0;
  const top = Number.isFinite(input.anchor.y) ? input.anchor.y : 0;
  return input.tracks.map((track, index) => ({
    trackType: track.track_type,
    node: {
      id: vocalSplitTrackNodeId(input.jobId, track.track_type),
      type: 'mediaNode' as const,
      position: {
        x: Math.round(left),
        y: Math.round(top + index * (box.height + VOCAL_SPLIT_NODE_GAP)),
      },
      data: {
        src: track.url,
        fileName: vocalSplitTrackDisplayName(input.sourceName, track.track_type, input.outputFormat),
        mediaType: 'audio',
        progress: 100,
        assetId: track.asset_id,
        ...(track.duration != null ? { duration: track.duration } : {}),
        toolMode: 'select',
      },
    },
  }));
}
