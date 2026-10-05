/* ============================================
 * 保护音频混合恢复卡与连线（IKJPM4，PR981-REVIEW6-20261005，父规格 IKJPKR F1）。
 * 复现链：真实工具会话 open/edit/send 发出实际音频混合请求（真实会话定义
 * compoundToolSessions + 实际任务定义 mixMuxTasks + 真实请求 Schema 校验 +
 * 公开生成运行时 runtime）；创建已被服务端受理、回执在途时同项目文档重载——
 * 存活页面内的 doc 更替（加载身份推进 + runtime.reset + 水合），不是整页刷新
 * （整页刷新后旧浏览器 Promise 不再执行，不在本测试范围）；经公开 recover 接续
 * 原任务（恢复补卡卡带 jobId / 在卡续轮询）；旧回执随后到达。
 * 达标：旧收尾只结算自己的等待与锁，当前恢复卡、用户改名/移动/尺寸、来源连线
 * 与公开在途状态全部保留；随后新合法会话可发送并收到自己的受理。
 * 接缝（同 ikjp8b.test.ts 先例）：会话宿主的 createTask/handoff 复刻 CanvasPage
 * 页面桥（audioMixSubmitCardRef 占位身份复用 + 占位卡预建 + AUDIO_MIX_EDGE_ORIGIN
 * 来源线 + watchMixSubmit + runtime.submit + onStale/onCreateFailure 收尾）；
 * API、保存、时钟、画布宿主受控，未执行认证浏览器端到端。观察实际请求、卡片、
 * 连线、runtime.statusOf 公开在途与后续会话操作，不依赖私有 Map/setter 次数/
 * 源码顺序。
 * ============================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/http';
import { createAudioMix } from '@/api/jobs';
import { audioMixCreateSchema } from '@lib/contracts/audio-mix';
import type { CanvasBinding, GenerationRecoveryRecord } from '@/api/canvasRecovery';
import { AUDIO_MIX_EDGE_ORIGIN, isAudioMixNodeId } from '../audioMix';
import {
  DEPS, flush, deferred, bindingView, mixCreated, setupAudioMixRecovery, type MixCreateResult,
} from './audioMixRecoveryTestKit';

vi.mock('@/api/jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/jobs')>(),
  createAudioMix: vi.fn(),
  retryAudioMix: vi.fn(),
  cancelGenerationJob: vi.fn(),
}));

/** 受理成功回执：按真实请求回显提交身份（服务端受理前提完整合法的绑定视图）。 */
const respondCreated = (jobId: string): typeof createAudioMix =>
  (async (_project: string, body: unknown) => {
    const binding = audioMixCreateSchema.parse(body).canvas_binding!;
    return mixCreated(jobId, bindingView(
      binding.submission_id, binding.target_node_id, jobId, binding.expected_binding_revision + 1, true,
    ));
  }) as typeof createAudioMix;

/** 服务端已受理（任务进行中）的恢复记录：提交身份与恢复种子回显真实请求。 */
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
    // ── 形态一（工单复现主链）：占位未落盘 → recover 恢复补卡（卡带 jobId）→ 续轮询 ──
    const ctx = setup();
    const oldCreate = deferred<MixCreateResult>();
    vi.mocked(createAudioMix)
      .mockImplementationOnce(() => oldCreate.promise)
      .mockImplementation(respondCreated('902'));
    ctx.openWithInput();
    expect(ctx.mix.send()).toBe(true); // 会话 A：实际请求发出（result-placeholder 无预保存）
    await flush();
    expect(vi.mocked(createAudioMix)).toHaveBeenCalledTimes(1);
    const first = ctx.createRequest(0); // 真实 Schema 校验 + 幂等键核对
    expect(first.payload).toMatchObject({
      source_node_id: 'audio-a',
      inputs: [{ asset_id: '11', node_id: 'audio-a' }, { asset_id: '22', node_id: 'audio-b' }],
      output_format: 'mp3',
    });
    const nodeId = first.binding.target_node_id;
    expect(ctx.nodes.has(nodeId)).toBe(true); // 占位卡预建
    expect(ctx.edges().filter((edge) => edge.target === nodeId)).toHaveLength(2); // 来源线先行

    ctx.reload(); // 同项目文档重载：加载身份推进 + 运行时重置
    ctx.dropFromHydration(nodeId); // 占位未随保存落盘：水合后画布无此卡
    ctx.mix.close();
    ctx.openWithInput(); // 会话 B：旧会话关闭重开（推进会话纪元）
    expect(ctx.mix.send()).toBe(false); // 真实重开 send 被在途锁阻止（A 的锁未释放）

    // 公开恢复接续原任务：进行中缺卡补占位（恢复卡带受理身份）；IKJPVK 起补卡即
    // 接续——首次恢复建立执行并启动轮询，无需第二次扫描
    ctx.recoveryRecords.push(acceptedProcessingRecord(first.binding.submission_id, nodeId, first.binding.recovery_seed));
    await ctx.runtime.recover('p1');
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({ jobId: '901', genStatus: 'generating', fileName: '混合结果.mp3' });
    expect(ctx.runtime.statusOf(nodeId)).toMatchObject({ phase: 'generating', jobId: '901' });
    await ctx.runtime.recover('p1'); // 重复 recover：在途判重——不重复卡、不双轮询
    expect(ctx.runtime.statusOf(nodeId)).toMatchObject({ phase: 'generating', jobId: '901' });
    expect(ctx.fetchJobStatus.mock.calls.filter(([jobId]) => String(jobId) === '901')).toHaveLength(1);
    await ctx.runtime.recover('p1'); // 再次重复 recover：仍不重复卡、不双轮询
    expect([...ctx.nodes.keys()].filter(isAudioMixNodeId)).toHaveLength(1);
    expect(ctx.fetchJobStatus.mock.calls.filter(([jobId]) => String(jobId) === '901')).toHaveLength(1);

    // 恢复后用户编辑：改名、移动、尺寸 + 重新拖线建可靠来源边（无提交标记）
    const recovered = ctx.nodes.get(nodeId)!;
    ctx.nodes.set(nodeId, {
      ...recovered, position: { x: 777, y: 888 },
      data: { ...recovered.data, fileName: '我的混音.mp3', width: 520, height: 300 },
    });
    ctx.drawEdge('audio-a', nodeId);
    ctx.drawEdge('audio-b', nodeId);

    // 旧回执随后返回（服务端此前确已受理，is_current 一致）
    oldCreate.resolve(mixCreated('901', bindingView(first.binding.submission_id, nodeId, '901', 1, true)));
    await flush();
    expect(ctx.nodes.has(nodeId)).toBe(true); // 当前恢复卡保留
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({
      jobId: '901', fileName: '我的混音.mp3', width: 520, height: 300, genStatus: 'generating',
    });
    expect(ctx.nodes.get(nodeId)?.position).toEqual({ x: 777, y: 888 });
    expect(ctx.edges().filter((edge) => edge.target === nodeId)).toHaveLength(2); // 当前来源连线保留
    expect(ctx.runtime.statusOf(nodeId)).toMatchObject({ phase: 'generating', jobId: '901' }); // 接续执行不被释放
    expect(vi.mocked(createAudioMix)).toHaveBeenCalledTimes(1); // 旧链不重发
    expect(ctx.inFlight()).toBe(false); // 旧等待 settle、锁释放
    expect(ctx.errors).toEqual([]); // 失效会话不弹错
    expect(ctx.warnings).toEqual([]);

    // 随后新的合法会话（改格式 = 新意图新卡）可发送并收到自己的受理
    ctx.mix.edit((state) => ({ ...state, format: 'wav' }));
    expect(ctx.mix.send()).toBe(true);
    await flush();
    expect(vi.mocked(createAudioMix)).toHaveBeenCalledTimes(2);
    const second = ctx.createRequest(1);
    expect(second.binding.submission_id).not.toBe(first.binding.submission_id); // 独立提交身份
    expect(ctx.nodes.get(second.binding.target_node_id)?.data).toMatchObject({ jobId: '902', genStatus: 'generating' });
    expect(ctx.runtime.statusOf(second.binding.target_node_id)).toMatchObject({ phase: 'generating', jobId: '902' });
    expect(ctx.mix.getSnapshot().state).toBeNull(); // 交接完成（发送即退出）
    expect(ctx.inFlight()).toBe(false);
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({ fileName: '我的混音.mp3', jobId: '901' }); // 恢复卡不受新提交影响

    // ── 形态二：占位已落盘 → 水合原样带回（无 jobId 的未受理占位 + 提交来源线）──
    const ctxB = setup();
    const oldCreateB = deferred<MixCreateResult>();
    vi.mocked(createAudioMix).mockImplementationOnce(() => oldCreateB.promise);
    ctxB.openWithInput();
    expect(ctxB.mix.send()).toBe(true);
    await flush();
    const firstB = ctxB.createRequest(0);
    const nodeIdB = firstB.binding.target_node_id;
    ctxB.reload(); // 占位与来源线已随保存落盘：水合原样带回
    ctxB.mix.close();
    expect(ctxB.mix.open('audio-a', DEPS)).toBe(true);
    ctxB.recoveryRecords.push(acceptedProcessingRecord(firstB.binding.submission_id, nodeIdB, firstB.binding.recovery_seed));
    await ctxB.runtime.recover('p1'); // IKJPVK：卡无受理身份（identify 口径认不出）也由
    // 可靠记录直供 def 接续——恢复可信任务身份（jobId 回填）并续轮询，无需卡先有 jobId
    expect(ctxB.runtime.statusOf(nodeIdB)).toMatchObject({ phase: 'generating', jobId: '901' });
    expect(ctxB.nodes.get(nodeIdB)?.data.jobId).toBe('901'); // 受理身份以可靠记录恢复
    const hydrated = ctxB.nodes.get(nodeIdB)!;
    ctxB.nodes.set(nodeIdB, { ...hydrated, data: { ...hydrated.data, fileName: '待确认混音.mp3' } }); // 新加载后的用户改名
    oldCreateB.resolve(mixCreated('901', bindingView(firstB.binding.submission_id, nodeIdB, '901', 1, true)));
    await flush();
    expect(ctxB.nodes.get(nodeIdB)?.data).toMatchObject({ fileName: '待确认混音.mp3', genStatus: 'generating' }); // 新加载卡不被旧收尾删除
    expect(ctxB.nodes.get(nodeIdB)?.data.jobId).toBe('901'); // 身份是恢复记录回填的，非旧回执路径
    expect(ctxB.runtime.statusOf(nodeIdB)).toMatchObject({ phase: 'generating', jobId: '901' }); // 接续执行不被旧收尾释放
    expect(ctxB.edges().filter((edge) => edge.target === nodeIdB)).toHaveLength(2); // 来源连线保留
    expect(ctxB.inFlight()).toBe(false);
    expect(ctxB.errors).toEqual([]);

    // ── 形态三：旧创建失败迟到（旧失败收尾同样不改写新加载资源）──
    const ctxC = setup();
    const oldCreateC = deferred<MixCreateResult>();
    vi.mocked(createAudioMix).mockImplementationOnce(() => oldCreateC.promise);
    ctxC.openWithInput();
    expect(ctxC.mix.send()).toBe(true);
    await flush();
    const firstC = ctxC.createRequest(0);
    const nodeIdC = firstC.binding.target_node_id;
    ctxC.reload(); // 占位已落盘：水合带回
    ctxC.mix.close();
    expect(ctxC.mix.open('audio-a', DEPS)).toBe(true);
    ctxC.recoveryRecords.push(acceptedProcessingRecord(firstC.binding.submission_id, nodeIdC, firstC.binding.recovery_seed));
    await ctxC.runtime.recover('p1');
    oldCreateC.reject(new ApiError(500, '服务内部错误', 500)); // 旧失败迟到
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
    expect(ctx.nodes.get(nodeId)?.data).toMatchObject({ jobId: '901', genStatus: 'generating' }); // 受理回填任务身份
    expect(ctx.nodes.get(nodeId)?.data.generationRecovery).toBeUndefined(); // 受理前不伪造恢复标记（B.3）
    expect(ctx.edges().filter((edge) => edge.target === nodeId)).toHaveLength(2); // 来源线保留
    expect(ctx.runtime.statusOf(nodeId)).toMatchObject({ phase: 'generating', jobId: '901', submissionId: first.binding.submission_id });
    expect(ctx.fetchJobStatus.mock.calls.filter(([jobId]) => String(jobId) === '901')).toHaveLength(1); // 轮询启动
    expect(ctx.mix.getSnapshot().state).toBeNull(); // 交接：发送即退出
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
    expect(ctx.nodes.has(nodeId)).toBe(false); // 未受理失败：撤回本次临时占位
    expect(ctx.edges().filter((edge) => edge.target === nodeId)).toHaveLength(0); // 本次来源线一并撤回
    expect(ctx.runtime.statusOf(nodeId)).toBeNull();
    expect(ctx.inFlight()).toBe(false); // 锁释放
    expect(ctx.errors).toHaveLength(1); // 创建失败提示归会话（留在面板重发）

    // 同载荷重发：沿用同一占位卡身份与提交身份（未受理窗口内幂等重发）
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
