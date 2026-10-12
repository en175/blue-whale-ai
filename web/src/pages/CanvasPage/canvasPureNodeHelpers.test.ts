import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import {
  appliedCardIdsOf,
  atMentionItemsOf,
  canvasMediaOf,
  complianceBlockedIds,
  pendingPlanSyncsOf,
  pickMarkedIdsFor,
  planReferenceErrorFor,
} from './canvasPureNodeHelpers';

const textNode = (id: string, data: Record<string, unknown>): Node => ({ id, type: 'textNode', position: { x: 0, y: 0 }, data }) as Node;
const mediaNode = (id: string, data: Record<string, unknown> = {}): Node => ({ id, type: 'mediaNode', position: { x: 0, y: 0 }, data }) as Node;
const edge = (source: string, target: string, data?: Record<string, unknown>): Edge => ({ id: `${source}->${target}`, source, target, data }) as Edge;

const planNode = (id: string, text: string, mentions: unknown): Node =>
  textNode(id, { promptSource: true, text, promptMentions: mentions });

describe('canvasPureNodeHelpers 画布纯计算', () => {
  describe('planReferenceErrorFor', () => {
    const covered = [{ start: 0, end: 2, index: 1, assetId: '1' }];

    it('无 target 返回 undefined', () => {
      expect(planReferenceErrorFor(undefined, [], [], [])).toBeUndefined();
    });

    it('方案正文索引非法时报索引无效', () => {
      const nodes = [planNode('p', 'hi', [{ start: 0, end: 5, index: 1, assetId: '1' }])];
      expect(planReferenceErrorFor('t', ['1'], [edge('p', 't', { promptReference: { bindings: [{ index: 1, assetId: '1' }] } })], nodes))
        .toBe('方案正文素材索引无效，请修正方案');
    });

    it('未确认方案引用时报待同步', () => {
      const nodes = [planNode('p', 'hi', covered)];
      expect(planReferenceErrorFor('t', ['1'], [edge('p', 't')], nodes)).toContain('待同步');
    });

    it('已确认但素材缺失时报缺失', () => {
      const nodes = [planNode('p', 'hi', covered)];
      expect(planReferenceErrorFor('t', [], [edge('p', 't', { promptReference: { bindings: [{ index: 1, assetId: '1' }] } })], nodes))
        .toContain('素材缺失');
    });

    it('已确认且素材齐全无错误', () => {
      const nodes = [planNode('p', 'hi', covered)];
      expect(planReferenceErrorFor('t', ['1'], [edge('p', 't', { promptReference: { bindings: [{ index: 1, assetId: '1' }] } })], nodes))
        .toBeUndefined();
    });
  });

  describe('pendingPlanSyncsOf', () => {
    it('未确认的绑定返回待同步项，携带标题', () => {
      const nodes = [textNode('p', { promptSource: true, title: '方案A', text: 'hi', promptMentions: [{ start: 0, end: 2, index: 1, assetId: '1' }] })];
      const out = pendingPlanSyncsOf('t', [edge('p', 't')], nodes);
      expect(out).toHaveLength(1);
      expect(out[0]!.nodeId).toBe('p');
      expect(out[0]!.title).toBe('方案A');
      expect(out[0]!.bindings).toEqual([{ index: 1, assetId: '1' }]);
    });

    it('已确认的绑定不再待同步', () => {
      const nodes = [textNode('p', { promptSource: true, text: 'hi', promptMentions: [{ start: 0, end: 2, index: 1, assetId: '1' }] })];
      expect(pendingPlanSyncsOf('t', [edge('p', 't', { promptReference: { bindings: [{ index: 1, assetId: '1' }] } })], nodes)).toEqual([]);
    });
  });

  describe('pickMarkedIdsFor', () => {
    it('未激活或 session 非字符串返回空', () => {
      expect(pickMarkedIdsFor('s', false, [], [])).toEqual([]);
      expect(pickMarkedIdsFor(true, true, [], [])).toEqual([]);
    });

    it('只收非文本源边的 source', () => {
      const nodes = [textNode('txt', {})];
      const edges = [edge('m1', 's'), edge('txt', 's'), edge('m2', 'other')];
      expect(pickMarkedIdsFor('s', true, edges, nodes)).toEqual(['m1']);
    });

    it('video 角色筛选只留匹配 refRole 的边', () => {
      const edges = [edge('m1', 's', { refRole: 'first' }), edge('m2', 's', { refRole: 'reference' })];
      expect(pickMarkedIdsFor('s', true, edges, [], 'first')).toEqual(['m1']);
      expect(pickMarkedIdsFor('s', true, edges, [], 'reference')).toEqual(['m2']);
    });
  });

  describe('complianceBlockedIds', () => {
    it('只返回 complianceFailed===true 的媒体节点 id', () => {
      const nodes = [mediaNode('a', { complianceFailed: true }), mediaNode('b', {}), mediaNode('c', { complianceFailed: false })];
      expect(complianceBlockedIds(nodes)).toEqual(['a']);
    });
  });

  describe('canvasMediaOf', () => {
    it('过滤无 src，取 fileName/assetId/mediaType 并回退默认', () => {
      const nodes = [
        mediaNode('m1', { src: 'u1', fileName: 'f1', mediaType: 'video', assetId: 'a1' }),
        mediaNode('m2', { src: 'u2' }),
        mediaNode('m3', {}),
      ];
      expect(canvasMediaOf(nodes)).toEqual([
        { id: 'm1', assetId: 'a1', src: 'u1', name: 'f1', mediaType: 'video' },
        { id: 'm2', assetId: undefined, src: 'u2', name: 'm2', mediaType: 'image' },
      ]);
    });
  });

  describe('atMentionItemsOf', () => {
    it('媒体节点按 kind 命名，文本节点带 searchText', () => {
      const media = [
        { id: 'm1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { src: 'u', fileName: '图', mediaType: 'image' } } as Node,
      ];
      const texts = [{ id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { title: '标题', text: '正文' } } as Node];
      const items = atMentionItemsOf(media, texts);
      expect(items.find((i) => i.id === 'm1')).toMatchObject({ kind: 'image', name: '图', thumbUrl: 'u' });
      expect(items.find((i) => i.id === 't1')).toMatchObject({ kind: 'text', name: '标题', searchText: '正文' });
    });
  });

  describe('appliedCardIdsOf', () => {
    it('无 promptSource 的文本节点不产出 id', () => {
      const nodes = [
        textNode('t1', { promptSource: { revisionId: 'r1', shotNo: 2 } }),
        textNode('t2', {}),
      ];
      expect(appliedCardIdsOf(nodes)).toEqual(new Set(['r1#2']));
    });
  });
});
