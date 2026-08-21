// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';
import {
  cancelSession,
  cancelSessionRun,
  confirmRequirementUnderstanding,
  correctRequirementUnderstanding,
  createSession,
  deleteSession,
  fetchRequirementUnderstandings,
  fetchSessionSnapshot,
  listSessions,
  retrySessionRun,
  sendSessionMessage,
} from './agentSessions';
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
   * 这一节锁的是**每个端点打到哪个地址**。
   *
   * 之前这里只测错误处理，于是取消和重试的路径多写了一段 `/sessions/:sid`（agent 的 Run 级
   * 路由与 sessions 平级，见 agent-rest-api-v1.md 的 Routing 小节），body 又缺 `action_id`。
   * 两处都错，请求打在 404 上，而 UI 照常切成停止形态——**按钮从来没真正取消过任何东西，
   * 也没人发现**。更讽刺的是上面那条测试 mock 的恰好就是 404：它测的是「收到 404 怎么办」，
   * 而不是「为什么会收到 404」。
   *
   * 两个仓库之间没有共享类型、没有生成的客户端，这一串字符串是唯一的契约。所以它得有人守。
   * 下面这张表就是那份守卫：agent 侧改路由而这边没跟上，会在这里红。
   */
  describe('端点地址契约', () => {
    function captureFetch() {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      );
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    const P = '/api/agent/v1/projects/p1';
    const cases: [string, () => Promise<unknown>, string][] = [
      ['会话列表', () => listSessions('p1'), `${P}/sessions`],
      ['创建会话', () => createSession('p1'), `${P}/sessions`],
      ['会话快照', () => fetchSessionSnapshot('p1', 's1'), `${P}/sessions/s1/snapshot`],
      ['删除会话', () => deleteSession('p1', 's1'), `${P}/sessions/s1`],
      ['发送消息', () => sendSessionMessage('p1', 's1', 'hi'), `${P}/sessions/s1/messages`],
      ['会话级取消', () => cancelSession('p1', 's1'), `${P}/sessions/s1/cancel`],
      // 下面两条**不在** /sessions 里面：Run 级路由与 sessions 平级。此前正是这里错的。
      ['Run 级取消', () => cancelSessionRun('p1', 'r1'), `${P}/runs/r1/cancel`],
      ['Run 级重试', () => retrySessionRun('p1', 'r1'), `${P}/runs/r1/retry`],
      [
        '需求理解列表',
        () => fetchRequirementUnderstandings('p1', 's1'),
        `${P}/sessions/s1/requirement-understandings`,
      ],
      [
        '确认需求理解',
        () => confirmRequirementUnderstanding('p1', 's1', 'u1', 2, 'a1'),
        `${P}/sessions/s1/requirement-understandings/u1/versions/2/actions/confirm`,
      ],
      [
        '修改需求理解',
        () => correctRequirementUnderstanding('p1', 's1', 'u1', 2, 'a1', '改过的理解'),
        `${P}/sessions/s1/requirement-understandings/u1/versions/2/actions/correct`,
      ],
    ];

    it.each(cases)('%s 打在 %s', async (_name, call, expected) => {
      const fetchMock = captureFetch();
      await call();
      expect(fetchMock.mock.calls[0]?.[0]).toBe(expected);
    });

    it('带 action_id 的三个端点都真的带上了——服务端缺它会 422', async () => {
      for (const call of [
        () => cancelSession('p1', 's1'),
        () => cancelSessionRun('p1', 'r1'),
        () => retrySessionRun('p1', 'r1'),
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
