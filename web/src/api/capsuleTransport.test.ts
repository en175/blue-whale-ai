// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendSessionMessage } from './agentSessions';

/**
 * 胶囊怎么上线的回归护栏（契约 docs/blueprint/capsule-contract-v1.md）。
 *
 * 这里断言的是**实际发出去的请求体**，不是我们自己的中间表示。原因是这条链路真的这样错过：
 * 胶囊曾被放在与 `content` 并列的顶层 `resource_ref` / `skill_ref` 字段上，而 agent 的
 * `parseInboundParts` 只读 `content`——于是带图带技能发过去，落库的 content 只剩那条 text，
 * 模型什么都没看到；一个字不打只带胶囊时 `content` 为空数组，整条消息被 400 掉。
 * 两端各自都「看起来对」，错的只在字节上，所以护栏必须架在字节这一层。
 */
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
    // asset_ref 会让 agent 建立 Session Asset Grant，模型经受控理解真的读到这张图；
    // resource_ref 只给一个占位标签。差别不在字段名，在模型看不看得见。
    const read = captureBody();
    await sendSessionMessage('p1', 's1', [], {
      resourceRef: [{ type: 'asset_ref', asset_id: 'ast_001', media_type: 'image', display_label: '参考图' }],
    });
    expect(read().content).toEqual([
      { type: 'asset_ref', asset_id: 'ast_001', media_type: 'image', display_label: '参考图' },
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
});
