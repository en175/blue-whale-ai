// @vitest-environment jsdom
import { act, createElement, useRef, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FlowCanvas from './index';
import { useOverlayWheelPassthrough } from './canvasWheelPassthrough';

vi.hoisted(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

const measuredTargets = new WeakSet<Element>();

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof FlowCanvas>;
let onAddToChat: ReturnType<typeof vi.fn>;

function transform() {
  return container.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform;
}

function viewportScale() {
  return Number(/scale\(([^)]+)\)/.exec(transform())![1]);
}

async function wheel(target: EventTarget, init: WheelEventInit = {}) {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}

async function click(target: EventTarget) {
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function addToChatButton() {
  const buttons = document.querySelectorAll<HTMLElement>('[data-gen-panel-territory] button');
  return [...buttons].find((button) => button.textContent?.includes('添加到对话'))!;
}

function pane() {
  return container.querySelector<HTMLElement>('.react-flow__pane')!;
}

function groupBadge() {
  return container.querySelector<HTMLElement>('button[title="组操作"]')!;
}

function groupDownloadButton() {
  return container.querySelector<HTMLElement>('button[title="下载组内全部素材"]')!;
}

function Stage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useOverlayWheelPassthrough(ref, { ignoreInsideReactFlow: true });
  return <div ref={ref} data-canvas-stage="">{children}</div>;
}

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', class {
    callback: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.callback = cb; }
    observe(target: Element) {
      if (measuredTargets.has(target)) return;
      measuredTargets.add(target);
      this.callback([{ target, contentRect: { width: 1000, height: 800 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal('DOMMatrixReadOnly', class {
    m22: number;
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([1-9.])\)/)?.[1];
      this.m22 = scale !== undefined ? +scale : 1;
    }
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.closest('[data-canvas-chrome], .react-flow__minimap')) {
      return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
    }
    return { x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, toJSON: () => ({}) };
  });
  onAddToChat = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  props = {
    toolMode: 'select', showMiniMap: false, showEdges: false, hideZoomControl: true,
    extraNodes: [], productNodes: [], assetNodes: [],
    textNodes: [{
      id: 'text-1', type: 'textNode', position: { x: 50, y: 60 }, selected: true,
      data: { html: '', toolMode: 'select', onAddToChat },
    }],
    mediaNodes: [],
    edges: [], onEdgesChange: vi.fn(), onConnect: vi.fn(),
    groups: [{ id: 'group-1', box: { x: 0, y: 0, w: 500, h: 200 }, excludedIds: [] }],
    onCreateGroup: vi.fn(), onUngroupGroup: vi.fn(), onDeleteGroup: vi.fn(), onDownloadGroup: vi.fn(),
    viewport: { x: 0, y: 0, zoom: 1 },
    onDeleteNode: vi.fn(), onNodeDragStop: vi.fn(), onViewportChange: vi.fn(),
    onNodeClick: vi.fn(), onPaneClick: vi.fn(),
  };
  await act(async () => {
    root.render(createElement(Stage, null, createElement(FlowCanvas, props)));
  });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('画布浮层滚轮平移（IKKNT7：@添加到对话与组操作不再卡住滚轮）', () => {
  it('空白区垂直、水平、双轴滚轮按半量平移视口', async () => {
    await wheel(pane(), { deltaY: 40 });
    expect(transform()).toBe('translate(0px,-20px) scale(1)');
    await wheel(pane(), { deltaX: 40 });
    expect(transform()).toBe('translate(-20px,-20px) scale(1)');
    await wheel(pane(), { deltaX: 40, deltaY: 40 });
    expect(transform()).toBe('translate(-40px,-40px) scale(1)');
  });

  it('@添加到对话浮层的按钮本体与非交互区持续平移，点击仍可用', async () => {
    await vi.waitFor(() => expect(addToChatButton()).toBeTruthy());
    const layer = addToChatButton().closest('[data-canvas-chrome]')!;
    await wheel(layer, { deltaX: 40, deltaY: 40 });
    expect(transform()).toBe('translate(-20px,-20px) scale(1)');
    const onButton = await wheel(addToChatButton(), { deltaX: 40, deltaY: 40 });
    expect(transform()).toBe('translate(-40px,-40px) scale(1)');
    expect(onButton.defaultPrevented).toBe(true);
    await click(addToChatButton());
    expect(onAddToChat).toHaveBeenCalledWith('text-1');
  });

  it('组操作入口与展开菜单持续平移，单次输入不重复驱动', async () => {
    const onBadge = await wheel(groupBadge(), { deltaX: 40, deltaY: 40 });
    expect(transform()).toBe('translate(-20px,-20px) scale(1)');
    expect(onBadge.defaultPrevented).toBe(true);
    await click(groupBadge());
    const onMenu = await wheel(groupDownloadButton(), { deltaX: 40, deltaY: 40 });
    expect(transform()).toBe('translate(-40px,-40px) scale(1)');
    expect(onMenu.defaultPrevented).toBe(true);
    await click(groupDownloadButton());
    expect(props.onDownloadGroup).toHaveBeenCalled();
  });
});

describe('画布浮层修饰键滚轮缩放（IKMS0A）', () => {
  it('@添加到对话按钮上的 ctrl+向上滚轮缩放画布且拦截默认行为', async () => {
    await vi.waitFor(() => expect(addToChatButton()).toBeTruthy());
    const onButton = await wheel(addToChatButton(), { deltaY: -100, ctrlKey: true });
    await vi.waitFor(() => expect(viewportScale()).toBeGreaterThan(1));
    expect(onButton.defaultPrevented).toBe(true);
  });

  it('组操作菜单按钮上的 meta+向上滚轮缩放画布且拦截默认行为', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36');
    await act(async () => {
      root.render(createElement(Stage, null, createElement(FlowCanvas, props)));
    });
    await vi.waitFor(() => expect(groupBadge()).toBeTruthy());
    const before = viewportScale();
    await click(groupBadge());
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', code: 'MetaLeft', bubbles: true, cancelable: true }));
    });
    const onMenu = await wheel(groupDownloadButton(), { deltaY: -100, metaKey: true });
    await vi.waitFor(() => expect(viewportScale()).toBeGreaterThan(before));
    expect(onMenu.defaultPrevented).toBe(true);
  });
});
