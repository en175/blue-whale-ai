// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Pagination from './index';

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

interface Props {
  page: number;
  hasNext: boolean;
  total?: number;
  loading?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
}

async function render(props: Props): Promise<HTMLElement> {
  await act(async () => {
    root.render(
      createElement(Pagination, {
        pageSize: 20,
        onPrev: props.onPrev ?? (() => undefined),
        onNext: props.onNext ?? (() => undefined),
        ...props,
      }),
    );
  });
  return mountNode.firstElementChild as HTMLElement;
}

function button(el: HTMLElement, label: string): HTMLButtonElement {
  const found = [...el.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!found) throw new Error(`没有找到按钮：${label}`);
  return found;
}

describe('Pagination', () => {
  it('显示页码与每页条数', async () => {
    const pager = await render({ page: 3, hasNext: true });
    expect(pager.textContent).toContain('第 3 页');
    expect(pager.textContent).toContain('每页 20 条');
  });

  it('没有总数时不编一个数出来（billing 账本给不了总数）', async () => {
    const pager = await render({ page: 1, hasNext: true });
    expect(pager.textContent).not.toContain('共');
  });

  it('有总数时显示共 N 条（本地表能算）', async () => {
    const pager = await render({ page: 1, hasNext: true, total: 1234 });
    expect(pager.textContent).toContain('共 1,234 条');
  });

  it('第 1 页禁用「上一页」', async () => {
    const pager = await render({ page: 1, hasNext: true });
    expect(button(pager, '上一页').disabled).toBe(true);
    expect(button(pager, '下一页').disabled).toBe(false);
  });

  it('没有下一页时禁用「下一页」——由 hasNext 决定，不由 total 推', async () => {
    // 游标分页拿不到 total，能回答「还能不能翻」的只有服务端给的游标
    const pager = await render({ page: 2, hasNext: false });
    expect(button(pager, '下一页').disabled).toBe(true);
    expect(button(pager, '上一页').disabled).toBe(false);
  });

  it('请求中两个按钮都禁用（连点会翻过一页）', async () => {
    const pager = await render({ page: 2, hasNext: true, loading: true });
    expect(button(pager, '上一页').disabled).toBe(true);
    expect(button(pager, '下一页').disabled).toBe(true);
  });

  it('点击回调传出', async () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const pager = await render({ page: 2, hasNext: true, onPrev, onNext });

    await act(async () => button(pager, '上一页').click());
    await act(async () => button(pager, '下一页').click());

    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
