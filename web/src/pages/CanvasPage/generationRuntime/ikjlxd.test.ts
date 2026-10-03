import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audioMixCreateSchema } from '@lib/contracts/audio-mix';
import { canvasBindingSchema } from '@lib/contracts/canvas-recovery';
import { createAudioMix, retryAudioMix, type JobDetail } from '@/api/jobs';
import type { GenerationRecoveryRecord } from '@/api/canvasRecovery';
import { createGenerationRuntime, type GenerationRuntimeDeps } from './runtime';
import { audioMixTask } from './mixMuxTasks';
import type { GenerationRuntimeHost, RuntimeNodeView } from './types';

vi.mock('@/api/jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/jobs')>(),
  createAudioMix: vi.fn(),
  retryAudioMix: vi.fn(),
}));

const NODE_ID = 'audio-mix-501';
const SID_A = '12345678-0000-4000-8000-000000000001';
const SID_B = '12345678-0000-4000-8000-000000000002';
const SID_C = '12345678-0000-4000-8000-000000000003';
const TARGET_SEED = { role: 'result-placeholder' as const, x: 5, y: 6, width: 320, height: 320, name: '混合结果.mp3' };

const bindingView = (submissionId: string, jobId: string, revision: number) => ({
  protocol_version: 1 as const, submission_id: submissionId, target_node_id: NODE_ID,
  binding_revision: revision, job_id: jobId, is_current: true,
});

const oldRecord = (): GenerationRecoveryRecord => ({
  submission_id: SID_A, target_node_id: NODE_ID, job_id: '501', task_type: 'audio_mix',
  binding_revision: 1, is_current: true,
  job: { job_id: '501', type: 'audio_mix', status: 'failed', progress: 0, output_asset_ids: [], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
  recovery_seed: { target: TARGET_SEED, sources: [] }, previous_target_snapshot: null,
  items: [{ recovery_item_id: `gcr:${SID_A}:$target`, output_key: '$target', node_id: NODE_ID,
    state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null }],
});

const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };

/** 接缝已由父规格确认：公开运行时、实际任务定义，API 与画布宿主受控。 */
function setup(status: JobDetail['status'] = 'processing', record = oldRecord()) {
  const nodes = new Map<string, RuntimeNodeView>([[NODE_ID, {
    id: NODE_ID, type: 'mediaNode', position: { x: 5, y: 6 },
    data: { jobId: '501', genStatus: 'failed', fileName: '用户改名.mp3',
      generationRecovery: { protocolVersion: 1, submissionId: SID_A, outputKey: '$target' } },
  }]]);
  const owners = new Map<string, string>();
  const removed = new Set<string>();
  let projectId = '1';
  let epoch = {};
  const save = vi.fn(async () => true);
  const host: GenerationRuntimeHost = {
    getProjectId: () => projectId, getLoadEpoch: () => epoch,
    getMediaNodes: () => [...nodes.values()], findNode: (id) => nodes.get(id) ?? null,
    patchNode: (id, patch) => { const node = nodes.get(id); if (node) nodes.set(id, { ...node, data: { ...node.data, ...patch } }); },
    insertMediaNode: (node) => { nodes.set(node.id, node); }, removeMediaNode: (id) => { nodes.delete(id); },
    getEdges: () => [], addEdge: () => {},
    getActiveJob: (id) => owners.get(id), setActiveJob: (id, token) => { owners.set(id, token); }, clearActiveJob: (id) => { owners.delete(id); },
    isLocallyRemoved: (id) => removed.has(id), markLocallyRemoved: (id) => { removed.add(id); },
    registerPendingDelete: () => {}, isPendingDelete: () => false,
    applyTerminal: (id, _jobId, detail) => {
      if (detail.status === 'failed') host.patchNode(id, { genStatus: 'failed' });
      return 'terminal';
    },
    settleCancelled: () => {}, saveCanvas: save,
    fetchRecoveryPage: async () => ({ protocol_version: 1, canvas_version: 3, records: [record], next_cursor: null }),
    toast: () => {}, openRechargeForCreditsError: () => false, addAuthResume: () => {}, rememberAsset: () => {},
  };
  let release!: (records: GenerationRecoveryRecord[]) => void;
  const resolveItems = vi.fn<NonNullable<GenerationRuntimeDeps['resolveItems']>>(
    () => new Promise((resolve) => { release = (records) => resolve({ protocol_version: 1, records }); }),
  );
  const fetchJobStatus = vi.fn(async (): Promise<JobDetail> => ({ job_id: '501', status, progress: 1, asset: null }));
  let nextId = SID_B;
  const runtime = createGenerationRuntime(host, {
    fetchJobStatus, resolveItems, setTimeout: () => 1, clearTimeout: () => {}, newId: () => nextId,
  });
  runtime.register(audioMixTask);
  vi.mocked(retryAudioMix).mockImplementation(async (_project, jobId, key, _options, binding) => {
    const parsed = canvasBindingSchema.parse(binding);
    expect(key).toBe(parsed.submission_id);
    return { job_id: String(jobId), status: 'queued', replayed: false, canvas_binding: bindingView(parsed.submission_id, String(jobId), 2) };
  });
  vi.mocked(createAudioMix).mockImplementation(async (_project, body, options) => {
    const parsed = audioMixCreateSchema.parse(body);
    expect(options.idempotencyKey).toBe(parsed.canvas_binding?.submission_id);
    return { job_id: '502', status: 'queued', canvas_binding: bindingView(parsed.canvas_binding!.submission_id, '502', 3) };
  });
  return { runtime, host, nodes, owners, removed, save, fetchJobStatus, resolveItems,
    release: (records: GenerationRecoveryRecord[]) => release(records),
    nextSubmission: () => { nextId = SID_C; },
    reload: (id = projectId) => { projectId = id; epoch = {}; nodes.clear(); runtime.reset(); },
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('同 jobId 重试后的提交承接保护（IKJLXD）', () => {
  it.each(['processing', 'failed'] as const)('B 为 %s 时，旧 A 对账不回退承接版本，下一次提交携带版本 2', async (status) => {
    const ctx = setup(status);
    await ctx.runtime.recover('1');
    const reconcile = ctx.runtime.reconcileConflictItems('1');
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    expect(canvasBindingSchema.parse(vi.mocked(retryAudioMix).mock.calls[0]![4])).toMatchObject({
      submission_id: SID_B, expected_binding_revision: 1,
    });
    if (status === 'processing') expect(ctx.runtime.statusOf(NODE_ID)).toMatchObject({ jobId: '501', submissionId: SID_B });
    else expect(ctx.runtime.statusOf(NODE_ID)).toBeNull();
    expect(ctx.runtime.bindingRevisionOf(NODE_ID)).toBe(2);
    const card = structuredClone(ctx.nodes.get(NODE_ID));
    const owner = ctx.owners.get(NODE_ID);
    ctx.release([oldRecord()]);
    await reconcile;
    expect(ctx.nodes.get(NODE_ID)).toEqual(card);
    expect(ctx.owners.get(NODE_ID)).toBe(owner);
    if (status === 'processing') expect(ctx.runtime.statusOf(NODE_ID)).toMatchObject({ jobId: '501', submissionId: SID_B });
    else expect(ctx.runtime.statusOf(NODE_ID)).toBeNull();
    expect(ctx.runtime.bindingRevisionOf(NODE_ID)).toBe(2);
    ctx.nextSubmission();
    const payload = audioMixCreateSchema.parse({ source_node_id: 'audio-source-1',
      inputs: [{ node_id: 'audio-source-1', asset_id: '111' }, { node_id: 'audio-source-2', asset_id: '112' }], output_format: 'mp3' });
    expect(ctx.runtime.submit(audioMixTask, { payload, target: { targetNodeId: NODE_ID,
      expectedBindingRevision: ctx.runtime.bindingRevisionOf(NODE_ID), seedTarget: TARGET_SEED, seedSources: [] } })).toBe(true);
    await flush();
    expect(audioMixCreateSchema.parse(vi.mocked(createAudioMix).mock.calls[0]![1]).canvas_binding).toMatchObject({
      submission_id: SID_C, expected_binding_revision: 2,
    });
  });

  it('B 等待受理时，旧 A 的恢复扫描不能重新登记 A 或续接轮询', async () => {
    const ctx = setup();
    await ctx.runtime.recover('1');
    const record = oldRecord();
    record.job!.status = 'processing';
    let releasePage!: () => void;
    ctx.host.fetchRecoveryPage = () => new Promise((resolve) => {
      releasePage = () => resolve({ protocol_version: 1, canvas_version: 3, records: [record], next_cursor: null });
    });
    const recovering = ctx.runtime.recover('1');
    vi.mocked(retryAudioMix).mockImplementation(() => new Promise(() => {}));
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    const owner = ctx.owners.get(NODE_ID);
    releasePage();
    await recovering;
    expect(ctx.runtime.statusOf(NODE_ID)).toEqual({ phase: 'submitting', jobId: undefined, submissionId: undefined });
    expect(ctx.owners.get(NODE_ID)).toBe(owner);
    expect(ctx.fetchJobStatus).not.toHaveBeenCalled();
  });

  it('B 已终态后，旧 A 的 processing 响应不续接旧轮询或重建承接', async () => {
    const ctx = setup('failed');
    await ctx.runtime.recover('1');
    const reconcile = ctx.runtime.reconcileConflictItems('1');
    ctx.runtime.retry(NODE_ID);
    await flush();
    ctx.fetchJobStatus.mockClear();
    const card = structuredClone(ctx.nodes.get(NODE_ID));
    const record = oldRecord();
    record.job!.status = 'processing';
    ctx.release([record]);
    await reconcile;
    expect(ctx.runtime.statusOf(NODE_ID)).toBeNull();
    expect(ctx.owners.get(NODE_ID)).toBeUndefined();
    expect(ctx.runtime.bindingRevisionOf(NODE_ID)).toBe(2);
    expect(ctx.nodes.get(NODE_ID)).toEqual(card);
    expect(ctx.fetchJobStatus).not.toHaveBeenCalled();
  });

  it('旧提交独立拥有的结果仍能对账，保留编辑并用最新项版本显式恢复', async () => {
    const record = oldRecord();
    record.is_current = false;
    record.items[0]!.state = 'replaced';
    const outputId = 'audio-mix-old-output';
    record.items.push({ recovery_item_id: `gcr:${SID_A}:primary`, output_key: 'primary', node_id: outputId,
      state: 'present', revision: 1, node_binding_revision: 1, asset_id: '111', slot_id: null });
    const ctx = setup('failed', record);
    ctx.nodes.set(outputId, { id: outputId, type: 'mediaNode', position: { x: 700, y: 800 },
      data: { jobId: '501', src: 'https://audio.test/old.mp3', assetId: '111', fileName: '用户的旧作品.mp3',
        generationRecovery: { protocolVersion: 1, submissionId: SID_A, outputKey: 'primary' } } });
    await ctx.runtime.recover('1');
    const reconcile = ctx.runtime.reconcileConflictItems('1');
    ctx.runtime.retry(NODE_ID);
    await flush();
    const card = structuredClone(ctx.nodes.get(outputId));
    const updated = structuredClone(record);
    updated.items[1]!.state = 'removed';
    updated.items[1]!.revision = 5;
    ctx.release([updated]);
    await reconcile;
    expect(ctx.nodes.get(outputId)).toEqual(card);
    expect(ctx.runtime.bindingRevisionOf(NODE_ID)).toBe(2);
    expect(ctx.runtime.composeSaveFields()?.recoveryChanges).toContainEqual({
      recoveryItemId: `gcr:${SID_A}:primary`, expectedRevision: 5, action: 'restore',
    });
  });
});
