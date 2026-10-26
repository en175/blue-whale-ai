// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteSession } from './agentSessions';

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const res of responses) fetchMock.mockResolvedValueOnce(res);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function noContent() {
  return new Response(null, { status: 204 });
}

function sessionJson(etag: string) {
  return new Response(JSON.stringify({ session_id: 's1', etag }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function callAt(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const [url, init] = fetchMock.mock.calls[index]! as [string, RequestInit];
  return { url, init, headers: (init?.headers ?? {}) as Record<string, string> };
}

describe('删除会话的请求形状', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('DELETE 带上调用方给的 etag 作 If-Match，并带 Idempotency-Key', async () => {
    const fetchMock = stubFetch(noContent());

    await deleteSession('p1', 's1', 'W/"session-7"');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init, headers } = callAt(fetchMock, 0);
    expect(url).toBe('/api/agent/v1/projects/p1/sessions/s1');
    expect(init.method).toBe('DELETE');
    expect(headers['If-Match']).toBe('W/"session-7"');
    expect(headers['Idempotency-Key']).toBeTruthy();
  });

  it('调用方手里没有 etag 时先 GET 补读一次，而不是发一个必然 400 的请求', async () => {
    const fetchMock = stubFetch(sessionJson('W/"session-3"'), noContent());

    await deleteSession('p1', 's1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const read = callAt(fetchMock, 0);
    expect(read.url).toBe('/api/agent/v1/projects/p1/sessions/s1');
    expect(read.init?.method ?? 'GET').toBe('GET');
    expect(callAt(fetchMock, 1).headers['If-Match']).toBe('W/"session-3"');
  });

  it('412 版本冲突时重读会话拿新 etag，重试一次', async () => {
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ code: 'version_conflict', message: 'Version conflict' }), {
        status: 412,
        headers: { 'Content-Type': 'application/json' },
      }),
      sessionJson('W/"session-9"'),
      noContent(),
    );

    await deleteSession('p1', 's1', 'W/"session-7"');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(callAt(fetchMock, 0).headers['If-Match']).toBe('W/"session-7"');
    expect(callAt(fetchMock, 2).headers['If-Match']).toBe('W/"session-9"');
  });

  it('重试后仍然 412 就抛出去，让界面提示刷新——不无限重试', async () => {
    const conflict = () =>
      new Response(JSON.stringify({ code: 'version_conflict', message: 'Version conflict' }), {
        status: 412,
        headers: { 'Content-Type': 'application/json' },
      });
    const fetchMock = stubFetch(conflict(), sessionJson('W/"session-9"'), conflict());

    await expect(deleteSession('p1', 's1', 'W/"session-7"')).rejects.toMatchObject({ status: 412 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('404 不重试——会话已经不在了，重读也读不回来', async () => {
    const fetchMock = stubFetch(
      new Response(JSON.stringify({ code: 'session_not_found', message: 'Agent Session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(deleteSession('p1', 's1', 'W/"session-7"')).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
