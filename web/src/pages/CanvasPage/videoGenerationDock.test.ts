import { describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { createGenerationDockCoordinator } from './generationDockCoordinator';
import { createVideoGenerationDock } from './videoGenerationDock';
import type { VideoGenerationDockHost, VideoDockTask } from './videoGenerationDock';

const options = { modelId: 'm', aspectRatio: '16:9', resolution: '720p', duration: 5, mode: 'all', generateAudio: true, sampleMode: false };

function fixture() {
  const nodes: Node[] = [{ id: 'video', type: 'mediaNode', position: { x: 0, y: 0 }, data: { draft: true, prompt: '鲸鱼', draftMode: 'all', videoStage: 'sample' } }];
  const edges: Edge[] = [];
  const host: VideoGenerationDockHost = {
    getNodes: () => nodes, getEdges: () => edges, attachmentsOf: () => [], canOpen: () => true,
    beginEdit: () => {}, endPicking: () => {}, resetAssetPicking: () => {}, warnStaleRefs: () => {},
    patchNode: (id: string, patch: Record<string, unknown>) => { const node = nodes.find(node => node.id === id)!; node.data = { ...node.data, ...patch }; },
    toast: () => {},
    getProjectId: () => 'p1', isApplying: () => false, isSaveBlocked: () => false, setApplying: () => {}, setSubmittingNode: () => {},
    promptMaxLength: async () => 100, save: async () => true, refUnsupported: () => null, startTask: () => false, reportError: () => {},
    getAvailability: () => ({ submittingNodeId: null, saveFailed: false }),
  };
  return { host, nodes, edges, dock: createGenerationDockCoordinator({ video: createVideoGenerationDock(() => host) }) };
}

describe('视频 Dock 公开接口', () => {
  it('同毫秒内真实草稿变化仍改变编辑器挂载身份，等值打开保持旧身份', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100);
    try {
      const { dock, nodes } = fixture();
      dock.open('video', { nodeId: 'video' });
      const first = dock.panel('video').seed;
      dock.open('video', { nodeId: 'video' });
      expect(dock.panel('video').seed).toBe(first);
      nodes[0].data = { ...nodes[0].data, prompt: '新内容' };
      dock.open('video', { nodeId: 'video' });
      expect(dock.panel('video').seed?.ts).not.toBe(first?.ts);
      expect(dock.panel('video').seed?.text).toBe('新内容');
    } finally { clock.mockRestore(); }
  });
  it('引用在保存后从当前连线读取，样片报价随同步登记请求完整透传', async () => {
    const { host, dock, nodes, edges } = fixture();
    const requests: VideoDockTask[] = [];
    host.save = async () => {
      nodes.push({ id: 'ref', type: 'mediaNode', position: { x: 0, y: 0 }, data: { mediaType: 'image', src: 'https://fixture/image.png', assetId: '201' } });
      edges.push({ id: 'ref-edge', source: 'ref', target: 'video' });
      return true;
    };
    host.startTask = input => { requests.push(input); return true; };
    dock.open('video', { nodeId: 'video' });
    await dock.submit('video', { text: '鲸鱼', options: { ...options, resolution: '480p', sampleMode: true, expectedCredits: 30, quoteRevision: 'quote-1' } });
    expect(requests[0].references).toEqual([{ role: 'reference', type: 'image', asset_id: '201' }]);
    expect(requests[0].parameters).toMatchObject({ sample_mode: true, resolution: '480p', generate_audio: true });
    expect(requests[0].options).toMatchObject({ expectedCredits: 30, quoteRevision: 'quote-1' });
  });

  it('空项目不新增提前门槛；保存拒绝与登记拒绝保持面板，原锁均释放', async () => {
    const { host, dock } = fixture();
    let count = 0, applying = false;
    host.setApplying = value => { applying = value; };
    host.startTask = () => { count += 1; return false; };
    dock.open('video', { nodeId: 'video' });
    host.save = async () => false;
    await dock.submit('video', { text: '鲸鱼', options });
    expect(count).toBe(0);
    expect(applying).toBe(false);
    expect(dock.view.activePanel).toBe('video');
    host.getProjectId = () => null;
    await dock.submit('video', { text: '鲸鱼', options });
    expect(count).toBe(1);
    expect(applying).toBe(false);
    expect(dock.view.activePanel).toBe('video');
  });

  it('空选中保持，选择隐藏可恢复，参考选取保护继续保留可见面板', () => {
    const { dock } = fixture();
    dock.open('video', { nodeId: 'video' });
    const seed = dock.panel('video').seed, refs = dock.panel('video').mediaRefs;
    dock.selection({ soloId: null, multiSelect: false, editing: false, submittingNodeId: null });
    expect(dock.view.activePanel).toBe('video');
    dock.selection({ soloId: null, multiSelect: true, editing: false, submittingNodeId: null });
    expect(dock.view.activePanel).toBeNull();
    dock.selection({ soloId: 'video', multiSelect: false, editing: false, submittingNodeId: null });
    expect(dock.view.activePanel).toBe('video');
    expect(dock.panel('video').seed).toBe(seed);
    expect(dock.panel('video').mediaRefs).toBe(refs);
    dock.referencePicked('video');
    dock.selection({ soloId: 'other', multiSelect: false, editing: false, submittingNodeId: null });
    expect(dock.view.activePanel).toBe('video');
  });

  it('自由参考支持去重、角色转换与清理，自由参数不写草稿', () => {
    const { dock, nodes } = fixture();
    const item = { nodeId: 'image', assetId: 'asset', mediaType: 'image' as const, url: 'https://fixture/image.png', name: '图片' };
    dock.open('video', {});
    dock.updateDraft('video', { freeReference: { operation: 'add', item, role: 'reference' } });
    dock.updateDraft('video', { freeReference: { operation: 'add', item, role: 'reference' } });
    expect(dock.panel('video').freeRefs.reference).toHaveLength(1);
    dock.updateDraft('video', { freeReference: { operation: 'assign', assignments: [{ nodeId: 'image', role: 'first' }] } });
    expect(dock.panel('video').freeRefs.first).toEqual(item);
    expect(dock.panel('video').freeRefs.reference).toEqual([]);
    dock.updateDraft('video', { prompt: '自由输入' });
    expect(nodes[0].data.prompt).toBe('鲸鱼');
    dock.close('video');
    expect(dock.panel('video').freeRefs).toEqual({ reference: [] });
  });

  it('生成记录保留绑定，目标失效关闭，解除订阅后不再通知', () => {
    const { dock, nodes } = fixture();
    const observed: unknown[] = [];
    const unsubscribe = dock.subscribe(() => observed.push(dock.view.activePanel));
    dock.open('video', { nodeId: 'video' });
    nodes[0].data = { jobId: 'job', genStatus: 'generating' };
    dock.reconcile();
    expect(dock.panel('video').boundId).toBe('video');
    expect(dock.panel('video').draftBinding.restoreExisting).toBe(true);
    nodes.splice(0);
    dock.reconcile();
    expect(dock.view.activePanel).toBeNull();
    expect(observed).toEqual(['video', null]);
    unsubscribe();
    dock.open('video', {});
    expect(observed).toEqual(['video', null]);
  });
  it('保存阶段释放锁后读取引用，最终登记与清锁同步执行，true不等待受理', async () => {
    const { host, dock } = fixture();
    const events: string[] = [];
    let applying = false;
    let saved = false;
    const hostNodes = host.getNodes();
    Object.assign(host, {
      isApplying: () => applying, getProjectId: () => 'p1', isSaveBlocked: () => true,
      setApplying: (value: boolean) => { applying = value; events.push(value ? 'lock' : 'unlock'); },
      setSubmittingNode: () => {},
      promptMaxLength: async () => { events.push('validate'); return 100; },
      save: async () => { events.push('save'); saved = true; return true; },
      getNodes: () => { if (saved) events.push(applying ? 'read-locked' : 'read-unlocked'); return hostNodes; },
      refUnsupported: () => null,
      startTask: () => { events.push('registered'); queueMicrotask(() => events.push(applying ? 'late-locked' : 'late-unlocked')); return true; },
      reportError: () => {},
    });
    dock.open('video', { nodeId: 'video' });
    await dock.submit('video', { text: '鲸鱼', options: { modelId: 'm', aspectRatio: '16:9', resolution: '720p', duration: 5, mode: 'all', generateAudio: true, sampleMode: false } });
    expect(events.slice(0, 4)).toEqual(['validate', 'lock', 'save', 'unlock']);
    expect(events).not.toContain('read-locked');
    expect(events).toContain('registered');
    expect(events.at(-1)).toBe('late-unlocked');
    expect(dock.view.activePanel).toBeNull();
  });
  it('同步登记成功立即关闭与豁免，界面通知排在运行时已排队的保存之后', async () => {
    const { host, dock } = fixture();
    const events: string[] = [];
    let applying = false;
    host.setApplying = value => { applying = value; };
    host.startTask = () => {
      events.push('registered');
      queueMicrotask(() => events.push(`queued-save:${dock.view.activePanel ?? 'closed'}:${applying ? 'locked' : 'released'}`));
      return true;
    };
    dock.open('video', { nodeId: 'video' });
    dock.subscribe(() => events.push('view-notified'));
    await dock.submit('video', { text: '鲸鱼', options });
    expect(events).toEqual(['registered', 'queued-save:closed:released', 'view-notified']);
    expect(dock.open('video', { nodeId: 'video', intent: 'selection' })).toBe(false);
  });
  it('preset与样片参数按节点恢复，等值重开保留seed，显式关闭保留绑定且选择不得回弹', () => {
    const { dock, nodes } = fixture();
    dock.open('video', { nodeId: 'video', preset: { resolution: '480p' } });
    const seed = dock.panel('video').seed;
    expect(seed?.params).toMatchObject({ mode: 'omni', resolution: '480p', sampleMode: true });
    dock.open('video', { nodeId: 'video', preset: { resolution: '480p' } });
    expect(dock.panel('video').seed).toBe(seed);
    dock.close('video');
    expect(dock.panel('video').boundId).toBe('video');
    expect(dock.open('video', { nodeId: 'video', intent: 'selection' })).toBe(false);
    dock.open('video', { nodeId: 'video' });
    dock.updateDraft('video', { prompt: '蓝鲸', ratio: '16:9', duration: 8, generateAudio: false, sampleMode: false });
    expect(nodes[0].data).toMatchObject({ prompt: '蓝鲸', draftRatio: '16:9', targetRatio: '16:9', draftDuration: 8, draftGenerateAudio: false, draftSampleMode: false });
    dock.open('video', { nodeId: 'video' });
    expect(dock.panel('video').seed?.text).toBe('蓝鲸');
  });
});
