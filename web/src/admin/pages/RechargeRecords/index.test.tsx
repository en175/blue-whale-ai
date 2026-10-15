// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/http';
import RechargeRecords from './index';


const api = vi.hoisted(() => ({ fetchRecords: vi.fn(), retryGrant: vi.fn() }));

vi.mock('@/admin/api/adminRechargeRecords', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/admin/api/adminRechargeRecords')>();
  return {
    ...actual,
    adminRechargeRecordsOptions: (query: unknown) => ({
      queryKey: actual.adminRechargeRecordKeys.list(query as never),
      queryFn: () => api.fetchRecords(query),
    }),
    retryAdminRechargeGrant: api.retryGrant,
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ROWS = [
  'pending',
  'paid_pending',
  'paid',
  'expired',
  'failed',
  'grant_failed',
].map((status, index) => ({
  tradeNo: `trade-${index}`,
  payOrderId: null,
  userId: String(9000 + index),
  tierId: null,
  productType: 'custom',
  productName: '自定义充值',
  amountFen: 4000,
  credits: 600,
  creditsPerYuan: 15,
  status,
  paidAt: null,
  notifyCount: 0,
  createdAt: '2026-09-27T10:00:00+08:00',
  bonusCredits: 0,
  firstPurchaseEligible: 0,
  firstPurchaseState: 'unknown',
}));

function withBonus(patch: Record<string, unknown>) {
  return {
    ...ROWS[0]!,
    firstPurchaseEligible: 1,
    bonusCredits: 1_000,
    firstPurchaseState: 'unknown',
    ...patch,
  };
}

let root: Root;
let mountNode: HTMLDivElement;

function withQuery(node: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, node);
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderPage() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(withQuery(createElement(RechargeRecords)));
  });
  await settle();
}

async function openStatusFilter(): Promise<string[]> {
  const trigger = document.body.querySelector<HTMLElement>('[aria-label="订单状态"]');
  if (!trigger) throw new Error('没有找到状态筛选');
  await act(async () => {
    trigger.click();
  });
  await settle();
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')].map(
    (o) => o.textContent ?? '',
  );
}

beforeEach(() => {
  notifyManager.setScheduler((cb) => cb());
  api.fetchRecords.mockResolvedValue({ list: ROWS, total: ROWS.length });
});

afterEach(async () => {
  notifyManager.setScheduler((cb) => {
    setTimeout(cb, 0);
  });
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('充值记录页 — 六个状态', () => {
  it('★ 六个状态各有中文名，没有一行是空白徽标', async () => {
    await renderPage();

    expect(document.body.textContent).toContain('待支付');
    expect(document.body.textContent).toContain('支付成功待到账');
    expect(document.body.textContent).toContain('已到账');
    expect(document.body.textContent).toContain('已过期');
    expect(document.body.textContent).toContain('支付失败');
    expect(document.body.textContent).toContain('到账异常');

    const badges = [...document.body.querySelectorAll('tbody td span')].filter(
      (el) => el.className.includes('badge') || el.className.includes('Badge'),
    );
    expect(badges.length).toBeGreaterThanOrEqual(ROWS.length);
    expect(badges.every((b) => (b.textContent ?? '').trim().length > 0)).toBe(true);
  });

  it('★ 筛选下拉能选到新增的两个状态（选不到 = 那类单查不出来）', async () => {
    await renderPage();

    const options = await openStatusFilter();

    expect(options).toContain('支付成功待到账');
    expect(options).toContain('到账异常');
    expect(options).toContain('全部状态');
  });
});

async function clickRowButton(tradeNo: string, label: string) {
  const row = [...document.body.querySelectorAll<HTMLTableRowElement>('tbody tr')].find(
    (tr) => tr.textContent?.includes(tradeNo),
  );
  const button = [...(row?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) =>
    b.textContent?.includes(label),
  );
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  await settle();
}

describe('充值记录页 — 赠送积分列', () => {
  it('★ 三种结果各自有说法，没赠送显示「—」而不是 0', async () => {
    api.fetchRecords.mockResolvedValue({
      list: [
        withBonus({ tradeNo: 'g-first', firstPurchaseState: 'first' }),
        withBonus({ tradeNo: 'g-repeat', firstPurchaseState: 'repeat' }),
        withBonus({ tradeNo: 'g-unknown', firstPurchaseState: 'unknown' }),
        { ...ROWS[0]!, tradeNo: 'g-ineligible' },
        withBonus({ tradeNo: 'g-zero', bonusCredits: 0 }),
      ],
      total: 5,
    });
    await renderPage();

    const text = document.body.textContent ?? '';
    expect(text).toContain('+1,000 已发');
    expect(text).toContain('1,000 未发 · 该档位已用过');
    expect(text).toContain('1,000 未判定');
    const bonusCells = [...document.body.querySelectorAll('tbody tr')].map(
      (tr) => tr.querySelectorAll('td')[5]?.textContent ?? '',
    );
    expect(bonusCells.filter((text) => text === '—')).toHaveLength(2);
    expect(bonusCells.filter((text) => text.includes('已发'))).toHaveLength(1);
    expect(bonusCells.some((text) => /^\+?0\b/.test(text))).toBe(false);
  });

  it('未到账的单（还没走发放）显示「未判定」，不显示「已发」', async () => {
    api.fetchRecords.mockResolvedValue({
      list: [withBonus({ tradeNo: 'g-pending', status: 'pending' })],
      total: 1,
    });
    await renderPage();

    const text = document.body.textContent ?? '';
    expect(text).toContain('1,000 未判定');
    expect(text).not.toContain('已发');
  });
});

describe('充值记录页 — 人工补发（E-1 的那条出口）', () => {
  it('★ 只有「钱收了、积分没发出去」两种状态才有重试按钮', async () => {
    await renderPage();

    const rowTrades = [...document.body.querySelectorAll<HTMLTableRowElement>('tbody tr')].map(
      (tr) => tr.textContent ?? '',
    );
    const withButton = rowTrades.filter((text) => text.includes('重试发放'));
    expect(withButton).toHaveLength(2);
    expect(withButton[0]).toContain('trade-1');
    expect(withButton[1]).toContain('trade-5');
  });

  it('★ 点一下真的发补发请求，并把成功的结果写在页面上', async () => {
    api.retryGrant.mockResolvedValue({ tradeNo: 'trade-5', status: 'paid' });
    await renderPage();

    await clickRowButton('trade-5', '重试发放');

    expect(api.retryGrant).toHaveBeenCalledWith('trade-5');
    expect(document.body.textContent).toContain('补发成功，积分已到账');
  });

  it('★ 补发后仍是 paid_pending：如实说「仍停在…需继续排查」，不写成成功', async () => {
    api.retryGrant.mockResolvedValue({ tradeNo: 'trade-1', status: 'paid_pending' });
    await renderPage();

    await clickRowButton('trade-1', '重试发放');

    expect(document.body.textContent).toContain('支付成功待到账');
    expect(document.body.textContent).toContain('需继续排查');
    expect(document.body.textContent).not.toContain('补发成功');
  });

  it('补发失败：就地展示服务端给的原因（后端文案原样呈现）', async () => {
    api.retryGrant.mockRejectedValue(new ApiError(400, '该订单尚未收到款项'));
    await renderPage();

    await clickRowButton('trade-1', '重试发放');

    expect(document.body.textContent).toContain('该订单尚未收到款项');
  });
});

describe('充值记录页 — 哨兵口径', () => {
  it('★ 首次查询**不带** status —— 哨兵漏下去会把列表静默过滤成空', async () => {
    await renderPage();

    expect(api.fetchRecords).toHaveBeenCalled();
    const first = api.fetchRecords.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(first).not.toHaveProperty('status');
  });
});

describe('充值记录页 — 用户列', () => {
  function headers(): string[] {
    return [...document.body.querySelectorAll('th')].map((th) => th.textContent?.trim() ?? '');
  }

  it('列头是「用户名」「手机号」，不再有「用户 ID」列', async () => {
    await renderPage();

    expect(headers()).toContain('用户名');
    expect(headers()).toContain('手机号');
    expect(headers()).not.toContain('用户 ID');
  });

  it('用户名与手机号来自 BFF 回填，直接渲染在行里', async () => {
    api.fetchRecords.mockResolvedValue({
      list: [{ ...ROWS[0]!, nickname: '张小明', phone: '13800008888' }],
      total: 1,
    });
    await renderPage();

    expect(document.body.textContent).toContain('张小明');
    expect(document.body.textContent).toContain('13800008888');
  });

  it('★ 用户 ID 一个都不露 —— 既不在列里，也不藏在悬停 / 提示里', async () => {
    await renderPage();

    expect(document.body.textContent).not.toContain('9000');
    expect(document.body.querySelector('button[aria-label="用户明细"]')).toBeNull();
  });

  it('查不到用户（两个字段都是 null）→ 显示「—」', async () => {
    api.fetchRecords.mockResolvedValue({
      list: [{ ...ROWS[0]!, nickname: null, phone: null }],
      total: 1,
    });
    await renderPage();

    const cells = [...(document.body.querySelector('tbody tr')?.querySelectorAll('td') ?? [])].map(
      (td) => td.textContent?.trim() ?? '',
    );
    expect(cells[1]).toBe('—');
    expect(cells[2]).toBe('—');
  });

  it('后端比前端旧、**整个键都不回**时同样显示「—」，不崩', async () => {
    await renderPage();

    const cells = [...(document.body.querySelector('tbody tr')?.querySelectorAll('td') ?? [])].map(
      (td) => td.textContent?.trim() ?? '',
    );
    expect(cells[1]).toBe('—');
    expect(cells[2]).toBe('—');
    expect(document.body.textContent).not.toContain('Unexpected Application Error');
  });
});
