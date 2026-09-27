// @vitest-environment jsdom
/* IKFCKT：参考栏拖拽排序共享层——arrayMove 换位纯函数 + useRefStripDrag 状态机
   （dragStart 记起点 / dragOver 前后半落点指示 / drop 换位回调 / dragEnd 复位 / 只读禁拖），
   及 RefThumbnail dragProps 透传（根节点 draggable、img 原生拖拽禁用、× 点击与拖拽手势互不干扰） */
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { arrayMove, useRefStripDrag, useMixedRefStrip } from './strip-dnd';
import RefThumbnail from './index';

/** jsdom 无 DragEvent 且 rect 恒 0：手工挂 dataTransfer / clientX，rect 按需 mock */
function dragEvent(type: 'dragstart' | 'dragover' | 'drop' | 'dragend', init?: { clientX?: number }) {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    dataTransfer?: { setData: () => void; effectAllowed: string; dropEffect: string };
    clientX: number;
  };
  event.dataTransfer = { setData: () => {}, effectAllowed: '', dropEffect: '' };
  event.clientX = init?.clientX ?? 0;
  return event;
}

function rectSpy(rect: { left: number; width: number }) {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: rect.left, width: rect.width, right: rect.left + rect.width, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
}

/** 换位回调记录（模块级：断言跨重渲染稳定，重渲染不吞掉已发生的回调） */
let reorderCalls: string[] = [];

/** 宿主：可拖拽缩略图列表，onReorder 驱动真实换位（编号随 index 重派生） */
function StripHost({ disabled }: { disabled?: boolean }) {
  const [items, setItems] = useState(['a', 'b', 'c']);
  const drag = useRefStripDrag({
    disabled,
    onReorder: (from, to) => {
      reorderCalls.push(`${from}->${to}`);
      setItems((prev) => arrayMove(prev, from, to));
    },
  });
  return createElement('div', null,
    ...items.map((id, i) => createElement(RefThumbnail, {
      key: id,
      kind: 'text',
      name: id,
      number: i + 1,
      textPreview: id,
      dragProps: drag.itemProps(i),
      'data-testid': `strip-${id}`,
    })),
  );
}

let root: Root;
let mountNode: HTMLDivElement;

async function renderHost(props: { disabled?: boolean } = {}) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(StripHost, props));
  });
}

const item = (id: string) => mountNode.querySelector(`[data-testid="strip-${id}"]`)! as HTMLElement;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  reorderCalls = [];
});

afterEach(() => {
  if (root) act(() => root.unmount());
  mountNode?.remove();
  vi.restoreAllMocks();
});

describe('arrayMove（IKFCKT）', () => {
  it('换位到目标槽位：移除后按下标插回', () => {
    expect(arrayMove(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(arrayMove(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(arrayMove(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  });
  it('原地与越界返回原序副本，不改入参', () => {
    const list = ['a', 'b'];
    expect(arrayMove(list, 1, 1)).toEqual(['a', 'b']);
    expect(arrayMove(list, 0, 5)).toEqual(['a', 'b']);
    expect(arrayMove(list, -1, 0)).toEqual(['a', 'b']);
    expect(list).toEqual(['a', 'b']);
  });
});

describe('useRefStripDrag 拖拽换位（IKFCKT）', () => {
  it('drop 到目标项后半：回调换位并按新序重编号', async () => {
    await renderHost();
    act(() => { item('a').dispatchEvent(dragEvent('dragstart')); });
    act(() => { item('c').dispatchEvent(dragEvent('dragover', { clientX: 50 })); });
    act(() => { item('c').dispatchEvent(dragEvent('drop', { clientX: 50 })); });
    expect(reorderCalls).toEqual(['0->2']);
    // 换位后编号按新序紧凑重派生：a=1 → 拖到末位后 b=1 c=2 a=3
    const badgeOf = (id: string) => item(id).querySelector('[data-testid="ref-thumb-badge"]')!.textContent;
    expect([badgeOf('a'), badgeOf('b'), badgeOf('c')]).toEqual(['3', '1', '2']);
  });

  it('drop 到目标项前半：插入位为该槽位', async () => {
    await renderHost();
    const spy = rectSpy({ left: 0, width: 100 });
    act(() => { item('c').dispatchEvent(dragEvent('dragstart')); });
    act(() => { item('a').dispatchEvent(dragEvent('dragover', { clientX: 10 })); });
    expect(item('a').getAttribute('data-strip-over')).toBe('before');
    act(() => { item('a').dispatchEvent(dragEvent('drop', { clientX: 10 })); });
    expect(spy).toHaveBeenCalled();
    expect(reorderCalls).toEqual(['2->0']);
  });

  it('drop 回自身槽位不触发换位', async () => {
    await renderHost();
    act(() => { item('b').dispatchEvent(dragEvent('dragstart')); });
    act(() => { item('b').dispatchEvent(dragEvent('dragover', { clientX: 50 })); });
    act(() => { item('b').dispatchEvent(dragEvent('drop', { clientX: 50 })); });
    expect(reorderCalls).toEqual([]);
  });

  it('拖起态与落点指示随 dragStart/dragOver 出现、dragEnd 复位', async () => {
    await renderHost();
    act(() => { item('a').dispatchEvent(dragEvent('dragstart')); });
    expect(item('a').getAttribute('data-strip-dragging')).toBe('true');
    act(() => { item('b').dispatchEvent(dragEvent('dragover', { clientX: 50 })); });
    expect(item('b').getAttribute('data-strip-over')).toBe('after');
    act(() => { item('a').dispatchEvent(dragEvent('dragend')); });
    expect(item('a').getAttribute('data-strip-dragging')).toBeNull();
    expect(item('b').getAttribute('data-strip-over')).toBeNull();
  });

  it('只读禁拖：draggable=false 且 drop 不换位', async () => {
    await renderHost({ disabled: true });
    expect(item('a').getAttribute('draggable')).toBe('false');
    act(() => { item('a').dispatchEvent(dragEvent('dragstart')); });
    act(() => { item('c').dispatchEvent(dragEvent('dragover', { clientX: 50 })); });
    act(() => { item('c').dispatchEvent(dragEvent('drop', { clientX: 50 })); });
    expect(reorderCalls).toEqual([]);
  });
});

describe('RefThumbnail dragProps 透传（IKFCKT）', () => {
  /** 宿主：hook 必须在组件渲染内调用——图片/视频双项参考栏 */
  function KindsHost({ onRemove, onInsertRef }: { onRemove?: () => void; onInsertRef?: () => void }) {
    const drag = useRefStripDrag({ onReorder: () => {} });
    return createElement('div', null,
      createElement(RefThumbnail, {
        kind: 'image', url: 'https://x/a.png', name: 'a', number: 1,
        onRemove,
        onInsertRef,
        dragProps: drag.itemProps(0),
        'data-testid': 'kinds-image',
      }),
      createElement(RefThumbnail, {
        kind: 'video', url: 'https://x/v.mp4', name: 'v', number: 2,
        dragProps: drag.itemProps(1),
        'data-testid': 'kinds-video',
      }),
    );
  }

  async function renderKinds(handlers: { onRemove?: () => void; onInsertRef?: () => void } = {}) {
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    await act(async () => {
      root.render(createElement(KindsHost, handlers));
    });
  }

  it('根节点承载 draggable，img/video 原生拖拽禁用（防图片 ghost 劫持手势）', async () => {
    await renderKinds();
    const img = mountNode.querySelector('[data-testid="kinds-image"]')!;
    const video = mountNode.querySelector('[data-testid="kinds-video"]')!;
    expect(img.getAttribute('draggable')).toBe('true');
    expect(img.querySelector('img')!.getAttribute('draggable')).toBe('false');
    expect(video.querySelector('video')!.getAttribute('draggable')).toBe('false');
  });

  it('× / @ 按钮点击与拖拽手势互不干扰：click 正常触发、不产生 dragstart', async () => {
    const onRemove = vi.fn();
    const onInsertRef = vi.fn();
    const dragStartSpy = vi.fn();
    await renderKinds({ onRemove, onInsertRef });
    mountNode.addEventListener('dragstart', dragStartSpy);
    const removeBtn = mountNode.querySelector('button[title="移除"]')!;
    act(() => { removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onRemove).toHaveBeenCalledTimes(1);
    const atBtn = mountNode.querySelector('button[title="插入引用"]')!;
    act(() => { atBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
    act(() => { atBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onInsertRef).toHaveBeenCalledTimes(1);
    expect(dragStartSpy).not.toHaveBeenCalled();
  });
});

describe('RefThumbnail 拖拽开始关闭预览（IKIQ89）', () => {
  // 真实 FloatingPortal 挂在 document.body（本文件不 mock floating-ui），预览查全文档
  const preview = () => document.querySelector('[data-testid="ref-thumb-preview"]');

  function hover(el: Element) {
    act(() => {
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    });
  }

  const wait = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

  it('预览打开状态下开始拖拽：浮层立即关闭（文本项也不走延迟窗）', async () => {
    await renderHost();
    hover(item('a'));
    await act(async () => { await wait(230); });
    await vi.waitFor(() => expect(preview()).toBeTruthy());
    act(() => { item('a').dispatchEvent(dragEvent('dragstart')); });
    expect(preview(), '拖拽开始即取消关闭计时并立即关闭预览').toBeNull();
  });

  it('悬停未满 200ms 开始拖拽：打开计时被取消，预览不再弹出', async () => {
    await renderHost();
    hover(item('a'));
    await act(async () => { await wait(80); });
    expect(preview()).toBeNull();
    act(() => { item('a').dispatchEvent(dragEvent('dragstart')); });
    await act(async () => { await wait(230); });
    expect(preview(), '200ms 打开计时已随 dragstart 取消').toBeNull();
  });

  it('拖拽开始关闭预览不影响换位链路：drop 换位与紧凑重编号照常', async () => {
    await renderHost();
    hover(item('a'));
    await act(async () => { await wait(230); });
    await vi.waitFor(() => expect(preview()).toBeTruthy());
    act(() => { item('a').dispatchEvent(dragEvent('dragstart')); });
    act(() => { item('c').dispatchEvent(dragEvent('dragover', { clientX: 50 })); });
    act(() => { item('c').dispatchEvent(dragEvent('drop', { clientX: 50 })); });
    expect(reorderCalls, '换位回调不受预览关闭影响').toEqual(['0->2']);
    const badgeOf = (id: string) => item(id).querySelector('[data-testid="ref-thumb-badge"]')!.textContent;
    expect([badgeOf('a'), badgeOf('b'), badgeOf('c')]).toEqual(['3', '1', '2']);
  });
});

function MixedHost({ media, text, saved, onChange }: { media: string[]; text: string[]; saved?: string[]; onChange?: (order: string[]) => void }) {
  const strip = useMixedRefStrip(media, text, { stripOrder: saved, onStripOrderChange: onChange });
  return createElement('div', null,
    createElement('button', { onClick: () => strip.reorder(2, 0) }, 'move'),
    ...strip.render(media.map(id => createElement('span', { 'data-item': true }, `media:${id}`)), text.map(id => createElement('span', { 'data-item': true }, `text:${id}`))),
  );
}

describe('混排序列的源同步', () => {
  it('父级回写媒体边子序时，不把已前移的素材库参考推回末尾', async () => {
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    const saved = ['media:material:m', 'text:t', 'media:node:a', 'media:node:b'];
    await act(async () => root.render(createElement(MixedHost, { media: ['node:a', 'node:b', 'material:m'], text: ['t'], saved })));
    await act(async () => root.render(createElement(MixedHost, { media: ['node:b', 'node:a', 'material:m'], text: ['t'], saved })));
    expect([...mountNode.querySelectorAll('[data-item]')].map(el => el.textContent)).toEqual(['media:material:m', 'text:t', 'media:node:b', 'media:node:a']);
  });

  it('已保存混排的参考增删会同步新的持久化顺序', async () => {
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    const onChange = vi.fn();
    const saved = ['text:t', 'media:a', 'media:b'];
    await act(async () => root.render(createElement(MixedHost, { media: ['a', 'b'], text: ['t'], saved, onChange })));
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => root.render(createElement(MixedHost, { media: ['a', 'c'], text: ['t'], saved, onChange })));
    expect(onChange).toHaveBeenLastCalledWith(['text:t', 'media:a', 'media:c']);
  });

  it('跨类型混排后增删保留相对位置，外部类型内重排只替换该类型的槽位', async () => {
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    const render = async (media: string[], text: string[]) => act(async () => root.render(createElement(MixedHost, { media, text })));
    const order = () => [...mountNode.querySelectorAll('[data-item]')].map(el => el.textContent);
    await render(['a', 'b'], ['t']);
    act(() => mountNode.querySelector('button')!.click());
    expect(order()).toEqual(['text:t', 'media:a', 'media:b']);
    await render(['a', 'b', 'c'], ['t']);
    expect(order()).toEqual(['text:t', 'media:a', 'media:b', 'media:c']);
    await render(['a', 'c'], ['t']);
    expect(order()).toEqual(['text:t', 'media:a', 'media:c']);
    await render(['c', 'a'], ['t']);
    expect(order()).toEqual(['text:t', 'media:c', 'media:a']);
  });
});
