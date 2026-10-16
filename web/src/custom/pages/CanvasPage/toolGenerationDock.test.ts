import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { createGenerationDockCoordinator } from './generationDockCoordinator';
import { createToolGenerationDock } from './toolGenerationDock';
import { createToolSessionRuntime } from './toolSessionRuntime';
import { createImageEnhanceSession, createFrameInterpolationSession, createVideoEnhanceSession, type PanelToolHost } from './tools/compound/panelToolSessions';

function fixture() {
  const nodes: Node[] = [{ id: 'target', position: { x: 0, y: 0 }, data: { draft: true, videoEnhance: { sourceAssetId: '5' } } }];
  let projectId = 'project';
  const host: PanelToolHost = {
    getProjectId: () => projectId, getNodes: () => nodes, getNode: id => nodes.find(node => node.id === id),
    canOpen: () => true, activate: () => {}, isValidTarget: () => true, isFrameInFlight: () => false, isVideoEnhanceInFlight: () => false,
    startImage: async () => {}, startVideo: async () => {}, startFrame: async () => true, warn: () => {}, error: () => {}, httpError: () => {},
  };
  const runtime = createToolSessionRuntime(); runtime.setProject('project');
  const handle = runtime.register(createVideoEnhanceSession(() => host));
  let ordinaryVisible = false, createAllowed = false, creations = 0;
  const normal = { view: () => ({ visible: ordinaryVisible }), open: (_input: Record<string, unknown>) => { ordinaryVisible = true; }, hide: () => { ordinaryVisible = false; }, close: () => { ordinaryVisible = false; }, updateDraft(_input: never) {}, submit(_input: never) {} };
  const dock = createGenerationDockCoordinator({ ordinary: normal, videoEnhance: createToolGenerationDock(handle, {
    createDraft: () => { creations += 1; if (!createAllowed) return; const id = `derived-${creations}`; nodes.push({ ...nodes[0], id, data: { ...nodes[0].data } }); return id; },
    getDeps: () => ({ dismissGenPanels: normal.close, selectNode: () => {} }),
    subscribe: runtime.subscribe, getVersion: runtime.getVersion,
  }) });
  return { dock, runtime, handle, host, nodes, allowCreation: () => { createAllowed = true; }, creations: () => creations, setProject: (id: string) => { projectId = id; runtime.setProject(id); } };
}

describe('工具 Dock 真实 owner 公开接缝', () => {
  it('合法来源只创建一个派生目标，目标准入拒绝时保留创建副作用与原反馈', () => {
    const { dock, host, nodes, allowCreation, creations } = fixture();
    allowCreation();
    const targets: string[] = [], feedback: string[] = [];
    host.canOpen = id => { targets.push(id); feedback.push('原目标拒绝'); return false; };
    dock.open('ordinary', {});
    expect(dock.open('videoEnhance', { sourceId: 'source' })).toBe(false);
    expect(targets).toEqual(['derived-1']);
    expect(feedback).toEqual(['原目标拒绝']);
    expect(creations()).toBe(1);
    expect(nodes.some(node => node.id === 'derived-1')).toBe(true);
    expect(dock.view.activePanel).toBe('ordinary');
    host.canOpen = () => true;
    expect(dock.open('videoEnhance', { nodeId: 'derived-1' })).toBe(true);
    expect(dock.panel('videoEnhance').state?.nodeId).toBe('derived-1');
    expect(creations()).toBe(1);
    expect(dock.view.activePanel).toBe('videoEnhance');
  });
  it('高清与HD同卡保留owner快照且仍查门槛，插帧重入使用新状态与当前在途事实', () => {
    const { runtime, host, nodes } = fixture();
    nodes[0].data.imageEnhance = { sourceAssetId: '5' };
    nodes[0].data.frameInterpolation = { sourceAssetId: '5', lastParams: { fps: 60 } };
    const image = runtime.register(createImageEnhanceSession(() => host));
    const video = runtime.register(createVideoEnhanceSession(() => host));
    const frame = runtime.register(createFrameInterpolationSession(() => host));
    const resources = { createDraft: (id: string) => id, getDeps: () => ({ dismissGenPanels() {}, selectNode() {} }), subscribe: runtime.subscribe, getVersion: runtime.getVersion };
    const dock = createGenerationDockCoordinator({ image: createToolGenerationDock(image, resources), video: createToolGenerationDock(video, resources), frame: createToolGenerationDock(frame, resources) });
    for (const kind of ['image', 'video'] as const) {
      dock.open(kind, { nodeId: 'target' });
      const before = dock.panel(kind).state;
      expect(dock.open(kind, { nodeId: 'target' })).toBe(true);
      expect(dock.panel(kind).state).toBe(before);
      host.canOpen = () => false;
      expect(dock.open(kind, { nodeId: 'target' })).toBe(false);
      expect(dock.panel(kind).state).toBe(before);
      host.canOpen = () => true;
    }
    dock.open('frame', { nodeId: 'target' });
    const previous = dock.panel('frame').state;
    host.isFrameInFlight = () => true;
    dock.open('frame', { nodeId: 'target' });
    expect(dock.panel('frame').state).not.toBe(previous);
    expect(dock.panel('frame').state).toMatchObject({ inFlight: true, seed: { initialFps: 60 } });
  });
  it('高清登记即退出，HD等待原交接，插帧等待调度结果，各路径仍返回同步boolean', async () => {
    const { runtime, host, nodes } = fixture();
    nodes[0].data.imageEnhance = { sourceAssetId: '5' };
    nodes[0].data.frameInterpolation = { sourceAssetId: '5' };
    let finishImage!: () => void, finishVideo!: () => void, finishFrame!: (value: boolean) => void;
    host.startImage = () => new Promise(resolve => { finishImage = resolve; });
    host.startVideo = () => new Promise(resolve => { finishVideo = resolve; });
    host.startFrame = () => new Promise(resolve => { finishFrame = resolve; });
    const resources = { createDraft: (id: string) => id, getDeps: () => ({ dismissGenPanels() {}, selectNode() {} }), subscribe: runtime.subscribe, getVersion: runtime.getVersion };
    const dock = createGenerationDockCoordinator({ image: createToolGenerationDock(runtime.register(createImageEnhanceSession(() => host)), resources), video: createToolGenerationDock(runtime.register(createVideoEnhanceSession(() => host)), resources), frame: createToolGenerationDock(runtime.register(createFrameInterpolationSession(() => host)), resources) });
    dock.open('image', { nodeId: 'target' });
    expect(dock.submit('image', { version_tier: 'lite', multiple: 2, generative_enhance_mode: 'fidelity_first', enable_correct_color: true })).toBe(true);
    expect(dock.panel('image').visible).toBe(false);
    finishImage();
    dock.open('video', { nodeId: 'target' });
    expect(dock.submit('video', '2k')).toBe(true);
    expect(dock.panel('video')).toMatchObject({ visible: true, submitting: true });
    finishVideo();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(dock.panel('video').visible).toBe(false);
    dock.open('frame', { nodeId: 'target' });
    expect(dock.submit('frame', 60)).toBe(true);
    finishFrame(false);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(dock.panel('frame')).toMatchObject({ visible: true, submitting: false });
    dock.submit('frame', 60);
    finishFrame(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(dock.panel('frame').visible).toBe(false);
  });
  it('同项目和文档节点通知保留会话，来源删除保留目标，目标删除和换项目由owner退出', () => {
    const { dock, runtime, nodes, setProject } = fixture();
    nodes.push({ id: 'source', position: { x: 1, y: 1 }, data: { assetId: '5' } });
    dock.open('videoEnhance', { nodeId: 'target' });
    const state = dock.panel('videoEnhance').state;
    setProject('project');
    runtime.reconcileSources(new Set(nodes.map(node => node.id)));
    expect(dock.panel('videoEnhance').state).toBe(state);
    nodes.pop();
    runtime.reconcileSources(new Set(nodes.map(node => node.id)));
    expect(dock.panel('videoEnhance').state).toBe(state);
    nodes.splice(0);
    runtime.reconcileSources(new Set());
    expect(dock.panel('videoEnhance').state).toBeNull();
    nodes.push({ id: 'target', position: { x: 0, y: 0 }, data: { draft: true, videoEnhance: { sourceAssetId: '5' } } });
    dock.open('videoEnhance', { nodeId: 'target' });
    setProject('other');
    expect(dock.panel('videoEnhance').state).toBeNull();
  });
  it('HD关闭重开后旧准备失败不关闭新会话或清新锁', async () => {
    const { dock, host } = fixture();
    const pending: Array<{ resolve(): void; reject(error: unknown): void }> = [];
    const errors: string[] = [];
    host.startVideo = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
    host.error = message => { errors.push(message); };
    dock.open('videoEnhance', { nodeId: 'target' });
    dock.submit('videoEnhance', '2k');
    dock.close('videoEnhance');
    dock.open('videoEnhance', { nodeId: 'target' });
    dock.submit('videoEnhance', '4k');
    pending[0].reject(new Error('old'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(errors).toEqual([]);
    expect(dock.panel('videoEnhance')).toMatchObject({ visible: true, submitting: true });
    pending[1].resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(dock.panel('videoEnhance').visible).toBe(false);
  });

  it('共享runtime订阅与版本只聚合一次，卸载后不再通知', () => {
    const { runtime, host } = fixture();
    const first = runtime.register(createVideoEnhanceSession(() => host));
    const second = runtime.register({ kind: 'another', panel: 'preserve', initialize: (nodeId: string) => ({ nodeId }), target: state => state.nodeId, capture: () => null, submit: async () => {}, onError() {} });
    const resources = { createDraft: (id: string) => id, getDeps: () => ({ dismissGenPanels() {}, selectNode() {} }), subscribe: runtime.subscribe, getVersion: runtime.getVersion };
    const dock = createGenerationDockCoordinator({ first: createToolGenerationDock(first, resources), second: createToolGenerationDock(second, resources) });
    const observed: number[] = [];
    const unsubscribe = dock.subscribe(() => observed.push(dock.getVersion()));
    dock.open('first', { nodeId: 'target' });
    expect(observed.at(-1)).toBe(runtime.getVersion());
    const previous = [...observed];
    unsubscribe();
    dock.open('second', { nodeId: 'target' });
    expect(observed).toEqual(previous);
  });

  it('来源与目标准入失败保留原普通面板，来源只执行一次现有创建回调', () => {
    const { dock, host, creations } = fixture();
    dock.open('ordinary', {});
    expect(dock.open('videoEnhance', { sourceId: 'source' })).toBe(false);
    expect(dock.view.activePanel).toBe('ordinary');
    expect(creations()).toBe(1);
    host.canOpen = () => false;
    expect(dock.open('videoEnhance', { nodeId: 'target' })).toBe(false);
    expect(dock.view.activePanel).toBe('ordinary');
    expect(creations()).toBe(1);
  });
});
