// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import RatioIcon from './index';

let root: Root;
let mountNode: HTMLDivElement;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mountNode.remove();
});

async function renderIcon(ratio: string, size?: number): Promise<HTMLElement> {
  await act(async () => {
    root.render(createElement(RatioIcon, size === undefined ? { ratio } : { ratio, size }));
  });
  return mountNode.querySelector('span') as HTMLElement;
}

/** 合法比例用例：[比例字符串, 期望宽, 期望高]（默认 size=16，最长边固定 16，另一边按真实比例等比缩放） */
const RATIO_CASES: Array<[string, number, number]> = [
  ['1:1', 16, 16],
  ['4:3', 16, 12],
  ['3:4', 12, 16],
  ['16:9', 16, 9],
  ['9:16', 9, 16],
  ['3:2', 16, 11],
  ['2:3', 11, 16],
  ['21:9', 16, 7],
  ['9:21', 7, 16],
  ['2:1', 16, 8],
  ['1:2', 8, 16],
  ['3:1', 16, 5],
  ['1:3', 5, 16],
  ['5:4', 16, 13],
  ['4:5', 13, 16],
];

describe('RatioIcon 共享组件（IKGBTV）', () => {
  it.each(RATIO_CASES)('%s 按真实比例渲染为 %i×%i（横竖不反）', async (ratio, width, height) => {
    const icon = await renderIcon(ratio);
    expect(icon.style.width).toBe(`${width}px`);
    expect(icon.style.height).toBe(`${height}px`);
  });

  it.each(RATIO_CASES)('%s 最长边不超过 16px 上限', async (ratio) => {
    const icon = await renderIcon(ratio);
    const width = parseFloat(icon.style.width);
    const height = parseFloat(icon.style.height);
    expect(Math.max(width, height)).toBe(16);
  });

  it('size=22（首页场景）按比例放大，最长边 22', async () => {
    const wide = await renderIcon('16:9', 22);
    expect(wide.style.width).toBe('22px');
    expect(wide.style.height).toBe('12px');

    const tall = await renderIcon('9:16', 22);
    expect(tall.style.width).toBe('12px');
    expect(tall.style.height).toBe('22px');

    const square = await renderIcon('1:1', 22);
    expect(square.style.width).toBe('22px');
    expect(square.style.height).toBe('22px');
  });

  it.each(['', 'abc', '1:', ':2', '0:9', '9:0', '-1:2', '1:2:3'])(
    '非法比例值 %j 兜底渲染正方形',
    async (ratio) => {
      const icon = await renderIcon(ratio);
      expect(icon.style.width).toBe('16px');
      expect(icon.style.height).toBe('16px');
    },
  );

  it('非法比例值在首页尺寸下同样兜底正方形', async () => {
    const icon = await renderIcon('abc', 22);
    expect(icon.style.width).toBe('22px');
    expect(icon.style.height).toBe('22px');
  });
});

/* 接入点静态断言（IKGBTV）：三处实现收敛为共享组件，接入点统一引用；
   首页 22px 经 size 参数传入，画布沿用默认 16px；本地实现与查表法全部拆除 */
describe('RatioIcon 接入点收敛', () => {
  const readSrc = (rel: string) => readFileSync(join(__dirname, '../..', rel), 'utf8');
  const imageDialog = readSrc('pages/CanvasPage/components/ImageDialog/index.tsx');
  const bottomDialog = readSrc('pages/CanvasPage/components/BottomDialog/index.tsx');
  const chatBox = readSrc('pages/Home/components/ChatBox/index.tsx');
  const cropDialog = readSrc('pages/CanvasPage/components/CropDialog/index.tsx');

  it('ImageDialog 引用共享组件且不再保留本地实现', () => {
    expect(imageDialog).toMatch(/import RatioIcon from '@\/components\/RatioIcon'/);
    expect(imageDialog).not.toMatch(/function RatioIcon/);
  });

  it('BottomDialog 引用共享组件且不再保留本地实现', () => {
    expect(bottomDialog).toMatch(/import RatioIcon from '@\/components\/RatioIcon'/);
    expect(bottomDialog).not.toMatch(/function RatioIcon/);
  });

  it('ChatBox 引用共享组件并以 size={22} 调用，查表法已拆除', () => {
    expect(chatBox).toMatch(/import RatioIcon from '@\/components\/RatioIcon'/);
    expect(chatBox).not.toMatch(/function RatioIcon/);
    expect(chatBox).not.toMatch(/ratioDims/);
    const calls = chatBox.match(/<RatioIcon ratio=\{[^}]+\} size=\{22\} \/>/g) ?? [];
    expect(calls).toHaveLength(4);
  });

  it('CropDialog（IKGW1N 裁切比例选项）引用共享组件且不保留本地实现', () => {
    expect(cropDialog).toMatch(/import RatioIcon from '@\/components\/RatioIcon'/);
    expect(cropDialog).not.toMatch(/function RatioIcon/);
  });

  it('画布接入不传 size，沿用默认 16px', () => {
    for (const src of [imageDialog, bottomDialog, cropDialog]) {
      const calls = src.match(/<RatioIcon [^/]*\/>/g) ?? [];
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) expect(call).not.toContain('size');
    }
  });
});
