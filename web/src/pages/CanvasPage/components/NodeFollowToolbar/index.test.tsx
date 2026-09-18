// @vitest-environment jsdom
/* IKGYYD 钉屏幕工具栏容器（NodeFollowToolbar）测试：渲染模式沿用 MediaNode/index.test.tsx
   （createRoot + act）；store 状态经 ReactFlowProvider 的 useStoreApi().setState 直接注入
   （组件只订阅 nodeLookup/transform/width 与选中集合，不依赖真实 ReactFlow 测量），
   断言口径：锚点 = computeFollowAnchorAbove 手算值、根元素带 data-gen-panel-territory
   （IKFYH6 点外关闭豁免）、唯一选中门（useSoloNodeSelected）与调用方 show 条件。 */
import { act, createElement, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import NodeFollowToolbar from './index';
import { computeFollowAnchorAbove } from '../../followDialog';

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

/** 注入 React Flow store 状态（挂载后 effect 内生效；state prop 变化时重注入，
 *  同一挂载下驱动被测组件的 store 订阅重渲染——拖动/平移跟随的代理链路） */
function StateInjector({ state }: { state: Record<string, unknown> }) {
  const { setState } = useStoreApi();
  useEffect(() => {
    setState(state as never);
  }, [state, setState]);
  return null;
}

/** 构造注入用的节点查找表与选中数组 */
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
