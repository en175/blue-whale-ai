// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import TextNode from './index';

beforeAll(() => {
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

const storeState = vi.hoisted(() => {
  const nodes = [
    { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: {} },
    { id: 'm1', type: 'mediaNode', position: { x: 200, y: 0 }, data: { assetId: 'a1', mediaType: 'image', src: 'http://img/m1.png', fileName: '素材图一' } },
    { id: 'm2', type: 'mediaNode', position: { x: 400, y: 0 }, data: { assetId: 'a2', mediaType: 'image', src: 'http://img/m2.png', fileName: '素材图二' } },
  ];
  return {
    nodes,
    edges: [{ id: 'e1', source: 'm1', target: 't1', data: { textIndex: true } }],
    transform: [0, 0, 1],
    width: 1200,
    domNode: null as HTMLElement | null,
    nodeLookup: new Map(
      nodes.map((n) => [n.id, {
        ...n,
        internals: { positionAbsolute: { ...n.position } },
        measured: { width: 360, height: 292 },
      }]),
    ),
  };
});

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
let flowRoot: HTMLDivElement;
let onMediaIndexChange: ReturnType<typeof vi.fn> | null = null;

async function renderNode(dataOverride: Record<string, unknown> = {}, { selected = false }: { selected?: boolean } = {}) {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  flowRoot = document.createElement('div');
  flowRoot.className = 'react-flow';
  document.body.append(flowRoot);
  storeState.domNode = flowRoot;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onMediaIndexChange = vi.fn();
  await act(async () => root.render(createElement(TextNode, {
    id: 't1',
    type: 'textNode',
    selected,
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

async function enterEditing(editor: HTMLElement) {
  await act(async () => {
    editor.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    editor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
}

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

async function dispatchInput(editor: HTMLElement, inputType: string, data: string | null) {
  const input = new Event('input', { bubbles: true }) as InputEvent;
  Object.defineProperty(input, 'inputType', { value: inputType });
  Object.defineProperty(input, 'data', { value: data });
  await act(async () => editor.dispatchEvent(input));
}

function menuOpen(): boolean {
  return document.querySelector('[data-testid="mention-menu"]') !== null;
}

function scatterSelection(editor: HTMLElement, offset = 0) {
  const range = document.createRange();
  range.setStart(editor.firstChild!, offset);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

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
  flowRoot?.remove();
  storeState.domNode = null;
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

async function rebindCancelRestoresCaret(closeMenu: () => Promise<void>) {
  const { editor } = await renderNode();
  await enterEditing(editor);
  scatterSelection(editor, 2);
  const chip = editor.querySelector<HTMLElement>('[data-media-node="m1"]')!;
  await act(async () => chip.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await pressChipMenuButton('重新绑定');
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


function chipByNode(editor: HTMLElement, nodeId: string, occurrence: number): HTMLElement | null {
  const chips = [...editor.querySelectorAll<HTMLElement>(`[data-media-node="${CSS.escape(nodeId)}"]`)];
  return chips[occurrence - 1] ?? null;
}

function caretAtChip(chip: HTMLElement, placement: 'before' | 'after'): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || range.startContainer !== chip.parentNode) return false;
  const index = Array.prototype.indexOf.call(chip.parentNode!.childNodes, chip);
  return range.startOffset === (placement === 'after' ? index + 1 : index);
}

function caretAtEnd(editor: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !editor.contains(range.startContainer)) return false;
  if (range.startContainer === editor) return range.startOffset === editor.childNodes.length;
  return range.startContainer === editor.lastChild
    && range.startOffset === (editor.lastChild!.textContent?.length ?? 0);
}

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

it('标签操作层标为画布浮层，避免点重新绑定穿透到添加到对话', async () => {
  const { editor } = await renderNode();
  await enterEditing(editor);
  const chip = chipByNode(editor, 'm1', 1)!;
  await act(async () => chip.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  const menu = document.querySelector('[data-testid="media-chip-menu"]');
  expect(menu?.hasAttribute('data-canvas-overlay')).toBe(true);
});

it('替换来源后光标落替换后新标签后', async () => {
  const { editor } = await renderNode();
  await enterEditing(editor);
  const chip = chipByNode(editor, 'm1', 1)!;
  await act(async () => chip.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await pressChipMenuButton('替换来源');
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
    await pressChipMenuButton('重新绑定');
    expect(menuOpen()).toBe(true);
    await selectMenuItem('素材图二');
    expect(editor.querySelectorAll('[data-media-node="m1"]').length).toBe(0);
    expect(editor.querySelectorAll('[data-media-node="m2"]').length).toBe(2);
    expect(caretAtChip(chipByNode(editor, 'm2', 1)!, 'after')).toBe(true);
    expect(onMediaIndexChange!.mock.calls.at(-1)![3]).toEqual({ added: ['m2'], removed: ['m1'] });
  } finally {
    storeState.edges = [{ id: 'e1', source: 'm1', target: 't1', data: { textIndex: true } }];
  }
});

it('剪线后失效标签重新绑定同一来源：补线 delta 含原身份，标签恢复有效', async () => {
  storeState.edges = [];
  try {
    const { editor } = await renderNode();
    await enterEditing(editor);
    const chip = chipByNode(editor, 'm1', 1)!;
    expect(chip.dataset.mediaInvalid).toBe('1');
    await act(async () => chip.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await pressChipMenuButton('重新绑定');
    expect(menuOpen()).toBe(true);
    await selectMenuItem('素材图一');
    expect(menuOpen()).toBe(false);
    expect(editor.querySelectorAll('[data-media-node="m1"]').length).toBe(1);
    const restored = chipByNode(editor, 'm1', 1)!;
    expect(restored.dataset.mediaInvalid).toBeUndefined();
    expect(caretAtChip(restored, 'after')).toBe(true);
    expect(onMediaIndexChange!.mock.calls.at(-1)![3]).toEqual({ added: ['m1'], removed: [] });
  } finally {
    storeState.edges = [{ id: 'e1', source: 'm1', target: 't1', data: { textIndex: true } }];
  }
});

it('剪线后再次 @ 同一来源：插入路径也传 added 以便补线', async () => {
  storeState.edges = [];
  try {
    const { editor } = await renderNode();
    await enterEditing(editor);
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
    expect(onMediaIndexChange!.mock.calls.at(-1)![3]).toEqual({ added: ['m1'], removed: [] });
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
  }, { selected: true });
}

async function pressChipMenuButton(label: string) {
  const menu = document.querySelector<HTMLElement>('[data-testid="media-chip-menu"]')!;
  const button = [...menu.querySelectorAll('button')].find(b => b.textContent?.includes(label))!;
  await act(async () => button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })));
}

it('非编辑态删除素材标签后，进入编辑光标落被删标签原位置', async () => {
  const { editor } = await renderPromptNode();
  const first = editor.querySelector<HTMLElement>('[data-prompt-index="1"]')!;
  await act(async () => first.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await pressChipMenuButton('删除标签');
  expect(editor.querySelector('[data-prompt-index="1"]')).toBeNull();
  await enterEditing(editor);
  expect(caretTextOffset(editor)).toBe(3);
});

it('非编辑态替换素材标签后，进入编辑光标落替换后标签后', async () => {
  const { editor } = await renderPromptNode();
  const first = editor.querySelector<HTMLElement>('[data-prompt-index="1"]')!;
  await act(async () => first.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await pressChipMenuButton('替换来源');
  expect(menuOpen()).toBe(true);
  await selectMenuItem('素材图二');
  const replaced = editor.querySelector<HTMLElement>('[data-media-node="m2"]')!;
  expect(replaced).toBeTruthy();
  expect(editor.querySelector('[data-prompt-index="1"]')).toBeNull();
  await enterEditing(editor);
  expect(caretAtChip(replaced, 'after')).toBe(true);
});

it('同编号多张素材标签删除，只移除点击的那张，锚点取该张原位置', async () => {
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
  }, { selected: true });
  const ones = () => [...editor.querySelectorAll<HTMLElement>('[data-prompt-index="1"]')];
  await act(async () => ones()[1].dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await pressChipMenuButton('删除标签');
  expect(editor.querySelectorAll('[data-prompt-index="1"]').length).toBe(1);
  await enterEditing(editor);
  expect(caretTextOffset(editor)).toBe(4);
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
  }, { selected: true });
  const first = editor.querySelector<HTMLElement>('[data-prompt-index="1"]')!;
  await act(async () => first.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await pressChipMenuButton('删除标签');
  expect(editor.querySelectorAll('[data-prompt-index="1"]').length).toBe(1);
  await enterEditing(editor);
  expect(caretTextOffset(editor)).toBe(0);
});

it('应用生成卡后编辑一次：镜像索引不丢，不触发删线回调（IKH4EF）', async () => {
  const { editor } = await renderNode({
    promptSource: 'chat',
    text: '参考素材#1尾巴',
    promptMentions: [{ start: 2, end: 6, assetId: 'a1', index: 1 }],
    promptMaterials: [{ assetId: 'a1', mediaType: 'image' as const, url: 'http://img/m1.png' }],
    mediaMentions: [{ start: 2, end: 6, nodeId: 'm1', assetId: 'a1' }],
    mediaRefs: [{ nodeId: 'm1', assetId: 'a1', mediaType: 'image' as const, name: '素材图一', url: 'http://img/m1.png' }],
    onPromptChange: vi.fn(),
  });
  expect(editor.querySelectorAll('[data-prompt-index="1"]')).toHaveLength(1);
  expect(editor.querySelectorAll('[data-media-node="m1"]')).toHaveLength(0);
  await enterEditing(editor);
  await dispatchInput(editor, 'insertText', 'X');
  expect(onMediaIndexChange).not.toHaveBeenCalled();
});
