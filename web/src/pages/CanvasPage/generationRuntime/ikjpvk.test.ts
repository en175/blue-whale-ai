/* ============================================
 * 接续可靠受理恢复任务（IKJPVK，PR981-REVIEW7-20261005，父规格 IKJPV2 F1）。
 * 三个已复现失败形态（真实工具会话 open/edit/send 发出实际音频混合请求 +
 * audioMixCreateSchema 真实 Schema + 实际任务定义 mixMuxTasks + 公开生成运行时
 * runtime.recover/retry/statusOf；API、保存、时钟、画布宿主受控）：
 *  1. 缺卡：任务已受理（queued/processing/checking）、受理回执未保存时重载文档，
 *     首次 recover 只补占位卡但不建立执行、不启动轮询——不得依赖用户再刷新或
 *     测试先重复扫描。
 *  2. 已保存但缺 jobId 的占位遇到可靠进行中（is_current）恢复记录：不恢复任务
 *     身份（类型/jobId/提交身份）、不接续。
 *  3. 同类占位遇到可靠失败记录：仍停留生成中，不进入可重试失败卡。
 * 接缝同 ikjpm4.test.ts 先例（会话宿主桥复刻 CanvasPage）；断言观察实际请求、
 * 卡片、连线、公开任务状态与后续操作，不依赖私有 Map/setter 次数。
 * ============================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioMix, retryAudioMix, type JobDetail } from '@/api/jobs';
import { audioMixCreateSchema } from '@lib/contracts/audio-mix';
import type { CanvasBinding, GenerationRecoveryRecord } from '@/api/canvasRecovery';
import { flush, deferred, setupAudioMixRecovery, type MixCreateResult } from './audioMixRecoveryTestKit';

vi.mock('@/api/jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/jobs')>(),
  createAudioMix: vi.fn(),
  retryAudioMix: vi.fn(),
  cancelGenerationJob: vi.fn(),
}));

/** 服务端已受理的恢复记录（受控服务端事实：回显真实请求的提交身份与恢复种子）。 */
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
    expect(ctx.mix.send()).toBe(true); // 会话 A：实际请求发出（result-placeholder 无预保存）
    await flush();
    const first = ctx.createRequest(0); // 真实 Schema 校验 + 幂等键核对
    const nodeId = first.binding.target_node_id;

    ctx.reload(); // 同项目文档重载：受理回执未保存
    ctx.dropFromHydration(nodeId); // 占位未随保存落盘：水合后画布无此卡（缺卡）
    ctx.mix.close();
    ctx.recoveryRecords.push(acceptedRecord(first.binding.submission_id, nodeId, first.binding.recovery_seed, '901', 'processing'));

    await ctx.runtime.recover('p1'); // 首次（唯一一次）公开恢复
    // 补卡带受理身份（家族卡形态）
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({ jobId: '901', genStatus: 'generating', fileName: '混合结果.mp3' });
    // 自动接续：公开在途登记执行（含可靠提交身份），轮询已发出（同一次加载内）
    expect(ctx.runtime.statusOf(nodeId)).toMatchObject({
      phase: 'generating', jobId: '901', submissionId: first.binding.submission_id,
    });
    expect(ctx.fetchJobStatus.mock.calls.filter(([jobId]) => String(jobId) === '901')).toHaveLength(1);
    // 后续状态可收敛：轮询把服务端进度写回卡片（接续链活着，非死卡）
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({ progress: 40 });
    // 重复 recover 判重：不重复卡、不双轮询
    await ctx.runtime.recover('p1');
    expect([...ctx.nodes.keys()].filter((id) => id === nodeId)).toHaveLength(1);
    expect(ctx.fetchJobStatus.mock.calls.filter(([jobId]) => String(jobId) === '901')).toHaveLength(1);
    expect(vi.mocked(createAudioMix)).toHaveBeenCalledTimes(1); // 恢复不重发创建
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

    ctx.reload(); // 占位与来源线已随保存落盘：水合原样带回（无 jobId 的未受理占位）
    ctx.mix.close();
    // 新加载后的用户编辑：改名 + 移动（恢复不得覆盖合法编辑）
    const hydrated = ctx.nodes.get(nodeId)!;
    ctx.nodes.set(nodeId, {
      ...hydrated, position: { x: 321, y: 654 },
      data: { ...hydrated.data, fileName: '我的混音.mp3' },
    });
    ctx.recoveryRecords.push(acceptedRecord(first.binding.submission_id, nodeId, first.binding.recovery_seed, '901', 'processing'));

    await ctx.runtime.recover('p1'); // 首次（唯一一次）公开恢复
    // 以可靠当前记录恢复可信任务身份（jobId + 提交身份）并接续执行
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({ jobId: '901', fileName: '我的混音.mp3', genStatus: 'generating' });
    expect(ctx.nodes.get(nodeId)?.position).toEqual({ x: 321, y: 654 });
    expect(ctx.nodes.get(nodeId)?.data).not.toHaveProperty('generationRecovery'); // 不伪造恢复标记
    expect(ctx.edges().filter((edge) => edge.target === nodeId)).toHaveLength(2); // 来源连线保留
    expect(ctx.runtime.statusOf(nodeId)).toMatchObject({
      phase: 'generating', jobId: '901', submissionId: first.binding.submission_id,
    });
    expect(ctx.fetchJobStatus.mock.calls.filter(([jobId]) => String(jobId) === '901')).toHaveLength(1);

    // 旧受理回执随后到达：旧收尾不覆盖恢复身份、不释放接续执行、不删用户编辑
    oldCreate.resolve(ctx.mixCreated('901', ctx.bindingView(first.binding.submission_id, nodeId, '901', 1, true)));
    await flush();
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({ jobId: '901', fileName: '我的混音.mp3', genStatus: 'generating' });
    expect(ctx.runtime.statusOf(nodeId)).toMatchObject({ phase: 'generating', jobId: '901' });
    expect(ctx.inFlight()).toBe(false); // 旧等待 settle、锁释放
    expect(ctx.errors).toEqual([]);
    // 重复 recover 判重：无双轮询、无重复卡
    await ctx.runtime.recover('p1');
    expect(ctx.fetchJobStatus.mock.calls.filter(([jobId]) => String(jobId) === '901')).toHaveLength(1);
    expect(vi.mocked(createAudioMix)).toHaveBeenCalledTimes(1); // 不自动重发
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

    ctx.reload(); // 占位已落盘：水合带回（无 jobId）
    ctx.mix.close();
    ctx.setJobStatus('failed'); // 服务端事实：任务已失败
    ctx.recoveryRecords.push(acceptedRecord(first.binding.submission_id, nodeId, first.binding.recovery_seed, '901', 'failed'));

    await ctx.runtime.recover('p1'); // 首次（唯一一次）公开恢复
    // 进入失败卡：显示失败（不留在生成中），受理身份恢复，执行收敛（终态清理）
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({ jobId: '901', genStatus: 'failed', errorText: '供应商超时' });
    expect(ctx.runtime.statusOf(nodeId)).toBeNull();
    expect(vi.mocked(createAudioMix)).toHaveBeenCalledTimes(1); // 不自动重发

    // 可按既有可信原输入规则重试：专属重试复用 jobId（服务端冻结输入，不读取新编辑会话）
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
    expect(retryJobId).toBe('901'); // 原任务身份
    expect(retryKey).toMatch(/^[0-9a-f-]{8,}$/); // 新 submission_id = 幂等键
    expect(retryBinding).toMatchObject({ protocol_version: 1, target_node_id: nodeId }); // 携可信归属绑定
    // 重试受理后接续：卡片回到生成中并轮询
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
    expect(ctx.mix.getSnapshot().state).toBeNull(); // 交接：发送即退出
    expect(ctx.inFlight()).toBe(false);
    expect(ctx.errors).toEqual([]);
  });
});
