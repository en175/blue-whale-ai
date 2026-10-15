// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { API_REQUEST_TIMEOUT_MS, ApiError, apiRequest, envelopeErrorCode, readApiErrorMessage } from './http';
import { useAuthStore } from '@/shared/stores/auth';
import { useAuthPromptStore } from '@/shared/stores/authPrompt';

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

describe('envelopeErrorCode（IKJFGQ：信封 data 字符串码优先，数值兜底）', () => {
  it('data.code 为字符串码时优先返回（稳定锚点，数值码撞号重排不影响识别）', () => {
    expect(
      envelopeErrorCode(new ApiError(400, '比例约束', 1060, { code: 'task_type_param_constraint' })),
    ).toBe('task_type_param_constraint');
  });

  it('data 无 code / code 非字符串时回落信封数值码', () => {
    expect(envelopeErrorCode(new ApiError(400, '比例约束', 1060, null))).toBe(1060);
    expect(envelopeErrorCode(new ApiError(400, '比例约束', 1060, { version: 3 }))).toBe(1060);
    expect(envelopeErrorCode(new ApiError(400, '比例约束', 1060, { code: 1060 }))).toBe(1060);
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

  it('超时会中止请求并抛出可展示的错误', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_path: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    vi.stubGlobal('fetch', fetchMock);

    const request = apiRequest('/api/projects', { silent: true });
    const rejection = expect(request).rejects.toMatchObject({
      status: 408,
      message: '请求超时，请稍后重试',
    });
    await vi.advanceTimersByTimeAsync(API_REQUEST_TIMEOUT_MS);

    await rejection;
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal: expect.any(AbortSignal) });
    vi.useRealTimers();
  });
});

const sampleUser = {
  userId: 1,
  username: 'alice',
  email: '',
  phone: '',
  hasPassword: true,
  isAdmin: false,
};

describe('apiRequest 401', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(toast.error).mockClear();
    useAuthPromptStore.getState().reset();
    useAuthStore.setState({ user: null, isNewUser: false, credits: null });
  });

  it('已登录业务 401 弹过期登录门、保留本地用户、不 toast', async () => {
    useAuthStore.setState({ user: sampleUser });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 401, msg: '缺少登录凭证', data: null }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(apiRequest('/api/projects/p1/generation-jobs', { method: 'POST' })).rejects.toMatchObject({
      status: 401,
    });
    expect(useAuthPromptStore.getState().open).toBe(true);
    expect(useAuthStore.getState().user).toEqual(sampleUser);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('未登录 /api/me 401 不清出登录门', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 401, msg: '缺少登录凭证', data: null }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(apiRequest('/api/me', { silent: true })).rejects.toMatchObject({ status: 401 });
    expect(useAuthPromptStore.getState().open).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('登录接口 401 不弹过期门', async () => {
    useAuthStore.setState({ user: sampleUser });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 401, msg: '账号或密码错误', data: null }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(
      apiRequest('/api/auth/login', { method: 'POST', silent: true }),
    ).rejects.toMatchObject({ status: 401 });
    expect(useAuthPromptStore.getState().open).toBe(false);
    expect(useAuthStore.getState().user).toEqual(sampleUser);
  });
});
