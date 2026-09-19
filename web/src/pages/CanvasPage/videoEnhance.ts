/* ============================================
 * 视频 HD 高清（IKH3VG）：视频卡工具条「HD」文字徽标入口的门槛预检、HD 卡身份标记
 * 与来源边常量。枚举、默认档与输入门槛常量复用 backend/libs/contracts/video-enhance.ts
 * （web 经 @lib/contracts 引入，先例见 imageEnhance.ts / videoSubtitleErase.ts 契约同源）；
 * 权威口径 = 根 CONTEXT.md「画布视频 HD 高清」三词条 + ADR-0105（面板极简骨架、
 * 建卡与会话形态照抄图片高清放大、发送任务接通归下一票 IKH3VH）。
 * ============================================ */
import {
  VIDEO_ENHANCE_DEFAULT_RESOLUTION,
  VIDEO_ENHANCE_INPUT_KEYS,
  VIDEO_ENHANCE_MAX_INPUT_LONG_SIDE_PX,
  VIDEO_ENHANCE_MAX_INPUT_SHORT_SIDE_PX,
  VIDEO_ENHANCE_MIN_INPUT_SHORT_SIDE_PX,
  VIDEO_ENHANCE_RESOLUTIONS,
  videoEnhanceInputSchema,
  type VideoEnhanceInput,
  type VideoEnhanceResolution,
} from '@lib/contracts/video-enhance';
import { readJobFailText } from '@/api/jobs';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';

/** HD 来源边标记（写在 edge.data.origin）：这条边表达「HD 卡由该视频增强而来」，
 *  是来源记录而非生成参考输入——参考推导与 @ 编号跳过带此标记的边（口径同
 *  IMAGE_ENHANCE_EDGE_ORIGIN / mediaExtract 来源边）。 */
export const VIDEO_ENHANCE_EDGE_ORIGIN = 'video-enhance';

/** HD 卡与源卡的横向间距（沿用既有「节点宽 + 60」口径） */
const VIDEO_ENHANCE_NODE_GAP = 60;

/** HD 身份标记（node.data.videoEnhance）：HD 卡的「重新编辑」与点卡重开据此分流到
 *  HD 面板（不进视频生成面板）；lastParams 随分辨率切换即时写卡持久化。 */
export interface VideoEnhanceIdentity {
  /** 源素材身份（assetId 归一字符串）：提交冻结 source_asset_id 与面板回填共用 */
  sourceAssetId?: string;
  /** 上次参数（resolution 单键，契约形态；切换即时生效写入，关闭/重开/重新编辑恢复） */
  lastParams?: Record<string, unknown>;
}

/** 分辨率展示名（仅 UI，不落库不进任务——出站透传 API 原生值 1080p/2k/4k）。 */
export const VIDEO_ENHANCE_RESOLUTION_LABELS: Record<VideoEnhanceResolution, string> = {
  '1080p': '1080P',
  '2k': '2K',
  '4k': '4K',
};

/** HD 草稿卡出生位：源卡右侧让开一格（按源卡实际内容宽，口径同 imageEnhanceDraftPosition）。 */
export function videoEnhanceDraftPosition(source: {
  position?: { x?: number; y?: number };
  data?: Record<string, unknown>;
}): { x: number; y: number } {
  const x = Number(source.position?.x ?? 0);
  const y = Number(source.position?.y ?? 0);
  const data = source.data ?? {};
  const box = mediaContentBox({
    mediaType: data.mediaType as 'image' | 'video' | 'audio' | undefined,
    width: typeof data.width === 'number' ? data.width : undefined,
    height: typeof data.height === 'number' ? data.height : undefined,
    ratio: typeof data.targetRatio === 'string' ? data.targetRatio : undefined,
  });
  const left = Number.isFinite(x) ? x : 0;
  const top = Number.isFinite(y) ? y : 0;
  return {
    x: Math.round(left + box.width + VIDEO_ENHANCE_NODE_GAP),
    y: Math.round(top),
  };
}

/** 入口可用态悬停说明（效果边界）：固定源卡素材增强，输出最高 4K。
 *  置灰态与原因文案互斥（同一 title 通道，口径同 VIDEO_SUBTITLE_ERASE_ENTRY_HINT）。 */
export const VIDEO_ENHANCE_ENTRY_HINT = '提升视频清晰度，最高可至 4K';

/** 唯一资产置灰原因（未关联资产；口径同 AUDIO_VIDEO_SPLIT_MISSING_ASSET_REASON）。 */
export const VIDEO_ENHANCE_MISSING_ASSET_REASON = '当前视频尚未关联资产，无法高清增强';

/* ============ 门槛预检（契约常量同源，两端判定只此一份） ============ */

/** 门槛判定输入：与 MediaNode data 字段同名（width/height 像素，assetId 关联资产 id）。 */
export interface VideoEnhanceGateSource {
  width?: number;
  height?: number;
  assetId?: string | number | null;
}

/** 「HD」入口门槛预检（按钮置灰用）：返回不可用原因（悬停展示），null 为可用。
 *  置灰情形（契约 VIDEO_ENHANCE_MIN/MAX_INPUT_*_PX，官方「输入视频限制」短边 [360,1080]、
 *  长边 [360,1920]，短长边判定竖屏合法）：未关联资产置灰（最优先）→ 短/长边超上限
 *  （短边 >1080 或长边 >1920）→ 短边不足下限（<360，长边 ≥ 短边故无需单判）；
 *  宽高缺失（null，存量数据）放行不拦，SDR 无前置元数据不拦，均由任务失败口径兜底
 *  （ADR-0105）；服务端创建入口按权威数据同口径复核。 */
export function videoEnhanceGateReason(source: VideoEnhanceGateSource): string | null {
  if (source.assetId == null) return VIDEO_ENHANCE_MISSING_ASSET_REASON;
  const { width, height } = source;
  if (typeof width === 'number' && typeof height === 'number') {
    const longSide = Math.max(width, height);
    const shortSide = Math.min(width, height);
    if (
      longSide > VIDEO_ENHANCE_MAX_INPUT_LONG_SIDE_PX
      || shortSide > VIDEO_ENHANCE_MAX_INPUT_SHORT_SIDE_PX
    ) {
      return `视频长边超过 ${VIDEO_ENHANCE_MAX_INPUT_LONG_SIDE_PX} 或短边超过 ${VIDEO_ENHANCE_MAX_INPUT_SHORT_SIDE_PX}（超出输入上限），无法高清增强`;
    }
    if (shortSide < VIDEO_ENHANCE_MIN_INPUT_SHORT_SIDE_PX) {
      return `视频短边小于 ${VIDEO_ENHANCE_MIN_INPUT_SHORT_SIDE_PX}（低于输入下限），无法高清增强`;
    }
  }
  return null;
}

/* ============ 面板参数域（分辨率单键，极简骨架 ADR-0105） ============ */

/** 从 lastParams（契约单键形态）恢复面板分辨率；缺键/非法值回落契约默认档 1080p
 *  （VIDEO_ENHANCE_DEFAULT_RESOLUTION 为产品默认档单源）。 */
export function restoreVideoEnhanceResolution(
  lastParams: Record<string, unknown> | undefined,
): VideoEnhanceResolution {
  const resolution = lastParams?.resolution;
  return (VIDEO_ENHANCE_RESOLUTIONS as readonly string[]).includes(resolution as string)
    ? (resolution as VideoEnhanceResolution)
    : VIDEO_ENHANCE_DEFAULT_RESOLUTION;
}

/* ============ 发送闭环（IKH3VH）：契约三键组装与失败文案家族映射 ============ */

/** 组装 HD 任务创建契约三键（IKH3VH，先例 buildImageEnhanceInput）：source_asset_id 冻结自
 *  HD 身份、target_node_id=HD 卡节点 id、resolution 面板所选档；过契约 zod strict 校验，
 *  非法（如资产 id 非数字串）返回 null 由调用方守卫提示。 */
export function buildVideoEnhanceInput(
  sourceAssetId: string,
  targetNodeId: string,
  resolution: VideoEnhanceResolution,
): VideoEnhanceInput | null {
  const input = {
    [VIDEO_ENHANCE_INPUT_KEYS.sourceAssetId]: sourceAssetId,
    [VIDEO_ENHANCE_INPUT_KEYS.targetNodeId]: targetNodeId,
    [VIDEO_ENHANCE_INPUT_KEYS.resolution]: resolution,
  };
  return videoEnhanceInputSchema.safeParse(input).success ? (input as VideoEnhanceInput) : null;
}

/** HD 失败文案家族映射（口径同 mediaExtractErrorText）：后端 msg 优先；msg 为空时按错误码
 *  兜底——video_enhance_failed / 1045（含 SDR 限制、短长边超限等供应商拒绝场景，契约执行面
 *  统一归并）→「视频画质增强失败，请重试」，入队失败同款兜底；再兜同句防空白失败态。 */
const VIDEO_ENHANCE_ERROR_CODE_TEXT: Record<string, string> = {
  video_enhance_failed: '视频画质增强失败，请重试',
  '1045': '视频画质增强失败，请重试',
  enqueue_failed: '任务入队失败，请重试',
};

export function videoEnhanceErrorText(
  error?: { code?: string | number; message?: string; msg?: string } | null,
): string {
  const text = readJobFailText(error);
  if (text) return text;
  if (error?.code != null && VIDEO_ENHANCE_ERROR_CODE_TEXT[String(error.code)]) {
    return VIDEO_ENHANCE_ERROR_CODE_TEXT[String(error.code)];
  }
  return '视频画质增强失败，请重试';
}
