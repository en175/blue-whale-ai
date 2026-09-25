// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Field from './index';

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

async function render(props: Parameters<typeof Field>[0]): Promise<HTMLElement> {
  await act(async () => {
    root.render(createElement(Field, props));
  });
  return mountNode.firstElementChild as HTMLElement;
}

describe('Field', () => {
  it('标签、控件、说明都在同一块里（说明属于字段，不是外部注释）', async () => {
    const el = await render({
      label: '基准单价',
      hint: '单位 mc：1 积分 = 1000 mc',
      children: createElement('input', { 'aria-label': '基准单价' }),
    });

    expect(el.textContent).toContain('基准单价');
    expect(el.textContent).toContain('单位 mc：1 积分 = 1000 mc');
    expect(el.querySelector('input')).not.toBeNull();
  });

  it('没有 hint 时不渲染说明区（不留一行空白）', async () => {
    const el = await render({
      label: '模型 ID',
      children: createElement('input', { 'aria-label': '模型 ID' }),
    });

    expect(el.children).toHaveLength(2);
  });

  it('★ 标签不是 <label for>：一个字段可能带多个控件（键值对列表），点标签会聚错地方', async () => {
    const el = await render({
      label: '附加维度',
      children: createElement('input', { 'aria-label': '维度键' }),
    });

    expect(el.querySelector('label')).toBeNull();
  });
});
