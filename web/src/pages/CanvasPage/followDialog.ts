/* 跟随输入框定位，以及视频生成节点四模式判定 */

import { hasAnyMediaRef, type VideoMediaRefs } from './videoMediaRefs';

export interface FollowDialogAnchor {
  left: number;
  top: number;
}

export const FOLLOW_DIALOG_WIDTH = 740;
const FOLLOW_GAP = 16;
const FOLLOW_PAD = 12;

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
