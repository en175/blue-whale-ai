import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiError } from '@/shared/api/http';

const apiMocks = vi.hoisted(() => ({
  finalizeVideoJob: vi.fn(),
  regenerateSampleJob: vi.fn(),
  fetchJobStatus: vi.fn(),
}));

vi.mock('@/app/api/jobs', () => ({
  finalizeVideoJob: apiMocks.finalizeVideoJob,
  regenerateSampleJob: apiMocks.regenerateSampleJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
}));

import { storyboardTask } from './storyboardTasks';
import { createGenerationRuntime } from './runtime';
import { normalGenerationTask } from './normalGeneration';
import type { GenerationRuntimeHost, RuntimeNodeView } from './types';
import type { GenerationRecoveryPage } from '@/app/api/canvasRecovery';

class ManualClock {
  private seq = 0;
  private timers = new Map<number, { fn: () => void; at: number }>();
  setTimeout = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.timers.set(id, { fn, at: ms });
    return id;
  };
  clearTimeout = (id: unknown) => { this.timers.delete(id as number); };
  pendingCount(): number { return this.timers.size; }
  fireNext(): boolean {
    const next = this.timers.values().next();
    if (next.done) return false;
    for (const [id, timer] of this.timers) {
      if (timer === next.value) { this.timers.delete(id); timer.fn(); return true; }
    }
    return false;
  }
}

const flushMicrotasks = async (rounds = 12) => {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
};

interface FakeHost {
  host: GenerationRuntimeHost;
  nodes: Map<string, RuntimeNodeView>;
  patches: Array<{ nodeId: string; patch: Record<string, unknown> }>;
  inserts: RuntimeNodeView[];
  removes: string[];
  toasts: Array<{ kind: string; message: string }>;
  terminalResults: Array<{ nodeId: string; jobId: string; status: string }>;
  data: (nodeId: string) => Record<string, unknown>;
}

function createFakeHost(): FakeHost {
  const nodes = new Map<string, RuntimeNodeView>();
  const patches: FakeHost['patches'] = [];
  const inserts: RuntimeNodeView[] = [];
  const removes: string[] = [];
  const toasts: FakeHost['toasts'] = [];
  const terminalResults: FakeHost['terminalResults'] = [];
  const activeTokens = new Map<string, string>();
  const epoch = {};
  const host: GenerationRuntimeHost = {
    getProjectId: () => 'p1',
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
    getEdges: () => [],
    addEdge: () => {},
    getActiveJob: (nodeId) => activeTokens.get(nodeId),
    setActiveJob: (nodeId, token) => { activeTokens.set(nodeId, token); },
    clearActiveJob: (nodeId) => { activeTokens.delete(nodeId); },
    isLocallyRemoved: () => false,
    markLocallyRemoved: () => {},
    registerPendingDelete: () => {},
    isPendingDelete: () => false,
    applyTerminal: (nodeId, jobId, detail) => {
      terminalResults.push({ nodeId, jobId, status: detail.status });
      const node = nodes.get(nodeId);
      if (node && detail.status === 'succeeded') {
        nodes.set(nodeId, { ...node, data: { ...node.data, genStatus: undefined, src: detail.asset?.url ?? '' } });
      }
      if (node && detail.status === 'failed') {
        nodes.set(nodeId, { ...node, data: { ...node.data, genStatus: 'failed' } });
      }
      return 'terminal';
    },
    settleCancelled: () => {},
    saveCanvas: async () => true,
    toast: (kind, message) => { toasts.push({ kind, message }); },
    openRechargeForCreditsError: () => false,
    addAuthResume: () => {},
    rememberAsset: () => {},
    fetchRecoveryPage: async () => ({ protocol_version: 1, canvas_version: null, records: [], next_cursor: null }),
  };
  return { host, nodes, patches, inserts, removes, toasts, terminalResults, data: (id) => nodes.get(id)?.data ?? {} };
}

const BINDING_VIEW = (submissionId: string, nodeId: string, jobId: string) => ({
  protocol_version: 1,
  submission_id: submissionId,
  target_node_id: nodeId,
  binding_revision: 1,
  job_id: jobId,
  is_current: true,
});

const targetFacts = (nodeId: string) => ({
  targetNodeId: nodeId,
  seedTarget: { role: 'result-placeholder' as const, x: 10, y: 20, width: 320, height: 320, name: '成片生成中' },
  seedSources: [],
  expectedBindingRevision: 0,
});

function setup(statusScript: Array<Record<string, unknown>> = [{ status: 'processing', progress: 10, asset: null }]) {
  const fake = createFakeHost();
  const clock = new ManualClock();
  let statusIndex = 0;
  apiMocks.fetchJobStatus.mockImplementation(async () => {
    const item = statusScript[Math.min(statusIndex, statusScript.length - 1)];
    statusIndex += 1;
    return JSON.parse(JSON.stringify(item ?? { status: 'processing', progress: 0, asset: null }));
  });
  const runtime = createGenerationRuntime(fake.host, {
    fetchJobStatus: apiMocks.fetchJobStatus as never,
    fetchRecoveryPage: (async () => ({ protocol_version: 1, canvas_version: null, records: [], next_cursor: null })) as never,
    setTimeout: clock.setTimeout as never,
    clearTimeout: clock.clearTimeout as never,
    newId: (() => { let n = 0; return () => `uuid-${String(++n).padStart(4, '0')}`; })(),
  });
  runtime.register(normalGenerationTask);
  runtime.register(storyboardTask);
  return { fake, runtime, clock };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('成片/重生样片类型定义：身份让渡与冻结输入', () => {
  it('不承接卡片生命周期（identify 恒 false）：两阶段卡归 normalGeneration 统一认领', () => {
    expect(storyboardTask.taskTypes).toEqual([]);
    expect(storyboardTask.identify('f1', { jobId: '9002', videoStage: 'final', genStatus: 'failed' })).toBe(false);
    expect(storyboardTask.identify('s1', { jobId: '9001', videoStage: 'sample', genStatus: 'generating' })).toBe(false);
    expect(storyboardTask.identify('n1', { jobId: '9100' })).toBe(false);
    const { runtime } = setup();
    expect(runtime.claims('f1', { jobId: '9002', videoStage: 'final', genStatus: 'generating' })).toBe(true);
    expect(normalGenerationTask.identify('f1', { jobId: '9002', videoStage: 'final' })).toBe(true);
  });

  it('冻结输入在服务端（finalize/regenerate 从原样片派生），类型不实现 frozenInput', () => {
    expect(storyboardTask.frozenInput).toBeUndefined();
  });
});

describe('成片/重生样片类型定义：创建协议', () => {
  it('成片：finalize 端点仅报价确认两字段（无 canvas_binding——契约 .strict()），key 透传；受理成功回调', async () => {
    apiMocks.finalizeVideoJob.mockResolvedValueOnce({ generation_job_id: '9002', cursor: 7 });
    const accepted: string[] = [];
    const outcome = await storyboardTask.create(
      'p1',
      {
        payload: {
          kind: 'finalize', sampleJobId: '9001', expectedCredits: 80, quoteRevision: 'rev-f1',
          onAccepted: (jobId) => { accepted.push(jobId); },
        },
      },
      { protocol_version: 1, submission_id: 'k1', target_node_id: 'n1', expected_binding_revision: 0, recovery_seed: { target: { role: 'result-placeholder', x: 0, y: 0, width: 1, height: 1, name: '' }, sources: [] } },
      'k1',
    );
    expect(apiMocks.finalizeVideoJob).toHaveBeenCalledTimes(1);
    expect(apiMocks.finalizeVideoJob).toHaveBeenCalledWith(
      'p1', '9001', { expected_credits: 80, quote_revision: 'rev-f1' }, 'k1', { silent: true },
    );
    expect(outcome).toEqual({ jobId: '9002', cursor: 7, canvasBinding: null });
    expect(accepted).toEqual(['9002']);
  });

  it('重生样片：确认两字段 + canvas_binding（key = submission_id），回执视图透传；无 binding 时请求体不带该键', async () => {
    apiMocks.regenerateSampleJob.mockResolvedValueOnce({
      generation_job_id: '9100',
      cursor: 8,
      canvas_binding: BINDING_VIEW('sub-1', 'n2', '9100'),
    });
    const binding = {
      protocol_version: 1 as const,
      submission_id: 'sub-1',
      target_node_id: 'n2',
      expected_binding_revision: 0,
      recovery_seed: { target: { role: 'result-placeholder' as const, x: 0, y: 0, width: 1, height: 1, name: '' }, sources: [] },
    };
    const withBinding = await storyboardTask.create('p1', { payload: { kind: 'regenerate-sample', sampleJobId: '9001', expectedCredits: 40, quoteRevision: 'rev-r1' } }, binding, 'sub-1');
    expect(apiMocks.regenerateSampleJob).toHaveBeenLastCalledWith(
      'p1', '9001', { expected_credits: 40, quote_revision: 'rev-r1', canvas_binding: binding }, 'sub-1', { silent: true },
    );
    expect(withBinding.canvasBinding).toMatchObject({ submission_id: 'sub-1', binding_revision: 1, is_current: true });

    apiMocks.regenerateSampleJob.mockResolvedValueOnce({ generation_job_id: '9101', cursor: 9 });
    await storyboardTask.create('p1', { payload: { kind: 'regenerate-sample', sampleJobId: '9001', expectedCredits: 40, quoteRevision: 'rev-r1' } }, null, 'k-legacy');
    expect(apiMocks.regenerateSampleJob).toHaveBeenLastCalledWith(
      'p1', '9001', { expected_credits: 40, quote_revision: 'rev-r1' }, 'k-legacy', { silent: true },
    );
  });
});

describe('成片/重生样片：运行时提交贯通', () => {
  it('成片提交：受理回填 jobId 接管轮询至成功终态；无受理关联不落台账（历史兼容追踪）', async () => {
    const { fake, runtime, clock } = setup([{ status: 'processing', progress: 30, asset: null }, { status: 'succeeded', progress: 100, asset: { id: 'af1', url: 'http://v/f.mp4', type: 'video' } }]);
    fake.nodes.set('f1', { id: 'f1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { videoStage: 'final', genStatus: 'generating', sourceSampleJobId: '9001' } });
    const accepted: string[] = [];
    apiMocks.finalizeVideoJob.mockResolvedValueOnce({ generation_job_id: '9002', cursor: 7 });
    expect(runtime.submit(storyboardTask, {
      payload: { kind: 'finalize', sampleJobId: '9001', expectedCredits: 80, quoteRevision: 'rev-f1', onAccepted: (jobId) => { accepted.push(jobId); } },
      target: targetFacts('f1'),
    })).toBe(true);
    await flushMicrotasks();
    expect(accepted).toEqual(['9002']);
    expect(fake.data('f1').jobId).toBe('9002');
    expect(runtime.statusOf('f1')).toMatchObject({ phase: 'generating', jobId: '9002' });
    expect(clock.pendingCount()).toBe(1);
    clock.fireNext();
    await flushMicrotasks();
    expect(fake.terminalResults).toContainEqual({ nodeId: 'f1', jobId: '9002', status: 'succeeded' });
    expect(fake.data('f1')).toMatchObject({ videoStage: 'final', genStatus: undefined, src: 'http://v/f.mp4' });
    expect(runtime.bindingRevisionOf('f1')).toBe(0);
    expect(fake.data('f1').generationRecovery).toBeUndefined();
  });

  it('重生样片提交：canvas_binding 独立承接新样片卡，旧成片卡 data 原样（新旧卡分离）', async () => {
    const { fake, runtime } = setup();
    fake.nodes.set('f1', { id: 'f1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { videoStage: 'final', genStatus: 'failed', jobId: '9002', sourceSampleJobId: '9001', errorText: '上游成片失败', chargeState: 'released' } });
    fake.nodes.set('s2', { id: 's2', type: 'mediaNode', position: { x: 0, y: 400 }, data: { videoStage: 'sample', genStatus: 'generating' } });
    const oldCardPatchesBefore = fake.patches.length;
    apiMocks.regenerateSampleJob.mockResolvedValueOnce({
      generation_job_id: '9100',
      cursor: 8,
      canvas_binding: BINDING_VIEW('uuid-0001', 's2', '9100'),
    });
    expect(runtime.submit(storyboardTask, {
      payload: { kind: 'regenerate-sample', sampleJobId: '9001', expectedCredits: 40, quoteRevision: 'rev-r1' },
      target: targetFacts('s2'),
    })).toBe(true);
    await flushMicrotasks();
    expect(fake.data('s2').jobId).toBe('9100');
    expect(runtime.statusOf('s2')).toMatchObject({ phase: 'generating', jobId: '9100', submissionId: 'uuid-0001' });
    expect(fake.patches.filter((patch) => patch.nodeId === 'f1')).toHaveLength(oldCardPatchesBefore);
    expect(fake.data('f1')).toMatchObject({ videoStage: 'final', genStatus: 'failed', sourceSampleJobId: '9001', chargeState: 'released' });
  });

  it('传输结果不明后同意图重发：复用同一 submission_id（服务端重放首次结果，不双扣）', async () => {
    const { fake, runtime } = setup();
    fake.nodes.set('s2', { id: 's2', type: 'mediaNode', position: { x: 0, y: 0 }, data: { videoStage: 'sample', genStatus: 'generating' } });
    apiMocks.regenerateSampleJob
      .mockRejectedValueOnce(new ApiError(0, '网络请求失败，请检查网络后重试', 0))
      .mockResolvedValueOnce({ generation_job_id: '9100', cursor: 8, canvas_binding: BINDING_VIEW('uuid-0001', 's2', '9100') });
    const input = {
      payload: { kind: 'regenerate-sample' as const, sampleJobId: '9001', expectedCredits: 40, quoteRevision: 'rev-r1' },
      target: targetFacts('s2'),
    };
    const onPageCreateFailure = vi.fn(() => true);
    expect(runtime.submit(storyboardTask, input, { onCreateFailure: onPageCreateFailure })).toBe(true);
    await flushMicrotasks();
    expect(onPageCreateFailure).toHaveBeenCalledTimes(1);
    expect(runtime.submit(storyboardTask, input)).toBe(true);
    await flushMicrotasks();
    expect(apiMocks.regenerateSampleJob).toHaveBeenCalledTimes(2);
    const firstKey = apiMocks.regenerateSampleJob.mock.calls[0]![3];
    const secondKey = apiMocks.regenerateSampleJob.mock.calls[1]![3];
    expect(secondKey).toBe(firstKey);
    expect(fake.data('s2').jobId).toBe('9100');
  });

  it('报价变价（1056 信封错误）：页面 onCreateFailure 接管（撤卡 + 重报价），不落失败卡', async () => {
    const { fake, runtime, clock } = setup();
    fake.nodes.set('s2', { id: 's2', type: 'mediaNode', position: { x: 0, y: 0 }, data: { videoStage: 'sample', genStatus: 'generating' } });
    apiMocks.regenerateSampleJob.mockRejectedValueOnce(new ApiError(200, '价格已更新，请刷新后重新确认提交', 1056));
    const handled = vi.fn((_e: unknown) => true);
    runtime.submit(storyboardTask, {
      payload: { kind: 'regenerate-sample', sampleJobId: '9001', expectedCredits: 40, quoteRevision: 'rev-r1' },
      target: targetFacts('s2'),
    }, { onCreateFailure: handled });
    await flushMicrotasks();
    expect(handled).toHaveBeenCalledTimes(1);
    expect((handled.mock.calls[0]![0] as ApiError).code).toBe(1056);
    expect(fake.data('s2').genStatus).toBe('generating');
    expect(clock.pendingCount()).toBe(0);
  });
});

describe('成片/重生样片：断连恢复', () => {
  it('重生样片受理回执丢失（刷新后恢复扫描）：新样片任务的恢复记录按 video 由 normalGeneration 对账补卡', async () => {
    const fake = createFakeHost();
    const clock = new ManualClock();
    const page: GenerationRecoveryPage = {
      protocol_version: 1,
      canvas_version: null,
      next_cursor: null,
      records: [{
        submission_id: 'sub-regen',
        target_node_id: 's2',
        job_id: '9100',
        task_type: 'video',
        binding_revision: 1,
        is_current: true,
        job: { job_id: '9100', type: 'video', status: 'processing', progress: 20, output_asset_ids: [], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
        recovery_seed: { target: { role: 'result-placeholder', x: 5, y: 6, width: 320, height: 320, name: '样片生成中' }, sources: [] },
        previous_target_snapshot: null,
        items: [{ recovery_item_id: 'gcr:sub-regen:$target', output_key: '$target', node_id: 's2', state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null }],
      }],
    };
    fake.host.fetchRecoveryPage = (async () => JSON.parse(JSON.stringify(page))) as never;
    const runtime = createGenerationRuntime(fake.host, {
      fetchJobStatus: apiMocks.fetchJobStatus as never,
      fetchRecoveryPage: (async () => JSON.parse(JSON.stringify(page))) as never,
      setTimeout: clock.setTimeout as never,      clearTimeout: clock.clearTimeout as never,
      newId: () => 'uuid-recover',
    });
    runtime.register(normalGenerationTask);
    runtime.register(storyboardTask);
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: '9100', status: 'processing', progress: 20, asset: null });
    await runtime.recover('p1');
    expect(fake.inserts).toHaveLength(1);
    expect(fake.inserts[0]).toMatchObject({ id: 's2', type: 'mediaNode', position: { x: 5, y: 6 } });
    expect(fake.inserts[0]!.data).toMatchObject({ genStatus: 'generating', jobId: '9100', mediaType: 'video' });
    await runtime.recover('p1');
    expect(fake.inserts).toHaveLength(1);
    expect(runtime.statusOf('s2')).toMatchObject({ phase: 'generating', jobId: '9100' });
  });
});
