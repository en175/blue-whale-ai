/* ============================================
 * 音频调速（IKHW5C 入口门槛 / IKHW5S 编辑态与发送闭环，父单 IKHVYO）：纯逻辑，
 * 无 React 依赖。音频 URL 或资产 ID 缺失即置灰；与截取门槛的差异只在时长条件，
 * 调速编辑态无选区、时间折算不硬依赖
 * 时长，时长缺失不拦（用户故事 4）。占位卡/终态补丁/身份重试/错误文案形状
 * 对齐 audioTrim.ts（一对一「单占位卡→原地补丁成品卡」同族）。
 * 滑杆位置↔倍速映射（posToSpeed/speedToPos）与提交参数构造（贴原速省略/两位
 * 小数）在契约 @lib/contracts/audio-speed 单源收口（父单实现决策 3），本文件
 * 与发送条只引用不复制。
 * ============================================ */
import { readJobFailText } from '@/api/jobs';
import {
  AUDIO_SPEED_OUTPUT_FORMAT,
  buildAudioSpeedInput,
  type AudioSpeedInput,
} from '@lib/contracts/audio-speed';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';
import { readAssetId } from './mediaRefs';

/** 唯一置灰原因（工单拍板文案：URL 缺失各情形共用一句） */
export const AUDIO_SPEED_UNAVAILABLE_REASON = '音频不可用，无法调速';

/** 门槛判定输入：与 MediaNode data 字段同名（src 音频 URL）。 */
export interface AudioSpeedGateSource {
  src?: string | null;
  assetId?: unknown;
  asset_id?: unknown;
  assetID?: unknown;
}

/** 音频卡「调速」入口门槛预检（按钮置灰用）：返回不可用原因（悬停展示），null 为可用。
 *  置灰条件 = 音频 URL 或资产 ID 缺失；资产 ID 与发送守卫共用 readAssetId。
 *  时长不参与判定（用户故事 4：无截取那样的时长门槛，调速编辑态无选区、
 *  时间折算不硬依赖时长）。 */
export function audioSpeedGateReason(source: AudioSpeedGateSource): string | null {
  if (!source.src || !readAssetId({
    assetId: source.assetId,
    asset_id: source.asset_id,
    assetID: source.assetID,
  })) return AUDIO_SPEED_UNAVAILABLE_REASON;
  return null;
}

/* ============ 产物格式与倍速标签（IKHW5S） ============ */

/** 调速产物展示格式：契约 @lib/contracts/audio-speed 单源常量（官方 CLI 参考文档
 *  format 节「默认 m4a」；本产品不传 format，产物格式跟随官方默认输出）。占位卡与
 *  成品命名后缀默认用本值，成功终态补丁按可得的真实格式（产物 URL 末段扩展名）
 *  校正（见 audioSpeedSettledFileName）；此处 re-export 供 web 消费方引用不复制。 */
export { AUDIO_SPEED_OUTPUT_FORMAT };

/** 倍速展示标签（两位小数 + x，如 1.5 → "1.50x"；发送条当前值/占位卡命名/失败
 *  重试钮共用一个格式化口径）。 */
export function audioSpeedLabel(speed: number): string {
  return `${speed.toFixed(2)}x`;
}

/** 调速产物展示名：源文件名去扩展名 + "(调速{值}x)" + 官方默认输出格式后缀
 *  （如 播客片头.mp3 + 1.35 → 播客片头(调速1.35x).m4a；空名/无名字段有兜底；
 *  形状对齐 audioTrimDisplayName，差异只在调速无用户所选格式——跟随官方输出）。 */
export function audioSpeedDisplayName(sourceFileName: unknown, speed: number): string {
  const name = typeof sourceFileName === 'string' ? sourceFileName.trim() : '';
  if (!name) return `音频调速.${AUDIO_SPEED_OUTPUT_FORMAT}`;
  return `${name.replace(/\.[^./]+$/, '')}(调速${audioSpeedLabel(speed)}).${AUDIO_SPEED_OUTPUT_FORMAT}`;
}

/** 从产物 URL 末段取扩展名（审查修复 C：终态补丁「可得的产物真实格式」唯一渠道——
 *  GET /api/jobs/:id 的 asset 只投 { id, url, type }，无 mimeType/format 字段；url 是
 *  自家 TOS 公开读链接，worker 转存 storageKey 恒以 `.{格式}` 后缀结尾）。URL 无扩展
 *  名（裸 key / 仅 query / 以点开头或结尾）返回 null，调用方保持默认 m4a 后缀。 */
function extensionFromUrl(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url) return null;
  const lastSegment = url.split('?')[0].split('/').pop() ?? '';
  const dot = lastSegment.lastIndexOf('.');
  if (dot <= 0 || dot === lastSegment.length - 1) return null;
  return lastSegment.slice(dot + 1).toLowerCase();
}

/** 调速成品命名后缀校正（审查修复 C）：占位名默认 m4a 后缀，成功补丁按产物 URL
 *  末段真实扩展名替换（名实一致——上游转存格式变化时命名自动跟随）；URL 不可解析
 *  出扩展名时保持占位名（默认 m4a）。仅调速路径使用，截取家族命名由用户所选格式
 *  构造、无此校正。 */
export function audioSpeedSettledFileName(
  currentFileName: string,
  assetUrl: string | null | undefined,
): string {
  const ext = extensionFromUrl(assetUrl);
  if (!ext) return currentFileName;
  return `${currentFileName.replace(/\.[^./]+$/, '')}.${ext}`;
}

/* ============ 会话身份与占位卡（IKHW5S，audioTrim 同族先例） ============ */

/** 调速占位节点 id 前缀：`audio-speed-{jobId}`。 */
export const AUDIO_SPEED_NODE_PREFIX = 'audio-speed-';

/** 源音频卡与占位卡右边缘的间距（沿用「节点宽 + 60」家族口径的 60）。 */
export const AUDIO_SPEED_NODE_GAP = 60;

/** 调速来源边标记（写在 edge.data.origin，同 AUDIO_TRIM_EDGE_ORIGIN 先例）：
 *  这条边表达「调速成品卡由该音频变速而来」，是纯视觉来源记录而非生成参考输入——
 *  参考推导会跳过带此标记的边，源音频不占参考位、不参与 @ 编号与媒体索引
 *  （防参考污染：调速产物再次编辑时不把源音频当成非法/多余参考）。 */
export const AUDIO_SPEED_EDGE_ORIGIN = 'audio-speed';

/** 调速结果卡身份标记（node.data.audioSpeed，形态对齐 AudioTrimIdentity）：
 *  失败重试按 lastInput（源素材 + 倍速，贴原速省略形态原样保留）原样重发创建接口。 */
export interface AudioSpeedIdentity {
  /** 源素材身份（assetId 归一字符串）：提交冻结 source_asset_id */
  sourceAssetId: string;
  /** 上次提交参数（契约 buildAudioSpeedInput 构造：1.0 省略 speed 键）；
   *  失败重试原样重发（源与倍速随任务冻结，不做跨会话记忆） */
  lastInput: AudioSpeedInput;
}

export function audioSpeedNodeId(jobId: string | number): string {
  return `${AUDIO_SPEED_NODE_PREFIX}${jobId}`;
}

export function isAudioSpeedNodeId(id: string): boolean {
  return id.startsWith(AUDIO_SPEED_NODE_PREFIX);
}

/** 调速占位节点（IKHW5S，发送后本地插入源音频卡右侧 +60px；形态对齐
 *  buildAudioTrimPlaceholderNode）：genStatus=generating + jobId + audioSpeed 身份
 *  （失败重试原样重发），后续由轮询终态补丁收敛、自动保存落库——画布只由前端写。 */
export function buildAudioSpeedPlaceholderNode(input: {
  jobId: string | number;
  /** 所选倍速（命名与 lastInput 冻结共用；发送守卫保证正常流程 ≠ 1，重试等路径
   *  1.0 时 lastInput 由契约构造省略 speed 键） */
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
      // 身份标记：仅 sourceAssetId 已知时携带（失败重试按 lastInput 原样重发；
      // 贴原速省略的可选键在冻结 input 里原样保留）
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

/** 调速失败可读文案（1051 audio_speed_failed 兜底码归并口径见契约 audio-speed.ts
 *  头注；上游可读原因随 message 透传优先）。 */
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

/** 调速任务终态的本地节点补丁（形态对齐 audioTrimTerminalPatch）；进行中返回 null，
 *  调用方继续轮询。成功只写展示与播放必需字段；duration 用服务端权威值（火山返回
 *  duration 经轮询产物回填，「权威时长以火山返回为准」，不取本地折算秒数）；fileName
 *  按产物 URL 真实扩展名校正后缀（审查修复 C，默认 m4a 占位名的名实一致收口）。 */
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
