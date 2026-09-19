/* ============================================
 * 视频智能去字幕（IKGZ82）：「智能去字幕」入口门槛预检与效果边界文案（纯逻辑，
 * 无 React 依赖，形状与判定口径对齐 imageErase.ts / imageCutout.ts 先例）。
 * 门槛常量经 @lib/contracts/video-subtitle-erase 与契约同源引用
 * （对齐 imageCutout.ts 契约同源切换先例 IKGOR6，数值不变仅换单源）；
 * 数值出处 = 规格 docs/specs/2026-09-19-video-subtitle-erase-mediakit.md
 * 「入口与预检」节（官方接口输入最高 2K 分辨率 + 产品 10 分钟上限）。
 * ============================================ */

import {
  VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS,
  VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX,
  VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX,
} from '@lib/contracts/video-subtitle-erase';

/* ============ 常量（契约同源引用，出处见头注释） ============ */

// 契约常量再导出供外部消费（对齐 imageErase.ts / imageCutout.ts 再导出先例）。
export {
  VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS,
  VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX,
  VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX,
};

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
