/* ============================================
 * 视频智能去字幕（IKGZ82）：「智能去字幕」入口门槛预检与效果边界文案（纯逻辑，
 * 无 React 依赖，形状与判定口径对齐 imageErase.ts / imageCutout.ts 先例）。
 * 门槛数值出处 = 规格 docs/specs/2026-09-19-video-subtitle-erase-mediakit.md
 * 「入口与预检」节（官方接口输入最高 2K 分辨率 + 产品 10 分钟上限）；本票为本地常量，
 * video-subtitle-erase 契约（IKGZ7V 家族 Z7Z）合入后切 @lib/contracts 同源引用
 * （对齐 imageCutout.ts 契约同源切换先例，数值不变仅换单源）。
 * ============================================ */

/* ============ 常量（本地定义，待契约同源） ============ */

/** 输入分辨率上限（2K，短长边语义：长边 ≤2560 且短边 ≤1440，竖屏 1440×2560 合法）；
 *  官方 PDF 仅写「最高支持 2K 分辨率」无像素值，工程口径沿用图片系 2K 先例
 *  （IKGOSZ 修正后口径，见 /tmp/ikgz7v-exploration/notes.md「2K 像素判定工程口径」）。 */
export const VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX = 2560;
export const VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX = 1440;

/** 时长产品上限 10 分钟（毫秒，命名与口径对齐 assets 表 duration_ms 与契约常量）；
 *  前端 MediaNodeData.duration 为秒，换算仅发生在门槛判定一处。 */
export const VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS = 10 * 60 * 1000;

/** 入口可用态悬停说明（效果边界，规格故事 6）：默认擦白色中英文字幕，
 *  彩色/顶部字幕走编辑态框选加「全画面文字」模式。置灰态与原因文案互斥（同一 title 通道）。 */
export const VIDEO_SUBTITLE_ERASE_ENTRY_HINT = '适合白色中英文字幕，彩色或顶部字幕请用框选加全画面模式';

/* ============ 门槛预检 ============ */

/** 门槛判定输入：与 MediaNode data 字段同名（width/height 像素，duration 秒）。 */
export interface VideoSubtitleEraseGateSource {
  width?: number;
  height?: number;
  duration?: number;
}

/** 「智能去字幕」入口门槛预检（按钮置灰用）：返回不可用原因（悬停展示），null 为可用。
 *  分辨率超 2K（长边 >2560 或短边 >1440，短长边判定竖屏合法）或时长超 10 分钟（>600s）拦截；
 *  宽高或时长缺失（null，存量数据）放行不拦，交后端创建入口按权威数据复核。 */
export function videoSubtitleEraseGateReason(source: VideoSubtitleEraseGateSource): string | null {
  const { width, height, duration } = source;
  if (typeof width === 'number' && typeof height === 'number') {
    const longSide = Math.max(width, height);
    const shortSide = Math.min(width, height);
    if (
      longSide > VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX
      || shortSide > VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX
    ) {
      return `视频长边超过 ${VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX} 或短边超过 ${VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX}（2K 上限），无法智能去字幕`;
    }
  }
  if (typeof duration === 'number' && duration * 1000 > VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS) {
    return '视频超过 10 分钟，暂支持 10 分钟以内的视频';
  }
  return null;
}
