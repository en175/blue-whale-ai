// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FlowCanvas from './index';

vi.hoisted(() => {
  // 开发期代码定位插件在导入时探测 Canvas；本测试不绘制位图。
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof FlowCanvas>;

function node() {
  return container.querySelector<HTMLElement>('.react-flow__node')!;
}

function pane() {
  return container.querySelector<HTMLElement>('.react-flow__pane')!;
}

async function key(type: 'keydown' | 'keyup', target: EventTarget = document.body) {
  const event = new KeyboardEvent(type, { code: 'Space', key: ' ', bubbles: true, cancelable: true });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}

async function mouse(type: string, target: EventTarget, x = 100, y = 100) {
  await act(async () => {
    const event = new MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' ? 0 : 1,
      clientX: x, clientY: y,
    });
    // Vitest 的 window 代理不通过 jsdom 构造器的 Window 身份检查。
    Object.defineProperty(event, 'view', { value: window });
    target.dispatchEvent(event);
  });
}

async function finishGesture() {
  await mouse('mouseup', window, 160, 140);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
}

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom 不做布局；只补浏览器测量 API，React Flow 与卡片均使用真实实现。
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
    extraNodes: [], textNodes: [], productNodes: [], assetNodes: [],
    mediaNodes: [{
      id: 'image-1', type: 'mediaNode', position: { x: 50, y: 60 },
      initialWidth: 200, initialHeight: 150, selected: true,
      data: { mediaType: 'image', src: 'blob:test', fileName: 'test', toolMode: 'select', onReEdit: vi.fn() },
    }],
    viewport: { x: 0, y: 0, zoom: 1 },
    onDeleteNode: vi.fn(), onNodeDragStop: vi.fn(), onViewportChange: vi.fn(),
    onNodeClick: vi.fn(), onPaneClick: vi.fn(),
  };
  await act(async () => { root.render(createElement(FlowCanvas, props)); });
  vi.mocked(props.onViewportChange!).mockClear();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Canvas space pan', () => {
  it('disables node dragging while Space is held and restores it on release', async () => {
    expect(node().classList.contains('draggable')).toBe(true);
    const down = await key('keydown');
    expect(down.defaultPrevented).toBe(true);
    expect(node().classList.contains('draggable')).toBe(false);
    expect(node().classList.contains('nopan')).toBe(false);
    await key('keyup');
    expect(node().classList.contains('draggable')).toBe(true);
  });

  it('moves the viewport without moving or deselecting the card', async () => {
    await key('keydown');
    // 浏览器在穿透卡片后命中 pane；jsdom 不执行 CSS 命中测试。
    await mouse('mousedown', pane());
    await mouse('mousemove', window, 160, 140);
    await finishGesture();
    // React Flow 对启用了滚轮平移的视口结束事件有 150ms 防抖。
    await vi.waitFor(() => expect(props.onViewportChange).toHaveBeenCalledWith({ x: 60, y: 40, zoom: 1 }));
    expect(props.onNodeDragStop).not.toHaveBeenCalled();
    expect(node().style.transform).toBe('translate(50px,60px)');
    expect(node().classList.contains('selected')).toBe(true);
  });

  it('does not activate card buttons or click callbacks while panning', async () => {
    await key('keydown');
    const button = node().querySelector('button')!;
    await mouse('click', button);
    await mouse('click', node());
    await mouse('click', pane());
    expect(props.mediaNodes[0].data.onReEdit).not.toHaveBeenCalled();
    expect(props.onNodeClick).not.toHaveBeenCalled();
    expect(props.onPaneClick).not.toHaveBeenCalled();
    expect(node().classList.contains('selected')).toBe(true);
  });

  it('preserves the existing Space + wheel panning behavior', async () => {
    await key('keydown');
    await act(async () => {
      pane().dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }));
    });
    expect(container.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform)
      .toBe('translate(0px,-50px) scale(1)');
  });

  it.each(['input', 'textarea', 'contenteditable'])('keeps Space available in a focused %s', async (kind) => {
    const editor = document.createElement(kind === 'contenteditable' ? 'div' : kind);
    if (kind === 'contenteditable') {
      editor.contentEditable = 'true';
      editor.tabIndex = 0;
    }
    container.appendChild(editor);
    editor.focus();
    const down = await key('keydown', editor);
    expect(down.defaultPrevented).toBe(false);
    expect(node().classList.contains('draggable')).toBe(true);
  });

  it('keeps moving the card if Space is pressed after mouse down', async () => {
    await mouse('mousedown', node());
    await mouse('mousemove', window, 120, 110);
    await key('keydown');
    expect(node().classList.contains('draggable')).toBe(true);
    await mouse('mousemove', window, 160, 140);
    await finishGesture();
    // React Flow 从超过拖拽阈值的首个移动事件开始累计位移。
    expect(props.onNodeDragStop).toHaveBeenCalledWith(expect.objectContaining({ position: { x: 90, y: 90 } }));
    expect(props.onViewportChange).not.toHaveBeenCalled();
    expect(node().classList.contains('draggable')).toBe(false);
  });

  it('keeps panning if Space is released before mouse up', async () => {
    await key('keydown');
    await mouse('mousedown', pane());
    await mouse('mousemove', window, 120, 110);
    await key('keyup');
    expect(node().classList.contains('draggable')).toBe(false);
    await mouse('mousemove', window, 160, 140);
    await finishGesture();
    expect(props.onViewportChange).toHaveBeenCalledWith({ x: 60, y: 40, zoom: 1 });
    expect(node().classList.contains('draggable')).toBe(true);
  });

  it('does not clear selection on the click following mouse up when Space was released first', async () => {
    await key('keydown');
    await mouse('mousedown', pane());
    await key('keyup');
    await act(async () => {
      const up = new MouseEvent('mouseup', { bubbles: true, button: 0 });
      Object.defineProperty(up, 'view', { value: window });
      window.dispatchEvent(up);
      pane().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(props.onPaneClick).not.toHaveBeenCalled();
    expect(node().classList.contains('selected')).toBe(true);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(node().classList.contains('draggable')).toBe(true);
  });

  it('clears held Space when the window loses focus', async () => {
    await key('keydown');
    expect(node().classList.contains('draggable')).toBe(false);
    await act(async () => { window.dispatchEvent(new Event('blur')); });
    expect(node().classList.contains('draggable')).toBe(true);
  });

  it('retains the toolbar drag mode after Space is released', async () => {
    await act(async () => { root.render(createElement(FlowCanvas, { ...props, toolMode: 'drag' })); });
    await key('keydown');
    await key('keyup');
    expect(node().classList.contains('draggable')).toBe(false);
  });
});
