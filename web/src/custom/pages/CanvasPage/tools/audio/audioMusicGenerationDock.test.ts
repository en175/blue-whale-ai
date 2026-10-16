import { describe, expect, it, vi } from 'vitest';
import type { PromptDoc } from '@/custom/utils/prompt-doc';
import type { Edge, Node } from '@xyflow/react';
import { createGenerationDockCoordinator } from '../../generationDockCoordinator';
import { createAudioMusicGenerationDocks, type AudioGenerationDockHost, type AudioDockTask, type MusicGenerationDockHost } from './audioMusicGenerationDock';

function fixture() {
  const nodes: Node[] = [{ id: 'audio', type: 'mediaNode', position: { x: 0, y: 0 }, data: { draft: true, mediaType: 'audio', prompt: '海浪', draftModelId: 'model-audio' } }];
  const edges: Edge[] = [];
  const host: AudioGenerationDockHost = {
    getNodes: () => nodes, getEdges: () => edges, attachmentsOf: () => [], canOpen: () => true,
    beginEdit: () => {}, endPicking: () => {}, clearPickResult: () => {},
    addReferenceEdge: (source, target) => { edges.push({ id: source + target, source, target }); },
    patchNode: (id, patch) => { const node = nodes.find(node => node.id === id)!; node.data = { ...node.data, ...patch }; },
    getAvailability: () => ({ submittingNodeId: null, saveFailed: false }),
    getProjectId: () => 'project', isApplying: () => false, isSaveBlocked: () => false,
    setApplying: () => {}, setSubmittingNode: () => {}, toast: () => {}, reportError: () => {},
    promptMaxLength: async () => 100, fetchFile: async () => null, upload: async () => null, save: async () => true, startTask: () => false,
  };
  const musicHost: MusicGenerationDockHost = { beginEdit: () => {}, recordSend: () => {} };
  const dock = createGenerationDockCoordinator(createAudioMusicGenerationDocks(() => host, () => musicHost));
  return { dock, host, musicHost, nodes, edges };
}

describe('音频与音乐 Dock 公开接口', () => {
  it('登记成功的状态与豁免立即生效，界面通知保留排队保存先读草稿的顺序', async () => {
    const { dock, host } = fixture();
    const events: string[] = [];
    let applying = false;
    host.setApplying = value => { applying = value; };
    host.startTask = () => {
      events.push('registered');
      queueMicrotask(() => events.push(`save:${dock.view.activePanel ?? 'closed'}:${applying ? 'locked' : 'released'}`));
      return true;
    };
    dock.open('audio', { nodeId: 'audio' });
    dock.subscribe(() => events.push('view-notified'));
    await dock.submit('audio', { text: '浪', modelId: 'm', refs: [] });
    expect(events).toEqual(['registered', 'save:closed:released', 'view-notified']);
    expect(dock.open('audio', { nodeId: 'audio', intent: 'selection' })).toBe(false);
  });

  it('存量画布引用转换成边，seed不镜像引用，展示随权威来源与边更新', () => {
    const { dock, host, nodes, edges } = fixture();
    nodes.push({ id: 'source', type: 'mediaNode', position: { x: 1, y: 1 }, data: { mediaType: 'audio', assetId: '20', src: 'https://fixture/source.mp3', fileName: '海浪来源' } });
    nodes[0].data.audioRefs = [{ id: 'source', source: 'canvas' }, { id: 'lost', source: 'canvas' }, { id: 'local', source: 'local' }];
    dock.open('audio', { nodeId: 'audio' });
    expect(edges.map(edge => [edge.source, edge.target])).toEqual([['source', 'audio']]);
    expect(nodes[0].data.audioRefs).toEqual([]);
    expect(dock.panel('audio').seed?.refs).toEqual([]);
    const refs = dock.panel('audio').draftRefs, attachments = dock.panel('audio').attachments;
    host.getNodes = () => [...nodes];
    dock.close('music');
    expect(dock.panel('audio').draftRefs).toBe(refs);
    expect(dock.panel('audio').attachments).toBe(attachments);
    expect(refs).toMatchObject([{ id: 'source', source: 'canvas', kind: 'audio', assetId: '20', name: '海浪来源' }]);
    nodes[1] = { ...nodes[1], data: { ...nodes[1].data, fileName: '新来源名' } };
    expect(dock.panel('audio').draftRefs?.[0].name).toBe('新来源名');
  });
  it('参数写回保留正文结构和null规则，自由音频没有绑定回调', () => {
    const { dock, nodes } = fixture();
    dock.open('audio', { nodeId: 'audio' });
    const doc: PromptDoc = { version: 1, segments: [{ kind: 'text', text: '浪' }] };
    dock.updateDraft('audio', { prompt: '浪', modelId: 'new-model', promptDoc: doc });
    expect(nodes[0].data).toMatchObject({ prompt: '浪', draftModelId: 'new-model', promptDoc: { ...doc, flat: '浪' } });
    dock.updateDraft('audio', { promptDoc: null });
    expect(nodes[0].data.promptDoc).toBeNull();
    dock.open('music', { fromAudio: true });
    dock.open('audio', {});
    dock.updateDraft('audio', { prompt: '自由内容' });
    expect(nodes[0].data.prompt).toBe('浪');
    expect(dock.panel('audio').draftBinding).toBeUndefined();
  });
  it('空选中保持，其他选择隐藏可恢复，参考豁免和显式关闭保留绑定', () => {
    const { dock, host } = fixture();
    let ended = 0;
    host.endPicking = () => { ended += 1; };
    dock.open('audio', { nodeId: 'audio' });
    const seed = dock.panel('audio').seed;
    dock.selection({ soloId: null, multiSelect: false, editing: false, submittingNodeId: null });
    expect(dock.view.activePanel).toBe('audio');
    dock.selection({ soloId: 'other', multiSelect: false, editing: false, submittingNodeId: null });
    expect(dock.view.activePanel).toBeNull();
    dock.selection({ soloId: 'audio', multiSelect: false, editing: false, submittingNodeId: null });
    expect(dock.view.activePanel).toBe('audio');
    dock.referencePicked('audio');
    dock.selection({ soloId: null, multiSelect: true, editing: false, submittingNodeId: null });
    expect(dock.view.activePanel).toBe('audio');
    dock.close('audio');
    expect(dock.panel('audio').boundId).toBe('audio');
    expect(dock.panel('audio').seed).toBe(seed);
    expect(ended).toBe(2);
    expect(dock.open('audio', { nodeId: 'audio', intent: 'selection' })).toBe(false);
    dock.open('audio', { nodeId: 'audio' });
    expect(dock.view.activePanel).toBe('audio');
  });
  it('准入失败保持活动音乐，生成记录保留绑定，目标失效解绑并清订阅', () => {
    const { dock, host, nodes } = fixture();
    dock.open('music', {});
    host.canOpen = () => false;
    expect(dock.open('audio', { nodeId: 'audio' })).toBe(false);
    expect(dock.view.activePanel).toBe('music');
    host.canOpen = () => true;
    dock.open('audio', { nodeId: 'audio' });
    const observed: unknown[] = [];
    const unsubscribe = dock.subscribe(() => observed.push(dock.view.activePanel));
    nodes[0].data = { jobId: 'job', genStatus: 'generating' };
    dock.reconcile();
    expect(dock.panel('audio').boundId).toBe('audio');
    nodes.splice(0);
    dock.reconcile();
    expect(dock.panel('audio').boundId).toBeNull();
    expect(observed).toEqual([null]);
    unsubscribe();
    dock.open('music', {});
    expect(observed).toEqual([null]);
  });
  it('保存门槛、上传失败和登记拒绝保留音频界面，不引入受理等待', async () => {
    const { dock, host } = fixture();
    let starts = 0, applying = false;
    const errors: string[] = [];
    host.setApplying = value => { applying = value; };
    host.toast = (_kind, message) => { errors.push(message); };
    host.startTask = () => { starts += 1; return false; };
    dock.open('audio', { nodeId: 'audio' });
    host.isSaveBlocked = () => true;
    await dock.submit('audio', { text: '浪', modelId: 'm', refs: [] });
    expect(starts).toBe(0);
    host.isSaveBlocked = () => false;
    await dock.submit('audio', { text: '浪', modelId: 'm', refs: [{ id: 'local', kind: 'audio', source: 'local', name: '浪', src: 'https://fixture/wave.mp3' }] });
    expect(errors).toEqual(['参考音频上传失败，请重试']);
    expect(applying).toBe(false);
    expect(starts).toBe(0);
    host.save = async () => false;
    await dock.submit('audio', { text: '浪', modelId: 'm', refs: [] });
    expect(starts).toBe(0);
    host.save = async () => true;
    await dock.submit('audio', { text: '浪', modelId: 'm', refs: [] });
    expect(starts).toBe(1);
    expect(dock.view.activePanel).toBe('audio');
    expect(applying).toBe(false);
  });
  it('同毫秒真实内容变化改变seed身份，音乐选择关闭没有绑定回弹', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100);
    try {
      const { dock, nodes } = fixture();
      dock.open('audio', { nodeId: 'audio' });
      const key = dock.panel('audio').seed?.ts;
      nodes[0].data = { ...nodes[0].data, prompt: '新浪' };
      dock.open('audio', { nodeId: 'audio' });
      expect(dock.panel('audio').seed?.ts).not.toBe(key);
      dock.open('music', {});
      dock.selection({ soloId: null, multiSelect: false, editing: false, submittingNodeId: null });
      expect(dock.view.activePanel).toBe('music');
      dock.selection({ soloId: 'other', multiSelect: false, editing: false, submittingNodeId: null });
      expect(dock.view.activePanel).toBeNull();
    } finally { clock.mockRestore(); }
  });

  it('互切回调清音频绑定与初始化，音乐只处理既有发送回调且保持打开', () => {
    const { dock, musicHost } = fixture();
    const sends: unknown[] = [];
    musicHost.recordSend = input => { sends.push(input); };
    dock.open('audio', { nodeId: 'audio' });
    dock.open('music', { fromAudio: true });
    expect(dock.panel('audio').boundId).toBeNull();
    expect(dock.panel('audio').seed).toEqual({ ts: expect.any(Number) });
    expect(dock.view.activePanel).toBe('music');
    const send = { text: '海风旋律', model: '音乐模型（mock）', options: { instrumental: true, speed: 1, lyrics: '' }, refs: [] };
    dock.submit('music', send);
    expect(sends).toEqual([send]);
    expect(dock.view.activePanel).toBe('music');
    const seed = dock.panel('audio').seed;
    dock.open('audio', {});
    expect(dock.view.activePanel).toBe('audio');
    expect(dock.panel('audio').seed).toBe(seed);
    expect(dock.panel('audio').draftBinding).toBeUndefined();
  });

  it('音频先解析传入参考与写正文，再保存并同步登记，true关闭且释放锁', async () => {
    const { dock, host, nodes } = fixture();
    const events: string[] = [], requests: AudioDockTask[] = [];
    host.promptMaxLength = async () => { events.push('validate'); return 100; };
    host.setApplying = value => { events.push(value ? 'locked' : 'released'); };
    host.fetchFile = async (_src, _name, mime) => { events.push(mime); return new File([], 'reference.png'); };
    host.upload = async (_file, type) => { events.push(type); return { asset_id: 91, url: 'https://fixture/reference.png' }; };
    host.save = async () => { expect(nodes[0].data.prompt).toBe('新海浪'); events.push('saved'); return true; };
    host.startTask = input => { requests.push(input); events.push('registered'); return true; };
    dock.open('audio', { nodeId: 'audio' });
    await dock.submit('audio', { text: '新海浪', modelId: 'model-audio', refs: [{ id: 'ref', kind: 'image', name: '参考图', src: 'https://fixture/old.png', source: 'local' }] });
    expect(events).toEqual(['validate', 'locked', 'image/png', 'image', 'saved', 'registered', 'released']);
    expect(requests[0]).toMatchObject({ text: '新海浪', targetNodeId: 'audio', refs: [{ assetId: 91, mediaType: 'image', kind: 'image', src: 'https://fixture/reference.png' }] });
    expect(dock.view.activePanel).toBeNull();
    expect(dock.open('audio', { nodeId: 'audio', intent: 'selection' })).toBe(false);
  });

  it('恢复节点正文与模型，等值重开保留初始化身份', () => {
    const { dock } = fixture();
    dock.open('audio', { nodeId: 'audio' });
    expect(dock.panel('audio').seed).toMatchObject({ text: '海浪', modelId: 'model-audio', targetNodeId: 'audio', refs: [] });
    const seed = dock.panel('audio').seed;
    dock.open('audio', { nodeId: 'audio' });
    expect(dock.panel('audio').seed).toBe(seed);
    expect(dock.view.activePanel).toBe('audio');
  });
});
