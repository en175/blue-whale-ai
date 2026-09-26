// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';

/* IKIJ62 显式选中请求等值守卫（容器级回归）：selectRequest effect 曾无条件全量重建
   节点数组——每个节点换新对象，等值选中请求（目标已唯一选中、仅 ts 变化）也放大一轮
   全部节点重渲染，是选中循环的放大器之一。守卫契约：目标选中集合与当前一致时节点数组
   引用保持不变（不重建节点对象）；选中集合真实变化时逐节点产出正确 selected。

   断言机制：React Flow adoptUserNodes 对 userNode 引用相同的节点复用 internalNode
   （checkEquality 分支），NodeWrapper（memo + useStore shallow 订阅）随之不重渲染；
   引用一变必重渲染。故 MediaNode 打桩的渲染日志（次数与 data 引用）即「节点对象是否
   被重建」的外部可观察证据。 */

vi.hoisted(() => {
  // 开发期代码定位插件在导入时探测 Canvas；本测试不绘制位图。
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

const mediaRenderLog = vi.hoisted(() => [] as Array<{ id: string; data: unknown; selected: boolean | undefined }>);
vi.mock('../MediaNode', async () => {
  const { createElement } = await import('react');
  return {
    default: (props: { id: string; data: unknown; selected?: boolean }) => {
      mediaRenderLog.push({ id: props.id, data: props.data, selected: props.selected });
      return createElement('div', { 'data-testid': `media-card-${props.id}` });
    },
  };
});

import FlowCanvas from './index';

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof FlowCanvas>;

function node(id: string) {
  return container.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
}

function mediaNode(id: string, x: number) {
  return {
    id, type: 'mediaNode' as const, position: { x, y: 0 },
    data: { mediaType: 'image', src: 'blob:test', fileName: id, toolMode: 'select' },
  };
}

/** 节点渲染日志中该 id 的最后一条（无则 null） */
function latestRender(id: string) {
  for (let i = mediaRenderLog.length - 1; i >= 0; i -= 1) {
    if (mediaRenderLog[i]!.id === id) return mediaRenderLog[i]!;
  }
  return null;
}

/** 以新的 selectRequest 重渲染（复刻父层每轮下传新请求对象，ts 驱动去重） */
async function requestSelect(id: string, ts: number) {
  await act(async () => {
    root.render(createElement(FlowCanvas, { ...props, selectRequest: { id, ts } }));
  });
  await act(async () => {});
}

/** 父链重渲染基线：重复同一 ts 的请求对象——effect 经 ts 去重早退（完全不写节点状态），
 *  剩余节点渲染即 FlowCanvasInner 重渲染的既有组件树基线（与本单守卫无关）。 */
async function parentRerenderBaseline(id: string, ts: number) {
  mediaRenderLog.length = 0;
  await requestSelect(id, ts);
  return mediaRenderLog.length;
}

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom 不做布局；只补浏览器测量 API，React Flow 与选中链路使用真实实现（marqueeSelect 先例）。
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
    extraNodes: [] as Node[], textNodes: [] as Node[], productNodes: [] as Node[], assetNodes: [] as Node[],
    edges: [], onEdgesChange: vi.fn(), onConnect: vi.fn(),
    mediaNodes: [mediaNode('a', 50), mediaNode('b', 500)],
    viewport: { x: 0, y: 0, zoom: 1 },
    onDeleteNode: vi.fn(), onNodeDragStop: vi.fn(), onViewportChange: vi.fn(),
    onNodeClick: vi.fn(), onPaneClick: vi.fn(),
    onSelectionChange: vi.fn(),
  };
  await act(async () => { root.render(createElement(FlowCanvas, props)); });
  await act(async () => {});
  // 挂载/水合期渲染不计入断言，从稳态起算。
  mediaRenderLog.length = 0;
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('IKIJ62 显式选中请求等值守卫（selectRequest）', () => {
  it('等值请求（目标已唯一选中、仅 ts 变）：节点对象不重建，零额外渲染、选中态无回跳', async () => {
    await requestSelect('a', 1001); // 真实变化：无选中 → 唯一选中 a
    expect(node('a').classList.contains('selected')).toBe(true);
    expect(node('b').classList.contains('selected')).toBe(false);
    expect(latestRender('a')!.selected).toBe(true);
    const selectionCalls = vi.mocked(props.onSelectionChange!).mock.calls.length;
    const baseline = await parentRerenderBaseline('a', 1001); // 同 ts 重复：effect 早退基线
    expect(baseline).toBeLessThan(10); // 父链基线本身个位数
    mediaRenderLog.length = 0;

    await requestSelect('a', 1002); // 等值：目标选中集合与当前一致，仅 ts 变化

    // 节点对象未重建 → adoptUserNodes 复用 internalNode → 与「完全不应用」渲染等效，
    // 零额外放大（修复前此请求无条件全量重建节点数组，节点重渲染数倍于基线）
    expect(mediaRenderLog.length).toBe(baseline);
    // 选中态保持、无回跳
    expect(node('a').classList.contains('selected')).toBe(true);
    expect(node('b').classList.contains('selected')).toBe(false);
    // 无选中集合变化 → 不产生新的等值通报
    expect(props.onSelectionChange).toHaveBeenCalledTimes(selectionCalls);
  });

  it('选中集合真实变化：照常生效，选中正确落在目标卡（旧选中取消、新目标选中）', async () => {
    await requestSelect('a', 1001);
    expect(node('a').classList.contains('selected')).toBe(true);

    await requestSelect('b', 1002); // 真实切换：a → b

    expect(node('b').classList.contains('selected')).toBe(true);
    expect(node('a').classList.contains('selected')).toBe(false);
    // 节点对象按需重建且 selected 逐节点正确
    expect(latestRender('a')!.selected).toBe(false);
    expect(latestRender('b')!.selected).toBe(true);
    // 真实变化经 React Flow 正常通报
    expect(props.onSelectionChange).toHaveBeenCalled();
    const lastCall = vi.mocked(props.onSelectionChange!).mock.lastCall![0];
    expect(lastCall.nodes.map((n: Node) => n.id)).toEqual(['b']);
  });

  it('边界：目标 id 不在节点列表——已有选中时视为真实变化清空选中；稳态重复请求不重建', async () => {
    // 已有选中：应用后目标集合为空（ghost 不存在）≠ 当前（a 选中）→ 真实变化，取消全部选中
    await requestSelect('a', 1001);
    expect(node('a').classList.contains('selected')).toBe(true);
    await requestSelect('ghost', 1002);
    expect(node('a').classList.contains('selected')).toBe(false);
    expect(node('b').classList.contains('selected')).toBe(false);

    // 稳态无选中 + ghost：目标集合（空）与当前（空）一致 → 等值守卫，零额外渲染
    const baseline = await parentRerenderBaseline('ghost', 1002);
    mediaRenderLog.length = 0;
    await requestSelect('ghost', 1003);
    expect(mediaRenderLog.length).toBe(baseline);
    expect(node('a').classList.contains('selected')).toBe(false);
    expect(node('b').classList.contains('selected')).toBe(false);
  });

  it('空节点列表下的选中请求安全（不抛错、无多余渲染）', async () => {
    props = { ...props, mediaNodes: [] };
    await act(async () => {
      root.render(createElement(FlowCanvas, props));
    });
    await act(async () => {});
    mediaRenderLog.length = 0;

    await requestSelect('a', 1001); // a 已不在节点列表
    await requestSelect('a', 1002); // 等值重复

    expect(container.querySelector('[data-id="a"]')).toBeNull();
    expect(mediaRenderLog.length).toBe(0);
  });
});
