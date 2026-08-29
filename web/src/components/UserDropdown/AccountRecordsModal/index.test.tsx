// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountRecordsModal from './index';

const accountApi = vi.hoisted(() => ({
  fetchConsumptions: vi.fn(),
  fetchTopups: vi.fn(),
}));

vi.mock('@/api/account', () => accountApi);

let root: Root;
let mountNode: HTMLDivElement;

async function renderModal() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(AccountRecordsModal, { onClose: vi.fn() }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  accountApi.fetchTopups.mockResolvedValue({
    items: [
      {
        trade_no: 'T20260829001',
        credits: 100,
        amount_cny: 10,
        payment_method: '微信',
        status: 'success',
        created_at: 1_700_000_000,
      },
    ],
    total: 1,
  });
  accountApi.fetchConsumptions.mockResolvedValue({
    items: [
      {
        id: 7,
        credits: 5,
        summary: '生成视频',
        model: 'doubao-seedance-2-0',
        created_at: 1_700_000_100,
      },
    ],
    total: 1,
  });
});

afterEach(async () => {
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('AccountRecordsModal', () => {
  it('充值记录展示单号和支付方式', async () => {
    await renderModal();

    expect(document.body.textContent).toContain('单号 T20260829001');
    expect(document.body.textContent).toContain('微信');
    expect(document.body.textContent).toContain('¥10.00');
  });

  it('消费记录展示模型名', async () => {
    await renderModal();

    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.includes('消费记录'))
        ?.click();
      await Promise.resolve();
    });

    expect(accountApi.fetchConsumptions).toHaveBeenCalled();
    expect(document.body.textContent).toContain('生成视频 · doubao-seedance-2-0');
  });
});
