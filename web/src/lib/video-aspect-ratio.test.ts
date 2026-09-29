import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { videoRatioLabel } from './video-aspect-ratio';

// IKJ4W6：视频比例内部键 `adaptive` 界面统一显示 `auto`。
// 映射只服务于**展示**——提交/草稿/上游报文仍是内部键（见下方消费点源码断言）。

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

describe('IKJ4W6 显示映射消费点', () => {
  const consumers = [
    ['首页下拉', 'pages/Home/components/ChatBox/index.tsx'],
    ['画布面板', 'pages/CanvasPage/components/BottomDialog/index.tsx'],
  ] as const;

  it.each(consumers)('%s 经 videoRatioLabel 渲染（触发按钮 + 选项各一处）', (_name, rel) => {
    const src = readSrc(rel);
    expect(src).toMatch(/import \{ videoRatioLabel \} from '@\/lib\/video-aspect-ratio'/);
    // 两处渲染点：当前值 + 选项值。任一被改回裸键（渲染变量本身）计数即掉到 1。
    expect((src.match(/videoRatioLabel\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
