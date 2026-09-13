/* IKFCKS：连线创作能力——文本卡作为创作上下文连入音频生成节点（isAudioGenEnabled 放行 text）；
 * 既有组合规则回归（纯图/纯音频/纯视频置灰，图+视频、音频+图、音频+视频可选） */
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

describe('isAudioGenEnabled（IKFCKS 文本上下文放行）', () => {
  it('既有组合规则回归：纯图/纯音频/纯视频不可选', () => {
    expect(isAudioGenEnabled(['image'])).toBe(false);
    expect(isAudioGenEnabled(['audio'])).toBe(false);
    expect(isAudioGenEnabled(['video'])).toBe(false);
  });

  it('既有组合规则回归：图+视频、音频+图、音频+视频可选', () => {
    expect(isAudioGenEnabled(['image', 'video'])).toBe(true);
    expect(isAudioGenEnabled(['audio', 'image'])).toBe(true);
    expect(isAudioGenEnabled(['audio', 'video'])).toBe(true);
    expect(isAudioGenEnabled(['audio', 'image', 'video'])).toBe(true);
  });

  it('IKFCKS：含文本的组合可选音频生成（文本卡作为创作上下文）', () => {
    expect(isAudioGenEnabled(['text'])).toBe(true);
    expect(isAudioGenEnabled(['text', 'image'])).toBe(true);
    expect(isAudioGenEnabled(['text', 'audio'])).toBe(true);
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

  it('回归：纯图组仍不含 audio', () => {
    expect(availableGenKinds([mediaNode('i1', 'image')]).has('audio')).toBe(false);
  });
});
