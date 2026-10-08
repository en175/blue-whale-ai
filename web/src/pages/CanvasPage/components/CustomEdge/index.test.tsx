// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Position } from '@xyflow/react';
import CustomEdge from './index';
import styles from './index.module.css';

const storeState = vi.hoisted(() => ({
  nodeLookup: new Map<string, { id: string; selected?: boolean; data?: Record<string, unknown> }>([
    ['n-src', { id: 'n-src', selected: false }],
    ['n-dst', { id: 'n-dst', selected: false }],
    ['n-other', { id: 'n-other', selected: false }],
    ['n-src-b', { id: 'n-src-b', selected: false }],
    ['n-dst-b', { id: 'n-dst-b', selected: false }],
  ]),
  transform: [0, 0, 1],
}));

const reactFlow = vi.hoisted(() => {
  const state = {
    flowDx: 1000,
    flowDy: 2000,
    zoom: 1,
  };
  return {
    state,
    deleteElements: vi.fn(),
    getZoom: () => state.zoom,
    screenToFlowPosition: vi.fn((p: { x: number; y: number }) => ({
      x: p.x / state.zoom + state.flowDx,
      y: p.y / state.zoom + state.flowDy,
    })),
  };
});

vi.mock('@xyflow/react', async (importOriginal) => {
  const original = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...original,
    useReactFlow: () => reactFlow,
    useStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
  };
});

const DWELL_MS = 1000;
const SCISSORS_GAP = 30;

let root: Root;
let container: HTMLDivElement;

function setSelected(nodeId: string, selected: boolean) {
  storeState.nodeLookup.get(nodeId)!.selected = selected;
}

function setNodeData(nodeId: string, data: Record<string, unknown> | undefined) {
  storeState.nodeLookup.get(nodeId)!.data = data;
}

const edgeProps = {
  id: 'e1',
  source: 'n-src',
  target: 'n-dst',
  sourceX: 0,
  sourceY: 0,
  targetX: 100,
  targetY: 100,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
};

const edgePropsB = {
  ...edgeProps,
  id: 'e2',
  source: 'n-src-b',
  target: 'n-dst-b',
  sourceY: 200,
  targetY: 300,
};

const SLOT_A = 'edge-slot-a';
const SLOT_B = 'edge-slot-b';

async function renderEdge(props: typeof edgeProps = edgeProps) {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(CustomEdge, props));
  });
}

async function renderTwoEdges() {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        'div',
        null,
        createElement('div', { className: SLOT_A }, createElement(CustomEdge, edgeProps)),
        createElement('div', { className: SLOT_B }, createElement(CustomEdge, edgePropsB)),
      ),
    );
  });
}

function edgeSlot(key: 'a' | 'b'): ParentNode {
  return container.querySelector(`.${key === 'a' ? SLOT_A : SLOT_B}`)!;
}

async function rerenderEdge() {
  await act(async () => {
    root.render(createElement(CustomEdge, edgeProps));
  });
}

function edgeGroupClass(scope: ParentNode = container): string {
  const group = scope.querySelector('g');
  return group?.getAttribute('class') ?? '';
}

function scissorsShown(scope: ParentNode = container): boolean {
  const btn = scope.querySelector(`.${styles.deleteBtn}`);
  return (btn?.getAttribute('class') ?? '').split(/\s+/).includes(styles.deleteBtnVisible);
}

function scissorsTransform(scope: ParentNode = container): string | null {
  return scope.querySelector(`.${styles.deleteBtn}`)?.getAttribute('transform') ?? null;
}

function scissorsOrigin(scope: ParentNode = container): { x: number; y: number } {
  const matched = scissorsTransform(scope)?.match(/translate\((-?[\d.]+),\s*(-?[\d.]+)\)/);
  if (!matched) throw new Error(`剪刀按钮上没有可解析的 transform：${scissorsTransform(scope)}`);
  return { x: Number(matched[1]), y: Number(matched[2]) };
}

function scissorsCenter(scope: ParentNode = container): { x: number; y: number } {
  const circle = scope.querySelector(`.${styles.deleteBtn} circle`)!;
  const origin = scissorsOrigin(scope);
  return {
    x: origin.x + Number(circle.getAttribute('cx')),
    y: origin.y + Number(circle.getAttribute('cy')),
  };
}

function scissorsRadius(scope: ParentNode = container): number {
  return Number(scope.querySelector(`.${styles.deleteBtn} circle`)!.getAttribute('r'));
}

function scissorsIconSize(scope: ParentNode = container): number {
  return Number(scope.querySelector(`.${styles.deleteBtn} foreignObject`)!.getAttribute('width'));
}

function scissorsScale(scope: ParentNode = container): number {
  const matched = /scale\(([\d.]+)\)/.exec(scissorsTransform(scope) ?? '');
  if (!matched) throw new Error(`剪刀按钮上没有可解析的 scale：${scissorsTransform(scope)}`);
  return Number(matched[1]);
}

function scissorsScreenRadius(zoom: number, scope: ParentNode = container): number {
  return scissorsRadius(scope) * scissorsScale(scope) * zoom;
}

function scissorsScreenIconSize(zoom: number, scope: ParentNode = container): number {
  return scissorsIconSize(scope) * scissorsScale(scope) * zoom;
}

function distanceToDrawnEdge(point: { x: number; y: number }, scope: ParentNode = container): number {
  const numbers = (scope.querySelector(`.${styles.basePath}`)!.getAttribute('d') ?? '').match(/-?[\d.]+/g)?.map(Number);
  if (!numbers || numbers.length !== 8) throw new Error(`连线路径不是三次贝塞尔：${numbers}`);
  const [x0, y0, c1x, c1y, c2x, c2y, x1, y1] = numbers;
  const onCurve = (t: number) => {
    const rest = 1 - t;
    const a = rest ** 3;
    const b = 3 * rest * rest * t;
    const c = 3 * rest * t * t;
    const d = t ** 3;
    return { x: a * x0 + b * c1x + c * c2x + d * x1, y: a * y0 + b * c1y + c * c2y + d * y1 };
  };

  const segments = 200;
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < segments; index += 1) {
    const from = onCurve(index / segments);
    const to = onCurve((index + 1) / segments);
    const span = (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
    const raw = span === 0 ? 0 : ((point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y)) / span;
    const ratio = Math.min(1, Math.max(0, raw));
    const foot = { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
    nearest = Math.min(nearest, Math.hypot(point.x - foot.x, point.y - foot.y));
  }
  return nearest;
}

async function movePointer(clientX: number, clientY: number, scope: ParentNode = container) {
  await act(async () => {
    scope
      .querySelector(`.${styles.hitPath}`)!
      .dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY }));
  });
}

async function movePointerAtFlow(x: number, y: number, scope: ParentNode = container) {
  const { flowDx, flowDy, zoom } = reactFlow.state;
  await movePointer((x - flowDx) * zoom, (y - flowDy) * zoom, scope);
}

async function enterEdge(clientX: number, clientY: number, scope: ParentNode = container) {
  await act(async () => {
    scope
      .querySelector(`.${styles.hitPath}`)!
      .dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body, clientX, clientY }),
      );
  });
}

async function leaveEdge(relatedTarget: Element = document.body, scope: ParentNode = container) {
  await act(async () => {
    scope
      .querySelector(`.${styles.hitPath}`)!
      .dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget }));
  });
}

async function movePointerOntoScissors(scope: ParentNode = container) {
  const btn = scope.querySelector(`.${styles.deleteBtn}`)!;
  await act(async () => {
    scope
      .querySelector(`.${styles.hitPath}`)!
      .dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: btn }));
  });
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  });
}

async function movePointerOffScissors(scope: ParentNode = container) {
  await act(async () => {
    scope
      .querySelector(`.${styles.deleteBtn}`)!
      .dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
  });
}

async function clickScissors(scope: ParentNode = container) {
  await act(async () => {
    scope
      .querySelector(`.${styles.deleteBtn}`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  setSelected('n-src', false);
  setSelected('n-dst', false);
  setSelected('n-other', false);
});

describe('IKGGC0 选中节点相连线流动动效', () => {
  it('两端节点均未选中：连线无选中相连类', async () => {
    await renderEdge();
    expect(edgeGroupClass()).not.toContain(styles.selectedConnected);
  });

  it('第三方节点选中但与本线不相连：非相连线保持静态', async () => {
    setSelected('n-other', true);
    await renderEdge();
    expect(edgeGroupClass()).not.toContain(styles.selectedConnected);
  });

  it('source 端节点选中：相连线获得选中相连类', async () => {
    setSelected('n-src', true);
    await renderEdge();
    expect(edgeGroupClass()).toContain(styles.selectedConnected);
  });

  it('target 端节点选中：相连线同样获得选中相连类（双向生效）', async () => {
    setSelected('n-dst', true);
    await renderEdge();
    expect(edgeGroupClass()).toContain(styles.selectedConnected);
  });

  it('两端节点都选中：只呈现一份动效类，不叠加', async () => {
    setSelected('n-src', true);
    setSelected('n-dst', true);
    await renderEdge();
    expect(edgeGroupClass()).toContain(styles.selectedConnected);
    expect(edgeGroupClass().split(/\s+/).filter(c => c === styles.selectedConnected)).toHaveLength(1);
  });

  it('取消选中后：选中相连类移除，恢复静态实线入口', async () => {
    setSelected('n-src', true);
    await renderEdge();
    expect(edgeGroupClass()).toContain(styles.selectedConnected);

    setSelected('n-src', false);
    await rerenderEdge();
    expect(edgeGroupClass()).not.toContain(styles.selectedConnected);
  });

  it('切换选中到另一端节点：类保持（多选场景任一端命中即流动）', async () => {
    setSelected('n-src', true);
    await renderEdge();
    setSelected('n-src', false);
    setSelected('n-dst', true);
    await rerenderEdge();
    expect(edgeGroupClass()).toContain(styles.selectedConnected);
  });
});

describe('IKGUVG 剪刀停稳 1 秒才出现', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reactFlow.deleteElements.mockClear();
    reactFlow.screenToFlowPosition.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    setNodeData('n-src', undefined);
    setNodeData('n-dst', undefined);
  });

  it('出现时机：指针进入连线未满 1 秒，剪刀不出现', async () => {
    await renderEdge();

    await movePointer(120, 80);
    expect(scissorsShown()).toBe(false);

    await advance(DWELL_MS - 1);
    expect(scissorsShown()).toBe(false);
  });

  it('出现时机：指针停稳满 1 秒，剪刀出现', async () => {
    await renderEdge();

    await movePointer(120, 80);
    await advance(DWELL_MS);

    expect(scissorsShown()).toBe(true);
  });

  it('出现时机：指针进入连线即启动计时，不派发任何移动也停稳满 1 秒出现剪刀', async () => {
    await renderEdge();

    await enterEdge(120, 80);
    expect(scissorsShown()).toBe(false);

    await advance(DWELL_MS - 1);
    expect(scissorsShown()).toBe(false);

    await advance(1);
    expect(scissorsShown()).toBe(true);
    expect(distanceToDrawnEdge(scissorsCenter())).toBeLessThan(0.05);
  });

  it('移动重置：计时期间指针移动一次，原计时作废并从最后一次移动起重新计满 1 秒', async () => {
    await renderEdge();

    await movePointer(10, 10);
    await advance(DWELL_MS - 100);
    await movePointer(60, 60);

    await advance(DWELL_MS - 1);
    expect(scissorsShown()).toBe(false);

    await advance(1);
    expect(scissorsShown()).toBe(true);
  });

  it('移出隐藏：剪刀出现后指针离开连线，立即隐藏', async () => {
    await renderEdge();

    await movePointer(10, 10);
    await advance(DWELL_MS);
    expect(scissorsShown()).toBe(true);

    await leaveEdge();
    expect(scissorsShown()).toBe(false);
  });

  it('移出隐藏：计时途中指针离开连线，残余计时不得让剪刀迟到出现', async () => {
    await renderEdge();

    await movePointer(20, 20);
    await advance(DWELL_MS - 200);
    await leaveEdge();
    await advance(DWELL_MS * 2);

    expect(scissorsShown()).toBe(false);
  });

  it('移出隐藏后返回：指针回到连线，重新停稳满 1 秒才再次出现', async () => {
    await renderEdge();

    await movePointer(10, 10);
    await advance(DWELL_MS);
    await leaveEdge();
    expect(scissorsShown()).toBe(false);

    await movePointer(30, 30);
    await advance(DWELL_MS - 1);
    expect(scissorsShown()).toBe(false);

    await advance(1);
    expect(scissorsShown()).toBe(true);
  });

  it('目标节点生成中不出现：目标节点 genStatus 为 generating，停满 1 秒也不出现剪刀', async () => {
    setNodeData('n-dst', { genStatus: 'generating' });
    await renderEdge();

    await movePointer(10, 10);
    await advance(DWELL_MS * 3);
    expect(scissorsShown()).toBe(false);
  });

  it('目标节点生成中不出现：目标节点处于页面提交窗口（submitting 标记），停满 1 秒也不出现剪刀', async () => {
    setNodeData('n-dst', { genStatus: 'draft', submitting: true });
    await renderEdge();

    await movePointer(10, 10);
    await advance(DWELL_MS * 3);
    expect(scissorsShown()).toBe(false);
  });

  it('目标节点生成中不出现：只认目标端，源节点生成中的相连线仍可停稳出现剪刀', async () => {
    setNodeData('n-src', { genStatus: 'generating' });
    await renderEdge();

    await movePointer(10, 10);
    await advance(DWELL_MS);
    expect(scissorsShown()).toBe(true);
  });

  it('目标节点事后转入生成中：已出现的剪刀立即收回，不必等用户点下去才被守卫拒绝', async () => {
    await renderEdge();

    await movePointer(120, 80);
    await advance(DWELL_MS);
    expect(scissorsShown()).toBe(true);

    setNodeData('n-dst', { genStatus: 'generating' });
    await rerenderEdge();

    expect(scissorsShown()).toBe(false);

    await advance(DWELL_MS * 3);
    expect(scissorsShown()).toBe(false);
  });

  it('目标节点事后转入生成中：停稳计时途中转入时，在途计时不得让剪刀迟到出现', async () => {
    await renderEdge();

    await movePointer(120, 80);
    await advance(DWELL_MS - 100);
    expect(scissorsShown()).toBe(false);

    setNodeData('n-dst', { submitting: true });
    await rerenderEdge();
    await advance(DWELL_MS * 3);

    expect(scissorsShown()).toBe(false);
  });

  it('删除链路：剪刀出现后单击一次即断开连线', async () => {
    await renderEdge();

    await movePointer(10, 10);
    await advance(DWELL_MS);
    await clickScissors();

    expect(reactFlow.deleteElements).toHaveBeenCalledTimes(1);
    expect(reactFlow.deleteElements).toHaveBeenCalledWith({ edges: [{ id: 'e1' }] });
  });
});

describe('IKGUVK 剪刀压在连线上、沿连线错开并就地定格', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reactFlow.deleteElements.mockClear();
    reactFlow.screenToFlowPosition.mockClear();
    reactFlow.state.zoom = 1;
    storeState.transform = [0, 0, 1];
  });

  afterEach(() => {
    vi.useRealTimers();
    reactFlow.state.zoom = 1;
    storeState.transform = [0, 0, 1];
    setNodeData('n-src', undefined);
    setNodeData('n-dst', undefined);
  });

  it('出现位置：剪刀圆心压在连线上，指针正下方没有按钮', async () => {
    await renderEdge();

    await movePointerAtFlow(50, 50);
    await advance(DWELL_MS);
    expect(scissorsShown()).toBe(true);

    expect(reactFlow.screenToFlowPosition).toHaveBeenCalledWith({ x: -950, y: -1950 });
    const center = scissorsCenter();
    expect(distanceToDrawnEdge(center)).toBeLessThan(0.05);
    expect(Math.hypot(center.x - 50, center.y - 50)).toBeGreaterThan(scissorsRadius());
  });

  it('错开方向：朝连线剩余更长的一侧错开，指针靠近终点时朝起点一侧退', async () => {
    await renderEdge();

    await movePointerAtFlow(95, 95);
    await advance(DWELL_MS);
    expect(scissorsShown()).toBe(true);

    const center = scissorsCenter();
    expect(distanceToDrawnEdge(center)).toBeLessThan(0.05);
    expect(center.x).toBeLessThan(80);
  });

  it('错开距离：沿连线离开指针 30 屏幕像素', async () => {
    await renderEdge();

    await movePointerAtFlow(50, 50);
    await advance(DWELL_MS);

    const center = scissorsCenter();
    const gap = Math.hypot(center.x - 50, center.y - 50);
    expect(gap).toBeGreaterThan(SCISSORS_GAP - 1);
    expect(gap).toBeLessThan(SCISSORS_GAP + 0.5);
  });

  it('短连线一侧不够：朝另一侧退满错开量，圆心仍压在连线上', async () => {
    await renderEdge({ ...edgeProps, id: 'e-short', targetX: 60, targetY: 0 });
    await movePointerAtFlow(50, 0);
    await advance(DWELL_MS);
    expect(scissorsShown()).toBe(true);

    const center = scissorsCenter();
    expect(distanceToDrawnEdge(center)).toBeLessThan(0.05);
    expect(center.x).toBeLessThan(50);
    expect(Math.hypot(center.x - 50, center.y)).toBeGreaterThan(SCISSORS_GAP - 1);
  });

  it('连线比错开量还短：贴到端点，圆心不跑出连线', async () => {
    await renderEdge({ ...edgeProps, id: 'e-tiny', targetX: 20, targetY: 0 });
    await movePointerAtFlow(10, 0);
    await advance(DWELL_MS);
    expect(scissorsShown()).toBe(true);

    const center = scissorsCenter();
    expect(Math.hypot(center.x - 20, center.y)).toBeLessThan(0.05);
    expect(distanceToDrawnEdge(center)).toBeLessThan(0.05);
  });

  it('出现后定格：指针在连线上继续移动，剪刀位置保持不变', async () => {
    await renderEdge();

    await movePointer(120, 80);
    await advance(DWELL_MS);
    const locked = scissorsTransform();

    await movePointer(400, 300);
    expect(scissorsShown()).toBe(true);
    expect(scissorsTransform()).toBe(locked);

    await advance(DWELL_MS * 2);
    expect(scissorsShown()).toBe(true);
    expect(scissorsTransform()).toBe(locked);
  });

  it('指针在按钮上保持可见：指针离开连线移到剪刀上，剪刀不消失', async () => {
    await renderEdge();

    await movePointer(120, 80);
    await advance(DWELL_MS);
    await movePointerOntoScissors();

    expect(scissorsShown()).toBe(true);
  });

  it('指针从按钮移回连线：重新计时，未满 1 秒不出现', async () => {
    await renderEdge();

    await movePointer(120, 80);
    await advance(DWELL_MS);
    await movePointerOntoScissors();
    expect(scissorsShown()).toBe(true);

    await movePointer(200, 120);
    expect(scissorsShown()).toBe(false);

    await advance(DWELL_MS - 1);
    expect(scissorsShown()).toBe(false);

    await advance(1);
    expect(scissorsShown()).toBe(true);
    expect(distanceToDrawnEdge(scissorsCenter())).toBeLessThan(0.05);
  });

  it('指针既不在连线上也不在按钮上：剪刀立即隐藏', async () => {
    await renderEdge();

    await movePointer(120, 80);
    await advance(DWELL_MS);
    await movePointerOntoScissors();
    expect(scissorsShown()).toBe(true);

    await movePointerOffScissors();
    expect(scissorsShown()).toBe(false);
  });

  it('圆盘尺寸不随缩放变化：各档缩放下屏幕上的半径与图标边长都是定值', async () => {
    await renderEdge();

    for (const zoom of [0.5, 1, 2]) {
      reactFlow.state.zoom = zoom;
      storeState.transform = [0, 0, zoom];
      await rerenderEdge();

      await movePointerAtFlow(50, 50);
      await advance(DWELL_MS);
      expect(scissorsShown()).toBe(true);

      expect(scissorsScreenRadius(zoom)).toBeCloseTo(11, 5);
      expect(scissorsScreenIconSize(zoom)).toBeCloseTo(14, 5);

      await leaveEdge();
    }
  });

  it('错开距离按屏幕像素固定：画布放大一倍，画布坐标里的错开量减半', async () => {
    await renderEdge();

    await movePointerAtFlow(50, 50);
    await advance(DWELL_MS);
    const centerAtOne = scissorsCenter();
    const gapAtOne = Math.hypot(centerAtOne.x - 50, centerAtOne.y - 50);

    await leaveEdge();
    reactFlow.state.zoom = 2;
    storeState.transform = [0, 0, 2];
    await rerenderEdge();

    await movePointerAtFlow(50, 50);
    await advance(DWELL_MS);
    const centerAtTwo = scissorsCenter();
    const gapAtTwo = Math.hypot(centerAtTwo.x - 50, centerAtTwo.y - 50);

    expect(gapAtOne).toBeGreaterThan(SCISSORS_GAP - 1);
    expect(gapAtOne).toBeLessThan(SCISSORS_GAP + 0.5);
    expect(gapAtTwo * 2).toBeGreaterThan(SCISSORS_GAP - 2);
    expect(gapAtTwo * 2).toBeLessThan(SCISSORS_GAP + 0.5);
    expect(distanceToDrawnEdge(centerAtTwo)).toBeLessThan(0.05);
  });
});

describe('IKGUVM 跨线互斥：同一时刻只有一把剪刀', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reactFlow.deleteElements.mockClear();
    reactFlow.screenToFlowPosition.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    setNodeData('n-src-b', undefined);
    setNodeData('n-dst-b', undefined);
  });

  it('指针从一条连线移到另一条连线：前一条剪刀先消失，新的一条需重新停稳满 1 秒', async () => {
    await renderTwoEdges();
    const slotA = edgeSlot('a');
    const slotB = edgeSlot('b');
    const visibleScissorsCount = () => container.querySelectorAll(`.${styles.deleteBtnVisible}`).length;

    await movePointer(120, 80, slotA);
    await advance(DWELL_MS);
    expect(scissorsShown(slotA)).toBe(true);
    expect(visibleScissorsCount()).toBe(1);

    await leaveEdge(slotB.querySelector(`.${styles.hitPath}`)!, slotA);
    await movePointer(120, 280, slotB);
    expect(scissorsShown(slotA)).toBe(false);
    expect(scissorsShown(slotB)).toBe(false);
    expect(visibleScissorsCount()).toBe(0);

    await advance(DWELL_MS);
    expect(scissorsShown(slotB)).toBe(true);
    expect(scissorsShown(slotA)).toBe(false);
    expect(visibleScissorsCount()).toBe(1);
  });
});
