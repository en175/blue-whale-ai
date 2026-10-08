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
});

const storeState = vi.hoisted(() => {
  const nodes = [
    { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: {} },
    { id: 'm1', type: 'mediaNode', position: { x: 200, y: 0 }, data: { assetId: 'a1', mediaType: 'image', src: 'http://img/m1.png', fileName: '素材图一' } },
  ];
  return {
    nodes,
    edges: [{ id: 'e1', source: 'm1', target: 't1', data: { textIndex: true } }],
    transform: [0, 0, 1],
    width: 1200,
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

const chipRectSpy = vi.hoisted(() => ({ current: null as DOMRect | null }));

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
  const chip = container.querySelector<HTMLElement>('[data-media-node]')!;
  vi.spyOn(chip, 'getBoundingClientRect').mockImplementation(() => chipRectSpy.current ?? rectOf(0, 0, 0));
  return { editor: container.querySelector<HTMLElement>('[data-placeholder="输入内容..."]')!, chip };
}

function fixedAnchorSpans(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('span')].filter(s => s.style.position === 'fixed');
}

async function enterEditing(editor: HTMLElement) {
  await act(async () => editor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  chipRectSpy.current = null;
});

it('输入 @ 后菜单锚点挂在 body 下，不落在画布节点内', async () => {
  const { editor } = await renderNode();
  await enterEditing(editor);
  editor.replaceChildren(document.createTextNode('@'));
  const range = document.createRange();
  range.setStart(editor.firstChild!, 1);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  const input = new Event('input', { bubbles: true }) as InputEvent;
  Object.defineProperty(input, 'inputType', { value: 'insertText' });
  Object.defineProperty(input, 'data', { value: '@' });
  await act(async () => editor.dispatchEvent(input));
  expect(document.querySelector('input[placeholder="搜索"]')).toBeTruthy();
  const anchors = fixedAnchorSpans();
  expect(anchors).toHaveLength(1);
  expect(container.contains(anchors[0])).toBe(false);
});

it('悬停有效标签后预览挂在 body 下，贴近屏幕顶部时翻到标签下方', async () => {
  const { chip } = await renderNode();
  chipRectSpy.current = rectOf(50, 70, 10);
  await act(async () => chip.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  await new Promise(resolve => setTimeout(resolve, 170));
  const preview = document.querySelector('[data-testid="media-chip-preview"]') as HTMLElement;
  expect(preview).toBeTruthy();
  expect(container.contains(preview)).toBe(false);
  expect(preview.style.top).toBe('78px');
});

it('悬停位置充裕时预览仍固定在标签下方', async () => {
  const { chip } = await renderNode();
  chipRectSpy.current = rectOf(400, 420, 10);
  await act(async () => chip.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  await new Promise(resolve => setTimeout(resolve, 170));
  const preview = document.querySelector('[data-testid="media-chip-preview"]') as HTMLElement;
  expect(preview).toBeTruthy();
  expect(container.contains(preview)).toBe(false);
  expect(preview.style.top).toBe('428px');
});

it('编辑态点击标签后操作层挂在 body 下，不落在画布节点内', async () => {
  const { editor, chip } = await renderNode();
  await enterEditing(editor);
  await act(async () => chip.click());
  const menu = document.querySelector('[data-testid="media-chip-menu"]') as HTMLElement;
  expect(menu).toBeTruthy();
  expect(container.contains(menu)).toBe(false);
});
