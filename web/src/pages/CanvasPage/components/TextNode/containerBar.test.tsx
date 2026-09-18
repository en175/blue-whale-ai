// @vitest-environment jsdom
/* IKGZ86 审查修复：spec 第 6 条组件级断言补齐——文本卡操作条 nodeBar 渲染出浮层容器底类，
   「添加到对话」挂 addToChatBtn 透明底类（胶囊已退役）。CSS 源断言在
   src/styles/overlayContainer.test.ts，这里只补渲染层，不测交互。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import TextNode from './index';
import styles from './index.module.css';

beforeAll(() => {
  // jsdom 未实现 Range 的几何 API；沿用 floatPosition.test.tsx 的回退
  if (!Range.prototype.getBoundingClientRect) {
    Range.prototype.getBoundingClientRect = function () {
      return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => '' } as DOMRect;
    };
  }
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = function () {
      return [] as unknown as DOMRectList;
    };
  }
});

const storeState = vi.hoisted(() => ({
  nodes: [],
  edges: [],
  transform: [0, 0, 1],
}));

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
  useStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
  useReactFlow: () => ({ setCenter: vi.fn() }),
}));

let root: Root;
let container: HTMLDivElement;

async function renderNode() {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(TextNode, {
        id: 't1',
        type: 'textNode',
        selected: true,
        dragging: false,
        zIndex: 1,
        selectable: true,
        deletable: true,
        draggable: true,
        isConnectable: true,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
        data: {
          toolMode: 'select' as const,
          title: '文本节点',
          text: '看这张图片1',
          onTextChange: vi.fn(),
          onMediaIndexChange: vi.fn(),
          onToast: vi.fn(),
        },
      } as never),
    ),
  );
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
});

it('非编辑态 nodeBar 操作条渲染容器底类，「添加到对话」为透明底 addToChatBtn 而非胶囊类（IKGZ8B）', async () => {
  await renderNode();
  const nodeBar = container.querySelector(`.${styles.nodeBar}`);
  expect(nodeBar).not.toBeNull();
  const addToChat = nodeBar!.querySelector('button');
  expect(addToChat!.classList.contains(styles.addToChatBtn)).toBe(true);
});
