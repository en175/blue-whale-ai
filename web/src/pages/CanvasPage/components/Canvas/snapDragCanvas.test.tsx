// @vitest-environment jsdom
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

async function dragNodeTo(id: string, x: number, y: number) {
  await mouse('mousedown', node(id), 100, 100);
  await mouse('mousemove', window, 104, 103);
  await mouse('mousemove', window, x, y);
  const linesDuringDrag = guideLines().length;
  await mouse('mouseup', window, x, y);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  return linesDuringDrag;
}

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
    expect(node('image-1').classList.contains('selected')).toBe(true);
    expect(node('image-2').classList.contains('selected')).toBe(true);
    expect(node('image-3').classList.contains('selected')).toBe(false);

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
    expect(props.onNodeDragStop).not.toHaveBeenCalled();
  });
});
