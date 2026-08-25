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
