import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { createGenerationDockCoordinator, type DockSelection } from './generationDockCoordinator';
import { createImageGenerationDock, type ImageGenerationDockHost } from '../tools/image/imageGenerationDock';
import { createVideoGenerationDock, type VideoGenerationDockHost } from '../tools/video/videoGenerationDock';
import { createAudioMusicGenerationDocks, type AudioGenerationDockHost, type MusicGenerationDockHost } from '../tools/audio/audioMusicGenerationDock';
import { createTextGenerationDock, type TextGenerationDockHost } from './textGenerationDock';
import { createToolGenerationDock } from '../tool-runtime/toolGenerationDock';
import { createToolSessionRuntime } from '../tool-runtime/toolSessionRuntime';
import { createImageEnhanceSession, createVideoEnhanceSession, createFrameInterpolationSession, type PanelToolHost } from '../tools/compound/panelToolSessions';

const mediaKinds = ['image', 'video', 'audio'] as const;
const toolKinds = ['imageEnhance', 'videoEnhance', 'frameInterpolation'] as const;
const kinds = [...mediaKinds, 'text', 'music', ...toolKinds] as const;
const videoOptions = { modelId: 'model', aspectRatio: '16:9', resolution: '720p', duration: 5, mode: 'all', generateAudio: true, sampleMode: false };

function fixture() {
  const nodes: Node[] = [...mediaKinds, 'text', ...toolKinds, 'source'].map(id => ({
    id, type: id === 'text' ? 'textNode' : 'mediaNode', position: { x: 0, y: 0 },
    data: { draft: true, genStatus: 'draft', prompt: '鲸鱼', ...(id === 'text' ? { textGen: true } : {}),
      ...(id === 'source' ? { assetId: '5', src: 'https://fixture/image.png', mediaType: 'image' } : {}),
      ...(toolKinds.some(kind => kind === id) ? { [id]: { sourceAssetId: '5' } } : {}) },
  }));
  const edges: Edge[] = [];
  const records: Array<{ kind: string; input: unknown }> = [];
  const events: string[] = [];
  const pending: { imageEnhance?: Promise<void>; videoEnhance?: Promise<void>; frameInterpolation?: Promise<boolean> } = {};
  let projectId = 'project', applying = false, submittingNodeId: string | null = null, accepted = true, allowed = true;
  let dismissOrdinary = () => {};
  const runtime = createToolSessionRuntime();
  runtime.setProject(projectId);
  const patchNode = (id: string, patch: Record<string, unknown>) => {
    const node = nodes.find(node => node.id === id)!;
    node.data = { ...node.data, ...patch };
  };
  const render = (kind: string) => () => createElement('div', { 'data-panel': kind }, kind);
  const common = {
    getNodes: () => nodes, getEdges: () => edges, attachmentsOf: () => [], canOpen: () => allowed,
    beginEdit: () => runtime.beforeGenPanel(), endPicking() {}, clearPickResult() {}, patchNode,
    getAvailability: () => ({ submittingNodeId, saveFailed: false }), getProjectId: () => projectId,
    isApplying: () => applying, isSaveBlocked: () => false, setApplying: (value: boolean) => { applying = value; },
    setSubmittingNode: (value: string | null) => { submittingNodeId = value; },
    toast() {}, reportError() {}, promptMaxLength: async () => 100,
    save: async () => { events.push('save'); return true; },
  };
  const imageHost: ImageGenerationDockHost = { ...common, render: render('image'), isProjectCurrent: id => id === projectId,
    collectInputAssetIds: async () => { events.push('collect'); return []; },
    startTask: input => { events.push('image'); records.push({ kind: 'image', input }); return accepted; } };
  const videoHost: VideoGenerationDockHost = { ...common, render: render('video'), resetAssetPicking() {}, warnStaleRefs() {}, refUnsupported: () => null,
    startTask: input => { events.push('video'); records.push({ kind: 'video', input }); return accepted; } };
  const audioHost: AudioGenerationDockHost = { ...common, render: render('audio'), addReferenceEdge: (source, target) => { edges.push({ id: source + target, source, target }); },
    fetchFile: async () => null, upload: async () => null,
    startTask: input => { events.push('audio'); records.push({ kind: 'audio', input }); return accepted; } };
  const musicHost: MusicGenerationDockHost = { beginEdit: common.beginEdit, render: render('music'), recordSend: input => records.push({ kind: 'music', input }) };
  const textHost: TextGenerationDockHost = { ...common, render: render('text') };
  const panelHost: PanelToolHost = {
    getProjectId: () => projectId, getNode: id => nodes.find(node => node.id === id), getNodes: () => nodes,
    canOpen: () => allowed, activate() {}, isValidTarget: (id, kind) => nodes.some(node => node.id === id && node.data[kind]),
    isFrameInFlight: () => false, isVideoEnhanceInFlight: () => false,
    startImage: input => { records.push({ kind: 'imageEnhance', input }); return pending.imageEnhance ?? Promise.resolve(); },
    startVideo: input => { records.push({ kind: 'videoEnhance', input }); return pending.videoEnhance ?? Promise.resolve(); },
    startFrame: input => { records.push({ kind: 'frameInterpolation', input }); return pending.frameInterpolation ?? Promise.resolve(true); },
    warn() {}, error() {}, httpError() {},
  };
  const resources = () => ({
    createDraft: (id: string) => id, getDeps: () => ({ dismissGenPanels: () => dismissOrdinary(), selectNode() {} }),
    subscribe: runtime.subscribe, getVersion: runtime.getVersion,
  });
  const audioMusic = createAudioMusicGenerationDocks(() => audioHost, () => musicHost);
  const imageHandle = runtime.register(createImageEnhanceSession(() => panelHost));
  const videoHandle = runtime.register(createVideoEnhanceSession(() => panelHost));
  const frameHandle = runtime.register(createFrameInterpolationSession(() => panelHost));
  const toolRender = <State>(handle: { getSnapshot(): { visible?: boolean; state: State | null } }, kind: string) => () => handle.getSnapshot().visible ? render(kind)() : null;
  const registry = {
    image: createImageGenerationDock(() => imageHost), video: createVideoGenerationDock(() => videoHost), ...audioMusic,
    text: createTextGenerationDock(() => textHost),
    imageEnhance: createToolGenerationDock(imageHandle, { ...resources(), render: toolRender(imageHandle, 'imageEnhance') }),
    videoEnhance: createToolGenerationDock(videoHandle, { ...resources(), render: toolRender(videoHandle, 'videoEnhance') }),
    frameInterpolation: createToolGenerationDock(frameHandle, { ...resources(), render: toolRender(frameHandle, 'frameInterpolation') }),
  };
  const dock = createGenerationDockCoordinator(registry);
  dismissOrdinary = () => dock.dismissAll('ordinary');
  const entry = { image: { nodeId: 'image' }, video: { nodeId: 'video' }, audio: { nodeId: 'audio' }, text: { nodeId: 'text' }, music: {}, imageEnhance: { nodeId: 'imageEnhance' }, videoEnhance: { nodeId: 'videoEnhance' }, frameInterpolation: { nodeId: 'frameInterpolation' } };
  return {
    dock, registry, runtime, nodes, edges, records, events, pending, textHost,
    open: (kind: keyof typeof registry) => dock.open(kind, entry[kind]),
    select(soloId: string | null, multiSelect = false) {
      const selection: DockSelection = { soloId, multiSelect, editing: false, submittingNodeId: null };
      if (!runtime.onSelectionChange(selection)) dock.selection(selection);
    },
    setProject(id: string) { projectId = id; runtime.setProject(id); },
    reconcile() { runtime.reconcileSources(new Set(nodes.map(node => node.id))); dock.reconcile(); },
    accept(value: boolean) { accepted = value; },
    allow(value: boolean) { allowed = value; },
    releaseOrdinary: (fn: () => void) => { dismissOrdinary = fn; },
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('八真实定义跨类型公开矩阵', () => {
  it.each(kinds)('互斥 %s 与八种目标切换只渲染一个实际活动面板', from => {
    const f = fixture();
    for (const to of kinds) {
      f.open(from); f.open(to);
      expect(kinds.filter(kind => f.dock.panel(kind).visible)).toEqual([to]);
      expect(f.dock.view.activePanel).toBe(to);
      const html = renderToStaticMarkup(createElement(Fragment, null, f.dock.render()));
      expect(html.match(/data-panel=/g)).toHaveLength(1);
      expect(html).toContain(`data-panel="${to}"`);
      f.dock.dismissAll();
      expect(f.dock.view.activePanel).toBeNull();
    }
  });
  it.each([...mediaKinds, ...toolKinds])('准入 %s 拒绝保持原文本面板与实际渲染', kind => {
    const f = fixture(); f.open('text'); f.allow(false);
    expect(f.open(kind)).toBe(false);
    expect(f.dock.view.activePanel).toBe('text');
    expect(kinds.filter(key => f.dock.panel(key).visible)).toEqual(['text']);
    expect(renderToStaticMarkup(createElement(Fragment, null, f.dock.render()))).toContain('data-panel="text"');
  });
  it.each(mediaKinds)('选择/关闭 %s 保留绑定，空通知不隐藏，显式关闭不能被选择恢复', kind => {
    const f = fixture(); f.open(kind);
    const seed = f.dock.panel(kind).seed;
    f.select(null); expect(f.dock.panel(kind).visible).toBe(true);
    f.select('source'); expect(f.dock.panel(kind).visible).toBe(false);
    f.select(kind); expect(f.dock.panel(kind).visible).toBe(true);
    f.dock.referencePicked(kind); f.select('source'); expect(f.dock.panel(kind).visible).toBe(true);
    f.dock.close(kind); f.select(kind);
    expect(f.dock.panel(kind)).toMatchObject({ visible: false, boundId: kind, seed });
    f.open(kind); expect(f.dock.panel(kind).visible).toBe(true);
    expect(f.dock.panel(kind).seed).toBe(seed);
  });
  it.each(mediaKinds)('选择保护 %s 编辑中不恢复、别卡提交不改变显隐，自由面板只隐藏不开启', kind => {
    const f = fixture();
    f.open(kind); f.select('source');
    f.dock.selection({ soloId: kind, multiSelect: false, editing: true, submittingNodeId: null });
    expect(f.dock.panel(kind).visible).toBe(false);
    f.dock.selection({ soloId: kind, multiSelect: false, editing: false, submittingNodeId: 'other' });
    expect(f.dock.panel(kind).visible).toBe(false);
    f.dock.selection({ soloId: kind, multiSelect: false, editing: false, submittingNodeId: kind });
    expect(f.dock.panel(kind).visible).toBe(true);
    f.dock.selection({ soloId: 'source', multiSelect: false, editing: false, submittingNodeId: 'other' });
    expect(f.dock.panel(kind).visible).toBe(true);
    f.select(null); expect(f.dock.panel(kind).visible).toBe(true);
    f.select(null, true); expect(f.dock.panel(kind).visible).toBe(false);
    const free = fixture();
    free.dock.open(kind, {});
    free.select(null); expect(free.dock.panel(kind).visible).toBe(true);
    free.select('source'); expect(free.dock.panel(kind).visible).toBe(false);
    free.select(kind); expect(free.dock.panel(kind).visible).toBe(false);
  });
  it.each(toolKinds)('选择/关闭 %s 按真实owner隐藏与恢复，显式关闭清会话', kind => {
    const f = fixture(); f.open(kind);
    f.select(null); expect(f.dock.panel(kind).visible).toBe(true);
    f.select('source'); expect(f.dock.panel(kind).visible).toBe(false);
    f.select(kind); expect(f.dock.panel(kind).visible).toBe(true);
    f.dock.close(kind); f.select(kind);
    expect(f.dock.panel(kind).state).toBeNull();
  });
  it('文本选择隐藏不回弹，writeSelf仅跳过一次点卡；音乐不保持选择绑定', () => {
    const f = fixture(); f.open('text'); f.select('source'); f.select('text');
    expect(f.dock.panel('text')).toMatchObject({ visible: false, boundId: 'text' });
    f.dock.writeSelf('text');
    expect(f.dock.open('text', { nodeId: 'text', intent: 'nodeClick' })).toBe(false);
    expect(f.dock.open('text', { nodeId: 'text', intent: 'nodeClick' })).toBe(true);
    f.open('music'); f.select('source'); f.select('text');
    expect(f.dock.panel('music')).toEqual({ visible: false });
  });
  it.each(mediaKinds)('绑定/seed %s 等值稳定，真实正文变化重挂，参数仍写宿主节点', kind => {
    const f = fixture(); f.open(kind);
    const seed = f.dock.panel(kind).seed;
    f.open(kind); expect(f.dock.panel(kind).seed).toBe(seed);
    f.dock.updateDraft(kind, { prompt: '新内容', modelId: 'new-model' });
    expect(f.nodes.find(node => node.id === kind)?.data).toMatchObject({ prompt: '新内容', draftModelId: 'new-model' });
    f.open(kind); expect(f.dock.panel(kind).seed).not.toBe(seed);
    expect(f.dock.panel(kind).seed?.text).toBe('新内容');
  });
  it.each(toolKinds)('绑定/seed %s 仍归原owner，preserve与reinitialize区别保留', kind => {
    const f = fixture(); f.open(kind);
    const state = f.dock.panel(kind).state;
    f.open(kind);
    if (kind === 'frameInterpolation') expect(f.dock.panel(kind).state).not.toBe(state);
    else expect(f.dock.panel(kind).state).toBe(state);
    expect(f.dock.panel(kind).state?.nodeId).toBe(kind);
  });
  it('文本直接派生正文与附件，没有模型恢复seed；音乐视图没有绑定或内容缓存', () => {
    const f = fixture(); f.open('text');
    f.dock.updateDraft('text', { prompt: '文本草稿', modelId: 'chosen' });
    expect(f.dock.panel('text')).toMatchObject({ boundId: 'text', initialText: '文本草稿' });
    expect(f.dock.panel('text')).not.toHaveProperty('seed');
    f.open('music'); expect(f.dock.panel('music')).toEqual({ visible: true });
  });
  it.each(mediaKinds)('发送/交接 %s false保持，true只登记提交链并保留各自准备顺序', async kind => {
    const f = fixture(); f.open(kind); f.accept(false);
    const send = () => kind === 'image' ? f.dock.submit('image', { text: '发送', modelId: 'model', size: '2k', ratio: '1:1', files: [] })
      : kind === 'video' ? f.dock.submit('video', { text: '发送', options: videoOptions })
      : f.dock.submit('audio', { text: '发送', modelId: 'model', refs: [] });
    await send(); expect(f.dock.panel(kind).visible).toBe(true);
    f.events.splice(0); f.accept(true); await send();
    expect(f.dock.panel(kind).visible).toBe(false);
    expect(f.records.at(-1)).toMatchObject({ kind, input: { targetNodeId: kind } });
    expect(f.events).toEqual(kind === 'image' ? ['collect', 'save', 'image'] : ['save', kind]);
    f.select(kind); expect(f.dock.panel(kind).visible).toBe(false);
  });
  it.each(toolKinds)('发送/交接 %s 保持同步boolean及真实异步关闭点', async kind => {
    const f = fixture(); let finish!: () => void;
    if (kind === 'frameInterpolation') f.pending.frameInterpolation = new Promise(resolve => { finish = () => resolve(true); });
    else f.pending[kind] = new Promise(resolve => { finish = resolve; });
    f.open(kind);
    const result = kind === 'imageEnhance' ? f.dock.submit('imageEnhance', { version_tier: 'pro', multiple: 2, generative_enhance_mode: 'generative_first', enable_correct_color: false })
      : kind === 'videoEnhance' ? f.dock.submit('videoEnhance', '2k') : f.dock.submit('frameInterpolation', 120);
    expect(result).toBe(true);
    expect(f.dock.panel(kind).visible).toBe(kind !== 'imageEnhance');
    expect(f.records.at(-1)).toMatchObject({ kind, input: { nodeId: kind } });
    finish(); await flush(); expect(f.dock.panel(kind).visible).toBe(false);
  });
  it('发送/交接 文本本地合成写卡后关，音乐仅原日志能力且保持可见', () => {
    const f = fixture(); f.open('text');
    f.textHost.attachmentsOf = () => [{ nodeId: 'context', title: '上游', text: '附件' }];
    f.dock.submit('text', { text: '正文', modelId: 'model' });
    expect(f.nodes.find(node => node.id === 'text')?.data).toMatchObject({ text: '附件\n\n正文', prompt: '正文', draftModelId: 'model' });
    expect(f.dock.panel('text').visible).toBe(false);
    f.open('music');
    const input = { text: '歌', model: 'music-model', options: { instrumental: true, speed: 1, lyrics: '' }, refs: [] };
    f.dock.submit('music', input);
    expect(f.records).toEqual([{ kind: 'music', input }]);
    expect(f.dock.panel('music').visible).toBe(true);
  });
  it.each([...mediaKinds, 'text'] as const)('生命周期 %s 相同文档/换项目不新增全清，失效目标才关闭', kind => {
    const f = fixture(); f.open(kind);
    f.nodes.forEach(node => { node.data = { ...node.data }; });
    f.setProject('project'); f.reconcile();
    expect(f.dock.panel(kind)).toMatchObject({ visible: true, boundId: kind });
    f.setProject('other'); expect(f.dock.panel(kind)).toMatchObject({ visible: true, boundId: kind });
    if (kind !== 'text') {
      const node = f.nodes.find(node => node.id === kind)!;
      node.data = { ...node.data, draft: false, jobId: 'record', genStatus: 'generating' };
      f.reconcile(); expect(f.dock.panel(kind).visible).toBe(true);
    }
    f.nodes.splice(f.nodes.findIndex(node => node.id === kind), 1); f.reconcile();
    expect(f.dock.panel(kind)).toMatchObject({ visible: false, boundId: null });
  });
  it.each(toolKinds)('生命周期 %s 同ID/重载/来源删除保持，目标删除或不同项目由owner退出', kind => {
    const f = fixture(); f.open(kind);
    const state = f.dock.panel(kind).state;
    f.setProject('project'); f.nodes.forEach(node => { node.data = { ...node.data }; }); f.reconcile();
    expect(f.dock.panel(kind).state).toBe(state);
    f.nodes.splice(f.nodes.findIndex(node => node.id === 'source'), 1); f.reconcile();
    expect(f.dock.panel(kind).state).toBe(state);
    f.setProject('other'); expect(f.dock.panel(kind).state).toBeNull();
    f.open(kind); f.nodes.splice(f.nodes.findIndex(node => node.id === kind), 1); f.reconcile();
    expect(f.dock.panel(kind).state).toBeNull();
  });
  it('生命周期 音乐无节点绑定，清理自身聚合订阅不影响原状态owner', () => {
    const f = fixture(); f.open('music'); f.nodes.splice(0); f.reconcile();
    expect(f.dock.panel('music').visible).toBe(true);
    const observed: string[] = [];
    const unsubscribe = f.dock.subscribe(() => observed.push(String(f.dock.view.activePanel)));
    f.dock.close('music'); expect(observed).toEqual(['null']);
    unsubscribe(); f.open('music'); expect(observed).toEqual(['null']);
  });
  it('只新增真实文本定义注册即可加入同一无参render、互斥、草稿编辑、submit与收起', () => {
    const f = fixture();
    f.nodes.push({ id: 'added', type: 'textNode', position: { x: 0, y: 0 }, data: { textGen: true } });
    const added = createTextGenerationDock(() => ({ ...f.textHost, render: () => createElement('div', { 'data-panel': 'added' }, '新增注册') }));
    const dock = createGenerationDockCoordinator({ ...f.registry, added });
    f.releaseOrdinary(() => dock.dismissAll('ordinary'));
    dock.open('image', { nodeId: 'image' }); dock.open('added', { nodeId: 'added' });
    expect(dock.panel('image').visible).toBe(false);
    expect(dock.view.activePanel).toBe('added');
    expect(renderToStaticMarkup(createElement(Fragment, null, dock.render()))).toContain('新增注册');
    dock.updateDraft('added', { prompt: '新草稿' }); dock.submit('added', { text: '结果', modelId: 'model' });
    expect(f.nodes.find(node => node.id === 'added')?.data).toMatchObject({ text: '结果', prompt: '结果' });
    expect(dock.view.activePanel).toBeNull();
    dock.open('added', { nodeId: 'added' }); dock.dismissAll(); expect(dock.view.activePanel).toBeNull();
  });
});
