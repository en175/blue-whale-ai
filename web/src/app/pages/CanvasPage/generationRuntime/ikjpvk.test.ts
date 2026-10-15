import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioMix, retryAudioMix, type JobDetail } from '@/app/api/jobs';
import { audioMixCreateSchema } from '@lib/contracts/audio-mix';
import type { CanvasBinding, GenerationRecoveryRecord } from '@/app/api/canvasRecovery';
import { flush, deferred, setupAudioMixRecovery, type MixCreateResult } from './audioMixRecoveryTestKit';

vi.mock('@/app/api/jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/app/api/jobs')>(),
  createAudioMix: vi.fn(),
  retryAudioMix: vi.fn(),
  cancelGenerationJob: vi.fn(),
}));

const acceptedRecord = (
  submissionId: string, nodeId: string, seed: CanvasBinding['recovery_seed'],
  jobId: string, status: 'processing' | 'failed',
): GenerationRecoveryRecord => ({
  submission_id: submissionId, target_node_id: nodeId, job_id: jobId, task_type: 'audio_mix',
  binding_revision: 1, is_current: true,
  job: {
    job_id: jobId, type: 'audio_mix', status, progress: status === 'processing' ? 40 : 0,
    output_asset_ids: [], stored_error: status === 'failed' ? { msg: '供应商超时' } : null,
    created_at: '2026-10-05T00:00:00Z',
  },
  recovery_seed: seed ?? null,
  previous_target_snapshot: null,
  items: [{
    recovery_item_id: `gcr:${submissionId}:$target`, output_key: '$target', node_id: nodeId,
    state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null,
  }],
});

function setup() {
  const ctx = setupAudioMixRecovery({
    reuseUnacceptedCard: false,
    rollbackOnFailure: false,
    terminalPatch: (detail) => ({
      genStatus: detail.status,
      ...(detail.status === 'failed' && detail.error?.msg != null ? { errorText: detail.error.msg } : {}),
    }),
  });
  return {
    ...ctx,
    setJobStatus: (status: 'processing' | 'failed', progress = 40) => {
      ctx.fetchJobStatus.mockImplementation(async (jobId: string | number): Promise<JobDetail> => ({
        job_id: String(jobId), status, progress, asset: null,
        ...(status === 'failed' ? { error: { code: 1046, msg: '供应商超时' } } : {}),
      }));
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(retryAudioMix).mockResolvedValue({ job_id: '901', status: 'queued', replayed: false });
});

describe('接续可靠受理恢复任务（IKJPVK）', () => {
  it('同生存期两宿主交错发送时，实际请求、受理等待与锁各自独立', async () => {
    const first = setup();
    const second = setup();
    const firstReceipt = deferred<MixCreateResult>();
    const secondReceipt = deferred<MixCreateResult>();
    vi.mocked(createAudioMix).mockImplementationOnce(() => secondReceipt.promise)
      .mockImplementationOnce(() => firstReceipt.promise);
    first.openWithInput();
    second.openWithInput();
    second.mix.edit((state) => ({ ...state, format: 'wav' }));
    expect(second.mix.send()).toBe(true);
    expect(first.mix.send()).toBe(true);
    await flush();
    const firstRequest = first.createRequest(0);
    const secondRequest = second.createRequest(0);
    expect(firstRequest.payload.output_format).toBe('mp3');
    expect(secondRequest.payload.output_format).toBe('wav');
    expect(firstRequest.binding.target_node_id).not.toBe(secondRequest.binding.target_node_id);
    expect(firstRequest.binding.submission_id).not.toBe(secondRequest.binding.submission_id);
    expect(first.inFlight()).toBe(true);
    expect(second.inFlight()).toBe(true);

    firstReceipt.resolve(first.mixCreated('501', first.bindingView(
      firstRequest.binding.submission_id, firstRequest.binding.target_node_id, '501', 1,
    )));
    await flush();
    expect(first.nodes.get(firstRequest.binding.target_node_id)?.data.jobId).toBe('501');
    expect(first.runtime.statusOf(firstRequest.binding.target_node_id)).toMatchObject({ phase: 'generating', jobId: '501' });
    expect(first.mix.getSnapshot().state).toBeNull();
    expect(first.inFlight()).toBe(false);
    expect(second.inFlight()).toBe(true);
    expect(second.mix.getSnapshot().state).not.toBeNull();
    expect(second.nodes.get(secondRequest.binding.target_node_id)?.data.jobId).toBeUndefined();

    secondReceipt.resolve(second.mixCreated('502', second.bindingView(
      secondRequest.binding.submission_id, secondRequest.binding.target_node_id, '502', 1,
    )));
    await flush();
    expect(second.nodes.get(secondRequest.binding.target_node_id)?.data.jobId).toBe('502');
    expect(second.runtime.statusOf(secondRequest.binding.target_node_id)).toMatchObject({ phase: 'generating', jobId: '502' });
    expect(second.mix.getSnapshot().state).toBeNull();
    expect(first.inFlight()).toBe(false);
    expect(second.inFlight()).toBe(false);
    expect(first.nodes.has(secondRequest.binding.target_node_id)).toBe(false);
    expect(second.nodes.has(firstRequest.binding.target_node_id)).toBe(false);
    expect(first.nodes.get(firstRequest.binding.target_node_id)?.data.jobId).toBe('501');
    expect(first.createRequest(0).payload.output_format).toBe('mp3');
    expect(second.createRequest(0).payload.output_format).toBe('wav');
  });

  it('独立宿主的编辑、恢复记录、响应、等待与锁不互相污染', async () => {
    const first = setup();
    first.setJobStatus('failed');
    const waiting = deferred<MixCreateResult>();
    vi.mocked(createAudioMix).mockImplementationOnce(() => waiting.promise);
    first.openWithInput();
    expect(first.mix.send()).toBe(true);
    await flush();
    const firstRequest = first.createRequest(0);
    const firstNodeId = firstRequest.binding.target_node_id;
    first.nodes.set('audio-a', {
      ...first.nodes.get('audio-a')!,
      data: { ...first.nodes.get('audio-a')!.data, fileName: '第一实例的编辑.mp3' },
    });
    first.drawEdge('audio-a', 'audio-b');
    first.recoveryRecords.push(acceptedRecord(
      firstRequest.binding.submission_id, firstNodeId, firstRequest.binding.recovery_seed, '901', 'failed',
    ));

    const second = setup();
    second.openWithInput();
    await second.runtime.recover('p1');
    expect(first.inFlight()).toBe(true);
    expect(second.inFlight()).toBe(false);
    expect(second.nodes.get('audio-a')?.data.fileName).toBe('原音频A.mp3');
    expect(second.nodes.has(firstNodeId)).toBe(false);
    expect(second.edges()).toEqual([]);
    expect(second.runtime.statusOf(firstNodeId)).toBeNull();

    waiting.resolve(first.mixCreated('901', first.bindingView(
      firstRequest.binding.submission_id, firstNodeId, '901', 1,
    )));
    await flush();
    expect(first.nodes.get(firstNodeId)?.data).toMatchObject({ genStatus: 'failed', errorText: '供应商超时' });
    expect(first.inFlight()).toBe(false);
    expect(second.mix.getSnapshot().state).not.toBeNull();
    expect(second.errors).toEqual([]);

    vi.mocked(createAudioMix).mockImplementationOnce(async (_project, body) => {
      const binding = audioMixCreateSchema.parse(body).canvas_binding!;
      return second.mixCreated('902', second.bindingView(binding.submission_id, binding.target_node_id, '902', 1));
    });
    expect(second.mix.send()).toBe(true);
    await flush();
    const secondNodeId = second.createRequest(0).binding.target_node_id;
    expect(second.nodes.get(secondNodeId)?.data).toMatchObject({ jobId: '902', genStatus: 'generating', progress: 40 });
    expect(second.runtime.statusOf(secondNodeId)).toMatchObject({ jobId: '902', phase: 'generating' });
    expect(second.edges()).toHaveLength(2);
    expect(second.inFlight()).toBe(false);
    expect(first.nodes.get(firstNodeId)?.data.genStatus).toBe('failed');
    expect(first.edges()).toHaveLength(3);
  });

  it('反例一：缺卡的进行中任务在首次公开 recover 内补卡并自动接续轮询（不依赖再次加载或重复扫描）', async () => {
    const ctx = setup();
    const oldCreate = deferred<MixCreateResult>();
    vi.mocked(createAudioMix).mockImplementationOnce(() => oldCreate.promise);
    ctx.openWithInput();
    expect(ctx.mix.send()).toBe(true);
    await flush();
    const first = ctx.createRequest(0);
    const nodeId = first.binding.target_node_id;

    ctx.reload();
    ctx.dropFromHydration(nodeId);
    ctx.mix.close();
    ctx.recoveryRecords.push(acceptedRecord(first.binding.submission_id, nodeId, first.binding.recovery_seed, '901', 'processing'));

    await ctx.runtime.recover('p1');
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({ jobId: '901', genStatus: 'generating', fileName: '混合结果.mp3' });
    expect(ctx.runtime.statusOf(nodeId)).toMatchObject({
      phase: 'generating', jobId: '901', submissionId: first.binding.submission_id,
    });
    expect(ctx.fetchJobStatus.mock.calls.filter(([jobId]) => String(jobId) === '901')).toHaveLength(1);
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({ progress: 40 });
    await ctx.runtime.recover('p1');
    expect([...ctx.nodes.keys()].filter((id) => id === nodeId)).toHaveLength(1);
    expect(ctx.fetchJobStatus.mock.calls.filter(([jobId]) => String(jobId) === '901')).toHaveLength(1);
    expect(vi.mocked(createAudioMix)).toHaveBeenCalledTimes(1);
  });

  it('反例二：已保存但缺 jobId 的占位收到可靠进行中记录后恢复任务身份并接续；用户编辑保留、旧回执不覆盖', async () => {
    const ctx = setup();
    const oldCreate = deferred<MixCreateResult>();
    vi.mocked(createAudioMix).mockImplementationOnce(() => oldCreate.promise);
    ctx.openWithInput();
    expect(ctx.mix.send()).toBe(true);
    await flush();
    const first = ctx.createRequest(0);
    const nodeId = first.binding.target_node_id;

    ctx.reload();
    ctx.mix.close();
    const hydrated = ctx.nodes.get(nodeId)!;
    ctx.nodes.set(nodeId, {
      ...hydrated, position: { x: 321, y: 654 },
      data: { ...hydrated.data, fileName: '我的混音.mp3' },
    });
    ctx.recoveryRecords.push(acceptedRecord(first.binding.submission_id, nodeId, first.binding.recovery_seed, '901', 'processing'));

    await ctx.runtime.recover('p1');
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({ jobId: '901', fileName: '我的混音.mp3', genStatus: 'generating' });
    expect(ctx.nodes.get(nodeId)?.position).toEqual({ x: 321, y: 654 });
    expect(ctx.nodes.get(nodeId)?.data).not.toHaveProperty('generationRecovery');
    expect(ctx.edges().filter((edge) => edge.target === nodeId)).toHaveLength(2);
    expect(ctx.runtime.statusOf(nodeId)).toMatchObject({
      phase: 'generating', jobId: '901', submissionId: first.binding.submission_id,
    });
    expect(ctx.fetchJobStatus.mock.calls.filter(([jobId]) => String(jobId) === '901')).toHaveLength(1);

    oldCreate.resolve(ctx.mixCreated('901', ctx.bindingView(first.binding.submission_id, nodeId, '901', 1, true)));
    await flush();
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({ jobId: '901', fileName: '我的混音.mp3', genStatus: 'generating' });
    expect(ctx.runtime.statusOf(nodeId)).toMatchObject({ phase: 'generating', jobId: '901' });
    expect(ctx.inFlight()).toBe(false);
    expect(ctx.errors).toEqual([]);
    await ctx.runtime.recover('p1');
    expect(ctx.fetchJobStatus.mock.calls.filter(([jobId]) => String(jobId) === '901')).toHaveLength(1);
    expect(vi.mocked(createAudioMix)).toHaveBeenCalledTimes(1);
  });

  it('反例三：同类占位收到可靠失败记录后收敛为失败卡，并可按既有规则以原 jobId 重试', async () => {
    const ctx = setup();
    const oldCreate = deferred<MixCreateResult>();
    vi.mocked(createAudioMix).mockImplementationOnce(() => oldCreate.promise);
    ctx.openWithInput();
    expect(ctx.mix.send()).toBe(true);
    await flush();
    const first = ctx.createRequest(0);
    const nodeId = first.binding.target_node_id;

    ctx.reload();
    ctx.mix.close();
    ctx.setJobStatus('failed');
    ctx.recoveryRecords.push(acceptedRecord(first.binding.submission_id, nodeId, first.binding.recovery_seed, '901', 'failed'));

    await ctx.runtime.recover('p1');
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({ jobId: '901', genStatus: 'failed', errorText: '供应商超时' });
    expect(ctx.runtime.statusOf(nodeId)).toBeNull();
    expect(vi.mocked(createAudioMix)).toHaveBeenCalledTimes(1);

    ctx.setJobStatus('processing');
    vi.mocked(retryAudioMix).mockResolvedValue({
      job_id: '901', status: 'queued', replayed: false,
      canvas_binding: ctx.bindingView('retry-sub-1', nodeId, '901', 2),
    });
    expect(ctx.runtime.retry(nodeId)).toBe(true);
    await flush();
    expect(vi.mocked(retryAudioMix)).toHaveBeenCalledTimes(1);
    const [retryProject, retryJobId, retryKey, , retryBinding] = vi.mocked(retryAudioMix).mock.calls[0]!;
    expect(retryProject).toBe('p1');
    expect(retryJobId).toBe('901');
    expect(retryKey).toMatch(/^[0-9a-f-]{8,}$/);
    expect(retryBinding).toMatchObject({ protocol_version: 1, target_node_id: nodeId });
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({ jobId: '901', genStatus: 'generating' });
    expect(ctx.runtime.statusOf(nodeId)).toMatchObject({ phase: 'generating', jobId: '901' });
    expect(ctx.fetchJobStatus.mock.calls.filter(([jobId]) => String(jobId) === '901').length).toBeGreaterThanOrEqual(1);
  });

  it('正常对照：当前合法创建受理回填任务身份、交接并启动轮询，占位卡与来源线保留', async () => {
    const ctx = setup();
    vi.mocked(createAudioMix).mockImplementation(async (_project: string, body: unknown) => {
      const binding = audioMixCreateSchema.parse(body).canvas_binding!;
      return ctx.mixCreated('901', ctx.bindingView(
        binding.submission_id, binding.target_node_id, '901', binding.expected_binding_revision + 1, true,
      ));
    });
    ctx.openWithInput();
    expect(ctx.mix.send()).toBe(true);
    await flush();
    const first = ctx.createRequest(0);
    const nodeId = first.binding.target_node_id;
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({ jobId: '901', genStatus: 'generating' });
    expect(ctx.edges().filter((edge) => edge.target === nodeId)).toHaveLength(2);
    expect(ctx.runtime.statusOf(nodeId)).toMatchObject({
      phase: 'generating', jobId: '901', submissionId: first.binding.submission_id,
    });
    expect(ctx.fetchJobStatus.mock.calls.filter(([jobId]) => String(jobId) === '901')).toHaveLength(1);
    expect(ctx.mix.getSnapshot().state).toBeNull();
    expect(ctx.inFlight()).toBe(false);
    expect(ctx.errors).toEqual([]);
  });
});
