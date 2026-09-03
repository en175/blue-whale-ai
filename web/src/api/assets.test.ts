// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { assetKeys, assetPageQueryOptions, fetchAssetPage, removeCachedAssetPages } from './assets';

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
