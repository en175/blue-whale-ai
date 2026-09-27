// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RechargeModal from './index';

const rechargeApi = vi.hoisted(() => ({
  createRechargeOrder: vi.fn(),
  createCustomRechargeOrder: vi.fn(),
  fetchRechargeOrderStatus: vi.fn(),
  fetchRechargeTierCatalog: vi.fn(),
  fetchRechargeCustomConfig: vi.fn(),
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
        // 权限信号由服务端算（`canPurchaseTier`）：默认「全部登录用户」可买
        can_purchase: true,
        denied_hint: '当前账号暂不可购买该档位',
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

    // 到账积分只说「以各档位标注为准」：它现在是后台配置值，与定价目录那条消费锚点不成比例
    expect(document.body.textContent).toContain('到账积分以各档位标注为准');
    // 有效期是充值本金的真实策略（2 年），不是原来的「永久有效」那句假话
    expect(document.body.textContent).toContain('积分自到账起 2 年内有效');
    expect(document.body.textContent).not.toContain('永久有效');
    expect(document.body.textContent).not.toContain('1 元 =');
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

  it('★ 钱已收到、积分还在发（paid_pending）：话术换成「发放中」，仍不算成功', async () => {
    // 钱已经付了，此刻说「等待支付结果…」是在让用户怀疑自己没付成功；
    // 但也不能报成功（积分还没到账）—— 两种都不是，就如实说「发放中」
    rechargeApi.fetchRechargeOrderStatus.mockResolvedValue({
      trade_no: 'trade-1',
      status: 'paid_pending',
      credits_after: null,
    });

    await renderRechargeModal();
    await flush();
    await clickButton('100 积分');
    await clickButton('确认支付 ¥10');
    await flush();

    expect(document.body.textContent).toContain('已收到付款，积分发放中…');
    expect(document.body.textContent).not.toContain('等待支付结果...');
    expect(document.body.textContent).not.toContain('支付成功');
    expect(toastApi.success).not.toHaveBeenCalled();
    expect(setCredits).not.toHaveBeenCalled();
  });

  it('订单过期展示过期态并允许重新支付', async () => {    rechargeApi.fetchRechargeOrderStatus.mockResolvedValue({
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

// 档位购买权限（PRD §6.3）：无权限的卡片置灰 + 展示后台配的提示，与自定义充值面板同一套做法
describe('RechargeModal — 档位购买权限', () => {
  /** 让目录只返回一张「当前用户买不了」的档位卡 */
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
        },
      ],
    });
  }

  it('★ 无权限的档位：置灰不可点、展示后台配的提示，点了也不会下单', async () => {
    deniedCatalog();
    await renderRechargeModal();
    await flush();

    // 卡片是禁用的（`disabled` 是给键盘/鼠标两层都拦住的），并带上提示文案
    const card = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (button) => button.textContent?.includes('100 积分'),
    );
    expect(card?.disabled).toBe(true);
    expect(document.body.textContent).toContain('该档位仅限内测用户');

    // 点也点不动：不会选中、底部不会出现「确认支付 ¥10」
    await clickButton('100 积分');
    expect(document.body.textContent).not.toContain('确认支付 ¥10');
    expect(rechargeApi.createRechargeOrder).not.toHaveBeenCalled();
  });

  it('★ 无权限时不列权益：这张卡买不了，不该还在推销它', async () => {
    deniedCatalog();
    await renderRechargeModal();
    await flush();

    expect(document.body.textContent).not.toContain('积分即时到账');
  });

  it('★ `can_purchase` 为 null（游客未判定）不是无权限：卡片照常可选可买', async () => {
    // null 是「不知道你是谁」，不是「你不能买」—— 价格表本来就该看得见，
    // 把它当成 false 会让一张公开价目表变成一排灰卡片
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
        },
      ],
    });
    await renderRechargeModal();
    await flush();

    await clickButton('100 积分');
    await clickButton('确认支付 ¥10');

    expect(rechargeApi.createRechargeOrder).toHaveBeenCalledWith(TIER_ID);
  });
});

// 自定义充值（模块 B）：与固定积分卡并列，共用同一条支付链路
describe('RechargeModal — 自定义充值', () => {
  /** 切到自定义充值页签并等面板把配置拉回来 */
  async function switchToCustom() {
    await clickButton('自定义充值');
    await flush();
  }

  it('★ 两种方式并列：默认仍是固定积分卡，切过去才换成自定义面板', async () => {
    await renderRechargeModal();
    await flush();

    // 默认落在固定积分卡：既有路径一个像素都不变
    expect(document.body.textContent).toContain('100 积分');
    expect(document.body.textContent).not.toContain('600 积分');

    await switchToCustom();

    // 面板按后台配置给出默认值 600 积分 / ¥40（1 元 = 15 积分）
    expect(document.body.textContent).toContain('600 积分');
    expect(document.body.textContent).toContain('¥40');
    // 面板自带价格与购买按钮，此时不再渲染档位与底部结算栏（两处各写一次价格会互相打架）
    expect(document.body.textContent).not.toContain('100 积分');
    expect(document.body.textContent).not.toContain('确认支付');
  });

  it('★ 下单只传积分数，成功后复用同一个二维码面板与轮询', async () => {
    await renderRechargeModal();
    await flush();
    await switchToCustom();

    await clickButton('¥40 购买');
    await flush();

    // 传的是积分，不是价格：价格一律服务端按当前配置算
    expect(rechargeApi.createCustomRechargeOrder).toHaveBeenCalledWith(600);
    expect(rechargeApi.createRechargeOrder).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('等待支付结果...');
    expect(document.body.textContent).toContain('获得 600 积分');
  });

  it('自定义充值下单失败：就地展示错误，不出二维码', async () => {
    rechargeApi.createCustomRechargeOrder.mockRejectedValue(
      new Error('积分数量须为 15 的整数倍'),
    );
    await renderRechargeModal();
    await flush();
    await switchToCustom();

    await clickButton('¥40 购买');
    await flush();

    expect(document.body.textContent).toContain('积分数量须为 15 的整数倍');
    expect(document.body.textContent).not.toContain('等待支付结果...');
  });

  it('★ 支付进行中锁住页签：不允许同时开出两张待付订单', async () => {
    await renderRechargeModal();
    await flush();
    await switchToCustom();
    await clickButton('¥40 购买');
    await flush();

    const tabs = [...document.body.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs).toHaveLength(2);
    expect(tabs.every((tab) => tab.disabled)).toBe(true);
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

    // 只剩一种方式：连切换器都不渲染（「选方式」是废话）
    expect(document.body.querySelector('[role="tab"]')).toBeNull();
    expect(document.body.textContent).not.toContain('自定义充值');
    // 固定积分卡照旧
    expect(document.body.textContent).toContain('100 积分');
  });
});
