// @vitest-environment jsdom
/* IKGGC0 回归锁：选中节点（source/target 任一端）时相连线呈现流动动效，
   视觉与悬停共用同一份 CSS 定义（源断言见 edgeFlowSource.test.ts）；
   取消选中即恢复静态实线。类开关是唯一接缝，不写入连线数据。
   IKGUVG：剪刀改为指针停稳满 1 秒才出现（假计时器驱动），生成中的目标连线不出现。
   IKGUVM：每条用户可见行为各一条独立用例——出现时机 / 移动重置 / 移出隐藏 / 出现位置 /
   出现后定格 / 指针在按钮上保持可见 / 目标节点生成中不出现；断言只落在渲染结果
   （出现类、transform、圆心坐标）与删除链路的 mock 调用上，不读组件内部状态。
   另加两条守卫：圆心压在连线上的几何断言、两条连线之间的剪刀互斥。
   IKGUR7 审查修订：目标节点事后转入生成中时，已出现的剪刀立即收回、在途停稳计时一并清除；
   指针进入连线（没有任何 mousemove）同样启动停稳计时。
   IKGUR7 位置与尺寸修订：剪刀圆心压在连线上，沿连线朝剩余更长的一侧错开固定屏幕距离，
   短连线收敛到端点；圆盘与图标按 1/zoom 反向缩放，屏幕尺寸不随画布缩放变化。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Position } from '@xyflow/react';
import CustomEdge from './index';
import styles from './index.module.css';

/** 可控 store：nodeLookup 提供两端节点与第三方节点的 selected / data，模拟画布选中与生成态；
    transform[2] 是画布缩放倍率，剪刀按它做尺寸补偿 */
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

/** React Flow 替身：屏幕坐标换算故意带平移与缩放，断言位置确实走了 screenToFlowPosition */
const reactFlow = vi.hoisted(() => {
  const state = {
    /** 换算的平移偏移：故意不为 0，防止直接把屏幕坐标当流坐标用也能通过 */
    flowDx: 1000,
    flowDy: 2000,
    /** 换算的缩放倍率：模拟画布缩放，改变同一屏幕点对应的流坐标 */
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

/** 停稳门槛（与组件同值）：指针停稳满 1 秒剪刀才出现 */
const DWELL_MS = 1000;
/** 剪刀圆心沿连线离开指针的距离，屏幕像素（与组件 SCISSORS_GAP 同值，IKGUR7） */
const SCISSORS_GAP = 30;

let root: Root;
let container: HTMLDivElement;

function setSelected(nodeId: string, selected: boolean) {
  storeState.nodeLookup.get(nodeId)!.selected = selected;
}

/** 注入节点 data（生成态/提交中标记）：mock 的 store 无订阅，必须在 render 前写入 */
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

/** 第二条连线（跨线互斥场景）：端点节点与几何都独立，两条实例互不共享状态 */
const edgePropsB = {
  ...edgeProps,
  id: 'e2',
  source: 'n-src-b',
  target: 'n-dst-b',
  sourceY: 200,
  targetY: 300,
};

/** 多连线渲染时每条线各占一个槽位元素，按槽位取元素 */
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

/** 两条连线挂在同一个渲染根下（真实画布也是如此）：跨线互斥场景用 */
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

/** 按槽位取某一条连线的元素范围 */
function edgeSlot(key: 'a' | 'b'): ParentNode {
  return container.querySelector(`.${key === 'a' ? SLOT_A : SLOT_B}`)!;
}

/** 重复 render 触发组件重执行（props 等价，但元素引用全新） */
async function rerenderEdge() {
  await act(async () => {
    root.render(createElement(CustomEdge, edgeProps));
  });
}

/** 连线根 <g> 的 class（选中相连时追加 selectedConnected） */
function edgeGroupClass(scope: ParentNode = container): string {
  const group = scope.querySelector('g');
  return group?.getAttribute('class') ?? '';
}

/** 剪刀是否已出现：由组件按停稳状态追加出现类决定，默认隐藏 */
function scissorsShown(scope: ParentNode = container): boolean {
  const btn = scope.querySelector(`.${styles.deleteBtn}`);
  return (btn?.getAttribute('class') ?? '').split(/\s+/).includes(styles.deleteBtnVisible);
}

function scissorsTransform(scope: ParentNode = container): string | null {
  return scope.querySelector(`.${styles.deleteBtn}`)?.getAttribute('transform') ?? null;
}

/** 剪刀按钮组原点在画布流坐标里的位置 */
function scissorsOrigin(scope: ParentNode = container): { x: number; y: number } {
  const matched = scissorsTransform(scope)?.match(/translate\((-?[\d.]+),\s*(-?[\d.]+)\)/);
  if (!matched) throw new Error(`剪刀按钮上没有可解析的 transform：${scissorsTransform(scope)}`);
  return { x: Number(matched[1]), y: Number(matched[2]) };
}

/** 剪刀圆心的画布流坐标：按钮组原点 + 圆在组内的 cx/cy（都读渲染结果，不抄组件常量） */
function scissorsCenter(scope: ParentNode = container): { x: number; y: number } {
  const circle = scope.querySelector(`.${styles.deleteBtn} circle`)!;
  const origin = scissorsOrigin(scope);
  return {
    x: origin.x + Number(circle.getAttribute('cx')),
    y: origin.y + Number(circle.getAttribute('cy')),
  };
}

/** 剪刀可点圆的半径（渲染值） */
function scissorsRadius(scope: ParentNode = container): number {
  return Number(scope.querySelector(`.${styles.deleteBtn} circle`)!.getAttribute('r'));
}

/** 剪刀图标的边长（渲染值） */
function scissorsIconSize(scope: ParentNode = container): number {
  return Number(scope.querySelector(`.${styles.deleteBtn} foreignObject`)!.getAttribute('width'));
}

/** 剪刀组上的尺寸补偿倍率（渲染值）：按钮按 1/zoom 反向缩放，抵消画布缩放 */
function scissorsScale(scope: ParentNode = container): number {
  const matched = /scale\(([\d.]+)\)/.exec(scissorsTransform(scope) ?? '');
  if (!matched) throw new Error(`剪刀按钮上没有可解析的 scale：${scissorsTransform(scope)}`);
  return Number(matched[1]);
}

/** 剪刀圆盘在屏幕上的半径：渲染半径 × 尺寸补偿 × 画布缩放（IKGUR7 的验收量） */
function scissorsScreenRadius(zoom: number, scope: ParentNode = container): number {
  return scissorsRadius(scope) * scissorsScale(scope) * zoom;
}

/** 剪刀图标在屏幕上的边长 */
function scissorsScreenIconSize(zoom: number, scope: ParentNode = container): number {
  return scissorsIconSize(scope) * scissorsScale(scope) * zoom;
}

/** 圆心到渲染出来的连线路径的最近距离：用折线逼近贝塞尔，独立验证圆心是否压在连线上 */
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

/** 指针在连线上移动（命中路径上派发，事件冒泡到连线组） */
async function movePointer(clientX: number, clientY: number, scope: ParentNode = container) {
  await act(async () => {
    scope
      .querySelector(`.${styles.hitPath}`)!
      .dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY }));
  });
}

/** 指针停在指定画布坐标处：位置类断言要求指针真的落在连线附近，
    屏幕坐标按 mock 的换算公式（含 1000/2000 平移与缩放）反推得到 */
async function movePointerAtFlow(x: number, y: number, scope: ParentNode = container) {
  const { flowDx, flowDy, zoom } = reactFlow.state;
  await movePointer((x - flowDx) * zoom, (y - flowDy) * zoom, scope);
}

/** 指针进入连线（无任何 mousemove）：React 的 onMouseEnter 由冒泡的 mouseover 合成，
    relatedTarget 落在 React 树外（document.body）才会派发进入事件。
    对应「指针不动、连线因平移或缩放滑到指针下」这种进入方式（IKGUR7 审查修订） */
async function enterEdge(clientX: number, clientY: number, scope: ParentNode = container) {
  await act(async () => {
    scope
      .querySelector(`.${styles.hitPath}`)!
      .dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body, clientX, clientY }),
      );
  });
}

/** 指针离开连线到 relatedTarget（默认画布空白）：React 的 onMouseLeave 由 mouseout 合成 */
async function leaveEdge(relatedTarget: Element = document.body, scope: ParentNode = container) {
  await act(async () => {
    scope
      .querySelector(`.${styles.hitPath}`)!
      .dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget }));
  });
}

/** 指针从连线移到剪刀上：命中路径 mouseout 到剪刀（relatedTarget 落在连线组内），
    随后剪刀收到 mousemove——真实浏览器里指针移向剪刀就是这两步，IKGUVK 的存活前提 */
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

/** 指针从剪刀移出到画布空白：既不在连线上也不在剪刀上 */
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

    // 指针不动、连线因平移或缩放滑到指针下：浏览器只给进入事件，没有 mousemove
    await enterEdge(120, 80);
    expect(scissorsShown()).toBe(false);

    await advance(DWELL_MS - 1);
    expect(scissorsShown()).toBe(false);

    await advance(1);
    expect(scissorsShown()).toBe(true);
    // 出现位置仍是进入那一刻的指针位置换算出来的：圆心压在连线上
    expect(distanceToDrawnEdge(scissorsCenter())).toBeLessThan(0.05);
  });

  it('移动重置：计时期间指针移动一次，原计时作废并从最后一次移动起重新计满 1 秒', async () => {
    await renderEdge();

    await movePointer(10, 10);
    await advance(DWELL_MS - 100);
    await movePointer(60, 60);

    // 距第一次移动已 1.9 秒，但中途动过，仍不该出现
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

    // mock 的 store 无订阅：改写节点 data 后必须重新 render，选择器才会重新求值
    setNodeData('n-dst', { genStatus: 'generating' });
    await rerenderEdge();

    expect(scissorsShown()).toBe(false);

    // 指针仍停在连线上：后续没有移动事件，剪刀也不得回来
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

    // 指针停在连线中点（画布坐标 50,50 正好落在连线上）
    await movePointerAtFlow(50, 50);
    await advance(DWELL_MS);
    expect(scissorsShown()).toBe(true);

    // 指针屏幕坐标经 screenToFlowPosition 换算成画布坐标后才参与定位
    expect(reactFlow.screenToFlowPosition).toHaveBeenCalledWith({ x: -950, y: -1950 });
    const center = scissorsCenter();
    // 圆心压在连线上：到渲染出来的路径距离接近 0
    expect(distanceToDrawnEdge(center)).toBeLessThan(0.05);
    // 指针正下方没有按钮：圆心与指针位置的距离大于圆盘半径
    expect(Math.hypot(center.x - 50, center.y - 50)).toBeGreaterThan(scissorsRadius());
  });

  it('错开方向：朝连线剩余更长的一侧错开，指针靠近终点时朝起点一侧退', async () => {
    await renderEdge();

    await movePointerAtFlow(95, 95);
    await advance(DWELL_MS);
    expect(scissorsShown()).toBe(true);

    const center = scissorsCenter();
    expect(distanceToDrawnEdge(center)).toBeLessThan(0.05);
    // 连线在 x、y 上都随参数单调递增：往起点一侧退，圆心 x 明显小于指针的 95
    expect(center.x).toBeLessThan(80);
  });

  it('错开距离：沿连线离开指针 30 屏幕像素', async () => {
    await renderEdge();

    await movePointerAtFlow(50, 50);
    await advance(DWELL_MS);

    const center = scissorsCenter();
    // 弧长按折线采样累加，实测弦长与设定值相差不到 1 像素
    const gap = Math.hypot(center.x - 50, center.y - 50);
    expect(gap).toBeGreaterThan(SCISSORS_GAP - 1);
    expect(gap).toBeLessThan(SCISSORS_GAP + 0.5);
  });

  it('短连线一侧不够：朝另一侧退满错开量，圆心仍压在连线上', async () => {
    // 60 单位长的连线，指针停在中后段：剩余更长的是起点一侧
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
    // 20 单位长的连线，两侧剩余都只有 10，都不够 30
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

    // 移动后继续停留：不被新的停稳计时重新定位
    await advance(DWELL_MS * 2);
    expect(scissorsShown()).toBe(true);
    expect(scissorsTransform()).toBe(locked);
  });

  it('指针在按钮上保持可见：指针离开连线移到剪刀上，剪刀不消失', async () => {
    await renderEdge();

    await movePointer(120, 80);
    await advance(DWELL_MS);
    // 指针离开命中路径移向剪刀，路径上会短暂不在连线上
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
    // 重新出现落在新的指针位置附近：上一次的旧坐标没有残留，圆心仍压在连线上
    expect(distanceToDrawnEdge(scissorsCenter())).toBeLessThan(0.05);
  });

  it('指针既不在连线上也不在按钮上：剪刀立即隐藏', async () => {
    await renderEdge();

    await movePointer(120, 80);
    await advance(DWELL_MS);
    await movePointerOntoScissors();
    expect(scissorsShown()).toBe(true);

    // 从剪刀移到画布空白
    await movePointerOffScissors();
    expect(scissorsShown()).toBe(false);
  });

  it('圆盘尺寸不随缩放变化：各档缩放下屏幕上的半径与图标边长都是定值', async () => {
    await renderEdge();

    for (const zoom of [0.5, 1, 2]) {
      reactFlow.state.zoom = zoom;
      storeState.transform = [0, 0, zoom];
      // mock 的 store 无订阅：改写缩放后必须重新 render，选择器才会重新求值
      await rerenderEdge();

      await movePointerAtFlow(50, 50);
      await advance(DWELL_MS);
      expect(scissorsShown()).toBe(true);

      // 渲染半径 × 组内补偿 × 画布缩放 = 屏幕像素：三档缩放都是 11 与 14
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

    // 画布坐标里的错开量随缩放减半，乘回缩放后屏幕上仍是 30 像素
    expect(gapAtOne).toBeGreaterThan(SCISSORS_GAP - 1);
    expect(gapAtOne).toBeLessThan(SCISSORS_GAP + 0.5);
    expect(gapAtTwo * 2).toBeGreaterThan(SCISSORS_GAP - 2);
    expect(gapAtTwo * 2).toBeLessThan(SCISSORS_GAP + 0.5);
    // 圆心仍压在连线上
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

    // A 线上停稳满 1 秒：A 出现剪刀
    await movePointer(120, 80, slotA);
    await advance(DWELL_MS);
    expect(scissorsShown(slotA)).toBe(true);
    expect(visibleScissorsCount()).toBe(1);

    // 指针离开 A 线进入 B 线：浏览器里这是同一次指针移动产生的 mouseout + mousemove
    await leaveEdge(slotB.querySelector(`.${styles.hitPath}`)!, slotA);
    await movePointer(120, 280, slotB);
    expect(scissorsShown(slotA)).toBe(false);
    expect(scissorsShown(slotB)).toBe(false);
    expect(visibleScissorsCount()).toBe(0);

    // B 线上重新停稳满 1 秒：页面上只剩 B 的剪刀
    await advance(DWELL_MS);
    expect(scissorsShown(slotB)).toBe(true);
    expect(scissorsShown(slotA)).toBe(false);
    expect(visibleScissorsCount()).toBe(1);
  });
});
