// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import { ApiError } from '@/api/http';
import CanvasPage from './index';

/* IKIZQG 重新生成与卡片整理（页面流）：
   成片失败卡失败区入口（经 sourceSampleJobId 用原输入新建样片；IKJ7UI 起改形为同款
   「重试」按钮，过期样片卡标题行入口已随 ADR-0119 移除）、报价门控 + 提交前新样片费用、
   提交创建新卡不覆盖旧结果、两卡独立删除（不取消任务、不影响另一卡）、失败卡保留原因
   与费用状态。
   FlowCanvas/CanvasToolbar/CanvasHeader 打桩透出 props；API 层全 mock。 */

vi.mock('@/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));
vi.mock('./characterLibraryDeposit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./characterLibraryDeposit')>()),
  depositCanvasAssetToCharacterLibrary: vi.fn(async () => ({ materialId: 'asset-compliance-test' })),
}));

vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/Canvas', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

const toolbarProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/CanvasToolbar', () => ({
  default: (props: Record<string, any>) => {
    toolbarProps.current = props;
    return createElement('div', { 'data-testid': 'canvas-toolbar' });
  },
}));

const headerProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/CanvasHeader', () => ({
  default: (props: Record<string, any>) => {
    headerProps.current = props;
    return createElement('div', { 'data-testid': 'canvas-header' });
  },
}));

vi.mock('./components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

vi.mock('@/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchMe: vi.fn(async () => null),
  fetchCredits: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  applyPromptPreview: vi.fn(),
  referencePromptPlan: vi.fn(),
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => Promise.resolve({ items: [] }), retry: false }),
  saveCanvasDoc: vi.fn(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  createGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  quoteVideoFinalize: vi.fn(),
  finalizeVideoJob: vi.fn(),
  quoteSampleRegenerate: vi.fn(),
  regenerateSampleJob: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async () => []),
}));

vi.mock('@/api/projects', () => ({
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
}));

vi.mock('@/api/auth', () => ({
  fetchMe: apiMocks.fetchMe,
  fetchCredits: apiMocks.fetchCredits,
  toSessionUser: apiMocks.toSessionUser,
}));

vi.mock('@/api/assets', () => ({
  UPLOAD_SIZE_LIMIT: 100 * 1024 * 1024,
  fetchUploadPresign: vi.fn(),
  putToPresignedUrl: vi.fn(),
  completeUpload: vi.fn(),
  fetchAllAssets: vi.fn(async () => []),
  fetchAssetDetail: vi.fn(),
  linkAssetToProject: vi.fn(),
}));

vi.mock('@/api/canvas', () => ({
  applyPromptPreview: apiMocks.applyPromptPreview,
  referencePromptPlan: apiMocks.referencePromptPlan,
  listLegacyCardHistory: apiMocks.listLegacyCardHistory,
  createConversationQuote: apiMocks.createConversationQuote,
  legacyCardHistoryOptions: apiMocks.legacyCardHistoryOptions,
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn(
    (edges: Array<{ id: string; source: string; target: string; data?: unknown }>) =>
      JSON.stringify(edges.map((e) => ({ id: e.id, source: e.source, target: e.target, data: e.data }))),
  ),
}));

vi.mock('@/api/jobs', () => ({
  createGenerationJob: apiMocks.createGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  quoteVideoFinalize: apiMocks.quoteVideoFinalize,
  finalizeVideoJob: apiMocks.finalizeVideoJob,
  quoteSampleRegenerate: apiMocks.quoteSampleRegenerate,
  regenerateSampleJob: apiMocks.regenerateSampleJob,
  readJobFailText: apiMocks.readJobFailText,
}));

// IKJJR6：重生样片经运行时携 canvas_binding 受理——恢复扫描/保护性保存 mock 掉
//（空恢复页 + 保存回执），页面流断言不依赖恢复网络。
vi.mock('@/api/canvasRecovery', () => ({
  fetchGenerationRecoveryPage: vi.fn(async () => ({ protocol_version: 1, canvas_version: null, records: [], next_cursor: null })),
  resolveGenerationRecovery: vi.fn(async () => ({ protocol_version: 1, records: [] })),
  putCanvasDocWithRecovery: vi.fn(async () => ({
    project_id: '11',
    version: 5,
    recoveryReceipt: { commandId: 'cmd-test', replayed: false, changes: [] },
  })),
  generationRecoveryPageOptions: vi.fn(() => ({
    queryKey: ['generation-recovery', 'mock'],
    queryFn: async () => ({ protocol_version: 1, canvas_version: null, records: [], next_cursor: null }),
  })),
}));

vi.mock('@/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));

vi.mock('@/api/generation', () => ({
  fetchGenerationModels: apiMocks.fetchGenerationModels,
}));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));

vi.mock('./hooks/useCanvasDoc', () => ({
  useCanvasDoc: () => canvasDocMock.current,
}));

vi.mock('@/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    queryFn: async () => ({ credits: null }),
  })),
}));

const FUTURE = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

/** 默认画布：样片卡 s1（videoStage=sample + jobId '9001'）+ 可选成片卡 f1。
 *  sampleDeadline 控制过期态；finalFailed 时 f1 为失败卡（保留原因与退费状态）。 */
function seedDoc(opts?: { sampleDeadline?: string | null; final?: 'succeeded' | 'failed' }) {
  const nodes: Array<Record<string, unknown>> = [
    {
      id: 's1',
      type: 'mediaNode',
      position: { x: 100, y: 100 },
      data: {
        src: 'http://vid/sample.mp4',
        mediaType: 'video',
        fileName: '样片',
        assetId: 'as1',
        jobId: '9001',
        videoStage: 'sample',
        finalizeDeadlineAt: opts?.sampleDeadline === undefined ? FUTURE : opts.sampleDeadline,
        width: 854,
        height: 480,
        duration: 5,
      },
    },
  ];
  if (opts?.final === 'failed') {
    nodes.push({
      id: 'f1',
      type: 'mediaNode',
      position: { x: 1014, y: 100 },
      data: {
        src: '',
        mediaType: 'video',
        fileName: '成片',
        jobId: '9002',
        videoStage: 'final',
        sourceSampleJobId: '9001',
        genStatus: 'failed',
        errorText: '上游成片失败',
        chargeState: 'released',
      },
    });
  } else if (opts?.final === 'succeeded') {
    nodes.push({
      id: 'f1',
      type: 'mediaNode',
      position: { x: 1014, y: 100 },
      data: {
        src: 'http://vid/final.mp4',
        mediaType: 'video',
        fileName: '成片',
        assetId: 'af1',
        jobId: '9002',
        videoStage: 'final',
        sourceSampleJobId: '9001',
      },
    });
  }
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes,
      edges: [],
    },
    assets: {
      as1: { asset_id: 1, type: 'video', access_url: 'http://vid/sample.mp4', width: 854, height: 480 },
    },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

let root: Root;
let container: HTMLDivElement;

async function renderPage() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(MemoryRouter, null, createElement(CanvasPage)),
      ),
    );
  });
}

function mediaNodes(): Node[] {
  return flowProps.current.mediaNodes ?? [];
}

function nodeOf(id: string): Node | undefined {
  return mediaNodes().find((n) => n.id === id);
}

function nodeData(id: string): Record<string, unknown> {
  return (nodeOf(id)?.data ?? {}) as Record<string, unknown>;
}

/** 重新生成受理后新建的样片占位/结果卡（非 s1 的 sample 卡） */
function regenNodeOf(): Node | undefined {
  return mediaNodes().find((n) => n.id !== 's1' && n.data?.videoStage === 'sample');
}

/** 等指定卡注入指定 phase 的重新生成入口，返回当时的注入态 */
async function waitForRegenCta(nodeId: string, phase: string) {
  await vi.waitFor(() => {
    expect((nodeData(nodeId).regenerateCta as { phase?: string } | undefined)?.phase).toBe(phase);
  });
  return nodeData(nodeId).regenerateCta as { phase: string; credits?: number };
}

async function clickRegenerate(nodeId: string) {
  const fn = nodeData(nodeId).onRegenerateSample as (id: string) => void;
  await act(async () => { fn(nodeId); });
}

function defaultRegenSampleDetail(overrides: Record<string, unknown> = {}) {
  return {
    job_id: '9100',
    status: 'succeeded',
    progress: 100,
    asset: { id: 'as9', url: 'http://vid/sample-new.mp4', type: 'video', width: 854, height: 480, duration: 5 },
    video_stage: 'sample',
    finalize_deadline_at: FUTURE,
    charge_state: 'settled',
    actual_credits: 40,
    ...overrides,
  };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiMocks.quoteVideoFinalize.mockImplementation(async () => ({ credits: 80, quote_revision: 'rev-f1' }));
  apiMocks.finalizeVideoJob.mockImplementation(async () => ({ generation_job_id: '9002', cursor: 7 }));
  apiMocks.quoteSampleRegenerate.mockImplementation(async () => ({ credits: 40, quote_revision: 'rev-r1' }));
  apiMocks.regenerateSampleJob.mockImplementation(async () => ({ generation_job_id: '9100', cursor: 8 }));
  apiMocks.fetchJobStatus.mockImplementation(async () => defaultRegenSampleDetail());
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('IKIZQG 重新生成样片（页面流）', () => {
  it('成片失败卡入口：报价就绪展示新样片费用；点击提交带确认两字段与幂等键，创建新卡不覆盖旧结果', async () => {
    seedDoc({ sampleDeadline: PAST, final: 'failed' });
    let resolveRegen: (value: { generation_job_id: string; cursor: number }) => void = () => {};
    apiMocks.regenerateSampleJob.mockImplementation(
      () => new Promise((resolve) => { resolveRegen = resolve; }),
    );
    await renderPage();
    const cta = await waitForRegenCta('f1', 'ready');
    expect(cta.credits).toBe(40);
    expect(apiMocks.quoteSampleRegenerate).toHaveBeenCalledTimes(1);
    expect(apiMocks.quoteSampleRegenerate).toHaveBeenCalledWith('p1', '9001', { silent: true });

    await clickRegenerate('f1');
    expect(apiMocks.regenerateSampleJob).toHaveBeenCalledTimes(1);
    const [projectId, jobId, payload, key] = apiMocks.regenerateSampleJob.mock.calls[0]!;
    expect(projectId).toBe('p1');
    expect(jobId).toBe('9001');
    // IKJJR6：经运行时受理——业务载荷仍仅确认两字段，另携 canvas_binding（新样片独立承接目标），
    // Idempotency-Key = canvas_binding.submission_id（同意图重放复用同一身份）
    expect(payload).toMatchObject({ expected_credits: 40, quote_revision: 'rev-r1' });
    expect(payload.canvas_binding).toMatchObject({ protocol_version: 1, target_node_id: expect.any(String), expected_binding_revision: 0 });
    expect(payload.canvas_binding.submission_id).toBe(key);
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);

    // 新建样片占位卡：生成中、样片身份、落在入口失败卡正下方；旧卡（含过期样片与失败成片）
    // 身份/素材/截止原样保留（不覆盖旧结果）
    await vi.waitFor(() => expect(regenNodeOf()).toBeTruthy());
    const regen = regenNodeOf()!;
    expect(regen.data?.videoStage).toBe('sample');
    expect(regen.data?.genStatus).toBe('generating');
    expect(regen.position.y).toBeGreaterThan(nodeOf('f1')!.position.y);
    expect(regen.position.x).toBe(nodeOf('f1')!.position.x);
    const oldSample = nodeOf('s1')!;
    expect(oldSample.data?.src).toBe('http://vid/sample.mp4');
    expect(oldSample.data?.assetId).toBe('as1');
    expect(oldSample.data?.jobId).toBe('9001');
    expect(oldSample.data?.videoStage).toBe('sample');
    const failedFinal = nodeOf('f1')!;
    expect(failedFinal.data?.genStatus).toBe('failed');
    expect(failedFinal.data?.chargeState).toBe('released');

    // 受理 + 轮询成功：新卡回填自有素材与自身截止（新样片有自己的期限），旧卡仍在
    await act(async () => { resolveRegen({ generation_job_id: '9100', cursor: 8 }); });
    await vi.waitFor(() => expect(regenNodeOf()!.data?.src).toBe('http://vid/sample-new.mp4'));
    const done = regenNodeOf()!;
    expect(done.data?.jobId).toBe('9100');
    expect(done.data?.finalizeDeadlineAt).toBe(FUTURE);
    expect(nodeOf('s1')!.data?.src).toBe('http://vid/sample.mp4');
    // 本会话已受理过：成片失败卡不再渲染重新生成入口（新样片卡有自己的成片入口）
    await vi.waitFor(() => expect(nodeOf('f1')!.data?.regenerateCta).toBeUndefined());
  });

  it('成片失败卡：失败区入口经来源关系提交原样片任务；失败卡与费用状态保留', async () => {
    seedDoc({ final: 'failed' });
    await renderPage();
    await waitForRegenCta('f1', 'ready');
    await clickRegenerate('f1');
    expect(apiMocks.quoteSampleRegenerate).toHaveBeenCalledWith('p1', '9001', { silent: true });
    const [projectId, jobId, payload] = apiMocks.regenerateSampleJob.mock.calls[0]!;
    expect(projectId).toBe('p1');
    expect(jobId).toBe('9001');
    expect(payload).toMatchObject({ expected_credits: 40, quote_revision: 'rev-r1', canvas_binding: { protocol_version: 1 } });

    await vi.waitFor(() => expect(regenNodeOf()).toBeTruthy());
    const regen = regenNodeOf()!;
    expect(regen.data?.videoStage).toBe('sample');
    // 失败卡保留：原因、费用状态、两卡关系原样（提交不写旧卡）
    const failed = nodeOf('f1')!;
    expect(failed).toBeTruthy();
    expect(failed.data?.genStatus).toBe('failed');
    expect(failed.data?.errorText).toBe('上游成片失败');
    expect(failed.data?.chargeState).toBe('released');
    expect(failed.data?.videoStage).toBe('final');
    expect(failed.data?.sourceSampleJobId).toBe('9001');
  });

  it('空报价（双 null）：入口禁用（unavailable），不提交', async () => {
    seedDoc({ final: 'failed' });
    apiMocks.quoteSampleRegenerate.mockImplementation(async () => ({ credits: null, quote_revision: null }));
    await renderPage();
    await waitForRegenCta('f1', 'unavailable');
    await clickRegenerate('f1');
    expect(apiMocks.regenerateSampleJob).not.toHaveBeenCalled();
  });

  it('缺输入阻断：无来源样片关系的成片失败卡不渲染入口（原输入不可信还原 → 保留失败卡，不猜参数提交）', async () => {
    seedDoc({ final: 'failed' });
    // 抹掉 sourceSampleJobId：入口身份解析失败 → 无 CTA、不问价、不提交
    const base = canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> };
    base.nodes = base.nodes.map((n) =>
      n.id === 'f1' ? { ...n, data: { ...(n.data as Record<string, unknown>), sourceSampleJobId: undefined } } : n,
    );
    await renderPage();
    await act(async () => {});
    expect(nodeData('f1').regenerateCta).toBeUndefined();
    expect(nodeData('f1').onRegenerateSample).toBeUndefined();
    expect(apiMocks.quoteSampleRegenerate).not.toHaveBeenCalled();
    // 失败卡原样保留（不因缺入口被改写）
    expect(nodeData('f1')).toMatchObject({ videoStage: 'final', genStatus: 'failed', chargeState: 'released' });
  });

  it('并发点击：至多一次提交（第二次同步忽略）', async () => {
    seedDoc({ final: 'failed' });
    await renderPage();
    await waitForRegenCta('f1', 'ready');
    const send = nodeData('f1').onRegenerateSample as (id: string) => void;
    await act(async () => {
      send('f1');
      send('f1');
      send('f1');
    });
    expect(apiMocks.regenerateSampleJob).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(regenNodeOf()!.data?.jobId).toBe('9100'));
  });

  it('1056 变价：占位卡撤回、重报价后新价可见；新报价新签名换新幂等键（不撞同键变价 100409）', async () => {
    seedDoc({ final: 'failed' });
    apiMocks.regenerateSampleJob.mockRejectedValueOnce(new ApiError(200, '价格已更新，请刷新后重新确认提交', 1056));
    // 首次报价 rev-r1；1056 后重报价返回 rev-r2（变价）
    apiMocks.quoteSampleRegenerate
      .mockImplementationOnce(async () => ({ credits: 40, quote_revision: 'rev-r1' }))
      .mockImplementationOnce(async () => ({ credits: 45, quote_revision: 'rev-r2' }));
    await renderPage();
    await waitForRegenCta('f1', 'ready');
    await clickRegenerate('f1');
    await vi.waitFor(() => expect(regenNodeOf()).toBeUndefined());
    // 报价重取：新价可见后再由用户点击确认（不按未确认金额自动重提）
    const cta = await waitForRegenCta('f1', 'ready');
    expect(cta.credits).toBe(45);
    expect(apiMocks.quoteSampleRegenerate).toHaveBeenCalledTimes(2);
    await clickRegenerate('f1');
    expect(apiMocks.regenerateSampleJob).toHaveBeenCalledTimes(2);
    const [ , , payload2, key2] = apiMocks.regenerateSampleJob.mock.calls[1]!;
    expect(payload2).toMatchObject({ expected_credits: 45, quote_revision: 'rev-r2', canvas_binding: { protocol_version: 1 } });
    expect(key2).not.toBe(apiMocks.regenerateSampleJob.mock.calls[0]![3]);
  });

  it('传输结果不明：同幂等键原样重发一次；仍失败 → 状态核对中且禁止再次点击、占位卡撤回', async () => {
    seedDoc({ final: 'failed' });
    const networkError = new ApiError(0, '网络请求失败，请检查网络后重试', 0);
    apiMocks.regenerateSampleJob.mockRejectedValue(networkError);
    await renderPage();
    await waitForRegenCta('f1', 'ready');
    await clickRegenerate('f1');
    await vi.waitFor(() => expect(apiMocks.regenerateSampleJob).toHaveBeenCalledTimes(2));
    expect(apiMocks.regenerateSampleJob.mock.calls[0]![3]).toBe(apiMocks.regenerateSampleJob.mock.calls[1]![3]);
    await vi.waitFor(() => expect(regenNodeOf()).toBeUndefined());
    await waitForRegenCta('f1', 'checking');
    await clickRegenerate('f1');
    expect(apiMocks.regenerateSampleJob).toHaveBeenCalledTimes(2);
  });
});

describe('IKIZQG 两卡独立删除（页面流）', () => {
  it('删除样片卡：另一阶段成片卡保留，不取消任务；删除成片卡：样片卡保留', async () => {
    seedDoc({ final: 'failed' });
    await renderPage();
    // 删样片卡：f1 保留，无取消调用（删卡不取消任务）
    await act(async () => { (nodeData('s1').onDelete as (id: string) => void)('s1'); });
    expect(nodeOf('s1')).toBeUndefined();
    expect(nodeOf('f1')).toBeTruthy();
    expect(nodeOf('f1')!.data?.videoStage).toBe('final');
    expect(apiMocks.cancelGenerationJob).not.toHaveBeenCalled();

    // 删成片卡：同样不取消任务（样片卡上一段已删，独立删除互不影响由下一用例反向覆盖）
    await act(async () => { (nodeData('f1').onDelete as (id: string) => void)('f1'); });
    expect(nodeOf('f1')).toBeUndefined();
    expect(apiMocks.cancelGenerationJob).not.toHaveBeenCalled();
  });

  it('删除成片卡（样片在场）：样片卡及其素材、截止与任务身份原样保留', async () => {
    seedDoc({ final: 'succeeded' });
    await renderPage();
    await act(async () => { (nodeData('f1').onDelete as (id: string) => void)('f1'); });
    expect(nodeOf('f1')).toBeUndefined();
    const sample = nodeOf('s1')!;
    expect(sample.data?.src).toBe('http://vid/sample.mp4');
    expect(sample.data?.assetId).toBe('as1');
    expect(sample.data?.jobId).toBe('9001');
    expect(sample.data?.videoStage).toBe('sample');
    expect(sample.data?.finalizeDeadlineAt).toBe(FUTURE);
    expect(apiMocks.cancelGenerationJob).not.toHaveBeenCalled();
  });
});
