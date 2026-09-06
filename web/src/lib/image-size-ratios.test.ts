import { describe, expect, it } from 'vitest';
import { pickRatioForSize, ratiosForSelectedSize, type ConsumerImageModel } from './image-size-ratios';

const gpt: ConsumerImageModel = {
  supported_sizes: [
    { id: '1K', label: '1K', available_aspect_ratios: ['1:1', '3:2', '2:3'] },
    { id: '2K', label: '2K', available_aspect_ratios: ['1:1', '16:9', '9:16'] },
  ],
  supported_aspect_ratios: ['1:1', '16:9', '9:16', '3:2', '2:3'],
  default_aspect_ratio: '1:1',
};

const lightAuto: ConsumerImageModel = {
  supported_sizes: [
    { id: '1K', label: '1K', available_aspect_ratios: ['1:1', '16:9', '9:16'] },
    { id: '2K', label: '2K', available_aspect_ratios: ['1:1', '16:9', '9:16'] },
  ],
  supported_aspect_ratios: ['1:1', '16:9', '9:16'],
  default_aspect_ratio: '1:1',
};

describe('ratiosForSelectedSize', () => {
  it('GPT 全量 1K 不出现 16:9 / 9:16', () => {
    expect(ratiosForSelectedSize(gpt, '1K')).toEqual(['1:1', '3:2', '2:3']);
  });

  it('切到 2K 后出现 16:9', () => {
    expect(ratiosForSelectedSize(gpt, '2K')).toContain('16:9');
  });

  it('GPT light 整表 auto 时比例仍按已填组合展示', () => {
    expect(ratiosForSelectedSize(lightAuto, '1K')).toEqual(['1:1', '16:9', '9:16']);
  });

  it('旧接口没有 available_aspect_ratios 时回退全量比例', () => {
    const seedream: ConsumerImageModel = {
      supported_sizes: [{ id: '2K', label: '2K' }],
      supported_aspect_ratios: ['1:1', '16:9'],
    };
    expect(ratiosForSelectedSize(seedream, '2K')).toEqual(['1:1', '16:9']);
  });
});

describe('pickRatioForSize', () => {
  it('当前比例在新尺寸下仍可用则保留', () => {
    expect(pickRatioForSize(gpt, '2K', '1:1')).toBe('1:1');
  });

  it('1K 下的 16:9 在切换后夹到默认 1:1', () => {
    expect(pickRatioForSize(gpt, '1K', '16:9')).toBe('1:1');
  });
});
