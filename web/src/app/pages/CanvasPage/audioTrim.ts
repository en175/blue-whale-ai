import { readJobFailText } from '@/api/jobs';
import {
  AUDIO_TRIM_FALLBACK_OUTPUT_FORMAT,
  AUDIO_TRIM_OUTPUT_FORMATS,
  type AudioTrimOutputFormat,
} from '@lib/contracts/audio-trim';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';

export const AUDIO_TRIM_MISSING_DURATION_REASON = '音频时长缺失，无法截取';

export interface AudioTrimGateSource {
  src?: string | null;
  duration?: number | null;
}

export function audioTrimGateReason(source: AudioTrimGateSource): string | null {
  if (!source.src) return AUDIO_TRIM_MISSING_DURATION_REASON;
  if (!(typeof source.duration === 'number' && source.duration > 0)) {
    return AUDIO_TRIM_MISSING_DURATION_REASON;
  }
  return null;
}


export const AUDIO_TRIM_FORMATS = AUDIO_TRIM_OUTPUT_FORMATS;
export type AudioTrimFormat = AudioTrimOutputFormat;
export const AUDIO_TRIM_FALLBACK_FORMAT = AUDIO_TRIM_FALLBACK_OUTPUT_FORMAT;


export const AUDIO_TRIM_NODE_PREFIX = 'audio-trim-';

export const AUDIO_TRIM_NODE_GAP = 60;

export const AUDIO_TRIM_EDGE_ORIGIN = 'audio-trim';

export interface AudioTrimIdentity {
  sourceAssetId: string;
  lastInput: {
    source_asset_id: string;
    start_time?: number;
    end_time?: number;
    output_format: AudioTrimFormat;
  };
}

export function audioTrimNodeId(jobId: string | number): string {
  return `${AUDIO_TRIM_NODE_PREFIX}${jobId}`;
}

export function isAudioTrimNodeId(id: string): boolean {
  return id.startsWith(AUDIO_TRIM_NODE_PREFIX);
}

export function audioTrimDisplayName(
  sourceFileName: unknown,
  format: AudioTrimFormat,
): string {
  const name = typeof sourceFileName === 'string' ? sourceFileName.trim() : '';
  if (!name) return `音频截取.${format}`;
  return `${name.replace(/\.[^./]+$/, '')}(截取).${format}`;
}

export function buildAudioTrimPlaceholderNode(input: {
  jobId: string | number;
  outputFormat: AudioTrimFormat;
  timeParams: { start_time?: number; end_time?: number };
  sourceAssetId?: string | number | null;
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
  const sourceAssetId = input.sourceAssetId != null ? String(input.sourceAssetId) : '';
  const left = Number.isFinite(x) ? x : 0;
  const top = Number.isFinite(y) ? y : 0;
  return {
    id: audioTrimNodeId(input.jobId),
    type: 'mediaNode',
    position: {
      x: Math.round(left + box.width + AUDIO_TRIM_NODE_GAP),
      y: Math.round(top),
    },
    data: {
      src: '',
      fileName: audioTrimDisplayName(data.fileName, input.outputFormat),
      mediaType: 'audio',
      genStatus: 'generating',
      progress: 0,
      jobId: input.jobId,
      toolMode: 'select',
      ...(sourceAssetId
        ? {
            audioTrim: {
              sourceAssetId,
              lastInput: {
                source_asset_id: sourceAssetId,
                ...(input.timeParams.start_time !== undefined
                  ? { start_time: input.timeParams.start_time }
                  : {}),
                ...(input.timeParams.end_time !== undefined
                  ? { end_time: input.timeParams.end_time }
                  : {}),
                output_format: input.outputFormat,
              },
            },
          }
        : {}),
    },
  };
}

const ERROR_CODE_TEXT: Record<string, string> = {
  audio_trim_failed: '音频截取失败，请重试',
  source_asset_unavailable: '源音频资产不可用，请刷新画布后重试',
  enqueue_failed: '任务入队失败，请重试',
};

export function audioTrimErrorText(
  error?: { code?: string | number; message?: string; msg?: string } | null,
): string {
  const text = readJobFailText(error);
  if (text) return text;
  if (error?.code != null && ERROR_CODE_TEXT[String(error.code)]) {
    return ERROR_CODE_TEXT[String(error.code)];
  }
  return '音频截取失败';
}

export function audioTrimTerminalPatch(
  detail: {
    status: string;
    asset?: { id?: string; url?: string; duration?: number | null } | null;
    error?: { code?: string | number; message?: string; msg?: string } | null;
  },
  currentFileName?: string,
): Record<string, unknown> | null {
  if (detail.status === 'succeeded') {
    return {
      genStatus: undefined,
      progress: 100,
      src: detail.asset?.url ?? '',
      mediaType: 'audio',
      ...(currentFileName ? { fileName: currentFileName } : {}),
      assetId: detail.asset?.id,
      ...(detail.asset?.duration != null ? { duration: detail.asset.duration } : {}),
    };
  }
  if (detail.status === 'failed') {
    return {
      genStatus: 'failed',
      errorText: audioTrimErrorText(detail.error),
    };
  }
  if (detail.status === 'cancelled') {
    return { genStatus: 'cancelled' };
  }
  return null;
}
