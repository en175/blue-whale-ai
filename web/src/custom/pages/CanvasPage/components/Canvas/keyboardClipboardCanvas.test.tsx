// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import FlowCanvas from './index';

vi.hoisted(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});


let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof FlowCanvas>;

function selectedText(id = 'text-1'): Node {
  return { id, type: 'textNode', position: { x: 0, y: 0 }, selected: true, data: { text: '正文', toolMode: 'select' } };
}

function selectedMedia(id = 'media-1'): Node {
  return {
    id, type: 'mediaNode', position: { x: 300, y: 0 }, selected: true,
    data: { mediaType: 'image', src: 'blob:test', fileName: '测试图', toolMode: 'select' },
  };
}

async function press(key: string, opts: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; target?: HTMLElement } = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
  });
  await act(async () => { (opts.target ?? document.body).dispatchEvent(event); });
  return event;
}

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800,
    toJSON: () => ({}),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  props = {
    toolMode: 'select', showMiniMap: false, showEdges: false, hideZoomControl: true,
    extraNodes: [], edges: [], onEdgesChange: vi.fn(), onConnect: vi.fn(),
    textNodes: [selectedText()],
    mediaNodes: [selectedMedia()],
    productNodes: [], assetNodes: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    onDeleteNode: vi.fn(), onNodeDragStop: vi.fn(), onViewportChange: vi.fn(),
    onNodeClick: vi.fn(), onPaneClick: vi.fn(),
    onDuplicateSelected: vi.fn(),
    onCopySelected: vi.fn(),
    onPasteClipboard: vi.fn(),
  };
  await act(async () => { root.render(createElement(FlowCanvas, props)); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('IKGBPA Ctrl/Cmd+C 复制快照入口', () => {
  it('snapshots selected text and media cards (Cmd+C / Ctrl+C)', async () => {
    const mac = await press('c', { metaKey: true });
    expect(mac.defaultPrevented).toBe(true);
    expect(props.onCopySelected).toHaveBeenCalledWith(['text-1', 'media-1']);

    vi.mocked(props.onCopySelected!).mockClear();
    await press('c', { ctrlKey: true });
    expect(props.onCopySelected).toHaveBeenCalledWith(['text-1', 'media-1']);
  });

  it('silently drops selected product/asset cards from the copy set', async () => {
    props = {
      ...props,
      textNodes: [],
      mediaNodes: [],
      productNodes: [{ id: 'prod-1', type: 'productNode', position: { x: 0, y: 0 }, selected: true, data: { name: '商品', toolMode: 'select' } }],
      assetNodes: [{ id: 'asset-1', type: 'assetNode', position: { x: 300, y: 0 }, selected: true, data: { kind: 'custom', toolMode: 'select' } }],
    };
    await act(async () => { root.render(createElement(FlowCanvas, props)); });

    await press('c', { metaKey: true });
    expect(props.onCopySelected).not.toHaveBeenCalled();
  });

  it('stays silent when no card is selected', async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const unselected = {
      ...props,
      textNodes: [{ ...selectedText(), selected: false }],
      mediaNodes: [{ ...selectedMedia(), selected: false }],
    };
    await act(async () => { root.render(createElement(FlowCanvas, unselected)); });

    await press('c', { metaKey: true });
    expect(props.onCopySelected).not.toHaveBeenCalled();
  });

  it('yields to the browser inside inputs and contentEditable editors', async () => {
    const input = document.createElement('input');
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    container.append(input, editor);

    const inInput = await press('c', { metaKey: true, target: input });
    expect(inInput.defaultPrevented).toBe(false);
    expect(props.onCopySelected).not.toHaveBeenCalled();

    const inEditor = await press('c', { metaKey: true, target: editor });
    expect(inEditor.defaultPrevented).toBe(false);
    expect(props.onCopySelected).not.toHaveBeenCalled();
  });

  it('yields while the @ mention menu is open', async () => {
    const menu = document.createElement('div');
    menu.setAttribute('data-canvas-keyboard-scope', 'mention');
    document.body.appendChild(menu);
    try {
      const event = await press('c', { metaKey: true });
      expect(event.defaultPrevented).toBe(false);
      expect(props.onCopySelected).not.toHaveBeenCalled();
    } finally {
      menu.remove();
    }

    await press('c', { metaKey: true });
    expect(props.onCopySelected).toHaveBeenCalledWith(['text-1', 'media-1']);
  });

  it('ignores Shift combos (devtools inspect etc.)', async () => {
    const event = await press('c', { metaKey: true, shiftKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(props.onCopySelected).not.toHaveBeenCalled();
  });
});

describe('IKGBPA Ctrl/Cmd+V 粘贴入口', () => {
  it('raises the paste entry (Cmd+V / Ctrl+V)', async () => {
    const mac = await press('v', { metaKey: true });
    expect(mac.defaultPrevented).toBe(true);
    expect(props.onPasteClipboard).toHaveBeenCalledTimes(1);

    await press('v', { ctrlKey: true });
    expect(props.onPasteClipboard).toHaveBeenCalledTimes(2);
  });

  it('yields to the browser inside inputs and while the @ menu is open', async () => {
    const input = document.createElement('input');
    container.appendChild(input);
    const inInput = await press('v', { ctrlKey: true, target: input });
    expect(inInput.defaultPrevented).toBe(false);
    expect(props.onPasteClipboard).not.toHaveBeenCalled();

    const menu = document.createElement('div');
    menu.setAttribute('data-canvas-keyboard-scope', 'mention');
    document.body.appendChild(menu);
    try {
      const inMenu = await press('v', { metaKey: true });
      expect(inMenu.defaultPrevented).toBe(false);
      expect(props.onPasteClipboard).not.toHaveBeenCalled();
    } finally {
      menu.remove();
    }
  });

  it('ignores Shift combos', async () => {
    const event = await press('v', { ctrlKey: true, shiftKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(props.onPasteClipboard).not.toHaveBeenCalled();
  });
});

describe('IKGBPA C/V 与 Ctrl/Cmd+D 立即复制并存', () => {
  it('routes D to the existing duplicate handler and leaves C/V untouched', async () => {
    await press('d', { metaKey: true });
    expect(props.onDuplicateSelected).toHaveBeenCalledWith(['text-1', 'media-1']);
    expect(props.onCopySelected).not.toHaveBeenCalled();
    expect(props.onPasteClipboard).not.toHaveBeenCalled();

    await press('c', { metaKey: true });
    expect(props.onCopySelected).toHaveBeenCalledWith(['text-1', 'media-1']);
    expect(props.onDuplicateSelected).toHaveBeenCalledTimes(1);

    await press('v', { metaKey: true });
    expect(props.onPasteClipboard).toHaveBeenCalledTimes(1);
    expect(props.onDuplicateSelected).toHaveBeenCalledTimes(1);
  });
});
