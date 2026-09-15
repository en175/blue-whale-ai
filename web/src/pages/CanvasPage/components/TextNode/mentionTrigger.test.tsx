// @vitest-environment jsdom
/* IKFUYA：文本节点 @ 菜单全位置触发口径（契约 §5）：正文任意位置逐键输入 @ 都弹出
   素材菜单——汉字/中文标点/英文字母/数字之后与行首/空格同等触发；粘贴进来的 @ 不
   触发；删除旧 @ 后重新输入可再次唤起。菜单打开后的交互（焦点进搜索框）保持现状。 */
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

async function renderNode() {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
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
      onMediaIndexChange: vi.fn(),
      onToast: vi.fn(),
    },
  } as never)));
  return { editor: container.querySelector<HTMLElement>('[data-placeholder="输入内容..."]')! };
}

async function enterEditing(editor: HTMLElement) {
  await act(async () => editor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
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
