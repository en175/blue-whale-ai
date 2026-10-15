import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { createAudioMix, retryAudioMix, type JobDetail } from '@/custom/api/jobs';
import { serializeNodes, serializeEdges } from '@/custom/api/canvas';
import type { CanvasBinding, GenerationRecoveryRecord } from '@/custom/api/canvasRecovery';
import { audioMixCreateSchema } from '@lib/contracts/audio-mix';
import { canvasBindingSchema } from '@lib/contracts/canvas-recovery';
import { audioMixTerminalPatch, AUDIO_MIX_EDGE_ORIGIN } from '../audioMix';
import { audioMixTask } from './mixMuxTasks';
import { deferred, flush, setupAudioMixRecovery } from './audioMixRecoveryTestKit';

vi.mock('@/custom/api/jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/custom/api/jobs')>(),
  createAudioMix: vi.fn(),
  retryAudioMix: vi.fn(),
  cancelGenerationJob: vi.fn(),
}));

const processing: JobDetail = { job_id: '501', status: 'processing', progress: 40, asset: null };
const succeeded: JobDetail = {
  job_id: '501', status: 'succeeded', progress: 100,
  asset: { id: '90', type: 'audio', url: 'https://assets/mix-b.mp3', duration: 8 },
};

function recordOf(binding: CanvasBinding, revision = 2): GenerationRecoveryRecord {
  return {
    submission_id: binding.submission_id, target_node_id: binding.target_node_id,
    job_id: '501', task_type: 'audio_mix', binding_revision: revision, is_current: true,
    job: {
      job_id: '501', type: 'audio_mix', status: 'processing', progress: 40,
      output_asset_ids: [], stored_error: null, created_at: '2026-10-06T00:00:00Z',
    },
    recovery_seed: binding.recovery_seed, previous_target_snapshot: null,
    items: [{
      recovery_item_id: `gcr:${binding.submission_id}:$target`, output_key: '$target',
      node_id: binding.target_node_id, state: 'pending', revision: 1,
      node_binding_revision: revision, asset_id: null, slot_id: null,
    }],
  };
}

async function acceptedRetryBeforeReload(withOldMarker: boolean) {
  const ctx = setupAudioMixRecovery({
    reuseUnacceptedCard: true, edgeOrigin: AUDIO_MIX_EDGE_ORIGIN,
    rollbackOnFailure: true, terminalPatch: audioMixTerminalPatch,
  });
  ctx.fetchJobStatus.mockResolvedValue({
    job_id: '501', status: 'failed', progress: 0, asset: null,
    error: { code: 1046, msg: '原任务失败' },
  });
  vi.mocked(createAudioMix).mockImplementationOnce(async (_project, body) => {
    const binding = audioMixCreateSchema.parse(body).canvas_binding!;
    return ctx.mixCreated('501', ctx.bindingView(binding.submission_id, binding.target_node_id, '501', 1));
  });
  ctx.openWithInput();
  expect(ctx.mix.send()).toBe(true);
  await flush();
  const first = ctx.createRequest(0);
  const nodeId = first.binding.target_node_id;
  expect(ctx.nodes.get(nodeId)?.data.genStatus).toBe('failed');
  const original = ctx.nodes.get(nodeId)!;
  ctx.nodes.set(nodeId, {
    ...original, position: { x: 321, y: 654 },
    data: {
      ...original.data, fileName: '我的混音.mp3', width: 520, height: 300,
      ...(withOldMarker ? { generationRecovery: {
        protocolVersion: 1, submissionId: first.binding.submission_id, outputKey: '$target',
      } } : {}),
    },
  });
  const persisted = {
    nodes: serializeNodes([...ctx.nodes.values()]),
    edges: serializeEdges(ctx.edges() as Edge[]),
  };
  const retryReceipt = deferred<Awaited<ReturnType<typeof retryAudioMix>>>();
  vi.mocked(retryAudioMix).mockImplementationOnce(() => retryReceipt.promise);
  expect(ctx.runtime.retry(nodeId)).toBe(true);
  await flush();
  const [projectId, jobId, key, , rawBinding] = vi.mocked(retryAudioMix).mock.calls[0]!;
  const binding = canvasBindingSchema.parse(rawBinding);
  expect({ projectId, jobId, key }).toEqual({ projectId: 'p1', jobId: '501', key: binding.submission_id });
  expect(binding.submission_id).not.toBe(first.binding.submission_id);
  expect(binding.expected_binding_revision).toBe(1);
  const record = recordOf(binding);
  ctx.reload();
  ctx.dropFromHydration(nodeId);
  ctx.nodes.clear();
  for (const node of JSON.parse(persisted.nodes) as Node[]) ctx.nodes.set(node.id, node);
  for (const edge of JSON.parse(persisted.edges) as Edge[]) {
    ctx.host.addEdge(edge.source, edge.target, undefined,
      typeof edge.data?.origin === 'string' ? { origin: edge.data.origin } : undefined);
  }
  expect(serializeEdges(ctx.edges() as Edge[])).toBe(persisted.edges);
  ctx.fetchJobStatus.mockResolvedValue(processing);
  ctx.recoveryRecords.push(record);
  return { ...ctx, first, binding, record, nodeId, retryReceipt, persisted };
}

beforeEach(() => { vi.resetAllMocks(); });

describe('可靠当前恢复提交归属（IKJQ03）', () => {
  it.each([
    { withOldMarker: true, complete: false, name: '旧 A 标记，恢复进行中' },
    { withOldMarker: false, complete: false, name: '无旧标记，恢复进行中对照' },
    { withOldMarker: true, complete: true, name: '旧 A 标记，恢复后成功' },
    { withOldMarker: false, complete: true, name: '无旧标记，恢复后成功对照' },
  ])('$name', async ({ withOldMarker, complete }) => {
    const ctx = await acceptedRetryBeforeReload(withOldMarker);
    await ctx.runtime.recover('p1');
    await flush();
    expect.soft(ctx.runtime.statusOf(ctx.nodeId)).toMatchObject({
      jobId: '501', phase: 'generating', submissionId: ctx.binding.submission_id,
    });
    expect(ctx.nodes.get(ctx.nodeId)).toMatchObject({
      position: { x: 321, y: 654 }, data: { fileName: '我的混音.mp3', width: 520, height: 300 },
    });
    expect(serializeEdges(ctx.edges() as Edge[])).toBe(ctx.persisted.edges);
    if (complete) {
      ctx.fetchJobStatus.mockResolvedValue(succeeded);
      ctx.advancePolling();
      await flush();
      expect(ctx.runtime.statusOf(ctx.nodeId)).toBeNull();
      expect.soft(ctx.nodes.get(ctx.nodeId)?.data).toMatchObject({
        src: 'https://assets/mix-b.mp3', assetId: '90', mediaType: 'audio', progress: 100,
        generationRecovery: { protocolVersion: 1, submissionId: ctx.binding.submission_id, outputKey: 'primary' },
      });
      expect(ctx.runtime.composeSaveFields()?.recoveryChanges).toEqual([
        { recoveryItemId: `gcr:${ctx.binding.submission_id}:$target`, expectedRevision: 1, action: 'replaceTarget' },
        { recoveryItemId: `gcr:${ctx.binding.submission_id}:primary`, expectedRevision: 0, action: 'apply' },
      ]);
      expect(JSON.parse(serializeNodes([...ctx.nodes.values()])).find((node: Node) => node.id === ctx.nodeId).data.generationRecovery)
        .toEqual({ protocolVersion: 1, submissionId: ctx.binding.submission_id, outputKey: 'primary' });
    }
  });

  it('水合已接续旧 A 后，可靠 B 扫描接管同 jobId，迟到旧轮询不改新执行与原子保存', async () => {
    const ctx = await acceptedRetryBeforeReload(true);
    const hydrationReply = deferred<JobDetail>();
    ctx.fetchJobStatus.mockImplementationOnce(() => hydrationReply.promise);
    ctx.runtime.resumeFromHydration(ctx.nodeId, '501', ctx.nodes.get(ctx.nodeId)!.data);
    expect(ctx.runtime.statusOf(ctx.nodeId)?.submissionId).toBe(ctx.first.binding.submission_id);
    await ctx.runtime.recover('p1');
    await flush();
    expect(ctx.runtime.statusOf(ctx.nodeId)?.submissionId).toBe(ctx.binding.submission_id);
    hydrationReply.resolve({ ...processing, progress: 1 });
    await flush();
    expect(ctx.nodes.get(ctx.nodeId)?.data.progress).toBe(40);
    await ctx.runtime.recover('p1');
    ctx.fetchJobStatus.mockResolvedValue(succeeded);
    ctx.advancePolling();
    await flush();
    expect(ctx.nodes.get(ctx.nodeId)?.data).toMatchObject({
      generationRecovery: { protocolVersion: 1, submissionId: ctx.binding.submission_id, outputKey: 'primary' },
      src: 'https://assets/mix-b.mp3',
    });
    expect(ctx.runtime.composeSaveFields()?.recoveryChanges).toEqual([
      { recoveryItemId: `gcr:${ctx.binding.submission_id}:$target`, expectedRevision: 1, action: 'replaceTarget' },
      { recoveryItemId: `gcr:${ctx.binding.submission_id}:primary`, expectedRevision: 0, action: 'apply' },
    ]);
    ctx.retryReceipt.resolve({
      job_id: '501', status: 'queued', replayed: false,
      canvas_binding: ctx.bindingView(ctx.binding.submission_id, ctx.nodeId, '501', 2),
    });
    await flush();
    expect(ctx.runtime.statusOf(ctx.nodeId)).toBeNull();
    expect(ctx.nodes.get(ctx.nodeId)?.data.generationRecovery).toEqual({
      protocolVersion: 1, submissionId: ctx.binding.submission_id, outputKey: 'primary',
    });
  });

  it('水合旧 A 已在途时，可靠 B 的成功输出按 B 原子确认，旧响应不覆盖成品', async () => {
    const ctx = await acceptedRetryBeforeReload(true);
    const hydrationReply = deferred<JobDetail>();
    ctx.fetchJobStatus.mockImplementationOnce(() => hydrationReply.promise).mockResolvedValue(succeeded);
    ctx.runtime.resumeFromHydration(ctx.nodeId, '501', ctx.nodes.get(ctx.nodeId)!.data);
    ctx.record.job!.status = 'succeeded';
    ctx.record.job!.progress = 100;
    ctx.record.job!.output_asset_ids = ['90'];
    ctx.record.items.push({
      recovery_item_id: `gcr:${ctx.binding.submission_id}:primary`, output_key: 'primary', node_id: ctx.nodeId,
      state: 'pending', revision: 1, node_binding_revision: 2, asset_id: '90', slot_id: null,
    });
    await ctx.runtime.recover('p1');
    await flush();
    expect(ctx.nodes.get(ctx.nodeId)?.data).toMatchObject({
      generationRecovery: { protocolVersion: 1, submissionId: ctx.binding.submission_id, outputKey: 'primary' },
      src: 'https://assets/mix-b.mp3', assetId: '90',
    });
    expect(ctx.runtime.composeSaveFields()?.recoveryChanges).toEqual([
      { recoveryItemId: `gcr:${ctx.binding.submission_id}:$target`, expectedRevision: 1, action: 'replaceTarget' },
      { recoveryItemId: `gcr:${ctx.binding.submission_id}:primary`, expectedRevision: 1, action: 'apply' },
    ]);
    hydrationReply.resolve({ ...processing, progress: 1 });
    await flush();
    expect(ctx.nodes.get(ctx.nodeId)?.data).toMatchObject({ src: 'https://assets/mix-b.mp3', progress: 100 });
    expect(serializeEdges(ctx.edges() as Edge[])).toBe(ctx.persisted.edges);
  });

  it.each(['retry', 'create'] as const)('本地新 %s 意图 C 接管后，旧 B 扫描与水合不得夺回；C 失败也不恢复旧链', async (action) => {
    const ctx = await acceptedRetryBeforeReload(true);
    await ctx.runtime.recover('p1');
    await flush();
    ctx.fetchJobStatus.mockResolvedValue({ ...processing, status: 'failed', error: { code: 1046, msg: 'B 失败' } });
    ctx.advancePolling();
    await flush();
    expect(ctx.runtime.statusOf(ctx.nodeId)).toBeNull();
    ctx.fetchJobStatus.mockImplementation(async (jobId) => ({ ...processing, job_id: String(jobId) }));
    let current: CanvasBinding;
    if (action === 'retry') {
      vi.mocked(retryAudioMix).mockImplementationOnce(async (_project, jobId, _key, _options, binding) => {
        current = canvasBindingSchema.parse(binding);
        return { job_id: String(jobId), status: 'queued', replayed: false,
          canvas_binding: ctx.bindingView(current.submission_id, ctx.nodeId, String(jobId), 3) };
      });
      expect(ctx.runtime.retry(ctx.nodeId)).toBe(true);
    } else {
      vi.mocked(createAudioMix).mockImplementationOnce(async (_project, body) => {
        current = audioMixCreateSchema.parse(body).canvas_binding!;
        return ctx.mixCreated('502', ctx.bindingView(current.submission_id, ctx.nodeId, '502', 3));
      });
      expect(ctx.runtime.submit(audioMixTask, {
        payload: { ...ctx.first.payload, output_format: 'wav' },
        target: {
          targetNodeId: ctx.nodeId, seedTarget: ctx.binding.recovery_seed.target,
          seedSources: ctx.binding.recovery_seed.sources, expectedBindingRevision: 2,
        },
      })).toBe(true);
    }
    await flush();
    expect(current!.submission_id).not.toBe(ctx.binding.submission_id);
    expect(current!.expected_binding_revision).toBe(2);
    const currentState = ctx.runtime.statusOf(ctx.nodeId);
    const currentRound = ctx.host.getActiveJob(ctx.nodeId);
    expect(currentState).toMatchObject({ submissionId: current!.submission_id, jobId: action === 'retry' ? '501' : '502' });
    await ctx.runtime.recover('p1');
    ctx.runtime.resumeFromHydration(ctx.nodeId, '501', ctx.nodes.get(ctx.nodeId)!.data);
    await flush();
    expect(ctx.runtime.statusOf(ctx.nodeId)).toEqual(currentState);
    expect(ctx.host.getActiveJob(ctx.nodeId)).toBe(currentRound);
    ctx.fetchJobStatus.mockResolvedValue({
      ...processing, job_id: action === 'retry' ? '501' : '502', status: 'failed', error: { code: 1046, msg: 'C 失败' },
    });
    ctx.advancePolling();
    await flush();
    await ctx.runtime.recover('p1');
    expect(ctx.runtime.statusOf(ctx.nodeId)).toBeNull();
    expect(ctx.nodes.get(ctx.nodeId)?.data).toMatchObject({ genStatus: 'failed', errorText: 'C 失败', fileName: '我的混音.mp3' });
    expect(ctx.runtime.bindingRevisionOf(ctx.nodeId)).toBe(3);
    expect(serializeEdges(ctx.edges() as Edge[])).toBe(ctx.persisted.edges);
  });

  it('非当前记录只对账，不覆盖历史标记或乐观水合身份', async () => {
    const ctx = await acceptedRetryBeforeReload(true);
    ctx.runtime.resumeFromHydration(ctx.nodeId, '501', ctx.nodes.get(ctx.nodeId)!.data);
    await flush();
    ctx.record.is_current = false;
    const current = ctx.runtime.statusOf(ctx.nodeId);
    const card = serializeNodes([...ctx.nodes.values()]);
    await ctx.runtime.recover('p1');
    expect(ctx.runtime.statusOf(ctx.nodeId)).toEqual(current);
    expect(serializeNodes([...ctx.nodes.values()])).toBe(card);
    expect(ctx.nodes.get(ctx.nodeId)?.data.generationRecovery).toMatchObject({ submissionId: ctx.first.binding.submission_id });
  });

  it('已知归属版本较新时，旧 A 页不恢复旧执行或回退绑定版本', async () => {
    const ctx = await acceptedRetryBeforeReload(true);
    await ctx.runtime.recover('p1');
    await flush();
    ctx.fetchJobStatus.mockResolvedValue({ ...processing, status: 'failed', error: { code: 1046, msg: 'B 失败' } });
    ctx.advancePolling();
    await flush();
    expect(ctx.runtime.bindingRevisionOf(ctx.nodeId)).toBe(2);
    ctx.recoveryRecords.splice(0, 1, recordOf(ctx.first.binding, 1));
    const reply = deferred<JobDetail>();
    ctx.fetchJobStatus.mockImplementation(() => reply.promise);
    const requestsBefore = ctx.fetchJobStatus.mock.calls.length;
    await ctx.runtime.recover('p1');
    expect(ctx.runtime.statusOf(ctx.nodeId)).toBeNull();
    expect(ctx.runtime.bindingRevisionOf(ctx.nodeId)).toBe(2);
    expect(ctx.fetchJobStatus.mock.calls).toHaveLength(requestsBefore);
    expect(ctx.nodes.get(ctx.nodeId)?.data).toMatchObject({ fileName: '我的混音.mp3', genStatus: 'failed' });
  });

  it('当前水合轮次已移交时，可靠旧页不重新取得承接或改卡', async () => {
    const ctx = await acceptedRetryBeforeReload(true);
    const reply = deferred<JobDetail>();
    ctx.fetchJobStatus.mockImplementationOnce(() => reply.promise);
    ctx.runtime.resumeFromHydration(ctx.nodeId, '501', ctx.nodes.get(ctx.nodeId)!.data);
    const card = serializeNodes([...ctx.nodes.values()]);
    ctx.host.setActiveJob(ctx.nodeId, 'new-owner-round');
    await ctx.runtime.recover('p1');
    expect(ctx.host.getActiveJob(ctx.nodeId)).toBe('new-owner-round');
    expect(ctx.runtime.statusOf(ctx.nodeId)?.submissionId).toBe(ctx.first.binding.submission_id);
    expect(serializeNodes([...ctx.nodes.values()])).toBe(card);
    expect(ctx.runtime.bindingRevisionOf(ctx.nodeId)).toBe(0);
  });

  it('本地已删除承接时，可靠记录不复活旧卡', async () => {
    const ctx = await acceptedRetryBeforeReload(true);
    ctx.host.markLocallyRemoved(ctx.nodeId);
    ctx.dropFromHydration(ctx.nodeId);
    const requestsBefore = ctx.fetchJobStatus.mock.calls.length;
    await ctx.runtime.recover('p1');
    expect(ctx.nodes.has(ctx.nodeId)).toBe(false);
    expect(ctx.fetchJobStatus.mock.calls).toHaveLength(requestsBefore);
    expect(ctx.runtime.statusOf(ctx.nodeId)).toBeNull();
    expect(ctx.edges().some((edge) => edge.target === ctx.nodeId)).toBe(false);
  });

  it.each(['project', 'load'] as const)('%s 已变化后迟到恢复页不写新加载的卡与台账', async (change) => {
    const ctx = await acceptedRetryBeforeReload(true);
    const page = deferred<Awaited<ReturnType<typeof ctx.host.fetchRecoveryPage>>>();
    ctx.host.fetchRecoveryPage = () => page.promise;
    const pending = ctx.runtime.recover('p1');
    if (change === 'project') ctx.host.getProjectId = () => 'p2';
    else ctx.reload();
    const card = ctx.nodes.get(ctx.nodeId)!;
    ctx.nodes.set(ctx.nodeId, { ...card, data: { ...card.data, fileName: '新加载的编辑.mp3' } });
    page.resolve({ protocol_version: 1, canvas_version: 3, records: [ctx.record], next_cursor: null });
    await pending;
    expect(ctx.nodes.get(ctx.nodeId)?.data).toMatchObject({
      fileName: '新加载的编辑.mp3', generationRecovery: { submissionId: ctx.first.binding.submission_id },
    });
    expect(ctx.runtime.statusOf(ctx.nodeId)).toBeNull();
    expect(ctx.runtime.bindingRevisionOf(ctx.nodeId)).toBe(0);
    expect(ctx.runtime.composeSaveFields()).toBeNull();
  });

  it('无可靠关联的历史水合保留兼容，不猜提交身份或伪造保存转换', async () => {
    const ctx = await acceptedRetryBeforeReload(false);
    ctx.recoveryRecords.splice(0);
    ctx.runtime.resumeFromHydration(ctx.nodeId, '501', ctx.nodes.get(ctx.nodeId)!.data);
    await ctx.runtime.recover('p1');
    expect(ctx.runtime.statusOf(ctx.nodeId)).toMatchObject({ jobId: '501', submissionId: undefined });
    ctx.fetchJobStatus.mockResolvedValue(succeeded);
    ctx.advancePolling();
    await flush();
    expect(ctx.nodes.get(ctx.nodeId)?.data).toMatchObject({ src: 'https://assets/mix-b.mp3', assetId: '90' });
    expect(ctx.nodes.get(ctx.nodeId)?.data.generationRecovery).toBeUndefined();
    expect(ctx.runtime.statusOf(ctx.nodeId)).toBeNull();
    expect(ctx.runtime.composeSaveFields()).toBeNull();
  });
});
