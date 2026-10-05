import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canvasBindingSchema } from '@lib/contracts/canvas-recovery';
import { ApiError } from '@/api/http';
import {
  retryAudioMix, retryAudioVideoMux, type JobDetail,
} from '@/api/jobs';
import type { GenerationRecoveryRecord } from '@/api/canvasRecovery';
import { createGenerationRuntime } from './runtime';
import { audioMixTask, audioVideoMuxTask } from './mixMuxTasks';
import type { GenerationRuntimeHost, RuntimeNodeView } from './types';

vi.mock('@/api/jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/jobs')>(),
  createAudioMix: vi.fn(),
  retryAudioMix: vi.fn(),
  createAudioVideoMux: vi.fn(),
  retryAudioVideoMux: vi.fn(),
  cancelGenerationJob: vi.fn(),
}));

const NODE_ID = 'audio-mix-501';
const MUX_NODE_ID = 'mux-node-601';
const SID_A = '12345678-0000-4000-8000-000000000001';
const SID_M = '12345678-0000-4000-8000-00000000000a';
const SID_B = '12345678-0000-4000-8000-000000000002';
const SID_C = '12345678-0000-4000-8000-000000000003';
const MIX_SEED = { role: 'result-placeholder' as const, x: 5, y: 6, width: 320, height: 320, name: '混合结果.mp3' };
const MUX_SEED = { role: 'draft' as const, x: 15, y: 16, width: 320, height: 320, name: '合成结果.mp4' };
const flush = async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); };
const conflict = (revision: number) => new ApiError(409, '归属已变化', 409, {
  reason: 'canvas_binding_conflict', currentBindingRevision: revision,
});
const bindingView = (submissionId: string, nodeId: string, jobId: string, revision: number) => ({
  protocol_version: 1 as const, submission_id: submissionId, target_node_id: nodeId,
  binding_revision: revision, job_id: jobId, is_current: true,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const mixRecord = (revision = 1): GenerationRecoveryRecord => ({
  submission_id: SID_A, target_node_id: NODE_ID, job_id: '501', task_type: 'audio_mix',
  binding_revision: revision, is_current: true,
  job: { job_id: '501', type: 'audio_mix', status: 'failed', progress: 0, output_asset_ids: [], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
  recovery_seed: { target: MIX_SEED, sources: [] }, previous_target_snapshot: null,
  items: [{ recovery_item_id: `gcr:${SID_A}:$target`, output_key: '$target', node_id: NODE_ID,
    state: 'pending', revision: 1, node_binding_revision: revision, asset_id: null, slot_id: null }],
});

const muxRecord = (revision = 1): GenerationRecoveryRecord => ({
  submission_id: SID_M, target_node_id: MUX_NODE_ID, job_id: '601', task_type: 'audio_video_mux',
  binding_revision: revision, is_current: true,
  job: { job_id: '601', type: 'audio_video_mux', status: 'failed', progress: 0, output_asset_ids: [], stored_error: null, created_at: '2026-10-01T00:00:00Z' },
  recovery_seed: { target: MUX_SEED, sources: [] }, previous_target_snapshot: null,
  items: [{ recovery_item_id: `gcr:${SID_M}:$target`, output_key: '$target', node_id: MUX_NODE_ID,
    state: 'pending', revision: 1, node_binding_revision: revision, asset_id: null, slot_id: null }],
});

/** 已确认接缝（同 ikjnvp/ikjlxd）：公开运行时 + 实际任务定义；API、时钟、画布宿主受控。 */
function setup(revision = 1) {
  const nodes = new Map<string, RuntimeNodeView>([
    [NODE_ID, { id: NODE_ID, type: 'mediaNode', position: { x: 5, y: 6 },
      data: { jobId: '501', mediaType: 'audio', genStatus: 'failed', fileName: '用户改名.mp3',
        generationRecovery: { protocolVersion: 1, submissionId: SID_A, outputKey: '$target' } } }],
    [MUX_NODE_ID, { id: MUX_NODE_ID, type: 'mediaNode', position: { x: 15, y: 16 },
      data: { jobId: '601', mediaType: 'video', genStatus: 'failed', fileName: '合成草稿.mp4',
        audioVideoMux: { sourceNodeId: 'audio-source-1', sourceAssetId: '111', reserveAudio: true, sync: 'none' },
        generationRecovery: { protocolVersion: 1, submissionId: SID_M, outputKey: '$target' } } }],
  ]);
  const owners = new Map<string, string>();
  const removed = new Set<string>();
  const authResume: Array<() => void> = [];
  let epoch = {};
  const host: GenerationRuntimeHost = {
    getProjectId: () => '1', getLoadEpoch: () => epoch,
    getMediaNodes: () => [...nodes.values()], findNode: (id) => nodes.get(id) ?? null,
    patchNode: (id, patch) => { const node = nodes.get(id); if (node) nodes.set(id, { ...node, data: { ...node.data, ...patch } }); },
    insertMediaNode: (node) => { nodes.set(node.id, node); }, removeMediaNode: (id) => { nodes.delete(id); },
    getEdges: () => [], addEdge: () => {},
    getActiveJob: (id) => owners.get(id), setActiveJob: (id, token) => { owners.set(id, token); }, clearActiveJob: (id) => { owners.delete(id); },
    isLocallyRemoved: (id) => removed.has(id), markLocallyRemoved: (id) => { removed.add(id); },
    registerPendingDelete: () => {}, isPendingDelete: () => false,
    applyTerminal: (id, _jobId, detail) => { host.patchNode(id, { genStatus: detail.status }); return 'terminal'; },
    settleCancelled: () => {}, saveCanvas: async () => true,
    fetchRecoveryPage: async () => ({ protocol_version: 1, canvas_version: 3, records: [mixRecord(revision), muxRecord(revision)], next_cursor: null }),
    toast: () => {}, openRechargeForCreditsError: () => false,
    addAuthResume: (resume) => { authResume.push(resume); }, rememberAsset: () => {},
  };
  const fetchJobStatus = vi.fn(async (jobId: string | number): Promise<JobDetail> => ({ job_id: String(jobId), status: 'processing', progress: 1, asset: null }));
  let nextId = SID_B;
  const runtime = createGenerationRuntime(host, { fetchJobStatus, newId: () => nextId, setTimeout: () => 1, clearTimeout: () => {} });
  runtime.register(audioMixTask);
  runtime.register(audioVideoMuxTask);
  return {
    runtime, host, nodes, owners, authResume, fetchJobStatus,
    reload: () => { epoch = {}; },
    nextSubmission: () => { nextId = SID_C; },
    retryCall: (index: number) => {
      const [projectId, jobId, key, , binding] = vi.mocked(retryAudioMix).mock.calls[index]!;
      return { projectId, jobId, key, binding: canvasBindingSchema.parse(binding) };
    },
    muxRetryCall: (index: number) => {
      const [projectId, jobId, key, , binding] = vi.mocked(retryAudioVideoMux).mock.calls[index]!;
      return { projectId, jobId, key, binding: canvasBindingSchema.parse(binding) };
    },
  };
}

beforeEach(() => { vi.resetAllMocks(); });

describe('专属重试归属冲突的意图治理（IKJP8A）', () => {
  it('已确认版本 1 的重试遭遇 409：不自动重发，失败卡与原输入保留，版本前进到服务端值', async () => {
    const ctx = setup();
    await ctx.runtime.recover('1');
    vi.mocked(retryAudioMix).mockRejectedValueOnce(conflict(3));
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    expect(vi.mocked(retryAudioMix).mock.calls).toHaveLength(1); // 未经用户复核不自动重发
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
    const ctx = setup();
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
    expect(call.key).toBe(call.binding.submission_id); // 幂等键 = submission_id（新意图身份）
    expect(vi.mocked(retryAudioMix).mock.calls).toHaveLength(2);
    expect(ctx.nodes.get(NODE_ID)?.data).toMatchObject({ jobId: '501', genStatus: 'generating' });
    expect(ctx.runtime.statusOf(NODE_ID)).toMatchObject({ phase: 'generating', jobId: '501', submissionId: SID_C });
    expect(ctx.runtime.bindingRevisionOf(NODE_ID)).toBe(4);
  });

  it('结果未知的网络失败重试：同意图重放保留原 submission_id 与完整绑定，幂等受理不形成重复任务', async () => {
    const ctx = setup();
    await ctx.runtime.recover('1');
    vi.mocked(retryAudioMix).mockRejectedValueOnce(new Error('网络超时，结果未知'));
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    expect(ctx.nodes.get(NODE_ID)?.data).toMatchObject({ genStatus: 'failed', errorText: '重试失败' });
    vi.mocked(retryAudioMix).mockResolvedValueOnce({
      job_id: '501', status: 'queued', replayed: true, // 服务端按幂等键重放同一任务
      canvas_binding: bindingView(SID_B, NODE_ID, '501', 2),
    });
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    await flush();
    const first = ctx.retryCall(0);
    const replay = ctx.retryCall(1);
    expect(replay.key).toBe(SID_B); // 同一意图：不换 submission_id
    expect(replay.binding).toEqual(first.binding); // 完整绑定载荷原样重放
    expect(vi.mocked(retryAudioMix).mock.calls).toHaveLength(2);
    expect(ctx.runtime.statusOf(NODE_ID)).toMatchObject({ phase: 'generating', jobId: '501', submissionId: SID_B });
  });

  it('较旧合法 409 反馈不回退已确认版本', async () => {
    const ctx = setup(4);
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
    const ctx = setup();
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
    const ctx = setup();
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
    const ctx = setup();
    await ctx.runtime.recover('1');
    const pending = deferred<Awaited<ReturnType<typeof retryAudioMix>>>();
    vi.mocked(retryAudioMix).mockImplementation(() => pending.promise);
    expect(ctx.runtime.retry(NODE_ID)).toBe(true);
    expect(ctx.runtime.retry(NODE_ID)).toBe(true); // 防重吞下连点
    await flush();
    expect(vi.mocked(retryAudioMix).mock.calls).toHaveLength(1);
  });

  it('401 接续保留：失败卡无错误文案，续跑回调按同一意图重发', async () => {
    const ctx = setup();
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
