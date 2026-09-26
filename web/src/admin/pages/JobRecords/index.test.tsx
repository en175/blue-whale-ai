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

/** 表头文字（用来钉「哪一列在、哪一列不在」）。 */
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
    // 展示名在时不再重复显示内部 id —— 一格里两行同名信息是噪音
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
    // 模型列的位置：任务 ID / 用户 ID / 项目 ID / 类型 / 模型
    expect(cells[4]).toBe('—');
  });
});
