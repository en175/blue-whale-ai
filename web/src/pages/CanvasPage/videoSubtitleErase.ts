/* ============================================
 * 视频智能去字幕（IKGZ82 入口 / IKH3OU 交互重做）：「智能去字幕 ▾」入口门槛预检、
 * 会话模式与发送参数推导（纯逻辑，无 React 依赖，形状与判定口径对齐
 * imageErase.ts / imageCutout.ts 先例）。
 * 门槛常量经 @lib/contracts/video-subtitle-erase 与契约同源引用
 * （对齐 imageCutout.ts 契约同源切换先例 IKGOR6，数值不变仅换单源）；
 * 数值出处 = 规格 docs/specs/2026-09-19-video-subtitle-erase-mediakit.md
 * 「入口与预检」节（官方接口输入最高 2K 分辨率 + 产品 10 分钟上限）。
 * ============================================ */

import {
  VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS,
  VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX,
  VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX,
  type VideoSubtitleEraseInput,
} from '@lib/contracts/video-subtitle-erase';
import { subtitleBoxesToPayload, type SubtitleBoxOp } from './subtitleEraseBoxes';

/* ============ 常量（契约同源引用，出处见头注释） ============ */

// 契约常量再导出供外部消费（对齐 imageErase.ts / imageCutout.ts 再导出先例）。
export {
  VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS,
  VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX,
  VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX,
};
export type { VideoSubtitleEraseInput };

/** 去字幕会话模式（IKH3OU，ADR-0104 模式前置到入口下拉）：入口菜单两项各进一种会话，
 *  会话内不互切（换模式 = X 退出后从菜单重选）。两模式 detect_mode 恒为 subtitle_smart，
 *  差异只在框选工具与检测框集合：smart=零框选工具、无框直发；box=拉框指定擦除区域。 */
export type VideoSubtitleEraseMode = 'smart' | 'box';

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

/* ============ 发送参数推导与结果卡身份（IKGZ83 编辑态发送闭环） ============ */

/** 发送推导输入：框图元为显示坐标（相对视频显示区域左上角，未乘画布 zoom），
 *  displayWidth/displayHeight 与图元同一坐标系（换算归一化四键用）。 */
export interface VideoSubtitleEraseSendSource {
  sourceAssetId: string;
  /** 发送时才生成（先冻结进任务再据此建结果卡） */
  targetNodeId: string;
  boxes: readonly SubtitleBoxOp[];
  displayWidth: number;
  displayHeight: number;
}

/** 组装发送契约 input（IKH3OU，ADR-0104：模式前置到入口后，一个发送钮只服务一种语义）：
 *  detect_mode 恒 `subtitle_smart`——智能模式自动擦画面下半字幕，框选模式在其之上叠加
 *  检测框；erase_boxes 只由框集合推导（智能模式恒空数组：入口零框选工具，不传框键由
 *  worker 判空承担）。`text_full`（全画面检测）契约枚举保留但本期无 UI 入口（ADR-0104）。 */
export function buildVideoSubtitleEraseInput(source: VideoSubtitleEraseSendSource): VideoSubtitleEraseInput {
  return {
    source_asset_id: source.sourceAssetId,
    target_node_id: source.targetNodeId,
    detect_mode: 'subtitle_smart',
    erase_boxes: subtitleBoxesToPayload(source.boxes, source.displayWidth, source.displayHeight),
  };
}

/** 去字幕结果卡身份标记（node.data.videoSubtitleErase，形态对齐 ImageEraseIdentity）：
 *  结果卡是普通视频素材卡（可再次去字幕），lastInput 供失败重试原样重发创建接口。 */
export interface VideoSubtitleEraseIdentity {
  /** 源素材身份（assetId 归一字符串）：提交冻结 source_asset_id */
  sourceAssetId?: string;
  /** 上次提交参数（契约四键形态，target_node_id 指向本卡）；失败重试原样重发 */
  lastInput?: VideoSubtitleEraseInput;
}
