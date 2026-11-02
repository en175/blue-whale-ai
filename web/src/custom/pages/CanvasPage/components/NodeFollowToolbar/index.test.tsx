// @vitest-environment jsdom
import { act, createElement, useEffect, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import NodeFollowToolbar from './index';
import { lockChromeSelection } from '../Canvas/chromeHitGuard';
import { computeFollowAnchorAbove } from '../../agent/followDialog';

let root: Root;
let mountNode: HTMLDivElement;

async function renderTree(children: ReactNode) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(ReactFlowProvider, null, children));
  });
}

function StateInjector({ state }: { state: Record<string, unknown> }) {
  const { setState } = useStoreApi();
  useEffect(() => {
    setState(state as never);
  }, [state, setState]);
  return null;
}

function flowState(
  nodes: Array<{ id: string; x: number; y: number; width: number; height: number; selected?: boolean }>,
  transform: [number, number, number] = [0, 0, 1],
  width = 1200,
) {
  const lookup = new Map(
    nodes.map((n) => [
      n.id,
      {
        id: n.id,
        position: { x: n.x, y: n.y },
        internals: { positionAbsolute: { x: n.x, y: n.y }, z: 0 },
        measured: { width: n.width, height: n.height },
        selected: n.selected ?? false,
        data: {},
      },
    ]),
  );
  return {
    nodeLookup: lookup,
    nodes: nodes.map((n) => ({ id: n.id, selected: n.selected ?? false })),
    transform,
    width,
    height: 800,
  };
}

const TOOLBAR_TEXT = 'TOOLBAR';

function toolbar(nodeId: string, show?: boolean) {
  return (
    <NodeFollowToolbar nodeId={nodeId} show={show}>
      {TOOLBAR_TEXT}
    </NodeFollowToolbar>
  );
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('IKGYYD NodeFollowToolbar（钉屏幕工具栏容器）', () => {
  it('唯一选中节点：渲染 children，根元素钉屏幕层定位（left/top = 上方锚定换算）且带 data-gen-panel-territory', async () => {
    const state = flowState([{ id: 'n1', x: 100, y: 200, width: 400, height: 300, selected: true }]);
    await renderTree([createElement(StateInjector, { state }), toolbar('n1')]);
    const layer = mountNode.querySelector('[data-gen-panel-territory]') as HTMLElement;
    expect(layer).toBeTruthy();
    expect(layer.textContent).toBe(TOOLBAR_TEXT);
    const anchor = computeFollowAnchorAbove({
      nodeX: 100,
      nodeY: 200,
      nodeWidth: 400,
      viewport: { x: 0, y: 0, zoom: 1 },
      containerWidth: 1200,
    });
    expect(layer.style.left).toBe(`${anchor.left}px`);
    expect(layer.style.top).toBe(`${anchor.top}px`);
  });

  it('节点位置变化时锚点实时跟随（同一挂载下 store 订阅重渲染，拖动卡片的代理断言）', async () => {
    const state = flowState([{ id: 'n1', x: 100, y: 200, width: 400, height: 300, selected: true }]);
    await renderTree([createElement(StateInjector, { state }), toolbar('n1')]);
    const before = (mountNode.querySelector('[data-gen-panel-territory]') as HTMLElement).style.left;

    const moved = flowState([{ id: 'n1', x: 600, y: 500, width: 400, height: 300, selected: true }]);
    await act(async () => {
      root.render(createElement(ReactFlowProvider, null, [createElement(StateInjector, { state: moved }), toolbar('n1')]));
    });
    const layer = mountNode.querySelector('[data-gen-panel-territory]') as HTMLElement;
    expect(layer.style.left).not.toBe(before);
    expect(layer.style.left).toBe(
      `${computeFollowAnchorAbove({ nodeX: 600, nodeY: 500, nodeWidth: 400, viewport: { x: 0, y: 0, zoom: 1 }, containerWidth: 1200 }).left}px`,
    );
  });

  it('视口平移/缩放变化时锚点跟随（zoom 只换算位置）', async () => {
    const state = flowState([{ id: 'n1', x: 100, y: 200, width: 400, height: 300, selected: true }], [40, -20, 2]);
    await renderTree([createElement(StateInjector, { state }), toolbar('n1')]);
    const layer = mountNode.querySelector('[data-gen-panel-territory]') as HTMLElement;
    expect(layer.style.left).toBe(
      `${computeFollowAnchorAbove({ nodeX: 100, nodeY: 200, nodeWidth: 400, viewport: { x: 40, y: -20, zoom: 2 }, containerWidth: 1200 }).left}px`,
    );
  });

  it('多选抑制：画布存在两个选中节点时不渲染（useSoloNodeSelected 口径不变）', async () => {
    const state = flowState([
      { id: 'n1', x: 100, y: 200, width: 400, height: 300, selected: true },
      { id: 'n2', x: 800, y: 200, width: 400, height: 300, selected: true },
    ]);
    await renderTree([createElement(StateInjector, { state }), toolbar('n1')]);
    expect(mountNode.querySelector('[data-gen-panel-territory]')).toBeNull();
  });

  it('目标节点未被选中时不渲染', async () => {
    const state = flowState([{ id: 'n1', x: 100, y: 200, width: 400, height: 300, selected: false }]);
    await renderTree([createElement(StateInjector, { state }), toolbar('n1')]);
    expect(mountNode.querySelector('[data-gen-panel-territory]')).toBeNull();
  });

  it('调用方数据条件 show=false 时不渲染（显示时机归调用方，多选抑制归容器）', async () => {
    const state = flowState([{ id: 'n1', x: 100, y: 200, width: 400, height: 300, selected: true }]);
    await renderTree([createElement(StateInjector, { state }), toolbar('n1', false)]);
    expect(mountNode.querySelector('[data-gen-panel-territory]')).toBeNull();
  });

  it('nodeId 不在画布（节点已删除/未挂载）时不渲染', async () => {
    const state = flowState([{ id: 'n1', x: 100, y: 200, width: 400, height: 300, selected: true }]);
    await renderTree([createElement(StateInjector, { state }), toolbar('gone')]);
    expect(mountNode.querySelector('[data-gen-panel-territory]')).toBeNull();
  });

  it('hovered=true 且节点未选中：仍渲染（IKGYYF hover 显示等价原 CSS :hover，不受唯一选中门约束）', async () => {
    const state = flowState([{ id: 'n1', x: 100, y: 200, width: 400, height: 300, selected: false }]);
    await renderTree([
      createElement(StateInjector, { key: 'state', state }),
      <NodeFollowToolbar key="toolbar" nodeId="n1" hovered>
        {TOOLBAR_TEXT}
      </NodeFollowToolbar>,
    ]);
    const layer = mountNode.querySelector('[data-gen-panel-territory]') as HTMLElement;
    expect(layer).toBeTruthy();
    expect(layer.textContent).toBe(TOOLBAR_TEXT);
  });

  it('多选抑制下 hovered=true 仍渲染（hover 语义与选中集合无关；show 数据门照旧生效）', async () => {
    const state = flowState([
      { id: 'n1', x: 100, y: 200, width: 400, height: 300, selected: true },
      { id: 'n2', x: 800, y: 200, width: 400, height: 300, selected: true },
    ]);
    await renderTree([
      createElement(StateInjector, { key: 'state', state }),
      <NodeFollowToolbar key="toolbar" nodeId="n1" hovered>
        {TOOLBAR_TEXT}
      </NodeFollowToolbar>,
      <NodeFollowToolbar key="hidden" nodeId="n1" hovered={true} show={false}>
        HIDDEN
      </NodeFollowToolbar>,
    ]);
    const layers = [...mountNode.querySelectorAll('[data-gen-panel-territory]')];
    expect(layers).toHaveLength(1);
    expect(layers[0].textContent).toBe(TOOLBAR_TEXT);
  });
});

describe('IKIXDB NodeFollowToolbar 浮层滚轮直通', () => {
  let forwarded: WheelEvent[];

  function FlowStub({ children }: { children: ReactNode }) {
    const rendererRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const el = rendererRef.current;
      if (!el) return;
      const onWheel = (e: Event) => forwarded.push(e as WheelEvent);
      el.addEventListener('wheel', onWheel);
      return () => el.removeEventListener('wheel', onWheel);
    }, []);
    return createElement('div', { className: 'react-flow' },
      createElement('div', { className: 'react-flow__renderer', ref: rendererRef }),
      children,
    );
  }

  async function dispatchWheel(target: EventTarget, init: WheelEventInit) {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    await act(async () => { target.dispatchEvent(event); });
    return event;
  }

  const soloState = flowState([{ id: 'n1', x: 100, y: 200, width: 400, height: 300, selected: true }]);

  beforeEach(() => {
    forwarded = [];
  });

  it('工具条上的滚轮转发 renderer 且字段保留、原事件拦默认', async () => {
    await renderTree([createElement(StateInjector, { state: soloState }), createElement(FlowStub, null, toolbar('n1'))]);
    const layer = mountNode.querySelector('[data-gen-panel-territory]') as HTMLElement;
    const event = await dispatchWheel(layer, {
      clientX: 30, clientY: 40, deltaX: 5, deltaY: 10,
      ctrlKey: true, shiftKey: true, altKey: true, metaKey: true,
    });
    expect(forwarded).toHaveLength(1);
    const received = forwarded[0];
    expect(received.clientX).toBe(30);
    expect(received.clientY).toBe(40);
    expect(received.deltaX).toBe(5);
    expect(received.deltaY).toBe(10);
    expect(received.ctrlKey).toBe(true);
    expect(received.shiftKey).toBe(true);
    expect(received.altKey).toBe(true);
    expect(received.metaKey).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('工具条内可滚动子区滚自身、不转发；ctrl 时拦整页缩放', async () => {
    await renderTree([
      createElement(StateInjector, { state: soloState }),
      createElement(FlowStub, null,
        <NodeFollowToolbar nodeId="n1">
          <div data-testid="toolbar-scroll" style={{ overflowY: 'auto' }} />
        </NodeFollowToolbar>,
      ),
    ]);
    const stub = mountNode.querySelector<HTMLElement>('[data-testid="toolbar-scroll"]')!;
    Object.defineProperty(stub, 'scrollHeight', { value: 500, configurable: true });
    Object.defineProperty(stub, 'clientHeight', { value: 100, configurable: true });
    const plain = await dispatchWheel(stub, { deltaY: 50 });
    expect(forwarded).toHaveLength(0);
    expect(plain.defaultPrevented).toBe(false);
    const ctrl = await dispatchWheel(stub, { deltaY: 50, ctrlKey: true });
    expect(forwarded).toHaveLength(0);
    expect(ctrl.defaultPrevented).toBe(true);
  });

  it('工具条卸载后不再布防（条件渲染翻转不泄漏监听）', async () => {
    await renderTree([
      createElement(StateInjector, { state: soloState }),
      createElement(FlowStub, null, toolbar('n1')),
    ]);
    const layer = mountNode.querySelector('[data-gen-panel-territory]') as HTMLElement;
    expect(layer).toBeTruthy();
    await act(async () => {
      root.render(createElement(ReactFlowProvider, null, [
        createElement(StateInjector, { state: soloState }),
        createElement(FlowStub, null, toolbar('n1', false)),
      ]));
    });
    expect(mountNode.querySelector('[data-gen-panel-territory]')).toBeNull();
    await dispatchWheel(layer, { deltaY: 10 });
    expect(forwarded).toHaveLength(0);
  });
});

describe('IKR398 操作栏自身按下不触发自动隐藏', () => {
  it('在操作栏内按下（锁来源=浮层）后，重渲染仍保留操作栏', async () => {
    const state = flowState([{ id: 'n1', x: 100, y: 200, width: 400, height: 300, selected: true }]);
    await renderTree([createElement(StateInjector, { state }), toolbar('n1')]);
    expect(mountNode.querySelector('[data-gen-panel-territory]')).not.toBeNull();

    await act(async () => { lockChromeSelection(['n1'], 'territory'); });
    const moved = flowState([{ id: 'n1', x: 120, y: 220, width: 400, height: 300, selected: true }]);
    await act(async () => {
      root.render(createElement(ReactFlowProvider, null, [createElement(StateInjector, { state: moved }), toolbar('n1')]));
    });

    expect(mountNode.querySelector('[data-gen-panel-territory]')).not.toBeNull();
    expect(mountNode.textContent).toContain(TOOLBAR_TEXT);
  });

  it('左侧工具条等非浮层来源的锁仍然隐藏操作栏（原有防穿透口径）', async () => {
    const state = flowState([{ id: 'n1', x: 100, y: 200, width: 400, height: 300, selected: true }]);
    await renderTree([createElement(StateInjector, { state }), toolbar('n1')]);

    await act(async () => { lockChromeSelection(['n1']); });
    const moved = flowState([{ id: 'n1', x: 120, y: 220, width: 400, height: 300, selected: true }]);
    await act(async () => {
      root.render(createElement(ReactFlowProvider, null, [createElement(StateInjector, { state: moved }), toolbar('n1')]));
    });

    expect(mountNode.querySelector('[data-gen-panel-territory]')).toBeNull();
  });
});
