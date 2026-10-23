// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RechargeModal from './index';
import styles from './index.module.css';

const rechargeApi = vi.hoisted(() => ({
  createRechargeOrder: vi.fn(),
  createCustomRechargeOrder: vi.fn(),
  fetchRechargeOrderStatus: vi.fn(),
  fetchRechargeTierCatalog: vi.fn(),
  fetchRechargeCustomConfig: vi.fn(),
}));

const authApi = vi.hoisted(() => ({ fetchCredits: vi.fn() }));

const setUsage = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
  credits: 500 as number | null,
  user: { userId: 1 } as { userId: number } | null,
}));

const toastApi = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('@/custom/api/recharge', () => rechargeApi);
vi.mock('@/custom/api/auth', () => authApi);
vi.mock('@/shared/stores/auth', () => {
  const store = Object.assign(
    <T,>(selector: (state: { credits: number | null; user: { userId: number } | null }) => T) =>
      selector({ credits: authState.credits, user: authState.user }),
    { getState: () => ({ setUsage }) },
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
  authState.credits = 500;
  authState.user = { userId: 1 };
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
        can_purchase: true,
        denied_hint: '当前账号暂不可购买该档位',
        credits_valid_months: 24,
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
  rechargeApi.createCustomRechargeOrder.mockResolvedValue({
    trade_no: 'trade-custom-1',
    qr_code_url: 'https://example.com/cashier-custom',
    expire_time: '2026-08-28T12:00:00+08:00',
    amount: 40,
    points: 600,
  });
  rechargeApi.fetchRechargeCustomConfig.mockResolvedValue({
    enabled: true,
    min_credits: 600,
    max_credits: 499_995,
    default_credits: 600,
    step_credits: 15,
    credits_per_yuan: 15,
    credits_valid_months: 24,
    can_purchase: true,
    denied_hint: '当前账号暂不可购买自定义充值',
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
  it('以 Portal 渲染并展示后端返回的档位与到账规则', async () => {
    await renderRechargeModal();
    await flush();

    expect(mountNode.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[data-semantic="mask"]')).not.toBeNull();

    expect(document.body.textContent).toContain('积分超市 / 通用积分卡');
    expect(document.body.textContent).toContain('通用积分卡');
    expect(document.body.textContent).toContain('固定积分卡');
    expect(document.body.querySelector('[role="tab"]')).toBeNull();
    expect(document.body.textContent).toContain('到账积分与有效期以各档位标注为准');
    expect(document.body.textContent).not.toContain('积分自到账起');
    expect(document.body.textContent).not.toContain('永久有效');
    expect(document.body.querySelector('[aria-label="固定积分卡"]')?.textContent).not.toContain('1 元 =');
    expect(document.body.textContent).toContain('有效期 2 年');
    expect(document.body.textContent).toContain('100 积分');
    expect(document.body.textContent).toContain('¥10');
    expect(document.body.textContent).not.toContain('登录后可购买全部上架商品');
    expect(document.body.textContent).not.toContain('价格与积分以后台配置为准');
  });

  it('未登录才展示购买说明，已登录不展示右侧说明卡', async () => {
    authState.user = null;
    await renderRechargeModal();
    await flush();

    expect(document.body.textContent).toContain('登录后可购买全部上架商品');
    expect(document.body.textContent).toContain(
      '价格与积分以后台配置为准，下单时冻结快照；配置变更只影响新订单。',
    );
  });

  it('★ 有效期按档位可配：配 6 个月的档位，卡片上出现的是 6 个月而不是 2 年', async () => {
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
          can_purchase: true,
          denied_hint: '当前账号暂不可购买该档位',
          credits_valid_months: 6,
        },
      ],
    });
    await renderRechargeModal();
    await flush();

    expect(document.body.textContent).toContain('有效期 6 个月');
    expect(document.body.querySelector('[aria-label="固定积分卡"]')?.textContent).not.toContain('2 年');
    expect(document.body.textContent).not.toContain('积分自到账起');
  });

  it('★ 有效期逐档各说各的：两张卡各自标自己的月数，不会被同一句话覆盖', async () => {
    rechargeApi.fetchRechargeTierCatalog.mockResolvedValue({
      credits_per_yuan: 10,
      tiers: [
        {
          id: 'short',
          name: '短效套餐',
          amount: 100,
          price: 10,
          original_price: null,
          discount: 1,
          is_recommended: false,
          sort_order: 1,
          can_purchase: true,
          denied_hint: '不可购买',
          credits_valid_months: 6,
        },
        {
          id: 'long',
          name: '长效套餐',
          amount: 200,
          price: 20,
          original_price: null,
          discount: 1,
          is_recommended: false,
          sort_order: 2,
          can_purchase: true,
          denied_hint: '不可购买',
          credits_valid_months: 24,
        },
      ],
    });
    await renderRechargeModal();
    await flush();

    expect(document.body.textContent).toContain('有效期 6 个月');
    expect(document.body.textContent).toContain('有效期 2 年');
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

    await clickButton('立即购买');

    expect(rechargeApi.createRechargeOrder).toHaveBeenCalledWith(TIER_ID);
    expect(document.body.textContent).toContain('等待支付结果...');
    expect(document.body.textContent).toContain('请于十分钟内使用微信 / 支付宝 扫码支付');
    expect(document.body.textContent).toContain('100 积分');
    expect(document.body.textContent).not.toContain('二维码不可用');
    expect(document.body.textContent).not.toContain('取消支付');
  });

  it('轮询到 paid 后显示成功并刷新余额', async () => {
    rechargeApi.fetchRechargeOrderStatus
      .mockResolvedValueOnce({ trade_no: 'trade-1', status: 'pending', credits_after: null })
      .mockResolvedValue({ trade_no: 'trade-1', status: 'paid', credits_after: 1234 });

    await renderRechargeModal();
    await flush();
    vi.useFakeTimers();
    await clickButton('立即购买');
    await flush();
    expect(document.body.textContent).toContain('等待支付结果...');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await flush();

    expect(document.body.textContent).toContain('支付成功');
    expect(document.body.textContent).toContain('+100 积分已到账');
    expect(toastApi.success).toHaveBeenCalledWith('支付成功，积分已到账');
    expect(authApi.fetchCredits).toHaveBeenCalledWith({ fresh: true });
    expect(setUsage).toHaveBeenCalledWith({ credits: 1234 });
  });

  it('★ 钱已收到、积分还在发（paid_pending）：话术换成「发放中」，仍不算成功', async () => {
    rechargeApi.fetchRechargeOrderStatus.mockResolvedValue({
      trade_no: 'trade-1',
      status: 'paid_pending',
      credits_after: null,
    });

    await renderRechargeModal();
    await flush();
    await clickButton('立即购买');
    await flush();

    expect(document.body.textContent).toContain('已收到付款，积分发放中…');
    expect(document.body.textContent).not.toContain('等待支付结果...');
    expect(document.body.textContent).not.toContain('支付成功');
    expect(toastApi.success).not.toHaveBeenCalled();
    expect(setUsage).not.toHaveBeenCalled();
  });

  it('★ 到账异常（grant_failed）：说「发放异常、请联系客服」，不再说「发放中」', async () => {
    rechargeApi.fetchRechargeOrderStatus.mockResolvedValue({
      trade_no: 'trade-1',
      status: 'grant_failed',
      credits_after: null,
    });

    await renderRechargeModal();
    await flush();
    await clickButton('立即购买');
    await flush();

    expect(document.body.textContent).toContain('积分发放异常，请联系客服');
    expect(document.body.textContent).not.toContain('发放中');
    expect(document.body.textContent).not.toContain('支付成功');
    expect(toastApi.success).not.toHaveBeenCalled();
    expect(setUsage).not.toHaveBeenCalled();
    const hints = [...document.body.querySelectorAll('a')].filter((a) =>
      a.textContent?.includes('客服'),
    );
    expect(hints).toHaveLength(0);
  });

  it('★ 发放异常之后又补发成功：话要跟着状态回到「已到账」（它不是一个单向的坏状态）', async () => {
    rechargeApi.fetchRechargeOrderStatus
      .mockResolvedValueOnce({ trade_no: 'trade-1', status: 'grant_failed', credits_after: null })
      .mockResolvedValue({ trade_no: 'trade-1', status: 'paid', credits_after: 1234 });

    await renderRechargeModal();
    await flush();
    vi.useFakeTimers();
    await clickButton('立即购买');
    await flush();
    expect(document.body.textContent).toContain('积分发放异常，请联系客服');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await flush();

    expect(document.body.textContent).toContain('支付成功');
    expect(document.body.textContent).not.toContain('积分发放异常');
  });

  it('★ B-1：下单回来的价与页面上显示的不一致 → 提示「价格已更新」，不让用户自己猜该付哪个数', async () => {
    rechargeApi.createRechargeOrder.mockResolvedValue({
      trade_no: 'trade-1',
      qr_code_url: 'https://example.com/cashier',
      expire_time: '2026-08-28T12:00:00+08:00',
      amount: 12,
      points: 100,
    });

    await renderRechargeModal();
    await flush();
    await clickButton('立即购买');
    await flush();

    expect(document.body.textContent).toContain('价格已更新为 ¥12，请确认后再支付');
    expect(document.body.textContent).toContain('¥12');
  });

  it('B-1：价没变就不提示（正常的下单不该多出一句吓人的话）', async () => {
    await renderRechargeModal();
    await flush();
    await clickButton('立即购买');
    await flush();

    expect(document.body.textContent).not.toContain('价格已更新');
  });

  it('订单过期展示过期态并允许重新支付', async () => {
    rechargeApi.fetchRechargeOrderStatus.mockResolvedValue({
      trade_no: 'trade-1',
      status: 'expired',
      credits_after: null,
    });

    await renderRechargeModal();
    await flush();
    await clickButton('立即购买');
    await flush();

    expect(document.body.textContent).toContain('二维码已过期');
    expect(document.body.textContent).toContain('重新支付');
    expect(setUsage).not.toHaveBeenCalled();
  });

  it('下单失败就地提示且不出二维码', async () => {
    rechargeApi.createRechargeOrder.mockRejectedValue(new Error('该档位已下架'));
    await renderRechargeModal();
    await flush();
    await clickButton('立即购买');
    await flush();

    expect(document.body.textContent).toContain('该档位已下架');
    expect(document.body.textContent).not.toContain('等待支付结果...');
    expect(toastApi.error).not.toHaveBeenCalled();
  });

  it('等待支付时关闭弹窗会补拉一次余额', async () => {
    await renderRechargeModal();
    await flush();
    await clickButton('立即购买');
    await flush();

    await act(async () => {
      const closeButtons = [...document.body.querySelectorAll<HTMLButtonElement>('button[aria-label="关闭"]')];
      closeButtons[closeButtons.length - 1]?.click();
      await Promise.resolve();
    });

    expect(onClose).not.toHaveBeenCalled();
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

describe('RechargeModal — 档位购买权限', () => {
  function deniedCatalog(hint = '该档位仅限内测用户') {
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
          can_purchase: false,
          denied_hint: hint,
          credits_valid_months: 24,
        },
      ],
    });
  }

  it('★ 无权限的档位：置灰不可点、展示后台配的提示，点了也不会下单', async () => {
    deniedCatalog();
    await renderRechargeModal();
    await flush();

    expect(document.body.textContent).toContain('该档位仅限内测用户');
    expect(
      [...document.body.querySelectorAll<HTMLButtonElement>('button')].some(
        (button) => button.textContent === '立即购买',
      ),
    ).toBe(false);

    await clickButton('立即购买');
    expect(rechargeApi.createRechargeOrder).not.toHaveBeenCalled();
  });

  it('★ 无权限时不列权益：这张卡买不了，不该还在推销它', async () => {
    deniedCatalog();
    await renderRechargeModal();
    await flush();

    expect(document.body.textContent).not.toContain('积分即时到账');
  });

  it('★ `can_purchase` 为 null（游客未判定）不是无权限：卡片照常可选可买', async () => {
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
          can_purchase: null,
          denied_hint: '当前账号暂不可购买该档位',
          credits_valid_months: 24,
        },
      ],
    });
    await renderRechargeModal();
    await flush();

    await clickButton('立即购买');

    expect(rechargeApi.createRechargeOrder).toHaveBeenCalledWith(TIER_ID);
  });
});

describe('RechargeModal — 自定义充值', () => {
  it('固定积分卡和自定义充值同屏展示，没有页签', async () => {
    await renderRechargeModal();
    await flush();

    expect(document.body.textContent).toContain('100 积分');
    expect(document.body.textContent).toContain('600 积分');
    expect(document.body.textContent).toContain('¥40');
    expect(document.body.textContent).toContain('立即购买');
    expect(document.body.textContent).not.toContain('确认支付');
    expect(document.body.textContent).toContain('自定义充值');
    expect(document.body.querySelector('[role="tab"]')).toBeNull();
  });

  it('★ 下单只传积分数，成功后复用同一个二维码面板与轮询', async () => {
    await renderRechargeModal();
    await flush();

    await clickButton('¥40 购买');
    await flush();

    expect(rechargeApi.createCustomRechargeOrder).toHaveBeenCalledWith(600);
    expect(rechargeApi.createRechargeOrder).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('等待支付结果...');
    expect(document.body.textContent).toContain('自定义充值 600 积分');
  });

  it('收银台展示倒计时、金额与一次性支付说明', async () => {
    const now = Date.now();
    rechargeApi.createRechargeOrder.mockResolvedValue({
      trade_no: 'trade-1',
      qr_code_url: 'https://example.com/cashier',
      expire_time: new Date(now + 10 * 60 * 1000).toISOString(),
      amount: 10,
      points: 100,
    });

    await renderRechargeModal();
    await flush();
    await clickButton('立即购买');
    await flush();

    expect(document.body.textContent).toContain('请于十分钟内使用微信 / 支付宝 扫码支付');
    expect(document.body.textContent).toContain('¥10');
    expect(document.body.textContent).toContain('本订单为一次性支付，后续不会产生自动代扣');
  });

  it('自定义充值下单失败：就地展示错误，不出二维码', async () => {
    rechargeApi.createCustomRechargeOrder.mockRejectedValue(
      new Error('积分数量须为 15 的整数倍'),
    );
    await renderRechargeModal();
    await flush();

    await clickButton('¥40 购买');
    await flush();

    expect(document.body.textContent).toContain('积分数量须为 15 的整数倍');
    expect(document.body.textContent).not.toContain('等待支付结果...');
  });

  it('★ 支付进行中锁住另一条购买路径：不允许同时开出两张待付订单', async () => {
    await renderRechargeModal();
    await flush();
    await clickButton('¥40 购买');
    await flush();

    const tierCard = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent === '立即购买',
    );
    const customBuy = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.includes('¥40 购买'),
    );
    const slider = document.body.querySelector<HTMLInputElement>('input[type="range"]');
    expect(tierCard?.disabled).toBe(true);
    expect(customBuy?.disabled).toBe(true);
    expect(slider?.disabled).toBe(true);
    expect(document.body.querySelector('[role="tab"]')).toBeNull();
  });

  it('★ 后台关掉自定义充值：入口与面板都不出现（点开是空白的页签比没有更糟）', async () => {
    rechargeApi.fetchRechargeCustomConfig.mockResolvedValue({
      enabled: false,
      min_credits: 600,
      max_credits: 499_995,
      default_credits: 600,
      step_credits: 15,
      credits_per_yuan: 15,
      credits_valid_months: 24,
      can_purchase: true,
      denied_hint: '当前账号暂不可购买自定义充值',
    });
    await renderRechargeModal();
    await flush();

    expect(document.body.querySelector('[role="tab"]')).toBeNull();
    expect(document.body.textContent).not.toContain('自定义充值');
    expect(document.body.textContent).toContain('100 积分');
    expect(document.body.textContent).toContain('固定积分卡');
  });

  it('卡片不展示档位名称、原价和折扣，推荐与选中各自可辨', async () => {
    rechargeApi.fetchRechargeTierCatalog.mockResolvedValue({
      credits_per_yuan: 10,
      tiers: [
        {
          id: 'plain',
          name: '入门档',
          amount: 100,
          price: 10,
          original_price: 12,
          discount: 0.8,
          is_recommended: false,
          sort_order: 1,
          can_purchase: true,
          denied_hint: '不可购买',
          credits_valid_months: 24,
        },
        {
          id: 'hot',
          name: '进阶档',
          amount: 200,
          price: 20,
          original_price: 30,
          discount: 0.8,
          is_recommended: true,
          sort_order: 2,
          can_purchase: true,
          denied_hint: '不可购买',
          credits_valid_months: 24,
        },
      ],
    });
    await renderRechargeModal();
    await flush();

    expect(document.body.textContent).not.toContain('入门档');
    expect(document.body.textContent).not.toContain('进阶档');
    expect(document.body.textContent).not.toContain('原价');
    expect(document.body.textContent).not.toContain('现价');

    const recommended = [...document.body.querySelectorAll('article')].find((card) =>
      card.textContent?.includes('200'),
    );
    expect(recommended?.textContent).toContain('推荐');
    expect(recommended?.classList.contains(styles.planRecommended)).toBe(true);
    expect(recommended?.textContent).toContain('立即购买');

    const plain = [...document.body.querySelectorAll('article')].find((card) =>
      card.textContent?.includes('100'),
    );
    expect(plain?.textContent).not.toContain('推荐');
    expect(plain?.classList.contains(styles.planRecommended)).toBe(false);
    expect(plain?.textContent).toContain('立即购买');
  });
});
