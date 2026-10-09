// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AudioTrimOverlay from './AudioTrimOverlay';
import { AUDIO_TRIM_MIN_SEGMENT_SECONDS } from '../../audioTrimGeometry';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const callbacks = {
  onSelectionChange: vi.fn(),
  onSeekStart: vi.fn(),
  onSeek: vi.fn(),
  onSeekEnd: vi.fn(),
};

function renderOverlay(props: Partial<Parameters<typeof AudioTrimOverlay>[0]> = {}) {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      createElement(AudioTrimOverlay, {
        selection: { start: 0, end: 15 },
        duration: 15,
        ...callbacks,
        ...props,
      }),
    );
  });
}

const overlayEl = () => container!.querySelector<HTMLElement>('[data-testid="audio-trim-overlay"]')!;

function pointer(target: Element, type: string, clientX: number, button = 0) {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button }),
  );
}

function stubRect() {
  overlayEl().getBoundingClientRect = () =>
    ({ left: 100, top: 50, width: 300, height: 158, right: 400, bottom: 208, x: 100, y: 50, toJSON: () => ({}) }) as DOMRect;
}

function stubCapture(el: Element) {
  (el as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture = () => {};
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  for (const fn of Object.values(callbacks)) fn.mockClear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe('四件套渲染', () => {
  it('渲染两侧暗区 + 白色选区框 + 中央胶囊 + 左右抓手，几何随选区联动', () => {
    renderOverlay({ selection: { start: 3, end: 12 }, duration: 15 });
    const dims = overlayEl().querySelectorAll<HTMLElement>('div');
    const dimEls = Array.from(dims).filter((el) => el.className.includes('dim'));
    expect(dimEls).toHaveLength(2);
    expect(dimEls[0]!.style.width).toBe('20%');
    expect(dimEls[1]!.style.left).toBe('80%');
    const selection = container!.querySelector<HTMLElement>('[data-testid="audio-trim-selection"]')!;
    expect(selection.style.left).toBe('20%');
    expect(selection.style.width).toBe('60%');
    expect(container!.querySelector('[data-testid="audio-trim-pill"]')!.textContent).toBe('9.0 s');
    expect((container!.querySelector('[data-testid="audio-trim-handle-start"]') as HTMLElement)!.style.left).toBe('20%');
    expect((container!.querySelector('[data-testid="audio-trim-handle-end"]') as HTMLElement)!.style.left).toBe('80%');
  });

  it('抓手拖拽实时联动胶囊与暗区（选区 state 受控由父级回填）', () => {
    renderOverlay({ selection: { start: 0, end: 15 }, duration: 15 });
    expect(container!.querySelector('[data-testid="audio-trim-pill"]')!.textContent).toBe('15.0 s');
    renderOverlay({ selection: { start: 0, end: 5 }, duration: 15 });
    expect(container!.querySelector('[data-testid="audio-trim-pill"]')!.textContent).toBe('5.0 s');
  });
});

describe('抓手拖拽：换算与钳制', () => {
  it('左缘抓手跟随指针（300px 盒上 clientX 160 → 3s）', () => {
    renderOverlay({ selection: { start: 0, end: 15 }, duration: 15 });
    stubRect();
    const handle = container!.querySelector('[data-testid="audio-trim-handle-start"]')!;
    stubCapture(handle);
    act(() => {
      pointer(handle, 'pointerdown', 130);
      pointer(overlayEl(), 'pointermove', 160);
      pointer(overlayEl(), 'pointerup', 160);
    });
    expect(callbacks.onSelectionChange).toHaveBeenCalledWith({ start: 3, end: 15 });
  });

  it('左缘钳 [0, end-0.1]：拖过右缘不越过（最小 0.1 秒）', () => {
    renderOverlay({ selection: { start: 2, end: 13 }, duration: 15 });
    stubRect();
    const handle = container!.querySelector('[data-testid="audio-trim-handle-start"]')!;
    stubCapture(handle);
    act(() => {
      pointer(handle, 'pointerdown', 130);
      pointer(overlayEl(), 'pointermove', 360);
    });
    expect(callbacks.onSelectionChange).toHaveBeenLastCalledWith({
      start: 13 - AUDIO_TRIM_MIN_SEGMENT_SECONDS,
      end: 13,
    });
  });

  it('右缘钳 [start+0.1, duration]：拖过全长钳回 duration、拖过左缘钳回最小片段', () => {
    renderOverlay({ selection: { start: 2, end: 13 }, duration: 15 });
    stubRect();
    const handle = container!.querySelector('[data-testid="audio-trim-handle-end"]')!;
    stubCapture(handle);
    act(() => {
      pointer(handle, 'pointerdown', 360);
      pointer(overlayEl(), 'pointermove', 999);
      pointer(overlayEl(), 'pointerup', 999);
    });
    expect(callbacks.onSelectionChange).toHaveBeenLastCalledWith({ start: 2, end: 15 });
    act(() => {
      pointer(handle, 'pointerdown', 360);
      pointer(overlayEl(), 'pointermove', 141);
    });
    expect(callbacks.onSelectionChange).toHaveBeenLastCalledWith({
      start: 2,
      end: 2 + AUDIO_TRIM_MIN_SEGMENT_SECONDS,
    });
  });

  it('未按下时 move 不触发回调（hover 不拖）', () => {
    renderOverlay();
    stubRect();
    act(() => {
      pointer(overlayEl(), 'pointermove', 200);
    });
    expect(callbacks.onSelectionChange).not.toHaveBeenCalled();
    expect(callbacks.onSeek).not.toHaveBeenCalled();
  });
});

describe('两侧暗区：点击无任何行为', () => {
  it('暗区 pointerdown 不触发选区/seek/抓手任何回调，且不冒泡出层', () => {
    renderOverlay({ selection: { start: 3, end: 12 }, duration: 15 });
    stubRect();
    const outerClick = vi.fn();
    document.body.addEventListener('click', outerClick);
    try {
      const dims = Array.from(overlayEl().querySelectorAll('div')).filter((el) =>
        el.className.includes('dim'),
      );
      expect(dims).toHaveLength(2);
      act(() => {
        for (const dim of dims) {
          pointer(dim, 'pointerdown', 110);
          pointer(dim, 'pointerup', 110);
          dim.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
      });
      expect(callbacks.onSelectionChange).not.toHaveBeenCalled();
      expect(callbacks.onSeekStart).not.toHaveBeenCalled();
      expect(callbacks.onSeek).not.toHaveBeenCalled();
      expect(callbacks.onSeekEnd).not.toHaveBeenCalled();
      expect(outerClick).not.toHaveBeenCalled();
    } finally {
      document.body.removeEventListener('click', outerClick);
    }
  });
});

describe('定位条（选区内）：点按定位与按住拖拽', () => {
  it('三段序列：按下 onSeekStart + 定位（钳选区内）、move 连续 seek、松手 onSeekEnd', () => {
    renderOverlay({ selection: { start: 2, end: 13 }, duration: 15 });
    stubRect();
    const selection = container!.querySelector('[data-testid="audio-trim-selection"]')!;
    stubCapture(selection);
    act(() => {
      pointer(selection, 'pointerdown', 200);
      pointer(overlayEl(), 'pointermove', 260);
      pointer(overlayEl(), 'pointerup', 260);
    });
    expect(callbacks.onSeekStart).toHaveBeenCalledTimes(1);
    expect(callbacks.onSeek).toHaveBeenLastCalledWith(8);
    expect(callbacks.onSeekEnd).toHaveBeenCalledTimes(1);
    expect(callbacks.onSeekEnd).toHaveBeenCalledWith(8);
  });

  it('定位钳制选区内：点选区外缘不越界（按下即按 clamp 换算）', () => {
    renderOverlay({ selection: { start: 2, end: 13 }, duration: 15 });
    stubRect();
    const selection = container!.querySelector('[data-testid="audio-trim-selection"]')!;
    stubCapture(selection);
    act(() => {
      pointer(selection, 'pointerdown', 135);
      pointer(overlayEl(), 'pointerup', 135);
    });
    expect(callbacks.onSeek).toHaveBeenCalledWith(2);
    expect(callbacks.onSeekEnd).toHaveBeenCalledWith(2);
  });
});

describe('层内 click 截停（先例回归）', () => {
  it('遮罩上 pointer 序列后的 click 不冒泡出层（防触发节点 onNodeClick 退出编辑态）', () => {
    renderOverlay({ selection: { start: 2, end: 13 }, duration: 15 });
    stubRect();
    const outerClick = vi.fn();
    document.body.addEventListener('click', outerClick);
    try {
      const selection = container!.querySelector('[data-testid="audio-trim-selection"]')!;
      stubCapture(selection);
      act(() => {
        pointer(selection, 'pointerdown', 200);
        pointer(selection, 'pointerup', 200);
        overlayEl().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(outerClick).not.toHaveBeenCalled();
    } finally {
      document.body.removeEventListener('click', outerClick);
    }
  });
});
