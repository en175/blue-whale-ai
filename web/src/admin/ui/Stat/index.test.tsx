// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Stat, { type StatTone } from './index';

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

async function render(props: Parameters<typeof Stat>[0]): Promise<HTMLElement> {
  await act(async () => {
    root.render(createElement(Stat, props));
  });
  return mountNode.firstElementChild as HTMLElement;
}

describe('Stat', () => {
  it('渲染标签与数值', async () => {
    const el = await render({ label: '总用户', value: '1,234 人' });
    expect(el.textContent).toContain('总用户');
    expect(el.textContent).toContain('1,234 人');
  });

  it('★ 数值原样显示 —— 单位与千分位是页面的业务知识，组件不重排', async () => {
    const el = await render({ label: '今日充值', value: '0 积分' });
    expect(el.textContent).toContain('0 积分');
  });

  it('hint 渲染在数值下方，不传则不占位', async () => {
    const withHint = await render({ label: 'a', value: 'b', hint: '较昨日 +12%' });
    expect(withHint.textContent).toContain('较昨日 +12%');
    const childrenWithHint = withHint.children.length;

    await act(async () => root.unmount());
    root = createRoot(mountNode);
    const without = await render({ label: 'a', value: 'b' });
    expect(without.children.length).toBeLessThan(childrenWithHint);
  });

  it('★ 图标对读屏隐藏 —— 它只是视觉强化，数值本身才是信息', async () => {
    const el = await render({
      label: '总用户',
      value: '10 人',
      icon: createElement('svg', { 'data-testid': 'icon' }),
    });
    const box = el.querySelector('[aria-hidden="true"]');
    expect(box).not.toBeNull();
    expect(box?.getAttribute('aria-hidden')).toBe('true');
  });

  it('不同色调产出不同样式', async () => {
    const tones: StatTone[] = ['accent', 'success', 'warning', 'danger', 'neutral'];
    const classes: string[] = [];
    for (const tone of tones) {
      const el = await render({
        label: 'a',
        value: 'b',
        tone,
        icon: createElement('svg', null),
      });
      classes.push((el.querySelector('[aria-hidden="true"]') as HTMLElement).className);
      await act(async () => root.unmount());
      root = createRoot(mountNode);
    }
    expect(new Set(classes).size).toBe(tones.length);
  });
});
