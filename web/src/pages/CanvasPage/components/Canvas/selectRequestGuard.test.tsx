// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';


vi.hoisted(() => {
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

function latestRender(id: string) {
  for (let i = mediaRenderLog.length - 1; i >= 0; i -= 1) {
    if (mediaRenderLog[i]!.id === id) return mediaRenderLog[i]!;
  }
  return null;
}

async function requestSelect(id: string, ts: number) {
  await act(async () => {
    root.render(createElement(FlowCanvas, { ...props, selectRequest: { id, ts } }));
  });
  await act(async () => {});
}

async function parentRerenderBaseline(id: string, ts: number) {
  mediaRenderLog.length = 0;
  await requestSelect(id, ts);
  return mediaRenderLog.length;
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
    await requestSelect('a', 1001);
    expect(node('a').classList.contains('selected')).toBe(true);
    expect(node('b').classList.contains('selected')).toBe(false);
    expect(latestRender('a')!.selected).toBe(true);
    const selectionCalls = vi.mocked(props.onSelectionChange!).mock.calls.length;
    const baseline = await parentRerenderBaseline('a', 1001);
    expect(baseline).toBeLessThan(10);
    mediaRenderLog.length = 0;

    await requestSelect('a', 1002);

    expect(mediaRenderLog.length).toBe(baseline);
    expect(node('a').classList.contains('selected')).toBe(true);
    expect(node('b').classList.contains('selected')).toBe(false);
    expect(props.onSelectionChange).toHaveBeenCalledTimes(selectionCalls);
  });

  it('选中集合真实变化：照常生效，选中正确落在目标卡（旧选中取消、新目标选中）', async () => {
    await requestSelect('a', 1001);
    expect(node('a').classList.contains('selected')).toBe(true);

    await requestSelect('b', 1002);

    expect(node('b').classList.contains('selected')).toBe(true);
    expect(node('a').classList.contains('selected')).toBe(false);
    expect(latestRender('a')!.selected).toBe(false);
    expect(latestRender('b')!.selected).toBe(true);
    expect(props.onSelectionChange).toHaveBeenCalled();
    const lastCall = vi.mocked(props.onSelectionChange!).mock.lastCall![0];
    expect(lastCall.nodes.map((n: Node) => n.id)).toEqual(['b']);
  });

  it('边界：目标 id 不在节点列表——已有选中时视为真实变化清空选中；稳态重复请求不重建', async () => {
    await requestSelect('a', 1001);
    expect(node('a').classList.contains('selected')).toBe(true);
    await requestSelect('ghost', 1002);
    expect(node('a').classList.contains('selected')).toBe(false);
    expect(node('b').classList.contains('selected')).toBe(false);

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

    await requestSelect('a', 1001);
    await requestSelect('a', 1002);

    expect(container.querySelector('[data-id="a"]')).toBeNull();
    expect(mediaRenderLog.length).toBe(0);
  });
});
