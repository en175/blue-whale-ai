// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Node } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FlowCanvas from './index';

vi.hoisted(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof FlowCanvas>;
const resizeNotifications: (() => void)[] = [];

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  resizeNotifications.length = 0;
  vi.stubGlobal('ResizeObserver', class {
    callback: (entries: { target: Element; contentRect: { width: number; height: number } }[]) => void;
    constructor(callback: (entries: { target: Element; contentRect: { width: number; height: number } }[]) => void) { this.callback = callback; }
    observe(target: Element) {
      resizeNotifications.push(() => this.callback([{ target, contentRect: { width: 1000, height: 800 } }]));
    }
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal('DOMMatrixReadOnly', class { m22 = 1; });
  document.elementsFromPoint = () => [];
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('react-flow__node') ? 200 : 1000;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('react-flow__node') ? 120 : 800;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800,
    toJSON: () => ({}),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  props = {
    toolMode: 'select', showMiniMap: false, showEdges: false, hideZoomControl: true,
    extraNodes: [], mediaNodes: [], productNodes: [], assetNodes: [], edges: [],
    textNodes: [0, 1, 2].map((index) => ({
      id: `n${index}`, type: 'textNode', position: { x: index * 300, y: 0 }, selected: index < 2,
      data: { text: '正文', toolMode: 'select' },
    })),
    groups: [{ id: 'A', box: { x: -48, y: -48, w: 896, h: 216 }, excludedIds: [] }],
    onEdgesChange: vi.fn(), onConnect: vi.fn(), onDeleteNode: vi.fn(),
    onCreateGroup: vi.fn(), onNodesMeasured: vi.fn(),
  };
  await act(async () => { root.render(createElement(FlowCanvas, props)); });
  await act(async () => { resizeNotifications.splice(0).forEach((notify) => notify()); });
  await act(async () => { resizeNotifications.splice(0).forEach((notify) => notify()); });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  Reflect.deleteProperty(document, 'elementsFromPoint');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('IKI6C1 成组实测节点接线', () => {
  it('全部内容节点测量后通知恢复层，不把组框作为内容节点', () => {
    const calls = vi.mocked(props.onNodesMeasured!).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const measured = calls.at(-1)![0];
    expect(measured.map((node) => node.id)).toEqual(['n0', 'n1', 'n2']);
    expect(measured.every((node) => node.measured?.width === 200 && node.measured.height === 120)).toBe(true);
  });

  it.each(['button', 'keyboard'])('%s 成组传入全部实测节点用于旧组收尾', async (entry) => {
    await act(async () => {
      if (entry === 'keyboard') {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true, cancelable: true }));
      } else {
        container.querySelector<HTMLButtonElement>('button[title="成组（Ctrl/Cmd+G）"]')!.click();
      }
    });
    const [selected, all] = vi.mocked(props.onCreateGroup!).mock.calls[0];
    expect(selected.map((node) => node.id)).toEqual(['n0', 'n1']);
    const content = all.filter((node: Node) => node.type !== 'groupFrame');
    expect(content.map((node) => node.id)).toEqual(['n0', 'n1', 'n2']);
    expect(content.every((node) => node.measured?.width === 200)).toBe(true);
  });
});
