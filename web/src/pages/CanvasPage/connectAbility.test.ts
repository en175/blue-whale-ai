/* IKGRE3：音频生成能力集收敛为 5 组合——组内不含视频，且图片与音频不同时出现。
 * 可用组合仅：单图片 / 单音频 / 单文本 / 图片+文本 / 音频+文本，其余全部不可用。 */
import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import {
  canConnectSourcesToGen,
  isAudioGenEnabled,
  availableGenKinds,
  sourceKindOf,
  genKindOf,
} from './connectAbility';

function textNode(id: string, text = '文案'): Node {
  return { id, type: 'textNode', position: { x: 0, y: 0 }, data: { text } };
}

function mediaNode(id: string, mediaType: 'image' | 'video' | 'audio'): Node {
  return {
    id,
    type: 'mediaNode',
    position: { x: 0, y: 0 },
    data: { mediaType, src: `https://x/${id}`, draft: true, genStatus: 'draft' },
  };
}

/** 成品素材卡（非草稿、带有效 src），可作为连线上游素材 */
function sourceMediaNode(id: string, mediaType: 'image' | 'video' | 'audio'): Node {
  return {
    id,
    type: 'mediaNode',
    position: { x: 0, y: 0 },
    data: { mediaType, src: `https://x/${id}` },
  };
}

describe('isAudioGenEnabled（IKGRE3 收敛为 5 组合）', () => {
  it('五种可用组合：单图片 / 单音频 / 单文本 / 图片+文本 / 音频+文本', () => {
    expect(isAudioGenEnabled(['image'])).toBe(true);
    expect(isAudioGenEnabled(['audio'])).toBe(true);
    expect(isAudioGenEnabled(['text'])).toBe(true);
    expect(isAudioGenEnabled(['image', 'text'])).toBe(true);
    expect(isAudioGenEnabled(['audio', 'text'])).toBe(true);
  });

  it('单视频不可用', () => {
    expect(isAudioGenEnabled(['video'])).toBe(false);
  });

  it('组内含视频的组合全部不可用', () => {
    expect(isAudioGenEnabled(['image', 'video'])).toBe(false);
    expect(isAudioGenEnabled(['audio', 'video'])).toBe(false);
    expect(isAudioGenEnabled(['video', 'text'])).toBe(false);
    expect(isAudioGenEnabled(['image', 'video', 'audio'])).toBe(false);
    expect(isAudioGenEnabled(['image', 'video', 'text'])).toBe(false);
    expect(isAudioGenEnabled(['video', 'audio', 'text'])).toBe(false);
    expect(isAudioGenEnabled(['image', 'video', 'audio', 'text'])).toBe(false);
  });

  it('图片与音频同时出现的组合不可用', () => {
    expect(isAudioGenEnabled(['image', 'audio'])).toBe(false);
    expect(isAudioGenEnabled(['image', 'audio', 'text'])).toBe(false);
  });
});

describe('canConnectSourcesToGen：文本卡 → 音频生成节点（IKFCKS）', () => {
  it('画布文本卡可连音频生成节点', () => {
    const node = textNode('t1', '旁白文案');
    expect(sourceKindOf(node)).toBe('text');
    expect(genKindOf(mediaNode('a1', 'audio'))).toBe('audio');
    expect(canConnectSourcesToGen([node], 'audio')).toBe(true);
  });

  it('availableGenKinds：纯文本组的生成类型集合含 audio', () => {
    expect(availableGenKinds([textNode('t1')]).has('audio')).toBe(true);
  });

  it('IKGRE3：纯图组放开，生成类型集合含 audio', () => {
    expect(availableGenKinds([sourceMediaNode('i1', 'image')]).has('audio')).toBe(true);
  });

  it('IKGRE3：图+音频组不含 audio', () => {
    expect(availableGenKinds([sourceMediaNode('i1', 'image'), sourceMediaNode('a1', 'audio')]).has('audio')).toBe(false);
  });
});
