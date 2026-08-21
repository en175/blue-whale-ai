// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';
import { cancelSession, cancelSessionRun, retrySessionRun, sendSessionMessage } from './agentSessions';
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

    const request = retrySessionRun('project-1', 'run-1');

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

  /**
   * 这几条锁的是 URL 与 body 本身。
   *
   * 之前这里只测了错误处理，于是取消和重试的路径多写了一段 `/sessions/:sid`（agent 的 Run 级
   * 路由与 sessions 平级，见 agent-rest-api-v1.md），body 又缺 `action_id`——两处都错，请求
   * 打在 404 上，而 UI 照常切成停止形态。**按钮从来没真正取消过任何东西，也没人发现。**
   *
   * 一个不断言目标地址的契约测试，测不出"打错了地方"。
   */
  describe('请求真的打在契约规定的地址上', () => {
    function captureFetch() {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('会话级取消：不带 runId，也不带 sessions 之外的多余层级', async () => {
      const fetchMock = captureFetch();
      await cancelSession('project-1', 'session-1');
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/agent/v1/projects/project-1/sessions/session-1/cancel');
    });

    it('Run 级取消挂在 /projects/:id/runs 下，不在 /sessions 里面', async () => {
      const fetchMock = captureFetch();
      await cancelSessionRun('project-1', 'run-1');
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/agent/v1/projects/project-1/runs/run-1/cancel');
    });

    it('重试同理', async () => {
      const fetchMock = captureFetch();
      await retrySessionRun('project-1', 'run-1');
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/agent/v1/projects/project-1/runs/run-1/retry');
    });

    it('三者都带 action_id——服务端缺它会 422，而空 body 曾让这些请求即使地址对了也过不去', async () => {
      for (const call of [
        () => cancelSession('project-1', 'session-1'),
        () => cancelSessionRun('project-1', 'run-1'),
        () => retrySessionRun('project-1', 'run-1'),
      ]) {
        const fetchMock = captureFetch();
        await call();
        const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
        const body = JSON.parse(String(init?.body));
        expect(typeof body.action_id).toBe('string');
        expect(body.action_id.length).toBeGreaterThan(0);
      }
    });
  });
});
