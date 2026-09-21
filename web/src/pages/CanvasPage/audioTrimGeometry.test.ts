// @vitest-environment jsdom
/* IKHB7A 遮罩几何纯函数测试（仿 imageCrop.test.ts 先例）：默认全选、端点与最小片段
   钳制、左右抓手拖拽钳制、定位条钳制与选区内判定、渲染换算与文案（胶囊一位小数/
   发送条 mm:ss）。 */
import { describe, expect, it } from 'vitest';
import {
  AUDIO_TRIM_MIN_SEGMENT_SECONDS,
  audioTrimDurationLabel,
  audioTrimRangeLabel,
  audioTrimTimePercent,
  clampAudioTrimPlayhead,
  clampAudioTrimSelection,
  dragAudioTrimHandleEnd,
  dragAudioTrimHandleStart,
  formatAudioTrimClock,
  fullAudioTrimSelection,
  isAudioTrimTimeInSelection,
} from './audioTrimGeometry';

describe('fullAudioTrimSelection 默认全选', () => {
  it('进入编辑态默认 0 到全长（每次重置，不跨会话记忆）', () => {
    expect(fullAudioTrimSelection(15)).toEqual({ start: 0, end: 15 });
    expect(fullAudioTrimSelection(0.3)).toEqual({ start: 0, end: 0.3 });
  });
});

describe('clampAudioTrimSelection 选区钳制', () => {
  it('合法选区原样返回', () => {
    expect(clampAudioTrimSelection({ start: 2, end: 13 }, 15)).toEqual({ start: 2, end: 13 });
  });

  it('端点越界收进 [0, duration]', () => {
    expect(clampAudioTrimSelection({ start: -2, end: 18 }, 15)).toEqual({ start: 0, end: 15 });
    expect(clampAudioTrimSelection({ start: 10, end: 99 }, 15)).toEqual({ start: 10, end: 15 });
    expect(clampAudioTrimSelection({ start: -5, end: 3 }, 15)).toEqual({ start: 0, end: 3 });
  });

  it('片段不足最小值：以 start 为锚补足 0.1 秒', () => {
    expect(clampAudioTrimSelection({ start: 2, end: 2.05 }, 15)).toEqual({
      start: 2,
      end: 2 + AUDIO_TRIM_MIN_SEGMENT_SECONDS,
    });
  });

  it('start 贴全长时反向以 end 为锚', () => {
    expect(clampAudioTrimSelection({ start: 15, end: 15 }, 15)).toEqual({
      start: 15 - AUDIO_TRIM_MIN_SEGMENT_SECONDS,
      end: 15,
    });
  });

  it('duration 非法（≤0）退化为最小片段空转选区，不抛错', () => {
    expect(clampAudioTrimSelection({ start: 0, end: 10 }, 0)).toEqual({
      start: 0,
      end: AUDIO_TRIM_MIN_SEGMENT_SECONDS,
    });
  });
});

describe('dragAudioTrimHandleStart/End 抓手拖拽钳制', () => {
  const sel = { start: 2, end: 13 };

  it('左缘跟随指针、钳 [0, end-min]（不越过右缘）', () => {
    expect(dragAudioTrimHandleStart(8, sel)).toEqual({ start: 8, end: 13 });
    expect(dragAudioTrimHandleStart(-1, sel)).toEqual({ start: 0, end: 13 });
    expect(dragAudioTrimHandleStart(12.98, sel)).toEqual({
      start: 13 - AUDIO_TRIM_MIN_SEGMENT_SECONDS,
      end: 13,
    });
  });

  it('右缘跟随指针、钳 [start+min, duration]（不越过左缘与全长）', () => {
    expect(dragAudioTrimHandleEnd(6, sel, 15)).toEqual({ start: 2, end: 6 });
    expect(dragAudioTrimHandleEnd(2.02, sel, 15)).toEqual({
      start: 2,
      end: 2 + AUDIO_TRIM_MIN_SEGMENT_SECONDS,
    });
    expect(dragAudioTrimHandleEnd(99, sel, 15)).toEqual({ start: 2, end: 15 });
  });

  it('左缘拖到全长外仍被右缘-最小片段钳住', () => {
    expect(dragAudioTrimHandleStart(99, { start: 0, end: 15 })).toEqual({
      start: 15 - AUDIO_TRIM_MIN_SEGMENT_SECONDS,
      end: 15,
    });
  });
});

describe('clampAudioTrimPlayhead / isAudioTrimTimeInSelection 定位条', () => {
  const sel = { start: 2, end: 13 };

  it('选区内原样、越界钳回最近边界', () => {
    expect(clampAudioTrimPlayhead(6, sel)).toBe(6);
    expect(clampAudioTrimPlayhead(0, sel)).toBe(2);
    expect(clampAudioTrimPlayhead(15, sel)).toBe(13);
  });

  it('选区内判定带 1e-6 容差（边界值视为在内）', () => {
    expect(isAudioTrimTimeInSelection(2, sel)).toBe(true);
    expect(isAudioTrimTimeInSelection(13, sel)).toBe(true);
    expect(isAudioTrimTimeInSelection(13 + 1e-6, sel)).toBe(true);
    expect(isAudioTrimTimeInSelection(1.9, sel)).toBe(false);
    expect(isAudioTrimTimeInSelection(14, sel)).toBe(false);
  });
});

describe('渲染换算与文案', () => {
  it('时间 → 百分比（duration 非法返回 0）', () => {
    expect(audioTrimTimePercent(7.5, 15)).toBeCloseTo(50);
    expect(audioTrimTimePercent(0, 15)).toBe(0);
    expect(audioTrimTimePercent(5, 0)).toBe(0);
  });

  it('胶囊文案一位小数（实时联动秒数）', () => {
    expect(audioTrimDurationLabel({ start: 2.4, end: 13 })).toBe('10.6 s');
    expect(audioTrimDurationLabel({ start: 0, end: 15 })).toBe('15.0 s');
  });

  it('发送条时间范围 mm:ss 两位补零', () => {
    expect(audioTrimRangeLabel({ start: 0, end: 15 })).toBe('00:00 - 00:15');
    expect(audioTrimRangeLabel({ start: 62, end: 125 })).toBe('01:02 - 02:05');
  });

  it('卡内时间行分:秒', () => {
    expect(formatAudioTrimClock(0)).toBe('0:00');
    expect(formatAudioTrimClock(65)).toBe('1:05');
  });
});
