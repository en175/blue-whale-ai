// @vitest-environment jsdom
/* IKJR9J 组件层：锚定浮层拖拽隐藏信号（onAnchoredOverlayDragHideChange）。
 * 口径——首帧真实位移（带坐标的 position change，与 snapDragChanges 同口径）才上抛
 * 被拖集合；单击零位移不上抛；多选整组上抛全部成员；dragStop 落定清空；
 * 组框把手拖整组同样生效（首帧非零 offset 上抛成员集合、落定清空、单击不触发）。
 * 上抛即置灰信号本身：父层按锚定卡 id 命中决定哪个浮层 visibility 隐藏。
 * 环境搭建沿 snapDragCanvas.test.tsx 先例。 */
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FlowCanvas from './index';

vi.hoisted(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof FlowCanvas>;

function node(id: string) {
  return container.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
}

function pane() {
  return container.querySelector<HTMLElement>('.react-flow__pane')!;
}

/** jsdom 没有 PointerEvent 构造器，用 MouseEvent 补指针属性（组框把手拖拽用）。 */
async function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup', target: EventTarget, x: number, y: number) {
  await act(async () => {
    const event = new MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
      clientX: x, clientY: y,
    });
    Object.defineProperty(event, 'view', { value: window });
    Object.defineProperty(event, 'isPrimary', { value: true });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    target.dispatchEvent(event);
  });
}

async function mouse(type: string, target: EventTarget, x = 100, y = 100) {
  await act(async () => {
    const event = new MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' ? 0 : 1,
      clientX: x, clientY: y,
    });
    Object.defineProperty(event, 'view', { value: window });
    target.dispatchEvent(event);
  });
}

const dragHideCalls = () => vi.mocked(props.onAnchoredOverlayDragHideChange!).mock.calls.map(([ids]) => ids);

function mediaNode(id: string, x: number, y: number, selected = false) {
  return {
    id, type: 'mediaNode', position: { x, y }, width: 200, height: 150, selected,
    data: { mediaType: 'image', src: 'blob:test', fileName: 'test', toolMode: 'select' },
  };
}

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  document.elementsFromPoint = () => [];
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
    mediaNodes: [mediaNode('image-1', 50, 60), mediaNode('image-2', 500, 200)],
    viewport: { x: 0, y: 0, zoom: 1 },
    onDeleteNode: vi.fn(), onNodeDragStop: vi.fn(), onViewportChange: vi.fn(),
    onNodeClick: vi.fn(), onPaneClick: vi.fn(),
    onGroupFrameDragStop: vi.fn(),
    onAnchoredOverlayDragHideChange: vi.fn(),
  };
  await act(async () => { root.render(createElement(FlowCanvas, props)); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  Reflect.deleteProperty(document, 'elementsFromPoint');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('IKJR9J 锚定浮层拖拽隐藏信号', () => {
  it('首帧真实位移上抛被拖集合（按下尚未上抛），连续位移不重复上抛，落定清空', async () => {
    await mouse('mousedown', node('image-1'), 100, 100);
    // 按下未位移：不上抛（点卡片开面板不闪隐的前提是按下阶段无信号）
    expect(props.onAnchoredOverlayDragHideChange).not.toHaveBeenCalled();

    await mouse('mousemove', window, 104, 103);
    await mouse('mousemove', window, 300, 250);
    expect(dragHideCalls()).toEqual([new Set(['image-1'])]);

    // 位移持续：同一冻结集合引用，不逐帧重复上抛
    await mouse('mousemove', window, 320, 270);
    expect(dragHideCalls()).toHaveLength(1);

    await mouse('mouseup', window, 320, 270);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(dragHideCalls()).toEqual([new Set(['image-1']), null]);
  });

  it('单击零位移（无位移帧）全程不上抛', async () => {
    await mouse('mousedown', node('image-1'), 100, 100);
    await mouse('mouseup', window, 100, 100);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(props.onAnchoredOverlayDragHideChange).not.toHaveBeenCalled();
  });

  it('拖未锚定的卡同样上抛其被拖集合（命中判定在父层）', async () => {
    await mouse('mousedown', node('image-2'), 600, 300);
    await mouse('mousemove', window, 604, 303);
    await mouse('mousemove', window, 700, 400);
    expect(dragHideCalls()).toEqual([new Set(['image-2'])]);
    await mouse('mouseup', window, 700, 400);
  });

  it('多选拖拽：上抛冻结的全部被拖成员', async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(FlowCanvas, {
        ...props,
        mediaNodes: [
          mediaNode('image-1', 50, 60, true),
          mediaNode('image-2', 500, 200, true),
          mediaNode('image-3', 1000, 500),
        ],
      }));
    });

    await mouse('mousedown', node('image-1'), 100, 100);
    await mouse('mousemove', window, 104, 103);
    await mouse('mousemove', window, 400, 300);
    expect(dragHideCalls()).toEqual([new Set(['image-1', 'image-2'])]);
    await mouse('mouseup', window, 400, 300);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(dragHideCalls().at(-1)).toBeNull();
  });

  it('组框把手拖整组：首帧非零位移上抛成员集合，落定清空', async () => {
    await act(async () => {
      root.render(createElement(FlowCanvas, {
        ...props,
        groups: [{ id: 'group-1', box: { x: 0, y: 0, w: 400, h: 300 }, excludedIds: [] }],
      }));
    });

    // 组内空白（不落在节点上）按下：此时 offset 为零，不上抛
    await pointer('pointerdown', pane(), 300, 100);
    expect(props.onAnchoredOverlayDragHideChange).not.toHaveBeenCalled();

    await pointer('pointermove', window, 400, 150);
    expect(dragHideCalls()).toEqual([new Set(['image-1'])]);

    await pointer('pointerup', window, 400, 150);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(dragHideCalls().at(-1)).toBeNull();
  });

  it('组框单击零位移（激活组）全程不上抛', async () => {
    await act(async () => {
      root.render(createElement(FlowCanvas, {
        ...props,
        groups: [{ id: 'group-1', box: { x: 0, y: 0, w: 400, h: 300 }, excludedIds: [] }],
      }));
    });

    await pointer('pointerdown', pane(), 300, 100);
    await pointer('pointerup', window, 300, 100);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(props.onAnchoredOverlayDragHideChange).not.toHaveBeenCalled();
  });
});
