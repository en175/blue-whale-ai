/* 跟随输入框定位，以及视频生成节点四模式判定 */

import { hasAnyMediaRef, type VideoMediaRefs } from './videoMediaRefs';

export interface FollowDialogAnchor {
  left: number;
  top: number;
}

export const FOLLOW_DIALOG_WIDTH = 740;
export const FOLLOW_GAP = 16;
export const FOLLOW_PAD = 12;

/** 将节点 flow 坐标换算为画布容器内的对话框左上角，始终落在节点下方 */
export function computeFollowAnchor(opts: {
  nodeX: number;
  nodeY: number;
  nodeWidth: number;
  nodeHeight: number;
  viewport: { x: number; y: number; zoom: number };
  containerWidth: number;
  containerHeight: number;
  dialogWidth?: number;
  dialogHeight?: number;
}): FollowDialogAnchor {
  const zoom = opts.viewport.zoom || 1;
  const dialogWidth = Math.min(opts.dialogWidth ?? FOLLOW_DIALOG_WIDTH, Math.max(280, opts.containerWidth * 0.9));
  const nodeLeft = opts.nodeX * zoom + opts.viewport.x;
  const nodeWidth = opts.nodeWidth * zoom;
  const nodeHeight = opts.nodeHeight * zoom;
  const nodeBottom = opts.nodeY * zoom + opts.viewport.y + nodeHeight;
  let left = nodeLeft + nodeWidth / 2 - dialogWidth / 2;
  const maxLeft = opts.containerWidth - dialogWidth - FOLLOW_PAD;
  left = Math.max(FOLLOW_PAD, Math.min(left, Math.max(FOLLOW_PAD, maxLeft)));
  return { left: Math.round(left), top: Math.round(nodeBottom + FOLLOW_GAP) };
}

/** 上方锚定默认抬升量（屏幕像素）：工具条估高约 42 + 与卡片顶边间距 10（口径同擦除上方工具条的 52） */
export const FOLLOW_ABOVE_LIFT = 52;
/** 上方锚定水平视口钳制默认估半宽（屏幕像素）：仅用于钳制边界，不参与居中。
 *  IKH3XZ 五画质工具横排后工具条实测 473px；IKH8BJ 视频卡追加「场景切分」后视频工具条
 *  记 528px（真实半宽约 264），250→270 保证贴边不被裁。
 *  IKHLKR 首位「HD」单按钮升为「高清 ▾」下拉触发钮后**重新实测**：视频卡工具条 564px
 *  （headless chromium + 仓内 global.css 渲染真实工具条；同环境复核图片卡工具条 473px，
 *  与 ADR-0107 记录一致，测量口径可信），真实半宽约 282，270→288 维持同一 6px 余量。
 *  新增宽度来自触发钮的下拉箭头（ChevronDown 12px + toolBtn gap 6px = +18px）。
 *  IKHK7N 视频卡再追加「智能抠像 ▾」（图标+文字+chevron，形状同「智能去字幕 ▾」约 106px），
 *  与「高清 ▾」并存后估约 670px（真实半宽约 335），288→341 维持同一 6px 余量。 */
export const FOLLOW_ABOVE_HALF_WIDTH = 341;
/** 上方锚定垂直钳顶保底（屏幕像素）：卡片顶到视口上方时工具条不被容器裁掉 */
export const FOLLOW_ABOVE_MIN_TOP = 8;

/** 卡片上方居中锚定（IKGYYD 钉屏幕工具栏基建）：将节点 flow 坐标换算为画布容器内的
 *  工具栏屏幕坐标——left 是工具栏中心点 x（消费方容器 translateX(-50%) 完成真居中，
 *  估半宽只用于视口钳制，不参与居中：工具条宽度随按钮显隐动态变化，估宽居中会跳位）；
 *  top 是工具栏顶边 y（卡片顶边屏幕坐标 - 抬升量），垂直仅钳顶部保底、向下不钳制；
 *  zoom 只参与位置换算，抬升量/半宽恒为屏幕像素（工具栏尺寸不随缩放变化）。 */
export function computeFollowAnchorAbove(opts: {
  nodeX: number;
  nodeY: number;
  nodeWidth: number;
  viewport: { x: number; y: number; zoom: number };
  containerWidth: number;
  toolbarHalfWidth?: number;
  toolbarLift?: number;
}): FollowDialogAnchor {
  const zoom = opts.viewport.zoom || 1;
  const halfWidth = opts.toolbarHalfWidth ?? FOLLOW_ABOVE_HALF_WIDTH;
  const lift = opts.toolbarLift ?? FOLLOW_ABOVE_LIFT;
  const centerX = (opts.nodeX + opts.nodeWidth / 2) * zoom + opts.viewport.x;
  const minLeft = FOLLOW_PAD + halfWidth;
  const left = Math.max(minLeft, Math.min(centerX, Math.max(minLeft, opts.containerWidth - halfWidth - FOLLOW_PAD)));
  const top = Math.max(FOLLOW_ABOVE_MIN_TOP, opts.nodeY * zoom + opts.viewport.y - lift);
  return { left: Math.round(left), top: Math.round(top) };
}

/** 视频跟随输入框四模式（文生视频单独于现有 text2video=图生视频） */
export type VideoFollowMode = 'prompt' | 'all' | 'text2video' | 'keyframe';

export const VIDEO_FOLLOW_MODE_ORDER: VideoFollowMode[] = ['prompt', 'all', 'text2video', 'keyframe'];

export const VIDEO_FOLLOW_MODE_LABEL: Record<VideoFollowMode, string> = {
  prompt: '文生视频',
  all: '全能参考',
  text2video: '图生视频',
  keyframe: '首尾帧',
};

/** 按当前目标的媒体参考集合判定可选视频模式（IKFC1T）：
 *  判定输入 = 实际成为当前目标参考的媒体（连线 + 角色库 material + 到节点选择暂存合并，
 *  与面板显示/提交输入同源）；invalid 不计入，文本附件不属于媒体参考。
 *  无媒体 → 文生视频与全能参考可选（all 保持可选保证删除全部参考后不自动切回）；
 *  存在任一媒体 → 文生视频不可选；图片 ≥1 开图生视频、≥2 开首尾帧（帧按图片计）。
 *  IKFJJT：已处于首尾帧（存在首帧/尾帧槽）时 keyframe 恒可选——去掉一帧后不把模式踢走，
 *  用户可自行补齐或改选；缺帧由发送期校验提示补全。 */
export function enabledVideoFollowModes(refs: VideoMediaRefs): VideoFollowMode[] {
  const imageCount =
    refs.reference.filter((r) => r.mediaType === 'image').length + (refs.first ? 1 : 0) + (refs.last ? 1 : 0);
  const hasMedia = hasAnyMediaRef(refs);
  const hasFrameSlot = Boolean(refs.first || refs.last);
  const enabled: VideoFollowMode[] = [];
  if (!hasMedia) enabled.push('prompt', 'all');
  if (hasMedia) enabled.push('all');
  if (hasMedia && imageCount >= 1) enabled.push('text2video');
  if ((hasMedia && imageCount >= 2) || hasFrameSlot) enabled.push('keyframe');
  return enabled;
}

export function firstEnabledVideoMode(enabled: readonly string[]): VideoFollowMode {
  for (const mode of VIDEO_FOLLOW_MODE_ORDER) {
    if (enabled.includes(mode)) return mode;
  }
  return 'prompt';
}
