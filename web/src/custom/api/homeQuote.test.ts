// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchHomeQuote, type HomeQuotePayload } from './homeQuote';

function payload(overrides: Partial<HomeQuotePayload> = {}): HomeQuotePayload {
  return {
    type: 'video',
    parameters: { model_id: 'seedance-2.5', mode: 'text2video', resolution: '720p', duration: 8 },
    references: [],
    ...overrides,
  };
}

function respond(body: unknown, status = 200) {
  return vi.fn().mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchHomeQuote', () => {
  it('请求与项目无关的预估接口，返回积分', async () => {
    const fetchMock = respond({ code: 200, msg: null, data: { credits: 128 } });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchHomeQuote(payload({ parameters: { model_id: 'm', mode: 't2v', duration: 9 } }))).resolves.toBe(128);

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/generation-quotes');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'video',
      parameters: { model_id: 'm', mode: 't2v', duration: 9 },
      references: [],
    });
  });

  it('credits 为 null 时返回 null（徽标只显示图标）', async () => {
    vi.stubGlobal('fetch', respond({ code: 200, msg: null, data: { credits: null } }));

    await expect(fetchHomeQuote(payload({ parameters: { model_id: 'null-model' } }))).resolves.toBeNull();
  });

  it('信封 code 非 200 时抛错，由调用方按无数字处理', async () => {
    vi.stubGlobal('fetch', respond({ code: 100000, msg: '参数错误', data: null }));

    await expect(fetchHomeQuote(payload({ parameters: { model_id: 'bad-body' } }))).rejects.toMatchObject({ status: 200 });
  });

  it('相同请求体在缓存期内不重复打计费服务，换参数则重问', async () => {
    const fetchMock = respond({ code: 200, msg: null, data: { credits: 30 } });
    vi.stubGlobal('fetch', fetchMock);

    const cached = payload({ parameters: { model_id: 'cached-model', duration: 5 } });
    await fetchHomeQuote(cached);
    await fetchHomeQuote(cached);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await fetchHomeQuote(payload({ parameters: { model_id: 'cached-model', duration: 6 } }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
