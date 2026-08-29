// web/src/utils/ref-overflow.ts
/** 参考素材超限归因：图片/视频各自按「选中数 − 接受数」判丢弃，供上传处理复用（toast 文案分层）。 */
export type RefOverflowType = 'image' | 'video';

export function classifyRefOverflow(params: {
  selectedImages: number;
  selectedVideos: number;
  acceptedImages: number;
  acceptedVideos: number;
}): RefOverflowType | null {
  const droppedImages = params.selectedImages - params.acceptedImages;
  const droppedVideos = params.selectedVideos - params.acceptedVideos;
  if (droppedImages > 0) return 'image';
  if (droppedVideos > 0) return 'video';
  return null;
}

/** 画布底部各生成对话框的参考素材上限（图片/视频取模型能力接口，音频为产品约定） */
export const REF_LIMITS = {
  image: 9,
  video: 3,
  audio: 3,
} as const;

/**
 * 上传数量超限 toast 文案（图片/视频/音频三个对话框共用同一套措辞，
 * 与画布卡片超限提示「参考图最多 N 张，已超出 N 张」保持一致）。
 */
export function refOverflowToast(kind: 'image' | 'video' | 'audio', limit: number): string {
  const unit = kind === 'image' ? '张' : '个';
  const noun = kind === 'image' ? '图片最多' : kind === 'video' ? '参考视频最多' : '参考音频最多';
  return `${noun} ${limit} ${unit}已超出`;
}
