import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { createGenerationDockCoordinator } from './generationDockCoordinator';
import { createTextGenerationDock, type TextGenerationDockHost } from './textGenerationDock';

function fixture() {
  const nodes: Node[] = [{ id: 'text', type: 'textNode', position: { x: 0, y: 0 }, data: { textGen: true, prompt: '描述文案', draftModelId: 'old-model' } }];
  const edges: Edge[] = [];
  const host: TextGenerationDockHost = {
    getNodes: () => nodes, getEdges: () => edges, attachmentsOf: () => [], beginEdit: () => {},
    patchNode: (id, data) => { const node = nodes.find(node => node.id === id); if (node) node.data = { ...node.data, ...data }; },
  };
  return { host, nodes, edges, dock: createGenerationDockCoordinator({ text: createTextGenerationDock(() => host) }) };
}

describe('文生文 Dock 公开接口', () => {
  it('选择隐藏只关不开，空通知和绑定单选保持原状', () => {
    const { dock } = fixture();
    dock.open('text', { nodeId: 'text' });
    dock.selection({ soloId: null, multiSelect: false, editing: false, submittingNodeId: null });
    expect(dock.view.activePanel).toBe('text');
    dock.selection({ soloId: 'text', multiSelect: false, editing: false, submittingNodeId: null });
    expect(dock.view.activePanel).toBe('text');
    dock.selection({ soloId: null, multiSelect: true, editing: false, submittingNodeId: null });
    expect(dock.view.activePanel).toBeNull();
    dock.selection({ soloId: 'text', multiSelect: false, editing: false, submittingNodeId: null });
    expect(dock.view.activePanel).toBeNull();
    expect(dock.panel('text').boundId).toBe('text');
  });
  it('节点权威内容与附件实时派生，初始化不新增模型恢复或seed', () => {
    const { dock, nodes, host } = fixture();
    dock.open('text', { nodeId: 'text' });
    const attachments = dock.panel('text').attachments;
    host.getNodes = () => [...nodes];
    expect(dock.panel('text').attachments).toBe(attachments);
    nodes[0] = { ...nodes[0], data: { ...nodes[0].data, prompt: '外部新正文' } };
    expect(dock.panel('text').initialText).toBe('外部新正文');
    expect(dock.panel('text')).not.toHaveProperty('initialModelId');
    expect(dock.panel('text')).not.toHaveProperty('seed');
  });
  it('目标失去textGen标记即解绑，有jobId不改变此规则，订阅随卸载清理', () => {
    const { dock, nodes } = fixture();
    const observed: unknown[] = [];
    const unsubscribe = dock.subscribe(() => observed.push(dock.view.activePanel));
    dock.open('text', { nodeId: 'text' });
    nodes[0].data = { textGen: false, jobId: 'existing-job' };
    dock.reconcile();
    expect(dock.panel('text')).toMatchObject({ visible: false, boundId: null });
    expect(observed).toEqual(['text', null]);
    unsubscribe();
    dock.open('text', { nodeId: 'text' });
    expect(observed).toEqual(['text', null]);
    nodes.splice(0);
    dock.reconcile();
    expect(dock.panel('text').boundId).toBeNull();
  });
  it('未绑定提交无写卡，捕获目标的旧回调仍只写原节点', () => {
    const { dock, nodes } = fixture();
    dock.submit('text', { text: '未绑定', modelId: 'm' });
    expect(nodes[0].data.prompt).toBe('描述文案');
    nodes.push({ id: 'other', type: 'textNode', position: { x: 1, y: 1 }, data: { textGen: true } });
    dock.open('text', { nodeId: 'other' });
    dock.updateDraft('text', { targetNodeId: 'text', prompt: '旧回调正文' });
    expect(nodes[0].data.prompt).toBe('旧回调正文');
    expect(nodes[1].data.prompt).toBeUndefined();
  });

  it('自己写内容只跳过下一次点卡，普通打开重置豁免', () => {
    const { dock } = fixture();
    dock.open('text', { nodeId: 'text' });
    dock.writeSelf('text');
    expect(dock.view.activePanel).toBeNull();
    expect(dock.open('text', { nodeId: 'text', intent: 'nodeClick' })).toBe(false);
    expect(dock.open('text', { nodeId: 'text', intent: 'nodeClick' })).toBe(true);
    dock.writeSelf('text');
    expect(dock.open('text', { nodeId: 'text' })).toBe(true);
    expect(dock.open('text', { nodeId: 'text', intent: 'nodeClick' })).toBe(true);
  });

  it('参数写回节点，发送即时合成当前附件与正文写卡并关闭', () => {
    const { dock, host, nodes } = fixture();
    dock.open('text', { nodeId: 'text' });
    dock.updateDraft('text', { prompt: '正文', modelId: 'chosen-model' });
    expect(nodes[0].data).toMatchObject({ prompt: '正文', draftModelId: 'chosen-model' });
    host.attachmentsOf = () => [{ nodeId: 'one', title: '一', text: '附件一' }, { nodeId: 'empty', title: '空', text: '' }, { nodeId: 'two', title: '二', text: '附件二' }];
    dock.submit('text', { text: '正文', modelId: 'chosen-model' });
    expect(nodes[0].data).toMatchObject({ text: '附件一\n\n附件二\n\n正文', prompt: '正文', draftModelId: 'chosen-model' });
    expect(dock.panel('text')).toMatchObject({ visible: false, boundId: 'text' });
  });

  it('点卡打开绑定文本，关闭保留绑定与当前初始化内容', () => {
    const { dock } = fixture();
    dock.open('text', { nodeId: 'text', intent: 'nodeClick' });
    expect(dock.view.activePanel).toBe('text');
    expect(dock.panel('text')).toMatchObject({ boundId: 'text', initialText: '描述文案' });
    dock.close('text');
    expect(dock.panel('text')).toMatchObject({ visible: false, boundId: 'text', initialText: '描述文案' });
  });
});
