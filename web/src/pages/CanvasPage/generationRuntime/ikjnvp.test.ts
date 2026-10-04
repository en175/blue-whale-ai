import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audioMixCreateSchema } from '@lib/contracts/audio-mix';
import { canvasBindingSchema } from '@lib/contracts/canvas-recovery';
import { ApiError } from '@/api/http';
import { cancelGenerationJob, createAudioMix, retryAudioMix, type JobDetail } from '@/api/jobs';
import type { GenerationRecoveryRecord } from '@/api/canvasRecovery';
import { createGenerationRuntime } from './runtime';
import { audioMixTask, watchMixSubmit } from './mixMuxTasks';
import type { GenerationRuntimeHost, RuntimeNodeView } from './types';

vi.mock('@/api/jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/jobs')>(),
  createAudioMix: vi.fn(),
  retryAudioMix: vi.fn(),
  cancelGenerationJob: vi.fn(),
}));

const NODE_ID = 'audio-mix-501';
const SID_A = '12345678-0000-4000-8000-000000000001';
const SID_B = '12345678-0000-4000-8000-000000000002';
const SID_C = '12345678-0000-4000-8000-000000000003';
const TARGET_SEED = { role: 'result-placeholder' as const, x: 5, y: 6, width: 320, height: 320, name: '混合结果.mp3' };
const payload = audioMixCreateSchema.parse({
  source_node_id: 'audio-source-1',
  inputs: [{ node_id: 'audio-source-1', asset_id: '111' }, { node_id: 'audio-source-2', asset_id: '112' }],
  output_format: 'mp3',
});
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
const conflict = (revision: number) => new ApiError(409, '归属已变化', 409, {
  reason: 'canvas_binding_conflict', currentBindingRevision: revision,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function recoveryRecord(revision: number, jobId = '501'): GenerationRecoveryRecord {
  return {
    submission_id: SID_A, target_node_id: NODE_ID, job_id: jobId, task_type: 'audio_mix',
    binding_revision: revision, is_current: true,
    job: { job_id: jobId, type: 'audio_mix', status: 'failed', progress: 0, output_asset_ids: [],
      stored_error: null, created_at: '2026-10-01T00:00:00Z' },
    recovery_seed: { target: TARGET_SEED, sources: [] }, previous_target_snapshot: null,
    items: [{ recovery_item_id: `gcr:${SID_A}:$target`, output_key: '$target', node_id: NODE_ID,
      state: 'pending', revision: 1, node_binding_revision: revision, asset_id: null, slot_id: null }],
  };
}

/** 已确认接缝：公开运行时 + 实际 audioMixTask；API、时钟、画布宿主受控，不是认证 HTTP 端到端。 */
function setup(deferGenerating = false) {
  let projectId = '1';
  let epoch = {};
  let record = recoveryRecord(1);
  let nextId = SID_B;
  const nodes = new Map<string, RuntimeNodeView>();
  const owners = new Map<string, string>();
  const removed = new Set<string>();
  const host: GenerationRuntimeHost = {
    getProjectId: () => projectId, getLoadEpoch: () => epoch,
    getMediaNodes: () => [...nodes.values()], findNode: (id) => nodes.get(id) ?? null,
    patchNode: (id, patch) => {
      if (deferGenerating && patch.genStatus === 'generating') return; // 模拟 React 批量更新尚未提交的窗口
      const node = nodes.get(id); if (node) nodes.set(id, { ...node, data: { ...node.data, ...patch } });
    },
    insertMediaNode: (node) => { nodes.set(node.id, node); }, removeMediaNode: (id) => { nodes.delete(id); },
    getEdges: () => [], addEdge: () => {},
    getActiveJob: (id) => owners.get(id), setActiveJob: (id, token) => { owners.set(id, token); }, clearActiveJob: (id) => { owners.delete(id); },
    isLocallyRemoved: (id) => removed.has(id), markLocallyRemoved: (id) => { removed.add(id); },
    registerPendingDelete: () => {}, isPendingDelete: () => false,
    applyTerminal: (id, _jobId, detail) => { host.patchNode(id, { genStatus: detail.status }); return 'terminal'; },
    settleCancelled: () => {}, saveCanvas: async () => true,
    fetchRecoveryPage: async () => ({ protocol_version: 1, canvas_version: 3, records: [record], next_cursor: null }),
    toast: () => {}, openRechargeForCreditsError: () => false, addAuthResume: () => {}, rememberAsset: () => {},
  };
  const fetchJobStatus = vi.fn(async (jobId: string | number): Promise<JobDetail> => ({ job_id: String(jobId), status: 'processing', progress: 1, asset: null }));
  const runtime = createGenerationRuntime(host, { fetchJobStatus, newId: () => nextId, setTimeout: () => 1, clearTimeout: () => {} });
  runtime.register(audioMixTask);
  const load = (id = projectId, revision = 1, jobId = '501') => {
    projectId = id; epoch = {}; record = recoveryRecord(revision, jobId); runtime.reset(); owners.clear(); removed.clear();
    nodes.clear();
    nodes.set(NODE_ID, { id: NODE_ID, type: 'mediaNode', position: { x: 5, y: 6 },
      data: { jobId, mediaType: 'audio', genStatus: 'failed', fileName: '用户改名.mp3',
        generationRecovery: { protocolVersion: 1, submissionId: SID_A, outputKey: '$target' } } });
  };
  const submit = (revision = runtime.bindingRevisionOf(NODE_ID)) => runtime.submit(audioMixTask, {
    payload, target: { targetNodeId: NODE_ID, expectedBindingRevision: revision, seedTarget: TARGET_SEED, seedSources: [] },
  });
  load();
  vi.mocked(createAudioMix).mockImplementation(async (_project, body, options) => {
    const binding = audioMixCreateSchema.parse(body).canvas_binding!;
    expect(options.idempotencyKey).toBe(binding.submission_id);
    return { job_id: '504', status: 'queued', canvas_binding: {
      protocol_version: 1, submission_id: binding.submission_id, target_node_id: NODE_ID,
      binding_revision: binding.expected_binding_revision + 1, job_id: '504', is_current: true,
    } };
  });
  return { runtime, host, nodes, owners, removed, load, submit, fetchJobStatus,
    nextSubmission: () => { nextId = SID_C; } };
}

const createRequest = (index: number) => {
  const [projectId, body, options] = vi.mocked(createAudioMix).mock.calls[index]!;
  const binding = audioMixCreateSchema.parse(body).canvas_binding!;
  expect(options.idempotencyKey).toBe(binding.submission_id);
  return { projectId, ...binding };
};

beforeEach(() => { vi.resetAllMocks(); });

describe('迟到创建与重试响应的承接保护（IKJNVP）', () => {
  it.each([
    { name: '同项目重载', project: '1', fresh: 4, late: 3, jobId: '501' },
    { name: '跨项目切换', project: '2', fresh: 2, late: 9, jobId: '503' },
  ])('$name 后，旧创建 409 不影响下一次真实请求的项目和版本', async ({ project, fresh, late, jobId }) => {
    const ctx = setup();
    await ctx.runtime.recover('1');
    const oldCreate = deferred<Awaited<ReturnType<typeof createAudioMix>>>();
    vi.mocked(createAudioMix).mockImplementationOnce(() => oldCreate.promise);
    expect(ctx.submit()).toBe(true);
    await flush();
    ctx.load(project, fresh, jobId);
    await ctx.runtime.recover(project);
    const card = structuredClone(ctx.nodes.get(NODE_ID));
    oldCreate.reject(conflict(late));
    await flush();
    const afterLate = ctx.runtime.bindingRevisionOf(NODE_ID);
    expect(ctx.nodes.get(NODE_ID)).toEqual(card);
    ctx.nextSubmission();
    expect(ctx.submit()).toBe(true);
    await flush();
    expect(createRequest(1)).toMatchObject({ projectId: project, submission_id: SID_C, expected_binding_revision: fresh });
    expect(afterLate).toBe(fresh);
  });

  it('当前执行的合法 409 反馈可信版本，用户复核后使用新意图发送', async () => {
    const ctx = setup();
    await ctx.runtime.recover('1');
    vi.mocked(createAudioMix).mockRejectedValueOnce(conflict(3));
    expect(ctx.submit()).toBe(true);
    await flush();
    expect(ctx.runtime.statusOf(NODE_ID)).toBeNull();
    expect(ctx.runtime.bindingRevisionOf(NODE_ID)).toBe(3);
    expect(ctx.nodes.get(NODE_ID)?.data).toMatchObject({ genStatus: 'failed', errorText: '卡片归属已变化，请复核后再发送' });
    expect(vi.mocked(createAudioMix).mock.calls).toHaveLength(1); // 未经用户复核不自动重发
    expect(createRequest(0)).toMatchObject({ projectId: '1', submission_id: SID_B, expected_binding_revision: 1 });
    ctx.nextSubmission();
    expect(ctx.submit()).toBe(true);
    await flush();
    expect(createRequest(1)).toMatchObject({ projectId: '1', submission_id: SID_C, expected_binding_revision: 3 });
  });

  it('创建使用旧目标快照时，409 不回退已经确认的较新版本', async () => {
    const ctx = setup();
    ctx.load('1', 4);
    await ctx.runtime.recover('1');
    vi.mocked(createAudioMix).mockRejectedValueOnce(conflict(3));
    expect(ctx.submit(1)).toBe(true);
    await flush();
    const afterConflict = ctx.runtime.bindingRevisionOf(NODE_ID);
    ctx.nextSubmission();
    expect(ctx.submit()).toBe(true);
    await flush();
    expect(createRequest(1)).toMatchObject({ projectId: '1', submission_id: SID_C, expected_binding_revision: 4 });
    expect(afterConflict).toBe(4);
  });

  it.each(['受理', '失败'] as const)('旧重试%s迟到时，不释放新加载重试的防重资源', async (outcome) => {
    const ctx = setup(true);
    await ctx.runtime.recover('1');
    const oldRetry = deferred<Awaited<ReturnType<typeof retryAudioMix>>>();
    const newRetry = deferred<Awaited<ReturnType<typeof retryAudioMix>>>();
    vi.mocked(retryAudioMix).mockImplementationOnce(() => oldRetry.promise).mockImplementation(() => newRetry.promise);
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    ctx.load('2', 2, '503');
    await ctx.runtime.recover('2');
    ctx.nextSubmission();
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    const card = structuredClone(ctx.nodes.get(NODE_ID));
    const owner = ctx.owners.get(NODE_ID);
    if (outcome === '受理') oldRetry.resolve({ job_id: '501', status: 'queued', replayed: false, canvas_binding: {
      protocol_version: 1, submission_id: SID_B, target_node_id: NODE_ID, binding_revision: 9, job_id: '501', is_current: true,
    } });
    else oldRetry.reject(conflict(9));
    await flush();
    expect(ctx.nodes.get(NODE_ID)).toEqual(card);
    expect(ctx.owners.get(NODE_ID)).toBe(owner);
    expect(ctx.runtime.bindingRevisionOf(NODE_ID)).toBe(2);
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    expect(vi.mocked(retryAudioMix).mock.calls).toHaveLength(2); // 旧返回不能使同一新重试窗口重复发任务
    const [projectId, jobId, key, , binding] = vi.mocked(retryAudioMix).mock.calls[1]!;
    expect({ projectId, jobId, key, binding: canvasBindingSchema.parse(binding) }).toMatchObject({
      projectId: '2', jobId: '503', key: SID_C, binding: { submission_id: SID_C, expected_binding_revision: 2 },
    });
    newRetry.resolve({ job_id: '503', status: 'queued', replayed: false, canvas_binding: {
      protocol_version: 1, submission_id: SID_C, target_node_id: NODE_ID, binding_revision: 3, job_id: '503', is_current: true,
    } });
    await flush();
    expect(ctx.runtime.statusOf(NODE_ID)).toMatchObject({ phase: 'generating', jobId: '503', submissionId: SID_C });
  });

  it.each(['项目切换', '加载身份更替', '单独 reset', '删除', '新执行接管', '新执行终态'] as const)(
    '%s 后，旧创建失败不改版本、卡片或新执行资源', async (window) => {
      const ctx = setup();
      await ctx.runtime.recover('1');
      const oldCreate = deferred<Awaited<ReturnType<typeof createAudioMix>>>();
      vi.mocked(createAudioMix).mockImplementationOnce(() => oldCreate.promise);
      expect(ctx.submit()).toBe(true);
      await flush();
      if (window === '项目切换') ctx.host.getProjectId = () => '2';
      if (window === '加载身份更替') { const nextEpoch = {}; ctx.host.getLoadEpoch = () => nextEpoch; }
      if (window === '单独 reset') ctx.runtime.reset();
      if (window === '删除') {
        vi.mocked(cancelGenerationJob).mockResolvedValueOnce(null);
        ctx.fetchJobStatus.mockResolvedValueOnce({ job_id: '501', status: 'failed', progress: 0, asset: null });
        expect(ctx.runtime.remove(NODE_ID)).toBe(true);
        await flush();
        expect(ctx.nodes.has(NODE_ID)).toBe(false);
      }
      if (window === '新执行接管' || window === '新执行终态') {
        ctx.host.patchNode(NODE_ID, { jobId: '503', genStatus: 'generating',
          generationRecovery: { protocolVersion: 1, submissionId: SID_C, outputKey: '$target' } });
        if (window === '新执行终态') ctx.fetchJobStatus.mockResolvedValueOnce({ job_id: '503', status: 'failed', progress: 0, asset: null });
        ctx.runtime.resumeFromHydration(NODE_ID, '503');
        await flush();
      }
      const card = structuredClone(ctx.nodes.get(NODE_ID));
      const owner = ctx.owners.get(NODE_ID);
      const state = ctx.runtime.statusOf(NODE_ID);
      const revision = ctx.runtime.bindingRevisionOf(NODE_ID);
      oldCreate.reject(conflict(9));
      await flush();
      expect({ card: ctx.nodes.get(NODE_ID), owner: ctx.owners.get(NODE_ID),
        state: ctx.runtime.statusOf(NODE_ID), revision: ctx.runtime.bindingRevisionOf(NODE_ID) }).toEqual({ card, owner, state, revision });
      expect(vi.mocked(createAudioMix).mock.calls).toHaveLength(1);
    },
  );

  it.each(['受理', '失败'] as const)('旧混合创建%s迟到，不消费替代执行的提交通知', async (outcome) => {
    const ctx = setup();
    await ctx.runtime.recover('1');
    const oldCreate = deferred<Awaited<ReturnType<typeof createAudioMix>>>();
    const newCreate = deferred<Awaited<ReturnType<typeof createAudioMix>>>();
    vi.mocked(createAudioMix).mockImplementationOnce(() => oldCreate.promise).mockImplementationOnce(() => newCreate.promise);
    const oldWatcher = { accepted: vi.fn(), failed: vi.fn() };
    const newWatcher = { accepted: vi.fn(), failed: vi.fn() };
    const stopOld = watchMixSubmit(NODE_ID, oldWatcher);
    const stopNew = () => {};
    let disposeNew = stopNew;
    try {
      expect(ctx.submit()).toBe(true);
      ctx.load('2', 2, '503');
      await ctx.runtime.recover('2');
      ctx.nextSubmission();
      disposeNew = watchMixSubmit(NODE_ID, newWatcher);
      expect(ctx.submit()).toBe(true);
      if (outcome === '受理') oldCreate.resolve({ job_id: '502', status: 'queued', canvas_binding: {
        protocol_version: 1, submission_id: SID_B, target_node_id: NODE_ID, binding_revision: 9, job_id: '502', is_current: true,
      } });
      else oldCreate.reject(conflict(9));
      await flush();
      expect(newWatcher.accepted).not.toHaveBeenCalled();
      expect(newWatcher.failed).not.toHaveBeenCalled();
      expect(oldWatcher.accepted).not.toHaveBeenCalled();
      expect(oldWatcher.failed).not.toHaveBeenCalled();
      expect(createRequest(1)).toMatchObject({ projectId: '2', submission_id: SID_C, expected_binding_revision: 2 });
      if (outcome === '受理') {
        newCreate.resolve({ job_id: '503', status: 'queued', canvas_binding: {
          protocol_version: 1, submission_id: SID_C, target_node_id: NODE_ID, binding_revision: 3, job_id: '503', is_current: true,
        } });
        await flush();
        expect(newWatcher.accepted).toHaveBeenCalledWith('503');
        expect(newWatcher.failed).not.toHaveBeenCalled();
      } else {
        const error = conflict(3);
        newCreate.reject(error);
        await flush();
        expect(newWatcher.failed).toHaveBeenCalledWith(error);
        expect(newWatcher.accepted).not.toHaveBeenCalled();
      }
    } finally {
      stopOld(); disposeNew();
    }
  });
});
