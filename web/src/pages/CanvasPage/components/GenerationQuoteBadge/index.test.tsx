// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRefItem } from '@/api/jobs';
import GenerationQuoteBadge from './index';
import { silenceApiConsoleInfo } from '../../testing/silenceApiLogs';

silenceApiConsoleInfo();


let root: Root;
let container: HTMLDivElement;
let client: QueryClient;

function quoteResponse(credits: number | null) {
  return new Response(JSON.stringify({ code: 200, msg: null, data: { credits } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function quoteResponseWithBasis(credits: number) {
  return new Response(
    JSON.stringify({ code: 200, msg: null, data: { credits, duration_basis: 'source_video' } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function imageRef(assetId: string): GenerationRefItem {
  return { role: 'reference', type: 'image', asset_id: assetId };
}

interface BadgeProps {
  projectId?: string;
  modelId?: string;
  references?: GenerationRefItem[];
  targetNodeId?: string;
}

function element(props: BadgeProps) {
  return createElement(
    QueryClientProvider,
    { client },
    createElement(GenerationQuoteBadge, {
      projectId: props.projectId ?? 'p1',
      type: 'image',
      parameters: {
        model_id: props.modelId ?? 'm-test',
        size: '2k',
        aspect_ratio: '1:1',
      },
      ...(props.references ? { references: props.references } : {}),
      ...(props.targetNodeId ? { targetNodeId: props.targetNodeId } : {}),
    }),
  );
}

async function renderBadge(props: BadgeProps) {
  if (!root) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root.render(element(props));
  });
}

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined as unknown as Root;
  container?.remove();
  vi.unstubAllGlobals();
});

describe('GenerationQuoteBadge', () => {
  it('有报价 → 显示「本次预计消耗 N 积分」，请求带的是定价维度', async () => {
    const fetchMock = vi.fn().mockResolvedValue(quoteResponse(42));
    vi.stubGlobal('fetch', fetchMock);

    await renderBadge({});

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

  it('有参考 → 参考原样进请求体（张数交后端数，前端不自报个数）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(quoteResponse(48));
    vi.stubGlobal('fetch', fetchMock);

    await renderBadge({ references: [imageRef('a'), imageRef('b')] });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(init.body as string).references).toEqual([
      { role: 'reference', type: 'image', asset_id: 'a' },
      { role: 'reference', type: 'image', asset_id: 'b' },
    ]);
  });

  it('★ 参考列表变了 → 重新报价（键含参考，不吃旧价缓存）', async () => {
    const fetchMock = vi.fn().mockResolvedValue(quoteResponse(42));
    vi.stubGlobal('fetch', fetchMock);

    await renderBadge({ references: [imageRef('a')] });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await renderBadge({ references: [imageRef('a'), imageRef('b')] });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const init = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(JSON.parse(init.body as string).references).toHaveLength(2);
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

  it('★ IKJ797 标记 duration_basis=source_video → 徽标旁标注「按源视频时长预估」', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(quoteResponseWithBasis(58)));

    await renderBadge({});

    await vi.waitFor(() =>
      expect(container.textContent).toContain('本次预计消耗 58 积分'),
    );
    expect(container.querySelector('[data-testid="generation-quote-basis"]')?.textContent)
      .toBe('按源视频时长预估');
  });

  it('★ IKJGE6 草稿目标 → 请求体带 target_node_id（后端据此做画布文本带入合并）；换目标重新报价', async () => {
    const fetchMock = vi.fn().mockResolvedValue(quoteResponse(42));
    vi.stubGlobal('fetch', fetchMock);

    await renderBadge({ targetNodeId: 'media-1' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string).target_node_id).toBe('media-1');

    await renderBadge({ targetNodeId: 'media-9' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string).target_node_id).toBe('media-9');
  });

  it('★ 无标记（延长/参考单）→ 只显积分，不出现口径标注', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(quoteResponse(58)));

    await renderBadge({});

    await vi.waitFor(() =>
      expect(container.textContent).toContain('本次预计消耗 58 积分'),
    );
    expect(container.textContent).not.toContain('按源视频时长预估');
  });
});
