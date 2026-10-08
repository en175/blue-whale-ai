// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendSessionMessage, setSessionCreativeSkills } from './agentSessions';

function captureBody() {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ message: { message_id: 'm1' } }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return () => JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
}

describe('胶囊上线格式', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('胶囊一律进 content 数组，不走并列的顶层字段', async () => {
    const read = captureBody();
    await sendSessionMessage(
      'p1',
      's1',
      [{ type: 'text', text: '  帮我做张海报  ' }],
      {
        resourceRef: [
          { type: '图片', resource_id: 'node_1', media_type: 'image', display_label: '海妖登场', resource_type: '图片' },
          { type: '商品卡', resource_id: 'node_7', display_label: '主商品卡', resource_type: '商品卡' },
        ],
        skillRef: { skill_id: 'sk_042', name: '古风插画', type: '全部' },
      },
    );

    const body = read();
    expect(body.resource_ref).toBeUndefined();
    expect(body.skill_ref).toBeUndefined();
    expect(body.content).toEqual([
      { type: 'text', text: '帮我做张海报' },
      {
        type: 'resource_ref',
        resource_type: 'asset',
        resource_id: 'node_1',
        media_type: 'image',
        display_label: '海妖登场',
        resource_kind: '图片',
      },
      {
        type: 'resource_ref',
        resource_type: 'card',
        resource_id: 'node_7',
        display_label: '主商品卡',
        resource_kind: '商品卡',
      },
      { type: 'skill_ref', skill_id: 'sk_042', name: '古风插画' },
    ]);
  });

  it('中文分类只是展示分类，判别位必须是契约的 asset / card', async () => {
    const read = captureBody();
    await sendSessionMessage('p1', 's1', [], {
      resourceRef: [
        { type: '音频', resource_id: 'n_a', media_type: 'audio', resource_type: '音频' },
        { type: '生成卡', resource_id: 'n_c', resource_type: '生成卡' },
      ],
    });
    expect(read().content.map((p: { resource_type: string }) => p.resource_type)).toEqual(['asset', 'card']);
  });

  it('带资产库身份的上传素材走 asset_ref，模型才读得到内容', async () => {
    const read = captureBody();
    await sendSessionMessage('p1', 's1', [], {
      resourceRef: [{ type: 'asset_ref', asset_id: 'ast_001', media_type: 'image', display_label: '参考图' }],
    });
    expect(read().content).toEqual([
      { type: 'asset_ref', asset_id: 'ast_001', media_type: 'image', display_label: '参考图' },
    ]);
  });

  it('asset_ref 不携带签名 URL，访问材料只留在前端预览缓存', async () => {
    const read = captureBody();
    await sendSessionMessage('p1', 's1', [], {
      resourceRef: [{
        type: 'asset_ref',
        asset_id: 'ast_v1',
        media_type: 'video',
        display_label: 'clip.mp4',
        url: 'https://cdn.example/clip.mp4',
      }],
    });
    expect(read().content).toEqual([
      { type: 'asset_ref', asset_id: 'ast_v1', media_type: 'video', display_label: 'clip.mp4' },
    ]);
  });

  it('音频即使有 asset_id 也不能走 asset_ref——agent 只认 image / video，塞进去整条 400', async () => {
    const read = captureBody();
    await sendSessionMessage('p1', 's1', [], {
      resourceRef: [{ type: '音频', asset_id: 'ast_009', media_type: 'audio', resource_type: '音频' }],
    });
    expect(read().content[0]).toMatchObject({ type: 'resource_ref', resource_type: 'asset', resource_id: 'ast_009' });
  });

  it('没有任何可用 id 的渲染残块直接丢掉，不拿它把整条消息打掉', async () => {
    const read = captureBody();
    await sendSessionMessage('p1', 's1', [{ type: 'text', text: '在' }], {
      resourceRef: [{ type: '图片', display_label: '半个块' }],
    });
    expect(read().content).toEqual([{ type: 'text', text: '在' }]);
  });

  it('老字段 forced_creative_skill_id 仍并行发送，两端上线先后不影响技能生效', async () => {
    const read = captureBody();
    await sendSessionMessage('p1', 's1', [{ type: 'text', text: '在' }], {
      forcedCreativeSkillId: 'sk_042',
      skillRef: { skill_id: 'sk_042', name: '古风插画' },
    });
    const body = read();
    expect(body.forced_creative_skill_id).toBe('sk_042');
    expect(body.content).toContainEqual({ type: 'skill_ref', skill_id: 'sk_042', name: '古风插画' });
  });

  it('文本引用快照走 text_quote 部件：正文随消息上线，不再是旧卡片版本指针（IKDLQJ）', async () => {
    const read = captureBody();
    await sendSessionMessage('p1', 's1', [{ type: 'text', text: '基于它继续改' }], {
      resourceRef: [{
        type: 'text',
        chip_id: '99',
        name: '雪夜',
        node_id: 'text-node-1',
        source: 'node',
        quote_id: '42',
        resource_id: '42',
        resource_type: '文本引用',
        display_label: '雪夜',
        resource_text: '画布实际编辑内容\n第二行',
        prompt_source: { sessionId: 's-1', revisionId: 'r-1', shotNo: 2 },
      }],
    });

    expect(read().content).toEqual([
      { type: 'text', text: '基于它继续改' },
      {
        type: 'resource_ref',
        resource_type: 'text_quote',
        resource_id: '42',
        resource_kind: '文本引用',
        node_id: 'text-node-1',
        quote_id: '42',
        source: 'node',
        display_label: '雪夜',
        resource_text: '画布实际编辑内容\n第二行',
        prompt_source: { sessionId: 's-1', revisionId: 'r-1', shotNo: 2 },
      },
    ]);
  });
});

describe('会话创作套路上线格式', () => {
  afterEach(() => vi.unstubAllGlobals());

  function captureRequest() {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ session_id: 's1', active_creative_skill_ids: ['tvc_product_ad'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return () => {
      const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
      return { url, init, body: JSON.parse(init.body as string) };
    };
  }

  it('PUT 到会话的 creative-skills，带 If-Match 与 Idempotency-Key', async () => {
    const read = captureRequest();
    await setSessionCreativeSkills('p1', 's1', ['tvc_product_ad'], 'W/"session-7"');
    const { url, init, body } = read();

    expect(url).toBe('/api/agent/v1/projects/p1/sessions/s1/creative-skills');
    expect(init.method).toBe('PUT');
    const headers = init.headers as Record<string, string>;
    expect(headers['If-Match']).toBe('W/"session-7"');
    expect(headers['Idempotency-Key']).toBeTruthy();
    expect(body).toEqual({ creative_skill_ids: ['tvc_product_ad'] });
  });

  it('取消就是发空数组——载入与取消是同一条路由', async () => {
    const read = captureRequest();
    await setSessionCreativeSkills('p1', 's1', [], 'W/"session-8"');
    expect(read().body).toEqual({ creative_skill_ids: [] });
  });

  it('一次可以发多条，顺序原样保留', async () => {
    const read = captureRequest();
    await setSessionCreativeSkills('p1', 's1', ['tvc_product_ad', 'ugc_ads_video'], 'W/"session-9"');
    expect(read().body).toEqual({ creative_skill_ids: ['tvc_product_ad', 'ugc_ads_video'] });
  });
});
