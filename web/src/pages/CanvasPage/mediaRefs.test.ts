import type { Edge, Node } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import {
  imageMediaRefsOf,
  imageRefSourceError,
  isImageDraftNode,
} from './mediaRefs';

/* IKDMQR 图片参考连线：来源有效性校验与「连线 → 媒体参考」推导。
   Dock 展示与提交输入共用同一推导，保证所见即实际输入。 */

function mediaNode(id: string, data: Record<string, unknown>): Node {
  return { id, type: 'mediaNode', position: { x: 0, y: 0 }, data };
}

const readyImage = (id: string, assetId: string | number = `a-${id}`, extra: Record<string, unknown> = {}) =>
  mediaNode(id, { src: `http://img/${id}.png`, mediaType: 'image', fileName: `图${id}`, assetId, ...extra });

describe('imageRefSourceError 来源有效性校验', () => {
  it('就绪图片节点（有 src 与 assetId）可作为参考', () => {
    expect(imageRefSourceError(readyImage('m1'))).toBeNull();
    expect(imageRefSourceError(readyImage('m2', 12345))).toBeNull();
  });

  it('待生成/生成中/失败的草稿身份卡不能作为参考', () => {
    expect(imageRefSourceError(readyImage('d1', '', { genStatus: 'draft', draft: true, src: '', assetId: undefined }))).toBe('待生成的草稿不能作为参考');
    expect(imageRefSourceError(readyImage('g1', '', { genStatus: 'generating', src: '', assetId: undefined }))).toBe('生成中的卡片不能作为参考');
    expect(imageRefSourceError(readyImage('f1', '', { genStatus: 'failed', src: '', assetId: undefined }))).toBe('生成失败的卡片不能作为参考');
  });

  it('失效（素材已被删除）与上传中的来源被拒绝', () => {
    expect(imageRefSourceError(readyImage('m1', 'a1', { assetMissing: true }))).toBe('素材已被删除');
    expect(imageRefSourceError(readyImage('m2', 'a2', { src: 'blob:local-preview' }))).toBe('素材上传中，请稍候再选择');
    expect(imageRefSourceError(mediaNode('m3', { src: '', mediaType: 'image' }))).toBe('素材已被删除');
  });

  it('视频/音频节点不能作为图片参考', () => {
    expect(imageRefSourceError(readyImage('v1', 'a9', { mediaType: 'video', src: 'http://vid/v1.mp4' }))).toBe('图片参考仅支持图片素材');
    expect(imageRefSourceError(readyImage('u1', 'a8', { mediaType: 'audio', src: 'http://aud/u1.mp3' }))).toBe('图片参考仅支持图片素材');
  });

  it('无 assetId 的来源被拒绝（连线语义需要资产身份）', () => {
    const node = mediaNode('m1', { src: 'http://img/m1.png', mediaType: 'image' });
    expect(imageRefSourceError(node)).toBe('素材未关联资产，无法作为参考');
  });

  it('来源不存在时防御性拒绝', () => {
    expect(imageRefSourceError(undefined)).toBe('素材不存在');
  });
});

describe('isImageDraftNode 图片草稿身份判定', () => {
  it('draft 标记 + 图片媒体类型才算图片草稿目标', () => {
    expect(isImageDraftNode(mediaNode('d1', { draft: true, mediaType: 'image', genStatus: 'draft' }))).toBe(true);
    expect(isImageDraftNode(mediaNode('d2', { draft: true, mediaType: 'image', genStatus: 'failed' }))).toBe(true);
    expect(isImageDraftNode(mediaNode('m1', { mediaType: 'image' }))).toBe(false);
    expect(isImageDraftNode(mediaNode('v1', { draft: true, mediaType: 'video' }))).toBe(false);
    expect(isImageDraftNode(undefined)).toBe(false);
  });
});

describe('imageMediaRefsOf 连线推导图片参考', () => {
  const nodes = [
    mediaNode('t1', {}), // 非图片媒体形态防御
    readyImage('m1', 'a1'),
    readyImage('m2', 'a2'),
    readyImage('v1', 'a9', { mediaType: 'video', src: 'http://vid/v1.mp4' }),
    readyImage('gone', 'a7', { assetMissing: true, src: '' }),
  ];
  const edges = [
    { id: 'e1', source: 'm2', target: 'd1' },
    { id: 'e2', source: 'v1', target: 'd1' },
    { id: 'e3', source: 'm1', target: 'other' },
    { id: 'e4', source: 'm1', target: 'd1' },
    { id: 'e5', source: 'gone', target: 'd1' },
    { id: 'e6', source: 'missing-node', target: 'd1' },
  ] as Edge[];

  it('按连线顺序推导目标的有效图片参考，跳过无效/失效/悬空来源与其他目标的连线', () => {
    expect(imageMediaRefsOf('d1', edges, nodes)).toEqual([
      { nodeId: 'm2', url: 'http://img/m2.png', name: '图m2', assetId: 'a2' },
      { nodeId: 'm1', url: 'http://img/m1.png', name: '图m1', assetId: 'a1' },
    ]);
    expect(imageMediaRefsOf('other', edges, nodes)).toEqual([
      { nodeId: 'm1', url: 'http://img/m1.png', name: '图m1', assetId: 'a1' },
    ]);
    expect(imageMediaRefsOf('nobody', edges, nodes)).toEqual([]);
  });

  it('fileName 缺省时回退节点 id；assetId 数字形态字符串化', () => {
    const list = imageMediaRefsOf('d1', [{ id: 'e1', source: 'm9', target: 'd1' }] as Edge[], [
      mediaNode('m9', { src: 'http://img/m9.png', mediaType: 'image', assetId: 99 }),
    ]);
    expect(list).toEqual([{ nodeId: 'm9', url: 'http://img/m9.png', name: 'm9', assetId: '99' }]);
  });

  it('兼容 asset_id/assetID 历史形态；同一素材（相同 assetId）多条连线推导时去重，首个连线位置保留', () => {
    const nodes = [
      mediaNode('m1', { src: 'http://img/m1.png', mediaType: 'image', fileName: '一', assetId: 'a1' }),
      mediaNode('m2', { src: 'http://img/m2.png', mediaType: 'image', fileName: '二', asset_id: 'a2' }),
      mediaNode('m3', { src: 'http://img/m3.png', mediaType: 'image', fileName: '一副本', assetID: 'a1' }),
    ];
    const edges = [
      { id: 'e1', source: 'm3', target: 'd1' },
      { id: 'e2', source: 'm2', target: 'd1' },
      { id: 'e3', source: 'm1', target: 'd1' },
    ] as Edge[];
    // m3 与 m1 同素材 a1：首条连线（m3）保留，m1 跳过；asset_id/assetID 形态均可推导
    expect(imageMediaRefsOf('d1', edges, nodes)).toEqual([
      { nodeId: 'm3', url: 'http://img/m3.png', name: '一副本', assetId: 'a1' },
      { nodeId: 'm2', url: 'http://img/m2.png', name: '二', assetId: 'a2' },
    ]);
  });

  it('data 为 undefined 的悬空节点不抛错', () => {
    const node = mediaNode('m1', undefined as unknown as Record<string, unknown>);
    expect(imageRefSourceError(node)).toBe('素材已被删除');
    expect(imageMediaRefsOf('d1', [{ id: 'e1', source: 'm1', target: 'd1' }] as Edge[], [node])).toEqual([]);
  });
});
