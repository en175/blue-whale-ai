import { readJobFailText } from '@/api/jobs';

/** 提取音频占位节点 id 前缀：`media-extract-{jobId}`。 */
export const MEDIA_EXTRACT_NODE_PREFIX = 'media-extract-';

/** 占位音频节点相对源视频节点的横向偏移（节点宽约 280 + 间距）。 */
export const MEDIA_EXTRACT_NODE_OFFSET = 340;

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

/** 音频展示名：视频文件名去扩展名 + "(audio)"（如 测试视频.mp4 → 测试视频(audio).mp3）。 */
export function audioDisplayName(videoFileName: unknown): string {
  const name = typeof videoFileName === 'string' ? videoFileName.trim() : '';
  if (!name) return '提取音频(audio).mp3';
  return `${name.replace(/\.[^./]+$/, '')}(audio).mp3`;
}

/** 提取音频占位节点（IKFS5W）：建任务前本地插入源视频节点右侧，genStatus=generating + jobId，
 *  后续由轮询终态补丁收敛、自动保存落库——画布只由前端写，服务端与 worker 不再回写。 */
export function buildMediaExtractPlaceholderNode(input: {
  jobId: string | number;
  source?: { position?: { x?: number; y?: number }; data?: Record<string, unknown> } | null;
}): {
  id: string;
  type: 'mediaNode';
  position: { x: number; y: number };
  data: Record<string, unknown>;
} {
  const x = Number(input.source?.position?.x ?? 0);
  const y = Number(input.source?.position?.y ?? 0);
  return {
    id: mediaExtractNodeId(input.jobId),
    type: 'mediaNode',
    position: {
      x: Math.round(Number.isFinite(x) ? x + MEDIA_EXTRACT_NODE_OFFSET : MEDIA_EXTRACT_NODE_OFFSET),
      y: Math.round(Number.isFinite(y) ? y : 0),
    },
    data: {
      src: '',
      fileName: audioDisplayName(input.source?.data?.fileName),
      mediaType: 'audio',
      genStatus: 'generating',
      progress: 0,
      jobId: input.jobId,
      toolMode: 'select',
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
