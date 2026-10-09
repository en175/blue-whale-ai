export type CanvasMediaType = 'image' | 'video' | 'audio';

export function mediaNodeToolbarVisibility(mediaType: CanvasMediaType | undefined) {
  const isAudio = mediaType === 'audio';
  const isVideo = mediaType === 'video';
  return {
    mention: !isAudio,
    imageQuality: !isAudio && !isVideo,
    videoSubtitleErase: isVideo,
    videoEnhance: isVideo,
    audioTools: isAudio,
  };
}

export function mediaCardToolbarVisible(
  data: { genStatus?: unknown; assetMissing?: unknown; emptyShell?: unknown },
): boolean {
  return !data.genStatus && !data.assetMissing && data.emptyShell !== true;
}
