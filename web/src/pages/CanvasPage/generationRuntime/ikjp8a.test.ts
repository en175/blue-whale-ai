import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/http';
import { retryAudioMix, retryAudioVideoMux } from '@/api/jobs';
import {
  NODE_ID, MUX_NODE_ID, SID_A, SID_B, SID_C,
  flush, conflict, bindingView, setupRecoveryScenario,
} from './recoveryTestKit';

vi.mock('@/api/jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/jobs')>(),
  createAudioMix: vi.fn(),
  retryAudioMix: vi.fn(),
  createAudioVideoMux: vi.fn(),
  retryAudioVideoMux: vi.fn(),
  cancelGenerationJob: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => { vi.resetAllMocks(); });

describe('专属重试归属冲突的意图治理（IKJP8A）', () => {
  it('已确认版本 1 的重试遭遇 409：不自动重发，失败卡与原输入保留，版本前进到服务端值', async () => {
    const ctx = setupRecoveryScenario();
    await ctx.runtime.recover('1');
    vi.mocked(retryAudioMix).mockRejectedValueOnce(conflict(3));
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    expect(vi.mocked(retryAudioMix).mock.calls).toHaveLength(1);
    expect(ctx.runtime.statusOf(NODE_ID)).toBeNull();
    expect(ctx.runtime.bindingRevisionOf(NODE_ID)).toBe(3);
    expect(ctx.nodes.get(NODE_ID)?.data).toMatchObject({
      jobId: '501', genStatus: 'failed', errorText: '卡片归属已变化，请复核后再发送',
      fileName: '用户改名.mp3',
      generationRecovery: { protocolVersion: 1, submissionId: SID_A, outputKey: '$target' },
    });
    expect(ctx.retryCall(0)).toMatchObject({ key: SID_B, binding: { submission_id: SID_B, expected_binding_revision: 1 } });
  });

  it('复核后再次点击：新 submission_id 且幂等键一致，携带采纳后的版本 3，受理后卡片与运行时身份一致', async () => {
    const ctx = setupRecoveryScenario();
    await ctx.runtime.recover('1');
    vi.mocked(retryAudioMix).mockRejectedValueOnce(conflict(3));
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    ctx.nextSubmission();
    vi.mocked(retryAudioMix).mockResolvedValueOnce({
      job_id: '501', status: 'queued', replayed: false,
      canvas_binding: bindingView(SID_C, NODE_ID, '501', 4),
    });
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    const call = ctx.retryCall(1);
    expect(call).toMatchObject({
      projectId: '1', jobId: '501', key: SID_C,
      binding: { submission_id: SID_C, target_node_id: NODE_ID, expected_binding_revision: 3 },
    });
    expect(call.key).toBe(call.binding.submission_id);
    expect(vi.mocked(retryAudioMix).mock.calls).toHaveLength(2);
    expect(ctx.nodes.get(NODE_ID)?.data).toMatchObject({ jobId: '501', genStatus: 'generating' });
    expect(ctx.runtime.statusOf(NODE_ID)).toMatchObject({ phase: 'generating', jobId: '501', submissionId: SID_C });
    expect(ctx.runtime.bindingRevisionOf(NODE_ID)).toBe(4);
  });

  it('结果未知的网络失败重试：同意图重放保留原 submission_id 与完整绑定，幂等受理不形成重复任务', async () => {
    const ctx = setupRecoveryScenario();
    await ctx.runtime.recover('1');
    vi.mocked(retryAudioMix).mockRejectedValueOnce(new Error('网络超时，结果未知'));
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    expect(ctx.nodes.get(NODE_ID)?.data).toMatchObject({ genStatus: 'failed', errorText: '重试失败' });
    vi.mocked(retryAudioMix).mockResolvedValueOnce({
      job_id: '501', status: 'queued', replayed: true,
      canvas_binding: bindingView(SID_B, NODE_ID, '501', 2),
    });
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    const first = ctx.retryCall(0);
    const replay = ctx.retryCall(1);
    expect(replay.key).toBe(SID_B);
    expect(replay.binding).toEqual(first.binding);
    expect(vi.mocked(retryAudioMix).mock.calls).toHaveLength(2);
    expect(ctx.runtime.statusOf(NODE_ID)).toMatchObject({ phase: 'generating', jobId: '501', submissionId: SID_B });
  });

  it('较旧合法 409 反馈不回退已确认版本', async () => {
    const ctx = setupRecoveryScenario({ revision: 4 });
    await ctx.runtime.recover('1');
    expect(ctx.runtime.bindingRevisionOf(NODE_ID)).toBe(4);
    vi.mocked(retryAudioMix).mockRejectedValueOnce(conflict(3));
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    expect(ctx.runtime.bindingRevisionOf(NODE_ID)).toBe(4);
    ctx.nextSubmission();
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    expect(ctx.retryCall(1)).toMatchObject({ key: SID_C, binding: { submission_id: SID_C, expected_binding_revision: 4 } });
  });

  it.each(['项目切换', '加载身份更替'] as const)('%s 后，旧重试的 409 迟到不写当前卡、不推进版本', async (window) => {
    const ctx = setupRecoveryScenario();
    await ctx.runtime.recover('1');
    const oldRetry = deferred<Awaited<ReturnType<typeof retryAudioMix>>>();
    vi.mocked(retryAudioMix).mockImplementationOnce(() => oldRetry.promise);
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    if (window === '项目切换') ctx.host.getProjectId = () => '2';
    if (window === '加载身份更替') ctx.reload();
    const card = structuredClone(ctx.nodes.get(NODE_ID));
    const owner = ctx.owners.get(NODE_ID);
    const revision = ctx.runtime.bindingRevisionOf(NODE_ID);
    oldRetry.reject(conflict(9));
    await flush();
    expect(ctx.nodes.get(NODE_ID)).toEqual(card);
    expect(ctx.owners.get(NODE_ID)).toBe(owner);
    expect(ctx.runtime.bindingRevisionOf(NODE_ID)).toBe(revision);
  });

  it('音视频合成专属重试同款 409 治理：新 submission_id、携带版本 3，jobId 语义不变', async () => {
    const ctx = setupRecoveryScenario();
    await ctx.runtime.recover('1');
    vi.mocked(retryAudioVideoMux).mockRejectedValueOnce(conflict(3));
    expect(ctx.runtime.retry(MUX_NODE_ID)).toBe(true);
    await flush();
    expect(vi.mocked(retryAudioVideoMux).mock.calls).toHaveLength(1);
    expect(ctx.runtime.bindingRevisionOf(MUX_NODE_ID)).toBe(3);
    expect(ctx.nodes.get(MUX_NODE_ID)?.data).toMatchObject({ jobId: '601', genStatus: 'failed', errorText: '卡片归属已变化，请复核后再发送' });
    ctx.nextSubmission();
    vi.mocked(retryAudioVideoMux).mockResolvedValueOnce({
      job_id: '601', status: 'queued', replayed: false,
      canvas_binding: bindingView(SID_C, MUX_NODE_ID, '601', 4),
    });
    expect(ctx.runtime.retry(MUX_NODE_ID)).toBe(true);
    await flush();
    const call = ctx.muxRetryCall(1);
    expect(call).toMatchObject({ projectId: '1', jobId: '601', key: SID_C, binding: { submission_id: SID_C, expected_binding_revision: 3 } });
    expect(ctx.runtime.statusOf(MUX_NODE_ID)).toMatchObject({ phase: 'generating', jobId: '601', submissionId: SID_C });
  });

  it('重试在途时重复点击不重复发请求', async () => {
    const ctx = setupRecoveryScenario();
    await ctx.runtime.recover('1');
    const pending = deferred<Awaited<ReturnType<typeof retryAudioMix>>>();
    vi.mocked(retryAudioMix).mockImplementation(() => pending.promise);
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    expect(vi.mocked(retryAudioMix).mock.calls).toHaveLength(1);
  });

  it('401 接续保留：失败卡无错误文案，续跑回调按同一意图重发', async () => {
    const ctx = setupRecoveryScenario();
    await ctx.runtime.recover('1');
    vi.mocked(retryAudioMix).mockRejectedValueOnce(new ApiError(401, '未登录', 401));
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    expect(ctx.nodes.get(NODE_ID)?.data).toMatchObject({ genStatus: 'failed', errorText: '' });
    expect(ctx.authResume).toHaveLength(1);
    vi.mocked(retryAudioMix).mockResolvedValueOnce({
      job_id: '501', status: 'queued', replayed: false,
      canvas_binding: bindingView(SID_B, NODE_ID, '501', 2),
    });
    ctx.authResume[0]!();
    await flush();
    expect(ctx.retryCall(1)).toMatchObject({ key: SID_B, binding: { submission_id: SID_B, expected_binding_revision: 1 } });
    expect(ctx.runtime.statusOf(NODE_ID)).toMatchObject({ phase: 'generating', jobId: '501', submissionId: SID_B });
  });
});
