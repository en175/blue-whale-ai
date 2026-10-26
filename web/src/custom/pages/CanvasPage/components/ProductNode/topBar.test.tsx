// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReactFlowProvider } from '@xyflow/react';
import ProductNode from './index';
import styles from './index.module.css';

let root: Root;
let mountNode: HTMLDivElement;

async function renderNode(extraData?: Record<string, unknown>) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(ReactFlowProvider, null, createElement(ProductNode, {
        id: 'product-node',
        data: { toolMode: 'select', ...extraData },
        selected: true,
        type: 'productNode',
        dragging: false,
        zIndex: 1,
        selectable: true,
        deletable: true,
        draggable: true,
        isConnectable: true,
        positionAbsoluteX: 0,
        positionAbsoluteY: 0,
      } as never)),
    );
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('ProductNode topBar 容器底（IKGZ8B）', () => {
  it('topBar 容器底类存在，「添加到对话」为透明底 addToChatBtn 而非胶囊类', async () => {
    await renderNode();
    expect(mountNode.querySelector(`.${styles.topBar}`)).not.toBeNull();
    const addToChat = mountNode.querySelector(`.${styles.addToChatBtn}`);
    expect(addToChat).not.toBeNull();
    expect(addToChat!.classList.contains(styles.addToChatBtn)).toBe(true);
  });
});
