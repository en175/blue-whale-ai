// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendSessionMessage } from './agentSessions';

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const res of responses) fetchMock.mockResolvedValueOnce(res);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function ack() {
  return new Response(JSON.stringify({ message: { message_id: 'm1' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>) {
  const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

const text = [{ type: 'text' as const, text: '做一条手冲咖啡短视频' }];

describe('发消息不带 Agent 模型（IKHCK4）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('请求体里不出现 model，创作套路照常带', async () => {
    const fetchMock = stubFetch(ack());

    await sendSessionMessage('p1', 's1', text, { forcedCreativeSkillId: 'tvc_product_ad' });

    const body = sentBody(fetchMock);
    expect(body).not.toHaveProperty('model');
    expect(body.forced_creative_skill_id).toBe('tvc_product_ad');
  });
});
