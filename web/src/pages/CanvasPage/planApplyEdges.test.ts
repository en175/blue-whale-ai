import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import {
  appliedPlanAssetIds,
  dropReversedTextIndexEdges,
  replaceMissingPlanMediaNodes,
  textIndexEdgesForAppliedPlan,
} from './planApplyEdges';

function media(id: string, assetId: string): Node {
  return { id, type: 'mediaNode', position: { x: 0, y: 0 }, data: { assetId } };
}

function text(id: string, data: Record<string, unknown> = {}): Node {
  return { id, type: 'textNode', position: { x: 0, y: 0 }, data };
}

describe('appliedPlanAssetIds', () => {
  it('合并 mediaRefs、promptMaterials 与卡上参考 id', () => {
    const node = text('t1', {
      mediaRefs: [{ assetId: '1' }],
      promptMaterials: [{ assetId: '2' }],
    });
    expect(appliedPlanAssetIds(node, ['2', '3'])).toEqual(['1', '2', '3']);
  });
});

describe('dropReversedTextIndexEdges', () => {
  it('只丢掉生成卡作为 source 的 textIndex 边', () => {
    const edges: Edge[] = [
      { id: 'a', source: 't1', target: 'm1', data: { textIndex: true } },
      { id: 'b', source: 'm1', target: 't1', data: { textIndex: true } },
      { id: 'c', source: 't1', target: 'draft' },
    ];
    expect(dropReversedTextIndexEdges('t1', edges).map((e) => e.id)).toEqual(['b', 'c']);
  });
});

describe('textIndexEdgesForAppliedPlan', () => {
  it('按 assetId 复用画布已有图片节点，方向 media → 生成卡', () => {
    const nodes = [media('img-a', '100'), text('plan-1')];
    const added = textIndexEdgesForAppliedPlan('plan-1', ['100'], nodes, []);
    expect(added).toEqual([
      { id: 'e-img-a-plan-1', source: 'img-a', target: 'plan-1', data: { textIndex: true } },
    ]);
  });

  it('已有同向边时不重复建', () => {
    const nodes = [media('img-a', '100'), text('plan-1')];
    const edges: Edge[] = [{ id: 'e-img-a-plan-1', source: 'img-a', target: 'plan-1', data: { textIndex: true } }];
    expect(textIndexEdgesForAppliedPlan('plan-1', ['100'], nodes, edges)).toEqual([]);
  });

  it('跳过展示「素材已被删除」的节点', () => {
    const gone = media('img-gone', '100');
    gone.data = { ...gone.data, assetMissing: true };
    const nodes = [gone, text('plan-1')];
    expect(textIndexEdgesForAppliedPlan('plan-1', ['100'], nodes, [])).toEqual([]);
  });
});

describe('replaceMissingPlanMediaNodes', () => {
  it('空壳素材卡会新建可播放节点、改写指针并丢掉旧卡', () => {
    const gone = media('img-gone', '100');
    gone.data = { ...gone.data, assetMissing: true, src: '' };
    const plan = text('plan-1', {
      mediaRefs: [{ assetId: '100', url: 'https://cdn.example/a.png', mediaType: 'image', name: '图1' }],
      mediaMentions: [{ assetId: '100', nodeId: 'img-gone', start: 0, end: 2 }],
    });
    plan.position = { x: 10, y: 20 };
    const rebuilt = replaceMissingPlanMediaNodes({
      textNodeId: 'plan-1',
      assetIds: ['100'],
      nodes: [gone, plan],
      missingNodeIds: new Set(['img-gone']),
      createNodeId: () => 'media-new',
    });
    const created = rebuilt.nodes.find((node) => node.id === 'media-new');
    const nextPlan = rebuilt.nodes.find((node) => node.id === 'plan-1');
    expect(rebuilt.replaced).toBe(true);
    expect([...rebuilt.removedNodeIds]).toEqual(['img-gone']);
    expect(rebuilt.nodes.some((node) => node.id === 'img-gone')).toBe(false);
    expect(created?.data).toMatchObject({
      assetId: '100',
      src: 'https://cdn.example/a.png',
      mediaType: 'image',
      fileName: '图1',
    });
    expect(created?.position).toEqual({ x: 430, y: 20 });
    expect(nextPlan?.data).toMatchObject({
      mediaRefs: [{ assetId: '100', url: 'https://cdn.example/a.png', mediaType: 'image', name: '图1', nodeId: 'media-new' }],
      mediaMentions: [{ assetId: '100', nodeId: 'media-new', start: 0, end: 2 }],
    });
    expect(textIndexEdgesForAppliedPlan('plan-1', ['100'], rebuilt.nodes, [])).toEqual([
      { id: 'e-media-new-plan-1', source: 'media-new', target: 'plan-1', data: { textIndex: true } },
    ]);
  });

  it('已有可播放同身份节点时复用，不新建', () => {
    const ready = media('img-a', '100');
    ready.data = { ...ready.data, src: 'https://cdn.example/a.png' };
    const plan = text('plan-1', {
      mediaRefs: [{ assetId: '100', url: 'https://cdn.example/a.png', mediaType: 'image', name: '图1', nodeId: 'img-a' }],
    });
    const rebuilt = replaceMissingPlanMediaNodes({
      textNodeId: 'plan-1',
      assetIds: ['100'],
      nodes: [ready, plan],
      missingNodeIds: new Set(),
      createNodeId: () => 'media-new',
    });
    expect(rebuilt.replaced).toBe(false);
    expect(rebuilt.nodes.map((node) => node.id)).toEqual(['img-a', 'plan-1']);
    expect(rebuilt.nodes.some((node) => node.id === 'media-new')).toBe(false);
  });

  it('方案卡没有可播放地址时不新建', () => {
    const gone = media('img-gone', '100');
    gone.data = { ...gone.data, assetMissing: true };
    const plan = text('plan-1', {
      mediaRefs: [{ assetId: '100', url: '', mediaType: 'image' }],
    });
    const rebuilt = replaceMissingPlanMediaNodes({
      textNodeId: 'plan-1',
      assetIds: ['100'],
      nodes: [gone, plan],
      missingNodeIds: new Set(['img-gone']),
      createNodeId: () => 'media-new',
    });
    expect(rebuilt.nodes.some((node) => node.id === 'media-new')).toBe(false);
    expect(rebuilt.nodes.some((node) => node.id === 'img-gone')).toBe(true);
  });
});
