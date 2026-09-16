// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, skipToken } from '@tanstack/react-query';
import { toast } from 'sonner';
import { assetDetailKeys, assetDetailQueryOptions, assetKeys, assetPageQueryOptions, fetchAssetPage, removeCachedAssetPages } from './assets';

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

describe('fetchAssetPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(toast.error).mockClear();
  });

  it('allows Library to request a smaller page without changing the asset type filter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 200, msg: 'ok', data: { records: [], total: 0, size: 30, current: 2 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchAssetPage('video', 2, 30);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/assets?page=2&size=30&type=video',
      expect.any(Object),
    );
  });

  it('keeps list request failures silent for the loading skeleton', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 500, msg: '资产服务暂不可用', data: null }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(fetchAssetPage('', 1, 30)).rejects.toMatchObject({
      message: '资产服务暂不可用',
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('keeps each filter in an independent TanStack Query cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code: 200, msg: 'ok', data: { records: [], total: 0, size: 30, current: 1 } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    });
    const video = assetPageQueryOptions('video', 30);
    const image = assetPageQueryOptions('image', 30);

    await queryClient.fetchInfiniteQuery(video);
    await queryClient.fetchInfiniteQuery(video);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(video.queryKey).not.toEqual(image.queryKey);
  });

  it('clears every asset page cache when the Library unmounts', () => {
    const queryClient = new QueryClient();
    const all = assetKeys.pages('', 30);
    const videos = assetKeys.pages('video', 30);

    queryClient.setQueryData(all, { pages: ['all'] });
    queryClient.setQueryData(videos, { pages: ['video'] });

    removeCachedAssetPages(queryClient);

    expect(queryClient.getQueryData(all)).toBeUndefined();
    expect(queryClient.getQueryData(videos)).toBeUndefined();
  });
});

describe('资产详情查询（IKFTQW）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(toast.error).mockClear();
  });

  const detail = {
    id: '6494',
    type: 'image',
    url: 'https://tos.test/a.png',
    width: 1024,
    height: 1024,
    duration: null,
    size: 2048,
    source: 'generated',
    model: 'Seedream 5.0 Lite',
    created_at: '2026-09-15T00:00:00.000Z',
    prompt: '一只白鲸穿过蓝色鲸落',
  };

  /** 打桩详情接口：code/status 非 200 时按 http 层的失败语义返回。 */
  function stubDetail(data: unknown, code = 200, status = 200) {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ code, msg: code === 200 ? 'ok' : '资产服务暂不可用', data }),
        { status, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function newClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  }

  it('弹窗没开（id 为 null）时不发请求：queryFn 是 skipToken', () => {
    expect(assetDetailQueryOptions(null).queryFn).toBe(skipToken);
    expect(assetDetailQueryOptions(null).enabled).toBe(false);
    expect(assetDetailQueryOptions('6494').enabled).toBe(true);
  });

  it('按 id 请求详情并取回提示词', async () => {
    const fetchMock = stubDetail(detail);

    const result = await newClient().fetchQuery(assetDetailQueryOptions('6494'));

    expect(fetchMock).toHaveBeenCalledWith('/api/assets/6494', expect.any(Object));
    expect(result.prompt).toBe('一只白鲸穿过蓝色鲸落');
  });

  it('补拉失败不 toast——调用方退回列表记录继续渲染', async () => {
    stubDetail(null, 500, 500);

    await expect(newClient().fetchQuery(assetDetailQueryOptions('6494'))).rejects.toMatchObject({
      message: '资产服务暂不可用',
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('不同资产分键缓存：切换资产读不到上一张的提示词', async () => {
    const fetchMock = stubDetail(detail);
    const queryClient = newClient();

    await queryClient.fetchQuery(assetDetailQueryOptions('6494'));

    expect(queryClient.getQueryData(assetDetailKeys.detail('6494'))).toMatchObject({
      prompt: '一只白鲸穿过蓝色鲸落',
    });
    expect(queryClient.getQueryData(assetDetailKeys.detail('6495'))).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('资产页离开时详情缓存一并释放，不留陈旧提示词', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(assetDetailKeys.detail('6494'), detail);

    removeCachedAssetPages(queryClient);

    expect(queryClient.getQueryData(assetDetailKeys.detail('6494'))).toBeUndefined();
  });
});
