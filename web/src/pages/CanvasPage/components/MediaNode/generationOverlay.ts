/** 生图/生视频上游无真实进度；仅音频提取展示进度文案和进度条。 */
export function mediaNodeGenerationOverlay(isMediaExtraction: boolean) {
  if (isMediaExtraction) {
    return {
      showProgress: true,
      progressLabel: '正在提取音频',
      showCancel: false,
    };
  }
  return {
    showProgress: false,
    progressLabel: null,
    showCancel: true,
  };
}
