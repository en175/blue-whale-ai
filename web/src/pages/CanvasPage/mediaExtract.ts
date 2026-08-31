import { readJobFailText } from '@/api/jobs';

/** 后端注入的提取音频占位节点 id 前缀：`media-extract-{jobId}`。 */
export const MEDIA_EXTRACT_NODE_PREFIX = 'media-extract-';

const ERROR_CODE_TEXT: Record<string, string> = {
  video_has_no_audio_track: '视频没有音轨',
  video_download_failed: '视频下载失败',
  video_too_large: '视频超过大小上限',
  extract_failed: '音频提取失败',
  media_extract_failed: '音频提取失败',
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

export function snapshotHasMediaExtractNode(
  nodes: Array<{ id?: string } | null | undefined>,
  jobId: string | number,
): boolean {
  const nodeId = mediaExtractNodeId(jobId);
  return nodes.some((node) => node?.id === nodeId);
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

/** 提取任务终态的本地节点补丁；进行中返回 null，调用方继续轮询。 */
export function mediaExtractTerminalPatch(
  detail: {
    status: string;
    asset?: { id?: string; url?: string } | null;
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
