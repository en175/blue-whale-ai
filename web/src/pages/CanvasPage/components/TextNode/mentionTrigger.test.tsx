// @vitest-environment jsdom
/* IKFUYA：文本节点 @ 菜单全位置触发口径（契约 §5）：正文任意位置逐键输入 @ 都弹出
   素材菜单——汉字/中文标点/英文字母/数字之后与行首/空格同等触发；粘贴进来的 @ 不
   触发；删除旧 @ 后重新输入可再次唤起。菜单打开后的交互（焦点进搜索框）保持现状。 */
/* IKFV91：取消关闭（Esc / 点菜单外）后光标恢复口径（契约 §5）：焦点回正文编辑器，
   光标恢复到打开菜单时的位置——insert 模式为 @ 后、重绑定菜单为打开前光标位；
   @ 保留为普通文本可退格。选中素材路径不回归。 */
/* IKFXDB：选中/替换/删除标签后的光标落点口径（契约 §5）：选中插入→光标落新标签后
   （插完继续写）；替换来源/重绑定→光标落替换后新标签后；删除标签→光标落被删标签
   原位置（相邻标签锚定接缝，唯一标签删除后正文无标签可锚、落编辑器末尾）。
   commitMediaEdit 全量重放销毁旧 DOM，恢复按（身份 nodeId + 同身份第几张 + 前/后）
   锚点在新 DOM 定位 chip。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import TextNode from './index';

beforeAll(() => {
  // jsdom 未实现 Range 几何 API 与 execCommand：@ 菜单锚点取光标 rect 用，粘贴插入用
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = function () { return rectOf(0, 0, 0); };
  }
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = function () { return [] as unknown as DOMRectList; };
  }
  Object.defineProperty(document, 'execCommand', {
    value: vi.fn(() => true),
    configurable: true,
    writable: true,
  });
});

const storeState = vi.hoisted(() => ({
  nodes: [
    { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: {} },
    { id: 'm1', type: 'mediaNode', position: { x: 200, y: 0 }, data: { assetId: 'a1', mediaType: 'image', src: 'http://img/m1.png', fileName: '素材图一' } },
    { id: 'm2', type: 'mediaNode', position: { x: 400, y: 0 }, data: { assetId: 'a2', mediaType: 'image', src: 'http://img/m2.png', fileName: '素材图二' } },
  ],
  edges: [{ id: 'e1', source: 'm1', target: 't1', data: { textIndex: true } }],
  transform: [0, 0, 1],
}));

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
  useStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
  useReactFlow: () => ({ setCenter: vi.fn() }),
}));

function rectOf(top: number, bottom: number, left: number): DOMRect {
  return { top, left, bottom, right: left + 20, width: 20, height: bottom - top, x: left, y: top, toJSON: () => '' } as DOMRect;
}

let root: Root;
let container: HTMLDivElement;
/** 最近一次 renderNode 注入的 onMediaIndexChange（选中路径断言用） */
let onMediaIndexChange: ReturnType<typeof vi.fn> | null = null;

async function renderNode(dataOverride: Record<string, unknown> = {}) {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onMediaIndexChange = vi.fn();
  await act(async () => root.render(createElement(TextNode, {
    id: 't1',
    type: 'textNode',
    selected: false,
    dragging: false,
    zIndex: 1,
    selectable: true,
    deletable: true,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    data: {
      toolMode: 'select' as const,
      title: '文本节点',
      text: '看这张图片1',
      mediaMentions: [{ start: 3, end: 6, nodeId: 'm1', assetId: 'a1' }],
      mediaRefs: [{ nodeId: 'm1', assetId: 'a1', mediaType: 'image' as const, name: '素材图一', url: 'http://img/m1.png' }],
      onTextChange: vi.fn(),
      onMediaIndexChange,
      onToast: vi.fn(),
      ...dataOverride,
    },
  } as never)));
  return { editor: container.querySelector<HTMLElement>('[data-placeholder="输入内容..."]')! };
}

/** 双击进入编辑：带上双击自带的 mouseup（真实序列——mouseUp 处理在编辑态才保存选区，
    否则会清掉编辑器外操作留下的光标锚点） */
async function enterEditing(editor: HTMLElement) {
  await act(async () => {
    editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    editor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
}

/** 把正文设为 fullText、光标落在末尾，再派发一次逐键输入 '@' */
async function typeAt(editor: HTMLElement, fullText: string) {
  editor.replaceChildren(document.createTextNode(fullText));
  const range = document.createRange();
  range.setStart(editor.firstChild!, fullText.length);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  await dispatchInput(editor, 'insertText', '@');
}

/** 派发指定 inputType 的输入事件（删除/粘贴产生的输入不走 insertText+'@' 守卫） */
async function dispatchInput(editor: HTMLElement, inputType: string, data: string | null) {
  const input = new Event('input', { bubbles: true }) as InputEvent;
  Object.defineProperty(input, 'inputType', { value: inputType });
  Object.defineProperty(input, 'data', { value: data });
  await act(async () => editor.dispatchEvent(input));
}

function menuOpen(): boolean {
  return document.querySelector('[data-testid="mention-menu"]') !== null;
}

/** 模拟焦点进菜单搜索框后编辑器选区漂移：把光标挪到指定 offset（默认正文开头，缺陷现场） */
function scatterSelection(editor: HTMLElement, offset = 0) {
  const range = document.createRange();
  range.setStart(editor.firstChild!, offset);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

/** 编辑器内折叠光标的 offset；光标不在编辑器或非折叠返回 null */
function caretOffsetIn(editor: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !editor.contains(range.startContainer)) return null;
  return range.startOffset;
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

it('汉字后逐键输入 @ 弹出素材菜单', async () => {
  const { editor } = await renderNode();
  await enterEditing(editor);
  await typeAt(editor, '生成一张图片@');
  expect(menuOpen()).toBe(true);
});

it('中文标点后逐键输入 @ 弹出素材菜单', async () => {
  const { editor } = await renderNode();
  await enterEditing(editor);
  await typeAt(editor, '看这张图，@');
  expect(menuOpen()).toBe(true);
});

it('英文字母与数字后逐键输入 @ 弹出素材菜单', async () => {
  const { editor } = await renderNode();
  await enterEditing(editor);
  await typeAt(editor, 'prompt42@');
  expect(menuOpen()).toBe(true);
});

it('行首输入 @ 弹出素材菜单', async () => {
  const { editor } = await renderNode();
  await enterEditing(editor);
  await typeAt(editor, '@');
  expect(menuOpen()).toBe(true);
});

it('空格后输入 @ 弹出素材菜单', async () => {
  const { editor } = await renderNode();
  await enterEditing(editor);
  await typeAt(editor, '看这张图 @');
  expect(menuOpen()).toBe(true);
});

it('粘贴含 @ 的文本不弹出菜单', async () => {
  const { editor } = await renderNode();
  await enterEditing(editor);
  editor.replaceChildren(document.createTextNode('前文'));
  const range = document.createRange();
  range.setStart(editor.firstChild!, 2);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  const paste = new Event('paste', { bubbles: true }) as ClipboardEvent;
  Object.defineProperty(paste, 'clipboardData', {
    value: { getData: (type: string) => (type === 'text/plain' ? '看这张@图片' : '') },
  });
  await act(async () => editor.dispatchEvent(paste));
  // execCommand 插入后浏览器派发的 input 事件 data 为 null——这是粘贴不触发的实际守卫
  await dispatchInput(editor, 'insertText', null);
  expect(menuOpen()).toBe(false);
});

it('删除旧 @ 后重新输入 @ 可再次唤起', async () => {
  const { editor } = await renderNode();
  await enterEditing(editor);
  await typeAt(editor, '@');
  expect(menuOpen()).toBe(true);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(menuOpen()).toBe(false);
  editor.replaceChildren();
  await dispatchInput(editor, 'deleteContentBackward', null);
  await typeAt(editor, '@');
  expect(menuOpen()).toBe(true);
});

it('菜单打开后焦点保持在搜索框', async () => {
  const { editor } = await renderNode();
  await enterEditing(editor);
  await typeAt(editor, '生成一张图片@');
  const search = document.querySelector<HTMLInputElement>('input[placeholder="搜索"]');
  expect(search).toBeTruthy();
  expect(document.activeElement).toBe(search);
});

it('Esc 取消菜单后焦点回正文、光标恢复到 @ 后', async () => {
  const { editor } = await renderNode();
  await enterEditing(editor);
  await typeAt(editor, '生成一张图片@');
  expect(menuOpen()).toBe(true);
  scatterSelection(editor);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(menuOpen()).toBe(false);
  expect(document.activeElement).toBe(editor);
  expect(caretOffsetIn(editor)).toBe('生成一张图片@'.length);
});

it('点击菜单外关闭后光标同样恢复到 @ 后', async () => {
  const { editor } = await renderNode();
  await enterEditing(editor);
  await typeAt(editor, '生成一张图片@');
  scatterSelection(editor);
  await act(async () => document.dispatchEvent(new Event('pointerdown')));
  expect(menuOpen()).toBe(false);
  expect(caretOffsetIn(editor)).toBe('生成一张图片@'.length);
});

it('搜索框过滤中按 Esc 取消，光标恢复到 @ 后', async () => {
  const { editor } = await renderNode();
  await enterEditing(editor);
  await typeAt(editor, '生成一张图片@');
  const search = document.querySelector<HTMLInputElement>('input[placeholder="搜索"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, '图');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  scatterSelection(editor);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(menuOpen()).toBe(false);
  expect(caretOffsetIn(editor)).toBe('生成一张图片@'.length);
});

/** 失效标签上打开「重新绑定」菜单再取消，光标应恢复到打开前位置 */
async function rebindCancelRestoresCaret(closeMenu: () => Promise<void>) {
  const { editor } = await renderNode();
  await enterEditing(editor);
  // 打开菜单前把光标放在正文 offset 2（模拟此前编辑位置）
  scatterSelection(editor, 2);
  const chip = editor.querySelector<HTMLElement>('[data-media-node="m1"]')!;
  await act(async () => chip.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const chipMenu = document.querySelector<HTMLElement>('[data-testid="media-chip-menu"]')!;
  const rebind = [...chipMenu.querySelectorAll('button')].find(b => b.textContent?.includes('重新绑定'))!;
  await act(async () => rebind.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(menuOpen()).toBe(true);
  scatterSelection(editor);
  await closeMenu();
  expect(menuOpen()).toBe(false);
  expect(caretOffsetIn(editor)).toBe(2);
}

it('失效标签「重新绑定」菜单按 Esc 取消后光标恢复到打开前位置', async () => {
  storeState.edges = [];
  try {
    await rebindCancelRestoresCaret(async () => {
      await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    });
  } finally {
    storeState.edges = [{ id: 'e1', source: 'm1', target: 't1', data: { textIndex: true } }];
  }
});

it('失效标签「重新绑定」菜单点外取消后光标同样恢复', async () => {
  storeState.edges = [];
  try {
    await rebindCancelRestoresCaret(async () => {
      await act(async () => document.dispatchEvent(new Event('pointerdown')));
    });
  } finally {
    storeState.edges = [{ id: 'e1', source: 'm1', target: 't1', data: { textIndex: true } }];
  }
});

it('选中素材插入路径不回归：菜单关闭且索引同步', async () => {
  const { editor } = await renderNode();
  await enterEditing(editor);
  await typeAt(editor, '生成一张图片@');
  const kindRow = document.querySelector<HTMLButtonElement>('[data-mention-kind="image"]')!;
  await act(async () => kindRow.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const item = document.querySelector<HTMLButtonElement>('[data-testid="at-mention-canvas-item"]')!;
  await act(async () => item.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(menuOpen()).toBe(false);
  expect(onMediaIndexChange).toHaveBeenCalled();
});

/* ---------- IKFXDB：选中/替换/删除标签后的光标落点 ---------- */

/** 同身份第 occurrence 张 chip（1-based；不足返回 null） */
function chipByNode(editor: HTMLElement, nodeId: string, occurrence: number): HTMLElement | null {
  const chips = [...editor.querySelectorAll<HTMLElement>(`[data-media-node="${CSS.escape(nodeId)}"]`)];
  return chips[occurrence - 1] ?? null;
}

/** 光标是否折叠落在 chip 紧前/紧后（startContainer 为 chip 父节点、offset 为 chip 下标或下标+1） */
function caretAtChip(chip: HTMLElement, placement: 'before' | 'after'): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || range.startContainer !== chip.parentNode) return false;
  const index = Array.prototype.indexOf.call(chip.parentNode!.childNodes, chip);
  return range.startOffset === (placement === 'after' ? index + 1 : index);
}

/** 光标是否折叠在编辑器内容末尾（无可锚落点的兜底位） */
function caretAtEnd(editor: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !editor.contains(range.startContainer)) return false;
  if (range.startContainer === editor) return range.startOffset === editor.childNodes.length;
  return range.startContainer === editor.lastChild
    && range.startOffset === (editor.lastChild!.textContent?.length ?? 0);
}

/** 光标折叠位换算为编辑器 DOM 文本流偏移（与 domTextOffsetOfChipStart 同口径）。
 *  支持文本节点与元素容器（元素 offset 按子节点累计文本长度换算）。 */
function caretTextOffset(editor: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !editor.contains(range.startContainer)) return null;
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    let offset = 0;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node === range.startContainer) return offset + range.startOffset;
      offset += node.textContent?.length ?? 0;
    }
  }
  if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
    let offset = 0;
    const childNodes = Array.from(range.startContainer.childNodes).slice(0, range.startOffset);
    for (const child of childNodes) {
      offset += child.textContent?.length ?? 0;
    }
    return offset;
  }
  return null;
}

/** 在 @ 菜单里选中指定名称的画布素材（展开图片分类后按名称点条目） */
async function selectMenuItem(name: string) {
  const kindRow = document.querySelector<HTMLButtonElement>('[data-mention-kind="image"]')!;
  await act(async () => kindRow.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const item = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="at-mention-canvas-item"]')]
    .find(button => button.textContent?.includes(name))!;
  await act(async () => item.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

it('选中素材插入后光标落新标签后', async () => {
  const { editor } = await renderNode();
  await enterEditing(editor);
  await typeAt(editor, '生成一张图片@');
  await selectMenuItem('素材图一');
  expect(menuOpen()).toBe(false);
  const chip = chipByNode(editor, 'm1', 1);
  expect(chip).toBeTruthy();
  expect(caretAtChip(chip!, 'after')).toBe(true);
});

it('同身份插入第二张标签后光标落第二张后', async () => {
  const { editor } = await renderNode();
  await enterEditing(editor);
  // 第一张 chip 后逐键输入 @：插入 '@' 文本节点并把光标落在其后（元素容器光标不触发菜单）
  const first = chipByNode(editor, 'm1', 1)!;
  const at = document.createTextNode('@');
  first.after(at);
  const range = document.createRange();
  range.setStart(at, 1);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  await dispatchInput(editor, 'insertText', '@');
  expect(menuOpen()).toBe(true);
  await selectMenuItem('素材图一');
  expect(editor.querySelectorAll('[data-media-node="m1"]').length).toBe(2);
  expect(caretAtChip(chipByNode(editor, 'm1', 2)!, 'after')).toBe(true);
});

it('替换来源后光标落替换后新标签后', async () => {
  const { editor } = await renderNode();
  await enterEditing(editor);
  const chip = chipByNode(editor, 'm1', 1)!;
  await act(async () => chip.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const chipMenu = document.querySelector<HTMLElement>('[data-testid="media-chip-menu"]')!;
  const replace = [...chipMenu.querySelectorAll('button')].find(button => button.textContent?.includes('替换来源'))!;
  await act(async () => replace.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(menuOpen()).toBe(true);
  await selectMenuItem('素材图二');
  expect(menuOpen()).toBe(false);
  expect(editor.querySelectorAll('[data-media-node="m1"]').length).toBe(0);
  const next = chipByNode(editor, 'm2', 1);
  expect(next).toBeTruthy();
  expect(caretAtChip(next!, 'after')).toBe(true);
});

it('删除标签后光标落被删标签原位置（精确文本偏移，非邻居处）', async () => {
  const { editor } = await renderNode({
    text: '看这张图片1再看这张图片1',
    mediaMentions: [
      { start: 3, end: 6, nodeId: 'm1', assetId: 'a1' },
      { start: 11, end: 14, nodeId: 'm1', assetId: 'a1' },
    ],
  });
  await enterEditing(editor);
  const chips = [...editor.querySelectorAll<HTMLElement>('[data-media-node="m1"]')];
  expect(chips.length).toBe(2);
  await act(async () => chips[1].dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const chipMenu = document.querySelector<HTMLElement>('[data-testid="media-chip-menu"]')!;
  const remove = [...chipMenu.querySelectorAll('button')].find(button => button.textContent?.includes('删除标签'))!;
  await act(async () => remove.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const rest = [...editor.querySelectorAll<HTMLElement>('[data-media-node="m1"]')];
  expect(rest.length).toBe(1);
  // 被删标签原位置：重放后 chip 展示 #N 在 DOM 文本流占 1 字符，
  // offset = 「看这张」(3) + chip(1) + 「再看这张」(4) + chip(1) + 「再」前两字(2) = 11
  expect(caretTextOffset(editor)).toBe(11);
});

it('删除同身份第一张标签后光标落被删位置（非剩余标签前）', async () => {
  const { editor } = await renderNode({
    text: '看这张图片1再看这张图片1',
    mediaMentions: [
      { start: 3, end: 6, nodeId: 'm1', assetId: 'a1' },
      { start: 11, end: 14, nodeId: 'm1', assetId: 'a1' },
    ],
  });
  await enterEditing(editor);
  const chips = [...editor.querySelectorAll<HTMLElement>('[data-media-node="m1"]')];
  await act(async () => chips[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const chipMenu = document.querySelector<HTMLElement>('[data-testid="media-chip-menu"]')!;
  const remove = [...chipMenu.querySelectorAll('button')].find(button => button.textContent?.includes('删除标签'))!;
  await act(async () => remove.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const rest = [...editor.querySelectorAll<HTMLElement>('[data-media-node="m1"]')];
  expect(rest.length).toBe(1);
  // 被删标签原位置 = 「看这张」之后（offset 3），不是剩余标签前（offset 7）
  expect(caretTextOffset(editor)).toBe(3);
});

it('失效多张标签重新绑定后光标落触发那张替换后的新标签后', async () => {
  storeState.edges = [];
  try {
    const { editor } = await renderNode({
      text: '看这张图片1再看这张图片1',
      mediaMentions: [
        { start: 3, end: 6, nodeId: 'm1', assetId: 'a1' },
        { start: 11, end: 14, nodeId: 'm1', assetId: 'a1' },
      ],
    });
    await enterEditing(editor);
    const chips = [...editor.querySelectorAll<HTMLElement>('[data-media-node="m1"]')];
    await act(async () => chips[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const chipMenu = document.querySelector<HTMLElement>('[data-testid="media-chip-menu"]')!;
    const rebind = [...chipMenu.querySelectorAll('button')].find(button => button.textContent?.includes('重新绑定'))!;
    await act(async () => rebind.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(menuOpen()).toBe(true);
    await selectMenuItem('素材图二');
    expect(editor.querySelectorAll('[data-media-node="m1"]').length).toBe(0);
    expect(editor.querySelectorAll('[data-media-node="m2"]').length).toBe(2);
    expect(caretAtChip(chipByNode(editor, 'm2', 1)!, 'after')).toBe(true);
  } finally {
    storeState.edges = [{ id: 'e1', source: 'm1', target: 't1', data: { textIndex: true } }];
  }
});

it('唯一标签删除后光标落被删位置（正文中间，不落编辑器末尾）', async () => {
  const { editor } = await renderNode({
    text: '看这张图片1好吗',
    mediaMentions: [{ start: 3, end: 6, nodeId: 'm1', assetId: 'a1' }],
  });
  await enterEditing(editor);
  const chip = chipByNode(editor, 'm1', 1)!;
  await act(async () => chip.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const chipMenu = document.querySelector<HTMLElement>('[data-testid="media-chip-menu"]')!;
  const remove = [...chipMenu.querySelectorAll('button')].find(button => button.textContent?.includes('删除标签'))!;
  await act(async () => remove.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(editor.querySelectorAll('[data-media-node]').length).toBe(0);
  expect(caretTextOffset(editor)).toBe(3);
  expect(caretAtEnd(editor)).toBe(false);
});

/* ---------- IKFXDB 追加：素材标签（prompt #N）新增/替换/删除后的光标落点 ---------- */

/** 素材标签场景：prompt 绑定文本卡，正文两张 chip（素材#1 / 素材#2） */
async function renderPromptNode() {
  return renderNode({
    promptSource: 'chat',
    text: '看这张素材#1中间素材#2结尾',
    promptMentions: [
      { start: 3, end: 7, assetId: 'a1', index: 1 },
      { start: 9, end: 13, assetId: 'a2', index: 2 },
    ],
    promptMaterials: [
      { assetId: 'a1', mediaType: 'image' as const, url: 'http://img/m1.png' },
      { assetId: 'a2', mediaType: 'image' as const, url: 'http://img/m2.png' },
    ],
    mediaMentions: [],
    mediaRefs: [],
    onPromptChange: vi.fn(),
  });
}

/** 非方案来源的素材标签节点（!734/IKG99G 起方案来源卡不再渲染素材下拉——素材由方案同步，
 *  手动替换/新增素材标签的用例须落在非方案卡上才有下拉可点）。 */
async function renderManualMentionNode() {
  return renderNode({
    text: '看这张素材#1中间素材#2结尾',
    promptMentions: [
      { start: 3, end: 7, assetId: 'a1', index: 1 },
      { start: 9, end: 13, assetId: 'a2', index: 2 },
    ],
    promptMaterials: [
      { assetId: 'a1', mediaType: 'image' as const, url: 'http://img/m1.png' },
      { assetId: 'a2', mediaType: 'image' as const, url: 'http://img/m2.png' },
    ],
    mediaMentions: [],
    mediaRefs: [],
    onPromptChange: vi.fn(),
  });
}

/** 点选指定素材标签后，在节点操作条点对应按钮（非编辑态入口） */
async function clickNodeBarButton(label: string) {  const button = [...container.querySelectorAll('button')].find(b => b.textContent?.includes(label))!;
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

it('非编辑态删除素材标签后，进入编辑光标落被删标签原位置', async () => {
  const { editor } = await renderPromptNode();
  const first = editor.querySelector<HTMLElement>('[data-prompt-index="1"]')!;
  await act(async () => first.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await clickNodeBarButton('删除标签 #1');
  expect(editor.querySelector('[data-prompt-index="1"]')).toBeNull();
  await enterEditing(editor);
  // 被删标签原位置 = 「看这张」之后（DOM 流：chip 文本为 #N，offset 3）
  expect(caretTextOffset(editor)).toBe(3);
});

it('非编辑态替换素材标签后，进入编辑光标落替换后标签后', async () => {
  const { editor } = await renderManualMentionNode();
  const first = editor.querySelector<HTMLElement>('[data-prompt-index="1"]')!;
  await act(async () => first.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="替换素材 #1"]')!;
  await act(async () => {
    select.value = 'a2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await enterEditing(editor);
  const replaced = editor.querySelector<HTMLElement>('[data-prompt-index="1"]')!;
  expect(replaced.dataset.promptAsset).toBe('a2');
  expect(caretAtChip(replaced, 'after')).toBe(true);
});

it('非编辑态新增素材标签后，进入编辑光标落新标签后', async () => {
  const { editor } = await renderManualMentionNode();
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="新增素材标签"]')!;
  await act(async () => {
    select.value = 'a1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await enterEditing(editor);
  const added = editor.querySelector<HTMLElement>('[data-prompt-index="3"]')!;
  expect(added).toBeTruthy();
  expect(caretAtChip(added, 'after')).toBe(true);
});

it('同编号多张素材标签删除，锚点取点击的那张原位置', async () => {
  const { editor } = await renderNode({
    promptSource: 'chat',
    text: '素材#1素材#2素材#1',
    promptMentions: [
      { start: 0, end: 4, assetId: 'a1', index: 1 },
      { start: 4, end: 8, assetId: 'a2', index: 2 },
      { start: 8, end: 12, assetId: 'a1', index: 1 },
    ],
    promptMaterials: [
      { assetId: 'a1', mediaType: 'image' as const, url: 'http://img/m1.png' },
      { assetId: 'a2', mediaType: 'image' as const, url: 'http://img/m2.png' },
    ],
    mediaMentions: [],
    mediaRefs: [],
    onPromptChange: vi.fn(),
  });
  // 点第二张 #1（#2 之后）：删除全部 #1 后幸存 #2 在点击位置之前，光标应落 #2 后
  const ones = () => [...editor.querySelectorAll<HTMLElement>('[data-prompt-index="1"]')];
  await act(async () => ones()[1].dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await clickNodeBarButton('删除标签 #1');
  expect(editor.querySelectorAll('[data-prompt-index="1"]').length).toBe(0);
  await enterEditing(editor);
  // 重放后正文只剩 #2：其文本「#2」在 DOM 流占 1 字符，被删位置 = 原第二张 #1 处 = offset 2（chip#1+chip#2）
  expect(caretTextOffset(editor)).toBe(2);
});

it('同编号多张素材标签删除，点第一张时锚点取第一张原位置（不取第二张）', async () => {
  const { editor } = await renderNode({
    promptSource: 'chat',
    text: '素材#1素材#2素材#1',
    promptMentions: [
      { start: 0, end: 4, assetId: 'a1', index: 1 },
      { start: 4, end: 8, assetId: 'a2', index: 2 },
      { start: 8, end: 12, assetId: 'a1', index: 1 },
    ],
    promptMaterials: [
      { assetId: 'a1', mediaType: 'image' as const, url: 'http://img/m1.png' },
      { assetId: 'a2', mediaType: 'image' as const, url: 'http://img/m2.png' },
    ],
    mediaMentions: [],
    mediaRefs: [],
    onPromptChange: vi.fn(),
  });
  // 点第一张 #1（正文开头）：删除后光标应落正文开头，而非第二张 #1 的位置
  const first = editor.querySelector<HTMLElement>('[data-prompt-index="1"]')!;
  await act(async () => first.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await clickNodeBarButton('删除标签 #1');
  await enterEditing(editor);
  expect(caretTextOffset(editor)).toBe(0);
});
