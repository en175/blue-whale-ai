/* ============================================
 * 音视频分离（IKH28U）：「音视频分离」入口门槛预检与效果边界文案（纯逻辑，
 * 无 React 依赖，形状与判定口径对齐 videoSubtitleErase.ts 先例）。
 * 分离格式清单经 @lib/contracts/media-extract 与契约同源（整合缝合，数值不变仅换单源，
 * 对齐 videoSubtitleErase.ts 契约常量引用先例 IKGZ7V）；效果边界文案出处 =
 * GLOSSARY.md「分离格式」词条与 ADR-0103 决策一。
 * ============================================ */

import {
  MEDIA_EXTRACT_DEFAULT_OUTPUT_FORMAT,
  MEDIA_EXTRACT_OUTPUT_FORMATS,
  type MediaExtractOutputFormat,
} from '@lib/contracts/media-extract';

/* ============ 分离格式（契约同源引用，出处见头注释） ============ */

// 契约常量再导出供外部消费（本地旧名保持，消费方零改动；对齐 videoSubtitleErase.ts 再导出先例）。
export const AUDIO_VIDEO_SPLIT_FORMATS = MEDIA_EXTRACT_OUTPUT_FORMATS;

export type AudioVideoSplitFormat = MediaExtractOutputFormat;

/** 默认分离格式（词条：m4a 默认；格式不跨会话记忆，进入编辑态重置） */
export const AUDIO_VIDEO_SPLIT_DEFAULT_FORMAT: AudioVideoSplitFormat = MEDIA_EXTRACT_DEFAULT_OUTPUT_FORMAT;

/** 格式守卫（X 票发送条下拉受控值与终态文件名校验用）：仅接受清单内五值 */
export function isAudioVideoSplitFormat(value: unknown): value is AudioVideoSplitFormat {
  return (AUDIO_VIDEO_SPLIT_FORMATS as readonly unknown[]).includes(value);
}

/* ============ 门槛预检与文案 ============ */

/** 入口可用态悬停说明（效果边界，GLOSSARY.md Avoid 词条）：产物只有音频一侧。 */
export const AUDIO_VIDEO_SPLIT_ENTRY_HINT = '将视频完整音轨分离为音频卡片（仅音频，不产出去音轨的视频）';

/** 唯一置灰原因（ADR-0103 决策四：分辨率与时长不做前置拦截，超限走任务失败口径） */
export const AUDIO_VIDEO_SPLIT_MISSING_ASSET_REASON = '当前视频尚未关联资产，无法音视频分离';

/** 门槛判定输入：与 MediaNode data 字段同名（assetId 视频关联资产 id）。 */
export interface AudioVideoSplitGateSource {
  assetId?: string | number | null;
}

/** 「音视频分离」入口门槛预检（按钮置灰用）：返回不可用原因（悬停展示），null 为可用。
 *  唯一置灰条件 = 视频未关联资产；不做分辨率/时长预检（ADR-0103 决策四）。 */
export function audioVideoSplitGateReason(source: AudioVideoSplitGateSource): string | null {
  if (source.assetId == null) return AUDIO_VIDEO_SPLIT_MISSING_ASSET_REASON;
  return null;
}
