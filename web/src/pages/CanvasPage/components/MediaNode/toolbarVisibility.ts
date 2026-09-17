export type CanvasMediaType = 'image' | 'video' | 'audio';

export function mediaNodeToolbarVisibility(mediaType: CanvasMediaType | undefined) {
  const isAudio = mediaType === 'audio';
  const isVideo = mediaType === 'video';
  return {
    mention: !isAudio,
    genImage: !isAudio && !isVideo,
    genVideo: !isAudio,
    /** 高清放大（IKGM9F）：与「生成图片」同族，仅图片卡显示 */
    enhanceImage: !isAudio && !isVideo,
  };
}
