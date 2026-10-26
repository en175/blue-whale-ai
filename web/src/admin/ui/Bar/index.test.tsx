// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Bar from './index';

let root: Root;
let mountNode: HTMLDivElement;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mountNode.remove();
});

async function render(props: Parameters<typeof Bar>[0]): Promise<HTMLElement> {
  await act(async () => {
    root.render(createElement(Bar, props));
  });
  return mountNode.firstElementChild as HTMLElement;
}

function fillWidth(el: HTMLElement): string {
  const track = el.lastElementChild;
  const fill = track === null ? null : track.firstElementChild;
  if (!(fill instanceof HTMLElement)) throw new Error('没有渲染出比例条的填充');
  return fill.style.width;
}

describe('Bar', () => {
  it('渲染类别名、数值与一位小数的占比', async () => {
    const el = await render({ label: '视频', value: '120', ratio: 0.4 });

    expect(el.textContent).toContain('视频');
    expect(el.textContent).toContain('120');
    expect(el.textContent).toContain('40.0%');
    expect(fillWidth(el)).toBe('40%');
  });

  it('★ 占比是四舍五入的，不为了凑满 100% 而动某一条', async () => {
    const el = await render({ label: '图片', value: '1', ratio: 1 / 3 });

    expect(el.textContent).toContain('33.3%');
  });

  it('★ 分母缺失（ratio 为 NaN）时画成 0%，不出现 NaN%', async () => {
    const el = await render({ label: '视频', value: '0', ratio: Number.NaN });

    expect(el.textContent).not.toContain('NaN');
    expect(el.textContent).toContain('0.0%');
    expect(fillWidth(el)).toBe('0%');
  });

  it('越界的占比被钳回 [0,1]，不会画出超长或反向的条', async () => {
    expect(fillWidth(await render({ label: 'a', value: '1', ratio: 1.5 }))).toBe('100%');

    await act(async () => root.unmount());
    root = createRoot(mountNode);
    expect(fillWidth(await render({ label: 'a', value: '1', ratio: -0.5 }))).toBe('0%');
  });

  it('100% 与 0% 都能正常显示（单类型区间 / 类型数为 0 的行）', async () => {
    expect((await render({ label: '视频', value: '9', ratio: 1 })).textContent).toContain('100.0%');

    await act(async () => root.unmount());
    root = createRoot(mountNode);
    const zero = await render({ label: '音频', value: '0', ratio: 0 });
    expect(zero.textContent).toContain('0.0%');
    expect(fillWidth(zero)).toBe('0%');
  });
});
