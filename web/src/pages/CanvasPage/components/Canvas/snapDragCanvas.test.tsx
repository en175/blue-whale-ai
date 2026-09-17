// @vitest-environment jsdom
/* IKGGCT T2 组件层：真实 React Flow 拖拽手势流经后，onNodeDragStop 收到吸附后位置、
 * 拖拽中渲染对齐线且松手消失、Alt/开关禁用透传原始位置、多选统一偏移、
 * 组框把手拖整组不受吸附影响。环境搭建沿 marqueeSelect.test.tsx 先例。 */
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

function guideLines() {
  return container.querySelectorAll('[data-testid="snap-guides"] line');
}

async function key(type: 'keydown' | 'keyup', keyName = 'Alt') {
  const event = new KeyboardEvent(type, { key: keyName, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'altKey', { value: type === 'keydown' });
  await act(async () => { document.body.dispatchEvent(event); });
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

/** 从节点上按下拖到 (x,y) 并松开。返回拖拽中（mouseup 前）的对齐线条数。
 *  先小位移越过 nodeDragThreshold 启动拖拽（d3 在该帧才快照抓取偏移）。 */
async function dragNodeTo(id: string, x: number, y: number) {
  await mouse('mousedown', node(id), 100, 100);
  await mouse('mousemove', window, 104, 103);
  await mouse('mousemove', window, x, y);
  const linesDuringDrag = guideLines().length;
  await mouse('mouseup', window, x, y);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  return linesDuringDrag;
}

/** 200×150 媒体卡。width/height 顶层声明：jsdom 的 ResizeObserver stub 不回填
 *  measured，吸附参考块走 snapAlignment 的 width/height 回退链。 */
function mediaNode(id: string, x: number, y: number, selected = false) {
  return {
    id, type: 'mediaNode', position: { x, y }, width: 200, height: 150, selected,
    data: { mediaType: 'image', src: 'blob:test', fileName: 'test', toolMode: 'select', onReEdit: vi.fn() },
  };
}

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  // jsdom 无 document.elementsFromPoint（!713 起 GroupOverlay onDown 依赖其做
  // 叠层命中检测）：stub 空栈 = 按下点无叠层节点阻挡，组空白命中路径照常
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
    // image-1 (50,60)、image-2 (500,200)：x 相差 450，y 相差 140——只构造 x 向命中
    mediaNodes: [mediaNode('image-1', 50, 60), mediaNode('image-2', 500, 200)],
    viewport: { x: 0, y: 0, zoom: 1 },
    onDeleteNode: vi.fn(), onNodeDragStop: vi.fn(), onViewportChange: vi.fn(),
    onNodeClick: vi.fn(), onPaneClick: vi.fn(),
    onGroupFrameDragStop: vi.fn(),
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

describe('Canvas 拖拽对齐吸附', () => {
  it('拖入阈值内实时吸附：松手回传吸附后位置，拖拽中显示对齐线、松手消失', async () => {
    // 启动帧 (104,103) 快照抓取偏移 (54,43)；移到 (553,100)：
    // image-1 原始位置 (553-54, 100-43) = (499,57)，距 image-2 左边 500 差 1px 命中，吸附回 500
    const lines = await dragNodeTo('image-1', 553, 100);

    expect(lines).toBe(1);
    expect(guideLines()).toHaveLength(0);
    const [stopped] = vi.mocked(props.onNodeDragStop!).mock.calls[0];
    expect(stopped).toMatchObject({ id: 'image-1', position: { x: 500, y: 57 } });
    expect(node('image-1').style.transform).toContain('translate(500px');
  });

  it('拖出阈值外不吸附、无对齐线', async () => {
    const lines = await dragNodeTo('image-1', 380, 100);

    expect(lines).toBe(0);
    const [stopped] = vi.mocked(props.onNodeDragStop!).mock.calls[0];
    // 原始位置 (380-54, 100-43) = (326,57)，距 500 超 8px 不命中
    expect(stopped).toMatchObject({ position: { x: 326, y: 57 } });
  });

  it('Alt/Option 按住期间本次拖拽跳过吸附，松开后恢复', async () => {
    await key('keydown');
    const altLines = await dragNodeTo('image-1', 553, 100);
    expect(altLines).toBe(0);
    const [altStopped] = vi.mocked(props.onNodeDragStop!).mock.calls[0];
    expect(altStopped).toMatchObject({ position: { x: 499, y: 57 } });

    vi.mocked(props.onNodeDragStop!).mockClear();
    await key('keyup');
    // 第一拖后 image-1 停在 (499,57)：启动帧偏移 (-396,46)，目标 (105,100) → raw (501,54) 命中
    const restoredLines = await dragNodeTo('image-1', 105, 100);
    expect(restoredLines).toBe(1);
    const [restored] = vi.mocked(props.onNodeDragStop!).mock.calls[0];
    expect(restored).toMatchObject({ position: { x: 500, y: 54 } });
  });

  it('snapAlignmentEnabled=false 整体禁用吸附与对齐线', async () => {
    await act(async () => { root.render(createElement(FlowCanvas, { ...props, snapAlignmentEnabled: false })); });
    const lines = await dragNodeTo('image-1', 553, 100);

    expect(lines).toBe(0);
    const [stopped] = vi.mocked(props.onNodeDragStop!).mock.calls[0];
    expect(stopped).toMatchObject({ position: { x: 499, y: 57 } });
  });

  it('多选拖拽：主拖卡对齐静止参考卡，整批被拖卡施加同一偏移', async () => {
    // 重建根节点渲染初始选中态：mediaNodes 合并 effect 的 updated 分支以内部
    // selected 为准（合并保护），在默认渲染之上 rerender 传 selected 会被吞掉
    await act(async () => { root.unmount(); });
    container.remove();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // 构造期直接选中 image-1 + image-2（等价框选/Ctrl 加选后的状态），
    // image-3 静止作参考块——避免点击加选手势自带的微小位移干扰落点断言
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
    expect(node('image-1').classList.contains('selected')).toBe(true);
    expect(node('image-2').classList.contains('selected')).toBe(true);
    expect(node('image-3').classList.contains('selected')).toBe(false);

    // 主拖 image-1：移到 (1053,100)，原始位置 (999,57) 距 image-3 左边 1000 差 1px 命中；
    // 被拖成员 image-2 同帧原始位置 (1449,197)，随同一 dx=+1 平移保持相对位置
    await mouse('mousedown', node('image-1'), 100, 100);
    await mouse('mousemove', window, 104, 103);
    await mouse('mousemove', window, 1053, 100);
    expect(guideLines()).toHaveLength(1);
    await mouse('mouseup', window, 1053, 100);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });

    const [, dragged] = vi.mocked(props.onNodeDragStop!).mock.calls[0];
    const byId = new Map(dragged.map((n) => [n.id, n.position]));
    expect(byId.get('image-1')).toMatchObject({ x: 1000, y: 57 });
    expect(byId.get('image-2')).toMatchObject({ x: 1450, y: 197 });
    expect(dragged).toHaveLength(2);
  });

  it('组框把手拖整组不吸附：位移精确等于指针位移，无对齐线，select 过滤行为不变', async () => {
    await act(async () => {
      root.render(createElement(FlowCanvas, {
        ...props,
        groups: [{ id: 'group-1', box: { x: 0, y: 0, w: 400, h: 300 }, excludedIds: [] }],
      }));
    });

    // 组内空白（不落在节点上）按下，平移 (100,50)：成员 image-1 (50,60) → (150,110)
    await pointer('pointerdown', pane(), 300, 100);
    await pointer('pointermove', window, 400, 150);
    await pointer('pointerup', window, 400, 150);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });

    expect(guideLines()).toHaveLength(0);
    expect(props.onGroupFrameDragStop).toHaveBeenCalledTimes(1);
    const [res] = vi.mocked(props.onGroupFrameDragStop!).mock.calls[0];
    expect(res).toMatchObject({
      groupId: 'group-1',
      newBox: { x: 100, y: 50, w: 400, h: 300 },
      nodeNew: [{ id: 'image-1', x: 150, y: 110 }],
    });
    // 普通节点拖拽回传未被触发（组把手路径与节点拖拽互斥）
    expect(props.onNodeDragStop).not.toHaveBeenCalled();
  });
});
