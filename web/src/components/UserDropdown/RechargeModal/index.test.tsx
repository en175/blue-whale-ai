// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RechargeModal from './index';

const rechargeApi = vi.hoisted(() => ({
  createRechargeOrder: vi.fn(),
  fetchRechargeOrderStatus: vi.fn(),
  fetchRechargeTierCatalog: vi.fn(),
}));

const authApi = vi.hoisted(() => ({ fetchCredits: vi.fn() }));

const setCredits = vi.hoisted(() => vi.fn());

const toastApi = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('@/api/recharge', () => rechargeApi);
vi.mock('@/api/auth', () => authApi);
// 只模拟组件用到的两个面：读余额的 selector（固定 500）与写回余额的 actions
vi.mock('@/stores/auth', () => {
  const store = Object.assign(
    <T,>(selector: (state: { credits: number | null }) => T) => selector({ credits: 500 }),
    { getState: () => ({ setCredits }) },
  );
  return { useAuthStore: store };
});
vi.mock('sonner', () => ({
  toast: toastApi,
  Toaster: () => null,
}));

const TIER_ID = 'tier-1';

let root: Root;
let mountNode: HTMLDivElement;
let onClose: ReturnType<typeof vi.fn>;

/** 冲掉一串微任务：下单与轮询都是 promise 串联，单次 await 只推进一格 */
async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderRechargeModal() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(RechargeModal, { onClose }));
  });
}

/** 按可见文字点按钮（套餐卡片 / 确认支付） */
async function clickButton(text: string) {
  await act(async () => {
    [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes(text))
      ?.click();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  onClose = vi.fn();
  rechargeApi.fetchRechargeTierCatalog.mockResolvedValue({
    credits_per_yuan: 10,
    tiers: [
      {
        id: TIER_ID,
        name: '基础套餐',
        amount: 100,
        price: 10,
        original_price: null,
        discount: 1,
        is_recommended: false,
        sort_order: 1,
      },
    ],
  });
  rechargeApi.createRechargeOrder.mockResolvedValue({
    trade_no: 'trade-1',
    qr_code_url: 'https://example.com/cashier',
    expire_time: '2026-08-28T12:00:00+08:00',
    amount: 10,
    points: 100,
  });
  rechargeApi.fetchRechargeOrderStatus.mockResolvedValue({
    trade_no: 'trade-1',
    status: 'pending',
    credits_after: null,
  });
  authApi.fetchCredits.mockResolvedValue({ credits: 1234 });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('RechargeModal', () => {
  it('以 Portal 渲染并展示后端返回的档位与换算率', async () => {
    await renderRechargeModal();
    await flush();

    expect(mountNode.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[data-semantic="mask"]')).not.toBeNull();

    // 换算率来自后端目录（不是前端写死的 10）
    expect(document.body.textContent).toContain('1 元 = 10 积分');
    // 档位卡片：到账积分 + 实付价
    expect(document.body.textContent).toContain('100 积分');
    expect(document.body.textContent).toContain('¥10');
  });

  it('只有一个渠道：没有微信/支付宝切换段', async () => {
    await renderRechargeModal();
    await flush();

    const labels = [...document.body.querySelectorAll('button')].map((b) => b.textContent ?? '');
    expect(labels.some((text) => text.includes('微信支付'))).toBe(false);
    expect(labels.some((text) => text.trim() === '支付宝')).toBe(false);
  });

  it('下单成功后出收银台二维码，下单只传档位 id', async () => {
    await renderRechargeModal();
    await flush();

    await clickButton('100 积分');
    // 选中后底部结算栏带出账本余额（整数积分）
    expect(document.body.textContent).toContain('500 积分');
    await clickButton('确认支付 ¥10');

    expect(rechargeApi.createRechargeOrder).toHaveBeenCalledWith(TIER_ID);
    expect(document.body.textContent).toContain('等待支付结果...');
    expect(document.body.textContent).toContain('请用微信 / 支付宝 / 云闪付 扫码支付');
    expect(document.body.textContent).toContain('获得 100 积分');
    // 二维码真的画出来了（不是「二维码不可用」占位）
    expect(document.body.textContent).not.toContain('二维码不可用');
    // 渠道切换与取消支付整条删掉了（没有 cancel 接口，留个假按钮就是骗人）
    expect(document.body.textContent).not.toContain('取消支付');
  });

  it('轮询到 paid 后显示成功并刷新余额', async () => {
    rechargeApi.fetchRechargeOrderStatus
      .mockResolvedValueOnce({ trade_no: 'trade-1', status: 'pending', credits_after: null })
      .mockResolvedValue({ trade_no: 'trade-1', status: 'paid', credits_after: 1234 });

    await renderRechargeModal();
    await flush();
    await clickButton('100 积分');

    // 进入 waiting 后由 3s 定时器驱动下一次查询
    vi.useFakeTimers();
    await clickButton('确认支付 ¥10');
    await flush();
    expect(document.body.textContent).toContain('等待支付结果...');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await flush();

    expect(document.body.textContent).toContain('支付成功');
    expect(document.body.textContent).toContain('+100 积分已到账');
    expect(toastApi.success).toHaveBeenCalledWith('支付成功，积分已到账');
    // fresh=true：绕开 GET 在途去重，否则拿回支付前的旧余额
    expect(authApi.fetchCredits).toHaveBeenCalledWith({ fresh: true });
    expect(setCredits).toHaveBeenCalledWith(1234);
  });

  it('订单过期展示过期态并允许重新支付', async () => {
    rechargeApi.fetchRechargeOrderStatus.mockResolvedValue({
      trade_no: 'trade-1',
      status: 'expired',
      credits_after: null,
    });

    await renderRechargeModal();
    await flush();
    await clickButton('100 积分');
    await clickButton('确认支付 ¥10');
    await flush();

    expect(document.body.textContent).toContain('二维码已过期');
    expect(document.body.textContent).toContain('重新支付');
    expect(setCredits).not.toHaveBeenCalled();
  });

  it('下单失败就地提示且不出二维码', async () => {
    rechargeApi.createRechargeOrder.mockRejectedValue(new Error('该档位已下架'));
    await renderRechargeModal();
    await flush();
    await clickButton('100 积分');
    await clickButton('确认支付 ¥10');
    await flush();

    expect(document.body.textContent).toContain('该档位已下架');
    expect(document.body.textContent).not.toContain('等待支付结果...');
    // 错误由组件就地展示，http 层已 silent，不重复 toast
    expect(toastApi.error).not.toHaveBeenCalled();
  });

  it('等待支付时关闭弹窗会补拉一次余额', async () => {
    await renderRechargeModal();
    await flush();
    await clickButton('100 积分');
    await clickButton('确认支付 ¥10');
    await flush();

    // 关弹窗不撤单（网关侧没有关单接口），但用户可能刚付掉，余额要补一次
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')?.click();
      await Promise.resolve();
    });

    expect(onClose).toHaveBeenCalled();
    expect(authApi.fetchCredits).toHaveBeenCalledWith({ fresh: true });
  });

  it('《充值协议》在新标签打开静态站协议页', async () => {
    await renderRechargeModal();

    const link = [...document.body.querySelectorAll('a')].find((anchor) =>
      anchor.textContent?.includes('充值协议'),
    );
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe(
      'https://static-bluewhale.yunjizi.cn/agreement/recharge-agreement.html',
    );
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.rel.split(' ')).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
  });
});
