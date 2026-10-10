// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AccountCredits from './index';
import { formatBeijingDateTime } from './format';

let root: Root;
let mountNode: HTMLDivElement;

const PAGES: Record<string, unknown> = {
  '/api/usage/token': {
    code: 200,
    data: {
      credits: 12345,
      expiring: [{ credits: 1200, expires_at: '2026-12-01T00:00:00+08:00', source: 'purchased' }],
    },
  },
  '/api/account/credit-lots': {
    code: 200,
    data: {
      total: 1,
      items: [
        {
          lot_id: 'lot:1',
          source: 'purchased',
          amount: 600,
          remaining: 600,
          created_at: '2026-09-29T14:33:00+08:00',
          expires_at: '2028-09-29T00:00:00+08:00',
          detail: '自定义充值 · 600 积分，充值积分：600',
        },
      ],
    },
  },
  '/api/account/consumptions': {
    code: 200,
    data: {
      total: 1,
      items: [
        {
          id: 'led:1',
          type: 'consume',
          direction: 'out',
          title: '',
          credits: 40,
          status: 'done',
          created_at: '2026-10-08T15:02:00+08:00',
          settled_at: '2026-10-08T15:02:31+08:00',
          job_id: '9104',
          task_type: 'video',
          model_id: 'seedance-2.5',
          model_label: 'Seedance 2.5',
          prompt: '一只猫在跑',
          detail: '1080p · 5s',
        },
      ],
    },
  },
  '/api/account/orders': {
    code: 200,
    data: {
      total: 1,
      items: [
        {
          trade_no: 'BW20260929143200801',
          product_name: '自定义充值 · 600 积分',
          product_type: 'custom',
          amount_fen: 4000,
          credits: 600,
          bonus_credits: 0,
          status: 'paid_pending',
          created_at: '2026-09-29T14:32:00+08:00',
          paid_at: '2026-09-29T14:32:41+08:00',
          credits_valid_months: 24,
        },
      ],
    },
  },
};

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const raw = typeof input === 'string' ? input : input.toString();
    if (raw.startsWith('/api/account/export')) {
      return new Response(new Blob(['xlsx']), {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      });
    }
    const key = Object.keys(PAGES).find((k) => raw.startsWith(k));
    const body = key ? PAGES[key] : { code: 404, data: null, msg: 'not found' };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

async function renderPage() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          MemoryRouter,
          { initialEntries: ['/account/credits'] },
          createElement(AccountCredits),
        ),
      ),
    );
  });
  await flush();
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function clickByText(text: string) {
  const button = [...document.body.querySelectorAll('button')].find((node) => node.textContent === text);
  button?.click();
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => undefined) } });
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:stub'),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal('fetch', mockFetch());
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  vi.unstubAllGlobals();
});

describe('AccountCredits', () => {
  it('顶部只保留当前积分余额一个卡片', async () => {
    await renderPage();
    expect(document.body.textContent).toContain('账户积分与订单');
    expect(document.body.textContent).toContain('当前积分余额');
    expect(document.body.textContent).toContain('12,345');
    expect(document.body.textContent).not.toContain('积分有效期');
    expect(document.body.textContent).not.toContain('最近到期批次');
  });

  it('去掉「一个业务动作一行」冗余说明', async () => {
    await renderPage();
    expect(document.body.textContent).not.toContain('一个业务动作一行');
  });

  it('只保留已获取/已消耗两个子页签', async () => {
    await renderPage();
    expect(document.body.textContent).toContain('已获取');
    expect(document.body.textContent).toContain('已消耗');
    expect(document.body.textContent).not.toContain('已退回');
  });

  it('已获取用 source 文案映射展示获取来源，获取详情原样渲染后端拼好的整串', async () => {
    await renderPage();
    expect(document.body.textContent).toContain('充值到账');
    expect(document.body.textContent).toContain('+600');
    expect(document.body.textContent).toContain('2026-09-29 14:33:00');
    expect(document.body.textContent).toContain('自定义充值 · 600 积分，充值积分：600');
  });

  it('已消耗展示任务类型中文名与规格', async () => {
    await renderPage();
    await act(async () => {
      clickByText('已消耗');
    });
    await flush();
    expect(document.body.textContent).toContain('视频');
    expect(document.body.textContent).toContain('1080p · 5s');
    expect(document.body.textContent).toContain('Seedance 2.5');
    expect(document.body.textContent).not.toContain('任务 ID');
  });

  it('订单记录：六态含支付成功待到账，金额分换算，可复制订单号', async () => {
    await renderPage();
    await act(async () => {
      clickByText('订单记录');
    });
    await flush();
    expect(document.body.textContent).toContain('支付成功待到账');
    expect(document.body.textContent).toContain('¥40.00');
    expect(document.body.textContent).not.toContain('订单编号');
    await act(async () => {
      clickByText('复制订单号');
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('BW20260929143200801');
  });

  it('导出弹层：已消耗不带任务 ID 选项', async () => {
    await renderPage();
    await act(async () => {
      clickByText('已消耗');
    });
    await flush();
    await act(async () => {
      clickByText('导出明细');
    });
    await flush();
    expect(document.body.textContent).toContain('导出已消耗');
    expect(document.body.textContent).not.toContain('任务 ID');
  });

  it('导出弹层：按当前页签 scope 与勾选字段请求导出', async () => {
    await renderPage();
    await act(async () => {
      clickByText('导出明细');
    });
    await flush();
    expect(document.body.textContent).toContain('导出已获取');
    expect(document.body.textContent).toContain('积分生效时间');
    expect(document.body.textContent).not.toContain('剩余');
    await act(async () => {
      clickByText('导出');
    });
    await flush();
    const urls = vi.mocked(globalThis.fetch).mock.calls.map((call) => String(call[0]));
    const exportUrl = urls.find((url) => url.includes('/api/account/export'));
    expect(exportUrl).toBeDefined();
    expect(decodeURIComponent(exportUrl!)).toContain('scope=gain');
    expect(decodeURIComponent(exportUrl!)).toContain('activated_at');
  });
});

describe('formatBeijingDateTime 北京墙钟字面量', () => {
  it('取字面量墙钟，不按本地时区换算', () => {
    expect(formatBeijingDateTime('2026-09-29T14:32:00+08:00')).toBe('2026-09-29 14:32:00');
    expect(formatBeijingDateTime('2026-12-01T00:00:00+08:00')).toBe('2026-12-01 00:00:00');
  });

  it('同一字面量在不同进程时区下输出一致', () => {
    const value = '2026-10-08T15:02:00+08:00';
    const first = formatBeijingDateTime(value);
    const original = process.env.TZ;
    process.env.TZ = 'America/New_York';
    const second = formatBeijingDateTime(value);
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
    expect(second).toBe(first);
  });

  it('缺秒补 00，非时间串与空值回退', () => {
    expect(formatBeijingDateTime('2026-09-29T14:32+08:00')).toBe('2026-09-29 14:32:00');
    expect(formatBeijingDateTime('')).toBe('—');
    expect(formatBeijingDateTime(null)).toBe('—');
    expect(formatBeijingDateTime(undefined)).toBe('—');
  });
});
