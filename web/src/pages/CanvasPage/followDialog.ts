/* 跟随输入框定位，以及视频生成节点四模式判定 */

export interface FollowDialogAnchor {
  left: number;
  top: number;
}

export const FOLLOW_DIALOG_WIDTH = 740;
const FOLLOW_DIALOG_HEIGHT = 220;
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

/** 按已连素材类型判定可高亮的视频模式 */
export function enabledVideoFollowModes(sourceKinds: Array<'image' | 'video' | 'audio' | 'text'>): VideoFollowMode[] {
  const imageCount = sourceKinds.filter((kind) => kind === 'image').length;
  const hasMedia = sourceKinds.some((kind) => kind === 'image' || kind === 'video' || kind === 'audio');
  const onlyText = sourceKinds.length > 0 && sourceKinds.every((kind) => kind === 'text');
  const empty = sourceKinds.length === 0;
  const enabled: VideoFollowMode[] = [];
  if (empty || onlyText) enabled.push('prompt');
  if (hasMedia) enabled.push('all');
  if (imageCount >= 1) enabled.push('text2video');
  if (imageCount >= 2) enabled.push('keyframe');
  return enabled;
}

export function firstEnabledVideoMode(enabled: readonly string[]): VideoFollowMode {
  for (const mode of VIDEO_FOLLOW_MODE_ORDER) {
    if (enabled.includes(mode)) return mode;
  }
  return 'prompt';
}
