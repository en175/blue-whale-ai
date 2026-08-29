// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { apiRequest, readApiErrorMessage } from './http';

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

describe('readApiErrorMessage', () => {
  it('后台失败包络读 error 字段', () => {
    expect(
      readApiErrorMessage(
        { error: '每个原价只能有一个档位：已存在原价 ¥10 的档位' },
        409,
      ),
    ).toBe('每个原价只能有一个档位：已存在原价 ¥10 的档位');
  });

  it('用户侧优先 msg，其次 message', () => {
    expect(readApiErrorMessage({ msg: '账户已停用', error: 'ignored' }, 403)).toBe(
      '账户已停用',
    );
    expect(readApiErrorMessage({ message: '登录已过期' }, 401)).toBe('登录已过期');
  });

  it('空文案回退状态码', () => {
    expect(readApiErrorMessage({ error: '  ' }, 400)).toBe('请求失败（400）');
    expect(readApiErrorMessage(undefined, 500)).toBe('请求失败（500）');
  });
});

describe('apiRequest 信封', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(toast.error).mockClear();
  });

  it('code===200 解包 data，不 toast', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 200, msg: null, data: { id: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest<{ id: number }>('/api/ok')).resolves.toEqual({ id: 1 });
    expect(toast.error).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty('silent');
  });

  it('非 200 抛 ApiError，文案取 msg，默认 toast', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 1001, msg: '账户余额不足，请充值后重试', data: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(apiRequest('/api/fail')).rejects.toMatchObject({
      code: 1001,
      message: '账户余额不足，请充值后重试',
    });
    expect(toast.error).toHaveBeenCalledWith('账户余额不足，请充值后重试');
  });

  it('silent 失败仍抛错但不 toast', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 1001, msg: '账户余额不足，请充值后重试', data: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(apiRequest('/api/jobs/1', { silent: true })).rejects.toMatchObject({
      message: '账户余额不足，请充值后重试',
    });
    expect(toast.error).not.toHaveBeenCalled();
  });
});
