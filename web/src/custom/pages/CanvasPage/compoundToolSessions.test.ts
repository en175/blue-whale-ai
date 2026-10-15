import { openOtherTool } from './testing/openOtherTool';
import { expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { createToolSessionRuntime } from './toolSessionRuntime';
import { audioVideoMuxIdentityOf } from './audioVideoMux';
import { createAudioMixSession, addAudioMixInput, createAudioVideoMuxSession, type AudioMixHost, type AudioMixSubmission, type AudioVideoMuxHost, type AudioVideoMuxSubmission } from './compoundToolSessions';
import type { ToolSessionDeps } from './toolSessionCoordinator';

const deps: ToolSessionDeps = { dismissGenPanels() {}, selectNode() {} };
const audio = (id = 'a1', assetId = '8'): Node => ({ id, type: 'mediaNode', position: { x: 20, y: 30 }, data: { mediaType: 'audio', assetId, src: `https://assets/${id}.mp3`, fileName: '原音频.mp3' } });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

it('混合按素材选择顺序冻结项目、输入与源卡，退出不释放在途锁，迟到成功保留新会话', async () => {
  const node = audio();
  let projectId = 'p1';
  let inFlight = false;
  let accept!: (task: { job_id: string }) => void;
  const inputs: AudioMixSubmission[] = [];
  const delivered: AudioMixSubmission[] = [];
  const host: AudioMixHost = {
    getProjectId: () => projectId, getNode: (id) => id === 'a1' ? node : undefined,
    isInFlight: () => inFlight, setInFlight: (value) => { inFlight = value; },
    linkAssets: async () => {}, canApply: () => true,
    createTask: (input) => { inputs.push(input); return new Promise((resolve) => { accept = resolve; }); },
    handoff: async (input) => { delivered.push(input); }, warn() {}, error() {},
  };
  const runtime = createToolSessionRuntime();
  const mix = runtime.register(createAudioMixSession(() => host));
  mix.open('a1', deps);
  mix.edit((state) => addAudioMixInput(host, state, { assetId: '9', name: '素材库' }));
  mix.edit((state) => addAudioMixInput(host, state, { assetId: '10', name: '上传' }));
  mix.edit((state) => ({ ...state, format: 'flac' }));
  expect(mix.send()).toBe(true);
  await settle();
  node.data.assetId = '18'; node.data.fileName = '改名.mp3'; node.position.x = 999; projectId = 'p2';
  mix.close(); mix.open('a1', deps);
  mix.edit((state) => addAudioMixInput(host, state, { assetId: '19', name: '新素材' }));
  mix.edit((state) => ({ ...state, format: 'wav' }));
  expect(mix.getSnapshot().submitting).toBe(false);
  expect(mix.send()).toBe(false);
  expect(inFlight).toBe(true);
  accept({ job_id: '71' }); await settle();
  expect(inputs[0].payload).toEqual({ source_node_id: 'a1', inputs: [{ asset_id: '8', node_id: 'a1' }, { asset_id: '9' }, { asset_id: '10' }], output_format: 'flac' });
  expect(delivered[0]).toMatchObject({ projectId: 'p1', source: { position: { x: 20, y: 30 }, data: { fileName: '原音频.mp3', assetId: '8' } } });
  expect(mix.getSnapshot().state?.format).toBe('wav');
  expect(inFlight).toBe(false);
});

it('合成从原草稿身份冻结参数，关闭重开保留绑定；旧成功交接原卡并保留新会话', async () => {
  const nodes: Node[] = [audio(), { id: 'm1', type: 'mediaNode', position: { x: 600, y: 0 }, data: { genStatus: 'draft', audioVideoMux: { sourceNodeId: 'a1', sourceAssetId: '8', reserveAudio: false, sync: 'video', video: { assetId: '5', name: '视频' } } } }];
  let inFlight = false;
  let accept!: (task: { job_id: string }) => void;
  const inputs: AudioVideoMuxSubmission[] = [];
  const cards: string[] = [];
  const host: AudioVideoMuxHost = {
    getProjectId: () => 'p1', getNode: (id) => nodes.find((node) => node.id === id),
    isInFlight: () => inFlight, setInFlight: (value) => { inFlight = value; }, canApply: () => true,
    createDraft() { throw new Error('重开不得建卡'); },
    patchIdentity() {}, removeBindEdges() {}, addVideoEdge() {},
    createTask: (input) => { inputs.push(input); return new Promise((resolve) => { accept = resolve; }); },
    handoff: async (input) => { cards.push(input.draftId); }, warn() {}, error() {},
  };
  const runtime = createToolSessionRuntime();
  const mux = runtime.register(createAudioVideoMuxSession(() => host));
  mux.open({ draftId: 'm1' }, deps);
  mux.send();
  mux.close(); mux.open({ draftId: 'm1' }, deps);
  audioVideoMuxIdentityOf(nodes[1])!.reserveAudio = true;
  expect(mux.send()).toBe(false);
  accept({ job_id: '73' }); await settle();
  expect(inputs[0]).toEqual({ projectId: 'p1', draftId: 'm1', payload: { audio: { assetId: '8', nodeId: 'a1' }, video: { assetId: '5' }, is_audio_reserve: false, sync: 'video' } });
  expect(cards).toEqual(['m1']);
  expect(mux.getSnapshot()).toEqual({ state: { draftId: 'm1', wireDragging: false }, submitting: false });
  expect(inFlight).toBe(false);
});

function compoundHarness(kind: 'audioMix' | 'audioVideoMux') {
  const nodes: Node[] = [audio(), audio('a2', '9'), {
    id: 'm1', type: 'mediaNode', position: { x: 600, y: 0 },
    data: { genStatus: 'draft', audioVideoMux: { sourceNodeId: 'a1', sourceAssetId: '8', reserveAudio: true, sync: 'none', video: { assetId: '5', name: '视频' } } },
  }];
  let inFlight = false;
  const errors: string[] = [];
  const warnings: string[] = [];
  const tasks: string[] = [];
  const pending: Array<{ accept(task: { job_id: string }): void; reject(error: Error): void }> = [];
  const boundary: AudioMixHost & AudioVideoMuxHost = {
    getProjectId: () => 'p1', getNode: (id) => nodes.find((node) => node.id === id),
    isInFlight: () => inFlight, setInFlight: (value) => { inFlight = value; }, canApply: () => true,
    linkAssets: async () => {}, createDraft: () => 'm1', patchIdentity() {}, removeBindEdges() {}, addVideoEdge() {},
    createTask: () => new Promise((accept, reject) => { pending.push({ accept, reject }); }),
    handoff: async (_input, task) => { tasks.push(task.job_id); },
    error: (message) => { errors.push(message); }, warn: (message) => { warnings.push(message); },
  };
  const runtime = createToolSessionRuntime();
  runtime.setProject('p1');
  if (kind === 'audioMix') {
    const tool = runtime.register(createAudioMixSession(() => boundary));
    return { runtime, tool, boundary, nodes, pending, errors, warnings, tasks,
      open: () => tool.open('a1', deps),
      edit: () => tool.edit((state) => ({ ...addAudioMixInput(boundary, state, { assetId: '9', nodeId: 'a2', name: '画布' }), format: 'wav' })),
      target: 'a1', isInFlight: () => inFlight,
    };
  }
  const tool = runtime.register(createAudioVideoMuxSession(() => boundary));
  return { runtime, tool, boundary, nodes, pending, errors, warnings, tasks,
    open: () => tool.open({ draftId: 'm1' }, deps),
    edit: () => tool.edit((state) => ({ ...state, wireDragging: true })),
    target: 'm1', isInFlight: () => inFlight,
  };
}

it.each(['audioMix', 'audioVideoMux'] as const)('%s 通过公开运行时退出后清完整编辑状态，重开恢复默认且保留草稿身份', (kind) => {
  for (const exit of ['close', 'escape', 'other', 'pane', 'deleted']) {
    const test = compoundHarness(kind);
    test.open(); test.edit();
    if (exit === 'close') test.tool.close();
    else if (exit === 'escape') test.runtime.onEscape();
    else if (exit === 'other') test.runtime.onSelectionChange({ soloId: 'other', multiSelect: false });
    else if (exit === 'pane') test.runtime.onPaneClick();
    else test.runtime.reconcileSources(new Set(['other']));
    expect(test.tool.getSnapshot()).toEqual({ state: null, submitting: false });
    expect(test.nodes[2].data.audioVideoMux).toMatchObject({ sourceNodeId: 'a1', video: { assetId: '5' } });
    test.open();
    expect(test.tool.getSnapshot().state).toEqual(kind === 'audioMix'
      ? { sourceNodeId: 'a1', selectedInputs: [], format: 'mp3' }
      : { draftId: 'm1', wireDragging: false });
  }
});

it.each(['audioMix', 'audioVideoMux'] as const)('%s 旧成功仍交付，旧失败不提示；关闭、同卡重开、换工具与项目都隔离旧回复', async (kind) => {
  for (const change of ['close', 'reopen', 'switch', 'project']) {
    for (const result of ['success', 'failure']) {
      const test = compoundHarness(kind);
      test.open(); test.edit(); test.tool.send(); await settle();
      if (change === 'switch') openOtherTool(test.runtime, deps);
      else if (change === 'project') test.runtime.setProject('p2');
      else test.tool.close();
      if (change === 'reopen' || change === 'project') { test.open(); test.edit(); }
      const view = test.tool.getSnapshot();
      expect(test.isInFlight()).toBe(true);
      expect(test.tool.send()).toBe(false);
      if (result === 'success') test.pending[0].accept({ job_id: 'old1' });
      else test.pending[0].reject(new Error('旧请求失败'));
      await settle();
      expect(test.tool.getSnapshot()).toEqual(view);
      expect(test.errors).toEqual([]);
      expect(test.tasks).toEqual(result === 'success' ? ['old1'] : []);
      expect(test.isInFlight()).toBe(false);
      test.open(); test.edit(); expect(test.tool.send()).toBe(true); await settle();
      test.pending[1].reject(new Error('当前失败')); await settle();
      expect(test.errors).toEqual([kind === 'audioMix' ? '音频混合任务创建失败，请重试' : '音视频合成任务创建失败，请重试']);
      expect(test.tool.getSnapshot().state).not.toBeNull();
      expect(test.tool.getSnapshot().submitting).toBe(false);
    }
  }
});

it('混合选材跨入口按资产去重，固定源不可重复，最少两个输入且最多一百个，删除来源发送复核', async () => {
  const test = compoundHarness('audioMix');
  const tool = createToolSessionRuntime().register(createAudioMixSession(() => test.boundary));
  tool.open('a1', deps);
  expect(tool.send()).toBe(false);
  tool.edit((state) => addAudioMixInput(test.boundary, state, { assetId: '8', name: '固定源' }));
  tool.edit((state) => addAudioMixInput(test.boundary, state, { assetId: '9', nodeId: 'a2', name: '画布' }));
  tool.edit((state) => addAudioMixInput(test.boundary, state, { assetId: '9', name: '库中同素材' }));
  expect(tool.getSnapshot().state?.selectedInputs).toEqual([{ assetId: '9', nodeId: 'a2', name: '画布' }]);
  test.nodes.splice(1, 1);
  expect(tool.send()).toBe(false);
  expect(test.pending).toEqual([]);
  tool.close(); tool.open('a1', deps);
  for (let id = 10; id <= 110; id += 1) tool.edit((state) => addAudioMixInput(test.boundary, state, { assetId: String(id), name: '素材库' }));
  expect(tool.getSnapshot().state?.selectedInputs).toHaveLength(99);
  expect(tool.getSnapshot().state?.selectedInputs.at(-1)?.assetId).toBe('108');
  expect(tool.send()).toBe(true); await settle();
  test.pending[0].accept({ job_id: 'max1' }); await settle();
});
