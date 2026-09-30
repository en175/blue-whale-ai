// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSessionToken, getSessionToken, setSessionToken } from './sessionToken';
import { apiRequest } from './http';

/**
 * IKJAZN：登录凭证从 HttpOnly cookie 换成前端持有之后，
 * 「令牌存哪、有没有带上」变成了前端自己的责任——此前一条测试都没有。
 */

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** 造一个成功的产品信封响应。 */
function okResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ code: 200, data: null, msg: '' }),
  } as unknown as Response;
}

describe('sessionToken（令牌存取）', () => {
  it('写进去能读出来，清掉就没了', () => {
    expect(getSessionToken()).toBeNull();
    setSessionToken('jwt-abc');
    expect(getSessionToken()).toBe('jwt-abc');
    clearSessionToken();
    expect(getSessionToken()).toBeNull();
  });

  it('只有空白也算没有令牌', () => {
    window.localStorage.setItem('bw-token', '   ');
    expect(getSessionToken()).toBeNull();
  });

  it('★ localStorage 不可用时不让整个应用挂掉（隐私模式 / 存储被禁）', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(getSessionToken()).toBeNull(); // 当作没有令牌，而不是抛出去
    expect(() => setSessionToken('jwt')).not.toThrow();
    expect(() => clearSessionToken()).not.toThrow();
  });
});

describe('apiFetch 注入 Authorization（IKJAZN）', () => {
  it('★ 有令牌就带上 `Bearer`，每个请求都带（不靠调用方记得）', async () => {
    setSessionToken('jwt-abc');
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/me', { silent: true });

    const headers = fetchMock.mock.calls[0]![1].headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer jwt-abc');
  });

  it('没有令牌时不带这个头（迁移期后端还有 cookie 兜底，不该造一个空头出来）', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/me', { silent: true });

    const headers = fetchMock.mock.calls[0]![1].headers as Headers;
    expect(headers.has('Authorization')).toBe(false);
  });

  it('调用方显式传了就不覆盖', async () => {
    setSessionToken('jwt-abc');
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => okResponse());
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/me', {
      silent: true,
      headers: { Authorization: 'Bearer explicit' },
    });

    const headers = fetchMock.mock.calls[0]![1].headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer explicit');
  });
});
