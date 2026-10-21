import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMediaToolQuote } from './mediaToolQuote';

const http = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/shared/api/http', () => ({ apiRequest: http.apiRequest }));

describe('fetchMediaToolQuote', () => {
  beforeEach(() => {
    http.apiRequest.mockReset();
    http.apiRequest.mockResolvedValue({ credits: 2, quote_revision: 'rev' });
  });

  it('按工具类型提交报价输入并静默处理错误', async () => {
    await fetchMediaToolQuote('audio_trim', { duration: 61 });

    expect(http.apiRequest).toHaveBeenCalledWith(
      '/api/media-tools/audio_trim/quote',
      {
        method: 'POST',
        body: JSON.stringify({ input: { duration: 61 } }),
        silent: true,
      },
    );
  });

  it('路径参数做 URL 编码', async () => {
    await fetchMediaToolQuote('video.scene split', {});
    expect(http.apiRequest.mock.calls[0]![0]).toBe(
      '/api/media-tools/video.scene%20split/quote',
    );
  });
});
