// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SubtitleEraseBoxesLayer from './SubtitleEraseBoxesLayer';
import type { SubtitleBoxOp } from '../../tools/video/subtitleEraseBoxes';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const callbacks = {
  onBoxStart: vi.fn(),
  onBoxMove: vi.fn(),
  onBoxEnd: vi.fn(),
};

const BOX: SubtitleBoxOp = { kind: 'box', from: { x: 20, y: 30 }, to: { x: 120, y: 90 } };

function renderLayer(props: Partial<Parameters<typeof SubtitleEraseBoxesLayer>[0]> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(
        ReactFlowProvider,
        null,
        createElement(SubtitleEraseBoxesLayer, {
          boxes: [],
          liveBox: null,
          displayWidth: 280,
          displayHeight: 158,
          ...callbacks,
          ...props,
        } as Parameters<typeof SubtitleEraseBoxesLayer>[0]),
      ),
    );
  });
}

const layerEl = () => container!.querySelector<HTMLElement>('[data-testid="subtitle-erase-boxes-layer"]')!;

function pointer(type: string, clientX: number, clientY: number) {
  layerEl().dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY }),
  );
}

beforeEach(() => {
  callbacks.onBoxStart.mockClear();
  callbacks.onBoxMove.mockClear();
  callbacks.onBoxEnd.mockClear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe('IKGZ83 SubtitleEraseBoxesLayer 指针交互', () => {
  it('pointerdown/move/up 回调序列完整，坐标换算为相对内容区左上的显示坐标', () => {
    renderLayer();
    layerEl().getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 280, height: 158, right: 380, bottom: 208, x: 100, y: 50, toJSON: () => ({}) }) as DOMRect;
    act(() => {
      pointer('pointerdown', 150, 100);
      pointer('pointermove', 220, 130);
      pointer('pointermove', 260, 150);
      pointer('pointerup', 260, 150);
    });
    expect(callbacks.onBoxStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onBoxStart).toHaveBeenCalledWith({ x: 50, y: 50 });
    expect(callbacks.onBoxMove).toHaveBeenCalledTimes(2);
    expect(callbacks.onBoxMove).toHaveBeenLastCalledWith({ x: 160, y: 100 });
    expect(callbacks.onBoxEnd).toHaveBeenCalledTimes(1);
  });

  it('未按下时 move 不触发回调（hover 不落框）', () => {
    renderLayer();
    act(() => {
      pointer('pointermove', 30, 30);
    });
    expect(callbacks.onBoxMove).not.toHaveBeenCalled();
  });

  it('框选落笔后的 click 不冒泡出层（防止触发节点 onNodeClick 退出编辑态）', () => {
    renderLayer();
    layerEl().getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 280, height: 158, right: 380, bottom: 208, x: 100, y: 50, toJSON: () => ({}) }) as DOMRect;
    const outerClick = vi.fn();
    document.body.addEventListener('click', outerClick);
    try {
      act(() => {
        pointer('pointerdown', 150, 100);
        pointer('pointermove', 260, 150);
        pointer('pointerup', 260, 150);
        layerEl().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(callbacks.onBoxEnd).toHaveBeenCalledTimes(1);
      expect(outerClick).not.toHaveBeenCalled();
    } finally {
      document.body.removeEventListener('click', outerClick);
    }
  });
});

describe('IKGZ83 SubtitleEraseBoxesLayer 检测框渲染', () => {
  it('渲染固化框与活框预览（半透明填充 + 虚线描边，预览更低不透明度）', () => {
    renderLayer({ boxes: [BOX], liveBox: { kind: 'box', from: { x: 0, y: 0 }, to: { x: 40, y: 40 } } });
    const rects = layerEl().querySelectorAll('rect');
    expect(rects.length).toBe(2);
    expect(rects[0]!.getAttribute('x')).toBe('20');
    expect(rects[0]!.getAttribute('y')).toBe('30');
    expect(rects[0]!.getAttribute('width')).toBe('100');
    expect(rects[0]!.getAttribute('height')).toBe('60');
    expect(rects[0]!.getAttribute('opacity')).toBe('1');
    expect(rects[1]!.getAttribute('opacity')).toBe('0.7');
  });

  it('反向拖框按对角归一渲染（from 右下 / to 左上）', () => {
    renderLayer({ boxes: [{ kind: 'box', from: { x: 120, y: 90 }, to: { x: 20, y: 30 } }] });
    const rect = layerEl().querySelector('rect')!;
    expect(rect.getAttribute('x')).toBe('20');
    expect(rect.getAttribute('y')).toBe('30');
    expect(rect.getAttribute('width')).toBe('100');
    expect(rect.getAttribute('height')).toBe('60');
  });
});
