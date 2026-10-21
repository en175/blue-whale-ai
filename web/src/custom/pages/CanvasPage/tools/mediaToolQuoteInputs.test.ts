import { describe, expect, it } from 'vitest';
import {
  mixQuoteInput,
  muxQuoteInput,
  roundedSeconds,
  speedQuoteInput,
  trimQuoteInput,
  videoToolQuoteInput,
} from './mediaToolQuoteInputs';

describe('roundedSeconds', () => {
  it('与非空秒数一致：向上取整到整秒且至少 1', () => {
    expect(roundedSeconds(60.4)).toBe(60);
    expect(roundedSeconds(60.6)).toBe(61);
    expect(roundedSeconds(0.2)).toBe(1);
    expect(roundedSeconds(null)).toBeNull();
    expect(roundedSeconds(Number.NaN)).toBeNull();
  });
});

describe('videoToolQuoteInput', () => {
  it('视频工具按整秒报价，缺时长返回 null', () => {
    expect(videoToolQuoteInput(60.4)).toEqual({ duration: 60 });
    expect(videoToolQuoteInput(undefined)).toBeNull();
  });
});

describe('trimQuoteInput', () => {
  it('区间秒数向上取整，并按源时长整秒钳制', () => {
    expect(trimQuoteInput(0, 60.4, 60.4)).toEqual({ duration: 60 });
    expect(trimQuoteInput(10, 70.2, 70.2)).toEqual({ duration: 60 });
    expect(trimQuoteInput(5, 5)).toBeNull();
  });
});

describe('speedQuoteInput', () => {
  it('先取整源秒数再按倍速向上取整', () => {
    expect(speedQuoteInput(60.4, 1)).toEqual({ duration: 60 });
    expect(speedQuoteInput(61, 2)).toEqual({ duration: 31 });
    expect(speedQuoteInput(undefined, 2)).toBeNull();
    expect(speedQuoteInput(61, 0)).toBeNull();
  });
});

describe('mixQuoteInput', () => {
  it('取最长输入并向上取整；全缺失时返回 null', () => {
    expect(mixQuoteInput([60.4, 30, null])).toEqual({ duration: 61 });
    expect(mixQuoteInput([null, undefined])).toBeNull();
  });
});

describe('muxQuoteInput', () => {
  it('按时长对齐方式取输出秒数与分辨率档', () => {
    expect(muxQuoteInput({
      videoSeconds: 61.2,
      audioSeconds: 90,
      sync: 'none',
      width: 854,
      height: 480,
    })).toEqual({ duration: 90, resolution: '1080p' });
    expect(muxQuoteInput({
      videoSeconds: 61.2,
      audioSeconds: 90,
      sync: 'video',
      width: 2560,
      height: 1440,
    })).toEqual({ duration: 61, resolution: '2k' });
    expect(muxQuoteInput({
      videoSeconds: 61.2,
      audioSeconds: 90,
      sync: 'audio',
      width: 3840,
      height: 2160,
    })).toEqual({ duration: 90, resolution: '4k' });
  });

  it('缺视频分辨率或时长时返回 null', () => {
    expect(muxQuoteInput({
      videoSeconds: 61,
      audioSeconds: 90,
      sync: 'none',
      width: null,
      height: null,
    })).toBeNull();
    expect(muxQuoteInput({
      videoSeconds: null,
      audioSeconds: null,
      sync: 'none',
      width: 1920,
      height: 1080,
    })).toBeNull();
  });
});
