// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider, type Node } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GroupOverlay from './index';

const MEDIA_NODE = {
  id: 'm1',
  type: 'mediaNode',
  position: { x: 100, y: 100 },
  measured: { width: 200, height: 200 },
  data: {},
} as Node;

let root: Root;
let container: HTMLDivElement;

function pointerDown(x: number, y: number) {
  const event = new MouseEvent('pointerdown', {
    bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: x, clientY: y,
  });
  Object.defineProperty(event, 'isPrimary', { value: true });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

async function mountOverlay(overrides: Partial<ComponentProps<typeof GroupOverlay>> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        ReactFlowProvider,
        null,
        createElement(GroupOverlay, {
          nodes: [MEDIA_NODE],
          groups: [],
          onCreateGroup: () => {},
          onUngroup: () => {},
          onDeleteGroup: () => {},
          onDownloadNodes: () => {},
          setNodes: () => {},
          ...overrides,
        }),
      ),
    );
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 900, width: 1200, height: 900,
    toJSON: () => ({}),
  });
  document.elementsFromPoint = () => [];
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

describe('GroupOverlay 捕获拦截的覆盖层放行', () => {
  it('按下目标是扩图扩展框（data-outpaint-frame 子树）：放行，不再拦死传播', async () => {
    await mountOverlay();
    const frame = document.createElement('div');
    frame.setAttribute('data-outpaint-frame', '');
    const handle = document.createElement('div');
    frame.appendChild(handle);
    document.body.appendChild(frame);
    let reached = false;
    handle.addEventListener('pointerdown', () => { reached = true; });
    handle.dispatchEvent(pointerDown(150, 150));
    expect(reached).toBe(true);
    frame.remove();
  });

  it('按下目标是裁切框（data-crop-frame 子树）：放行，不再拦死传播（IKH1WJ）', async () => {
    await mountOverlay();
    const frame = document.createElement('div');
    frame.setAttribute('data-crop-frame', '');
    const handle = document.createElement('div');
    frame.appendChild(handle);
    document.body.appendChild(frame);
    let reached = false;
    handle.addEventListener('pointerdown', () => { reached = true; });
    handle.dispatchEvent(pointerDown(150, 150));
    expect(reached).toBe(true);
    frame.remove();
  });

  it('按下目标是钉屏幕浮层（data-gen-panel-territory 子树）：放行，不再拦死传播（IKHCUA）', async () => {
    await mountOverlay();
    const overlay = document.createElement('div');
    overlay.setAttribute('data-gen-panel-territory', '');
    const button = document.createElement('button');
    overlay.appendChild(button);
    document.body.appendChild(overlay);
    let reached = false;
    button.addEventListener('pointerdown', () => { reached = true; });
    button.dispatchEvent(pointerDown(150, 150));
    expect(reached).toBe(true);
    overlay.remove();
  });

  it('按下目标是 React Flow 多选选区遮罩：放行且不塌缩选中（IKJR9T）', async () => {
    const setNodes = vi.fn();
    await mountOverlay({ setNodes });
    const selectionRect = document.createElement('div');
    selectionRect.className = 'react-flow__nodesselection-rect';
    document.body.appendChild(selectionRect);
    let reached = false;
    selectionRect.addEventListener('pointerdown', () => { reached = true; });
    selectionRect.dispatchEvent(pointerDown(150, 150));
    expect(reached).toBe(true);
    expect(setNodes).not.toHaveBeenCalled();
    selectionRect.remove();
  });

  it('对照：非豁免目标同位置按下仍被拦死（防穿透框选语义不变）', async () => {
    await mountOverlay();
    const plain = document.createElement('div');
    document.body.appendChild(plain);
    let reached = false;
    plain.addEventListener('pointerdown', () => { reached = true; });
    plain.dispatchEvent(pointerDown(150, 150));
    expect(reached).toBe(false);
    plain.remove();
  });
});

describe('GroupOverlay 抓手态整体让位（IKJFH1）', () => {
  function flowTarget() {
    const flow = document.createElement('div');
    flow.className = 'react-flow';
    const inner = document.createElement('div');
    flow.appendChild(inner);
    document.body.appendChild(flow);
    return { flow, inner };
  }

  const GROUP = { id: 'g1', box: { x: 400, y: 100, w: 200, h: 200 }, excludedIds: [] };

  it('穿透卡盒的按下不补选中、不拦传播', async () => {
    const setNodes = vi.fn();
    await mountOverlay({ isPanning: true, setNodes });
    const plain = document.createElement('div');
    document.body.appendChild(plain);
    let reached = false;
    plain.addEventListener('pointerdown', () => { reached = true; });
    plain.dispatchEvent(pointerDown(150, 150));
    expect(reached).toBe(true);
    expect(setNodes).not.toHaveBeenCalled();
    plain.remove();
  });

  it('组空白按下不启动拖组、抬起不激活组', async () => {
    const onGroupClick = vi.fn();
    await mountOverlay({ isPanning: true, groups: [GROUP], onGroupClick });
    const { flow, inner } = flowTarget();
    let reached = false;
    inner.addEventListener('pointerdown', () => { reached = true; });
    inner.dispatchEvent(pointerDown(500, 200));
    expect(reached).toBe(true);
    window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    expect(onGroupClick).not.toHaveBeenCalled();
    flow.remove();
  });

  it('双击组空白不拦截缩放与编辑判定', async () => {
    await mountOverlay({ isPanning: true, groups: [GROUP] });
    const { flow, inner } = flowTarget();
    let reached = false;
    inner.addEventListener('dblclick', () => { reached = true; });
    const event = new MouseEvent('dblclick', {
      bubbles: true, cancelable: true, button: 0, clientX: 500, clientY: 200,
    });
    inner.dispatchEvent(event);
    expect(reached).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    flow.remove();
  });
});
