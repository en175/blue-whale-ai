/* ============================================
 * 音频截取（IKHB6Y 入口门槛 / IKHB7A 编辑态与发送闭环，父单 IKHB08）：纯逻辑，无
 * React 依赖。门槛形状对齐 audioVideoSplit.ts 先例；占位卡/终态补丁/身份重试形状
 * 对齐 mediaExtract.ts 先例（一对一「单占位卡→原地补丁成品卡」同族）。与家族「数据
 * 缺失不拦（null 放行，后端权威复核）」口径不同：截取编辑态的手柄时间换算硬性依赖
 * 音频时长，URL/时长缺失即置灰前置拦截。
 * 提交参数换算（贴边省略/两位小数/默认格式推导）在契约 @lib/contracts/audio-trim，
 * 本文件引用不复制；遮罩交互几何在 audioTrimGeometry.ts。
 * ============================================ */
import { readJobFailText } from '@/api/jobs';
import {
  AUDIO_TRIM_FALLBACK_OUTPUT_FORMAT,
  AUDIO_TRIM_OUTPUT_FORMATS,
  type AudioTrimOutputFormat,
} from '@lib/contracts/audio-trim';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';

/** 唯一置灰原因（IKHB6Y 工单拍板文案：URL 缺失与时长缺失/为 0 共用一句） */
export const AUDIO_TRIM_MISSING_DURATION_REASON = '音频时长缺失，无法截取';

/** 门槛判定输入：与 MediaNode data 字段同名（src 音频 URL、duration 时长秒）。 */
export interface AudioTrimGateSource {
  src?: string | null;
  duration?: number | null;
}

/** 音频卡「截取」入口门槛预检（按钮置灰用）：返回不可用原因（悬停展示），null 为可用。
 *  置灰条件 = 音频 URL 缺失，或时长缺失/非正——不照搬家族「数据缺失不拦」口径，
 *  截取手柄时间换算硬性依赖时长，缺失即拦。 */
export function audioTrimGateReason(source: AudioTrimGateSource): string | null {
  if (!source.src) return AUDIO_TRIM_MISSING_DURATION_REASON;
  if (!(typeof source.duration === 'number' && source.duration > 0)) {
    return AUDIO_TRIM_MISSING_DURATION_REASON;
  }
  return null;
}

/* ============ 截取输出格式（契约同源引用，出处见契约头注释） ============ */

// 契约常量再导出供发送条/占位卡消费（对齐 audioVideoSplit.ts 再导出先例）。
export const AUDIO_TRIM_FORMATS = AUDIO_TRIM_OUTPUT_FORMATS;
export type AudioTrimFormat = AudioTrimOutputFormat;
export const AUDIO_TRIM_FALLBACK_FORMAT = AUDIO_TRIM_FALLBACK_OUTPUT_FORMAT;

/* ============ 会话身份与占位卡（IKHB7A，mediaExtract.ts 同族先例） ============ */

/** 截取占位节点 id 前缀：`audio-trim-{jobId}`。 */
export const AUDIO_TRIM_NODE_PREFIX = 'audio-trim-';

/** 源音频卡与占位卡右边缘的间距（沿用「节点宽 + 60」家族口径的 60）。 */
export const AUDIO_TRIM_NODE_GAP = 60;

/** 截取来源边标记（写在 edge.data.origin，模式同 MEDIA_EXTRACT_EDGE_ORIGIN）：
 *  这条边表达「截取结果卡由该音频截取而来」，是纯视觉来源记录而非生成参考输入——
 *  参考推导会跳过带此标记的边，源音频不占参考位、不参与 @ 编号与媒体索引
 *  （防参考污染：截取产物再次编辑时不把源音频当成非法/多余参考）。 */
export const AUDIO_TRIM_EDGE_ORIGIN = 'audio-trim';

/** 截取结果卡身份标记（node.data.audioTrim，形态对齐 MediaExtractIdentity）：
 *  失败重试按 lastInput（源素材 + 起止 + 格式）原样重发创建接口。 */
export interface AudioTrimIdentity {
  /** 源素材身份（assetId 归一字符串）：提交冻结 source_asset_id */
  sourceAssetId: string;
  /** 上次提交参数（贴边省略形态：start_time/end_time 可选键随冻结 input 原样保留）；
   *  失败重试原样重发（起止与格式随任务冻结，不做跨会话记忆） */
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

/** 截取产物展示名：源文件名去扩展名 + "(截取)" + 所选格式后缀
 *  （如 播客片头.mp3 + wav → 播客片头(截取).wav；空名/无名字段有兜底）。 */
export function audioTrimDisplayName(
  sourceFileName: unknown,
  format: AudioTrimFormat,
): string {
  const name = typeof sourceFileName === 'string' ? sourceFileName.trim() : '';
  if (!name) return `音频截取(截取).${format}`;
  return `${name.replace(/\.[^./]+$/, '')}(截取).${format}`;
}

/** 截取占位节点（IKHB7A，发送后本地插入源音频卡右侧 +60px；形态对齐
 *  buildMediaExtractPlaceholderNode）：genStatus=generating + jobId + audioTrim 身份
 *  （失败重试原样重发），后续由轮询终态补丁收敛、自动保存落库——画布只由前端写。 */
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
      // 身份标记：仅 sourceAssetId 已知时携带（失败重试按 lastInput 原样重发；
      // 贴边省略的可选键在冻结 input 里原样保留）
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

/** 截取任务终态的本地节点补丁（形态对齐 mediaExtractTerminalPatch）；进行中返回 null，
 *  调用方继续轮询。成功只写展示与播放必需字段；duration 用服务端权威值（火山返回
 *  duration 经轮询产物回填，ADR-0111「权威时长以火山返回为准」，不取本地选区秒数）。 */
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
