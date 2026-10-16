import { readJobFailText } from '@/custom/api/jobs';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';
import { AUDIO_VIDEO_SPLIT_DEFAULT_FORMAT, type AudioVideoSplitFormat } from './tools/audio/audioVideoSplit';

export const MEDIA_EXTRACT_NODE_PREFIX = 'media-extract-';

export const MEDIA_EXTRACT_NODE_GAP = 60;

export const MEDIA_EXTRACT_EDGE_ORIGIN = 'media-extract';

export interface MediaExtractIdentity {
  sourceAssetId: string;
  lastInput: { source_asset_id: string; output_format: AudioVideoSplitFormat };
}

const ERROR_CODE_TEXT: Record<string, string> = {
  video_has_no_audio_track: '视频没有音轨',
  video_download_failed: '视频下载失败',
  video_too_large: '视频超过大小上限',
  extract_failed: '音频提取失败',
  media_extract_failed: '音频提取失败',
  media_extract_provider_failed: '音频提取失败，请重试',
  upload_failed: '音频上传失败',
  source_asset_unavailable: '源视频资产不可用，请刷新画布后重试',
  enqueue_failed: '任务入队失败，请重试',
};

export function mediaExtractNodeId(jobId: string | number): string {
  return `${MEDIA_EXTRACT_NODE_PREFIX}${jobId}`;
}

export function isMediaExtractNodeId(id: string): boolean {
  return id.startsWith(MEDIA_EXTRACT_NODE_PREFIX);
}

export function audioDisplayName(
  videoFileName: unknown,
  format: AudioVideoSplitFormat = AUDIO_VIDEO_SPLIT_DEFAULT_FORMAT,
): string {
  const name = typeof videoFileName === 'string' ? videoFileName.trim() : '';
  if (!name) return `音视频分离(audio).${format}`;
  return `${name.replace(/\.[^./]+$/, '')}(audio).${format}`;
}

export function buildMediaExtractPlaceholderNode(input: {
  jobId: string | number;
  outputFormat?: AudioVideoSplitFormat;
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
  const format = input.outputFormat ?? AUDIO_VIDEO_SPLIT_DEFAULT_FORMAT;
  const sourceAssetId =
    input.sourceAssetId != null ? String(input.sourceAssetId) : '';
  const left = Number.isFinite(x) ? x : 0;
  const top = Number.isFinite(y) ? y : 0;
  return {
    id: mediaExtractNodeId(input.jobId),
    type: 'mediaNode',
    position: {
      x: Math.round(left + box.width + MEDIA_EXTRACT_NODE_GAP),
      y: Math.round(top),
    },
    data: {
      src: '',
      fileName: audioDisplayName(data.fileName, format),
      mediaType: 'audio',
      genStatus: 'generating',
      progress: 0,
      jobId: input.jobId,
      toolMode: 'select',
      ...(sourceAssetId
        ? { mediaExtract: { sourceAssetId, lastInput: { source_asset_id: sourceAssetId, output_format: format } } }
        : {}),
    },
  };
}

export function mediaExtractErrorText(
  error?: { code?: string | number; message?: string; msg?: string } | null,
): string {
  const text = readJobFailText(error);
  if (text) return text;
  if (error?.code != null && ERROR_CODE_TEXT[String(error.code)]) {
    return ERROR_CODE_TEXT[String(error.code)];
  }
  return '音频提取失败';
}

export function mediaExtractTerminalPatch(
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
      errorText: mediaExtractErrorText(detail.error),
    };
  }
  if (detail.status === 'cancelled') {
    return { genStatus: 'cancelled' };
  }
  return null;
}
