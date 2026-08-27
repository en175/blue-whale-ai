import { describe, expect, it } from 'vitest';
import { chipsFromContent, mergeConfirmedUser, projectMessage } from './userMessageProjection';
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
