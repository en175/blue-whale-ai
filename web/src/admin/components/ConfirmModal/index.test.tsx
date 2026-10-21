// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConfirmModal from './index';

let root: Root;
let mountNode: HTMLDivElement;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mountNode.remove();
});

async function render(props: Record<string, unknown> = {}): Promise<void> {
  await act(async () => {
    root.render(
      createElement(ConfirmModal, {
        title: '删除档位',
        content: '删除后不可恢复。',
        onConfirm: () => {},
        onClose: () => {},
        ...props,
      })
    );
  });
}

function dialog(): HTMLElement {
  return document.body.querySelector('[role="dialog"]') as HTMLElement;
}

function buttonByText(text: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text
  );
  if (!found) throw new Error(`找不到按钮：${text}`);
  return found as HTMLButtonElement;
}

describe('ConfirmModal', () => {
  it('★ 带 role="dialog" / aria-modal —— 收编 ui/Modal 前这两条是缺的', async () => {
    await render();

    expect(dialog()).not.toBeNull();
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(document.body.querySelector('[aria-label="关闭"]')).not.toBeNull();
  });

  it('标题与正文来自 props', async () => {
    await render({ title: '删除模型', content: '确定要删除「小米」吗？' });

    expect(document.body.textContent).toContain('删除模型');
    expect(document.body.textContent).toContain('确定要删除「小米」吗？');
  });

  it('确认文案默认「确认删除」，confirmText 可覆盖', async () => {
    await render();
    expect(buttonByText('确认删除')).not.toBeNull();

    await render({ confirmText: '删除中…' });
    expect(buttonByText('删除中…')).not.toBeNull();
  });

  it('确认走 onConfirm；取消与右上角关闭都走 onClose', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    await render({ onConfirm, onClose });

    await act(async () => buttonByText('确认删除').click());
    expect(onConfirm).toHaveBeenCalledTimes(1);

    await act(async () => buttonByText('取消').click());
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () =>
      (document.body.querySelector('[aria-label="关闭"]') as HTMLButtonElement).click()
    );
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('★ 点面板内部不关闭，点遮罩才关闭', async () => {
    const onClose = vi.fn();
    await render({ onClose });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => (document.body.querySelector('p') as HTMLElement).click());
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => {
      const overlay = dialog().parentElement as HTMLElement;
      overlay.dispatchEvent(pointerDown());
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

function pointerDown(): MouseEvent {
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    composed: true,
  });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event;
}
