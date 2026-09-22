import { describe, expect, it } from 'vitest';
import {
  buildVideoSubtitleEraseInput,
  VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS,
  VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX,
  VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX,
  videoSubtitleEraseGateReason,
} from './videoSubtitleErase';
import type { SubtitleBoxOp } from './subtitleEraseBoxes';

describe('videoSubtitleEraseGateReason（智能去字幕门槛预检，IKGZ82）', () => {
  it('门槛内正常视频放行（横屏 1920×1080）', () => {
    expect(videoSubtitleEraseGateReason({ width: 1920, height: 1080, duration: 30 })).toBeNull();
  });

  it('恰在边界放行：横屏 2560×1440 / 竖屏 1440×2560（短长边语义，竖屏合法）/ 时长恰 10 分钟', () => {
    expect(
      videoSubtitleEraseGateReason({
        width: VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX,
        height: VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX,
        duration: VIDEO_SUBTITLE_ERASE_MAX_DURATION_MS / 1000,
      }),
    ).toBeNull();
    expect(
      videoSubtitleEraseGateReason({
        width: VIDEO_SUBTITLE_ERASE_MAX_SHORT_SIDE_PX,
        height: VIDEO_SUBTITLE_ERASE_MAX_LONG_SIDE_PX,
      }),
    ).toBeNull();
  });

  it('长边超 2560 置灰并说明 2K 原因', () => {
    expect(videoSubtitleEraseGateReason({ width: 2561, height: 1440 })).toContain('长边超过 2560');
  });

  it('短边超 1440 置灰并说明 2K 原因', () => {
    expect(videoSubtitleEraseGateReason({ width: 2560, height: 1441 })).toContain('短边超过 1440');
  });

  it('时长超 10 分钟置灰并说明原因（秒换算毫秒口径，600.001s 即拦）', () => {
    expect(videoSubtitleEraseGateReason({ width: 1920, height: 1080, duration: 600.001 })).toContain('10 分钟');
    expect(videoSubtitleEraseGateReason({ width: 1920, height: 1080, duration: 3601 })).toContain('10 分钟');
  });

  it('宽高或时长缺失（null 放行）：存量数据不误拦，交后端按权威数据复核', () => {
    expect(videoSubtitleEraseGateReason({})).toBeNull();
    expect(videoSubtitleEraseGateReason({ width: 4096 })).toBeNull(); // 仅一边实测回填前不拦
    expect(videoSubtitleEraseGateReason({ duration: 120 })).toBeNull();
    expect(videoSubtitleEraseGateReason({ width: 4096, duration: 7200 })).toContain('10 分钟'); // 时长仍独立判定
  });
});

/* IKH3OU（ADR-0104）：模式前置到入口下拉后，发送钮只服务一种语义——detect_mode 两模式
   恒 subtitle_smart（智能模式自动擦画面下半字幕，框选模式在其上叠加检测框）；
   旧「全画面文字」开关推导（text_full）随开关废除，契约枚举保留但本期无 UI 入口。 */
describe('buildVideoSubtitleEraseInput（发送参数推导，IKH3OU：detect_mode 恒 subtitle_smart）', () => {
  const base = {
    sourceAssetId: '5',
    targetNodeId: 'node-xyz',
    displayWidth: 200,
    displayHeight: 100,
  };
  const oneBox: SubtitleBoxOp = { kind: 'box', from: { x: 20, y: 70 }, to: { x: 180, y: 95 } };
  const expectedBox = { top_left_x: 0.1, top_left_y: 0.7, bottom_right_x: 0.9, bottom_right_y: 0.95 };

  it('智能模式无框直发 = subtitle_smart + 空数组合法（自动擦下半字幕，不传框键）', () => {
    expect(buildVideoSubtitleEraseInput({ ...base, boxes: [] })).toEqual({
      source_asset_id: '5',
      target_node_id: 'node-xyz',
      detect_mode: 'subtitle_smart',
      erase_boxes: [],
    });
  });

  it('框选模式有框 = subtitle_smart + 归一化框（检测模式不随框变化）', () => {
    expect(buildVideoSubtitleEraseInput({ ...base, boxes: [oneBox] })).toEqual({
      source_asset_id: '5',
      target_node_id: 'node-xyz',
      detect_mode: 'subtitle_smart',
      erase_boxes: [expectedBox],
    });
  });

  it('两模式推导出的 detect_mode 完全一致：模式只改框集合，不改检测范围', () => {
    const smart = buildVideoSubtitleEraseInput({ ...base, boxes: [] });
    const box = buildVideoSubtitleEraseInput({ ...base, boxes: [oneBox] });
    expect(smart.detect_mode).toBe('subtitle_smart');
    expect(box.detect_mode).toBe(smart.detect_mode);
    // text_full（全画面检测）本期无任何推导路径（ADR-0104 Out of Scope）
    expect(smart.detect_mode).not.toBe('text_full');
  });

  it('多框按落笔顺序映射为归一化四键数组', () => {
    const second: SubtitleBoxOp = { kind: 'box', from: { x: 0, y: 0 }, to: { x: 100, y: 50 } };
    const payload = buildVideoSubtitleEraseInput({ ...base, boxes: [oneBox, second] });
    expect(payload.erase_boxes).toEqual([
      expectedBox,
      { top_left_x: 0, top_left_y: 0, bottom_right_x: 0.5, bottom_right_y: 0.5 },
    ]);
  });
});
