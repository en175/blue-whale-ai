import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pickDefaultVideoRatio, videoRatioLabel } from './video-aspect-ratio';


const readSrc = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('videoRatioLabel', () => {
  it('adaptive 展示为 auto', () => {
    expect(videoRatioLabel('adaptive')).toBe('auto');
  });

  it('固定比例档原样返回', () => {
    for (const ratio of ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']) {
      expect(videoRatioLabel(ratio)).toBe(ratio);
    }
  });

  it('未登记值与空串原样返回', () => {
    expect(videoRatioLabel('')).toBe('');
    expect(videoRatioLabel('weird')).toBe('weird');
  });

  it('展示名不回写内部名：auto 仍是 auto，不是 adaptive', () => {
    expect(videoRatioLabel('auto')).toBe('auto');
  });
});

describe('pickDefaultVideoRatio', () => {
  it('能力行含 adaptive 时默认选 adaptive（不依赖后端 default_aspect_ratio）', () => {
    expect(pickDefaultVideoRatio(['16:9', '9:16', 'adaptive'], '16:9')).toBe('adaptive');
  });

  it('不含 adaptive 时用能力行默认值', () => {
    expect(pickDefaultVideoRatio(['16:9', '9:16'], '9:16')).toBe('9:16');
  });

  it('默认值不在列表里时回落第一项', () => {
    expect(pickDefaultVideoRatio(['16:9', '1:1'], '21:9')).toBe('16:9');
  });

  it('空列表返回空串', () => {
    expect(pickDefaultVideoRatio([])).toBe('');
  });
});

describe('IKJ4W6 显示映射消费点', () => {
  const consumers = [
    ['首页下拉', 'app/pages/Home/components/ChatBox/index.tsx'],
    ['画布面板', 'app/pages/CanvasPage/components/BottomDialog/index.tsx'],
  ] as const;

  it.each(consumers)('%s 经 videoRatioLabel 渲染，并默认走 pickDefaultVideoRatio', (_name, rel) => {
    const src = readSrc(rel);
    expect(src).toMatch(/import \{[^}]*videoRatioLabel[^}]*\} from '@\/utils\/video-aspect-ratio'/);
    expect((src.match(/videoRatioLabel\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/pickDefaultVideoRatio\(/);
  });
});
