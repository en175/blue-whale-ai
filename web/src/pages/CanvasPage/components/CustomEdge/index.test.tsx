// @vitest-environment jsdom
/* IKGGC0 回归锁：选中节点（source/target 任一端）时相连线呈现流动动效，
   视觉与悬停共用同一份 CSS 定义（源断言见 edgeFlowSource.test.ts）；
   取消选中即恢复静态实线。类开关是唯一接缝，不写入连线数据。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Position } from '@xyflow/react';
import CustomEdge from './index';
import styles from './index.module.css';

/** 可控 store：nodeLookup 提供两端节点与第三方节点的 selected，模拟画布选中态 */
const storeState = vi.hoisted(() => ({
  nodeLookup: new Map<string, { id: string; selected?: boolean }>([
    ['n-src', { id: 'n-src', selected: false }],
    ['n-dst', { id: 'n-dst', selected: false }],
    ['n-other', { id: 'n-other', selected: false }],
  ]),
}));

vi.mock('@xyflow/react', async (importOriginal) => {
  const original = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...original,
    useReactFlow: () => ({ deleteElements: vi.fn() }),
    useStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
  };
});

let root: Root;
let container: HTMLDivElement;

function setSelected(nodeId: string, selected: boolean) {
  storeState.nodeLookup.get(nodeId)!.selected = selected;
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
