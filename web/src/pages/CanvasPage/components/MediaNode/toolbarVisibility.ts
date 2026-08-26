export type CanvasMediaType = 'image' | 'video' | 'audio';

export function mediaNodeToolbarVisibility(mediaType: CanvasMediaType | undefined) {
  const isAudio = mediaType === 'audio';
  const isVideo = mediaType === 'video';
  return {
    mention: !isAudio,
    genImage: !isAudio && !isVideo,
    genVideo: !isAudio,
  };
}
