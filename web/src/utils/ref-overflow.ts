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

/** 返回超限的种类数组，支持同时有 image 和 video 超出的场景。 */
export function classifyRefOverflows(params: {
  selectedImages: number;
  selectedVideos: number;
  acceptedImages: number;
  acceptedVideos: number;
}): RefOverflowType[] {
  const out: RefOverflowType[] = [];
  if (params.selectedImages - params.acceptedImages > 0) out.push('image');
  if (params.selectedVideos - params.acceptedVideos > 0) out.push('video');
  return out;
}

/**
 * 上传数量超限 toast 文案（ADR-0086：上限由调用方传能力行值，不再依赖固定常量）：
 *  - 单种超出：「图片最多 9 张已超出」
 *  - 图片+视频同时超出：「图片最多 9 张，视频3条已超出」
 *  - 首尾帧图片超 2：由调用方传 limit
 */
export function refOverflowToast(
  kinds: ('image' | 'video' | 'audio')[],
  limits: Partial<Record<'image' | 'video' | 'audio', number>>,
): string {
  const parts: string[] = [];
  for (const k of kinds) {
    if (k === 'image') {
      parts.push(`图片最多 ${limits.image ?? 9} 张`);
    } else if (k === 'video') {
      parts.push(`视频${limits.video ?? 3}条`);
    } else {
      parts.push(`参考音频最多 ${limits.audio ?? 3} 段`);
    }
  }
  if (parts.length <= 1) return `${parts.join('')}已超出`;
  return `${parts.join('，')}已超出`;
}
