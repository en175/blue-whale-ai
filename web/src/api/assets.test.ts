// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { fetchAssetPage } from './assets';

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
});
