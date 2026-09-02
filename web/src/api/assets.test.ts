// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAssetPage } from './assets';

describe('fetchAssetPage', () => {
  afterEach(() => vi.unstubAllGlobals());

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
});
