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

describe('发消息带上 Agent 模型', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('用户选了模型就写进请求体', async () => {
    const fetchMock = stubFetch(ack());

    await sendSessionMessage('p1', 's1', text, { model: 'doubao-seed-evolving' });

    expect(sentBody(fetchMock).model).toBe('doubao-seed-evolving');
  });

  it('没传模型时请求体里不出现这个字段', async () => {
    const fetchMock = stubFetch(ack());

    await sendSessionMessage('p1', 's1', text);

    expect(sentBody(fetchMock)).not.toHaveProperty('model');
  });

  it('空串不发：模型列表还没加载完时选中值就是空串', async () => {
    const fetchMock = stubFetch(ack());

    await sendSessionMessage('p1', 's1', text, { model: '' });

    expect(sentBody(fetchMock)).not.toHaveProperty('model');
  });

  it('模型与创作套路互不干扰，同一条消息可以都带', async () => {
    const fetchMock = stubFetch(ack());

    await sendSessionMessage('p1', 's1', text, {
      model: 'doubao-seed-evolving',
      forcedCreativeSkillId: 'tvc_product_ad',
    });

    const body = sentBody(fetchMock);
    expect(body.model).toBe('doubao-seed-evolving');
    expect(body.forced_creative_skill_id).toBe('tvc_product_ad');
  });
});
