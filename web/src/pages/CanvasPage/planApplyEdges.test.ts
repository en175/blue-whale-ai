import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import {
  appliedPlanAssetIds,
  dropReversedTextIndexEdges,
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
});
