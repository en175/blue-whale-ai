/* 文本索引下游同步（IKFM3S）前端同源实现单测：合并参考、提示判定、发送校验、定位来源。 */
import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import {
  nextUsedInputState,
  firstTextSourceOf,
  hasTextInputs,
  imageInputStale,
  imageTargetSignature,
  imageTargetTextIndex,
  imageTextIndexSendError,
  mergedImageRefsOf,
} from './textIndexSync';

function mediaNode(id: string, assetId: string, extra: Record<string, unknown> = {}): Node {
  return {
    id,
    type: 'mediaNode',
    position: { x: 0, y: 0 },
    data: { assetId, src: `https://example.com/${id}.png`, fileName: id, mediaType: 'image', ...extra },
  };
}

function textNode(id: string, data: Record<string, unknown>): Node {
  return { id, type: 'textNode', position: { x: 0, y: 0 }, data };
}

function imageTarget(id: string, extra: Record<string, unknown> = {}): Node {
  return { id, type: 'mediaNode', position: { x: 0, y: 0 }, data: { mediaType: 'image', draft: true, ...extra } };
}

function edge(source: string, target: string, data?: Record<string, unknown>): Edge {
  return { id: `e-${source}-${target}`, source, target, type: 'custom' as never, ...(data ? { data } : {}) };
}

const INDEXED_TEXT = textNode('text-1', {
  text: '用图片1出图',
  mediaMentions: [{ start: 1, end: 4, nodeId: 'media-1', assetId: '9100' }],
  mediaRefs: [{ nodeId: 'media-1', assetId: '9100', mediaType: 'image', name: '甲图', url: 'https://example.com/m1.png' }],
});

const INDEX_EDGE = edge('media-1', 'text-1', { textIndex: true });

describe('mergedImageRefsOf', () => {
  it('直接参考在前、文本带入追加并带 textNodeId 锁定标记；同 assetId 去重保首见', () => {
    const nodes = [
      imageTarget('gen-1'),
      mediaNode('media-2', '9200'),
      mediaNode('media-1', '9100'),
      INDEXED_TEXT,
    ];
    const edges = [edge('text-1', 'gen-1'), edge('media-2', 'gen-1'), INDEX_EDGE];
    const refs = mergedImageRefsOf('gen-1', edges, nodes);
    expect(refs.map((r) => r.assetId)).toEqual(['9200', '9100']);
    expect(refs[0]!.nodeId).toBe('media-2');
    expect(refs[0]!.textNodeId).toBeUndefined();
    expect(refs[1]).toMatchObject({ nodeId: 'media-1', textNodeId: 'text-1' });
  });

  it('同素材既有直接参考又有文本提供时显示单条目（直接参考优先、可移除）', () => {
    const nodes = [
      imageTarget('gen-1'),
      mediaNode('media-1', '9100'),
      INDEXED_TEXT,
    ];
    const edges = [edge('text-1', 'gen-1'), edge('media-1', 'gen-1'), INDEX_EDGE];
    const refs = mergedImageRefsOf('gen-1', edges, nodes);
    expect(refs).toHaveLength(1);
    expect(refs[0]!.textNodeId).toBeUndefined();
  });
});

describe('imageInputStale', () => {
  const baseEdges = [edge('text-1', 'gen-1'), INDEX_EDGE];

  it('文本入边存在且无成功使用记录时显示提示；签名一致时清除', () => {
    const nodes = [imageTarget('gen-1'), mediaNode('media-1', '9100'), INDEXED_TEXT];
    expect(imageInputStale('gen-1', baseEdges, nodes)).toBe(true);
    const used = imageTarget('gen-1', { usedInputSignature: imageTargetSignature('gen-1', baseEdges, nodes) });
    expect(imageInputStale('gen-1', baseEdges, [used, mediaNode('media-1', '9100'), INDEXED_TEXT])).toBe(false);
  });

  it('正文变化后签名不一致重新提示；无文本入边或非图片目标不提示', () => {
    const nodes = [imageTarget('gen-1'), mediaNode('media-1', '9100'), INDEXED_TEXT];
    const synced = imageTarget('gen-1', { usedInputSignature: imageTargetSignature('gen-1', baseEdges, nodes) });
    const edited = textNode('text-1', { ...INDEXED_TEXT.data, text: '改成用图片1出图吧' } as Record<string, unknown>);
    expect(imageInputStale('gen-1', baseEdges, [synced, mediaNode('media-1', '9100'), edited])).toBe(true);
    expect(imageInputStale('gen-1', [INDEX_EDGE], nodes)).toBe(false);
    const videoTarget = { ...imageTarget('gen-2'), data: { mediaType: 'video', draft: true } } as Node;
    expect(imageInputStale('gen-2', [edge('text-1', 'gen-2'), INDEX_EDGE], [videoTarget, mediaNode('media-1', '9100'), INDEXED_TEXT])).toBe(false);
  });
});

describe('imageTextIndexSendError', () => {
  it('合法图片索引放行；失效索引与不支持类型分别阻止', () => {
    const okNodes = [imageTarget('gen-1'), mediaNode('media-1', '9100'), INDEXED_TEXT];
    expect(imageTextIndexSendError('gen-1', [edge('text-1', 'gen-1'), INDEX_EDGE], okNodes, 10)).toBeNull();
    // 关系线被删 → 失效索引
    expect(imageTextIndexSendError('gen-1', [edge('text-1', 'gen-1')], okNodes, 10)).toContain('失效');
    // 文本索引视频素材 → 图片目标不支持
    const videoText = textNode('text-2', {
      text: '带视频1',
      mediaMentions: [{ start: 1, end: 4, nodeId: 'media-2', assetId: '9200' }],
      mediaRefs: [{ nodeId: 'media-2', assetId: '9200', mediaType: 'video', name: '乙视频', url: 'u' }],
    });
    const videoEdge = edge('media-2', 'text-2', { textIndex: true });
    const nodes = [
      imageTarget('gen-1'),
      { ...mediaNode('media-2', '9200'), data: { ...mediaNode('media-2', '9200').data, mediaType: 'video' } } as Node,
      videoText,
    ];
    expect(imageTextIndexSendError('gen-1', [edge('text-2', 'gen-1'), videoEdge], nodes, 10)).toContain('不支持');
  });

  it('合并后超限阻止（含锁定条目计数）', () => {
    const nodes = [imageTarget('gen-1'), mediaNode('media-2', '9200'), mediaNode('media-1', '9100'), INDEXED_TEXT];
    const err = imageTextIndexSendError('gen-1', [edge('text-1', 'gen-1'), edge('media-2', 'gen-1'), INDEX_EDGE], nodes, 1);
    expect(err).toContain('参考图最多 1 张');
  });
});

describe('firstTextSourceOf / hasTextInputs / imageTargetTextIndex', () => {
  it('定位来源取第一条文本入边；文本索引派生输入与身份', () => {
    const nodes = [imageTarget('gen-1'), mediaNode('media-1', '9100'), INDEXED_TEXT];
    const edges = [edge('text-1', 'gen-1'), INDEX_EDGE];
    expect(hasTextInputs('gen-1', edges, nodes)).toBe(true);
    expect(firstTextSourceOf('gen-1', edges, nodes)).toBe('text-1');
    const index = imageTargetTextIndex('gen-1', edges, nodes);
    expect(index.inputs).toHaveLength(1);
    expect(index.inputs[0]).toMatchObject({ nodeId: 'text-1', text: '用图片1出图' });
    expect(index.inputs[0]!.identities).toEqual([
      { sourceNodeId: 'media-1', assetId: '9100', mediaType: 'image' },
    ]);
  });
});

describe('nextUsedInputState（乱序保护）', () => {
  it('无签名不写；更新的 jobId 覆盖；旧 jobId 不覆盖更晚成功', () => {
    expect(nextUsedInputState({}, undefined, '10')).toBeNull();
    expect(nextUsedInputState({}, '', '10')).toBeNull();
    expect(nextUsedInputState(undefined, 'sig-a', '10')).toEqual({ usedInputSignature: 'sig-a', usedInputJobId: 10 });
    expect(nextUsedInputState({ usedInputJobId: 10 }, 'sig-a', '10')).toBeNull();
    expect(nextUsedInputState({ usedInputJobId: 10, usedInputSignature: 'old' }, 'sig-b', '11')).toEqual({ usedInputSignature: 'sig-b', usedInputJobId: 11 });
  });
});
