import { expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { textAttachmentsOf, textAttachmentsForSend } from './textAttachments';

function textNode(id: string, data: Record<string, unknown> = {}): Node {
  return { id, type: 'textNode', position: { x: 0, y: 0 }, data };
}
function mediaNode(id: string): Node {
  return { id, type: 'mediaNode', position: { x: 0, y: 0 }, data: {} };
}
function edge(source: string, target: string): Edge {
  return { id: `e-${source}-${target}`, source, target, type: 'custom' };
}

it('textAttachmentsOf：只收指向目标的文本节点边，标注 promptSource 与标题', () => {
  const edges = [edge('t1', 'draft'), edge('t2', 'draft'), edge('m1', 'draft')];
  const textNodes = [textNode('t1', { title: '方案A', promptSource: true, text: '正文一' }), textNode('t2', { text: '正文二' })];
  const mediaNodes = [mediaNode('m1')];
  const out = textAttachmentsOf('draft', edges, [...textNodes, ...mediaNodes]);
  expect(out).toEqual([
    { nodeId: 't1', isPromptPlan: true, title: '方案A', text: '正文一' },
    { nodeId: 't2', isPromptPlan: false, title: '文本节点', text: '正文二' },
  ]);
});

it('textAttachmentsForSend：图片 mention 被替换为素材 token', () => {
  const edges = [edge('t1', 'draft')];
  const textNodes = [textNode('t1', {
    text: '看这张图',
    mediaMentions: [{ start: 0, end: 1, nodeId: 'img1' }],
    mediaRefs: [{ nodeId: 'img1', mediaType: 'image' }],
  })];
  const [att] = textAttachmentsForSend('draft', edges, textNodes);
  expect(att!.nodeId).toBe('t1');
  expect(att!.isPromptPlan).toBe(false);
});
