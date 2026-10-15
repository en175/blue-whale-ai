// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Modal, { type ModalSemanticDOM } from './index';

let root: Root;
let mountNode: HTMLDivElement;

async function renderModal(props: Partial<Parameters<typeof Modal>[0]> = {}) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(Modal, { open: true, title: '测试弹框', ...props }, '正文'));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('Modal', () => {
  it('通过 Portal 渲染完整 semantic DOM', async () => {
    const semanticNodes: ModalSemanticDOM[] = [
      'root',
      'mask',
      'wrapper',
      'container',
      'header',
      'title',
      'body',
      'footer',
    ];

    await renderModal({
      classNames: ({ props }) => ({ body: props.open ? 'custom-body' : '' }),
      styles: { footer: { paddingTop: 8 } },
    });

    expect(mountNode.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    for (const semantic of semanticNodes) {
      expect(document.body.querySelector(`[data-semantic="${semantic}"]`)).not.toBeNull();
    }
    expect(document.body.querySelector('[data-semantic="body"]')?.classList).toContain('custom-body');
    expect((document.body.querySelector('[data-semantic="footer"]') as HTMLElement).style.paddingTop).toBe('8px');
  });

  it('支持默认操作按钮、loading 和自定义 footer', async () => {
    const onOk = vi.fn();
    const onCancel = vi.fn();
    await renderModal({ onOk, onCancel, confirmLoading: true, okText: '保存' });

    const okButton = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent === '保存',
    ) as HTMLButtonElement;
    expect(okButton.disabled).toBe(true);
    expect(okButton.getAttribute('aria-busy')).toBe('true');

    await act(async () => {
      [...document.body.querySelectorAll('button')]
        .find((button) => button.textContent === '取消')
        ?.click();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onOk).not.toHaveBeenCalled();
  });

  it('footer 为 null 时不渲染底部区域', async () => {
    await renderModal({ footer: null });
    expect(document.body.querySelector('[data-semantic="footer"]')).toBeNull();
  });

  it('按 ESC 时通过统一的 onCancel 请求关闭', async () => {
    const onCancel = vi.fn();
    await renderModal({ onCancel });

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
