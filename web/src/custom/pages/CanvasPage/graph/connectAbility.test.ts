import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import {
  canConnectSourcesToGen,
  isAudioGenEnabled,
  availableGenKinds,
  availableGenKindsAsTarget,
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

describe('IKR643 左侧加号：按目标节点反查可用来源类型', () => {
  it('目标是视频生成卡时，图片/视频/音频/文本都可作为来源', () => {
    const kinds = availableGenKindsAsTarget(mediaNode('t1', 'video'));
    expect([...kinds].sort()).toEqual(['audio', 'image', 'text', 'video']);
  });

  it('目标是图片生成卡时，视频与音频不能作为来源', () => {
    const kinds = availableGenKindsAsTarget(mediaNode('t2', 'image'));
    expect(kinds.has('image')).toBe(true);
    expect(kinds.has('text')).toBe(true);
    expect(kinds.has('video')).toBe(false);
    expect(kinds.has('audio')).toBe(false);
  });

  it('目标是音频生成卡时无候选，菜单显示无可连接提示', () => {
    expect(availableGenKindsAsTarget(mediaNode('t3', 'audio')).size).toBe(0);
  });

  it('目标正在生成或为空壳时无候选', () => {
    const generating: Node = {
      id: 'g1', type: 'mediaNode', position: { x: 0, y: 0 },
      data: { mediaType: 'video', src: 'https://x/g1', draft: true, genStatus: 'generating' },
    };
    expect(availableGenKindsAsTarget(generating).size).toBe(0);
    expect(availableGenKindsAsTarget(undefined).size).toBe(0);
  });

  it('非生成承载的普通媒体节点不作为连线目标，无候选', () => {
    const plain: Node = { id: 'm1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { mediaType: 'video', src: 'https://x/m1' } };
    expect(availableGenKindsAsTarget(plain).size).toBe(0);
  });
});
