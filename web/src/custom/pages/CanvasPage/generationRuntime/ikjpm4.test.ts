import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/shared/api/http';
import { createAudioMix } from '@/custom/api/jobs';
import { audioMixCreateSchema } from '@lib/contracts/audio-mix';
import type { CanvasBinding, GenerationRecoveryRecord } from '@/custom/api/canvasRecovery';
import { AUDIO_MIX_EDGE_ORIGIN, isAudioMixNodeId } from '../tools/audio/audioMix';
import {
  DEPS, flush, deferred, bindingView, mixCreated, setupAudioMixRecovery, type MixCreateResult,
} from './audioMixRecoveryTestKit';

vi.mock('@/custom/api/jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/custom/api/jobs')>(),
  createAudioMix: vi.fn(),
  retryAudioMix: vi.fn(),
  cancelGenerationJob: vi.fn(),
}));

const respondCreated = (jobId: string): typeof createAudioMix =>
  (async (_project: string, body: unknown) => {
    const binding = audioMixCreateSchema.parse(body).canvas_binding!;
    return mixCreated(jobId, bindingView(
      binding.submission_id, binding.target_node_id, jobId, binding.expected_binding_revision + 1, true,
    ));
  }) as typeof createAudioMix;

const acceptedProcessingRecord = (
  submissionId: string, nodeId: string, seed: CanvasBinding['recovery_seed'], jobId = '901',
): GenerationRecoveryRecord => ({
  submission_id: submissionId, target_node_id: nodeId, job_id: jobId, task_type: 'audio_mix',
  binding_revision: 1, is_current: true,
  job: {
    job_id: jobId, type: 'audio_mix', status: 'processing', progress: 40,
    output_asset_ids: [], stored_error: null, created_at: '2026-10-05T00:00:00Z',
  },
  recovery_seed: seed ?? null,
  previous_target_snapshot: null,
  items: [{
    recovery_item_id: `gcr:${submissionId}:$target`, output_key: '$target', node_id: nodeId,
    state: 'pending', revision: 1, node_binding_revision: 1, asset_id: null, slot_id: null,
  }],
});

const setup = () => setupAudioMixRecovery({
  reuseUnacceptedCard: true,
  edgeOrigin: AUDIO_MIX_EDGE_ORIGIN,
  rollbackOnFailure: true,
  terminalPatch: (detail) => ({ genStatus: detail.status }),
});

beforeEach(() => { vi.resetAllMocks(); });

describe('保护音频混合恢复卡与连线（IKJPM4）', () => {
  it('迟到失效收尾只结算旧等待：当前恢复卡、用户编辑与来源连线全部保留（受理回执迟到三形态）', async () => {
    const ctx = setup();
    const oldCreate = deferred<MixCreateResult>();
    vi.mocked(createAudioMix)
      .mockImplementationOnce(() => oldCreate.promise)
      .mockImplementation(respondCreated('902'));
    ctx.openWithInput();
    expect(ctx.mix.send()).toBe(true);
    await flush();
    expect(vi.mocked(createAudioMix)).toHaveBeenCalledTimes(1);
    const first = ctx.createRequest(0);
    expect(first.payload).toMatchObject({
      source_node_id: 'audio-a',
      inputs: [{ asset_id: '11', node_id: 'audio-a' }, { asset_id: '22', node_id: 'audio-b' }],
      output_format: 'mp3',
    });
    const nodeId = first.binding.target_node_id;
    expect(ctx.nodes.has(nodeId)).toBe(true);
    expect(ctx.edges().filter((edge) => edge.target === nodeId)).toHaveLength(2);

    ctx.reload();
    ctx.dropFromHydration(nodeId);
    ctx.mix.close();
    ctx.openWithInput();
    expect(ctx.mix.send()).toBe(false);

    ctx.recoveryRecords.push(acceptedProcessingRecord(first.binding.submission_id, nodeId, first.binding.recovery_seed));
    await ctx.runtime.recover('p1');
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({ jobId: '901', genStatus: 'generating', fileName: '混合结果.mp3' });
    expect(ctx.runtime.statusOf(nodeId)).toMatchObject({ phase: 'generating', jobId: '901' });
    await ctx.runtime.recover('p1');
    expect(ctx.runtime.statusOf(nodeId)).toMatchObject({ phase: 'generating', jobId: '901' });
    expect(ctx.fetchJobStatus.mock.calls.filter(([jobId]) => String(jobId) === '901')).toHaveLength(1);
    await ctx.runtime.recover('p1');
    expect([...ctx.nodes.keys()].filter(isAudioMixNodeId)).toHaveLength(1);
    expect(ctx.fetchJobStatus.mock.calls.filter(([jobId]) => String(jobId) === '901')).toHaveLength(1);

    const recovered = ctx.nodes.get(nodeId)!;
    ctx.nodes.set(nodeId, {
      ...recovered, position: { x: 777, y: 888 },
      data: { ...recovered.data, fileName: '我的混音.mp3', width: 520, height: 300 },
    });
    ctx.drawEdge('audio-a', nodeId);
    ctx.drawEdge('audio-b', nodeId);

    oldCreate.resolve(mixCreated('901', bindingView(first.binding.submission_id, nodeId, '901', 1, true)));
    await flush();
    expect(ctx.nodes.has(nodeId)).toBe(true);
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({
      jobId: '901', fileName: '我的混音.mp3', width: 520, height: 300, genStatus: 'generating',
    });
    expect(ctx.nodes.get(nodeId)?.position).toEqual({ x: 777, y: 888 });
    expect(ctx.edges().filter((edge) => edge.target === nodeId)).toHaveLength(2);
    expect(ctx.runtime.statusOf(nodeId)).toMatchObject({ phase: 'generating', jobId: '901' });
    expect(vi.mocked(createAudioMix)).toHaveBeenCalledTimes(1);
    expect(ctx.inFlight()).toBe(false);
    expect(ctx.errors).toEqual([]);
    expect(ctx.warnings).toEqual([]);

    ctx.mix.edit((state) => ({ ...state, format: 'wav' }));
    expect(ctx.mix.send()).toBe(true);
    await flush();
    expect(vi.mocked(createAudioMix)).toHaveBeenCalledTimes(2);
    const second = ctx.createRequest(1);
    expect(second.binding.submission_id).not.toBe(first.binding.submission_id);
    expect(ctx.nodes.get(second.binding.target_node_id)?.data).toMatchObject({ jobId: '902', genStatus: 'generating' });
    expect(ctx.runtime.statusOf(second.binding.target_node_id)).toMatchObject({ phase: 'generating', jobId: '902' });
    expect(ctx.mix.getSnapshot().state).toBeNull();
    expect(ctx.inFlight()).toBe(false);
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({ fileName: '我的混音.mp3', jobId: '901' });

    const ctxB = setup();
    const oldCreateB = deferred<MixCreateResult>();
    vi.mocked(createAudioMix).mockImplementationOnce(() => oldCreateB.promise);
    ctxB.openWithInput();
    expect(ctxB.mix.send()).toBe(true);
    await flush();
    const firstB = ctxB.createRequest(0);
    const nodeIdB = firstB.binding.target_node_id;
    ctxB.reload();
    ctxB.mix.close();
    expect(ctxB.mix.open('audio-a', DEPS)).toBe(true);
    ctxB.recoveryRecords.push(acceptedProcessingRecord(firstB.binding.submission_id, nodeIdB, firstB.binding.recovery_seed));
    await ctxB.runtime.recover('p1');
    expect(ctxB.runtime.statusOf(nodeIdB)).toMatchObject({ phase: 'generating', jobId: '901' });
    expect(ctxB.nodes.get(nodeIdB)?.data.jobId).toBe('901');
    const hydrated = ctxB.nodes.get(nodeIdB)!;
    ctxB.nodes.set(nodeIdB, { ...hydrated, data: { ...hydrated.data, fileName: '待确认混音.mp3' } });
    oldCreateB.resolve(mixCreated('901', bindingView(firstB.binding.submission_id, nodeIdB, '901', 1, true)));
    await flush();
    expect(ctxB.nodes.get(nodeIdB)?.data).toMatchObject({ fileName: '待确认混音.mp3', genStatus: 'generating' });
    expect(ctxB.nodes.get(nodeIdB)?.data.jobId).toBe('901');
    expect(ctxB.runtime.statusOf(nodeIdB)).toMatchObject({ phase: 'generating', jobId: '901' });
    expect(ctxB.edges().filter((edge) => edge.target === nodeIdB)).toHaveLength(2);
    expect(ctxB.inFlight()).toBe(false);
    expect(ctxB.errors).toEqual([]);

    const ctxC = setup();
    const oldCreateC = deferred<MixCreateResult>();
    vi.mocked(createAudioMix).mockImplementationOnce(() => oldCreateC.promise);
    ctxC.openWithInput();
    expect(ctxC.mix.send()).toBe(true);
    await flush();
    const firstC = ctxC.createRequest(0);
    const nodeIdC = firstC.binding.target_node_id;
    ctxC.reload();
    ctxC.mix.close();
    expect(ctxC.mix.open('audio-a', DEPS)).toBe(true);
    ctxC.recoveryRecords.push(acceptedProcessingRecord(firstC.binding.submission_id, nodeIdC, firstC.binding.recovery_seed));
    await ctxC.runtime.recover('p1');
    oldCreateC.reject(new ApiError(500, '服务内部错误', 500));
    await flush();
    expect(ctxC.nodes.has(nodeIdC)).toBe(true);
    expect(ctxC.edges().filter((edge) => edge.target === nodeIdC)).toHaveLength(2);
    expect(ctxC.inFlight()).toBe(false);
    expect(ctxC.errors).toEqual([]);
  });

  it('正常对照：当前合法创建受理回填任务身份、交接并轮询，占位卡与来源线保留', async () => {
    const ctx = setup();
    vi.mocked(createAudioMix).mockImplementation(respondCreated('901'));
    ctx.openWithInput();
    expect(ctx.mix.send()).toBe(true);
    await flush();
    expect(vi.mocked(createAudioMix)).toHaveBeenCalledTimes(1);
    const first = ctx.createRequest(0);
    const nodeId = first.binding.target_node_id;
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({ jobId: '901', genStatus: 'generating' });
    expect(ctx.nodes.get(nodeId)?.data.generationRecovery).toBeUndefined();
    expect(ctx.edges().filter((edge) => edge.target === nodeId)).toHaveLength(2);
    expect(ctx.runtime.statusOf(nodeId)).toMatchObject({ phase: 'generating', jobId: '901', submissionId: first.binding.submission_id });
    expect(ctx.fetchJobStatus.mock.calls.filter(([jobId]) => String(jobId) === '901')).toHaveLength(1);
    expect(ctx.mix.getSnapshot().state).toBeNull();
    expect(ctx.inFlight()).toBe(false);
    expect(ctx.errors).toEqual([]);
  });

  it('当前创建失败仍撤回自己创建的临时占位与来源线，随后可合法重发并受理', async () => {
    const ctx = setup();
    vi.mocked(createAudioMix)
      .mockRejectedValueOnce(new ApiError(500, '服务内部错误', 500))
      .mockImplementation(respondCreated('903'));
    ctx.openWithInput();
    expect(ctx.mix.send()).toBe(true);
    await flush();
    expect(vi.mocked(createAudioMix)).toHaveBeenCalledTimes(1);
    const first = ctx.createRequest(0);
    const nodeId = first.binding.target_node_id;
    expect(ctx.nodes.has(nodeId)).toBe(false);
    expect(ctx.edges().filter((edge) => edge.target === nodeId)).toHaveLength(0);
    expect(ctx.runtime.statusOf(nodeId)).toBeNull();
    expect(ctx.inFlight()).toBe(false);
    expect(ctx.errors).toHaveLength(1);

    expect(ctx.mix.send()).toBe(true);
    await flush();
    expect(vi.mocked(createAudioMix)).toHaveBeenCalledTimes(2);
    const second = ctx.createRequest(1);
    expect(second.binding.target_node_id).toBe(nodeId);
    expect(second.binding.submission_id).toBe(first.binding.submission_id);
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({ jobId: '903', genStatus: 'generating' });
    expect(ctx.runtime.statusOf(nodeId)).toMatchObject({ phase: 'generating', jobId: '903' });
    expect(ctx.inFlight()).toBe(false);
  });
});
