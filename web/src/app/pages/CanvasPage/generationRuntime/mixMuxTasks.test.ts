import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGenerationRuntime, type GenerationRuntimeDeps } from './runtime';
import { audioMixTask, audioVideoMuxTask, watchMixSubmit } from './mixMuxTasks';
import type { GenerationRuntimeHost, RuntimeNodeView } from './types';
import type { GenerationRecoveryPage } from '@/api/canvasRecovery';

const api = vi.hoisted(() => ({
  createAudioMix: vi.fn(),
  retryAudioMix: vi.fn(),
  createAudioVideoMux: vi.fn(),
  retryAudioVideoMux: vi.fn(),
  cancelGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(),
}));
vi.mock('@/api/jobs', () => ({
  createAudioMix: api.createAudioMix,
  retryAudioMix: api.retryAudioMix,
  createAudioVideoMux: api.createAudioVideoMux,
  retryAudioVideoMux: api.retryAudioVideoMux,
  cancelGenerationJob: api.cancelGenerationJob,
  fetchJobStatus: api.fetchJobStatus,
}));

class ManualClock {
  private seq = 0;
  private timers = new Map<number, { fn: () => void }>();
  setTimeout = (fn: () => void) => {
    const id = ++this.seq;
    this.timers.set(id, { fn });
    return id;
  };
  clearTimeout = (id: unknown) => { this.timers.delete(id as number); };
  fireNext(): boolean {
    for (const [id, timer] of this.timers) {
      this.timers.delete(id);
      timer.fn();
      return true;
    }
    return false;
  }
}

const flushMicrotasks = async (rounds = 16) => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};

function createFakeHost() {
  const nodes = new Map<string, RuntimeNodeView>();
  const edges: Array<{ source: string; target: string }> = [];
  const patches: Array<{ nodeId: string; patch: Record<string, unknown> }> = [];
  const inserts: RuntimeNodeView[] = [];
  const removes: string[] = [];
  const toasts: Array<{ kind: string; message: string }> = [];
  const activeTokens = new Map<string, string>();
  const settles: string[] = [];
  let project: string | null = 'p1';
  let epoch: object = {};
  let saveCalls = 0;
  const host: GenerationRuntimeHost = {
    getProjectId: () => project,
    getLoadEpoch: () => epoch,
    getMediaNodes: () => [...nodes.values()],
    findNode: (id) => nodes.get(id) ?? null,
    patchNode: (nodeId, patch) => {
      patches.push({ nodeId, patch });
      const node = nodes.get(nodeId);
      if (node) nodes.set(nodeId, { ...node, data: { ...node.data, ...patch } });
    },
    insertMediaNode: (node) => { inserts.push(node); nodes.set(node.id, node); },
    removeMediaNode: (nodeId) => { removes.push(nodeId); nodes.delete(nodeId); },
    getEdges: () => edges,
    addEdge: (source, target) => { edges.push({ source, target }); },
    getActiveJob: (nodeId) => activeTokens.get(nodeId),
    setActiveJob: (nodeId, token) => { activeTokens.set(nodeId, token); },
    clearActiveJob: (nodeId) => { activeTokens.delete(nodeId); },
    isLocallyRemoved: () => false,
    markLocallyRemoved: () => {},
    registerPendingDelete: () => {},
    isPendingDelete: () => false,
    applyTerminal: (nodeId, _jobId, detail) => {
      const node = nodes.get(nodeId);
      if (node) nodes.set(nodeId, { ...node, data: { ...node.data, ...(detail.status === 'succeeded' ? { genStatus: undefined, src: 'ok.mp4', assetId: 'a-9' } : detail.status === 'failed' ? { genStatus: 'failed', errorText: '供应商失败' } : {}) } });
      return 'terminal';
    },
    settleCancelled: (nodeId) => {
      settles.push(nodeId);
      const node = nodes.get(nodeId);
      if (!node) return;
      if (node.data.draft === true) nodes.set(nodeId, { ...node, data: { ...node.data, genStatus: 'draft' } });
      else nodes.delete(nodeId);
    },
    saveCanvas: async () => { saveCalls += 1; return true; },
    toast: (kind, message) => { toasts.push({ kind, message }); },
    openRechargeForCreditsError: () => false,
    addAuthResume: () => {},
    rememberAsset: () => {},
    fetchRecoveryPage: async () => ({ protocol_version: 1, canvas_version: null, records: [], next_cursor: null }),
  };
  return {
    host, nodes, edges, patches, inserts, removes, toasts, activeTokens, settles,
    saveCalls: () => saveCalls,
    switchProject: (next: string | null) => { project = next; epoch = {}; nodes.clear(); edges.length = 0; },
  };
}

const emptyPage: GenerationRecoveryPage = { protocol_version: 1, canvas_version: null, records: [], next_cursor: null };
const BINDING_VIEW = (submissionId: string, nodeId: string, jobId: string, revision = 1, isCurrent = true) => ({
  protocol_version: 1,
  submission_id: submissionId,
  target_node_id: nodeId,
  binding_revision: revision,
  job_id: jobId,
  is_current: isCurrent,
});

const mixPayload = {
  source_node_id: 'a1',
  inputs: [{ asset_id: '8', node_id: 'a1' }, { asset_id: '6', node_id: 'a2' }],
  output_format: 'mp3' as const,
};
const muxPayload = {
  audio: { assetId: '8', nodeId: 'a1' },
  video: { assetId: '5', nodeId: 'v1' },
  is_audio_reserve: true,
  sync: 'none' as const,
};
const mixPlaceholder = (nodeId: string): RuntimeNodeView => ({
  id: nodeId, type: 'mediaNode', position: { x: 600, y: 0 },
  data: { src: '', fileName: '混合结果.mp3', mediaType: 'audio', genStatus: 'generating', progress: 0, jobId: '73', audioMix: { format: 'mp3' } },
});
const muxDraftNode = (nodeId: string, genStatus: string = 'draft'): RuntimeNodeView => ({
  id: nodeId, type: 'mediaNode', position: { x: 1040, y: 0 },
  data: {
    src: '', fileName: '音视频合成', mediaType: 'video', genStatus, draft: true, jobId: '79',
    audioVideoMux: { sourceNodeId: 'a1', sourceAssetId: '8', reserveAudio: true, sync: 'none', video: { assetId: '5', nodeId: 'v1', name: '城市夜景.mp4' } },
  },
});

function setup() {
  const fake = createFakeHost();
  const clock = new ManualClock();
  let idSeq = 0;
  const deps: GenerationRuntimeDeps = {
    fetchJobStatus: api.fetchJobStatus as never,
    fetchRecoveryPage: vi.fn(async () => emptyPage) as never,
    resolveItems: vi.fn() as never,
    setTimeout: clock.setTimeout as never,
    clearTimeout: clock.clearTimeout as never,
    newId: () => `sub-${String(++idSeq).padStart(4, '0')}`,
  };
  const runtime = createGenerationRuntime(fake.host, deps);
  runtime.register(audioMixTask);
  runtime.register(audioVideoMuxTask);
  return { fake, clock, runtime };
}

const targetFacts = (nodeId: string, role: 'draft' | 'result-placeholder' = 'result-placeholder') => ({
  targetNodeId: nodeId,
  seedTarget: { role, x: 600, y: 0, width: 480, height: 284, name: role === 'draft' ? '音视频合成' : '混合结果.mp3' },
  seedSources: [{ node_id: 'a1', x: 0, y: 0, width: 320, height: 320, name: '原音频.mp3' }],
  expectedBindingRevision: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.cancelGenerationJob.mockResolvedValue(null);
  api.fetchJobStatus.mockResolvedValue({ status: 'processing', progress: 10, asset: null });
});

describe('身份识别（claims 分派边界）', () => {
  it('混合卡按节点 id 前缀 + jobId 识别；未受理占位与普通生成卡不归本家族', () => {
    expect(audioMixTask.identify('audio-mix-73', { jobId: '73' })).toBe(true);
    expect(audioMixTask.identify('audio-mix-1001-2', { jobId: '88' })).toBe(true);
    expect(audioMixTask.identify('audio-mix-1001-2', {})).toBe(false);
    expect(audioMixTask.identify('media-draft-1', { jobId: '5' })).toBe(false);
    expect(audioVideoMuxTask.identify('audio-mix-73', { jobId: '73', audioMix: { format: 'mp3' } })).toBe(false);
  });

  it('合成卡按 data 身份键 + jobId 识别；未发送草稿卡（无 jobId）不归运行时', () => {
    expect(audioVideoMuxTask.identify('m1', { jobId: '79', audioVideoMux: { sourceNodeId: 'a1' } })).toBe(true);
    expect(audioVideoMuxTask.identify('m1', { audioVideoMux: { sourceNodeId: 'a1' } })).toBe(false);
    expect(audioVideoMuxTask.identify('m1', { jobId: '79' })).toBe(false);
    expect(audioVideoMuxTask.identify('audio-mix-73', { jobId: '73' })).toBe(false);
  });
});

describe('创建请求（canvas_binding 受理契约）', () => {
  it('混合创建合并 canvas_binding 进业务载荷，Idempotency-Key = submission_id，静默传输', async () => {
    api.createAudioMix.mockResolvedValue({ job_id: '73', status: 'queued', canvas_binding: BINDING_VIEW('sub-1', 'audio-mix-1', '73') });
    const outcome = await audioMixTask.create('p1', { payload: mixPayload, target: targetFacts('audio-mix-1') } as never, { protocol_version: 1, submission_id: 'sub-1' } as never, 'sub-1');
    expect(api.createAudioMix).toHaveBeenCalledWith('p1', {
      ...mixPayload,
      canvas_binding: { protocol_version: 1, submission_id: 'sub-1' },
    }, { silent: true, idempotencyKey: 'sub-1' });
    expect(outcome).toEqual({
      jobId: '73',
      canvasBinding: { protocol_version: 1, submission_id: 'sub-1', target_node_id: 'audio-mix-1', binding_revision: 1, job_id: '73', is_current: true },
    });
  });

  it('合成创建同样合并绑定；无绑定（历史兼容）时载荷原样', async () => {
    api.createAudioVideoMux.mockResolvedValue({ job_id: '79', status: 'queued' });
    await audioVideoMuxTask.create('p1', { payload: muxPayload, target: targetFacts('m1') } as never, null, 'sub-2');
    expect(api.createAudioVideoMux).toHaveBeenCalledWith('p1', muxPayload, { silent: true, idempotencyKey: 'sub-2' });
  });

  it('会话桥：受理回执回调 accepted、失败回调 failed，各只触发一次', async () => {
    const events: string[] = [];
    const unwatch = watchMixSubmit('audio-mix-1', {
      accepted: (jobId) => { events.push(`accepted:${jobId}`); },
      failed: (e) => { events.push(`failed:${(e as Error).message}`); },
    });
    api.createAudioMix.mockResolvedValue({ job_id: '73', status: 'queued' });
    await audioMixTask.create('p1', { payload: mixPayload, target: targetFacts('audio-mix-1') } as never, null, 'k');
    api.createAudioMix.mockRejectedValue(new Error('网络中断'));
    watchMixSubmit('audio-mix-1', {
      accepted: (jobId) => { events.push(`accepted:${jobId}`); },
      failed: (e) => { events.push(`failed:${(e as Error).message}`); },
    });
    await expect(audioMixTask.create('p1', { payload: mixPayload, target: targetFacts('audio-mix-1') } as never, null, 'k2')).rejects.toThrow('网络中断');
    expect(events).toEqual(['accepted:73', 'failed:网络中断']);
    unwatch();
    await expect(audioMixTask.create('p1', { payload: mixPayload, target: targetFacts('audio-mix-1') } as never, null, 'k3')).rejects.toThrow('网络中断');
    expect(events).toHaveLength(2);
  });
});

describe('专属重试（同 jobId ≠ 同提交意图）', () => {
  it('混合重试复用 jobId、携 canvas_binding（第 5 参）与幂等键；返回同 jobId + 绑定视图', async () => {
    api.retryAudioMix.mockResolvedValue({ job_id: '73', status: 'queued', replayed: false, canvas_binding: BINDING_VIEW('sub-9', 'audio-mix-1', '73', 2) });
    const outcome = await audioMixTask.retry!('p1', '73', { nodeId: 'audio-mix-1', nodeData: {} }, { protocol_version: 1, submission_id: 'sub-9' } as never, 'sub-9');
    expect(api.retryAudioMix).toHaveBeenCalledWith('p1', '73', 'sub-9', { silent: true }, { protocol_version: 1, submission_id: 'sub-9' });
    expect(outcome).toMatchObject({ jobId: '73', canvasBinding: { submission_id: 'sub-9', binding_revision: 2 } });
  });

  it('合成重试端点与载荷形状同混合；协议破坏（换 jobId）抛错不收敛', async () => {
    api.retryAudioVideoMux.mockResolvedValue({ job_id: '80', status: 'queued', replayed: false });
    await expect(audioVideoMuxTask.retry!('p1', '79', { nodeId: 'audio-video-mux-1', nodeData: {} }, null, 'sub-x'))
      .rejects.toThrow('重试任务身份不一致');
    expect(api.retryAudioVideoMux).toHaveBeenCalledWith('p1', '79', 'sub-x', { silent: true }, undefined);
  });

  it('取消走通用 generation-jobs 取消端点', async () => {
    await audioMixTask.cancel!('p1', '73');
    await audioVideoMuxTask.cancel!('p1', '79');
    expect(api.cancelGenerationJob).toHaveBeenCalledWith('p1', '73');
    expect(api.cancelGenerationJob).toHaveBeenCalledWith('p1', '79');
  });
});

describe('运行时接入：同 jobId 重试的操作轮次隔离', () => {
  it('失败卡重试生成新 submission_id、携当前承接版本；旧执行响应不覆盖新轮次', async () => {
    const { fake, clock, runtime } = setup();
    fake.nodes.set('audio-mix-1', mixPlaceholder('audio-mix-1'));
    api.createAudioMix.mockResolvedValue({ job_id: '73', status: 'queued', canvas_binding: BINDING_VIEW('sub-1', 'audio-mix-1', '73', 1) });
    expect(runtime.submit(audioMixTask, { payload: mixPayload, target: targetFacts('audio-mix-1') })).toBe(true);
    await flushMicrotasks();
    expect(fake.nodes.get('audio-mix-1')?.data.jobId).toBe('73');
    expect(runtime.bindingRevisionOf('audio-mix-1')).toBe(1);

    api.fetchJobStatus.mockResolvedValue({ status: 'failed', error: { msg: '供应商失败' } });
    clock.fireNext();
    await flushMicrotasks();
    expect(fake.nodes.get('audio-mix-1')?.data.genStatus).toBe('failed');
    expect(runtime.statusOf('audio-mix-1')).toBeNull();

    api.fetchJobStatus.mockResolvedValue({ status: 'succeeded', asset: { id: 'a-9', url: 'ok.mp3', type: 'audio' }, output_assets: [{ id: 'a-9' }] });
    api.retryAudioMix.mockResolvedValue({ job_id: '73', status: 'queued', replayed: false, canvas_binding: BINDING_VIEW('sub-2', 'audio-mix-1', '73', 2) });
    expect(runtime.retry('audio-mix-1')).toBe(true);
    await flushMicrotasks();
    const retryCall = api.retryAudioMix.mock.calls[0];
    expect(retryCall[0]).toBe('p1');
    expect(retryCall[1]).toBe('73');
    expect(retryCall[2]).not.toBe('sub-1');
    expect(retryCall[3]).toEqual({ silent: true });
    expect(retryCall[4]).toMatchObject({
      submission_id: retryCall[2],
      target_node_id: 'audio-mix-1',
      expected_binding_revision: 1,
    });
    expect(runtime.bindingRevisionOf('audio-mix-1')).toBe(2);

    await flushMicrotasks();
    clock.fireNext();
    await flushMicrotasks();
    expect(fake.nodes.get('audio-mix-1')?.data.genStatus).toBeUndefined();
    expect(fake.nodes.get('audio-mix-1')?.data.generationRecovery).toEqual({ protocolVersion: 1, submissionId: 'sub-2', outputKey: 'primary' });
    const saveFields = runtime.composeSaveFields();
    expect(saveFields?.recoveryChanges).toEqual([
      { recoveryItemId: 'gcr:sub-2:$target', expectedRevision: 1, action: 'replaceTarget' },
      { recoveryItemId: 'gcr:sub-2:primary', expectedRevision: 0, action: 'apply' },
    ]);
  });

  it('历史卡（无受理关联）重试不带 canvas_binding，走原协议路径', async () => {
    const { fake, runtime } = setup();
    fake.nodes.set('audio-mix-73', { ...mixPlaceholder('audio-mix-73'), data: { ...mixPlaceholder('audio-mix-73').data, genStatus: 'failed', errorText: '旧失败' } });
    api.retryAudioMix.mockResolvedValue({ job_id: '73', status: 'queued', replayed: false });
    expect(runtime.retry('audio-mix-73')).toBe(true);
    await flushMicrotasks();
    expect(api.retryAudioMix).toHaveBeenCalledWith('p1', '73', expect.any(String), { silent: true }, undefined);
    expect(fake.nodes.get('audio-mix-73')?.data.genStatus).toBe('generating');
  });
});

describe('运行时接入：取消 settleTarget 回草稿后再次生成', () => {
  it('合成取消确认后回草稿、保存带 settleTarget；再提交携保留的承接版本', async () => {
    const { fake, runtime } = setup();
    fake.nodes.set('m1', muxDraftNode('m1'));
    api.createAudioVideoMux.mockResolvedValue({ job_id: '79', status: 'queued', canvas_binding: BINDING_VIEW('sub-1', 'm1', '79', 1) });
    expect(runtime.submit(audioVideoMuxTask, { payload: muxPayload, target: targetFacts('m1', 'draft') })).toBe(true);
    await flushMicrotasks();
    expect(fake.saveCalls()).toBeGreaterThan(0);
    expect(fake.nodes.get('m1')?.data.jobId).toBe('79');

    api.cancelGenerationJob.mockResolvedValue(null);
    api.fetchJobStatus.mockResolvedValue({ status: 'cancelled' });
    expect(runtime.cancel('m1')).toBe(true);
    await flushMicrotasks();
    expect(fake.settles).toEqual(['m1']);
    expect(fake.nodes.get('m1')?.data.genStatus).toBe('draft');
    const saveFields = runtime.composeSaveFields();
    expect(saveFields?.recoveryChanges).toEqual([
      { recoveryItemId: 'gcr:sub-1:$target', expectedRevision: 1, action: 'settleTarget' },
    ]);

    runtime.onSaveReceipt({
      commandId: 'cmd-1', replayed: false,
      changes: [{ recoveryItemId: 'gcr:sub-1:$target', revision: 2, nodeBindingRevision: 1, state: 'present' }],
    });
    expect(runtime.composeSaveFields()).toBeNull();
    api.createAudioVideoMux.mockResolvedValue({ job_id: '80', status: 'queued', canvas_binding: BINDING_VIEW('sub-3', 'm1', '80', 2) });
    expect(runtime.submit(audioVideoMuxTask, {
      payload: { ...muxPayload, is_audio_reserve: false },
      target: { ...targetFacts('m1', 'draft'), expectedBindingRevision: runtime.bindingRevisionOf('m1') },
    })).toBe(true);
    await flushMicrotasks();
    expect(api.createAudioVideoMux.mock.calls[1][1].canvas_binding).toMatchObject({
      target_node_id: 'm1',
      expected_binding_revision: 1,
      recovery_seed: { target: { role: 'draft' } },
    });
  });

  it('混合占位卡取消收敛为移除（无内容 result-placeholder），保存带 remove($target)', async () => {
    const { fake, runtime } = setup();
    fake.nodes.set('audio-mix-1', mixPlaceholder('audio-mix-1'));
    api.createAudioMix.mockResolvedValue({ job_id: '73', status: 'queued', canvas_binding: BINDING_VIEW('sub-1', 'audio-mix-1', '73', 1) });
    runtime.submit(audioMixTask, { payload: mixPayload, target: targetFacts('audio-mix-1') });
    await flushMicrotasks();
    api.fetchJobStatus.mockResolvedValue({ status: 'cancelled' });
    runtime.cancel('audio-mix-1');
    await flushMicrotasks();
    expect(fake.nodes.has('audio-mix-1')).toBe(false);
    expect(fake.settles).toEqual(['audio-mix-1']);
    const saveFields = runtime.composeSaveFields();
    expect(saveFields?.recoveryChanges).toEqual([
      { recoveryItemId: 'gcr:sub-1:$target', expectedRevision: 1, action: 'remove' },
    ]);
  });
});

describe('恢复落卡规划（planRecovery）', () => {
  const record = (overrides: Partial<GenerationRecoveryPage['records'][number]> = {}): GenerationRecoveryPage['records'][number] => ({
    submission_id: 'sub-1',
    target_node_id: 'audio-mix-1',
    job_id: '73',
    task_type: 'audio_mix',
    binding_revision: 1,
    is_current: true,
    job: { job_id: '73', type: 'audio_mix', status: 'queued', progress: 0, output_asset_ids: null, stored_error: null, created_at: '2026-10-01T00:00:00Z' },
    recovery_seed: { target: { role: 'result-placeholder', x: 600, y: 20, width: 480, height: 284, name: '混合结果.flac' }, sources: [] },
    previous_target_snapshot: null,
    items: [],
    ...overrides,
  });
  it('进行中而卡不在画布：按种子补占位卡（家族卡形态），在卡则续轮询', () => {
    const freshHost = createFakeHost().host;
    const plan = audioMixTask.planRecovery!(record(), freshHost);
    expect(plan).toMatchObject({ kind: 'restore-target' });
    if (plan.kind !== 'restore-target') return;
    expect(plan.node).toMatchObject({
      id: 'audio-mix-1', type: 'mediaNode', position: { x: 600, y: 20 },
      data: { mediaType: 'audio', genStatus: 'generating', jobId: '73', audioMix: { format: 'flac' } },
    });
    freshHost.insertMediaNode(plan.node);
    expect(audioMixTask.planRecovery!(record(), freshHost)).toEqual({ kind: 'resume-polling' });
  });

  it('B.3 优先级：恢复位置取原目标快照（已保存编辑）优先，种子仅无快照时回退', () => {
    const plan = audioMixTask.planRecovery!(record({
      previous_target_snapshot: { id: 'audio-mix-1', type: 'mediaNode', position: { x: 999, y: 77 } },
    }), createFakeHost().host);
    expect(plan).toMatchObject({ kind: 'restore-target' });
    if (plan.kind !== 'restore-target') return;
    expect(plan.node.position).toEqual({ x: 999, y: 77 });
  });

  it('succeeded 且 primary present 而卡在画布 → none（一对一已保存成品卡不被扇出重建）', () => {
    const host = createFakeHost().host;
    host.insertMediaNode({
      id: 'audio-mix-1', type: 'mediaNode', position: { x: 600, y: 20 },
      data: { fileName: '用户改名', generationRecovery: { protocolVersion: 1, submissionId: 'sub-1', outputKey: 'primary' } },
    });
    const plan = audioMixTask.planRecovery!(record({
      job: { job_id: '73', type: 'audio_mix', status: 'succeeded', progress: 100, output_asset_ids: ['9'], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
      items: [{ recovery_item_id: 'gcr:sub-1:primary', output_key: 'primary', node_id: 'audio-mix-1', state: 'present', revision: 1, node_binding_revision: 1, asset_id: '9', slot_id: null }],
    }), host);
    expect(plan).toEqual({ kind: 'none' });
  });

  it('失败且卡不在画布：补失败卡保留重试入口（errorText 透传）', () => {
    const plan = audioMixTask.planRecovery!(record({
      job: { job_id: '73', type: 'audio_mix', status: 'failed', progress: 0, output_asset_ids: null, stored_error: { msg: '供应商超时' }, created_at: '2026-10-01T00:00:00Z' },
    }), createFakeHost().host);
    expect(plan).toMatchObject({ kind: 'restore-target' });
    if (plan.kind !== 'restore-target') return;
    expect(plan.node.data).toMatchObject({ genStatus: 'failed', errorText: '供应商超时', jobId: '73' });
  });

  it('失败记录：缺卡身份不可信无画布动作；在场已收敛终态不重轮询；仅未确认占位接续', () => {
    const failedRecord = record({
      target_node_id: 'm1', job_id: '79', task_type: 'audio_video_mux',
      job: { job_id: '79', type: 'audio_video_mux', status: 'failed', progress: 0, output_asset_ids: null, stored_error: { msg: '供应商超时' }, created_at: '2026-10-01T00:00:00Z' },
      recovery_seed: { target: { role: 'draft', x: 1040, y: 0, width: 320, height: 320, name: '音视频合成' }, sources: [] },
      previous_target_snapshot: { data: {} },
    });
    expect(audioVideoMuxTask.planRecovery!(failedRecord, createFakeHost().host)).toEqual({ kind: 'none' });
    const settled = createFakeHost().host;
    settled.insertMediaNode(muxDraftNode('m1', 'failed'));
    expect(audioVideoMuxTask.planRecovery!(failedRecord, settled)).toEqual({ kind: 'none' });
    const placeholder = createFakeHost().host;
    const generating = muxDraftNode('m1', 'generating');
    placeholder.insertMediaNode({ ...generating, data: { ...generating.data, jobId: undefined } });
    expect(audioVideoMuxTask.planRecovery!(failedRecord, placeholder)).toEqual({ kind: 'resume-polling' });
  });

  it('成功且有未应用输出：走扇出投影（mediaType 按家族）', () => {
    const plan = audioMixTask.planRecovery!(record({
      job: { job_id: '73', type: 'audio_mix', status: 'succeeded', progress: 100, output_asset_ids: ['9'], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
      items: [{ recovery_item_id: 'gcr:sub-1:primary', output_key: 'primary', node_id: 'audio-mix-1', state: 'pending', revision: 0, node_binding_revision: 1, asset_id: '9', slot_id: null }],
    }), createFakeHost().host);
    expect(plan).toMatchObject({
      kind: 'apply-outputs',
      unavailableTarget: {
        id: 'audio-mix-1', position: { x: 600, y: 20 },
        data: { mediaType: 'audio', audioMix: { format: 'flac' } },
      },
      projection: {
        kind: 'multi-output',
        outputs: [{ outputKey: 'primary', nodeId: 'audio-mix-1', assetId: '9', url: '', mediaType: 'audio' }],
      },
    });
  });

  it('合成恢复：身份取自原目标快照 data.audioVideoMux；快照不可信则不猜卡', () => {
    const muxRecord = record({
      target_node_id: 'm1', job_id: '79', task_type: 'audio_video_mux',
      job: { job_id: '79', type: 'audio_video_mux', status: 'processing', progress: 10, output_asset_ids: null, stored_error: null, created_at: '2026-10-01T00:00:00Z' },
      recovery_seed: { target: { role: 'draft', x: 1040, y: 0, width: 320, height: 320, name: '音视频合成' }, sources: [] },
      previous_target_snapshot: {
        id: 'm1', type: 'mediaNode', position: { x: 1040, y: 0 }, width: 320, height: 180,
        data: { audioVideoMux: { sourceNodeId: 'a1', sourceAssetId: '8', reserveAudio: false, sync: 'video', video: { assetId: '5', nodeId: 'v1', name: '城市夜景.mp4' } } },
      },
    });
    const plan = audioVideoMuxTask.planRecovery!(muxRecord, createFakeHost().host);
    expect(plan).toMatchObject({ kind: 'restore-target' });
    if (plan.kind !== 'restore-target') return;
    expect(plan.node).toMatchObject({
      id: 'm1', position: { x: 1040, y: 0 },
      data: { mediaType: 'video', genStatus: 'generating', jobId: '79', audioVideoMux: { sourceNodeId: 'a1', reserveAudio: false, sync: 'video' } },
    });
    const untrusted = audioVideoMuxTask.planRecovery!({ ...muxRecord, previous_target_snapshot: { data: {} } }, createFakeHost().host);
    expect(untrusted).toEqual({ kind: 'none' });
    const noSnapshot = audioVideoMuxTask.planRecovery!({ ...muxRecord, previous_target_snapshot: null, recovery_seed: { target: { role: 'result-placeholder', x: 0, y: 0, width: 1, height: 1, name: '' }, sources: [] } }, createFakeHost().host);
    expect(noSnapshot).toEqual({ kind: 'none' });
  });
});
