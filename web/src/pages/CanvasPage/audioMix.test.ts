import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import {
  audioMixCandidate,
  audioMixTerminalPatch,
  buildAudioMixPlaceholderNode,
  findAudioMixPosition,
} from './audioMix';

const audioNode = (id: string, assetId: string, x: number, y = 0): Node => ({
  id,
  type: 'mediaNode',
  position: { x, y },
  data: { mediaType: 'audio', src: `https://example.test/${id}.mp3`, assetId, fileName: `${id}.mp3`, duration: 12 },
});

describe('画布音频混合', () => {
  it('仅允许另一张已完成且 assetId 不同的画布音频卡', () => {
    const source = audioNode('a', '1', 0);
    expect(audioMixCandidate(source, source)).toBe(false);
    expect(audioMixCandidate(source, audioNode('duplicate', '1', 600))).toBe(false);
    expect(audioMixCandidate(source, audioNode('b', '2', 600))).toBe(true);
    expect(audioMixCandidate(source, { ...audioNode('c', '3', 1200), data: { mediaType: 'audio', assetId: '3', genStatus: 'generating' } })).toBe(false);
    expect(audioMixCandidate(source, { ...audioNode('v', '4', 1200), data: { mediaType: 'video', assetId: '4', src: 'https://example.test/v.mp4' } })).toBe(false);
  });

  it('结果卡从源卡右侧就近空位开始，避开两张输入卡', () => {
    const source = audioNode('a', '1', 100);
    const second = audioNode('b', '2', 640);
    const position = findAudioMixPosition(source, [source, second]);
    expect(position.x).toBe(640);
    expect(position.y).toBeGreaterThan(0);
    const placeholder = buildAudioMixPlaceholderNode('j1', 'mp3', position);
    expect(placeholder).toMatchObject({
      id: 'audio-mix-j1', position,
      data: { src: '', fileName: '混合结果.mp3', mediaType: 'audio', genStatus: 'generating', jobId: 'j1' },
    });
  });

  it('成功仅使用服务端资产与时长回填原卡', () => {
    expect(audioMixTerminalPatch({
      status: 'succeeded', asset: { id: '88', url: 'https://tos.example/result.mp3', duration: 31.25 },
    })).toEqual({
      genStatus: undefined, progress: 100, src: 'https://tos.example/result.mp3',
      mediaType: 'audio', assetId: '88', duration: 31.25,
    });
    expect(audioMixTerminalPatch({ status: 'processing' })).toBeNull();
  });
});
