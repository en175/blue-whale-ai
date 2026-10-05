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
import type { Node } from '@xyflow/react';
import { createAudioMix, retryAudioMix, type JobDetail } from '@/api/jobs';
import { audioMixCreateSchema } from '@lib/contracts/audio-mix';
import type { CanvasBinding, GenerationRecoveryRecord } from '@/api/canvasRecovery';
import { createGenerationRuntime } from './runtime';
import { audioMixTask, watchMixSubmit } from './mixMuxTasks';
import { seedSourcesOfNode } from './seedFacts';
import { createAudioMixSession, type AudioMixHost } from '../compoundToolSessions';
import { createToolSessionRuntime } from '../toolSessionRuntime';
import type { ToolSessionDeps } from '../toolSessionCoordinator';
import { buildAudioMixPlaceholderNode, findAudioMixPosition } from '../audioMix';
import type { GenerationRuntimeHost, RuntimeNodeView } from './types';

vi.mock('@/api/jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/jobs')>(),
  createAudioMix: vi.fn(),
  retryAudioMix: vi.fn(),
  cancelGenerationJob: vi.fn(),
}));

const DEPS: ToolSessionDeps = { dismissGenPanels() {}, selectNode() {} };
const flush = async (rounds = 30) => { for (let i = 0; i < rounds; i += 1) await Promise.resolve(); };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const bindingView = (submissionId: string, nodeId: string, jobId: string, revision = 1, isCurrent = true) => ({
  protocol_version: 1 as const, submission_id: submissionId, target_node_id: nodeId,
  binding_revision: revision, job_id: jobId, is_current: isCurrent,
});
type MixCreateResult = Awaited<ReturnType<typeof createAudioMix>>;
const mixCreated = (jobId: string, view: ReturnType<typeof bindingView>): MixCreateResult =>
  ({ job_id: jobId, status: 'queued', canvas_binding: view });

/** 受理回执前的真实请求读取：真实 Schema 校验 + 幂等键 = submission_id 口径核对。 */
const createRequest = (index: number) => {
  const [projectId, body, options] = vi.mocked(createAudioMix).mock.calls[index]!;
  const parsed = audioMixCreateSchema.parse(body);
  const binding = parsed.canvas_binding!;
  expect(options?.idempotencyKey).toBe(binding.submission_id);
  return { projectId, payload: parsed, binding };
};

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

type FakeEdge = { id: string; source: string; target: string; data?: Record<string, unknown> };

/** 画布 + 双层宿主（生成运行时宿主 + 会话宿主共享节点/连线表），桥复刻 CanvasPage（同 ikjpm4）。 */
function setup() {
  const nodes = new Map<string, Node>([
    ['audio-a', {
      id: 'audio-a', type: 'mediaNode', position: { x: 0, y: 0 },
      data: { mediaType: 'audio', assetId: '11', src: 'https://assets/a.mp3', fileName: '原音频A.mp3' },
    }],
    ['audio-b', {
      id: 'audio-b', type: 'mediaNode', position: { x: 0, y: 400 },
      data: { mediaType: 'audio', assetId: '22', src: 'https://assets/b.mp3', fileName: '原音频B.mp3' },
    }],
  ]);
  let edges: FakeEdge[] = [];
  let project: string | null = 'p1';
  let epoch = {};
  let inFlight = false;
  let idSeq = 0;
  let nodeSeq = 0;
  const owners = new Map<string, string>();
  const removed = new Set<string>();
  const errors: string[] = [];
  const warnings: string[] = [];
  const recoveryRecords: GenerationRecoveryRecord[] = [];
  const patch = (id: string, data: Record<string, unknown>) => {
    const node = nodes.get(id);
    if (node) nodes.set(id, { ...node, data: { ...node.data, ...data } });
  };
  /** 轮询终态经页面共享收敛器落卡（audioMixTerminalPatch 同款失败口径）。 */
  let jobStatusScript: JobDetail = { job_id: '', status: 'processing', progress: 40, asset: null };
  const genHost: GenerationRuntimeHost = {
    getProjectId: () => project, getLoadEpoch: () => epoch,
    getMediaNodes: () => [...nodes.values()] as unknown as RuntimeNodeView[],
    findNode: (id) => (nodes.get(id) as unknown as RuntimeNodeView | undefined) ?? null,
    patchNode: (id, data) => patch(id, data),
    insertMediaNode: (node) => { nodes.set(node.id, node as unknown as Node); },
    removeMediaNode: (id) => { nodes.delete(id); },
    getEdges: () => edges.map((edge) => ({ source: edge.source, target: edge.target })),
    addEdge: (source, target) => { edges = [...edges, { id: `e-${source}-${target}`, source, target }]; },
    getActiveJob: (id) => owners.get(id), setActiveJob: (id, token) => { owners.set(id, token); },
    clearActiveJob: (id) => { owners.delete(id); },
    isLocallyRemoved: (id) => removed.has(id), markLocallyRemoved: (id) => { removed.add(id); },
    registerPendingDelete: () => {}, isPendingDelete: () => false,
    applyTerminal: (id, _jobId, detail) => {
      patch(id, {
        genStatus: detail.status,
        ...(detail.status === 'failed' && detail.error?.msg != null ? { errorText: detail.error.msg } : {}),
      });
      return 'terminal';
    },
    settleCancelled: () => {},
    saveCanvas: async () => true,
    fetchRecoveryPage: async () => ({ protocol_version: 1, canvas_version: 2, records: recoveryRecords, next_cursor: null }),
    toast: () => {},
    openRechargeForCreditsError: () => false, addAuthResume: () => {}, rememberAsset: () => {},
  };
  const fetchJobStatus = vi.fn(async (jobId: string | number): Promise<JobDetail> =>
    ({ ...jobStatusScript, job_id: String(jobId) }));
  const runtime = createGenerationRuntime(genHost, {
    fetchJobStatus,
    newId: () => `12345678-0000-4000-8000-${String(++idSeq).padStart(12, '0')}`,
    setTimeout: () => 1, clearTimeout: () => {},
  });
  runtime.register(audioMixTask);

  // 页面桥同款（index.tsx audioMix.createTask/handoff）：占位卡预建 + 来源线 +
  // watcher 桥 + runtime.submit（同 ikjpm4 先例）。
  const mixHost: AudioMixHost = {
    getProjectId: () => project,
    getNode: (id) => nodes.get(id),
    isInFlight: () => inFlight, setInFlight: (value) => { inFlight = value; },
    canApply: (projectId) => project === projectId,
    linkAssets: async () => {},
    createTask: async ({ payload, source }) => {
      const nodeId = `audio-mix-t${++nodeSeq}`;
      const position = findAudioMixPosition(source, [...nodes.values()]);
      if (!nodes.has(nodeId)) nodes.set(nodeId, buildAudioMixPlaceholderNode(nodeId, payload.output_format, position));
      for (const input of payload.inputs) {
        if (input.node_id && input.node_id !== nodeId && nodes.has(input.node_id)
          && !edges.some((edge) => edge.source === input.node_id && edge.target === nodeId)) {
          edges = [...edges, { id: `e-${input.node_id}-${nodeId}`, source: input.node_id, target: nodeId }];
        }
      }
      return await new Promise<{ job_id: string }>((resolve, reject) => {
        const unwatch = watchMixSubmit(nodeId, {
          accepted: (jobId) => { unwatch(); resolve({ job_id: jobId }); },
          failed: (error) => { unwatch(); reject(error); },
        });
        const issued = runtime.submit(
          audioMixTask,
          {
            payload,
            target: {
              targetNodeId: nodeId,
              seedTarget: {
                role: 'result-placeholder', x: position.x, y: position.y,
                width: 480, height: 284, name: `混合结果.${payload.output_format}`,
              },
              seedSources: seedSourcesOfNode(nodeId, genHost),
              expectedBindingRevision: runtime.bindingRevisionOf(nodeId),
            },
          },
          {
            onCreateFailure: () => true,
            onStale: () => { unwatch(); reject(new Error('画布已重新加载，任务未提交，请重试')); },
          },
        );
        if (!issued) { unwatch(); reject(new Error('音频混合任务未受理，请重试')); }
      });
    },
    handoff: async (_input, _task, context) => { context.exitForSubmission(); },
    warn: (message) => { warnings.push(message); },
    error: (message) => { errors.push(message); },
  };
  const sessionRuntime = createToolSessionRuntime();
  const mix = sessionRuntime.register(createAudioMixSession(() => mixHost));
  const openWithInput = () => {
    expect(mix.open('audio-a', DEPS)).toBe(true);
    mix.edit((state) => ({ ...state, selectedInputs: [{ assetId: '22', nodeId: 'audio-b', name: '原音频B.mp3' }] }));
  };
  return {
    runtime, mix, nodes, errors, warnings, recoveryRecords, fetchJobStatus, openWithInput, mixCreated, bindingView,
    edges: () => edges,
    inFlight: () => inFlight,
    /** 服务端任务状态脚本（轮询与恢复接续读到同一服务端事实）。 */
    setJobStatus: (status: 'processing' | 'failed', progress = 40) => {
      jobStatusScript = {
        job_id: '', status, progress, asset: null,
        ...(status === 'failed' ? { error: { code: 1046, msg: '供应商超时' } } : {}),
      } as JobDetail;
    },
    /** 同项目文档重载：加载身份推进 + 运行时重置；画布内容由水合结果决定。 */
    reload: () => { epoch = {}; runtime.reset(); },
    /** 水合结果无此卡（占位未随保存落盘）：连同其连线一并缺席。 */
    dropFromHydration: (nodeId: string) => {
      nodes.delete(nodeId);
      edges = edges.filter((edge) => edge.target !== nodeId && edge.source !== nodeId);
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(retryAudioMix).mockResolvedValue({ job_id: '901', status: 'queued', replayed: false });
});

describe('接续可靠受理恢复任务（IKJPVK）', () => {
  it('反例一：缺卡的进行中任务在首次公开 recover 内补卡并自动接续轮询（不依赖再次加载或重复扫描）', async () => {
    const ctx = setup();
    const oldCreate = deferred<MixCreateResult>();
    vi.mocked(createAudioMix).mockImplementationOnce(() => oldCreate.promise);
    ctx.openWithInput();
    expect(ctx.mix.send()).toBe(true); // 会话 A：实际请求发出（result-placeholder 无预保存）
    await flush();
    const first = createRequest(0); // 真实 Schema 校验 + 幂等键核对
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
    const first = createRequest(0);
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
    const first = createRequest(0);
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
    const first = createRequest(0);
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
