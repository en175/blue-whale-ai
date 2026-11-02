const CANVAS_TOOL_IDENTITY_KEYS = [
  'imageEnhance',
  'videoEnhance',
  'imageCutout',
  'mediaExtract',
  'imageErase',
  'imageOutpaint',
  'videoSubtitleErase',
  'vocalSplit',
  'sceneSplit',
  'audioTrim',
  'audioVideoMux',
] as const;

export function isCanvasToolGeneration(data: Record<string, unknown>): boolean {
  return CANVAS_TOOL_IDENTITY_KEYS.some((key) => data[key] != null);
}

export function mediaNodeGenerationOverlay(
  mediaType: 'image' | 'video' | 'audio' | undefined,
  isMediaExtraction: boolean,
  hideCancel = false,
  isToolCard = false,
) {
  if (isMediaExtraction) {
    return {
      showProgress: true,
      progressLabel: '音视频分离处理中',
      showCancel: false,
    };
  }
  return {
    showProgress: false,
    progressLabel: mediaType === 'image' ? '图片生成中…' : mediaType === 'video' ? '视频生成中…' : null,
    showCancel: !hideCancel && (mediaType === 'audio' || isToolCard),
  };
}
