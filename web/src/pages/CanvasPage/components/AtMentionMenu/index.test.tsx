// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import AtMentionMenu from './index';

let root: Root;
let host: HTMLDivElement;
const image = { id: 'node-1', assetId: '101', kind: 'image' as const, name: '图片节点 1' };
async function render(overrides: { onClose?: () => void; onEscapeClose?: () => void } = {}) {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const onSelect = vi.fn();
  const onSelectReferenced = vi.fn();
  await act(async () => root.render(createElement(AtMentionMenu, {
    anchorRef: { current: host }, editorQuery: '', onClose: overrides.onClose ?? vi.fn(), onSelect,
    onEscapeClose: overrides.onEscapeClose,
    items: [image, { id: 'v1', kind: 'video', name: '视频节点 1' }, { id: 't1', kind: 'text', name: '文本节点 1' }],
    referencedItems: [{ ...image, badge: '图片1' }], onSelectReferenced,
    disabledKinds: ['video'],
  })));
  return { onSelect, onSelectReferenced };
}
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); });

it('同一菜单直接呈现已引用和原有四种素材分类', async () => {
  await render();
  const menu = document.querySelector('input[placeholder="搜索"]')!.parentElement!.parentElement!;
  expect(menu.textContent).toContain('已引用');
  expect(menu.textContent).toContain('素材引用');
  for (const label of ['图片', '视频', '音频', '文本']) {
    expect([...menu.querySelectorAll('button')].some(b => b.textContent === label)).toBe(true);
  }
  expect(menu.querySelector('input[placeholder="搜索"]')).toBeTruthy();
});

it('统一搜索保留跨分区重复项、类型分组及禁用状态，点击分派到各自引用动作', async () => {
  const { onSelect, onSelectReferenced } = await render();
  const input = document.querySelector('input[placeholder="搜索"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '1');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const menu = document.querySelector('input[placeholder="搜索"]')!.parentElement!.parentElement!;
  const matches = [...menu.querySelectorAll('button')].filter(b => b.textContent?.includes('图片节点 1'));
  expect(matches).toHaveLength(2);
  expect(menu.textContent).toContain('文本节点 1');
  const video = [...menu.querySelectorAll('button')].find(b => b.textContent === '视频节点 1')!;
  expect(video.disabled).toBe(true);
  await act(async () => matches[0].click());
  expect(onSelectReferenced).toHaveBeenCalledWith(expect.objectContaining({ assetId: '101' }));
  expect(onSelect).not.toHaveBeenCalled();
  await act(async () => matches[1].click());
  expect(onSelect).toHaveBeenCalledWith(image);
});


it('搜索框向上导航从最后一个可选项开始，跳过禁用分类', async () => {
  await render();
  const input = document.querySelector('input[placeholder="搜索"]') as HTMLInputElement;
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })));
  expect(document.activeElement?.textContent).toBe('文本');
});

async function key(key: string) {
  await act(async () => document.activeElement!.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  ));
}

it('画布捕获监听存在时，Enter 仍确认已引用素材', async () => {
  const { canvasDeleteKeyAction } = await import('../Canvas/keyboardDelete');
  const capture = (event: KeyboardEvent) => {
    if (canvasDeleteKeyAction(event.key, event.target) === 'block') {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  document.addEventListener('keydown', capture, true);
  try {
    const { onSelectReferenced } = await render();
    await key('ArrowDown');
    await key('Enter');
    expect(onSelectReferenced).toHaveBeenCalledTimes(1);
  } finally {
    document.removeEventListener('keydown', capture, true);
  }
});

it('分类右键进入、左键返回，Enter 进入并确认素材', async () => {
  const { onSelect } = await render();
  await key('ArrowDown');
  await key('ArrowDown');
  expect(document.activeElement?.textContent).toBe('图片');
  await key('ArrowRight');
  expect(document.activeElement?.textContent).toBe('图片节点 1');
  await key('ArrowLeft');
  expect(document.activeElement?.textContent).toBe('图片');
  await key('ArrowDown');
  expect(document.activeElement?.textContent).toBe('音频');
  await key('ArrowUp');
  await key('Enter');
  expect(document.activeElement?.textContent).toBe('图片节点 1');
  await key('Enter');
  expect(onSelect).toHaveBeenCalledWith(image);
});

it('从末尾分类循环回已引用时清除分类高亮并关闭子菜单', async () => {
  await render();
  await key('ArrowUp');
  const category = document.activeElement as HTMLButtonElement;
  expect(category.textContent).toBe('文本');
  expect(document.querySelector('[data-mention-flyout]')).toBeTruthy();
  const activeClass = category.className;
  await key('ArrowDown');
  expect(document.activeElement?.getAttribute('data-testid')).toBe('mention-ref-item');
  expect(document.querySelector('[data-mention-flyout]')).toBeNull();
  expect(category.className).not.toBe(activeClass);
  await key('ArrowUp');
  expect(document.activeElement).toBe(category);
  expect(document.querySelector('[data-mention-flyout]')).toBeTruthy();
});

/** IKFR6A：菜单定位优先锚点上方，上方放不下才翻到下方（全产品统一） */
function rectOf(top: number, bottom: number, left = 100): DOMRect {
  return { top, bottom, left, right: left + 20, width: 20, height: bottom - top, x: left, y: top, toJSON: () => '' } as DOMRect;
}

async function renderWithAnchorRect(rect: DOMRect) {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  host.getBoundingClientRect = () => rect;
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(AtMentionMenu, {
    anchorRef: { current: host }, editorQuery: '', onClose: vi.fn(), onSelect: vi.fn(),
    items: [image],
  })));
}

it('锚点在屏幕中下部时菜单优先出现在锚点上方', async () => {
  await renderWithAnchorRect(rectOf(400, 410));
  const menu = document.querySelector('[data-testid="mention-menu"]') as HTMLElement;
  // estHeight=300（jsdom offsetHeight=0 回退），top = 400 - 300 - 6
  expect(menu.style.top).toBe('94px');
});

it('锚点贴近屏幕顶部放不下时菜单翻到锚点下方', async () => {
  await renderWithAnchorRect(rectOf(100, 110));
  const menu = document.querySelector('[data-testid="mention-menu"]') as HTMLElement;
  expect(menu.style.top).toBe('116px');
});

/** IKFO27：子菜单与触发它的分类行顶部对齐。jsdom 没有布局，按元素角色注入几何。 */
const KIND_ORDER = ['image', 'video', 'audio', 'text'];

function stubMenuLayout(flyoutHeight: number) {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.hasAttribute('data-mention-main')) return rectOf(300, 542);
    const kind = this.getAttribute('data-mention-kind');
    // 面板顶部 300 + 内边距 10 + 搜索框 36 + 间距 8 + 小标题 18，每行 38
    if (kind) return rectOf(372 + KIND_ORDER.indexOf(kind) * 38, 372 + KIND_ORDER.indexOf(kind) * 38 + 38);
    if (this.firstElementChild?.hasAttribute('data-mention-flyout')) return rectOf(300, 300 + flyoutHeight);
    return rectOf(0, 0);
  });
}

function flyoutWrapEl(): HTMLElement {
  return document.querySelector('[data-mention-flyout]')!.parentElement as HTMLElement;
}

it('子菜单跟随触发它的分类行下移', async () => {
  const spy = stubMenuLayout(56);
  try {
    await render();
    await key('ArrowUp');
    expect(document.activeElement?.textContent).toBe('文本');
    // 「文本」行顶部相对面板 72 + 3×38 = 186
    expect(flyoutWrapEl().style.top).toBe('186px');
  } finally { spy.mockRestore(); }
});

it('切换分类行时子菜单跟着那一行走', async () => {
  const spy = stubMenuLayout(56);
  try {
    await render();
    await key('ArrowUp');
    expect(flyoutWrapEl().style.top).toBe('186px');
    await key('ArrowUp');
    expect(document.activeElement?.textContent).toBe('音频');
    expect(flyoutWrapEl().style.top).toBe('148px');
  } finally { spy.mockRestore(); }
});

it('子菜单下方放不下时上移贴住面板底部', async () => {
  const spy = stubMenuLayout(232);
  try {
    await render();
    await key('ArrowUp');
    expect(flyoutWrapEl().style.top).toBe('10px');
  } finally { spy.mockRestore(); }
});

it('鼠标从分类行移到子菜单后子菜单仍在且位置不变', async () => {
  const spy = stubMenuLayout(56);
  try {
    await render();
    await key('ArrowUp');
    const row = document.activeElement as HTMLElement;
    const wrap = flyoutWrapEl();
    await act(async () => {
      row.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: wrap }));
      wrap.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: row }));
    });
    expect(document.querySelector('[data-mention-flyout]')).toBeTruthy();
    expect(flyoutWrapEl().style.top).toBe('186px');
  } finally { spy.mockRestore(); }
});

/** IKFXOR：区分关闭来源——Esc 走 onEscapeClose（调用方借此还焦编辑器），点外仍走 onClose 不抢焦 */
it('Esc 走 onEscapeClose、点外仍走 onClose（区分关闭来源）', async () => {
  const onClose = vi.fn();
  const onEscapeClose = vi.fn();
  await render({ onClose, onEscapeClose });
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(onEscapeClose).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => document.body.dispatchEvent(new Event('pointerdown')));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onEscapeClose).toHaveBeenCalledTimes(1);
});

it('未传 onEscapeClose 时 Esc 与点外同走 onClose（文本节点/音频面板现状不回归）', async () => {
  const onClose = vi.fn();
  await render({ onClose });
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () => document.body.dispatchEvent(new Event('pointerdown')));
  expect(onClose).toHaveBeenCalledTimes(2);
});
