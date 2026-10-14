import { describe, expect, it, vi } from 'vitest';
import { createFetchGuard } from '../app/pages/CanvasPage/testing/fetchGuard';

describe('CanvasPage 受控测试 fetch 边界', () => {
  it('未声明请求被调用方捕获后，最终断言仍报告方法和 URL', async () => {
    const guard = createFetchGuard();
    const handler = vi.fn(async () => new Response('ok'));
    guard.stub(handler, [['POST', '/api/allowed']]);
    await guard.fetch('/api/unknown', { method: 'POST' }).catch(() => undefined);
    expect(handler).not.toHaveBeenCalled();
    expect(() => guard.assertNoUnexpectedRequests()).toThrow('POST /api/unknown');
    expect(() => guard.assertNoUnexpectedRequests()).not.toThrow();
  });

  it('允许请求保留原始参数、顺序响应和故意注入的网络错误', async () => {
    const guard = createFetchGuard();
    const failure = new TypeError('Failed to fetch');
    const handler = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('first'))
      .mockRejectedValueOnce(failure);
    guard.stub(handler, [['POST', '/api/allowed']]);
    const init = { method: 'POST', body: 'payload', headers: { 'Idempotency-Key': 'retry-2' } };
    expect(await (await guard.fetch('/api/allowed?cursor=1', init)).text()).toBe('first');
    await expect(guard.fetch('/api/allowed', init)).rejects.toBe(failure);
    expect(handler.mock.calls).toEqual([['/api/allowed?cursor=1', init], ['/api/allowed', init]]);
    expect(() => guard.assertNoUnexpectedRequests()).not.toThrow();
  });

  it('方法或路径不匹配时不消耗下一次已声明响应', async () => {
    const guard = createFetchGuard();
    const handler = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('reserved'));
    guard.stub(handler, [['POST', '/api/allowed']]);
    await guard.fetch('/api/allowed').catch(() => undefined);
    await guard.fetch('/api/allowed/extra', { method: 'POST' }).catch(() => undefined);
    expect(await (await guard.fetch('/api/allowed', { method: 'POST' })).text()).toBe('reserved');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(() => guard.assertNoUnexpectedRequests()).toThrow('Unexpected fetch: GET /api/allowed\nUnexpected fetch: POST /api/allowed/extra');
  });

  it('清理与替换响应不会抹掉未知记录，未安装响应时也阻断请求', async () => {
    const guard = createFetchGuard();
    await guard.fetch(new URL('https://unmatched.example/before')).catch(() => undefined);
    guard.stub(vi.fn(async () => new Response('ok')), [['GET', '/api/allowed']]);
    guard.reset();
    await guard.fetch('/api/allowed').catch(() => undefined);
    expect(() => guard.assertNoUnexpectedRequests()).toThrow('GET https://unmatched.example/before\nUnexpected fetch: GET /api/allowed');
    guard.reset();
    expect(() => guard.assertNoUnexpectedRequests()).not.toThrow();
  });

  it('Request 对象的方法与 init 覆盖值均参与匹配', async () => {
    const guard = createFetchGuard();
    const handler = vi.fn(async () => new Response('ok'));
    guard.stub(handler, [['POST', 'https://allowed.example/task']]);
    const request = new Request('https://allowed.example/task?cursor=2', { method: 'POST' });
    await guard.fetch(request);
    await guard.fetch(request, { method: 'DELETE' }).catch(() => undefined);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(() => guard.assertNoUnexpectedRequests()).toThrow('DELETE https://allowed.example/task?cursor=2');
  });
});
