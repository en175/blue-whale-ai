// @vitest-environment jsdom
/* IKGGC0 回归锁：选中节点（source/target 任一端）时相连线呈现流动动效，
   视觉与悬停共用同一份 CSS 定义（源断言见 edgeFlowSource.test.ts）；
   取消选中即恢复静态实线。类开关是唯一接缝，不写入连线数据。
   IKGUVG：剪刀改为指针停稳满 1 秒才出现（假计时器驱动），生成中的目标连线不出现。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Position } from '@xyflow/react';
import CustomEdge from './index';
import styles from './index.module.css';

/** 可控 store：nodeLookup 提供两端节点与第三方节点的 selected / data，模拟画布选中与生成态 */
const storeState = vi.hoisted(() => ({
  nodeLookup: new Map<string, { id: string; selected?: boolean; data?: Record<string, unknown> }>([
    ['n-src', { id: 'n-src', selected: false }],
    ['n-dst', { id: 'n-dst', selected: false }],
    ['n-other', { id: 'n-other', selected: false }],
  ]),
}));

/** React Flow 替身：屏幕坐标换算故意加偏移，断言位置确实走了 screenToFlowPosition */
const reactFlow = vi.hoisted(() => ({
  deleteElements: vi.fn(),
  screenToFlowPosition: vi.fn((p: { x: number; y: number }) => ({ x: p.x + 1000, y: p.y + 2000 })),
}));

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
/** 剪刀出现位置相对停稳指针的固定偏移（与组件 SCISSORS_OFFSET 同值，IKGUVK） */
const SCISSORS_OFFSET = { x: 12, y: -12 };
/** 剪刀图标圆心相对按钮组原点的偏移（与组件 SCISSORS_CENTER 同值） */
const SCISSORS_CENTER = 10;

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

async function renderEdge() {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(CustomEdge, edgeProps));
  });
}

/** 连线根 <g> 的 class（选中相连时追加 selectedConnected） */
function edgeGroupClass(): string {
  const group = container.querySelector('g');
  return group?.getAttribute('class') ?? '';
}

/** 重复 render 触发组件重执行（props 等价，但元素引用全新） */
async function rerenderEdge() {
  await act(async () => {
    root.render(createElement(CustomEdge, edgeProps));
  });
}

/** 剪刀是否已出现：由组件按停稳状态追加出现类决定，默认隐藏 */
function scissorsShown(): boolean {
  const btn = container.querySelector(`.${styles.deleteBtn}`);
  return (btn?.getAttribute('class') ?? '').split(/\s+/).includes(styles.deleteBtnVisible);
}

function scissorsTransform(): string | null {
  return container.querySelector(`.${styles.deleteBtn}`)?.getAttribute('transform') ?? null;
}

/** 剪刀按钮组原点在画布流坐标里的位置；圆心 = 组原点 + SCISSORS_CENTER */
function scissorsOrigin(): { x: number; y: number } {
  const matched = scissorsTransform()?.match(/translate\((-?[\d.]+),\s*(-?[\d.]+)\)/);
  if (!matched) throw new Error(`剪刀按钮上没有可解析的 transform：${scissorsTransform()}`);
  return { x: Number(matched[1]), y: Number(matched[2]) };
}

/** 指针在连线上移动（命中路径上派发，事件冒泡到连线组） */
async function movePointer(clientX: number, clientY: number) {
  await act(async () => {
    container
      .querySelector(`.${styles.hitPath}`)!
      .dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY }));
  });
}

/** 指针离开连线：React 的 onMouseLeave 由 mouseout(relatedTarget=外部) 合成 */
async function leaveEdge() {
  await act(async () => {
    container
      .querySelector(`.${styles.hitPath}`)!
      .dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
  });
}

/** 指针从连线移到剪刀上：命中路径 mouseout 到剪刀（relatedTarget 落在连线组内），
    随后剪刀收到 mousemove——真实浏览器里指针移向剪刀就是这两步，IKGUVK 的存活前提 */
async function movePointerOntoScissors() {
  const btn = container.querySelector(`.${styles.deleteBtn}`)!;
  await act(async () => {
    container
      .querySelector(`.${styles.hitPath}`)!
      .dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: btn }));
  });
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  });
}

/** 指针从剪刀移出到画布空白：既不在连线上也不在剪刀上 */
async function movePointerOffScissors() {
  await act(async () => {
    container
      .querySelector(`.${styles.deleteBtn}`)!
      .dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
  });
}

async function clickScissors() {
  await act(async () => {
    container
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

  it('指针进入连线未满 1 秒：剪刀不出现', async () => {
    await renderEdge();

    await movePointer(120, 80);
    expect(scissorsShown()).toBe(false);

    await advance(DWELL_MS - 1);
    expect(scissorsShown()).toBe(false);
  });

  it('指针停稳满 1 秒：剪刀出现，且落在换算后的指针位置加固定偏移处', async () => {
    await renderEdge();

    await movePointer(120, 80);
    await advance(DWELL_MS);

    expect(scissorsShown()).toBe(true);
    // 换算函数返回 (clientX + 1000, clientY + 2000)；剪刀组原点 = 指针流坐标 + 固定偏移 - 圆心偏移
    expect(scissorsTransform()).toBe(
      `translate(${120 + 1000 + SCISSORS_OFFSET.x - SCISSORS_CENTER}, ${80 + 2000 + SCISSORS_OFFSET.y - SCISSORS_CENTER})`,
    );
    expect(reactFlow.screenToFlowPosition).toHaveBeenCalledWith({ x: 120, y: 80 });
  });

  it('计时期间指针移动一次：原计时作废，从最后一次移动起重新计满 1 秒', async () => {
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

  it('指针离开连线：剪刀立即隐藏且不留迟到出现，返回后需重新停稳满 1 秒', async () => {
    await renderEdge();

    await movePointer(10, 10);
    await advance(DWELL_MS);
    expect(scissorsShown()).toBe(true);

    await leaveEdge();
    expect(scissorsShown()).toBe(false);

    // 离开发生在计时途中时，残余计时不得让剪刀迟到出现
    await movePointer(20, 20);
    await advance(DWELL_MS - 200);
    await leaveEdge();
    await advance(DWELL_MS * 2);
    expect(scissorsShown()).toBe(false);

    await movePointer(30, 30);
    await advance(DWELL_MS);
    expect(scissorsShown()).toBe(true);
  });

  it('目标节点生成中：停满 1 秒也不出现剪刀', async () => {
    setNodeData('n-dst', { genStatus: 'generating' });
    await renderEdge();

    await movePointer(10, 10);
    await advance(DWELL_MS * 3);
    expect(scissorsShown()).toBe(false);
  });

  it('目标节点处于提交中（页面 submitting 标记）：停满 1 秒也不出现剪刀', async () => {
    setNodeData('n-dst', { genStatus: 'draft', submitting: true });
    await renderEdge();

    await movePointer(10, 10);
    await advance(DWELL_MS * 3);
    expect(scissorsShown()).toBe(false);
  });

  it('只有目标节点生成中才拦：源节点生成中，相连线仍可停稳出现剪刀', async () => {
    setNodeData('n-src', { genStatus: 'generating' });
    await renderEdge();

    await movePointer(10, 10);
    await advance(DWELL_MS);
    expect(scissorsShown()).toBe(true);
  });

  it('剪刀出现后单击一次即触发删除链路', async () => {
    await renderEdge();

    await movePointer(10, 10);
    await advance(DWELL_MS);
    await act(async () => {
      container
        .querySelector(`.${styles.deleteBtn}`)!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(reactFlow.deleteElements).toHaveBeenCalledTimes(1);
    expect(reactFlow.deleteElements).toHaveBeenCalledWith({ edges: [{ id: 'e1' }] });
  });

  it('卸载时清掉未触发的停稳计时，不留残余定时任务', async () => {
    await renderEdge();
    const before = vi.getTimerCount();

    await movePointer(10, 10);
    expect(vi.getTimerCount()).toBe(before + 1);

    await act(async () => {
      root.unmount();
    });
    expect(vi.getTimerCount()).toBe(before);
  });
});

describe('IKGUVK 剪刀位置与指针错开并就地定格', () => {
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

  it('出现位置与指针存在固定偏移，不在指针坐标上', async () => {
    await renderEdge();

    await movePointer(120, 80);
    await advance(DWELL_MS);

    expect(scissorsShown()).toBe(true);
    // 换算函数返回 (clientX + 1000, clientY + 2000)；剪刀圆心 = 指针流坐标 + 固定偏移
    const center = { x: scissorsOrigin().x + SCISSORS_CENTER, y: scissorsOrigin().y + SCISSORS_CENTER };
    expect(center).toEqual({ x: 120 + 1000 + SCISSORS_OFFSET.x, y: 80 + 2000 + SCISSORS_OFFSET.y });
    // 指针正下方没有按钮：圆心不在指针换算位置上
    expect(center).not.toEqual({ x: 120 + 1000, y: 80 + 2000 });
  });

  it('出现后指针在连线上继续移动：位置就地定格，不再跟随指针', async () => {
    await renderEdge();

    await movePointer(120, 80);
    await advance(DWELL_MS);
    const locked = scissorsTransform();

    await movePointer(400, 300);
    expect(scissorsShown()).toBe(true);
    expect(scissorsTransform()).toBe(locked);
  });

  it('指针移到剪刀上：剪刀保持可见，单击一次即删除', async () => {
    await renderEdge();

    await movePointer(120, 80);
    await advance(DWELL_MS);
    // 指针离开命中路径移向剪刀，路径上会短暂不在连线上
    await movePointerOntoScissors();
    expect(scissorsShown()).toBe(true);

    await clickScissors();
    expect(reactFlow.deleteElements).toHaveBeenCalledTimes(1);
    expect(reactFlow.deleteElements).toHaveBeenCalledWith({ edges: [{ id: 'e1' }] });
  });

  it('指针从剪刀移回连线：重新计时，未满 1 秒不出现', async () => {
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
    // 重新出现落在新的指针位置：上一次的旧坐标没有残留
    expect(scissorsOrigin()).toEqual({
      x: 200 + 1000 + SCISSORS_OFFSET.x - SCISSORS_CENTER,
      y: 120 + 2000 + SCISSORS_OFFSET.y - SCISSORS_CENTER,
    });
  });

  it('指针既不在连线上也不在剪刀上：剪刀立即隐藏', async () => {
    await renderEdge();

    await movePointer(120, 80);
    await advance(DWELL_MS);
    await movePointerOntoScissors();
    expect(scissorsShown()).toBe(true);

    // 从剪刀移到画布空白
    await movePointerOffScissors();
    expect(scissorsShown()).toBe(false);
  });

  it('偏移量是画布流坐标定值：不同指针位置的错开量恒定，缩放只改视觉大小', async () => {
    await renderEdge();

    await movePointer(40, 30);
    await advance(DWELL_MS);
    const first = scissorsOrigin();
    expect({
      x: first.x + SCISSORS_CENTER - (40 + 1000),
      y: first.y + SCISSORS_CENTER - (30 + 2000),
    }).toEqual(SCISSORS_OFFSET);

    await leaveEdge();
    await movePointer(260, 180);
    await advance(DWELL_MS);
    const second = scissorsOrigin();
    expect({
      x: second.x + SCISSORS_CENTER - (260 + 1000),
      y: second.y + SCISSORS_CENTER - (180 + 2000),
    }).toEqual(SCISSORS_OFFSET);
  });
});
