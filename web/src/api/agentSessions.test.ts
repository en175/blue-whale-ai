// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';
import { retrySessionRun, sendSessionMessage } from './agentSessions';
import { getAccessToken, setSession } from '@/utils/auth';

describe('agentSessions API contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setSession(null, null);
  });

  it('preserves HTTP errors as ApiError so callers can handle retry 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 'route_not_found', message: 'retry route is unavailable' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const request = retrySessionRun('project-1', 'session-1', 'run-1');

    await expect(request).rejects.toBeInstanceOf(ApiError);
    await expect(request).rejects.toMatchObject({
      status: 404,
      code: 'route_not_found',
      message: 'retry route is unavailable',
    });
  });

  it('sends a selected creative skill only on the intended message', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await sendSessionMessage('project-1', 'session-1', 'make a launch video', {
      forcedCreativeSkillId: 'skill-42',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      content: [{ type: 'text', text: 'make a launch video' }],
      forced_creative_skill_id: 'skill-42',
    });
  });

  it('does not log the user out when a 401 represents a missing Run capability', async () => {
    setSession('token-1', {
      userId: 1,
      username: 'tester',
      email: '',
      phone: '',
      hasPassword: false,
      isAdmin: false,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 'capability_required', message: 'Run Capability is required' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(sendSessionMessage('project-1', 'session-1', 'start')).rejects.toMatchObject({
      status: 401,
      code: 'capability_required',
    });
    expect(getAccessToken()).toBe('token-1');
  });
});
