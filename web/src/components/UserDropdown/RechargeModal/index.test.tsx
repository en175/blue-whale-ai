// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RechargeModal from './index';
import styles from './index.module.css';

const rechargeApi = vi.hoisted(() => ({
  cancelRechargeOrder: vi.fn(),
  createRechargeOrder: vi.fn(),
  fetchRechargeAgreement: vi.fn(),
  fetchRechargeOrderStatus: vi.fn(),
  fetchRechargeTiers: vi.fn(),
}));

const toastApi = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@/api/recharge', () => rechargeApi);
vi.mock('@/api/auth', () => ({ quotaToPoints: (quota: number) => quota }));
vi.mock('@/stores/auth', () => {
  const store = Object.assign(
    <T,>(selector: (state: { quota: number }) => T) => selector({ quota: 100 }),
    { getState: () => ({ quota: 100 }) },
  );
  return { useAuthStore: store };
});
vi.mock('@/utils/refreshQuota', () => ({
  refreshQuotaAfterPayment: vi.fn(),
  syncQuotaFromUsageToken: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: toastApi,
  Toaster: () => null,
}));

let root: Root;
let mountNode: HTMLDivElement;

async function renderRechargeModal() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(RechargeModal, { onClose: vi.fn() }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  rechargeApi.fetchRechargeTiers.mockResolvedValue([
    {
      id: 'tier-1',
      name: '基础套餐',
      amount: 100,
      price: 10,
      original_price: null,
      discount: 1,
      is_recommended: false,
      sort_order: 1,
    },
  ]);
  rechargeApi.createRechargeOrder.mockResolvedValue({
    trade_no: 'trade-1',
    qr_code_url: 'https://example.com/qr',
    expire_time: '2026-08-28T12:00:00+08:00',
    amount: 10,
    points: 100,
  });
  rechargeApi.cancelRechargeOrder.mockResolvedValue(null);
  rechargeApi.fetchRechargeAgreement.mockResolvedValue({ title: '充值协议', content: '协议内容' });
  rechargeApi.fetchRechargeOrderStatus.mockResolvedValue({
    trade_no: 'trade-1',
    status: 'pending',
    credits_after: null,
  });
});

afterEach(async () => {
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('RechargeModal', () => {
  it('通过共享 Modal 以 Portal 渲染充值内容', async () => {
    await renderRechargeModal();

    expect(mountNode.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[data-semantic="mask"]')).not.toBeNull();
    expect(document.body.textContent).toContain('积分充值');
  });

  it('支付等待时可取消订单并回到可再次支付的状态', async () => {
    await renderRechargeModal();

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.includes('100 积分'))
        ?.click();
    });
    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.includes('确认支付 ¥10'))
        ?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('等待支付结果...');
    expect(document.body.querySelector(`.${styles.planRowPaying}`)).not.toBeNull();

    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === '取消支付')
        ?.click();
      await Promise.resolve();
    });

    expect(rechargeApi.cancelRechargeOrder).toHaveBeenCalledWith('trade-1');
    expect(document.body.textContent).not.toContain('等待支付结果...');
    expect(document.body.textContent).toContain('确认支付 ¥10');
    expect(document.body.querySelector(`.${styles.planRowPaying}`)).toBeNull();
  });

  it('下单未返回前不展开支付码，成功后才出现二维码', async () => {
    let resolveOrder: (value: {
      trade_no: string;
      qr_code_url: string;
      expire_time: string;
      amount: number;
      points: number;
    }) => void = () => undefined;
    rechargeApi.createRechargeOrder.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOrder = resolve;
        }),
    );
    await renderRechargeModal();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.includes('100 积分'))
        ?.click();
    });
    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.includes('确认支付 ¥10'))
        ?.click();
    });

    expect(document.body.textContent).toContain('支付中...');
    expect(document.body.textContent).not.toContain('正在创建订单…');
    expect(document.body.textContent).not.toContain('等待支付结果...');
    expect(document.body.querySelector(`.${styles.planRowPaying}`)).toBeNull();

    await act(async () => {
      resolveOrder({
        trade_no: 'trade-1',
        qr_code_url: 'https://example.com/qr',
        expire_time: '2026-08-28T12:00:00+08:00',
        amount: 10,
        points: 100,
      });
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('等待支付结果...');
    expect(document.body.querySelector(`.${styles.planRowPaying}`)).not.toBeNull();
  });

  it('下单失败展示错误且不出现支付码', async () => {
    rechargeApi.createRechargeOrder.mockRejectedValue(new Error('该档位已过期'));
    await renderRechargeModal();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.includes('100 积分'))
        ?.click();
    });
    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.includes('确认支付 ¥10'))
        ?.click();
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain('该套餐已结束，请选择其他套餐');
    expect(toastApi.error).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('正在创建订单…');
    expect(document.body.textContent).not.toContain('等待支付结果...');
    expect(document.body.querySelector(`.${styles.planRowPaying}`)).toBeNull();
  });
});
