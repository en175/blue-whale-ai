/* ============================================
 * 保护失效预保存续链与会话交接（IKJP8B，PR981-REVIEW5-20261005）。
 * 接缝（已确认）：真实工具会话运行时（toolSessionRuntime）+ 实际音视频合成/音频混合
 * 会话定义（compoundToolSessions）+ 实际任务定义（mixMuxTasks）+ 公开生成运行时
 * （runtime）；API、画布宿主受控（vi.mock @/api/jobs + 假 GenerationRuntimeHost）。
 * 会话宿主的 createTask/handoff 复刻 CanvasPage 页面桥（watchMixSubmit + runtime.submit）。
 * 公开运行时通知隔离的纯 watcher 对照见 ikjnvp.test.ts「旧混合创建受理/失败迟到」——
 * 那是通知层对照；本文件用真实会话在途锁守卫整链，不与之互相替代。
 * ============================================ */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import { cancelGenerationJob, createAudioMix, createAudioVideoMux, type JobDetail } from '@/api/jobs';
import { createGenerationRuntime } from './runtime';
import { audioMixTask, audioVideoMuxTask, watchMixSubmit } from './mixMuxTasks';
import { seedSourcesOfNode, seedTargetOfNode } from './seedFacts';
import {
  createAudioMixSession, createAudioVideoMuxSession,
  type AudioMixHost, type AudioVideoMuxHost,
} from '../compoundToolSessions';
import { createToolSessionRuntime } from '../toolSessionRuntime';
import type { ToolSessionDeps } from '../toolSessionCoordinator';
import { buildAudioVideoMuxIdentity } from '../audioVideoMux';
import type { GenerationRuntimeHost, RuntimeNodeView } from './types';

vi.mock('@/api/jobs', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/jobs')>(),
  createAudioMix: vi.fn(),
  createAudioVideoMux: vi.fn(),
  retryAudioMix: vi.fn(),
  retryAudioVideoMux: vi.fn(),
  cancelGenerationJob: vi.fn(),
}));

const DEPS: ToolSessionDeps = { dismissGenPanels() {}, selectNode() {} };
const MUX_ID = 'm1';
const flush = async (rounds = 30) => { for (let i = 0; i < rounds; i += 1) await Promise.resolve(); };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
type Deferred<T> = ReturnType<typeof deferred<T>>;

const bindingView = (submissionId: string, nodeId: string, jobId: string, revision = 1, isCurrent = true) => ({
  protocol_version: 1 as const, submission_id: submissionId, target_node_id: nodeId,
  binding_revision: revision, job_id: jobId, is_current: isCurrent,
});
type MuxCreateResult = Awaited<ReturnType<typeof createAudioVideoMux>>;
type MixCreateResult = Awaited<ReturnType<typeof createAudioMix>>;
/** mux 创建端点类型未声明新协议 canvas_binding 回执（运行时已按可选字段读取）——测试按运行时事实拓宽。 */
const muxCreated = (jobId: string, view: ReturnType<typeof bindingView>): MuxCreateResult =>
  ({ job_id: jobId, status: 'queued', canvas_binding: view }) as unknown as MuxCreateResult;
const mixCreated = (jobId: string, view: ReturnType<typeof bindingView>): MixCreateResult =>
  ({ job_id: jobId, status: 'queued', canvas_binding: view });

const muxDraft = (): Node => ({
  id: MUX_ID, type: 'mediaNode', position: { x: 600, y: 0 },
  data: {
    src: '', fileName: '音视频合成', mediaType: 'video', draft: true, genStatus: 'draft',
    audioVideoMux: {
      ...buildAudioVideoMuxIdentity('audio', '8'),
      video: { assetId: '5', nodeId: 'video', name: '城市夜景.mp4', duration: 30, width: 1280, height: 720 },
    },
  },
});

/** 画布 + 双层宿主（生成运行时宿主 + 会话宿主共享同一节点表），桥复刻 CanvasPage。 */
function setup() {
  const nodes = new Map<string, Node>([
    ['audio', { id: 'audio', type: 'mediaNode', position: { x: 0, y: 0 }, data: { mediaType: 'audio', assetId: '8', src: 'https://assets/a.mp3', fileName: '原音频.mp3', width: 320, height: 320 } }],
    ['video', { id: 'video', type: 'mediaNode', position: { x: 300, y: 0 }, data: { mediaType: 'video', assetId: '5', src: 'https://assets/v.mp4', fileName: '城市夜景.mp4', width: 1280, height: 720 } }],
    [MUX_ID, muxDraft()],
  ]);
  let project: string | null = 'p1';
  let epoch = {};
  let inFlight = false;
  let idSeq = 0;
  const owners = new Map<string, string>();
  const removed = new Set<string>();
  const saves: Array<Deferred<boolean>> = [];
  const toasts: string[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const handedOff: string[] = [];
  const patch = (id: string, data: Record<string, unknown>) => {
    const node = nodes.get(id);
    if (node) nodes.set(id, { ...node, data: { ...node.data, ...data } });
  };
  const genHost: GenerationRuntimeHost = {
    getProjectId: () => project, getLoadEpoch: () => epoch,
    getMediaNodes: () => [...nodes.values()] as unknown as RuntimeNodeView[],
    findNode: (id) => (nodes.get(id) as unknown as RuntimeNodeView | undefined) ?? null,
    patchNode: (id, data) => patch(id, data),
    insertMediaNode: (node) => { nodes.set(node.id, node as unknown as Node); },
    removeMediaNode: (id) => { nodes.delete(id); },
    getEdges: () => [], addEdge: () => {},
    getActiveJob: (id) => owners.get(id), setActiveJob: (id, token) => { owners.set(id, token); },
    clearActiveJob: (id) => { owners.delete(id); },
    isLocallyRemoved: (id) => removed.has(id), markLocallyRemoved: (id) => { removed.add(id); },
    registerPendingDelete: () => {}, isPendingDelete: () => false,
    applyTerminal: (id, _jobId, detail) => { patch(id, { genStatus: detail.status }); return 'terminal'; },
    settleCancelled: () => {},
    saveCanvas: async () => { const gate = deferred<boolean>(); saves.push(gate); return gate.promise; },
    fetchRecoveryPage: async () => ({ protocol_version: 1, canvas_version: null, records: [] as never[], next_cursor: null }),
    toast: (kind, message) => { toasts.push(`${kind}:${message}`); },
    openRechargeForCreditsError: () => false, addAuthResume: () => {}, rememberAsset: () => {},
  };
  const fetchJobStatus = vi.fn(async (jobId: string | number): Promise<JobDetail> =>
    ({ job_id: String(jobId), status: 'processing', progress: 1, asset: null }));
  const runtime = createGenerationRuntime(genHost, {
    fetchJobStatus,
    newId: () => `12345678-0000-4000-8000-${String(++idSeq).padStart(12, '0')}`,
    setTimeout: () => 1, clearTimeout: () => {},
  });
  runtime.register(audioVideoMuxTask);
  runtime.register(audioMixTask);

  // 页面桥同款（index.tsx audioVideoMux.createTask/handoff）：watcher 桥 + runtime.submit。
  const muxHost: AudioVideoMuxHost = {
    getProjectId: () => project,
    getNode: (id) => nodes.get(id),
    createDraft: () => { throw new Error('测试不经新建草稿'); },
    patchIdentity: (id, identity) => { patch(id, { audioVideoMux: identity }); },
    removeBindEdges: () => {}, addVideoEdge: () => {},
    isInFlight: () => inFlight, setInFlight: (value) => { inFlight = value; },
    canApply: (projectId) => project === projectId,
    createTask: async ({ payload, draftId }) => {
      const draft = nodes.get(draftId);
      if (!draft) throw new Error('合成草稿卡不在画布上，无法发送');
      return await new Promise<{ job_id: string }>((resolve, reject) => {
        const unwatch = watchMixSubmit(draftId, {
          accepted: (jobId) => { unwatch(); resolve({ job_id: jobId }); },
          failed: (error) => { unwatch(); reject(error); },
        });
        const issued = runtime.submit(audioVideoMuxTask, {
          payload,
          target: {
            targetNodeId: draftId,
            seedTarget: seedTargetOfNode(draft as unknown as RuntimeNodeView),
            seedSources: seedSourcesOfNode(draftId, genHost),
            expectedBindingRevision: runtime.bindingRevisionOf(draftId),
          },
        }, {
          onCreateFailure: () => {
            patch(draftId, { genStatus: 'draft', progress: undefined, errorText: undefined, jobId: undefined, generationRecovery: undefined });
            return true;
          },
          onStale: () => { unwatch(); reject(new Error('画布已重新加载，任务未提交，请重试')); },
        });
        if (!issued) { unwatch(); reject(new Error('音视频合成任务未受理，请重试')); }
      });
    },
    handoff: async ({ draftId }) => {
      if (nodes.has(draftId)) patch(draftId, { genStatus: 'generating', progress: 0, errorText: undefined });
      handedOff.push(draftId);
    },
    warn: (message) => { warnings.push(message); },
    error: (message) => { errors.push(message); },
  };
  const sessionRuntime = createToolSessionRuntime();
  const mux = sessionRuntime.register(createAudioVideoMuxSession(() => muxHost));
  const openMux = () => mux.open({ draftId: MUX_ID }, DEPS);
  return {
    runtime, sessionRuntime, mux, openMux, nodes, saves, toasts, errors, warnings, handedOff,
    patch, fetchJobStatus,
    inFlight: () => inFlight,
    reload: (nextProject: string | null = project) => {
      if (nextProject !== project) sessionRuntime.setProject(nextProject); // 页面切项目推进会话纪元
      project = nextProject;
      epoch = {}; // 页面 doc 更替推进 docLoadEpochRef
      runtime.reset(); // 页面水合更替 runtime.reset()
    },
    markRemoved: (id: string) => { removed.add(id); nodes.delete(id); },
    reopenMux: () => { mux.close(); return mux.open({ draftId: MUX_ID }, DEPS); },
    restoreDraft: () => { nodes.set(MUX_ID, muxDraft()); }, // 水合回来的同 id 草稿
  };
}

beforeEach(() => { vi.resetAllMocks(); });

describe('保护失效预保存续链与会话交接（IKJP8B）', () => {
  it('完整复现链：预保存在途时同项目重新加载，失效链不创建不交接，旧等待 settle 且锁释放，随后新会话正常受理', async () => {
    const ctx = setup();
    expect(ctx.openMux()).toBe(true);
    expect(ctx.mux.send()).toBe(true); // 会话 A：预保存受控暂停
    await flush();
    expect(ctx.saves).toHaveLength(1);
    ctx.reload('p1'); // 同项目重新加载：加载身份推进 + 生成执行重置
    ctx.restoreDraft();
    expect(ctx.reopenMux()).toBe(true); // 会话 B：旧会话关闭重开
    expect(ctx.mux.send()).toBe(false); // B 被真实在途锁挡住（既有正确行为，保持）
    ctx.saves[0]!.resolve(true); // 旧预保存成功返回
    await flush();
    expect(vi.mocked(createAudioVideoMux)).not.toHaveBeenCalled(); // 失效链不创建
    expect(ctx.handedOff).toEqual([]); // 失效链不交接
    expect(ctx.nodes.get(MUX_ID)?.data).toMatchObject({ genStatus: 'draft' }); expect(ctx.nodes.get(MUX_ID)?.data.jobId).toBeUndefined(); // 当前草稿不被改写、无脱节
    expect(ctx.nodes.get(MUX_ID)?.data.audioVideoMux).toEqual(muxDraft().data.audioVideoMux); // 参数与来源身份保留
    expect(ctx.inFlight()).toBe(false); // 旧会话 finally 释放自己的锁
    expect(ctx.errors).toEqual([]); // 失效会话不弹错
    expect(ctx.runtime.statusOf(MUX_ID)).toBeNull(); // 运行时不留脱节在途登记

    // 随后新合法会话可发送并收到自己的成功通知
    vi.mocked(createAudioVideoMux).mockResolvedValueOnce(muxCreated('81', bindingView('sub-new', MUX_ID, '81')));
    expect(ctx.mux.send()).toBe(true);
    await flush();
    ctx.saves[1]!.resolve(true);
    await flush();
    expect(vi.mocked(createAudioVideoMux)).toHaveBeenCalledTimes(1); // 只有 B 的请求
    expect(ctx.nodes.get(MUX_ID)?.data).toMatchObject({ genStatus: 'generating', jobId: '81' });
    expect(ctx.handedOff).toEqual([MUX_ID]);
    expect(ctx.runtime.statusOf(MUX_ID)).toMatchObject({ phase: 'generating', jobId: '81' });
  });

  it('正常对照：当前会话预存成功→创建受理→jobId 回填→交接继续通过', async () => {
    const ctx = setup();
    expect(ctx.openMux()).toBe(true);
    expect(ctx.mux.send()).toBe(true);
    await flush();
    vi.mocked(createAudioVideoMux).mockResolvedValueOnce(muxCreated('79', bindingView('sub-1', MUX_ID, '79')));
    ctx.saves[0]!.resolve(true);
    await flush();
    expect(vi.mocked(createAudioVideoMux)).toHaveBeenCalledTimes(1);
    expect(ctx.nodes.get(MUX_ID)?.data).toMatchObject({ genStatus: 'generating', jobId: '79' }); // progress 随轮询推进，不钉死
    expect(ctx.handedOff).toEqual([MUX_ID]);
    expect(ctx.runtime.statusOf(MUX_ID)).toMatchObject({ phase: 'generating', jobId: '79', submissionId: 'sub-1' });
    expect(ctx.inFlight()).toBe(false);
    expect(ctx.errors).toEqual([]);
  });

  it('保存失败对照：草稿回待生成保留参数与来源，锁释放可再次合法发送', async () => {
    const ctx = setup();
    expect(ctx.openMux()).toBe(true);
    expect(ctx.mux.send()).toBe(true);
    await flush();
    ctx.saves[0]!.resolve(false); // 预保存失败（未失效）
    await flush();
    expect(vi.mocked(createAudioVideoMux)).not.toHaveBeenCalled();
    expect(ctx.nodes.get(MUX_ID)?.data).toMatchObject({ genStatus: 'draft' }); expect(ctx.nodes.get(MUX_ID)?.data.jobId).toBeUndefined();
    expect(ctx.nodes.get(MUX_ID)?.data.audioVideoMux).toEqual(muxDraft().data.audioVideoMux);
    expect(ctx.inFlight()).toBe(false); // 旧等待 settle，锁释放
    expect(ctx.toasts.some((toast) => toast.includes('画布保存失败'))).toBe(true);
    // 可继续合法发送：再次发送走通全链
    vi.mocked(createAudioVideoMux).mockResolvedValueOnce(muxCreated('82', bindingView('sub-2', MUX_ID, '82')));
    expect(ctx.mux.send()).toBe(true);
    await flush();
    ctx.saves[1]!.resolve(true);
    await flush();
    expect(ctx.nodes.get(MUX_ID)?.data).toMatchObject({ genStatus: 'generating', jobId: '82' });
    expect(ctx.handedOff).toEqual([MUX_ID]);
  });

  it('跨项目旧保存返回 false：不创建、旧等待 settle 且不提示新画布', async () => {
    const ctx = setup();
    expect(ctx.openMux()).toBe(true);
    expect(ctx.mux.send()).toBe(true);
    await flush();
    ctx.reload('p2'); // 切项目
    ctx.saves[0]!.resolve(false); // 旧保存对已切换项目返回 false
    await flush();
    expect(vi.mocked(createAudioVideoMux)).not.toHaveBeenCalled();
    expect(ctx.inFlight()).toBe(false);
    expect(ctx.errors).toEqual([]);
  });

  it.each(['同项目重载', '单独 reset', '目标删除'] as const)(
    '预保存成功但执行已失效（%s）：不创建、不交接、旧等待 settle 且锁释放',
    async (window) => {
      const ctx = setup();
      expect(ctx.openMux()).toBe(true);
      expect(ctx.mux.send()).toBe(true);
      await flush();
      if (window === '同项目重载') { ctx.reload('p1'); ctx.restoreDraft(); ctx.reopenMux(); }
      if (window === '单独 reset') ctx.runtime.reset();
      if (window === '目标删除') {
        ctx.markRemoved(MUX_ID); // 删除意图标记 + 草稿移除（owns 删除状态要素）
      }
      ctx.saves[0]!.resolve(true);
      await flush();
      expect(vi.mocked(createAudioVideoMux)).not.toHaveBeenCalled();
      expect(ctx.handedOff).toEqual([]);
      expect(ctx.inFlight()).toBe(false);
      if (window === '同项目重载') {
        expect(ctx.errors).toEqual([]); // 旧会话纪元已失效：不弹错
      } else {
        // 单独 reset / 目标删除：会话纪元未更替，旧等待以失败 settle 并按创建失败提示
        expect(ctx.errors).toEqual(['音视频合成任务创建失败，请重试']);
      }
    },
  );

  it('创建已发出后同项目重载：迟到受理不唤醒旧会话交接，旧等待 settle 锁释放，新会话收到自己的成功', async () => {
    const ctx = setup();
    expect(ctx.openMux()).toBe(true);
    expect(ctx.mux.send()).toBe(true);
    await flush();
    const oldCreate = deferred<MuxCreateResult>();
    vi.mocked(createAudioVideoMux).mockImplementationOnce(() => oldCreate.promise);
    ctx.saves[0]!.resolve(true);
    await flush();
    ctx.reload('p1');
    ctx.restoreDraft();
    expect(ctx.reopenMux()).toBe(true);
    oldCreate.resolve(muxCreated('83', bindingView('sub-old', MUX_ID, '83')));
    await flush();
    expect(ctx.handedOff).toEqual([]); // 迟到受理不交接
    expect(ctx.nodes.get(MUX_ID)?.data).toMatchObject({ genStatus: 'draft' }); expect(ctx.nodes.get(MUX_ID)?.data.jobId).toBeUndefined(); // 不回填、无脱节
    expect(ctx.inFlight()).toBe(false);
    expect(ctx.errors).toEqual([]);
    // 新会话随后发送并收到自己的成功
    vi.mocked(createAudioVideoMux).mockResolvedValueOnce(muxCreated('84', bindingView('sub-b', MUX_ID, '84')));
    expect(ctx.mux.send()).toBe(true);
    await flush();
    ctx.saves[1]!.resolve(true);
    await flush();
    expect(ctx.nodes.get(MUX_ID)?.data).toMatchObject({ genStatus: 'generating', jobId: '84' });
    expect(ctx.runtime.statusOf(MUX_ID)).toMatchObject({ phase: 'generating', jobId: '84', submissionId: 'sub-b' });
  });

  it('替代执行（is_current=false）：旧意图不交接不改写草稿，旧等待 settle，卡片归属归新承接收敛', async () => {
    const ctx = setup();
    expect(ctx.openMux()).toBe(true);
    expect(ctx.mux.send()).toBe(true);
    await flush();
    vi.mocked(createAudioVideoMux).mockResolvedValueOnce(muxCreated('85', bindingView('sub-sup', MUX_ID, '85', 1, false)));
    ctx.saves[0]!.resolve(true);
    await flush();
    expect(ctx.handedOff).toEqual([]); // 不交接
    expect(ctx.nodes.get(MUX_ID)?.data).toMatchObject({ genStatus: 'draft' }); expect(ctx.nodes.get(MUX_ID)?.data.jobId).toBeUndefined(); // 不改写当前草稿、无脱节
    expect(ctx.inFlight()).toBe(false); // 旧等待 settle
    expect(ctx.runtime.statusOf(MUX_ID)).toBeNull(); // 不落台账不双链
  });

  it('已受理任务保留：受理后重载不隐式取消、不自动重发，仍经持久关联恢复续链', async () => {
    const ctx = setup();
    expect(ctx.openMux()).toBe(true);
    expect(ctx.mux.send()).toBe(true);
    await flush();
    vi.mocked(createAudioVideoMux).mockResolvedValueOnce(muxCreated('86', bindingView('sub-kept', MUX_ID, '86')));
    ctx.saves[0]!.resolve(true);
    await flush();
    expect(ctx.nodes.get(MUX_ID)?.data).toMatchObject({ jobId: '86', genStatus: 'generating' });
    // 受理后同项目重载：任务已持久受理，由水合/恢复扫描续链（此处经水合即时续轮询接缝）
    ctx.reload('p1');
    ctx.patch(MUX_ID, { jobId: '86', genStatus: 'generating', generationRecovery: { protocolVersion: 1, submissionId: 'sub-kept', outputKey: '$target' } });
    ctx.runtime.resumeFromHydration(MUX_ID, '86');
    expect(ctx.runtime.statusOf(MUX_ID)).toMatchObject({ phase: 'generating', jobId: '86' });
    expect(vi.mocked(createAudioVideoMux)).toHaveBeenCalledTimes(1); // 不自动重发
    expect(vi.mocked(cancelGenerationJob)).not.toHaveBeenCalled(); // 不隐式取消
  });

  it('普通保存、重渲染与节点移动不误失效当前提交', async () => {
    const ctx = setup();
    expect(ctx.openMux()).toBe(true);
    expect(ctx.mux.send()).toBe(true);
    await flush();
    // 无关节点移动（不推进加载身份、不失效在途提交）
    const moved = ctx.nodes.get('audio')!;
    ctx.nodes.set('audio', { ...moved, position: { x: 999, y: 999 } });
    vi.mocked(createAudioVideoMux).mockResolvedValueOnce(muxCreated('87', bindingView('sub-move', MUX_ID, '87')));
    ctx.saves[0]!.resolve(true); // 预保存完成（普通保存语义：不改变归属判定要素）
    await flush();
    expect(vi.mocked(createAudioVideoMux)).toHaveBeenCalledTimes(1); // 未被误失效
    expect(ctx.nodes.get(MUX_ID)?.data).toMatchObject({ genStatus: 'generating', jobId: '87' });
    expect(ctx.handedOff).toEqual([MUX_ID]);
  });

  it('音频混合同款：创建返回迟到失效，旧等待 settle 锁释放，新会话收到自己的成功', async () => {
    const ctx = setup();
    let mixInFlight = false;
    const mixErrors: string[] = [];
    const mixNodes = new Map<string, Node>([
      ['audio', { id: 'audio', type: 'mediaNode', position: { x: 0, y: 0 }, data: { mediaType: 'audio', assetId: '8', src: 'https://assets/a.mp3', fileName: '原音频.mp3' } }],
    ]);
    const mixHost: AudioMixHost = {
      getProjectId: () => 'p1',
      getNode: (id) => mixNodes.get(id),
      isInFlight: () => mixInFlight, setInFlight: (value) => { mixInFlight = value; },
      canApply: (projectId) => projectId === 'p1',
      linkAssets: async () => {},
      createTask: async ({ payload }) => {
        const nodeId = 'audio-mix-901';
        mixNodes.set(nodeId, { id: nodeId, type: 'mediaNode', position: { x: 600, y: 400 }, data: { src: '', fileName: `混合结果.${payload.output_format}`, mediaType: 'audio', audioMix: { format: payload.output_format } } });
        return await new Promise<{ job_id: string }>((resolve, reject) => {
          const rollback = () => { mixNodes.delete(nodeId); };
          const unwatch = watchMixSubmit(nodeId, {
            accepted: (jobId) => { unwatch(); resolve({ job_id: jobId }); },
            failed: (error) => { unwatch(); reject(error); },
          });
          const issued = ctx.runtime.submit(audioMixTask, {
            payload,
            target: {
              targetNodeId: nodeId,
              seedTarget: { role: 'result-placeholder', x: 600, y: 400, width: 480, height: 284, name: `混合结果.${payload.output_format}` },
              seedSources: [],
              expectedBindingRevision: ctx.runtime.bindingRevisionOf(nodeId),
            },
          }, {
            onCreateFailure: () => { rollback(); return true; },
            onStale: () => { unwatch(); rollback(); reject(new Error('画布已重新加载，任务未提交，请重试')); },
          });
          if (!issued) { unwatch(); rollback(); reject(new Error('音频混合任务未受理，请重试')); }
        });
      },
      handoff: async () => {},
      warn: () => {},
      error: (message) => { mixErrors.push(message); },
    };
    const sessionRuntime = createToolSessionRuntime();
    const mix = sessionRuntime.register(createAudioMixSession(() => mixHost));
    expect(mix.open('audio', DEPS)).toBe(true);
    mix.edit((state) => ({ ...state, selectedInputs: [{ assetId: '9', name: '混合', src: 'https://assets/other.mp3' }] }));
    const oldCreate = deferred<MixCreateResult>();
    vi.mocked(createAudioMix).mockImplementationOnce(() => oldCreate.promise);
    expect(mix.send()).toBe(true); // 会话 A：创建请求发出（result-placeholder 无预保存）
    await flush();
    // 同项目重载：加载身份推进 + 运行时重置；会话 B 重开推进纪元，A 的创建在途
    ctx.reload('p1');
    mix.close();
    expect(mix.open('audio', DEPS)).toBe(true);
    mix.edit((state) => ({ ...state, selectedInputs: [{ assetId: '9', name: '混合', src: 'https://assets/other.mp3' }] }));
    expect(mix.send()).toBe(false); // 在途锁保持
    oldCreate.resolve(mixCreated('91', bindingView('sub-mix-old', 'audio-mix-901', '91')));
    await flush();
    expect(mixInFlight).toBe(false); // 旧等待 settle、锁释放
    expect(mixErrors).toEqual([]); // 失效会话不弹错
    expect(mixNodes.has('audio-mix-901')).toBe(false); // 失败撤回占位（不残留）
    // 新会话可发送并收到自己的成功
    vi.mocked(createAudioMix).mockResolvedValueOnce(mixCreated('92', bindingView('sub-mix-b', 'audio-mix-901', '92')));
    expect(mix.send()).toBe(true);
    await flush();
    expect(vi.mocked(createAudioMix)).toHaveBeenCalledTimes(2);
    expect(mixInFlight).toBe(false); // B 全链完成（resolve → handoff → finally）
  });
});
