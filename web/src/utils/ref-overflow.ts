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

export function refOverflowToast(
  kinds: ('image' | 'video' | 'audio')[],
  limits: Partial<Record<'image' | 'video' | 'audio', number>> = {},
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
