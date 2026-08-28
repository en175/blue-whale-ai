// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConfirmModal from './index';

let root: Root;
let mountNode: HTMLDivElement;

async function renderConfirmModal(props: Partial<Parameters<typeof ConfirmModal>[0]> = {}) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(ConfirmModal, {
        open: true,
        title: '删除项目',
        message: '此操作不可撤销。',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        ...props,
      }),
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

describe('ConfirmModal', () => {
  it('复用 Modal 的语义结构，并保留确认与取消回调', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    await renderConfirmModal({ confirmText: '移除', onConfirm, onCancel });

    expect(document.body.querySelector('[data-semantic="container"]')).not.toBeNull();
    expect(document.body.textContent).toContain('此操作不可撤销。');

    await act(async () => {
      [...document.body.querySelectorAll('button')]
        .find((button) => button.textContent === '移除')
        ?.click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await act(async () => {
      [...document.body.querySelectorAll('button')]
        .find((button) => button.textContent === '取消')
        ?.click();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
