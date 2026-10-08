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

export function mediaNodeGenerationOverlay(isMediaExtraction: boolean, hideCancel = false) {
  if (isMediaExtraction) {
    return {
      showProgress: true,
      progressLabel: '音视频分离处理中',
      showCancel: false,
    };
  }
  return {
    showProgress: false,
    progressLabel: null,
    showCancel: !hideCancel,
  };
}
