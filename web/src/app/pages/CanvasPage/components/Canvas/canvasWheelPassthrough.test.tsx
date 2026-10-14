// @vitest-environment jsdom
import { act, createElement, useRef, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FlowCanvas from './index';
import {
  findFlowRenderer,
  forwardWheelToRenderer,
  useOverlayWheelPassthrough,
  wheelTargetScrollsWithin,
} from './canvasWheelPassthrough';

vi.hoisted(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof FlowCanvas>;

function transform() {
  return container.querySelector<HTMLElement>('.react-flow__viewport')!.style.transform;
}

function scale() {
  return Number(/scale\(([^)]+)\)/.exec(transform())![1]);
}

async function wheel(target: EventTarget, init: WheelEventInit = {}) {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}

function Stage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useOverlayWheelPassthrough(ref, { ignoreInsideReactFlow: true });
  return <div ref={ref} data-canvas-stage="">{children}</div>;
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
    extraNodes: [], textNodes: [], productNodes: [], assetNodes: [],
    edges: [], onEdgesChange: vi.fn(), onConnect: vi.fn(),
    mediaNodes: [{
      id: 'image-1', type: 'mediaNode', position: { x: 50, y: 60 },
      initialWidth: 200, initialHeight: 150,
      data: { mediaType: 'image', src: 'blob:test', fileName: 'test', toolMode: 'select' },
    }],
    viewport: { x: 0, y: 0, zoom: 1 },
    onDeleteNode: vi.fn(), onNodeDragStop: vi.fn(), onViewportChange: vi.fn(),
    onNodeClick: vi.fn(), onPaneClick: vi.fn(),
  };
  await act(async () => {
    root.render(createElement(Stage, null,
      createElement(FlowCanvas, props),
      createElement('div', { 'data-testid': 'overlay-stub' }),
      createElement('div', { 'data-testid': 'scroll-stub', style: { overflowY: 'auto' } }),
    ));
  });
  const scrollStub = container.querySelector<HTMLElement>('[data-testid="scroll-stub"]')!;
  Object.defineProperty(scrollStub, 'scrollHeight', { value: 500, configurable: true });
  Object.defineProperty(scrollStub, 'clientHeight', { value: 100, configurable: true });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('findFlowRenderer', () => {
  it('.react-flow 内的浮层沿 flow 根定位 renderer', () => {
    const flow = document.createElement('div');
    flow.className = 'react-flow';
    const renderer = document.createElement('div');
    renderer.className = 'react-flow__renderer';
    const layer = document.createElement('div');
    flow.append(renderer, layer);
    expect(findFlowRenderer(layer)).toBe(renderer);
  });

  it('flow 外的 Dock 沿画布舞台定位 renderer', () => {
    const stage = document.createElement('div');
    stage.setAttribute('data-canvas-stage', '');
    const flow = document.createElement('div');
    flow.className = 'react-flow';
    const renderer = document.createElement('div');
    renderer.className = 'react-flow__renderer';
    flow.appendChild(renderer);
    const dock = document.createElement('div');
    stage.append(flow, dock);
    expect(findFlowRenderer(dock)).toBe(renderer);
  });

  it('舞台外的游离元素返回 null', () => {
    expect(findFlowRenderer(document.createElement('div'))).toBeNull();
  });
});

describe('wheelTargetScrollsWithin', () => {
  const boundary = document.createElement('div');

  function targetWith(el: HTMLElement) {
    boundary.appendChild(el);
    return el;
  }

  it('textarea 命中', () => {
    const el = targetWith(document.createElement('textarea'));
    expect(wheelTargetScrollsWithin(el, boundary)).toBe(true);
  });

  it('nowheel 类命中（React Flow 滚内容约定）', () => {
    const el = targetWith(document.createElement('div'));
    el.className = 'nowheel';
    expect(wheelTargetScrollsWithin(el, boundary)).toBe(true);
  });

  it('祖先链上溢出的 overflow 容器命中（target 本身是普通子元素）', () => {
    const scroller = targetWith(document.createElement('div'));
    scroller.style.overflowY = 'auto';
    Object.defineProperty(scroller, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(scroller, 'clientHeight', { value: 100, configurable: true });
    const inner = document.createElement('span');
    scroller.appendChild(inner);
    expect(wheelTargetScrollsWithin(inner, boundary)).toBe(true);
  });

  it('overflow 容器无实际溢出不命中（jsdom 布局为 0）', () => {
    const el = targetWith(document.createElement('div'));
    el.style.overflowY = 'auto';
    expect(wheelTargetScrollsWithin(el, boundary)).toBe(false);
  });

  it('无 overflow 的空白区不命中', () => {
    const el = targetWith(document.createElement('div'));
    expect(wheelTargetScrollsWithin(el, boundary)).toBe(false);
  });
});

describe('forwardWheelToRenderer', () => {
  it('派发合成 wheel 到 renderer 且字段逐项保留；定位失败返回 false', () => {
    const flow = document.createElement('div');
    flow.className = 'react-flow';
    const renderer = document.createElement('div');
    renderer.className = 'react-flow__renderer';
    const layer = document.createElement('div');
    flow.append(renderer, layer);
    const received: WheelEvent[] = [];
    renderer.addEventListener('wheel', (e) => received.push(e as WheelEvent));

    const event = new WheelEvent('wheel', {
      bubbles: true, cancelable: true,
      clientX: 30, clientY: 40,
      deltaX: 5, deltaY: 10, deltaZ: 0, deltaMode: 0,
      ctrlKey: true, shiftKey: true, altKey: true, metaKey: true,
    });
    layer.dispatchEvent(event);
    expect(forwardWheelToRenderer(event)).toBe(true);
    expect(received).toHaveLength(1);
    const forwarded = received[0];
    expect(forwarded.clientX).toBe(30);
    expect(forwarded.clientY).toBe(40);
    expect(forwarded.deltaX).toBe(5);
    expect(forwarded.deltaY).toBe(10);
    expect(forwarded.deltaZ).toBe(0);
    expect(forwarded.deltaMode).toBe(0);
    expect(forwarded.ctrlKey).toBe(true);
    expect(forwarded.shiftKey).toBe(true);
    expect(forwarded.altKey).toBe(true);
    expect(forwarded.metaKey).toBe(true);
    expect(forwarded.bubbles).toBe(false);

    const stray = new WheelEvent('wheel', { bubbles: true, cancelable: true });
    const strayHost = document.createElement('div');
    document.body.appendChild(strayHost);
    strayHost.dispatchEvent(stray);
    expect(forwardWheelToRenderer(stray)).toBe(false);
    expect(received).toHaveLength(1);
  });
});

describe('浮层滚轮直通集成（IKIXDB：Dock 上的画布平移不再被截断）', () => {
  it('Dock 浮层上的滚轮转发画布平移并拦默认', async () => {
    const overlay = container.querySelector<HTMLElement>('[data-testid="overlay-stub"]')!;
    const event = await wheel(overlay, { deltaY: 100 });
    expect(transform()).toBe('translate(0px,-50px) scale(1)');
    expect(event.defaultPrevented).toBe(true);
  });

  it('Ctrl+Dock 浮层滚轮转发画布缩放', async () => {
    const overlay = container.querySelector<HTMLElement>('[data-testid="overlay-stub"]')!;
    await wheel(overlay, { deltaY: 100, ctrlKey: true });
    await vi.waitFor(() => expect(scale()).toBeLessThan(1));
  });

  it('浮层内真实滚动区滚自身、不转发；ctrl 时拦整页缩放', async () => {
    const stub = container.querySelector<HTMLElement>('[data-testid="scroll-stub"]')!;
    const before = transform();
    const plain = await wheel(stub, { deltaY: 100 });
    expect(transform()).toBe(before);
    expect(plain.defaultPrevented).toBe(false);
    const ctrl = await wheel(stub, { deltaY: 100, ctrlKey: true });
    expect(transform()).toBe(before);
    expect(ctrl.defaultPrevented).toBe(true);
  });
});
