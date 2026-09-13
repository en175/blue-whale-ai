// @vitest-environment jsdom
/* IKFCKT：参考栏拖拽排序共享层——arrayMove 换位纯函数 + useRefStripDrag 状态机
   （dragStart 记起点 / dragOver 前后半落点指示 / drop 换位回调 / dragEnd 复位 / 只读禁拖），
   及 RefThumbnail dragProps 透传（根节点 draggable、img 原生拖拽禁用、× 点击与拖拽手势互不干扰） */
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { arrayMove, splitReorder, useRefStripDrag } from './strip-dnd';
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

describe('splitReorder 统一序列类型拆分（IKFCKT）', () => {
  it('跨类型拖拽：媒体段与文本段各自保序提取，子序变化精确标记', () => {
    // 统一序列 [m1, m2, t1, t2]：拖 t2(index 3) 到 m1(index 0) 前 → [t2, m1, m2, t1]
    const r = splitReorder(['m1', 'm2'], ['t1', 't2'], 3, 0);
    expect(r.nextMedia).toEqual(['m1', 'm2']);
    expect(r.nextText).toEqual(['t2', 't1']);
    expect(r.mediaChanged).toBe(false);
    expect(r.textChanged).toBe(true);
  });
  it('同类型拖拽：仅对应段变化', () => {
    const r = splitReorder(['m1', 'm2'], ['t1'], 0, 1);
    expect(r.nextMedia).toEqual(['m2', 'm1']);
    expect(r.nextText).toEqual(['t1']);
    expect(r.mediaChanged).toBe(true);
    expect(r.textChanged).toBe(false);
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
