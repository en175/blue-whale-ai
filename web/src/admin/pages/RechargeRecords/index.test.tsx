// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/http';
import RechargeRecords from './index';

// 充值记录页：钉住**六个状态都看得见**这一条。
// 状态机 2026-09-26 由 4 态扩到 6 态，而本页的状态列走的是 `STATUS_LABELS[row.status]` ——
// 少写一种，那一行的徽标就是**一片空白**，且不报任何错。

const api = vi.hoisted(() => ({ fetchRecords: vi.fn(), retryGrant: vi.fn() }));

vi.mock('@/api/adminRechargeRecords', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/adminRechargeRecords')>();
  return {
    ...actual,
    adminRechargeRecordsOptions: (query: unknown) => ({
      queryKey: actual.adminRechargeRecordKeys.list(query as never),
      queryFn: api.fetchRecords,
    }),
    retryAdminRechargeGrant: api.retryGrant,
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** 六个状态各一行（`status` 逐字对应后端白名单） */
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
  grantLotId: null,
  notifyCount: 0,
  createdAt: '2026-09-27T10:00:00+08:00',
}));

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

/** 点开自绘 Select（不是原生控件），返回候选文案 */
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
    // 钱收到了、积分没发出去：运营最需要一眼看见的那一类
    expect(document.body.textContent).toContain('支付成功待到账');
    expect(document.body.textContent).toContain('已到账');
    expect(document.body.textContent).toContain('已过期');
    expect(document.body.textContent).toContain('支付失败');
    expect(document.body.textContent).toContain('到账异常');

    // 六个徽标都渲染出了文字（空白徽标 = 一行状态列什么都没有）
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

/** 点某一行上的按钮（按文字找） */
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

describe('充值记录页 — 人工补发（E-1 的那条出口）', () => {
  it('★ 只有「钱收了、积分没发出去」两种状态才有重试按钮', async () => {
    // 给每一行都摆一个按钮是错的：对 pending 点它等于无中生有地发积分，
    // 对 paid 点它是纯噪声。判据必须与后端那道闸一致，否则运营撞上一次 400
    await renderPage();

    const rowTrades = [...document.body.querySelectorAll<HTMLTableRowElement>('tbody tr')].map(
      (tr) => tr.textContent ?? '',
    );
    // ROWS 的顺序：pending / paid_pending / paid / expired / failed / grant_failed
    const withButton = rowTrades.filter((text) => text.includes('重试发放'));
    expect(withButton).toHaveLength(2);
    expect(withButton[0]).toContain('trade-1'); // paid_pending
    expect(withButton[1]).toContain('trade-5'); // grant_failed
  });

  it('★ 点一下真的发补发请求，并把成功的结果写在页面上', async () => {
    api.retryGrant.mockResolvedValue({ tradeNo: 'trade-5', status: 'paid' });
    await renderPage();

    await clickRowButton('trade-5', '重试发放');

    expect(api.retryGrant).toHaveBeenCalledWith('trade-5');
    expect(document.body.textContent).toContain('补发成功，积分已到账');
  });

  it('★ 补发后仍是 paid_pending：如实说「仍停在…需继续排查」，不写成成功', async () => {
    // 服务端回的是**回读后的真实状态**，不是「我以为成功了」。
    // 把没成的也写成成功，运营就会以为这笔已经处理完了
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
