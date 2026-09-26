import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import {
  audioMixCandidate,
  audioMixTerminalPatch,
  buildAudioMixPlaceholderNode,
  findAudioMixPosition,
  planAudioMixRecovery,
} from './audioMix';
import type { JobRecord } from '@/api/jobs';

const audioNode = (id: string, assetId: string, x: number, y = 0): Node => ({
  id,
  type: 'mediaNode',
  position: { x, y },
  data: { mediaType: 'audio', src: `https://example.test/${id}.mp3`, assetId, fileName: `${id}.mp3`, duration: 12 },
});

describe('画布音频混合', () => {
  const pendingJob: JobRecord = {
    job_id: '73', type: 'audio_mix', status: 'queued', progress: 0,
    input: { source_node_id: 'a', inputs: [
      { asset_id: '1', node_id: 'a', url: 'https://example.test/a.mp3' },
      { asset_id: '2', node_id: 'b', url: 'https://example.test/b.mp3' },
    ], output_format: 'mp3', estimated_duration_ms: 12000 },
    created_at: '2026-09-23T00:00:00Z', output_assets: [], error: null,
    canvas_card_state: 'pending',
  };

  it('受理后尚未落盘的任务补同一结果卡及现存来源线，多次恢复不复制', () => {
    const initial = [audioNode('a', '1', 0), audioNode('b', '2', 600)];
    const first = planAudioMixRecovery(initial, [], [pendingJob]);
    expect(first.nodes.map((node) => node.id)).toEqual(['a', 'b', 'audio-mix-73']);
    expect(first.edges.map((edge) => [edge.source, edge.target, edge.data?.origin])).toEqual([
      ['a', 'audio-mix-73', 'audio-mix'], ['b', 'audio-mix-73', 'audio-mix'],
    ]);
    expect(first.pollJobIds).toEqual(['73']);
    const again = planAudioMixRecovery(first.nodes, first.edges, [pendingJob]);
    expect(again.nodes).toHaveLength(3);
    expect(again.edges).toHaveLength(2);
  });

  it('主动删除的结果卡不复活；来源卡已删时不创建悬空线', () => {
    const initial = [audioNode('a', '1', 0)];
    const removed = planAudioMixRecovery(initial, [], [{ ...pendingJob, canvas_card_state: 'removed' }]);
    expect(removed.nodes).toEqual(initial);
    expect(removed.edges).toEqual([]);
    const accepted = planAudioMixRecovery(initial, [], [pendingJob]);
    expect(accepted.edges.map((edge) => edge.source)).toEqual(['a']);
  });

  it('服务端已重新排队时复用持久失败卡并清掉不可播放的旧错误', () => {
    const card = buildAudioMixPlaceholderNode('73', 'mp3', { x: 600, y: 0 });
    const failed = { ...card, data: { ...card.data, genStatus: 'failed', errorText: '供应商失败' } };
    const result = planAudioMixRecovery([audioNode('a', '1', 0), failed], [], [{ ...pendingJob, canvas_card_state: 'present' }]);
    expect(result.nodes.find((node) => node.id === 'audio-mix-73')?.data).toMatchObject({
      jobId: '73', genStatus: 'generating', errorText: undefined,
    });
    expect(result.pollJobIds).toEqual(['73']);
  });

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
