// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JobRecords from './index';

const api = vi.hoisted(() => ({ fetchAdminJobRecords: vi.fn() }));

vi.mock('@/api/adminJobRecords', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/adminJobRecords')>();
  return {
    ...actual,
    fetchAdminJobRecords: api.fetchAdminJobRecords,
    adminJobRecordsOptions: (query: import('@/api/adminJobRecords').AdminJobRecordQuery) => ({
      queryKey: actual.adminJobRecordKeys.list(query),
      queryFn: () => api.fetchAdminJobRecords(query),
    }),
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root;
let mountNode: HTMLDivElement;

function record(patch: Record<string, unknown>) {
  return {
    job_id: '73',
    user_id: '9001',
    project_id: '55',
    type: 'video',
    status: 'succeeded',
    progress: 100,
    model_id: null,
    model_label: null,
    retry_count: 0,
    created_at: '2026-09-25T10:00:00+08:00',
    updated_at: '2026-09-25T10:01:00+08:00',
    error: null,
    ...patch,
  };
}

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
    root.render(withQuery(createElement(JobRecords)));
  });
  for (let i = 0; i < 25; i += 1) {
    if (!document.body.textContent?.includes('加载中…')) return;
    await settle();
  }
  throw new Error(`列表仍在加载: ${document.body.textContent}`);
}

function headers(): string[] {
  return [...document.body.querySelectorAll('th')].map((th) => th.textContent?.trim() ?? '');
}

beforeEach(() => {
  notifyManager.setScheduler((cb) => cb());
  api.fetchAdminJobRecords.mockResolvedValue({ list: [record({})], total: 1 });
});

afterEach(async () => {
  notifyManager.setScheduler((cb) => {
    setTimeout(cb, 0);
  });
  vi.clearAllMocks();
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
});

describe('JobRecords 任务记录 · 模型列', () => {
  it('★ 不显示厂商，改显示模型', async () => {
    await renderPage();

    expect(headers()).not.toContain('厂商');
    expect(headers()).toContain('模型');
  });

  it('有展示名就用展示名（中文名来自能力表，不在这里拼）', async () => {
    api.fetchAdminJobRecords.mockResolvedValue({
      list: [
        record({ model_id: 'doubao-seedance-2-5-260628', model_label: '豆包 Seedance 2.5' }),
      ],
      total: 1,
    });

    await renderPage();

    expect(document.body.textContent).toContain('豆包 Seedance 2.5');
    expect(document.body.textContent).not.toContain('doubao-seedance-2-5-260628');
  });

  it('能力表里查不到展示名时原样显示 model_id（它至少能拿去搜、去对配置）', async () => {
    api.fetchAdminJobRecords.mockResolvedValue({
      list: [record({ model_id: 'doubao-seedance-2-5-260628', model_label: null })],
      total: 1,
    });

    await renderPage();

    expect(document.body.textContent).toContain('doubao-seedance-2-5-260628');
  });

  it('★ 没有模型的任务显示「—」，不是空白也不是 undefined', async () => {
    await renderPage();

    const row = document.body.querySelector('tbody tr');
    const cells = [...(row?.querySelectorAll('td') ?? [])].map((td) => td.textContent?.trim());

    expect(cells).toContain('—');
    expect(document.body.textContent).not.toContain('undefined');
    expect(cells[5]).toBe('—');
  });

  it('★ 首次查询**不带** status / type —— 哨兵漏下去会把列表静默过滤成空', async () => {
    await renderPage();

    const first = api.fetchAdminJobRecords.mock.calls[0]?.[0] as Record<string, unknown>;

    expect(api.fetchAdminJobRecords).toHaveBeenCalled();

    expect(first).not.toHaveProperty('status');
    expect(first).not.toHaveProperty('type');
  });

  it('★ 有筛选而结果为空时说「没有匹配的任务」—— 判据走**生效条件**，不是草稿', async () => {
    api.fetchAdminJobRecords.mockResolvedValue({ list: [], total: 0 });
    await renderPage();

    expect(document.body.textContent).toContain('暂无任务');

    const input = [...document.querySelectorAll('input')].find(
      (el) => el.placeholder === '用户 ID / 手机号 / 用户名（需完整，留空 = 全站）',
    ) as HTMLInputElement;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setValue?.call(input, '9001');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const search = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('查询'),
    );
    await act(async () => search?.click());
    for (let i = 0; i < 10; i += 1) await settle();

    expect(document.body.textContent).toContain('没有匹配的任务');
  });
});

describe('JobRecords — 用户列', () => {
  it('列头是「用户名」「手机号」，不再有「用户 ID」列', async () => {
    api.fetchAdminJobRecords.mockResolvedValue({ list: [record({})], total: 1 });
    await renderPage();

    expect(headers()).toContain('用户名');
    expect(headers()).toContain('手机号');
    expect(headers()).not.toContain('用户 ID');
  });

  it('用户名与手机号来自 BFF 回填，直接渲染在行里', async () => {
    api.fetchAdminJobRecords.mockResolvedValue({
      list: [record({ nickname: '张小明', phone: '13800008888' })],
      total: 1,
    });
    await renderPage();

    expect(document.body.textContent).toContain('张小明');
    expect(document.body.textContent).toContain('13800008888');
  });

  it('★ 用户 ID 一个都不露 —— 既不在列里，也不藏在悬停 / 提示里', async () => {
    api.fetchAdminJobRecords.mockResolvedValue({ list: [record({})], total: 1 });
    await renderPage();

    expect(document.body.textContent).not.toContain('9001');
    expect(document.body.querySelector('button[aria-label="用户明细"]')).toBeNull();
  });

  it('查不到用户（两个字段都是 null）→ 显示「—」', async () => {
    api.fetchAdminJobRecords.mockResolvedValue({
      list: [record({ nickname: null, phone: null })],
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
    api.fetchAdminJobRecords.mockResolvedValue({ list: [record({})], total: 1 });
    await renderPage();

    const cells = [...(document.body.querySelector('tbody tr')?.querySelectorAll('td') ?? [])].map(
      (td) => td.textContent?.trim() ?? '',
    );
    expect(cells[1]).toBe('—');
    expect(cells[2]).toBe('—');
    expect(document.body.textContent).not.toContain('Unexpected Application Error');
  });
});
