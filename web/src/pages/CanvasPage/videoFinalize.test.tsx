// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import { ApiError } from '@/api/http';
import CanvasPage from './index';

/* IKIZQE 成片按钮与关联结果卡（页面流）：
   单一入口（仅样片卡标题行注入 finalizeCta）、点击前预计积分、直接提交无二次确认、
   提交中禁用 + 邻近关联成片卡、并发点击至多一次提交、过期/缺截止禁用、空报价禁用、
   失败呈现（不提供同 Draft ID 重试）、状态核对中禁点、两卡关系与 final 阶段轮询承接。
   FlowCanvas/CanvasToolbar/CanvasHeader 打桩透出 props；API 层全 mock。 */

vi.mock('@/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));

vi.mock('@/api/canvasRecovery', async (importActual) => ({
  ...(await importActual<typeof import('@/api/canvasRecovery')>()),
  generationRecoveryPageOptions: vi.fn(() => ({
    queryKey: ['generation-recovery', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ records: [], next_cursor: null, protocol_version: 1, canvas_version: null }),
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
  // IKIZQG：过期样片/失败成片入口会请求重新生成报价（本文件不覆盖重生成流，恒空报价禁用入口）
  quoteSampleRegenerate: vi.fn(async () => ({ credits: null, quote_revision: null })),
  regenerateSampleJob: vi.fn(),
  readJobFailText: apiMocks.readJobFailText,
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

const FUTURE = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

/** 默认画布：成功样片卡 s1（videoStage=sample + jobId + 未来截止）+ 普通视频卡 v1 */
function seedDoc(opts?: { deadline?: string | null }) {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
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
            finalizeDeadlineAt: opts?.deadline === undefined ? FUTURE : opts.deadline,
            width: 854,
            height: 480,
            duration: 5,
          },
        },
        {
          id: 'v1',
          type: 'mediaNode',
          position: { x: 700, y: 100 },
          data: { src: 'http://vid/plain.mp4', mediaType: 'video', fileName: '普通视频', assetId: 'a3' },
        },
      ],
      edges: [],
    },
    assets: {
      as1: { asset_id: 1, type: 'video', access_url: 'http://vid/sample.mp4', width: 854, height: 480 },
      a3: { asset_id: 3, type: 'video', access_url: 'http://vid/plain.mp4', width: 100, height: 100 },
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

function sampleNode(): Node {
  return mediaNodes().find((n) => n.id === 's1')!;
}

function nodeData(id: string): Record<string, unknown> {
  return (mediaNodes().find((n) => n.id === id)?.data ?? {}) as Record<string, unknown>;
}

function finalNodeOf(sampleJobId = '9001'): Node | undefined {
  return mediaNodes().find(
    (n) => n.data?.videoStage === 'final' && String(n.data?.sourceSampleJobId ?? '') === sampleJobId,
  );
}

/** 等样片卡注入指定 phase 的成片按钮，并返回当时的注入态 */
async function waitForCta(phase: string) {
  await vi.waitFor(() => {
    expect((nodeData('s1').finalizeCta as { phase?: string } | undefined)?.phase).toBe(phase);
  });
  return nodeData('s1').finalizeCta as { phase: string; credits?: number };
}

async function clickFinalize() {
  const fn = nodeData('s1').onFinalizeSample as (id: string) => void;
  await act(async () => { fn('s1'); });
}

function defaultFinalDetail(overrides: Record<string, unknown> = {}) {
  return {
    job_id: '9002',
    status: 'succeeded',
    progress: 100,
    asset: { id: 'af1', url: 'http://vid/final.mp4', type: 'video', width: 1920, height: 1080, duration: 5 },
    video_stage: 'final',
    source_sample_job_id: '9001',
    charge_state: 'settled',
    actual_credits: 80,
    ...overrides,
  };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiMocks.quoteVideoFinalize.mockImplementation(async () => ({ credits: 80, quote_revision: 'rev-1' }));
  apiMocks.finalizeVideoJob.mockImplementation(async () => ({ generation_job_id: '9002', cursor: 7 }));
  apiMocks.fetchJobStatus.mockImplementation(async () => defaultFinalDetail());
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('IKIZQE 成片按钮（页面流）', () => {
  it('成功样片卡：报价就绪后标题行唯一入口展示预计积分；普通视频卡不注入', async () => {
    await renderPage();
    const cta = await waitForCta('ready');
    expect(cta.credits).toBe(80);
    expect(apiMocks.quoteVideoFinalize).toHaveBeenCalledTimes(1);
    expect(apiMocks.quoteVideoFinalize).toHaveBeenCalledWith('p1', '9001', { silent: true });
    // 单一入口：普通视频卡/无 jobId 卡不注入 finalizeCta
    const v1 = mediaNodes().find((n) => n.id === 'v1')!;
    expect(v1.data?.finalizeCta).toBeUndefined();
    const injected = mediaNodes().filter((n) => n.data?.finalizeCta != null);
    expect(injected.map((n) => n.id)).toEqual(['s1']);
  });

  it('点击直接提交（无二次确认）：载荷仅确认两字段 + Idempotency-Key，邻近落位关联成片卡，提交中按钮禁用', async () => {
    let resolveFinalize: (value: { generation_job_id: string; cursor: number }) => void = () => {};
    apiMocks.finalizeVideoJob.mockImplementation(
      () => new Promise((resolve) => { resolveFinalize = resolve; }),
    );
    await renderPage();
    await waitForCta('ready');
    await clickFinalize();

    // 提交中：CTA 已派生为 running（生成中，禁用），成片占位卡已在样片卡右侧邻近落位并带两卡关系
    await vi.waitFor(() => expect(finalNodeOf()).toBeTruthy());
    expect((nodeData('s1').finalizeCta as { phase?: string } | undefined)?.phase).toBe('running');
    const finalNode = finalNodeOf()!;
    expect(finalNode.data?.videoStage).toBe('final');
    expect(finalNode.data?.sourceSampleJobId).toBe('9001');
    expect(finalNode.data?.genStatus).toBe('generating');
    expect(finalNode.data?.jobId).toBeUndefined(); // 受理回填前无 jobId
    expect(finalNode.position.x).toBeGreaterThan(sampleNode().position.x);
    expect(finalNode.position.y).toBe(sampleNode().position.y);

    expect(apiMocks.finalizeVideoJob).toHaveBeenCalledTimes(1);
    const [projectId, jobId, payload, key] = apiMocks.finalizeVideoJob.mock.calls[0]!;
    expect(projectId).toBe('p1');
    expect(jobId).toBe('9001');
    expect(payload).toEqual({ expected_credits: 80, quote_revision: 'rev-1' });
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);

    // 受理：回填 jobId 并启动轮询，终态承接 final 阶段投影
    await act(async () => { resolveFinalize({ generation_job_id: '9002', cursor: 7 }); });
    await vi.waitFor(() => expect(finalNodeOf()!.data?.src).toBe('http://vid/final.mp4'));
    const done = finalNodeOf()!;
    expect(done.data?.genStatus).toBeUndefined();
    expect(done.data?.assetId).toBe('af1');
    expect(done.data?.videoStage).toBe('final');
    expect(done.data?.sourceSampleJobId).toBe('9001');
    expect(done.data?.chargeState).toBe('settled');
    expect(done.data?.actualCredits).toBe(80);
    expect(done.data?.jobId).toBe('9002');
    // 成片已存在：样片卡不再渲染成片入口（首版一张样片至多一条成片）
    await vi.waitFor(() => expect(sampleNode().data?.finalizeCta).toBeUndefined());
  });

  it('并发点击：至多一次提交（第二次同步忽略）', async () => {
    let resolveFinalize: (value: { generation_job_id: string; cursor: number }) => void = () => {};
    apiMocks.finalizeVideoJob.mockImplementation(
      () => new Promise((resolve) => { resolveFinalize = resolve; }),
    );
    await renderPage();
    await waitForCta('ready');
    await act(async () => {
      const fn = nodeData('s1').onFinalizeSample as (id: string) => void;
      fn('s1');
      fn('s1');
      fn('s1');
    });
    expect(apiMocks.finalizeVideoJob).toHaveBeenCalledTimes(1);
    await act(async () => { resolveFinalize({ generation_job_id: '9002', cursor: 7 }); });
    await vi.waitFor(() => expect(finalNodeOf()!.data?.jobId).toBe('9002'));
  });

  it('过期样片：finalizeCta 派生 expired（IKJ7UI：按钮整钮不渲染）且不请求报价；缺可信截止时间（null）同口径', async () => {
    seedDoc({ deadline: PAST });
    await renderPage();
    await waitForCta('expired');
    expect(apiMocks.quoteVideoFinalize).not.toHaveBeenCalled();
    // 点击派发被页面守卫拦下（无报价不提交）
    await clickFinalize();
    expect(apiMocks.finalizeVideoJob).not.toHaveBeenCalled();

    if (root) await act(async () => root.unmount());
    seedDoc({ deadline: null });
    await renderPage();
    await waitForCta('expired');
    expect(apiMocks.quoteVideoFinalize).not.toHaveBeenCalled();
  });

  it('空报价（双 null）：CTA 禁用（unavailable），不提交', async () => {
    apiMocks.quoteVideoFinalize.mockImplementation(async () => ({ credits: null, quote_revision: null }));
    await renderPage();
    await waitForCta('unavailable');
    await clickFinalize();
    expect(apiMocks.finalizeVideoJob).not.toHaveBeenCalled();
  });

  it('1056 变价：占位卡撤回、重报价后新价可见（再由用户点击确认）', async () => {
    apiMocks.finalizeVideoJob.mockRejectedValueOnce(new ApiError(200, '价格已更新，请刷新后重新确认提交', 1056));
    await renderPage();
    await waitForCta('ready');
    await clickFinalize();
    // 占位卡已撤回，报价重取
    await vi.waitFor(() => expect(finalNodeOf()).toBeUndefined());
    await waitForCta('ready');
    expect(apiMocks.quoteVideoFinalize).toHaveBeenCalledTimes(2);
  });

  it('提交结果不明（传输失败）：同幂等键原样重发一次；仍失败 → 状态核对中且禁止再次点击、占位卡撤回', async () => {
    const networkError = new ApiError(0, '网络请求失败，请检查网络后重试', 0);
    apiMocks.finalizeVideoJob.mockRejectedValue(networkError);
    await renderPage();
    await waitForCta('ready');
    await clickFinalize();
    await vi.waitFor(() => expect(apiMocks.finalizeVideoJob).toHaveBeenCalledTimes(2));
    // 两次调用复用同一把幂等键（一次用户意图一把：响应丢失原样重发 → 服务端重放）
    expect(apiMocks.finalizeVideoJob.mock.calls[0]![3]).toBe(apiMocks.finalizeVideoJob.mock.calls[1]![3]);
    await vi.waitFor(() => expect(finalNodeOf()).toBeUndefined());
    await waitForCta('checking');
    // 核对中禁止再次点击：页面守卫直接忽略
    await clickFinalize();
    expect(apiMocks.finalizeVideoJob).toHaveBeenCalledTimes(2);
  });

  it('轮询 checking：成片卡「状态核对中」，样片 CTA 同步禁点；核对成功后恢复生成', async () => {
    apiMocks.fetchJobStatus.mockImplementation(async () => defaultFinalDetail({ status: 'checking', charge_state: 'held', actual_credits: null, asset: null }));
    await renderPage();
    await waitForCta('ready');
    await clickFinalize();
    await vi.waitFor(() => expect(finalNodeOf()!.data?.genStatus).toBe('checking'));
    await waitForCta('checking');
    // 核对中禁止再次点击
    await clickFinalize();
    expect(apiMocks.finalizeVideoJob).toHaveBeenCalledTimes(1);

    // 核对成功：任务恢复，终态照常收敛（轮询 2.5s 一拍，等待需盖过下一拍）
    apiMocks.fetchJobStatus.mockImplementation(async () => defaultFinalDetail());
    await vi.waitFor(() => expect(finalNodeOf()!.data?.src).toBe('http://vid/final.mp4'), { timeout: 5000 });
    await vi.waitFor(() => expect(sampleNode().data?.finalizeCta).toBeUndefined());
  });

  it('成片失败：失败原因 + 退费状态投影回填，不提供同 Draft ID 重试；样片不再渲染成片入口', async () => {
    apiMocks.fetchJobStatus.mockImplementation(async () => defaultFinalDetail({
      status: 'failed',
      progress: 0,
      asset: null,
      error: { code: 1050, msg: '上游生成失败' },
      charge_state: 'released',
      actual_credits: null,
    }));
    await renderPage();
    await waitForCta('ready');
    await clickFinalize();
    const failed = finalNodeOf()!;
    await vi.waitFor(() => expect(failed.data?.genStatus).toBe('failed'));
    expect(failed.data?.errorText).toBe('上游生成失败');
    expect(failed.data?.chargeState).toBe('released');
    expect(failed.data?.videoStage).toBe('final');
    // 失败终态后样片卡不再渲染成片入口（同 Draft ID 重试首版关闭，重新生成归 IKIZQG；
    // 失败卡不渲染重试钮的行为由 MediaNode 组件测试覆盖）
    await vi.waitFor(() => expect(sampleNode().data?.finalizeCta).toBeUndefined());
  });
});
