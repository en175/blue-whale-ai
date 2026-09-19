import { readJobFailText } from '@/api/jobs';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';
import { AUDIO_VIDEO_SPLIT_DEFAULT_FORMAT, type AudioVideoSplitFormat } from './audioVideoSplit';

/** 音视频分离占位节点 id 前缀：`media-extract-{jobId}`。 */
export const MEDIA_EXTRACT_NODE_PREFIX = 'media-extract-';

/** 音频节点与源视频节点右边缘的间距（沿用既有「节点宽 + 60」口径里的 60）。 */
export const MEDIA_EXTRACT_NODE_GAP = 60;

/** 提取来源边标记（写在 edge.data.origin）：这条边表达「该音频取自那段视频」，
 *  是来源记录而非生成参考输入——参考推导（audioMediaRefsOf）会跳过带此标记的边，
 *  否则音频卡重新编辑时会把这个视频当成非法音频参考，卡住发送。 */
export const MEDIA_EXTRACT_EDGE_ORIGIN = 'media-extract';

/** 音频分离结果卡身份标记（node.data.mediaExtract，IKH28X，形态对齐 VideoSubtitleEraseIdentity）：
 *  失败重试按 lastInput（源素材 + 所选格式）原样重发创建接口。 */
export interface MediaExtractIdentity {
  /** 源素材身份（assetId 归一字符串）：提交冻结 source_asset_id */
  sourceAssetId: string;
  /** 上次提交参数；失败重试原样重发（格式随任务冻结，不做跨会话记忆） */
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

/** 音频展示名：视频文件名去扩展名 + "(audio)" + 所选格式后缀
 *  （如 测试视频.mp4 + wav → 测试视频(audio).wav；后缀跟随 output_format，不再恒 .mp3）。 */
export function audioDisplayName(
  videoFileName: unknown,
  format: AudioVideoSplitFormat = AUDIO_VIDEO_SPLIT_DEFAULT_FORMAT,
): string {
  const name = typeof videoFileName === 'string' ? videoFileName.trim() : '';
  if (!name) return `音视频分离(audio).${format}`;
  return `${name.replace(/\.[^./]+$/, '')}(audio).${format}`;
}

/** 音视频分离占位节点（IKFS5W 建、IKH28X 随编辑态发送闭环参数化）：发送后本地插入源视频
 *  节点右侧，genStatus=generating + jobId + mediaExtract 身份（失败重试原样重发），后续由
 *  轮询终态补丁收敛、自动保存落库——画布只由前端写，服务端与 worker 不再回写。
 *  横向位置按**源节点实际内容宽**（视频 280×比例，16:9 约 498）让开一格，不再固定 340 压住源节点。 */
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
      // 身份标记：仅 sourceAssetId 已知时携带（失败重试按 lastInput 原样重发；形态同家族 lastInput 先例）
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

/** 提取任务终态的本地节点补丁；进行中返回 null，调用方继续轮询。
 *  只写展示与播放必需字段：mime/size 是下载文件名与详情面板的兜底（blob.type / 资产详情优先），
 *  duration 由浏览器实测补齐（handleMediaDims），故不再像旧的 worker 回写那样写入——改动前先确认消费方。 */
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
