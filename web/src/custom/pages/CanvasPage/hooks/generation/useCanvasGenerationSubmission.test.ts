import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { ApiError } from '@/shared/api/http';
import { useAuthStore } from '@/shared/stores/auth';
import {
  useCanvasGenerationSubmission,
  type CanvasGenerationSubmissionHandles,
  type CanvasGenerationSubmissionHost,
} from './useCanvasGenerationSubmission';

vi.mock('@/custom/utils/creditsGate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/custom/utils/creditsGate')>();
  return {
    ...actual,
    blockIfCreditsInsufficient: vi.fn(() => false),
    openRechargeForCreditsError: vi.fn(() => false),
  };
});
const { blockIfCreditsInsufficient, openRechargeForCreditsError } = await import('@/custom/utils/creditsGate');

function mediaNode(id: string, data: Record<string, unknown> = {}): Node {
  return { id, type: 'mediaNode', position: { x: 0, y: 0 }, data };
}

interface RuntimeStub {
  submit: ReturnType<typeof vi.fn>;
  bindingRevisionOf: ReturnType<typeof vi.fn>;
  statusOf: ReturnType<typeof vi.fn>;
  submitCalls: Array<{ payload: Record<string, unknown>; onCreateFailure: (e: unknown) => boolean }>;
  nextResult: boolean;
  nextError: unknown;
}

interface Bag {
  handles: CanvasGenerationSubmissionHandles | null;
  host: CanvasGenerationSubmissionHost;
  runtime: RuntimeStub;
  patches: Array<{ nodeId: string; patch: Record<string, unknown> }>;
  attached: string[];
  addedEdges: Array<{ source: string; target: string }>;
  toasts: Array<{ type: string; msg: string }>;
  nodes: Node[];
}

let bag: Bag;

function makeRuntime(): RuntimeStub {
  const stub: RuntimeStub = {
    submitCalls: [],
    nextResult: true,
    nextError: null,
    submit: vi.fn(
      (
        _task: unknown,
        input: { payload: Record<string, unknown> },
        opts: { onCreateFailure: (e: unknown) => boolean },
      ) => {
        stub.submitCalls.push({ payload: input.payload, onCreateFailure: opts.onCreateFailure });
        if (stub.nextError != null) return opts.onCreateFailure(stub.nextError);
        return stub.nextResult;
      },
    ),
    bindingRevisionOf: vi.fn(() => 1),
    statusOf: vi.fn(() => ({ submissionId: null })),
  };
  return stub;
}

function createBag(nodes: Node[]): Bag {
  const runtime = makeRuntime();
  const next: Bag = {
    handles: null,
    host: null as unknown as CanvasGenerationSubmissionHost,
    runtime,
    patches: [],
    attached: [],
    addedEdges: [],
    toasts: [],
    nodes,
  };
  const mediaNodesRef: CanvasGenerationSubmissionHost['mediaNodesRef'] = { current: nodes };
  next.host = {
    mediaNodesRef,
    locallyRemovedGenerationNodesRef: { current: new Set() },
    pendingDeleteJobNodesRef: { current: new Set() },
    settledExtractNodesRef: { current: new Set() },
    activeJobByNodeRef: { current: new Map() },
    generationRuntimeRef: { current: runtime as never },
    setMediaNodes: ((updater: unknown) => {
      next.nodes = typeof updater === 'function'
        ? (updater as (prev: Node[]) => Node[])(next.nodes)
        : (updater as Node[]);
      mediaNodesRef.current = next.nodes;
      next.host.mediaNodes = next.nodes;
    }) as CanvasGenerationSubmissionHost['setMediaNodes'],
    upsertAssets: () => {},
    patchMediaNode: (nodeId, patch) => { next.patches.push({ nodeId, patch }); },
    removeAudioMixCardNow: () => {},
    showToast: (type, msg) => { next.toasts.push({ type, msg }); },
    edgesRef: { current: [] as Edge[] },
    textNodesRef: { current: [] },
    productNodesRef: { current: [] },
    assetNodesRef: { current: [] },
    currentId: 'project-1',
    attachCallbacks: (n) => { next.attached.push(n.id); return n; },
    addCanvasEdge: (source, target) => { next.addedEdges.push({ source, target }); },
    nodeBoxOf: (n) => ({ x: n.position.x, y: n.position.y, width: 320, height: 340 }),
    flushCanvasSave: async () => true,
    mediaNodes: nodes,
    setEdges: (() => {}) as CanvasGenerationSubmissionHost['setEdges'],
    actionsRef: { current: {
      removeMediaNode: () => {}, cancelJob: () => {}, retryJob: () => {}, fixFollowVideo: () => {},
      duplicate: () => {}, renameCard: () => {}, addToChat: () => {}, download: () => {}, showDetails: () => {},
    } } as CanvasGenerationSubmissionHost['actionsRef'],
    toolMode: 'select',
    blockInvalidDraft: () => false,
    spawnPosition: () => ({ x: 10, y: 20 }),
    textAttachmentsForSend: () => [],
    handleMediaDims: () => {},
    handleSaveMediaToAssets: () => {},
    dockCallbacks: {} as CanvasGenerationSubmissionHost['dockCallbacks'],
  };
  return next;
}

function Probe({ bag: b }: { bag: Bag }) {
  b.handles = useCanvasGenerationSubmission(b.host);
  return null;
}

function mount(nodes: Node[]): void {
  bag = createBag(nodes);
  renderToString(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(Probe, { bag }),
    ),
  );
}

function handles(): CanvasGenerationSubmissionHandles {
  if (!bag.handles) throw new Error('hook 尚未挂载');
  return bag.handles;
}

beforeEach(() => {
  vi.mocked(blockIfCreditsInsufficient).mockReturnValue(false);
  vi.mocked(openRechargeForCreditsError).mockReturnValue(false);
  useAuthStore.setState({ credits: null });
});

describe('regenEntrySampleJobIdOf 重新生成入口身份解析', () => {
  it('成片失败卡从来源样片任务找回入口', async () => {
    await mount([]);
    expect(handles().regenEntrySampleJobIdOf({ videoStage: 'final', genStatus: 'failed', sourceSampleJobId: 42 }))
      .toBe('42');
  });

  it('非失败成片卡无入口', async () => {
    await mount([]);
    expect(handles().regenEntrySampleJobIdOf({ videoStage: 'final', genStatus: 'succeeded', sourceSampleJobId: 42 }))
      .toBeNull();
    expect(handles().regenEntrySampleJobIdOf({ videoStage: 'sample', genStatus: 'failed' })).toBeNull();
  });

  it('缺来源样片任务号时无入口', async () => {
    await mount([]);
    expect(handles().regenEntrySampleJobIdOf({ videoStage: 'final', genStatus: 'failed' })).toBeNull();
  });
});

describe('finalizeCtaByNodeId 成片按钮派生状态', () => {
  it('缺可信截止时间落过期标记', async () => {
    await mount([mediaNode('s1', { videoStage: 'sample', jobId: 1 })]);
    expect(handles().finalizeCtaByNodeId.get('s1')).toEqual({ phase: 'expired' });
  });

  it('成片卡生成中落运行中', async () => {
    await mount([
      mediaNode('s1', { videoStage: 'sample', jobId: 1, finalizeDeadlineAt: '2999-01-01T00:00:00Z' }),
      mediaNode('f1', { videoStage: 'final', sourceSampleJobId: 1, genStatus: 'generating' }),
    ]);
    expect(handles().finalizeCtaByNodeId.get('s1')).toEqual({ phase: 'running' });
  });

  it('成片卡核中对落核对中', async () => {
    await mount([
      mediaNode('s1', { videoStage: 'sample', jobId: 1, finalizeDeadlineAt: '2999-01-01T00:00:00Z' }),
      mediaNode('f1', { videoStage: 'final', sourceSampleJobId: 1, genStatus: 'checking' }),
    ]);
    expect(handles().finalizeCtaByNodeId.get('s1')).toEqual({ phase: 'checking' });
  });

  it('已有成片卡在场时不再渲染入口', async () => {
    await mount([
      mediaNode('s1', { videoStage: 'sample', jobId: 1, finalizeDeadlineAt: '2999-01-01T00:00:00Z' }),
      mediaNode('f1', { videoStage: 'final', sourceSampleJobId: 1 }),
    ]);
    expect(handles().finalizeCtaByNodeId.has('s1')).toBe(false);
  });

  it('报价未就绪时落加载中', async () => {
    await mount([mediaNode('s1', { videoStage: 'sample', jobId: 1, finalizeDeadlineAt: '2999-01-01T00:00:00Z' })]);
    expect(handles().finalizeCtaByNodeId.get('s1')).toEqual({ phase: 'loading' });
  });
});

describe('regenerateCtaByNodeId 重新生成按钮派生状态', () => {
  it('成片失败卡报价未就绪时落加载中', async () => {
    await mount([mediaNode('f1', { videoStage: 'final', genStatus: 'failed', sourceSampleJobId: 9 })]);
    expect(handles().regenerateCtaByNodeId.get('f1')).toEqual({ phase: 'loading' });
  });

  it('无入口身份时不渲染', async () => {
    await mount([mediaNode('f1', { videoStage: 'final', genStatus: 'succeeded', sourceSampleJobId: 9 })]);
    expect(handles().regenerateCtaByNodeId.has('f1')).toBe(false);
  });
});

describe('handleFinalizeSample 提交守卫', () => {
  it('未选中项目时拒绝', async () => {
    await mount([mediaNode('s1', { videoStage: 'sample', jobId: 1 })]);
    bag.host.currentId = '';
    expect(handles().handleFinalizeSample('s1')).toBe(false);
    expect(bag.runtime.submit).not.toHaveBeenCalled();
  });

  it('非成功样片卡拒绝', async () => {
    await mount([mediaNode('s1', { videoStage: 'sample', jobId: 1, genStatus: 'generating' })]);
    expect(handles().handleFinalizeSample('s1')).toBe(false);
  });

  it('报价未就绪时拒绝', async () => {
    await mount([mediaNode('s1', { videoStage: 'sample', jobId: 1, finalizeDeadlineAt: '2999-01-01T00:00:00Z' })]);
    expect(handles().handleFinalizeSample('s1')).toBe(false);
    expect(bag.runtime.submit).not.toHaveBeenCalled();
  });
});

describe('handleRegenerateSample 提交守卫', () => {
  it('未选中项目时拒绝', async () => {
    await mount([mediaNode('f1', { videoStage: 'final', genStatus: 'failed', sourceSampleJobId: 9 })]);
    bag.host.currentId = '';
    expect(handles().handleRegenerateSample('f1')).toBe(false);
    expect(bag.runtime.submit).not.toHaveBeenCalled();
  });

  it('报价未就绪时拒绝', async () => {
    await mount([mediaNode('f1', { videoStage: 'final', genStatus: 'failed', sourceSampleJobId: 9 })]);
    expect(handles().handleRegenerateSample('f1')).toBe(false);
  });
});

describe('startGenerationJob 创建生成任务', () => {
  it('未选中项目时拒绝并告警', async () => {
    await mount([]);
    bag.host.currentId = '';
    expect(handles().startGenerationJob('image', { model_id: 'm', prompt: 'p' })).toBe(false);
    expect(bag.runtime.submit).not.toHaveBeenCalled();
  });

  it('余额不足时拦截且不提交', async () => {
    await mount([]);
    vi.mocked(blockIfCreditsInsufficient).mockReturnValue(true);
    expect(handles().startGenerationJob('image', { model_id: 'm', prompt: 'p' })).toBe(false);
    expect(bag.runtime.submit).not.toHaveBeenCalled();
  });

  it('草稿原位承接：原地转生成中不新建卡', async () => {
    await mount([mediaNode('inplace-1', { draft: true, mediaType: 'video', fileName: '视频草稿' })]);
    expect(handles().startGenerationJob(
      'video',
      { model_id: 'm', prompt: 'p', aspect_ratio: '16:9', duration: 5 },
      undefined,
      undefined,
      'inplace-1',
    )).toBe(true);
    expect(bag.patches.some((p) => p.nodeId === 'inplace-1' && p.patch.genStatus === 'generating')).toBe(true);
    expect(bag.nodes.map((n) => n.id)).toEqual(['inplace-1']);
    expect(bag.runtime.submitCalls[0].payload).toMatchObject({ type: 'video', target_node_id: 'inplace-1' });
  });

  it('新建占位卡并按参考素材建来源边', async () => {
    await mount([]);
    expect(handles().startGenerationJob(
      'video',
      { model_id: 'm', prompt: 'p', aspect_ratio: '16:9', duration: 5 },
      undefined,
      undefined,
      undefined,
      { references: [{ assetId: 'a1', url: 'https://a/1.png', name: '参考', mediaType: 'image', role: 'reference' }] },
    )).toBe(true);
    expect(bag.nodes).toHaveLength(2);
    expect(bag.addedEdges).toHaveLength(1);
    expect(bag.runtime.submitCalls[0].payload).toMatchObject({ type: 'video' });
    expect(bag.runtime.submitCalls[0].payload.target_node_id).toBeUndefined();
  });

  it('创建失败为 401 时保留草稿且不重发', async () => {
    await mount([]);
    bag.runtime.nextError = new ApiError(401, '未登录');
    expect(handles().startGenerationJob('image', { model_id: 'm', prompt: '把猫画成蓝鲸' })).toBe(true);
    expect(bag.nodes).toHaveLength(1);
    expect(bag.nodes[0]?.data).toMatchObject({ prompt: '把猫画成蓝鲸' });
    expect(bag.patches).toContainEqual({
      nodeId: bag.nodes[0]?.id,
      patch: {
        draft: true,
        genStatus: 'draft',
        progress: undefined,
        errorText: undefined,
        fileName: '图片草稿',
      },
    });
  });

  it('创建失败为非鉴权错误时交还运行时收敛', async () => {
    await mount([]);
    bag.runtime.nextError = new ApiError(500, '服务异常');
    expect(handles().startGenerationJob('image', { model_id: 'm', prompt: 'p' })).toBe(false);
    expect(bag.nodes).toHaveLength(1);
  });
});
