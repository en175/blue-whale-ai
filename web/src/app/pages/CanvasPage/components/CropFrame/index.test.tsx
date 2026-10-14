// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlowProvider, useStoreApi, type Node } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CropFrame from './index';
import GroupOverlay from '../GroupOverlay';
import {
  fullCropRect,
  inscribeCropRect,
  type CropPresetKey,
  type CropRect,
} from '../../imageCrop';

const BOUNDS = { x: 1000, y: 500, width: 400, height: 300 };
const MIN_SIDE = 32;

let root: Root;
let container: HTMLDivElement;
let onChange: ReturnType<typeof vi.fn>;
let onDarkClick: ReturnType<typeof vi.fn>;
let current: CropRect;

function Host({ initial, preset = 'free' as CropPresetKey, minSide = MIN_SIDE }: { initial: CropRect; preset?: CropPresetKey; minSide?: number }) {
  const [rect, setRect] = useState(initial);
  current = rect;
  return createElement(CropFrame, {
    bounds: { ...BOUNDS },
    rect,
    preset,
    minSide,
    onRectChange: (next: CropRect) => {
      current = next;
      onChange(next);
      setRect(next);
    },
    onDarkAreaClick: () => onDarkClick(),
  });
}

async function renderFrame(initial: CropRect = fullCropRect(BOUNDS), preset: CropPresetKey = 'free', minSide = MIN_SIDE) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        ReactFlowProvider,
        null,
        createElement(Host, { initial, preset, minSide }),
      ),
    );
  });
}

function pointerEvent(type: 'pointerdown' | 'pointermove' | 'pointerup' | 'click', x: number, y: number, shiftKey = false) {
  const event = new MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' || type === 'click' ? 0 : 1,
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
async function click(target: Element, x: number, y: number) {
  await act(async () => { target.dispatchEvent(pointerEvent('click', x, y)); });
}

const handle = (id: string) => container.querySelector(`[data-testid="crop-handle-${id}"]`)!;
const dark = (id: string) => container.querySelector(`[data-testid="crop-dark-${id}"]`)!;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 900, width: 1200, height: 900,
    toJSON: () => ({}),
  });
  onChange = vi.fn();
  onDarkClick = vi.fn();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

describe('IKGW1N 裁切框渲染', () => {
  it('默认全幅：框与内容区重合，4 暗、4 边 + 4 角手柄与框内平移区齐备', async () => {
    await renderFrame();
    for (const h of ['top', 'bottom', 'left', 'right', 'nw', 'ne', 'sw', 'se']) {
      expect(handle(h), `handle ${h}`).toBeTruthy();
    }
    for (const b of ['top', 'bottom', 'left', 'right']) {
      expect(dark(b), `dark band ${b}`).toBeTruthy();
    }
    expect(container.querySelector('[data-testid="crop-move-zone"]')).toBeTruthy();
    const box = container.querySelector('[data-testid="crop-frame-box"]') as HTMLElement;
    expect(box.style.left).toBe('1000px');
    expect(box.style.top).toBe('500px');
    expect(box.style.width).toBe('400px');
    expect(box.style.height).toBe('300px');
  });

  it('IKJR9J 拖拽隐藏：dragHidden 时根层 visibility 隐藏（不卸载），取消即恢复', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const renderWith = (dragHidden: boolean) =>
      createElement(
        ReactFlowProvider,
        null,
        createElement(CropFrame, {
          bounds: { ...BOUNDS },
          rect: fullCropRect(BOUNDS),
          preset: 'free',
          minSide: MIN_SIDE,
          onRectChange: () => {},
          onDarkAreaClick: () => {},
          dragHidden,
        }),
      );
    await act(async () => { root.render(renderWith(true)); });
    const layer = container.querySelector('[data-testid="crop-frame"]') as HTMLElement;
    expect(layer.style.visibility).toBe('hidden');
    expect(container.querySelector('[data-testid="crop-handle-nw"]')).toBeTruthy();
    await act(async () => { root.render(renderWith(false)); });
    expect(layer.style.visibility).toBe('');
  });

  it('收窄后框与手柄跟随新矩形（渲染期 flow→屏幕换算）', async () => {
    await renderFrame({ x: 1100, y: 560, width: 200, height: 150 });
    const box = container.querySelector('[data-testid="crop-frame-box"]') as HTMLElement;
    expect(box.style.left).toBe('1100px');
    expect(box.style.top).toBe('560px');
    expect(box.style.width).toBe('200px');
    expect(box.style.height).toBe('150px');
    const se = handle('se') as HTMLElement;
    expect(se.style.left).toBe('1300px');
    expect(se.style.top).toBe('710px');
  });

  it('裁切会话期间拦截原生 dragstart（防落空到图片时的半透明拖影，OutpaintFrame 同款）', async () => {
    await renderFrame();
    const event = new Event('dragstart', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('viewport 缩放平移后框与手柄按 flow→屏幕换算跟随（编辑期间画布照常，规格故事 16）', async () => {
    let applyVp: (() => void) | undefined;
    function ViewportHost() {
      const [, bump] = useState(0);
      const store = useStoreApi();
      applyVp = () => {
        store.setState({ transform: [60, 30, 2], domNode: container });
        bump((n) => n + 1);
      };
      return createElement(CropFrame, {
        bounds: { ...BOUNDS },
        rect: { x: 1000, y: 500, width: 400, height: 300 },
        preset: 'free',
        minSide: MIN_SIDE,
        onRectChange: () => {},
        onDarkAreaClick: () => {},
      });
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(ReactFlowProvider, null, createElement(ViewportHost)));
    });
    await act(async () => { applyVp!(); });
    const box = container.querySelector('[data-testid="crop-frame-box"]') as HTMLElement;
    expect(box.style.left).toBe('2060px');
    expect(box.style.top).toBe('1030px');
    expect(box.style.width).toBe('800px');
    expect(box.style.height).toBe('600px');
    const se = handle('se') as HTMLElement;
    expect(se.style.left).toBe('2860px');
    expect(se.style.top).toBe('1630px');
  });
});

describe('IKGW1N 自由模式拖拽换算接线', () => {
  it.each(['top', 'bottom', 'left', 'right'] as const)('拖 %s 边向内收 50：仅该边移动', async (side) => {
    await renderFrame();
    const start = { top: [1200, 500], bottom: [1200, 800], left: [1000, 650], right: [1400, 650] }[side];
    const end = {
      top: [1200, 550], bottom: [1200, 750], left: [1050, 650], right: [1350, 650],
    }[side];
    await down(handle(side), start[0], start[1]);
    await move(end[0], end[1]);
    await up(end[0], end[1]);
    const expectedBySide: Record<'top' | 'right' | 'bottom' | 'left', CropRect> = {
      top: { x: 1000, y: 550, width: 400, height: 250 },
      bottom: { x: 1000, y: 500, width: 400, height: 250 },
      left: { x: 1050, y: 500, width: 350, height: 300 },
      right: { x: 1000, y: 500, width: 350, height: 300 },
    };
    expect(onChange).toHaveBeenLastCalledWith(expectedBySide[side]);
  });

  it.each(['nw', 'ne', 'sw', 'se'] as const)('拖 %s 角向内自由收：两条邻边独立跟随', async (corner) => {
    await renderFrame({ x: 1100, y: 560, width: 200, height: 150 });
    const cx = corner === 'nw' || corner === 'sw' ? 1100 : 1300;
    const cy = corner === 'nw' || corner === 'ne' ? 560 : 710;
    await down(handle(corner), cx, cy);
    const px = corner === 'nw' || corner === 'sw' ? cx + 40 : cx - 40;
    const py = corner === 'nw' || corner === 'ne' ? cy + 30 : cy - 30;
    await move(px, py);
    await up(px, py);
    const w = 200 - 40;
    const h = 150 - 30;
    const x = corner === 'nw' || corner === 'sw' ? 1100 + 40 : 1100;
    const y = corner === 'nw' || corner === 'ne' ? 560 + 30 : 560;
    expect(onChange).toHaveBeenLastCalledWith({ x, y, width: w, height: h });
  });

  it('Shift 拖角临时锁比例：锁定拖动开始那一刻的框比例（对角锚等比）', async () => {
    await renderFrame({ x: 1100, y: 560, width: 200, height: 150 });
    await down(handle('se'), 1300, 710);
    await move(1180, 635, true);
    await up(1180, 635);
    const next = onChange.mock.lastCall?.[0] as CropRect;
    expect(next.width / next.height).toBeCloseTo(200 / 150, 6);
  });

  it('拖边收到 64 自然像素下限（显示系 minSide）后钳制不再收窄', async () => {
    await renderFrame(fullCropRect(BOUNDS), 'free', 64);
    await down(handle('left'), 1000, 650);
    await move(1360, 650);
    await up(1360, 650);
    expect(onChange).toHaveBeenLastCalledWith({ x: 1336, y: 500, width: 64, height: 300 });
  });

  it('框内按住拖动整体平移，越界钳制在内容区内', async () => {
    await renderFrame({ x: 1100, y: 560, width: 200, height: 150 });
    const zone = container.querySelector('[data-testid="crop-move-zone"]')!;
    await down(zone, 1200, 630);
    await move(1230, 650);
    expect(onChange).toHaveBeenLastCalledWith({ x: 1130, y: 580, width: 200, height: 150 });
    await move(5000, 5000);
    await up(5000, 5000);
    expect(onChange).toHaveBeenLastCalledWith({ x: 1200, y: 650, width: 200, height: 150 });
  });

  it('pointerup 后停止响应 pointermove（拖拽会话结束）', async () => {
    await renderFrame();
    await down(handle('top'), 1200, 500);
    await move(1200, 550);
    await up(1200, 550);
    const calls = onChange.mock.calls.length;
    await move(1200, 600);
    expect(onChange.mock.calls.length).toBe(calls);
  });

  it('多帧连续拖动：每帧 pointermove 都生效（重渲染不拆进行中的监听）', async () => {
    await renderFrame();
    await down(handle('bottom'), 1200, 800);
    await move(1200, 750);
    expect(current).toEqual({ x: 1000, y: 500, width: 400, height: 250 });
    await move(1200, 700);
    expect(current).toEqual({ x: 1000, y: 500, width: 400, height: 200 });
    await up(1200, 700);
  });
});

describe('IKGW1N 锁定比例模式（面板选了预设）', () => {
  it('边手柄禁用：视觉弱化且 pointer 拖后框不变', async () => {
    await renderFrame(inscribeCropRect(BOUNDS, 1), '1:1');
    const top = handle('top') as HTMLElement;
    expect(top.className).toContain('Disabled');
    await down(top, 1200, 500);
    await move(1200, 550);
    await up(1200, 550);
    expect(onChange).not.toHaveBeenCalled();
    expect(current).toEqual(inscribeCropRect(BOUNDS, 1));
  });

  it('角手柄以对角为锚等比缩放（预设比例恒定）', async () => {
    await renderFrame(inscribeCropRect(BOUNDS, 1), '1:1');
    await down(handle('se'), 1350, 800);
    await move(1150, 560);
    await up(1150, 560);
    const next = onChange.mock.lastCall?.[0] as CropRect;
    expect(next.width / next.height).toBeCloseTo(1, 6);
    expect(next).toEqual({ x: 1050, y: 500, width: 60, height: 60 });
  });
});

describe('IKGW1N 框外暗区', () => {
  it('点暗区触发退出回调（onClick → exitCropMode）', async () => {
    await renderFrame();
    await click(dark('top'), 600, 200);
    expect(onDarkClick).toHaveBeenCalledTimes(1);
    await click(dark('left'), 100, 650);
    expect(onDarkClick).toHaveBeenCalledTimes(2);
  });
});

describe('IKH1WJ 组合渲染：GroupOverlay 捕获层不截断裁切框按下', () => {
  it('源图卡盒边界内侧按住左边手柄：拖拽立即启动并跟随收缩', async () => {
    const overlayNode = {
      id: 'm1',
      type: 'mediaNode',
      position: { x: 1000, y: 500 },
      measured: { width: 400, height: 300 },
      data: {},
    } as Node;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(
        ReactFlowProvider,
        null,
        createElement(GroupOverlay, {
          nodes: [overlayNode],
          groups: [],
          onCreateGroup: () => {},
          onUngroup: () => {},
          onDeleteGroup: () => {},
          onDownloadNodes: () => {},
          setNodes: () => {},
        }),
        createElement(Host, { initial: fullCropRect(BOUNDS) }),
      ));
    });
    await down(handle('left'), 1000, 650);
    await move(1050, 650);
    await up(1050, 650);
    expect(onChange).toHaveBeenLastCalledWith({ x: 1050, y: 500, width: 350, height: 300 });
  });
});
