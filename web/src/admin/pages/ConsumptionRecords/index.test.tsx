// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminConsumptionRecord } from '@/api/adminConsumptionRecords';
import ConsumptionRecords from './index';

const api = vi.hoisted(() => ({ fetchAdminConsumptionRecords: vi.fn() }));

vi.mock('@/api/adminConsumptionRecords', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/api/adminConsumptionRecords')>();
  return {
    ...actual,
    fetchAdminConsumptionRecords: api.fetchAdminConsumptionRecords,
    adminConsumptionRecordsOptions: (query: import('@/api/adminConsumptionRecords').AdminConsumptionRecordQuery) => ({
      queryKey: actual.adminConsumptionRecordKeys.list(query),
      queryFn: () => api.fetchAdminConsumptionRecords(query),
    }),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let mountNode: HTMLDivElement;

const ITEM = {
  id: 'res:7',
  user_id: 9001,
  nickname: '张小明',
  phone: '13800008888',
  type: 'consume',
  direction: 'out',
  title: '视频生成 · seedance-2.5',
  credits: 30,
  reserved_credits: 100,
  task_type: 'video',
  model_id: 'seedance-2.5',
  model_label: 'Seedance 2.5',
  prompt: '一只猫在草地上跑',
  status: 'done',
  created_at: '2026-09-25T10:00:00+08:00',
  settled_at: '2026-09-25T10:01:00+08:00',
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
  throw new Error(`列表仍在加载: ${document.body.textContent}`);
}

async function renderPage() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(withQuery(createElement(ConsumptionRecords)));
  });
  await waitUntilLoaded();
}

function button(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`没有找到按钮：${label}`);
  return found;
}

async function click(label: string) {
  await act(async () => button(label).click());
  await settle();
}

function pageOfCall(n: number): number | string {
  return api.fetchAdminConsumptionRecords.mock.calls[n - 1]?.[0]?.page ?? '<缺>';
}

beforeEach(() => {
  notifyManager.setScheduler((cb) => cb());
  api.fetchAdminConsumptionRecords.mockResolvedValue({ items: [ITEM], total: 0 });
});

afterEach(async () => {
  notifyManager.setScheduler((cb) => {
    setTimeout(cb, 0);
  });
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('ConsumptionRecords 积分记录（游标分页）', () => {
  it('页面标题是「积分记录」', async () => {
    await renderPage();

    expect(document.body.textContent).toContain('积分记录');
  });

  it('首次加载落在第 1 页，且因为是全站视图所以 keyword 一个也不传', async () => {
    await renderPage();

    expect(api.fetchAdminConsumptionRecords).toHaveBeenCalledTimes(1);
    expect(pageOfCall(1)).toBe(1);
    expect(api.fetchAdminConsumptionRecords.mock.calls[0]?.[0]).not.toHaveProperty('keyword');
  });

  it('渲染归属用户、任务类别与带方向的金额', async () => {
    await renderPage();

    expect(document.body.textContent).toContain('张小明');
    expect(document.body.textContent).toContain('13800008888');
    expect(document.body.textContent).toContain('视频');
    expect(document.body.textContent).toContain('-30');
  });

  it('净额与扣款不一致时，金额下方补一行交代扣款与已退', async () => {
    await renderPage();

    expect(document.body.textContent).toContain('扣款 100 · 已退 70');
  });

  it('两个数一致时**不**显示副文案 —— 写出来只是复读', async () => {
    api.fetchAdminConsumptionRecords.mockResolvedValue({
      items: [{ ...ITEM, credits: 5, reserved_credits: 5 }],
      total: 0,
    });

    await renderPage();

    expect(document.body.textContent).toContain('-5');
    expect(document.body.textContent).not.toContain('已退');
  });

  it('没有扣款的行（发放 / 人工调账）不显示副文案', async () => {
    api.fetchAdminConsumptionRecords.mockResolvedValue({
      items: [{ ...ITEM, id: 'lot:12', type: 'recharge', direction: 'in', credits: 500, reserved_credits: null }],
      total: 0,
    });

    await renderPage();

    expect(document.body.textContent).toContain('+500');
    expect(document.body.textContent).not.toContain('已退');
  });

  it('后端比前端旧、**整个键都不回**时不崩 —— 「没有」的第二种形态', async () => {
    const oldBackendRow = {
      id: 'res:9',
      user_id: 9001,
      type: 'consume',
      direction: 'out',
      title: '视频生成 · seedance-2.5',
      credits: 30,
      status: 'done',
      created_at: '2026-09-25T10:00:00+08:00',
      settled_at: '2026-09-25T10:01:00+08:00',
    };
    api.fetchAdminConsumptionRecords.mockResolvedValue({
      items: [oldBackendRow],
      total: 0,
    });

    await renderPage();

    expect(document.body.textContent).toContain('-30');
    expect(document.body.textContent).not.toContain('已退');
    expect(document.body.textContent).not.toContain('Unexpected Application Error');
  });

  it('结算到 0（失败单全额退回）仍要显示 —— 那正是最该解释的一行', async () => {
    api.fetchAdminConsumptionRecords.mockResolvedValue({
      items: [{ ...ITEM, credits: 0, reserved_credits: 12 }],
      total: 0,
    });

    await renderPage();

    const cell = [...document.querySelectorAll('tbody tr td')].find((td) =>
      td.textContent?.includes('已退'),
    );
    expect(cell?.textContent).toContain('0');
    expect(cell?.textContent).toContain('扣款 12 · 已退 12');
    expect(cell?.textContent).not.toContain('-0');
    expect(cell?.textContent).not.toContain('+0');
  });

  it('副文案与金额在**同一个单元格**里 —— 并排，不另起一行、也不单开一列', async () => {
    api.fetchAdminConsumptionRecords.mockResolvedValue({ items: [ITEM], total: 0 });

    await renderPage();

    const holdCells = [...document.querySelectorAll('tbody tr td')].filter((td) =>
      td.textContent?.includes('已退'),
    );
    expect(holdCells).toHaveLength(1);
    expect(holdCells[0]?.textContent).toContain('-30');
    expect(holdCells[0]?.textContent).toContain('扣款 100 · 已退 70');
  });

  it('状态列：done 是「已完成」、refunded 是「已退款」、其余是「处理中」', async () => {
    api.fetchAdminConsumptionRecords.mockResolvedValue({
      items: [
        { ...ITEM, id: 'res:1', status: 'done' },
        { ...ITEM, id: 'res:2', status: 'refunded', credits: 0 },
        { ...ITEM, id: 'res:3', status: 'pending' },
      ],
      total: 0,
    });

    await renderPage();

    const text = document.body.textContent ?? '';
    expect(text).toContain('已完成');
    expect(text).toContain('已退款');
    expect(text).toContain('处理中');
  });

  it('点「下一页」页码 +1；「上一页」回到上一页（offset 分页，没有游标要存）', async () => {
    api.fetchAdminConsumptionRecords.mockResolvedValue({ items: [ITEM], total: 40 });

    await renderPage();
    expect(pageOfCall(1)).toBe(1);

    await click('下一页');
    expect(pageOfCall(2)).toBe(2);

    await click('上一页');
    expect(pageOfCall(3)).toBe(1);
  });

  it('首页禁用「上一页」；没有下一页时禁用「下一页」', async () => {
    await renderPage();

    expect(button('上一页').disabled).toBe(true);
    expect(button('下一页').disabled).toBe(true);
  });

  it('★ 总数来自服务端，不自己编', async () => {
    api.fetchAdminConsumptionRecords.mockResolvedValue({ items: [ITEM], total: 40 });
    await renderPage();

    expect(document.body.textContent).toContain('第 1 页');
    expect(document.body.textContent).toContain('共');
  });

  it('翻到第 2 页后修改筛选条件，页码回到第 1 页而不是停在第 2 页', async () => {
    api.fetchAdminConsumptionRecords.mockResolvedValue({ items: [ITEM], total: 40 });

    await renderPage();
    await click('下一页');
    expect(pageOfCall(2)).toBe(2);

    const userInput = document.body.querySelector<HTMLInputElement>(
      'input[placeholder="用户 ID / 手机号 / 用户名（需完整，留空 = 全站）"]',
    );
    if (!userInput) throw new Error('用户输入框未渲染');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(userInput, '13800008888');
      userInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('查询');

    expect(pageOfCall(3)).toBe(1);
    expect(api.fetchAdminConsumptionRecords.mock.calls[2]?.[0]?.keyword).toBe('13800008888');
  });
});

describe('ConsumptionRecords — 哨兵口径', () => {
  it('★ 首次查询**不带** type —— 哨兵漏下去会把列表静默过滤成空', async () => {
    await renderPage();

    expect(api.fetchAdminConsumptionRecords).toHaveBeenCalled();
    const first = api.fetchAdminConsumptionRecords.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(first).not.toHaveProperty('type');
  });
});

describe('ConsumptionRecords — 任务列与明细面板', () => {
  function ledgerRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'lot:12',
      user_id: 9001,
      nickname: null,
      phone: null,
      type: 'recharge',
      direction: 'in',
      title: '充值到账',
      credits: 500,
      reserved_credits: null,
      status: 'done',
      created_at: '2026-09-25T10:00:00+08:00',
      settled_at: '2026-09-25T10:00:00+08:00',
      ...overrides,
    };
  }

  function headers(): string[] {
    return [...document.body.querySelectorAll('th')].map((th) => th.textContent?.trim() ?? '');
  }

  async function hoverTaskDetail() {
    const trigger = document.body.querySelector<HTMLButtonElement>('button[aria-label="任务明细"]');
    if (!trigger) throw new Error('没有找到任务明细触发器');
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await settle();
  }

  it('列头是「任务」——原来那一列叫「说明」', async () => {
    await renderPage();

    expect(headers()).toContain('任务');
    expect(headers()).not.toContain('说明');
  });

  it('格子里**只有类别**：模型名与提示词都不进表格', async () => {
    await renderPage();

    const cells = [...document.querySelectorAll('tbody tr td')].filter((td) =>
      td.textContent?.includes('视频'),
    );
    expect(cells).toHaveLength(1);
    expect(cells[0]?.textContent).not.toContain('Seedance 2.5');
    expect(document.body.textContent).not.toContain('一只猫在草地上跑');
  });

  it('悬停触发器 → 明细面板里能看到模型与提示词全文', async () => {
    await renderPage();

    await hoverTaskDetail();

    const body = document.body.textContent ?? '';
    expect(body).toContain('Seedance 2.5');
    expect(body).toContain('一只猫在草地上跑');
  });

  it('提示词为空时面板里显示「—」而不是空白格子', async () => {
    api.fetchAdminConsumptionRecords.mockResolvedValue({
      items: [{ ...ITEM, prompt: null }],
      total: 0,
    });
    await renderPage();

    await hoverTaskDetail();

    expect(document.body.textContent).toContain('Seedance 2.5');
    expect(document.body.textContent).toContain('—');
  });

  it('没有任务的行（发放 / 账本 / 查不到任务）→ 回落账本自带的 title，且**没有**明细触发器', async () => {
    api.fetchAdminConsumptionRecords.mockResolvedValue({
      items: [
        ledgerRow({ task_type: null, model_id: null, model_label: null, prompt: null }),
      ],
      total: 0,
    });

    await renderPage();

    expect(document.body.textContent).toContain('充值到账');
    expect(document.body.querySelector('button[aria-label="任务明细"]')).toBeNull();
  });

  it('后端比前端旧、**整个键都不回**时回落 title，不崩', async () => {
    api.fetchAdminConsumptionRecords.mockResolvedValue({
      items: [ledgerRow()],
      total: 0,
    });

    await renderPage();

    expect(document.body.textContent).toContain('充值到账');
    expect(document.body.textContent).not.toContain('Unexpected Application Error');
  });
});

describe('ConsumptionRecords — 用户列', () => {
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
    await renderPage();

    expect(document.body.textContent).toContain('张小明');
    expect(document.body.textContent).toContain('13800008888');
  });

  it('★ 用户 ID 一个都不露 —— 既不在列里，也不藏在悬停 / 提示里', async () => {
    await renderPage();

    expect(document.body.textContent).not.toContain('9001');
    expect(document.body.querySelector('button[aria-label="用户明细"]')).toBeNull();
  });

  it('查不到用户（用户名手机号都是 null）→ 显示「—」，不是空白也不是崩', async () => {
    api.fetchAdminConsumptionRecords.mockResolvedValue({
      items: [{ ...ITEM, nickname: null, phone: null }],
      total: 0,
    });

    await renderPage();

    const cells = [...document.querySelectorAll('tbody tr td')].map(
      (td) => td.textContent?.trim() ?? '',
    );
    expect(cells[1]).toBe('—');
    expect(cells[2]).toBe('—');
  });

  it('后端比前端旧、用户名手机号**整个键都不回**时同样显示「—」，不崩', async () => {
    const noIdentity: AdminConsumptionRecord = { ...ITEM };
    delete noIdentity.nickname;
    delete noIdentity.phone;
    api.fetchAdminConsumptionRecords.mockResolvedValue({
      items: [noIdentity],
      total: 0,
    });

    await renderPage();

    const cells = [...document.querySelectorAll('tbody tr td')].map(
      (td) => td.textContent?.trim() ?? '',
    );
    expect(cells[1]).toBe('—');
    expect(cells[2]).toBe('—');
  });
});
