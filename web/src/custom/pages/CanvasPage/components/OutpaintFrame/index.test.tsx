// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OutpaintFrame from './index';
import type { ExpandSides } from '../../tools/image/imageOutpaint';

const RECT = { x: 1000, y: 500, width: 400, height: 300 };

let root: Root;
let container: HTMLDivElement;
let onChange: ReturnType<typeof vi.fn>;
let current: ExpandSides;

function Host({ initial }: { initial: ExpandSides }) {
  const [expands, setExpands] = useState(initial);
  current = expands;
  return createElement(OutpaintFrame, {
    rect: { ...RECT },
    expands,
    onExpandChange: (next: ExpandSides) => {
      current = next;
      onChange(next);
      setExpands(next);
    },
  });
}

async function renderFrame(expands: ExpandSides = { top: 0, right: 0, bottom: 0, left: 0 }) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        ReactFlowProvider,
        null,
        createElement(Host, { initial: expands }),
      ),
    );
  });
}

function pointerEvent(type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number, shiftKey = false) {
  const event = new MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX: x, clientY: y, shiftKey,
  });
  Object.defineProperty(event, 'isPrimary', { value: true });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}

async function down(target: Element, x: number, y: number) {
  await act(async () => { target.dispatchEvent(pointerEvent('pointerdown', x, y)); });
}
async function move(x: number, y: number, shiftKey = false) {
  await act(async () => { window.dispatchEvent(pointerEvent('pointermove', x, y, shiftKey)); });
}
async function up(x: number, y: number) {
  await act(async () => { window.dispatchEvent(pointerEvent('pointerup', x, y)); });
}

const handle = (id: string) => container.querySelector(`[data-testid="outpaint-handle-${id}"]`)!;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 900, width: 1200, height: 900,
    toJSON: () => ({}),
  });
  onChange = vi.fn();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

describe('IKGOQX 扩展框渲染', () => {
  it('零扩展：框与原图内容区重合，4 边 + 4 角手柄齐备', async () => {
    await renderFrame();
    for (const h of ['top', 'bottom', 'left', 'right', 'nw', 'ne', 'sw', 'se']) {
      expect(handle(h), `handle ${h}`).toBeTruthy();
    }
    const box = container.querySelector('[data-testid="outpaint-frame-box"]') as HTMLElement;
    expect(box.style.left).toBe('1000px');
    expect(box.style.top).toBe('500px');
    expect(box.style.width).toBe('400px');
    expect(box.style.height).toBe('300px');
  });

  it('有扩展：框外扩到 (left, top, right, bottom)，包住内容区', async () => {
    await renderFrame({ top: 40, right: 80, bottom: 60, left: 20 });
    const box = container.querySelector('[data-testid="outpaint-frame-box"]') as HTMLElement;
    expect(box.style.left).toBe('980px');
    expect(box.style.top).toBe('460px');
    expect(box.style.width).toBe('500px');
    expect(box.style.height).toBe('400px');
  });

  it('边命中带贯穿整条边（不再只是中点 40px 小把柄，验收报障回归锁）', async () => {
    await renderFrame();
    const top = handle('top') as HTMLElement;
    const left = handle('left') as HTMLElement;
    expect(top.style.left).toBe('1000px');
    expect(top.style.top).toBe('500px');
    expect(top.style.width).toBe('400px');
    expect(left.style.left).toBe('1000px');
    expect(left.style.top).toBe('500px');
    expect(left.style.height).toBe('300px');
    expect((top.firstElementChild as HTMLElement).className).toContain('edgeVisual');
  });

  it('扩图会话期间拦截原生 dragstart（防落空到图片时的半透明拖影重影）', async () => {
    await renderFrame();
    const event = new Event('dragstart', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('IKJR9J 拖拽隐藏：dragHidden 时根层 visibility 隐藏（不卸载），取消即恢复', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const renderWith = (dragHidden: boolean) =>
      createElement(
        ReactFlowProvider,
        null,
        createElement(OutpaintFrame, {
          rect: { ...RECT },
          expands: { top: 0, right: 0, bottom: 0, left: 0 },
          onExpandChange: () => {},
          dragHidden,
        }),
      );
    await act(async () => { root.render(renderWith(true)); });
    const layer = container.querySelector('[data-testid="outpaint-frame"]') as HTMLElement;
    expect(layer.style.visibility).toBe('hidden');
    expect(container.querySelector('[data-testid="outpaint-handle-nw"]')).toBeTruthy();
    await act(async () => { root.render(renderWith(false)); });
    expect(layer.style.visibility).toBe('');
  });
});

describe('IKGOQX 扩展框拖拽换算接线', () => {
  it('拖 top 边向上 50：仅 top=50，其余方向不动', async () => {
    await renderFrame();
    await down(handle('top'), 1200, 500);
    await move(1200, 450);
    await up(1200, 450);
    expect(onChange).toHaveBeenLastCalledWith({ top: 50, right: 0, bottom: 0, left: 0 });
  });

  it('拖边越过 40% 上限被钳制（拖不动）', async () => {
    await renderFrame();
    await down(handle('right'), 1400, 650);
    await move(2000, 650);
    await up(2000, 650);
    expect(onChange).toHaveBeenLastCalledWith({ top: 0, right: 120, bottom: 0, left: 0 });
  });

  it('拖 se 角自由改比例：两边独立', async () => {
    await renderFrame();
    await down(handle('se'), 1400, 800);
    await move(1460, 840);
    await up(1460, 840);
    expect(onChange).toHaveBeenLastCalledWith({ top: 0, right: 60, bottom: 40, left: 0 });
  });

  it('Shift 拖角锁比例：从 4:3 起拖等比外扩', async () => {
    await renderFrame();
    await down(handle('se'), 1400, 800);
    await move(1500, 920, true);
    await up(1500, 920);
    const next = onChange.mock.lastCall?.[0] as ExpandSides;
    expect((400 + next.right) / (300 + next.bottom)).toBeCloseTo(4 / 3, 6);
  });

  it('pointerup 后停止响应 pointermove（拖拽会话结束）', async () => {
    await renderFrame();
    await down(handle('top'), 1200, 500);
    await move(1200, 450);
    await up(1200, 450);
    const calls = onChange.mock.calls.length;
    await move(1200, 400);
    expect(onChange.mock.calls.length).toBe(calls);
  });

  it('多帧连续拖动：每帧 pointermove 都生效（重渲染不拆进行中的监听）', async () => {
    await renderFrame();
    await down(handle('top'), 1200, 500);
    await move(1200, 450);
    expect(current).toEqual({ top: 50, right: 0, bottom: 0, left: 0 });
    await move(1200, 420);
    expect(current).toEqual({ top: 80, right: 0, bottom: 0, left: 0 });
    await up(1200, 420);
  });

  it('拖拽只许外扩：向下拖 top 边（越进原图）钳到 0', async () => {
    await renderFrame({ top: 30, right: 0, bottom: 0, left: 0 });
    await down(handle('top'), 1200, 470);
    await move(1200, 550);
    await up(1200, 550);
    expect(onChange).toHaveBeenLastCalledWith({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});
