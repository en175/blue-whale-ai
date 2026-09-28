// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from './index';

const api = vi.hoisted(() => ({ fetchAdminDashboard: vi.fn() }));

vi.mock('@/api/adminDashboard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/adminDashboard')>();
  return {
    ...actual,
    fetchAdminDashboard: api.fetchAdminDashboard,
    adminDashboardOptions: (range: import('@/api/adminDashboard').DashboardRangeQuery) => ({
      queryKey: actual.adminDashboardKeys.stats(range),
      queryFn: () => api.fetchAdminDashboard(range),
    }),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let mountNode: HTMLDivElement;

const STATS = {
  from: '2026-09-25',
  to: '2026-09-25',
  totalUsers: 1234,
  totalJobs: 280,
  totalUsedCredits: 43_210,
  totalRechargeCredits: 5_000_000,
  totalRevenueFen: 1_000_000,
  jobTypeCounts: [
    { type: 'video', count: 120 },
    { type: 'image', count: 100 },
    { type: 'audio', count: 60 },
  ],
};

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

async function waitUntilLoaded() {
  for (let i = 0; i < 25; i += 1) {
    if (!document.body.textContent?.includes('加载中…')) return;
    await settle();
  }
  throw new Error(`页面仍在加载: ${document.body.textContent}`);
}

async function renderPage() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(withQuery(createElement(Dashboard)));
  });
  await waitUntilLoaded();
}

function input(label: string): HTMLInputElement {
  const found = document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!found) throw new Error(`没有找到输入框：${label}`);
  return found;
}

function button(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`没有找到按钮：${label}`);
  return found;
}

/** 日期输入框是受控的：要绕过 React 的 value setter 才能触发 onChange。 */
async function setDate(label: string, value: string) {
  const el = input(label);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(label: string) {
  await act(async () => button(label).click());
  await settle();
}

beforeEach(() => {
  notifyManager.setScheduler((cb) => cb());
  api.fetchAdminDashboard.mockResolvedValue(STATS);
});

afterEach(async () => {
  notifyManager.setScheduler((cb) => {
    setTimeout(cb, 0);
  });
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('Dashboard 仪表盘（按区间统计）', () => {
  it('首次加载默认查**今天**，区间两端都是当天', async () => {
    await renderPage();

    expect(api.fetchAdminDashboard).toHaveBeenCalledTimes(1);
    const range = api.fetchAdminDashboard.mock.calls[0]?.[0];
    // 今天按**北京时间**算：用 toISOString().slice(0,10) 在 UTC 机器上
    // 会在北京时间 00:00–08:00 之间退回前一天
    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    expect(range).toEqual({ from: today, to: today });
    expect(input('起始日期').value).toBe(today);
    expect(input('结束日期').value).toBe(today);
  });

  it('渲染五个指标，含单位含义（人数 / 任务 / 积分 / 元）', async () => {
    await renderPage();

    const text = document.body.textContent ?? '';
    expect(text).toContain('总用户');
    expect(text).toContain('1,234 人');
    expect(text).toContain('任务数');
    expect(text).toContain('280 个');
    expect(text).toContain('总使用积分');
    expect(text).toContain('43,210 分');
    expect(text).toContain('总充值积分');
    expect(text).toContain('5,000,000 分');
    expect(text).toContain('总收入金额');
    // 后端给的是**分**，展示换成元 —— 1000000 分 = 10000.00 元
    expect(text).toContain('10,000.00');
  });

  it('★ 总使用积分取不到时显示「—」并说明原因，**不显示 0**', async () => {
    api.fetchAdminDashboard.mockResolvedValue({ ...STATS, totalUsedCredits: null });

    await renderPage();

    const text = document.body.textContent ?? '';
    // 0 的意思是「这段时间确实没人消费」；取不到时我们并不知道消费了多少
    expect(text).toContain('—');
    expect(text).toContain('计费服务当前不可用');
    expect(text).toContain('不代表这段时间没有消费');
  });

  it('任务类型用中文名 + 数量 + 占比，分母是**区间任务总数**', async () => {
    await renderPage();

    const text = document.body.textContent ?? '';
    // 中文名不是 video_subtitle_erase 那种原始 key
    expect(text).toContain('视频');
    expect(text).toContain('图片');
    expect(text).toContain('音频');
    expect(text).not.toContain('video_subtitle_erase');
    // 120/280 = 42.9%，100/280 = 35.7%，60/280 = 21.4%（分母是区间总数 280，不是全表）
    expect(text).toContain('42.9%');
    expect(text).toContain('35.7%');
    expect(text).toContain('21.4%');
  });

  it('空区间显示空态，不出现 NaN / Infinity', async () => {
    api.fetchAdminDashboard.mockResolvedValue({
      ...STATS,
      totalJobs: 0,
      jobTypeCounts: [],
    });

    await renderPage();

    const text = document.body.textContent ?? '';
    expect(text).toContain('这段时间没有任务');
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('Infinity');
  });

  it('★ 超过 30 天：当场给出提示并禁用「查询」，**一个请求都不发**', async () => {
    await renderPage();
    expect(api.fetchAdminDashboard).toHaveBeenCalledTimes(1);

    await setDate('起始日期', '2026-08-01');
    await setDate('结束日期', '2026-09-25'); // 56 天

    expect(document.body.textContent).toContain('最多 30 天');
    expect(button('查询').disabled).toBe(true);
    // 禁用还不够：真点下去也不该发请求（后端才是权威，但前端不该白等一次往返）
    await click('查询');
    expect(api.fetchAdminDashboard).toHaveBeenCalledTimes(1);
  });

  it('正好 30 天可以查，且把新区间带给后端', async () => {
    await renderPage();

    await setDate('起始日期', '2026-08-27');
    await setDate('结束日期', '2026-09-25'); // 含首尾 30 天

    expect(button('查询').disabled).toBe(false);
    await click('查询');

    expect(api.fetchAdminDashboard).toHaveBeenCalledTimes(2);
    expect(api.fetchAdminDashboard.mock.calls[1]?.[0]).toEqual({
      from: '2026-08-27',
      to: '2026-09-25',
    });
  });

  it('起始晚于结束时给出提示并禁用查询', async () => {
    await renderPage();

    await setDate('起始日期', '2026-09-25');
    await setDate('结束日期', '2026-09-01');

    expect(document.body.textContent).toContain('起始日期不能晚于结束日期');
    expect(button('查询').disabled).toBe(true);
  });

  it('「今天」按钮把区间复位成今天（北京时间）', async () => {
    await renderPage();

    await setDate('起始日期', '2026-09-01');
    await click('今天');

    const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    expect(input('起始日期').value).toBe(today);
    expect(input('结束日期').value).toBe(today);
  });

  it('加载失败给出重试入口，重试会重新发请求', async () => {
    api.fetchAdminDashboard.mockRejectedValueOnce(new Error('boom'));

    await renderPage();
    expect(document.body.textContent).toContain('获取仪表盘数据失败');

    await click('重试');
    expect(api.fetchAdminDashboard).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('任务数');
  });
});
