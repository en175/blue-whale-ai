import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import {
  audioMediaRefsOf,
  audioRefSourceError,
  checkAddAudioRef,
  isAudioDraftNode,
  MAX_AUDIO_MEDIA_REFS,
} from './audioMediaRefs';
import { MEDIA_EXTRACT_EDGE_ORIGIN } from './mediaExtract';
import { AUDIO_SPEED_EDGE_ORIGIN } from './audioSpeed';
import { AUDIO_TRIM_EDGE_ORIGIN } from './audioTrim';
import { AUDIO_MIX_EDGE_ORIGIN } from './audioMix';

/* IKFDFZ 音频参考连线：来源有效性校验、「连线 → 媒体参考」推导与统一添加校验。
   面板展示与提交输入共用同一推导，保证所见即实际输入。 */

function mediaNode(id: string, data: Record<string, unknown>): Node {
  return { id, type: 'mediaNode', position: { x: 0, y: 0 }, data };
}

const readyAudio = (id: string, assetId: string | number = `a-${id}`, extra: Record<string, unknown> = {}) =>
  mediaNode(id, { src: `http://aud/${id}.mp3`, mediaType: 'audio', fileName: `音${id}`, assetId, ...extra });

describe('audioRefSourceError 来源有效性校验', () => {
  it('就绪音频节点（有 src 与 assetId）可作为参考', () => {
    expect(audioRefSourceError(readyAudio('u1'))).toBeNull();
    expect(audioRefSourceError(readyAudio('u2', 12345))).toBeNull();
  });

  it('待生成/生成中/失败的草稿身份卡不能作为参考', () => {
    expect(audioRefSourceError(readyAudio('d1', '', { genStatus: 'draft', draft: true, src: '', assetId: undefined }))).toBe('待生成的草稿不能作为参考');
    expect(audioRefSourceError(readyAudio('g1', '', { genStatus: 'generating', src: '', assetId: undefined }))).toBe('生成中的卡片不能作为参考');
    expect(audioRefSourceError(readyAudio('f1', '', { genStatus: 'failed', src: '', assetId: undefined }))).toBe('生成失败的卡片不能作为参考');
  });

  it('失效（素材已被删除）与上传中的来源被拒绝', () => {
    expect(audioRefSourceError(readyAudio('u1', 'a1', { assetMissing: true }))).toBe('素材已被删除');
    expect(audioRefSourceError(readyAudio('u2', 'a2', { src: 'blob:local-preview' }))).toBe('素材上传中，请稍候再选择');
    expect(audioRefSourceError(mediaNode('u3', { src: '', mediaType: 'audio' }))).toBe('素材已被删除');
  });

  it('图片节点可作为音频参考，视频节点不能', () => {
    expect(audioRefSourceError(readyAudio('m1', 'a9', { mediaType: 'image', src: 'http://img/m1.png' }))).toBeNull();
    expect(audioRefSourceError(readyAudio('v1', 'a8', { mediaType: 'video', src: 'http://vid/v1.mp4' }))).toBe('音频参考仅支持图片或音频素材');
  });

  it('无 assetId 的来源被拒绝（连线语义需要资产身份）', () => {
    const node = mediaNode('u1', { src: 'http://aud/u1.mp3', mediaType: 'audio' });
    expect(audioRefSourceError(node)).toBe('素材未关联资产，无法作为参考');
  });

  it('来源不存在时防御性拒绝', () => {
    expect(audioRefSourceError(undefined)).toBe('素材不存在');
  });
});

describe('isAudioDraftNode 音频草稿身份判定', () => {
  it('draft 标记 + 音频媒体类型才算音频草稿目标', () => {
    expect(isAudioDraftNode(mediaNode('d1', { draft: true, mediaType: 'audio', genStatus: 'draft' }))).toBe(true);
    expect(isAudioDraftNode(mediaNode('d2', { draft: true, mediaType: 'audio', genStatus: 'failed' }))).toBe(true);
    expect(isAudioDraftNode(mediaNode('u1', { mediaType: 'audio' }))).toBe(false);
    expect(isAudioDraftNode(mediaNode('v1', { draft: true, mediaType: 'video' }))).toBe(false);
    expect(isAudioDraftNode(undefined)).toBe(false);
  });
});

describe('audioMediaRefsOf 连线推导音频参考', () => {
  const nodes = [
    readyAudio('u1', 'a1'),
    readyAudio('u2', 'a2'),
    readyAudio('u3', 'a3'),
    readyAudio('pic', 'a9', { mediaType: 'image', src: 'http://img/pic.png' }),
    readyAudio('gone', 'a7', { assetMissing: true, src: '' }),
  ];
  const edges = [
    { id: 'e1', source: 'u2', target: 'd1' },
    { id: 'e2', source: 'pic', target: 'd1' },
    { id: 'e3', source: 'u1', target: 'other' },
    { id: 'e4', source: 'u1', target: 'd1' },
    { id: 'e5', source: 'gone', target: 'd1' },
    { id: 'e6', source: 'missing-node', target: 'd1' },
  ] as Edge[];

  it('按连线顺序推导目标的有效图片/音频参考；视频与失效来源进 invalid 并保留原因；悬空/其他目标连线跳过', () => {
    expect(audioMediaRefsOf('d1', edges, nodes).refs).toEqual([
      { nodeId: 'u2', url: 'http://aud/u2.mp3', name: '音u2', assetId: 'a2', mediaType: 'audio' },
      { nodeId: 'pic', url: 'http://img/pic.png', name: '音pic', assetId: 'a9', mediaType: 'image' },
      { nodeId: 'u1', url: 'http://aud/u1.mp3', name: '音u1', assetId: 'a1', mediaType: 'audio' },
    ]);
    const invalid = audioMediaRefsOf('d1', edges, nodes).invalid;
    expect(invalid).toContainEqual({ nodeId: 'gone', name: '音gone', reason: '素材已被删除' });
  });

  it('同一素材（相同 assetId）多条连线推导时去重，首条连线位置保留', () => {
    const dup = [      readyAudio('u1', 'a1'),
      readyAudio('u1-copy', 'a1'),
    ];
    const dupEdges = [
      { id: 'e1', source: 'u1-copy', target: 'd1' },
      { id: 'e2', source: 'u1', target: 'd1' },
    ] as Edge[];
    expect(audioMediaRefsOf('d1', dupEdges, dup).refs).toEqual([
      { nodeId: 'u1-copy', url: 'http://aud/u1-copy.mp3', name: '音u1-copy', assetId: 'a1', mediaType: 'audio' },
    ]);
  });

  it('fileName 缺省时回退节点 id；assetId 数字形态字符串化；data 为 undefined 的悬空节点不抛错', () => {
    const bare = [mediaNode('u9', { src: 'http://aud/u9.mp3', mediaType: 'audio', assetId: 42 })];
    expect(audioMediaRefsOf('d1', [{ id: 'e1', source: 'u9', target: 'd1' }] as Edge[], bare).refs).toEqual([
      { nodeId: 'u9', url: 'http://aud/u9.mp3', name: 'u9', assetId: '42', mediaType: 'audio' },
    ]);
    const dangling = [{ id: 'x', type: 'mediaNode', position: { x: 0, y: 0 } }] as Node[];
    expect(audioMediaRefsOf('d1', [{ id: 'e1', source: 'x', target: 'd1' }] as Edge[], dangling).refs).toEqual([]);
    expect(audioMediaRefsOf('d1', [{ id: 'e1', source: 'x', target: 'd1' }] as Edge[], dangling).invalid)
      .toEqual([{ nodeId: 'x', name: 'x', reason: '音频参考仅支持图片或音频素材' }]);
  });

  it('提取来源边（origin 标记）既不算参考、也不进 invalid（IKFS5W）', () => {
    const video = mediaNode('v1', { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '视频', assetId: 'a9' });
    const sourceEdges = [
      { id: 'src', source: 'v1', target: 'extracted', data: { origin: MEDIA_EXTRACT_EDGE_ORIGIN } },
      { id: 'e2', source: 'u2', target: 'extracted' },
    ] as Edge[];
    const result = audioMediaRefsOf('extracted', sourceEdges, [...nodes, video]);
    expect(result.invalid).toEqual([]);
    expect(result.refs).toEqual([
      { nodeId: 'u2', url: 'http://aud/u2.mp3', name: '音u2', assetId: 'a2', mediaType: 'audio' },
    ]);
  });

  it('截取来源边（origin=audio-trim）跳过：源音频是合法素材但不占参考位（IKHB08 防参考污染）', () => {
    const sourceEdges = [
      { id: 'src', source: 'u1', target: 'trimmed', data: { origin: AUDIO_TRIM_EDGE_ORIGIN } },
      { id: 'e2', source: 'u2', target: 'trimmed' },
    ] as Edge[];
    const result = audioMediaRefsOf('trimmed', sourceEdges, nodes);
    expect(result.invalid).toEqual([]);
    expect(result.refs).toEqual([
      { nodeId: 'u2', url: 'http://aud/u2.mp3', name: '音u2', assetId: 'a2', mediaType: 'audio' },
    ]);
  });

  it('两条混合来源边均不占参考位或 @ 编号', () => {
    const sourceEdges = [
      { id: 'mix1', source: 'u1', target: 'mixed', data: { origin: AUDIO_MIX_EDGE_ORIGIN } },
      { id: 'mix2', source: 'u2', target: 'mixed', data: { origin: AUDIO_MIX_EDGE_ORIGIN } },
    ] as Edge[];
    expect(audioMediaRefsOf('mixed', sourceEdges, nodes)).toEqual({ refs: [], invalid: [] });
  });

  it('调速来源边（origin=audio-speed）跳过：源音频不占参考位、不进 invalid，用户主动连线参考正常（IKI4M2）', () => {
    const sourceEdges = [
      { id: 'src', source: 'u1', target: 'speeded', data: { origin: AUDIO_SPEED_EDGE_ORIGIN } },
      { id: 'e2', source: 'u2', target: 'speeded' },
    ] as Edge[];
    const result = audioMediaRefsOf('speeded', sourceEdges, nodes);
    expect(result.invalid).toEqual([]);
    expect(result.refs).toEqual([
      { nodeId: 'u2', url: 'http://aud/u2.mp3', name: '音u2', assetId: 'a2', mediaType: 'audio' },
    ]);
  });

  it('调速来源边的源音频删除/失效后仍跳过：不进 invalid、不阻塞成品再生成（IKI4M2）', () => {
    const gone = readyAudio('gone-src', 'a-gone', { assetMissing: true, src: '' });
    const sourceEdges = [
      { id: 'src', source: 'gone-src', target: 'speeded', data: { origin: AUDIO_SPEED_EDGE_ORIGIN } },
    ] as Edge[];
    const result = audioMediaRefsOf('speeded', sourceEdges, [...nodes, gone]);
    expect(result.refs).toEqual([]);
    expect(result.invalid).toEqual([]);
  });
});

describe('checkAddAudioRef 统一添加校验', () => {
  const ref = (nodeId: string, assetId: string) => ({ nodeId, url: `http://aud/${nodeId}.mp3`, name: nodeId, assetId, mediaType: 'audio' as const });

  it('重复素材（相同 assetId）明确拒绝', () => {
    expect(checkAddAudioRef('a1', [ref('u1', 'a1'), ref('u2', 'a2')])).toBe('重复的素材已跳过');
  });

  it('达到上限（连线推导 + 本地上传合计）拒绝添加', () => {
    const full = [ref('u1', 'a1'), ref('u2', 'a2'), ref('u3', 'a3')];
    expect(checkAddAudioRef('a4', full)).toBe(`参考音频最多 ${MAX_AUDIO_MEDIA_REFS} 段`);
    expect(checkAddAudioRef(undefined, [ref('u1', 'a1'), ref('u2', 'a2')], 1)).toBe(`参考音频最多 ${MAX_AUDIO_MEDIA_REFS} 段`);
  });

  it('合法添加返回 null（无重复且未达上限）', () => {
    expect(checkAddAudioRef('a3', [ref('u1', 'a1'), ref('u2', 'a2')])).toBeNull();
    expect(checkAddAudioRef(undefined, [])).toBeNull();
    expect(checkAddAudioRef('img1', [], 0, 'image')).toBeNull();
  });

  it('图片与音频不可混用，图片上限 1 个', () => {
    const imageRef = { nodeId: 'p1', url: 'http://img/p1.png', name: '图', assetId: 'img1', mediaType: 'image' as const };
    expect(checkAddAudioRef('a1', [imageRef], 0, 'audio')).toBe('音频与图片参考不可混用');
    expect(checkAddAudioRef('img2', [imageRef], 0, 'image')).toBe('参考图最多 1 个');
    expect(checkAddAudioRef('img1', [ref('u1', 'a1')], 0, 'image')).toBe('音频与图片参考不可混用');
  });
});
