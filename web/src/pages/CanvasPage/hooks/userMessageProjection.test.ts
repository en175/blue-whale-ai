import { describe, expect, it } from 'vitest';
import { chipsFromContent, collectMissingQuoteIds, mergeConfirmedUser, patchQuoteTexts, projectMessage } from './userMessageProjection';
import type { ChatMessage } from './useAgentSession';

describe('chipsFromContent', () => {
  it('rebuilds @ mention chips from persisted asset_ref parts (IKBCV3)', () => {
    expect(
      chipsFromContent([
        { type: 'text', text: '这个图是什么' },
        { type: 'asset_ref', asset_id: 'ast_1', media_type: 'image', display_label: '参考图' },
      ]),
    ).toEqual([{ id: 'ast_1', label: '参考图' }]);
  });

  it('rebuilds a video mention as a video placeholder', () => {
    expect(
      chipsFromContent([
        { type: 'asset_ref', asset_id: 'video_1', media_type: 'video', display_label: 'scene.mp4' },
      ]),
    ).toEqual([{ id: 'video_1', label: '[视频] scene.mp4' }]);
  });

  it('rebuilds text quote chips from persisted text_quote parts (IKDLQJ)', () => {
    expect(
      chipsFromContent([
        { type: 'text', text: '基于它继续改' },
        { type: 'resource_ref', resource_type: 'text_quote', resource_id: '42', display_label: '雪夜' },
      ]),
    ).toEqual([{ id: '42', label: '雪夜' }]);
  });
});

describe('quote text hydration (IKDLQJ)', () => {
  it('collects quote ids whose text was not round-tripped, and patches them back', () => {
    const messages: ChatMessage[] = [
      {
        id: 'm-1',
        role: 'user',
        content: '改一版',
        sequence_no: 1,
        inputBatchId: null,
        blocks: [
          { type: 'text', text: '改一版' },
          { type: 'resource_ref', resource_type: 'text_quote', resource_id: '42', display_label: '雪夜' },
          { type: 'resource_ref', resource_type: 'text_quote', resource_id: '43', display_label: '带正文的', resource_text: '已在' },
        ],
      },
    ];
    expect(collectMissingQuoteIds(messages)).toEqual(['42']);
    const patched = patchQuoteTexts(messages, [
      { quoteId: '42', text: '回读正文\n第二行' },
    ]);
    const blocks = patched[0]!.blocks!;
    expect(blocks[1]).toMatchObject({ resource_id: '42', resource_text: '回读正文\n第二行' });
    expect(blocks[2]).toMatchObject({ resource_id: '43', resource_text: '已在' });
    // 原消息不被改写
    expect(messages[0]!.blocks![1]).not.toHaveProperty('resource_text');
  });
});

describe('projectMessage', () => {
  it('keeps asset_ref blocks and chips so history can render the mentioned image (IKBCV3)', () => {
    const msg = projectMessage({
      message_id: 'm-1',
      sequence: 1,
      role: 'user',
      content: [
        { type: 'text', text: '这个图是什么' },
        { type: 'asset_ref', asset_id: 'ast_1', media_type: 'image', display_label: '参考图' },
      ],
    });
    expect(msg.content).toBe('这个图是什么');
    expect(msg.chips).toEqual([{ id: 'ast_1', label: '参考图' }]);
    expect(msg.blocks).toEqual([
      { type: 'text', text: '这个图是什么' },
      { type: 'asset_ref', asset_id: 'ast_1', media_type: 'image', display_label: '参考图' },
    ]);
  });
});

describe('mergeConfirmedUser', () => {
  it('keeps mention blocks after the server ack so the bubble still shows the image (IKBCV3)', () => {
    const blocks = [
      {
        type: 'image',
        asset_id: 'ast_1',
        media_type: 'image' as const,
        url: 'https://cdn.example/a.png',
        display_label: '参考图',
        chip_id: 'c1',
      },
    ];
    const prev: ChatMessage[] = [
      {
        id: 'u-1',
        role: 'user',
        content: '看看这张',
        blocks,
        chips: [{ id: 'c1', label: '参考图' }],
        optimistic: true,
        sequence_no: Number.MAX_SAFE_INTEGER,
      },
    ];

    const next = mergeConfirmedUser(prev, {
      message_id: 'm-9',
      sequence: 3,
      role: 'user',
      content: [{ type: 'text', text: '看看这张' }],
    });

    expect(next[0]).toMatchObject({
      id: 'm-9',
      content: '看看这张',
      chips: [{ id: 'c1', label: '参考图' }],
      blocks,
    });
    expect(next[0].optimistic).toBeUndefined();
  });
});
