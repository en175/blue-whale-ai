// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import History from './index';


vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const projectRecords: Array<{ id: number; name: string }> = [
  { id: 55, name: '短片工坊' },
  { id: 91, name: '旧画布项目' },
];

const FUTURE_FINALIZE_DEADLINE = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

function jobsFor(projectId: string) {
  if (projectId === '55') {
    return {
      records: [
        {
          job_id: '305',
          type: 'video',
          status: 'succeeded',
          progress: 100,
          input: null,
          created_at: '2026-09-29T08:00:00Z',
          output_assets: [
            { id: '88', url: 'https://tos.test/88.mp4', type: 'video', width: 1920, height: 1080 },
          ],
          video_stage: 'final',
          source_sample_job_id: '302',
          final_job_id: null,
          finalize_deadline_at: null,
          charge_state: 'settled',
          actual_credits: 20,
        },
        {
          job_id: '302',
          type: 'video',
          status: 'succeeded',
          progress: 100,
          input: null,
          created_at: '2026-09-29T07:00:00Z',
          output_assets: [
            { id: '77', url: 'https://tos.test/77.mp4', type: 'video', width: 864, height: 480 },
          ],
          video_stage: 'sample',
          source_sample_job_id: null,
          final_job_id: '305',
          finalize_deadline_at: FUTURE_FINALIZE_DEADLINE,
          charge_state: 'settled',
          actual_credits: 6,
        },
        {
          job_id: '306',
          type: 'video',
          status: 'failed',
          progress: 0,
          input: null,
          created_at: '2026-09-29T06:00:00Z',
          output_assets: [],
          error: { code: 1002, msg: '上游生成失败' },
          video_stage: 'final',
          source_sample_job_id: '302',
          final_job_id: null,
          finalize_deadline_at: null,
          charge_state: 'released',
          actual_credits: null,
        },
      ],
      total: 3,
      size: 100,
      current: 1,
    };
  }
  return {
    records: [
      {
        job_id: '299',
        type: 'video',
        status: 'succeeded',
        progress: 100,
        input: null,
        created_at: '2026-09-28T00:00:00Z',
        output_assets: [],
        canvas_card_state: 'removed',
      },
      {
        job_id: '298',
        type: 'video',
        status: 'succeeded',
        progress: 100,
        input: null,
        created_at: '2026-09-27T00:00:00Z',
        output_assets: [],
        video_stage: 'sample',
        source_sample_job_id: null,
        final_job_id: null,
        finalize_deadline_at: '2026-09-20T00:00:00Z',
        charge_state: 'settled',
        actual_credits: 6,
      },
    ],
    total: 2,
    size: 100,
    current: 1,
  };
}

function jobDetailFor(jobId: string) {
  if (jobId === '302') {
    return {
      job_id: 302,
      status: 'succeeded',
      progress: 100,
      asset: { id: '77', url: 'https://tos.test/77.mp4', type: 'video' },
      output_assets: [
        { id: '77', url: 'https://tos.test/77.mp4', type: 'video', width: 864, height: 480 },
      ],
      video_stage: 'sample',
      finalize_deadline_at: FUTURE_FINALIZE_DEADLINE,
      charge_state: 'settled',
      actual_credits: 6,
    };
  }
  throw new Error(`未预期的详情请求：${jobId}`);
}

function envelope(data: unknown, code = 200, msg = 'ok') {
  return new Response(JSON.stringify({ code, msg, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

let root: Root;
let mountNode: HTMLDivElement;
let queryClient: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

function installFetch() {
  fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (href === '/api/projects') return envelope(projectRecords);
    if (href.startsWith('/api/jobs?')) {
      const projectId = new URL(href, 'https://test.local').searchParams.get('projectId');
      return envelope(jobsFor(projectId ?? ''));
    }
    const detail = href.match(/^\/api\/jobs\/(\d+)$/);
    if (detail) return envelope(jobDetailFor(detail[1]!));
    throw new Error(`未预期的请求：${href} ${init?.method ?? ''}`);
  });
  vi.stubGlobal('fetch', fetchMock);
}

async function renderPage() {
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(MemoryRouter, null, createElement(History)),
      ),
    );
  });
}

async function waitForRows(label: string) {
  await waitFor(() => pageText().includes('任务 #'), label);
}
async function waitFor(predicate: () => boolean, label: string) {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  throw new Error(`等待超时：${label}`);
}

function rowTexts(): string[] {
  return [...mountNode.querySelectorAll('li')].map((li) => (li.textContent ?? '').trim());
}

function pageText(): string {
  return mountNode.textContent ?? '';
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  installFetch();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  await queryClient.clear();
  vi.unstubAllGlobals();
});

describe('History 生成历史页（IKIZQI）', () => {
  it('跨项目合并展示：两项目的任务都在，且各自显示项目名、阶段、状态与费用', async () => {
    await renderPage();
    await waitForRows('历史行渲染');

    const texts = rowTexts();
    expect(texts.length).toBe(5);
    expect(texts[0]).toContain('短片工坊');
    expect(texts[0]).toContain('成片 1080P');
    expect(texts[0]).toContain('已成功');
    expect(texts[0]).toContain('费用：已结算 · 20 积分');
    expect(texts[1]).toContain('样片 480P');
    expect(texts[1]).toContain('转成片截止');
    expect(texts[3]).toContain('旧画布项目');
    expect(texts[4]).toContain('转成片期限已过，样片保留可预览下载');
  });

  it('失败任务留在历史并显示可见错误；旧普通视频按普通视频展示', async () => {
    await renderPage();
    await waitForRows('历史行渲染');

    const failedRow = rowTexts().find((t) => t.includes('任务 #306'));
    expect(failedRow).toBeDefined();
    expect(failedRow).toContain('已失败');
    expect(failedRow).toContain('上游生成失败');
    expect(failedRow).toContain('费用：已退回');

    const legacyRow = rowTexts().find((t) => t.includes('任务 #299'));
    expect(legacyRow).toBeDefined();
    expect(legacyRow).toContain('普通视频');
    expect(legacyRow).not.toContain('样片 480P');
    expect(legacyRow).not.toContain('成片 1080P');  });

  it('来源跳转：成片行点击「来自样片任务」→ 拉任务详情弹层，展示样片阶段与产物下载', async () => {
    await renderPage();
    await waitForRows('历史行渲染');

    const sourceButton = [...mountNode.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('来自样片任务 #302'),
    );
    expect(sourceButton).toBeDefined();
    await act(async () => {
      sourceButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitFor(
      () =>
        [...document.body.querySelectorAll('[data-semantic="root"]')]
          .map((el) => el.textContent ?? '')
          .some((text) => text.includes('下载已转存素材')),
      '来源弹层内容渲染',
    );
    const dialogText = [...document.body.querySelectorAll('[data-semantic="root"]')]
      .map((el) => el.textContent ?? '')
      .join('');
    expect(dialogText).toContain('样片 480P');
    expect(dialogText).toContain('已成功');
    expect(dialogText).toContain('6 积分');
    expect(dialogText).toContain('下载已转存素材（#77）');
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/jobs/302')).toBe(true);
  });

  it('刷新找回：卸载重挂载（模拟刷新）后历史记录仍从服务端找回', async () => {
    await renderPage();
    await waitForRows('历史行渲染');

    await act(async () => {
      root.unmount();
    });
    mountNode.remove();
    mountNode = document.createElement('div');
    document.body.appendChild(mountNode);
    root = createRoot(mountNode);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await renderPage();
    await waitForRows('刷新后历史行渲染');

    expect(pageText()).toContain('短片工坊');
    expect(pageText()).toContain('任务 #305');
    expect(pageText()).toContain('任务 #299');
  });

  it('核对状态（checking）展示为「状态核对中」，费用显示已预扣', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const href = String(url);
        if (href === '/api/projects') return envelope([{ id: 55, name: '短片工坊' }]);
        if (href.startsWith('/api/jobs?projectId=55')) {
          return envelope({
            records: [
              {
                job_id: '307',
                type: 'video',
                status: 'checking',
                progress: 0,
                input: null,
                created_at: '2026-09-29T09:00:00Z',
                output_assets: [],
                video_stage: 'sample',
                finalize_deadline_at: null,
                charge_state: 'held',
                actual_credits: null,
              },
            ],
            total: 1,
            size: 100,
            current: 1,
          });
        }
        if (href.startsWith('/api/jobs?')) return envelope({ records: [], total: 0, size: 100, current: 1 });
        throw new Error(`未预期的请求：${href}`);
      }),
    );

    await renderPage();
    await waitForRows('历史行渲染');
    expect(rowTexts()[0]).toContain('状态核对中');
    expect(rowTexts()[0]).toContain('费用：已预扣');
  });

  it('单项目拉满 100 条封顶时列表末尾显示截断提示，不足 100 条不显示', async () => {
    const jobsOfCount = (count: number) => ({
      records: Array.from({ length: count }, (_, index) => ({
        job_id: String(400 + index),
        type: 'video',
        status: 'succeeded',
        progress: 100,
        input: null,
        created_at: '2026-09-29T00:00:00Z',
        output_assets: [],
        charge_state: 'settled',
        actual_credits: 1,
      })),
      total: count,
      size: 100,
      current: 1,
    });
    const stubJobs = (count: number) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL) => {
          const href = String(url);
          if (href === '/api/projects') return envelope([{ id: 55, name: '短片工坊' }]);
          if (href.startsWith('/api/jobs?projectId=55')) return envelope(jobsOfCount(count));
          throw new Error(`未预期的请求：${href}`);
        }),
      );
    };
    const remount = async () => {
      await act(async () => {
        root.unmount();
      });
      mountNode.remove();
      mountNode = document.createElement('div');
      document.body.appendChild(mountNode);
      root = createRoot(mountNode);
      queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    };

    stubJobs(100);
    await renderPage();
    await waitForRows('满 100 条渲染');
    expect(pageText()).toContain('仅显示最近 100 条');

    await remount();
    stubJobs(99);
    await renderPage();
    await waitForRows('99 条渲染');
    expect(pageText()).not.toContain('仅显示最近 100 条');
  });
});
