// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountModal from './index';

vi.mock('../PasswordModal', () => ({
  default: function MockPasswordModal({
    open,
    onSuccess,
  }: {
    open: boolean;
    onSuccess?: () => void;
  }) {
    if (!open) return null;
    return createElement(
      'button',
      {
        type: 'button',
        onClick: (event: { stopPropagation: () => void }) => {
          event.stopPropagation();
          onSuccess?.();
        },
      },
      '改密成功',
    );
  },
}));

vi.mock('../AccountRecordsModal', () => ({
  default: function MockAccountRecordsModal() {
    return null;
  },
}));

let root: Root;
let mountNode: HTMLDivElement;

async function renderAccountModal(onClose = vi.fn()) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(AccountModal, {
        userId: 1,
        nickname: 'alice',
        balance: 0,
        onClose,
        onOpenRecharge: vi.fn(),
      }),
    );
  });
  return { onClose };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('AccountModal', () => {
  it('改密成功后关闭账号信息弹窗', async () => {
    const { onClose } = await renderAccountModal();

    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === '修改')
        ?.click();
    });

    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === '改密成功')
        ?.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
