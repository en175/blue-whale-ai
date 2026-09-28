/** 画布工具结果卡身份键：发送即扣费、上游不支持撤销，生成中不开放取消。 */
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
  /** 音视频合成（IKIHPM）：占位卡是草稿卡原地转生成中，取消会把卡打回草稿并改写草稿名，
   *  同族画布工具卡一律不开放取消（任务失败才保留卡与「重试」）。 */
  'audioVideoMux',
] as const;

/** 去字幕 / 高清 / 擦除 / 抠图 / 扩图 / 音视频分离 / 音视频合成等同族工具卡 */
export function isCanvasToolGeneration(data: Record<string, unknown>): boolean {
  return CANVAS_TOOL_IDENTITY_KEYS.some((key) => data[key] != null);
}

/** 生图/生视频上游无真实进度；仅音视频分离占位卡展示进度文案和进度条
 *  （IKH28X：随工具更名与「处理中」语义更新——提交后 1、轮询期保持、终态 100，
 *  火山无中间百分比，进度条作非精确处理中态）。
 *  画布工具卡 hideCancel：钱已扣且无法撤销，不开放取消按钮。 */
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
