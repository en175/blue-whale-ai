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

function node(id: string) {
  return container.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
}

function pane() {
  return container.querySelector<HTMLElement>('.react-flow__pane')!;
}

function selectionBox() {
  return container.querySelector<HTMLElement>('.react-flow__selection');
}

async function key(type: 'keydown' | 'keyup', code = 'Space', keyValue = ' ') {
  const event = new KeyboardEvent(type, { code, key: keyValue, bubbles: true, cancelable: true });
  await act(async () => { document.body.dispatchEvent(event); });
}

/** React Flow 框选走 pointer 事件；jsdom 没有 PointerEvent 构造器，用 MouseEvent 补指针属性。 */
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

/** 从 (x1,y1) 拖选框到 (x2,y2) 并松开。 */
async function marquee(x1: number, y1: number, x2: number, y2: number) {
  await pointer('pointerdown', pane(), x1, y1);
  // 先小位移越过 paneClickDistance（库默认 1px）启动框选，再移到终点。
  await pointer('pointermove', pane(), x1 + 4, y1 + 3);
  await pointer('pointermove', pane(), x2, y2);
  await pointer('pointerup', pane(), x2, y2);
}

async function clickPane(x: number, y: number) {
  await pointer('pointerdown', pane(), x, y);
  await pointer('pointerup', pane(), x, y);
}

async function finishMouseGesture() {
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
  const mediaNode = (id: string, x: number, y: number, selected = false) => ({
    id, type: 'mediaNode', position: { x, y },
    initialWidth: 200, initialHeight: 150, selected,
    data: { mediaType: 'image', src: 'blob:test', fileName: 'test', toolMode: 'select' },
  });
  props = {
    toolMode: 'select', showMiniMap: false, showEdges: false, hideZoomControl: true,
    extraNodes: [], textNodes: [], productNodes: [], assetNodes: [],
    edges: [], onEdgesChange: vi.fn(), onConnect: vi.fn(),
    mediaNodes: [mediaNode('image-1', 50, 60), mediaNode('image-2', 500, 400)],
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

describe('Canvas marquee select', () => {
  it('selects cards by dragging on empty pane without Shift', async () => {
    expect(node('image-1').classList.contains('selected')).toBe(false);
    expect(node('image-2').classList.contains('selected')).toBe(false);

    await pointer('pointerdown', pane(), 800, 600);
    await pointer('pointermove', pane(), 804, 603);
    await pointer('pointermove', pane(), 100, 100);
    expect(selectionBox()).not.toBeNull();
    await pointer('pointerup', pane(), 100, 100);

    expect(node('image-1').classList.contains('selected')).toBe(true);
    expect(node('image-2').classList.contains('selected')).toBe(true);
    // 框选手势结束不触发 pane click，选中态不会被随后的 click 清掉。
    expect(props.onPaneClick).not.toHaveBeenCalled();
  });

  it('clears the existing selection on an in-place pane click without starting a marquee', async () => {
    await marquee(800, 600, 100, 100);
    expect(node('image-1').classList.contains('selected')).toBe(true);
    vi.mocked(props.onPaneClick!).mockClear();

    await clickPane(800, 600);

    expect(props.onPaneClick).toHaveBeenCalled();
    expect(node('image-1').classList.contains('selected')).toBe(false);
    expect(node('image-2').classList.contains('selected')).toBe(false);
    expect(selectionBox()).toBeNull();
  });

  it('clears the marquee selection by clicking empty pane outside the selection box', async () => {
    await marquee(800, 600, 100, 100);
    expect(node('image-1').classList.contains('selected')).toBe(true);

    await clickPane(900, 100);

    expect(props.onPaneClick).toHaveBeenCalled();
    expect(node('image-1').classList.contains('selected')).toBe(false);
    expect(node('image-2').classList.contains('selected')).toBe(false);
  });

  it('drags the whole selected group when starting on a selected card', async () => {
    await marquee(800, 600, 100, 100);
    expect(node('image-1').classList.contains('selected')).toBe(true);
    expect(node('image-2').classList.contains('selected')).toBe(true);

    await mouse('mousedown', node('image-1'));
    await mouse('mousemove', window, 120, 110);
    await mouse('mousemove', window, 160, 140);
    await finishMouseGesture();

    expect(props.onNodeDragStop).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'image-1', selected: true }),
      expect.arrayContaining([
        expect.objectContaining({ id: 'image-1' }),
        expect.objectContaining({ id: 'image-2' }),
      ]),
    );
    expect(node('image-1').style.transform).not.toBe('translate(50px,60px)');
    expect(node('image-2').style.transform).not.toBe('translate(500px,400px)');
    expect(node('image-1').classList.contains('selected')).toBe(true);
    expect(node('image-2').classList.contains('selected')).toBe(true);
  });

  it('replaces the old selection with a new marquee that hits nothing', async () => {
    await marquee(800, 600, 100, 100);
    expect(node('image-1').classList.contains('selected')).toBe(true);
    expect(node('image-2').classList.contains('selected')).toBe(true);

    // 左上角小选框：节点 measured 区域（50,60 起）与之不相交，新框选替换旧选中为空集。
    await marquee(2, 2, 12, 10);

    expect(node('image-1').classList.contains('selected')).toBe(false);
    expect(node('image-2').classList.contains('selected')).toBe(false);
  });

  it('pans without marquee while Space is held', async () => {
    await key('keydown');
    await mouse('mousedown', pane());
    await mouse('mousemove', window, 160, 140);
    expect(selectionBox()).toBeNull();
    await finishMouseGesture();
    await vi.waitFor(() => expect(props.onViewportChange).toHaveBeenCalledWith({ x: 60, y: 40, zoom: 1 }));

    expect(node('image-1').classList.contains('selected')).toBe(false);
    expect(node('image-2').classList.contains('selected')).toBe(false);
    await key('keyup');
  });

  // 用户故事 7 固化：Cmd（macOS）/ Ctrl + 点击逐张加选不变。jsdom UA 不含 Mac，库内修饰键为 Control。
  it('adds cards one by one with Ctrl + click', async () => {
    // jsdom 中 d3-drag 在首个移动事件才进入拖拽并选中；用小幅来回位移模拟「原地点击」。
    await mouse('mousedown', node('image-1'));
    await mouse('mousemove', window, 104, 103);
    await mouse('mousemove', window, 100, 100);
    await finishMouseGesture();
    expect(node('image-1').classList.contains('selected')).toBe(true);
    expect(node('image-2').classList.contains('selected')).toBe(false);

    await key('keydown', 'ControlLeft', 'Control');
    await mouse('mousedown', node('image-2'), 500, 400);
    await mouse('mousemove', window, 504, 403);
    await mouse('mousemove', window, 500, 400);
    await finishMouseGesture();
    await key('keyup', 'ControlLeft', 'Control');

    expect(node('image-1').classList.contains('selected')).toBe(true);
    expect(node('image-2').classList.contains('selected')).toBe(true);
  });

  // 用户故事 12 固化：Delete / Backspace 批量删除选中卡片不变。
  // IKDMQW 起 Canvas 内部不再直接移除节点（生成中卡片先取消后移除的异步流程由父级驱动）：
  // Delete 一次回调全部选中 id（IKFO73），节点消失由父级列表移除后的合并 effect 同步。
  it('deletes all selected cards with Delete', async () => {
    await marquee(800, 600, 100, 100);
    expect(node('image-1').classList.contains('selected')).toBe(true);
    expect(node('image-2').classList.contains('selected')).toBe(true);

    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    });

    expect(props.onDeleteNode).toHaveBeenCalledTimes(1);
    expect(props.onDeleteNode).toHaveBeenCalledWith(['image-1', 'image-2']);
    // 模拟父级列表响应删除（CanvasPage 中各列表 setState filter）
    await act(async () => {
      root.render(createElement(FlowCanvas, { ...props, mediaNodes: [] }));
    });
    expect(container.querySelector('[data-id="image-1"]')).toBeNull();
    expect(container.querySelector('[data-id="image-2"]')).toBeNull();
  });
});
