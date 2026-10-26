// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changePassword } from './auth';

describe('changePassword', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('向 /api/me/password 提交 original_password 与 password', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 200, msg: 'ok', data: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(changePassword('OldPass123', 'NewPass456')).resolves.toBeNull();

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/me/password');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({
      original_password: 'OldPass123',
      password: 'NewPass456',
    });
  });
});
