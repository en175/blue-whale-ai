// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GenerationQuoteBadge from './index';

/* 生成面板上的价格预览：有报价就显示「本次预计消耗 N 积分」，
   算不出价（credits: null）或请求失败则**什么都不显示**——绝不显示 0（会被读成免费）。 */

let root: Root;
let container: HTMLDivElement;

function quoteResponse(credits: number | null) {
  return new Response(JSON.stringify({ code: 200, msg: null, data: { credits } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function renderBadge(props: {
  projectId?: string;
  modelId?: string;
}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(GenerationQuoteBadge, {
          projectId: props.projectId ?? 'p1',
          type: 'image',
          parameters: {
            model_id: props.modelId ?? 'm-test',
            size: '2k',
            aspect_ratio: '1:1',
          },
        }),
      ),
    );
  });
}

/** 让已经发出的请求有机会落地（用于断言「什么都不显示」的负例）。 */
async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

describe('GenerationQuoteBadge', () => {
  it('有报价 → 显示「本次预计消耗 N 积分」，请求带的是定价维度', async () => {
    const fetchMock = vi.fn().mockResolvedValue(quoteResponse(42));
    vi.stubGlobal('fetch', fetchMock);

    await renderBadge({});

    // 查询是异步落地的：等它渲染出来（同 ImageDialog 等模型列表的 vi.waitFor 口径）
    await vi.waitFor(() =>
      expect(container.textContent).toContain('本次预计消耗 42 积分'),
    );
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/projects/p1/generation-jobs/quote');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'image',
      parameters: { model_id: 'm-test', size: '2k', aspect_ratio: '1:1' },
      expected_output_count: 1,
    });
  });

  it('★ 无报价（credits: null）→ 什么都不显示，尤其**不显示 0**', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(quoteResponse(null)));

    await renderBadge({});
    await settle();

    expect(container.textContent).toBe('');
    expect(container.querySelector('[data-testid="generation-quote"]')).toBeNull();
  });

  it('★ 报价请求失败 → 什么都不显示（预览失败不阻断、不打扰）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );

    await renderBadge({});
    await settle();

    expect(container.textContent).toBe('');
  });

  it('项目或模型未定 → 不发请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue(quoteResponse(42));
    vi.stubGlobal('fetch', fetchMock);

    await renderBadge({ projectId: '' });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
