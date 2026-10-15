// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge } from '@xyflow/react';
import FlowCanvas from './index';
import edgeStyles from '../CustomEdge/index.module.css';


vi.hoisted(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof FlowCanvas>;

const EDGE: Edge = { id: 'e1', source: 'text-1', target: 'text-2', type: 'custom' };

const DWELL_MS = 1000;

function textNode(id: string, x: number) {
  return {
    id,
    type: 'textNode',
    position: { x, y: 60 },
    data: { html: `<p>${id} 正文</p>`, toolMode: 'select' },
  };
}

async function renderCanvas(overrides: Partial<ComponentProps<typeof FlowCanvas>> = {}) {
  await act(async () => {
    root.render(createElement(FlowCanvas, { ...props, ...overrides }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', class {
    callback: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.callback = cb; }
    observe(target: Element) {
      this.callback([{ target, contentRect: { width: 1000, height: 800 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal('DOMMatrixReadOnly', class {
    m22: number;
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([1-9.])\)/)?.[1];
      this.m22 = scale !== undefined ? +scale : 1;
    }
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800,
    toJSON: () => ({}),
  });
  (document as Document & { execCommand: (...args: unknown[]) => boolean }).execCommand = vi.fn(() => true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  props = {
    toolMode: 'select', showMiniMap: false, showEdges: true, hideZoomControl: true,
    extraNodes: [], textNodes: [textNode('text-1', 50), textNode('text-2', 400)],
    mediaNodes: [], productNodes: [], assetNodes: [],
    edges: [EDGE],
    onEdgesChange: vi.fn(),
    onConnect: vi.fn(),
    viewport: { x: 0, y: 0, zoom: 1 },
    onDeleteNode: vi.fn(), onNodeDragStop: vi.fn(), onViewportChange: vi.fn(),
    onNodeClick: vi.fn(), onPaneClick: vi.fn(),
  };
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  document.body.innerHTML = '';
  Reflect.deleteProperty(document, 'execCommand');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Canvas 受控连线', () => {
  it('showEdges 开启时渲染受控 edges，关闭时不渲染', async () => {
    await renderCanvas();
    await vi.waitFor(() =>
      expect(container.querySelector('.react-flow__edge')).not.toBeNull(),
    );

    await renderCanvas({ showEdges: false });
    expect(container.querySelector('.react-flow__edge')).toBeNull();
  });

  it('剪刀停稳 1 秒出现后单击，经 onEdgesChange 上抛 remove 变更（受控模式下父级落状态）', async () => {
    await renderCanvas();
    await vi.waitFor(() =>
      expect(container.querySelector('.react-flow__edge')).not.toBeNull(),
    );

    await act(async () => {
      container
        .querySelector(`.${edgeStyles.hitPath}`)!
        .dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 100 }));
    });
    expect(container.querySelector(`.${edgeStyles.deleteBtnVisible}`)).toBeNull();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, DWELL_MS + 100));
    });
    await vi.waitFor(
      () => expect(container.querySelector(`.${edgeStyles.deleteBtnVisible}`)).not.toBeNull(),
      { timeout: 3000 },
    );

    await act(async () => {
      container
        .querySelector(`.${edgeStyles.deleteBtn}`)!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() =>
      expect(props.onEdgesChange).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ type: 'remove', id: 'e1' })]),
      ),
    );
  });
});
