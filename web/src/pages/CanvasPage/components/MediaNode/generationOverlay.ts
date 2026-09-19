/** 生图/生视频上游无真实进度；仅音视频分离占位卡展示进度文案和进度条
 *  （IKH28X：随工具更名与「处理中」语义更新——提交后 1、轮询期保持、终态 100，
 *  火山无中间百分比，进度条作非精确处理中态）。 */
export function mediaNodeGenerationOverlay(isMediaExtraction: boolean) {
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
    showCancel: true,
  };
}
