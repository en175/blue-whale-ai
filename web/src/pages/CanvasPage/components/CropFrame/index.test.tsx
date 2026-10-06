// @vitest-environment jsdom
/* 裁切框覆盖层组件测试（IKGW1N）：默认全幅渲染与手柄定位、自由拖 4 边/4 角换算接线、
   Shift 临时锁比例、锁比例下边手柄禁用不可拖、角手柄对角锚等比缩放、框内平移钳制、
   64 像素下限（显示系 minSide 传入）、暗区点击退出、拖拽会话结束停止响应、
   多帧连续拖动（重渲染不拆进行中的监听——拖不动 bug 回归锁，OutpaintFrame 同款）、
   viewport 缩放平移后框换算跟随（编辑期间画布照常，规格故事 16）、
   与 GroupOverlay 同挂的组合回归（IKH1WJ：捕获层不截断裁切框按下）。
   换算本身在 imageCrop.test.ts 纯函数层覆盖，此处测组件把屏幕事件正确接到
   纯函数并回抛（zoom=1、容器在原点时 flow 坐标 == client 坐标）。 */
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

/** 400×300 内容区；minSide=32 对应 64 自然像素 × (400/800) 显示换算 */
const BOUNDS = { x: 1000, y: 500, width: 400, height: 300 };
const MIN_SIDE = 32;

let root: Root;
let container: HTMLDivElement;
let onChange: ReturnType<typeof vi.fn>;
let onDarkClick: ReturnType<typeof vi.fn>;
let current: CropRect;

/** 带状态宿主：bounds/rect 每次渲染传新对象、onRectChange setState 触发真实重渲染，
 *  复现 CanvasPage 的 props 流（重渲染不得拆掉进行中的拖拽监听）。 */
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

/** jsdom 无 PointerEvent 构造器：MouseEvent 补指针属性（OutpaintFrame 测试同做法） */
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
  // 容器在视口原点：zoom=1 时 flow 坐标 == client 坐标
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
    // 隐藏不卸载：手柄与暗区仍在文档中
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
    // 经 store 注入 transform 与 domNode：无真实 ReactFlow 实例时 domNode 为 null，
    // flowToScreenPosition 直透传不换算；bump state 复现库在 viewport 变化时对 children 的重渲染
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
    // viewport → x=60, y=30, zoom=2：屏幕 = flow × zoom + 平移
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
    // 各角向内容区中心方向收 40×30
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
    // minSide=64：内容区 400×300，短边收到 64 即停
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
    // 大幅越界：贴边停靠
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
    // 第一帧生效后宿主已重渲染（bounds 新引用），第二帧必须仍然生效
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
    // se 角拖向中心：锚 nw=(1050,500)，指针 (1150,560) → 等比内切 60×60
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
  /* 本文件其余用例只渲染 CropFrame 自身、不挂 GroupOverlay——这正是 IKH1WJ
     未被测试拦截的原因：组框覆盖层在 window 捕获阶段把「落点在源图卡盒内、
     目标不在卡元素上」的按下 stopPropagation 拦死，React 委托监听收不到，
     拖拽会话从未启动。此处两组件同挂，锁死手柄按下不被截断、拖拽正常接线。 */
  it('源图卡盒边界内侧按住左边手柄：拖拽立即启动并跟随收缩', async () => {
    // 源图卡盒与内容区同盒 (1000,500)-(1400,800)：边手柄命中带整条压在卡盒边界上，
    // 按下点 (1000,650) 必在卡盒内（闭合区间含边界）——即生产被拦路径
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
