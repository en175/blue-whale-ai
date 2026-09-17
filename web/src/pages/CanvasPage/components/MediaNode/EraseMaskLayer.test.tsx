// @vitest-environment jsdom
/* IKGOTB EraseMaskLayer 组件测试：棋盘格 SVG mask 渲染（涂=白/橡皮=黑按序覆盖）、
   指针事件→显示坐标换算（clientXY 偏移，zoom=1 基准）、按下拖动抬起完整回调序列。
   渲染模式沿用 ImageEnhanceDialog 测试（createRoot + act）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EraseMaskLayer from './EraseMaskLayer';
import type { MaskOp } from '../../eraseMask';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const callbacks = {
  onStrokeStart: vi.fn(),
  onStrokeMove: vi.fn(),
  onStrokeEnd: vi.fn(),
};

function renderLayer(props: Partial<Parameters<typeof EraseMaskLayer>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(
        ReactFlowProvider,
        null,
        createElement(EraseMaskLayer, {
          ops: [],
          liveOp: null,
          displayWidth: 280,
          displayHeight: 158,
          ...callbacks,
          ...props,
        } as Parameters<typeof EraseMaskLayer>[0]),
      ),
    );
  });
}

const layerEl = () => container!.querySelector<HTMLElement>('[data-testid="erase-mask-layer"]')!;

/** 指针事件（jsdom 无 PointerEvent，用 MouseEvent 带 pointer 类型触发 React 合成指针事件） */
function pointer(type: string, clientX: number, clientY: number) {
  layerEl().dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY }),
  );
}

beforeEach(() => {
  callbacks.onStrokeStart.mockClear();
  callbacks.onStrokeMove.mockClear();
  callbacks.onStrokeEnd.mockClear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe('IKGOTB EraseMaskLayer 指针交互', () => {
  it('pointerdown/move/up 回调序列完整，坐标换算为相对内容区左上的显示坐标', async () => {
    renderLayer();
    // jsdom 布局恒零：stub 内容区屏幕盒（left 100 / top 50），zoom=1（ReactFlowProvider 默认）
    layerEl().getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 280, height: 158, right: 380, bottom: 208, x: 100, y: 50, toJSON: () => ({}) }) as DOMRect;
    act(() => {
      pointer('pointerdown', 150, 100);
      pointer('pointermove', 220, 130);
      pointer('pointermove', 260, 150);
      pointer('pointerup', 260, 150);
    });
    expect(callbacks.onStrokeStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onStrokeStart).toHaveBeenCalledWith({ x: 50, y: 50 });
    expect(callbacks.onStrokeMove).toHaveBeenCalledTimes(2);
    expect(callbacks.onStrokeMove).toHaveBeenLastCalledWith({ x: 160, y: 100 });
    expect(callbacks.onStrokeEnd).toHaveBeenCalledTimes(1);
  });

  it('未按下时 move 不触发回调（hover 不画线）', () => {
    renderLayer();
    layerEl().getBoundingClientRect = () => ({ left: 0, top: 0, width: 280, height: 158 }) as DOMRect;
    act(() => {
      pointer('pointermove', 30, 30);
    });
    expect(callbacks.onStrokeMove).not.toHaveBeenCalled();
  });
});

describe('IKGOTB EraseMaskLayer 棋盘格渲染', () => {
  it('按序渲染图元 mask（涂=white/橡皮=black）与棋盘格填充层（半透明叠加）', () => {
    const ops: MaskOp[] = [
      { kind: 'stroke', erase: false, points: [{ x: 10, y: 10 }, { x: 60, y: 40 }], radius: 12 },
      { kind: 'rect', erase: false, from: { x: 100, y: 20 }, to: { x: 200, y: 120 } },
      { kind: 'stroke', erase: true, points: [{ x: 30, y: 30 }], radius: 8 },
    ];
    renderLayer({ ops });
    const mask = container!.querySelector('mask')!;
    expect(mask).toBeTruthy();
    // mask 黑底 + 三个图元（path 涂白 / rect 涂白 / circle 橡皮黑），按序覆盖
    const shapes = mask.querySelectorAll('path, rect, circle');
    expect(shapes.length).toBe(4); // 黑底 rect + path + rect + circle
    expect(shapes[1]!.getAttribute('stroke')).toBe('white');
    expect(shapes[2]!.getAttribute('fill')).toBe('white');
    expect(shapes[3]!.getAttribute('fill')).toBe('black');
    // 棋盘格 pattern + 应用 mask 的填充层（半透明）
    expect(container!.querySelector('pattern')).toBeTruthy();
    const painted = [...container!.querySelectorAll('rect')].find((r) => r.getAttribute('mask'));
    expect(painted).toBeTruthy();
    expect(Number(painted!.getAttribute('opacity'))).toBeLessThan(1);
  });

  it('活笔（liveOp）参与渲染预览：拖拽中即可见', () => {
    renderLayer({
      liveOp: { kind: 'rect', erase: false, from: { x: 0, y: 0 }, to: { x: 80, y: 60 } },
    });
    const mask = container!.querySelector('mask')!;
    const shapes = mask.querySelectorAll('path, rect, circle');
    expect(shapes.length).toBe(2); // 黑底 + 活框
  });

  it('无图元时仅黑底（无涂区渲染，棋盘格不可见区域为空）', () => {
    renderLayer();
    const mask = container!.querySelector('mask')!;
    expect(mask.querySelectorAll('path, rect, circle').length).toBe(1);
  });
});
