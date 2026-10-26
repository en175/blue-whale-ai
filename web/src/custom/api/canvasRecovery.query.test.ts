import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('@/shared/api/http', () => ({ apiRequest: http.apiRequest }));

import {
  generationRecoveryKeys,
  generationRecoveryPageOptions,
} from './canvasRecovery';

const page = (next_cursor: string | null = null) => ({
  protocol_version: 1, canvas_version: 3, records: [], next_cursor,
});

describe('generation-recovery 恢复页 Query 定义（IKJKU9）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queryFn 走现有传输层：URL 带项目与游标，silent 不触发传输层错误 toast', async () => {
    http.apiRequest.mockResolvedValue(page());
    const client = new QueryClient();
    await client.fetchQuery(generationRecoveryPageOptions('p/1', { cursor: 'c-2' }));
    expect(http.apiRequest).toHaveBeenCalledTimes(1);
    const [url, init] = http.apiRequest.mock.calls[0]!;
    expect(String(url)).toBe('/api/canvases/p%2F1/generation-recovery?cursor=c-2');
    expect(init).toMatchObject({ silent: true });
    client.clear();
  });

  it('keys 工厂按项目与游标隔离：不同项目/游标不同 key，游标缺省归一为 null', () => {
    expect(generationRecoveryKeys.all).toEqual(['canvases', 'generation-recovery']);
    expect(generationRecoveryKeys.page('p1', { cursor: 'c1' })).not.toEqual(generationRecoveryKeys.page('p2', { cursor: 'c1' }));
    expect(generationRecoveryKeys.page('p1', { cursor: 'c1' })).not.toEqual(generationRecoveryKeys.page('p1', { cursor: 'c2' }));
    expect(generationRecoveryKeys.page('p1', { cursor: 'c1' })).not.toEqual(generationRecoveryKeys.page('p1'));
    expect(generationRecoveryKeys.page('p1')).toEqual(generationRecoveryKeys.page('p1', { cursor: null }));
  });

  it('查询错误不自动重试（retry: false），重复取页不吃缓存（staleTime: 0，重扫重新对账服务端事实）', async () => {
    const options = generationRecoveryPageOptions('p1');
    expect(options.retry).toBe(false);
    expect(options.staleTime).toBe(0);
    const client = new QueryClient();
    http.apiRequest
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(page())
      .mockResolvedValueOnce(page());
    await expect(client.fetchQuery(options)).rejects.toThrow('boom');
    expect(http.apiRequest).toHaveBeenCalledTimes(1);
    await client.fetchQuery(options);
    await client.fetchQuery(options);
    expect(http.apiRequest).toHaveBeenCalledTimes(3);
    client.clear();
  });
});
