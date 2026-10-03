/* ============================================
 * 视频插帧（IKHLKR，父需求 IKHLES）：视频卡「高清 ▾」下拉第二项的入口门槛、草稿卡身份、
 * 卡名纯函数与提交契约组装（纯逻辑，无 React 依赖，形状对齐 videoEnhance.ts 先例）。
 * 帧率三档、默认档、input 键名与校验 schema 全部经 @lib/contracts/video-frame-interpolation
 * 与契约同源（不另造常量）；权威口径 = 根 GLOSSARY.md「画布视频插帧」词条组 + ADR-0113。
 * 本票只交付建卡、草稿配置与持久化恢复；实际发送、轮询与失败重试归后续票 IKHLKX。
 * ============================================ */
import {
  VIDEO_FRAME_INTERPOLATION_DEFAULT_FPS,
  VIDEO_FRAME_INTERPOLATION_FPS_VALUES,
  VIDEO_FRAME_INTERPOLATION_INPUT_KEYS,
  videoFrameInterpolationInputSchema,
  type VideoFrameInterpolationFps,
  type VideoFrameInterpolationInput,
} from '@lib/contracts/video-frame-interpolation';
import { readJobFailText } from '@/api/jobs';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';
import { VIDEO_ENHANCE_MISSING_ASSET_REASON } from './videoEnhance';

/** 插帧来源边标记（写在 edge.data.origin）：这条边表达「插帧卡由该视频插帧而来」，
 *  是来源记录而非生成参考输入——参考推导与 @ 编号跳过带此标记的边（口径同
 *  VIDEO_ENHANCE_EDGE_ORIGIN / SCENE_SPLIT_EDGE_ORIGIN）。 */
export const FRAME_INTERPOLATION_EDGE_ORIGIN = 'frame-interpolation';

/** 「插帧」菜单项悬停说明（效果边界，父单指定对客文案）。 */
export const FRAME_INTERPOLATION_ENTRY_HINT = '提升视频帧率，画面更流畅';

/** 插帧草稿卡占位文案（父单指定对客文案，MediaNode renderPlaceholder 消费）。 */
export const FRAME_INTERPOLATION_DRAFT_HINT = '配置参数生成插帧视频';

/** 插帧面板发送钮可用态悬停说明（父单指定对客文案）。 */
export const FRAME_INTERPOLATION_SEND_HINT = '智能补帧，最高可至 120fps';

/** 帧率三档（契约同源再导出）：面板分段按钮与任务参数共用同一枚举，前端不另造数值。 */
export const FRAME_INTERPOLATION_FPS_VALUES = VIDEO_FRAME_INTERPOLATION_FPS_VALUES;

export type FrameInterpolationFps = VideoFrameInterpolationFps;

/** 缺省帧率 60（契约默认档单源：面板初始选中、缺省恢复与草稿卡默认名同源）。 */
export const FRAME_INTERPOLATION_DEFAULT_FPS = VIDEO_FRAME_INTERPOLATION_DEFAULT_FPS;

/** 帧率档展示名（面板分段按钮文字，仅 UI 不进任务——出站透传契约整型 fps）。 */
export function frameInterpolationFpsLabel(fps: FrameInterpolationFps): string {
  return `${fps}fps`;
}

/** 草稿卡名（父单指定文案 + 场景切分式动态后缀）：随切档即时更新，所见即所得。 */
export function frameInterpolationDisplayName(fps: FrameInterpolationFps): string {
  return `插帧 · ${fps}fps`;
}

/** 插帧卡身份标记（node.data.frameInterpolation）：点卡重开插帧面板据此分流（不进视频生成
 *  面板）；lastParams 随帧率切换即时写卡持久化，关闭/重开/刷新后档位恢复同源。 */
export interface FrameInterpolationIdentity {
  /** 源素材身份（assetId 归一字符串）：提交冻结 source_asset_id 与面板回填共用 */
  sourceAssetId?: string;
  /** 面板编辑值（fps 单键，契约形态；切档即时写卡）——只反映用户当前面板选择，
   *  与「最后受理任务的冻结输入」分离（IKHSFH） */
  lastParams?: Record<string, unknown>;
  /** 最后受理任务的冻结输入（fps 单键，契约形态；创建成功受理时写入）——失败重试
   *  的权威来源：60fps 任务失败后面板改 120fps，重试仍按这里的 60fps 原样重发；
   *  面板主动发送新配置成功受理后才更新（IKHSFH）。旧持久化卡无此键，回落 lastParams */
  frozenParams?: Record<string, unknown>;
  /** IKJJR3：恢复查询失败标记（历史可信关联恢复的网络失败窗口）——冻结输入未能
   *  回填时阻止把面板编辑值当作受理参数重试（A.6 不猜参数）；查询成功/重进后清除。 */
  recoveryBlocked?: boolean;
}

/** 门槛判定输入：与 MediaNode data 字段同名（assetId 视频关联资产 id）。 */
export interface FrameInterpolationGateSource {
  assetId?: string | number | null;
}

/** 「插帧」入口门槛预检（整钮与菜单项共用同一判定）：唯一不可用情形 = 视频未关联资产
 *  （两功能公共交集，ADR-0113 决策三）。插帧不做任何额外前置——官方对该端点无时长与分辨率
 *  限制，源帧率本仓全链不可知（assets 表无 fps 列），官方「目标帧率不超过原片 4 倍」是建议
 *  非硬限，越界场景由任务失败文案兜底，故不新增时长/源帧率门槛。宽高与时长缺失一律放行。
 *  文案沿用既有 VIDEO_ENHANCE_MISSING_ASSET_REASON——整钮置灰原因与 HD 项同句（父单文本，
 *  不另造插帧专属措辞）。 */
export function frameInterpolationGateReason(source: FrameInterpolationGateSource): string | null {
  if (source.assetId == null) return VIDEO_ENHANCE_MISSING_ASSET_REASON;
  return null;
}

/** 插帧卡与源卡的横向间距（沿用既有「节点宽 + 60」口径，同 videoEnhanceDraftPosition）。 */
const FRAME_INTERPOLATION_NODE_GAP = 60;

/** 插帧草稿卡出生位：源卡右侧让开一格（按源卡实际内容宽，口径同 videoEnhanceDraftPosition）。 */
export function frameInterpolationDraftPosition(source: {
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
    x: Math.round(left + box.width + FRAME_INTERPOLATION_NODE_GAP),
    y: Math.round(top),
  };
}

/** 从 lastParams（契约单键形态）恢复面板帧率档；缺键/非法值回落契约默认档 60
 *  （VIDEO_FRAME_INTERPOLATION_DEFAULT_FPS 为产品默认档单源）。 */
export function restoreFrameInterpolationFps(
  lastParams: Record<string, unknown> | undefined,
): FrameInterpolationFps {
  const fps = lastParams?.fps;
  return (VIDEO_FRAME_INTERPOLATION_FPS_VALUES as readonly unknown[]).includes(fps)
    ? (fps as FrameInterpolationFps)
    : FRAME_INTERPOLATION_DEFAULT_FPS;
}

/** 恢复失败重试应使用的帧率档（IKHSFH）：优先最后受理任务的冻结输入 frozenParams
 *  （创建成功受理时写入，面板后来的编辑只改 lastParams 不改它）；旧持久化卡无
 *  frozenParams（受理值与编辑值同居 lastParams）回落 lastParams 尽力兼容。
 *  非法值回落契约默认档 60（与 restoreFrameInterpolationFps 同源）。 */
export function restoreFrameInterpolationRetryFps(
  identity: FrameInterpolationIdentity | undefined,
): FrameInterpolationFps {
  return restoreFrameInterpolationFps(identity?.frozenParams ?? identity?.lastParams);
}

/* ============ 发送闭环（IKHLKX 接线点）：契约三键组装与失败文案家族映射 ============ */

/** 组装插帧任务创建契约三键（IKHLKX 发送时调用，先例 buildVideoEnhanceInput）：
 *  source_asset_id 冻结自插帧身份、target_node_id=插帧卡节点 id、fps 面板所选档；
 *  过契约 zod strict 校验，非法（如资产 id 非数字串、fps 越三档）返回 null 由调用方守卫提示。 */
export function buildFrameInterpolationInput(
  sourceAssetId: string,
  targetNodeId: string,
  fps: FrameInterpolationFps,
): VideoFrameInterpolationInput | null {
  const input = {
    [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.sourceAssetId]: sourceAssetId,
    [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.targetNodeId]: targetNodeId,
    [VIDEO_FRAME_INTERPOLATION_INPUT_KEYS.fps]: fps,
  };
  return videoFrameInterpolationInputSchema.safeParse(input).success
    ? (input as VideoFrameInterpolationInput)
    : null;
}

/** 入队失败固定对客全文（票面 IKHLKX 验收 5 逐字要求）。后端落库的 msg 只是半句
 *  「任务入队失败」（契约码表 1028 文案），不足以拼成逐字口径，故入队失败码**优先**返回
 *  本句、不让后端 msg 透传（内部调试原文 details.raw 更不可对客，ADR-0078）。 */
const FRAME_INTERPOLATION_ENQUEUE_FAILED_TEXT = '任务入队失败，请重试';

/** 入队失败码的两个形态（契约字符串码 enqueue_failed / 数值码 1028）同源同一文案 */
const FRAME_INTERPOLATION_ENQUEUE_FAILED_CODES: readonly string[] = ['enqueue_failed', '1028'];

/** 插帧失败文案家族映射（IKHLKX 消费，口径同 videoEnhanceErrorText）：入队失败码先按上一组
 *  常量固定全文；其余码后端 msg 优先，msg 为空时按错误码兜底——video_frame_interpolation_failed
 *  / 1049（契约执行面统一归并，含官方门槛拒绝与转存失败）→「视频插帧失败，请重试」；再兜同句防空白。 */
const FRAME_INTERPOLATION_ERROR_CODE_TEXT: Record<string, string> = {
  video_frame_interpolation_failed: '视频插帧失败，请重试',
  '1049': '视频插帧失败，请重试',
};

export function frameInterpolationErrorText(
  error?: { code?: string | number; message?: string; msg?: string } | null,
): string {
  const code = error?.code != null ? String(error.code) : '';
  if (code !== '' && FRAME_INTERPOLATION_ENQUEUE_FAILED_CODES.includes(code)) {
    return FRAME_INTERPOLATION_ENQUEUE_FAILED_TEXT;
  }
  const text = readJobFailText(error);
  if (text) return text;
  if (code !== '' && FRAME_INTERPOLATION_ERROR_CODE_TEXT[code]) {
    return FRAME_INTERPOLATION_ERROR_CODE_TEXT[code];
  }
  return '视频插帧失败，请重试';
}
