import { describe, expect, it } from 'vitest';
import type { Turn } from '../../hooks/agent/sessionTimeline';
import type { ChatMessage } from '../../hooks/agent/useAgentSession';
import { collectKnownAssets, rehypeAssetMentions, splitByAssetMentions, type KnownAsset } from './assetMentions';

const smoke: KnownAsset = { assetId: '1001', label: '_smoke.jpg', mediaType: 'image' };
const hotel: KnownAsset = { assetId: '1002', label: '231e92a969e442b29aa908093e6f33cb.jpg', mediaType: 'image' };
const clip: KnownAsset = { assetId: '1003', label: '开场.mp4', mediaType: 'video' };

const user = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 'u1',
  role: 'user',
  content: '',
  sequence_no: 1,
  ...over,
});
const turnWith = (...messages: ChatMessage[]): Turn =>
  ({ key: 'A', batchId: 'A', user: messages, assistant: null, live: null, runId: null, account: null }) as Turn;

describe('collectKnownAssets', () => {
  it('从用户消息的 asset_ref / 图片 / 视频部件收集，按名字长度降序，同一 id 只留一份', () => {
    const turns = [
      turnWith(
        user({
          id: 'u1',
          blocks: [
            { type: 'asset_ref', asset_id: '1002', media_type: 'image', display_label: hotel.label },
            { type: 'text', text: '照这张来' },
          ],
        }),
      ),
      turnWith(
        user({
          id: 'u2',
          blocks: [{ type: 'asset_ref', asset_id: '1001', media_type: 'image', display_label: '_smoke.jpg' }],
          resource_ref: [{ type: 'video', asset_id: '1003', media_type: 'video', display_label: '开场.mp4', url: 'blob:x' }],
        }),
      ),
      turnWith(user({ id: 'u3', blocks: [{ type: 'asset_ref', asset_id: '1001', media_type: 'image', display_label: '_smoke.jpg' }] })),
    ];
    expect(collectKnownAssets(turns)).toEqual([hotel, smoke, { ...clip, url: 'blob:x' }]);
  });

  it('没有 asset_id、或名字短于三个字的不算——「图」会把正文里的普通字变成胶囊', () => {
    const turns = [
      turnWith(
        user({
          blocks: [
            { type: 'image', media_type: 'image', display_label: 'no-id.jpg' },
            { type: 'asset_ref', asset_id: '9', media_type: 'image', display_label: '图' },
            { type: 'asset_ref', asset_id: '10', media_type: 'audio' as never, display_label: 'song.mp3' },
          ],
        }),
      ),
    ];
    expect(collectKnownAssets(turns)).toEqual([]);
  });
});

describe('splitByAssetMentions', () => {
  const assets = [hotel, smoke, clip];

  it('命中的名字换成素材，其余原样；一段里出现几次画几次', () => {
    expect(splitByAssetMentions('先看 _smoke.jpg，再对照 _smoke.jpg 的构图。', assets)).toEqual([
      '先看 ',
      { asset: smoke },
      '，再对照 ',
      { asset: smoke },
      ' 的构图。',
    ]);
  });

  it('不认识的文件名不动', () => {
    expect(splitByAssetMentions('参考 other.png 的色调', assets)).toEqual(['参考 other.png 的色调']);
  });

  it('流式半截名字还是字——打到完整那一刻才换', () => {
    expect(splitByAssetMentions('你上传的 _smoke.j', assets)).toEqual(['你上传的 _smoke.j']);
    expect(splitByAssetMentions('你上传的 _smoke.jpg', assets)).toEqual(['你上传的 ', { asset: smoke }]);
  });

  it('两侧紧贴 ASCII 字母数字不算整名；紧贴中文、标点、括号都算', () => {
    expect(splitByAssetMentions('my_smoke.jpg2', assets)).toEqual(['my_smoke.jpg2']);
    expect(splitByAssetMentions('（素材编号 231e92a969e442b29aa908093e6f33cb.jpg）', assets)).toEqual([
      '（素材编号 ',
      { asset: hotel },
      '）',
    ]);
    expect(splitByAssetMentions('开场.mp4是第一镜', assets)).toEqual([{ asset: clip }, '是第一镜']);
  });

  it('没有已知素材时原样返回', () => {
    expect(splitByAssetMentions('随便一句', [])).toEqual(['随便一句']);
  });
});

describe('rehypeAssetMentions', () => {
  type Node = { type: string; tagName?: string; value?: string; children?: Node[]; properties?: Record<string, unknown> };
  const text = (value: string): Node => ({ type: 'text', value });
  const el = (tagName: string, ...children: Node[]): Node => ({ type: 'element', tagName, properties: {}, children });
  const run = (tree: Node) => {
    rehypeAssetMentions([smoke, hotel])()(tree as never);
    return tree;
  };

  it('段落里的名字变成带 data 属性的 span，前后的字保留', () => {
    const tree = run({ type: 'root', children: [el('p', text('看 _smoke.jpg 这张'))] });
    const p = tree.children![0]!;
    expect(p.children!.map((n) => n.type)).toEqual(['text', 'element', 'text']);
    expect(p.children![1]!.properties).toMatchObject({ 'data-asset-mention': '1001', 'data-asset-label': '_smoke.jpg', 'data-asset-media': 'image' });
  });

  it('围栏代码块与链接里不动；整个行内代码就是一个文件名时整个换成胶囊', () => {
    const tree = run({
      type: 'root',
      children: [
        el('pre', el('code', text('_smoke.jpg'))),
        el('p', el('a', text('_smoke.jpg'))),
        el('p', el('code', text('_smoke.jpg'))),
        el('p', el('code', text('load(_smoke.jpg)'))),
      ],
    });
    const [pre, link, inlineOnly, inlineMixed] = tree.children!;
    expect(pre!.children![0]!.children![0]!.type).toBe('text');
    expect(link!.children![0]!.children![0]!.type).toBe('text');
    expect(inlineOnly!.children![0]!.tagName).toBe('span');
    expect(inlineOnly!.children![0]!.properties).toMatchObject({ 'data-asset-mention': '1001' });
    expect(inlineMixed!.children![0]!.tagName).toBe('code');
  });

  it('没有命中的树一个节点都不换', () => {
    const tree = run({ type: 'root', children: [el('p', text('普通一句'))] });
    expect(tree.children![0]!.children).toEqual([text('普通一句')]);
  });
});
