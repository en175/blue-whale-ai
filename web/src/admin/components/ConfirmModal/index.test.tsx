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

// 弹窗经 createPortal 挂到 document.body，**不在 mountNode 里**——所以下面一律查 document.body。
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
    // 旧实现是裸 div + 私有 CSS，读屏软件拿不到对话框语义、关闭按钮也没有 aria-label。
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
    // 调用页在提交中用 confirmText 传「删除中…」，这条默认值不能丢。
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
    // 删除确认里最贵的一类回归：正读着文案，手抖点在字上，弹窗自己关了——而按钮没按，
    // 用户以为取消了。闸门在 ui/Modal：面板 stopPropagation，遮罩 onClick=onClose。
    // 这里经 ConfirmModal 渲染，一次把适配层与骨架层都钉住。
    const onClose = vi.fn();
    await render({ onClose });

    await act(async () => (document.body.querySelector('p') as HTMLElement).click());
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => (dialog().parentElement as HTMLElement).click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
