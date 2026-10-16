import { readJobFailText } from '@/custom/api/jobs';
import {
  AUDIO_SPEED_OUTPUT_FORMAT,
  buildAudioSpeedInput,
  type AudioSpeedInput,
} from '@lib/contracts/audio-speed';
import { mediaContentBox } from '../../components/MediaNode/mediaContentSize';
import { readAssetId } from '../../mediaRefs';

export const AUDIO_SPEED_UNAVAILABLE_REASON = '音频不可用，无法调速';

export interface AudioSpeedGateSource {
  src?: string | null;
  assetId?: unknown;
  asset_id?: unknown;
  assetID?: unknown;
}

export function audioSpeedGateReason(source: AudioSpeedGateSource): string | null {
  if (!source.src || !readAssetId({
    assetId: source.assetId,
    asset_id: source.asset_id,
    assetID: source.assetID,
  })) return AUDIO_SPEED_UNAVAILABLE_REASON;
  return null;
}


export { AUDIO_SPEED_OUTPUT_FORMAT };

export function audioSpeedLabel(speed: number): string {
  return `${speed.toFixed(2)}x`;
}

export function audioSpeedDisplayName(sourceFileName: unknown, speed: number): string {
  const name = typeof sourceFileName === 'string' ? sourceFileName.trim() : '';
  if (!name) return `音频调速.${AUDIO_SPEED_OUTPUT_FORMAT}`;
  return `${name.replace(/\.[^./]+$/, '')}(调速${audioSpeedLabel(speed)}).${AUDIO_SPEED_OUTPUT_FORMAT}`;
}

function extensionFromUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url) return null;
  const lastSegment = url.split('?')[0].split('/').pop() ?? '';
  const dot = lastSegment.lastIndexOf('.');
  if (dot <= 0 || dot === lastSegment.length - 1) return null;
  return lastSegment.slice(dot + 1).toLowerCase();
}

export function audioSpeedSettledFileName(
  currentFileName: string,
  assetUrl: string | null | undefined,
): string {
  const ext = extensionFromUrl(assetUrl);
  if (!ext) return currentFileName;
  return `${currentFileName.replace(/\.[^./]+$/, '')}.${ext}`;
}


export const AUDIO_SPEED_NODE_PREFIX = 'audio-speed-';

export const AUDIO_SPEED_NODE_GAP = 60;

export const AUDIO_SPEED_EDGE_ORIGIN = 'audio-speed';

export interface AudioSpeedIdentity {
  sourceAssetId: string;
  lastInput: AudioSpeedInput;
}

export function audioSpeedNodeId(jobId: string | number): string {
  return `${AUDIO_SPEED_NODE_PREFIX}${jobId}`;
}

export function isAudioSpeedNodeId(id: string): boolean {
  return id.startsWith(AUDIO_SPEED_NODE_PREFIX);
}

export function buildAudioSpeedPlaceholderNode(input: {
  jobId: string | number;
  speed: number;
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
    id: audioSpeedNodeId(input.jobId),
    type: 'mediaNode',
    position: {
      x: Math.round(left + box.width + AUDIO_SPEED_NODE_GAP),
      y: Math.round(top),
    },
    data: {
      src: '',
      fileName: audioSpeedDisplayName(data.fileName, input.speed),
      mediaType: 'audio',
      genStatus: 'generating',
      progress: 0,
      jobId: input.jobId,
      toolMode: 'select',
      ...(sourceAssetId
        ? {
            audioSpeed: {
              sourceAssetId,
              lastInput: buildAudioSpeedInput({ sourceAssetId, speed: input.speed }),
            },
          }
        : {}),
    },
  };
}

const ERROR_CODE_TEXT: Record<string, string> = {
  audio_speed_failed: '音频调速失败，请重试',
  source_asset_unavailable: '源音频资产不可用，请刷新画布后重试',
  enqueue_failed: '任务入队失败，请重试',
};

export function audioSpeedErrorText(
  error?: { code?: string | number; message?: string; msg?: string } | null,
): string {
  const text = readJobFailText(error);
  if (text) return text;
  if (error?.code != null && ERROR_CODE_TEXT[String(error.code)]) {
    return ERROR_CODE_TEXT[String(error.code)];
  }
  return '音频调速失败';
}

export function audioSpeedTerminalPatch(
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
      ...(currentFileName
        ? { fileName: audioSpeedSettledFileName(currentFileName, detail.asset?.url) }
        : {}),
      assetId: detail.asset?.id,
      ...(detail.asset?.duration != null ? { duration: detail.asset.duration } : {}),
    };
  }
  if (detail.status === 'failed') {
    return {
      genStatus: 'failed',
      errorText: audioSpeedErrorText(detail.error),
    };
  }
  if (detail.status === 'cancelled') {
    return { genStatus: 'cancelled' };
  }
  return null;
}
