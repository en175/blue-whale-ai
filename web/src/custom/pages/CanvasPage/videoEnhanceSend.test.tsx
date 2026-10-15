// @vitest-environment jsdom
import { dockActions } from './testing/dockActionsRecorder';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactFlow, ReactFlowProvider, applyNodeChanges, type Node } from '@xyflow/react';
import CanvasPage from './index';
import MediaNode from './components/MediaNode';
import { VIDEO_ENHANCE_EDGE_ORIGIN } from './videoEnhance';
import { toast } from 'sonner';
import type { GenerationModel } from '@/custom/api/generation';
import { silenceApiConsoleInfo } from './testing/silenceApiLogs';
import { installFetchGuard } from './testing/fetchGuard';

silenceApiConsoleInfo();
const fetchGuard = installFetchGuard();

vi.mock('@/custom/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));

vi.mock('@/custom/api/canvasRecovery', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/api/canvasRecovery')>()),
  generationRecoveryPageOptions: vi.fn(() => ({
    queryKey: ['generation-recovery', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ records: [], next_cursor: null, protocol_version: 1, canvas_version: null }),
  })),
  fetchGenerationRecoveryPage: vi.fn(async () => ({
    protocol_version: 1,
    canvas_version: null,
    records: [],
    next_cursor: null,
  })),
}));
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
  Toaster: () => null,
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

vi.mock('./components/CanvasToolbar', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));

vi.mock('./components/CanvasHeader', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));

vi.mock('./components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

vi.mock('@/custom/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/custom/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchMe: vi.fn(async () => null),
  fetchCredits: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  applyPromptPreview: vi.fn(),
  saveCanvasDoc: vi.fn(
    async (): Promise<{ id: number; project_id: number; version: number; viewport: string; nodes: string }> => ({
      id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]',
    }),
  ),
  createGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(),
  cancelGenerationJob: vi.fn(async () => null),
  retryGenerationJob: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  createImageEnhancement: vi.fn(),
  createVideoEnhancement: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
}));

vi.mock('@/custom/api/projects', () => ({
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
}));
vi.mock('@/custom/api/auth', () => ({
  fetchMe: apiMocks.fetchMe,
  fetchCredits: apiMocks.fetchCredits,
  toSessionUser: apiMocks.toSessionUser,
}));
vi.mock('@/custom/api/assets', () => ({
  UPLOAD_SIZE_LIMIT: 100 * 1024 * 1024,
  fetchUploadPresign: vi.fn(),
  putToPresignedUrl: vi.fn(),
  completeUpload: vi.fn(),
  fetchAllAssets: vi.fn(async () => []),
  fetchAssetDetail: vi.fn(),
  linkAssetToProject: vi.fn(),
}));

vi.mock('@/custom/api/canvas', () => ({
  applyPromptPreview: apiMocks.applyPromptPreview,
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({
    queryKey: ['canvas', projectId, 'legacy-history'],
    queryFn: () => Promise.resolve({ items: [] }),
    retry: false,
  }),
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn((edges: Array<{ id: string; source: string; target: string }>) =>
    JSON.stringify(edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))),
  ),
}));
vi.mock('@/custom/api/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/custom/api/jobs')>()),
  fetchJobs: vi.fn(async (): Promise<{ records: never[]; total: number; size: number; current: number }> => ({ records: [], total: 0, size: 20, current: 1 })),
  createGenerationJob: apiMocks.createGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createMediaExtraction: apiMocks.createMediaExtraction,
  createAudioTrim: apiMocks.createAudioTrim,
  createImageEnhancement: apiMocks.createImageEnhancement,
  createVideoEnhancement: apiMocks.createVideoEnhancement,
  readJobFailText: apiMocks.readJobFailText,
}));
vi.mock('@/custom/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/custom/api/generation', () => ({ fetchGenerationModels: apiMocks.fetchGenerationModels }));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('./hooks/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

function finishedHdNode(id: string, assetId: string, width: number, height: number, resolution: string) {
  return {
    id,
    type: 'mediaNode',
    position: { x: 958, y: 0 },
    data: {
      src: `http://vid/${id}.mp4`,
      mediaType: 'video',
      fileName: `生成-88`,
      assetId,
      width,
      height,
      jobId: '88',
      videoEnhance: {
        sourceAssetId: '5',
        lastParams: { resolution },
      },
    },
  };
}

function seedDoc(mode: 'draft' | 'failed' | 'twoFailed' | 'chain' | 'generating' | 'done' = 'draft') {
  const nodes: Array<Record<string, unknown>> = [
    {
      id: 'v1',
      type: 'mediaNode',
      position: { x: 400, y: 0 },
      data: { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '素材视频', assetId: '5', width: 1280, height: 720 },
    },
  ];
  const edges: Array<Record<string, unknown>> = [];
  const assets: Record<string, unknown> = {
    5: { asset_id: 5, type: 'video', access_url: 'http://vid/v1.mp4', width: 1280, height: 720 },
  };
  if (mode === 'failed') {
    const card = finishedHdNode('h1', '9', 3840, 2160, '4k');
    ((card.data as Record<string, unknown>).genStatus) = 'failed';
    ((card.data as Record<string, unknown>).errorText) = '视频画质增强失败，请重试';
    nodes.push(card);
    edges.push({ id: 'e1', source: 'v1', target: 'h1', data: { origin: VIDEO_ENHANCE_EDGE_ORIGIN } });
    assets[9] = { asset_id: 9, type: 'video', access_url: 'http://vid/h1.mp4', width: 3840, height: 2160 };
  }
  if (mode === 'twoFailed') {
    const first = finishedHdNode('h1', '9', 3840, 2160, '4k');
    ((first.data as Record<string, unknown>).genStatus) = 'failed';
    ((first.data as Record<string, unknown>).errorText) = '视频画质增强失败，请重试';
    const second = { ...finishedHdNode('h2', '10', 1920, 1080, '2k'), position: { x: 1516, y: 0 } };
    ((second.data as Record<string, unknown>).genStatus) = 'failed';
    ((second.data as Record<string, unknown>).errorText) = '视频画质增强失败，请重试';
    nodes.push(first, second);
    edges.push({ id: 'e1', source: 'v1', target: 'h1', data: { origin: VIDEO_ENHANCE_EDGE_ORIGIN } });
    edges.push({ id: 'e2', source: 'v1', target: 'h2', data: { origin: VIDEO_ENHANCE_EDGE_ORIGIN } });
    assets[9] = { asset_id: 9, type: 'video', access_url: 'http://vid/h1.mp4', width: 3840, height: 2160 };
    assets[10] = { asset_id: 10, type: 'video', access_url: 'http://vid/h2.mp4', width: 1920, height: 1080 };
  }
  if (mode === 'chain') {
    nodes.push(finishedHdNode('r1080', '9', 1920, 1080, '1080p'));
    nodes.push({ ...finishedHdNode('r4k', '11', 3840, 2160, '4k'), position: { x: 1516, y: 0 } });
    edges.push({ id: 'e1', source: 'v1', target: 'r1080', data: { origin: VIDEO_ENHANCE_EDGE_ORIGIN } });
    edges.push({ id: 'e2', source: 'v1', target: 'r4k', data: { origin: VIDEO_ENHANCE_EDGE_ORIGIN } });
    assets[9] = { asset_id: 9, type: 'video', access_url: 'http://vid/r1080.mp4', width: 1920, height: 1080 };
    assets[11] = { asset_id: 11, type: 'video', access_url: 'http://vid/r4k.mp4', width: 3840, height: 2160 };
  }
  if (mode === 'generating') {
    nodes.push({
      id: 'h1',
      type: 'mediaNode',
      position: { x: 958, y: 0 },
      data: {
        src: '',
        mediaType: 'video',
        fileName: 'HD',
        genStatus: 'generating',
        progress: 0,
        draft: true,
        jobId: 'j9',
        videoEnhance: { sourceAssetId: '5', lastParams: { resolution: '2k' } },
      },
    });
    edges.push({ id: 'e1', source: 'v1', target: 'h1', data: { origin: VIDEO_ENHANCE_EDGE_ORIGIN } });
  }
  if (mode === 'done') {
    nodes.push(finishedHdNode('h1', '9', 1920, 1080, '1080p'));
    edges.push({ id: 'e1', source: 'v1', target: 'h1', data: { origin: VIDEO_ENHANCE_EDGE_ORIGIN } });
    assets[9] = { asset_id: 9, type: 'video', access_url: 'http://vid/h1.mp4', width: 1920, height: 1080 };
  }
  canvasDocMock.current = {
    doc: { id: 11, version: 3, viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges },
    assets,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

let root: Root;
let container: HTMLDivElement;
let cardRoot: Root | null = null;
let cardHost: HTMLDivElement | null = null;

async function renderPage() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(MemoryRouter, null, createElement(CanvasPage)),
      ),
    );
  });
}

async function videoEnhance(id = 'v1') {
  const video = flowProps.current.mediaNodes.find((n: Node) => n.id === id)!;
  await act(async () => {
    video.data.onVideoEnhance(id);
  });
}

const mediaNodes = () => flowProps.current.mediaNodes as Node[];
const mediaNode = (id: string) => mediaNodes().find((n) => n.id === id)!;
const hdDraft = () => mediaNodes().find((n: Node) => n.id !== 'v1' && n.id !== 'r1080' && n.id !== 'r4k');
const panelSend = () => document.body.querySelector<HTMLButtonElement>('[data-testid="video-enhance-send-btn"]');
const panelClose = () => document.body.querySelector<HTMLButtonElement>('[data-testid="video-enhance-close-btn"]');
const panelResolution = (value: string) =>
  document.body.querySelector<HTMLButtonElement>(`[data-testid="video-enhance-resolution-${value}"]`);
const identityOf = (node: Node | undefined) =>
  ((node?.data ?? {}) as Record<string, unknown>).videoEnhance as Record<string, unknown> | undefined;

async function clickPanelResolution(value: string) {
  await act(async () => {
    panelResolution(value)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function sendHd() {
  await act(async () => {
    panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  apiMocks.createVideoEnhancement.mockReset();
});

afterEach(async () => {
  if (cardRoot) await act(async () => cardRoot!.unmount());
  cardHost?.remove();
  cardRoot = null;
  cardHost = null;
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('IKH3VH 发送创建任务闭环', () => {
  it('发送：三键冻结 payload、面板自动关闭、卡原地转生成中、lastParams 写入、jobId 登记并启动轮询、源卡不动', async () => {
    seedDoc();
    apiMocks.createVideoEnhancement.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 20, asset: null });
    await renderPage();
    await videoEnhance();
    const draftId = hdDraft()!.id;

    await clickPanelResolution('2k');
    await sendHd();
    expect(dockActions.submit).toHaveBeenCalledWith('videoEnhance', '2k');

    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledWith('p1', {
      source_asset_id: '5',
      target_node_id: draftId,
      resolution: '2k',
    }, { silent: true, canvasBinding: expect.anything(), idempotencyKey: expect.any(String) });
    expect(panelSend()).toBeNull();
    const data = mediaNode(draftId).data as Record<string, unknown>;
    expect(data.genStatus).toBe('generating');
    expect(data.progress).toBe(20);
    expect(data.jobId).toBe('j1');
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { resolution: '2k' } });
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j1');
    expect(mediaNodes().length).toBe(2);
    expect((mediaNode('v1').data as Record<string, unknown>).src).toBe('http://vid/v1.mp4');
  });

  it('创建失败（网络）：面板保留可重发、卡保持草稿不写 jobId、submitting 复位后发送钮可再点', async () => {
    seedDoc();
    apiMocks.createVideoEnhancement.mockRejectedValue(new Error('network down'));
    await renderPage();
    await videoEnhance();
    const draftId = hdDraft()!.id;

    await sendHd();

    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    expect(panelSend()).toBeTruthy();
    expect(panelSend()!.disabled).toBe(false);
    const data = mediaNode(draftId).data as Record<string, unknown>;
    expect(data.genStatus).toBe('draft');
    expect(data.jobId).toBeUndefined();
    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();
  });

  it('生成中点卡重开面板：参数只读冻结（发送钮禁用）', async () => {
    seedDoc();
    apiMocks.createVideoEnhancement.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 20, asset: null });
    await renderPage();
    await videoEnhance();
    const draftId = hdDraft()!.id;
    await sendHd();
    expect(panelSend()).toBeNull();

    await act(async () => {
      flowProps.current.onNodeClick(mediaNode(draftId));
    });
    expect(panelSend()).toBeTruthy();
    expect(document.body.textContent).toContain('生成中，参数只读');
    expect(panelSend()!.disabled).toBe(true);
  });
});

describe('HD 面板迟到请求与新会话', () => {
  it.each(['success', 'failure'] as const)('关闭同卡重开再提交后，旧%s不回写原卡或续链，新面板与锁保留', async (outcome) => {
    seedDoc();
    let resolveOld!: (value: { job_id: string; status: 'queued' }) => void;
    let rejectOld!: (error: unknown) => void;
    apiMocks.createVideoEnhancement
      .mockImplementationOnce(() => new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }))
      .mockImplementationOnce(() => new Promise(() => {}));
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j-old', status: 'processing', progress: 0, asset: null });
    await renderPage();
    await videoEnhance();
    const draftId = hdDraft()!.id;
    await clickPanelResolution('2k');
    await act(async () => { panelSend()!.click(); });
    await act(async () => { panelClose()!.click(); });
    await act(async () => { flowProps.current.onNodeClick(mediaNode(draftId)); });
    await clickPanelResolution('4k');
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', target_node_id: draftId, resolution: '4k',
    }, expect.objectContaining({ silent: true, canvasBinding: expect.anything(), idempotencyKey: expect.any(String) }));
    await act(async () => {
      if (outcome === 'success') resolveOld({ job_id: 'j-old', status: 'queued' });
      else rejectOld(new Error('old network'));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(panelSend()).not.toBeNull();
    expect(panelSend()!.disabled).toBe(true);
    expect(panelResolution('4k')!.className).toContain('resolutionBtnActive');
    expect(document.body.textContent).not.toContain('HD 高清任务创建失败，请重试');
    if (outcome === 'success') {
      expect(mediaNode(draftId).data.jobId).toBeUndefined();
      expect(mediaNode(draftId).data.genStatus).toBe('draft');
      expect(apiMocks.fetchJobStatus).not.toHaveBeenCalledWith('j-old');
    } else {
      expect(panelSend()!.title).toBe('正在保存并提交，参数只读');
      expect(mediaNode(draftId).data.genStatus).toBe('draft');
    }
    expect(flowProps.current.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'v1', target: draftId, data: { origin: VIDEO_ENHANCE_EDGE_ORIGIN } }),
    ]));
  });

  it('发送在途显式关闭（X）再重开：新会话可再次发送，创建接口再次受理', async () => {
    seedDoc();
    apiMocks.createVideoEnhancement.mockImplementation(() => new Promise(() => {}));
    await renderPage();
    await videoEnhance();
    const draftId = hdDraft()!.id;
    await clickPanelResolution('2k');
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

    await act(async () => { panelClose()!.click(); });
    expect(panelSend()).toBeNull();

    await act(async () => { flowProps.current.onNodeClick(mediaNode(draftId)); });
    expect(panelSend()).toBeTruthy();
    expect(panelSend()!.disabled).toBe(false);
    await act(async () => { panelSend()!.click(); });

    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);
    expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', target_node_id: draftId, resolution: '2k',
    }, expect.objectContaining({ silent: true, canvasBinding: expect.anything(), idempotencyKey: expect.any(String) }));
  });

  it('发送在途选中其它卡再选回本卡：面板重现仍在途只读，同卡不重复受理', async () => {
    seedDoc();
    apiMocks.createVideoEnhancement.mockImplementation(() => new Promise(() => {}));
    await renderPage();
    await videoEnhance();
    const draftId = hdDraft()!.id;
    await clickPanelResolution('2k');
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    await act(async () => { flowProps.current.onSelectionChange({ nodes: [mediaNode('v1')] }); });
    await act(async () => { flowProps.current.onNodeClick(mediaNode(draftId)); });
    expect(panelSend()).toBeTruthy();
    expect(panelSend()!.disabled).toBe(true);
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
  });
});

describe('IKH3VH 轮询终态回填', () => {
  it('succeeded：结果视频回填 HD 卡（src/mediaType/宽高/时长/assetId）、草稿身份结束、源卡不动', async () => {
    seedDoc();
    apiMocks.createVideoEnhancement.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j1', status: 'succeeded', progress: 100,
      asset: { id: 'a88', url: 'http://tos/hd.mp4', type: 'video', width: 2560, height: 1440, duration: 32.5 },
    });
    await renderPage();
    await videoEnhance();
    const draftId = hdDraft()!.id;
    await sendHd();

    const data = mediaNode(draftId).data as Record<string, unknown>;
    expect(data.genStatus).toBeUndefined();
    expect(data.progress).toBe(100);
    expect(data.src).toBe('http://tos/hd.mp4');
    expect(data.mediaType).toBe('video');
    expect(data.assetId).toBe('a88');
    expect(data.width).toBe(2560);
    expect(data.height).toBe(1440);
    expect(data.duration).toBe(32.5);
    expect(data.draft).toBeUndefined();
    expect((mediaNode('v1').data as Record<string, unknown>).src).toBe('http://vid/v1.mp4');
  });

  it('failed：空 msg 走 1045 家族文案映射展示可读原因；onRetryJob 按 lastParams 原样重发（不经通用 retry）并收敛成品', async () => {
    seedDoc();
    apiMocks.createVideoEnhancement
      .mockResolvedValueOnce({ job_id: 'j1', status: 'queued' })
      .mockResolvedValueOnce({ job_id: 'j2', status: 'queued' });
    apiMocks.fetchJobStatus
      .mockResolvedValueOnce({
        job_id: 'j1', status: 'failed', progress: 1,
        error: { code: 'video_enhance_failed', msg: '' },
      })
      .mockResolvedValueOnce({
        job_id: 'j2', status: 'succeeded', progress: 100,
        asset: { id: 'a89', url: 'http://tos/hd2.mp4', type: 'video', width: 2560, height: 1440, duration: 30 },
      });
    await renderPage();
    await videoEnhance();
    await clickPanelResolution('2k');
    await sendHd();
    const draftId = hdDraft()!.id;

    const failed = mediaNode(draftId).data as Record<string, unknown>;
    expect(failed.genStatus).toBe('failed');
    expect(failed.errorText).toBe('视频画质增强失败，请重试');

    await act(async () => {
      (failed.onRetryJob as (id: string) => void)(draftId);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);
    expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5',
      target_node_id: draftId,
      resolution: '2k',
    }, expect.objectContaining({ silent: true }));
    expect(apiMocks.retryGenerationJob).not.toHaveBeenCalled();
    const retried = mediaNode(draftId).data as Record<string, unknown>;
    expect(retried.jobId).toBe('j2');
    expect(retried.genStatus).toBeUndefined();
    expect(retried.src).toBe('http://tos/hd2.mp4');
    expect(retried.width).toBe(2560);
  });
});

describe('IKH3VH 生成中取消', () => {
  it('取消：cancel 接口携带 jobId，权威 cancelled 终态后卡回草稿保留（身份与来源边不丢）', async () => {
    seedDoc();
    apiMocks.createVideoEnhancement.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus
      .mockResolvedValueOnce({ job_id: 'j1', status: 'processing', progress: 20, asset: null })
      .mockResolvedValueOnce({ job_id: 'j1', status: 'cancelled', progress: 0, asset: null });
    await renderPage();
    await videoEnhance();
    const draftId = hdDraft()!.id;
    await sendHd();
    expect((mediaNode(draftId).data as Record<string, unknown>).genStatus).toBe('generating');

    await act(async () => {
      ((mediaNode(draftId).data as Record<string, unknown>).onCancelJob as (id: string) => void)(draftId);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledWith('p1', 'j1');
    expect(mediaNodes().length).toBe(2);
    const data = mediaNode(draftId).data as Record<string, unknown>;
    expect(data.genStatus).toBe('draft');
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { resolution: '1080p' } });
    const edge = (flowProps.current.edges as Array<{ source: string; target: string }>).find((e) => e.target === draftId);
    expect(edge?.source).toBe('v1');
  });
});

describe('IKH3VH 链式联动', () => {
  it('4K 结果卡再点 HD：源输入超上限置灰兜底，不建卡不弹面板', async () => {
    seedDoc('chain');
    await renderPage();
    await act(async () => {
      ((mediaNode('r4k').data as Record<string, unknown>).onVideoEnhance as (id: string) => void)('r4k');
    });
    expect(mediaNodes().length).toBe(3);
    expect(panelSend()).toBeNull();
    expect(apiMocks.createVideoEnhancement).not.toHaveBeenCalled();
  });

  it('1080P 结果卡可再次发起 HD：以结果卡自身为源新建 HD 卡并弹面板（链式）', async () => {
    seedDoc('chain');
    await renderPage();
    await act(async () => {
      ((mediaNode('r1080').data as Record<string, unknown>).onVideoEnhance as (id: string) => void)('r1080');
    });
    expect(mediaNodes().length).toBe(4);
    const chained = mediaNodes().find((n) => n.id !== 'v1' && n.id !== 'r1080' && n.id !== 'r4k')!;
    expect(identityOf(chained)).toEqual({ sourceAssetId: '9' });
    expect(panelSend()).toBeTruthy();
    const edge = (flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>)
      .find((e) => e.target === chained.id)!;
    expect(edge.source).toBe('r1080');
    expect(edge.data).toEqual({ origin: VIDEO_ENHANCE_EDGE_ORIGIN });
  });
});

describe('IKH3VH 持久化恢复', () => {
  it('刷新后生成中 HD 卡水合即恢复轮询，succeeded 收敛成品（宽高/时长/URL 回填）', async () => {
    seedDoc('generating');
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j9', status: 'succeeded', progress: 100,
      asset: { id: 'a90', url: 'http://tos/restored.mp4', type: 'video', width: 2560, height: 1440, duration: 18 },
    });
    await renderPage();

    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j9');
    const data = mediaNode('h1').data as Record<string, unknown>;
    expect(data.genStatus).toBeUndefined();
    expect(data.src).toBe('http://tos/restored.mp4');
    expect(data.width).toBe(2560);
    expect(data.height).toBe(1440);
    expect(data.duration).toBe(18);
    expect(data.draft).toBeUndefined();
  });

  it('刷新后已完成结果卡保持展示且不再轮询', async () => {
    seedDoc('done');
    await renderPage();

    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();
    const data = mediaNode('h1').data as Record<string, unknown>;
    expect(data.src).toBe('http://vid/h1.mp4');
    expect(data.width).toBe(1920);
    expect(data.height).toBe(1080);
    expect(data.jobId).toBe('88');
  });
});

describe('IKJP8Q 失败卡重试与面板发送互斥', () => {
  const pendingCreate = () => new Promise<{ job_id: string; status: 'queued' }>(() => {});

  async function mountCard(id: string) {
    if (cardRoot) { await act(async () => cardRoot!.unmount()); cardRoot = null; }
    cardHost?.remove();
    const node = mediaNode(id);
    cardHost = document.createElement('div');
    cardHost.className = 'react-flow';
    document.body.appendChild(cardHost);
    cardRoot = createRoot(cardHost);
    await act(async () => {
      cardRoot!.render(
        createElement(ReactFlowProvider, null, createElement(MediaNode, {
          ...node, selected: false, dragging: false, zIndex: 1, selectable: true, deletable: true,
          draggable: true, isConnectable: true, positionAbsoluteX: 0, positionAbsoluteY: 0,
        } as never)),
      );
    });
  }

  const retryButton = () =>
    [...(cardHost?.querySelectorAll('button') ?? [])].find((b) => b.textContent === '重试');

  async function clickCardRetry() {
    await act(async () => {
      retryButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  async function openHdPanel(id = 'h1') {
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode(id));
    });
  }

  function setupRealCreateClient() {
    const fetchMock = vi.fn();
    const jsonEnvelope = (code: number, msg: string, status: number, data: unknown = null) =>
      new Response(JSON.stringify({ code, msg, data }), { status, headers: { 'Content-Type': 'application/json' } });
    const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    beforeEach(async () => {
      const actual = await vi.importActual<typeof import('@/custom/api/jobs')>('@/custom/api/jobs');
      apiMocks.createVideoEnhancement.mockImplementation(actual.createVideoEnhancement);
      fetchMock.mockReset();
      fetchMock.mockImplementation(async () => jsonEnvelope(200, 'ok', 200));
      fetchGuard.stub(fetchMock, [['POST', '/api/projects/p1/video-enhancements']]);
    });
    afterEach(() => { fetchGuard.unstubGlobals(); });
    return { fetchMock, jsonEnvelope, settle };
  }

  it('先重试再发送：重试登记后已打开面板立即只读，面板发送不再受理（创建仅一次）', async () => {
    seedDoc('failed');
    apiMocks.createVideoEnhancement.mockImplementation(pendingCreate);
    await renderPage();
    await openHdPanel();
    expect(panelSend()!.disabled).toBe(false);

    await mountCard('h1');
    expect(retryButton()).toBeTruthy();
    await clickCardRetry();
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', target_node_id: 'h1', resolution: '4k',
    }, expect.objectContaining({ silent: true }));
    expect(apiMocks.retryGenerationJob).not.toHaveBeenCalled();

    expect(panelSend()!.disabled).toBe(true);
    expect(panelResolution('4k')!.disabled).toBe(true);
    await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
  });

  it('先发送再重试：面板受理在途后同卡重试被拒（创建仅一次），卡与参数不变、无额外提示', async () => {
    seedDoc('failed');
    apiMocks.createVideoEnhancement.mockImplementation(pendingCreate);
    await renderPage();
    await openHdPanel();
    await clickPanelResolution('2k');
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', target_node_id: 'h1', resolution: '2k',
    }, expect.objectContaining({ silent: true }));

    await mountCard('h1');
    await clickCardRetry();
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    const data = mediaNode('h1').data as Record<string, unknown>;
    expect(data.genStatus).toBe('failed');
    expect(identityOf(mediaNode('h1'))).toEqual({ sourceAssetId: '5', lastParams: { resolution: '2k' } });
    expect(document.body.textContent).not.toContain('HD 高清任务创建失败，请重试');
  });

  it('对照：面板内快速连点发送仍只受理一次（既有防重不削弱）', async () => {
    seedDoc('failed');
    apiMocks.createVideoEnhancement.mockImplementation(pendingCreate);
    await renderPage();
    await openHdPanel();
    await act(async () => {
      panelSend()!.click();
      panelSend()!.click();
    });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
  });

  it('对照：重试在途显式关闭面板重开属新会话，可主动再发送一次（创建共两次）', async () => {
    seedDoc('failed');
    apiMocks.createVideoEnhancement.mockImplementation(pendingCreate);
    await renderPage();
    await openHdPanel();
    await mountCard('h1');
    await clickCardRetry();
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

    await act(async () => { panelClose()!.click(); });
    expect(panelSend()).toBeNull();
    await openHdPanel();
    expect(panelSend()!.disabled).toBe(false);
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);
  });

  it('重试在途点卡冒泡重入当前可见面板：参数与提交中只读保留，不产生新提交机会', async () => {
    seedDoc('failed');
    apiMocks.createVideoEnhancement.mockImplementation(pendingCreate);
    await renderPage();
    await openHdPanel();
    await clickPanelResolution('2k');
    await mountCard('h1');
    await clickCardRetry();
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

    await openHdPanel();
    expect(panelSend()!.disabled).toBe(true);
    expect(panelResolution('2k')!.className).toContain('resolutionBtnActive');
    await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
  });

  it('重试创建失败后同卡限制解除：面板恢复可发送，再次操作正常受理', async () => {
    seedDoc('failed');
    apiMocks.createVideoEnhancement
      .mockRejectedValueOnce(new Error('network down'))
      .mockImplementation(pendingCreate);
    await renderPage();
    await openHdPanel();
    await mountCard('h1');
    await clickCardRetry();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

    expect(panelSend()!.disabled).toBe(false);
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);
    expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', target_node_id: 'h1', resolution: '4k',
    }, expect.objectContaining({ silent: true }));
  });

  it('不同卡互不锁定：h1 重试在途时，源卡新发起的 HD 面板可正常发送', async () => {
    seedDoc('failed');
    apiMocks.createVideoEnhancement.mockImplementation(pendingCreate);
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j2', status: 'processing', progress: 10, asset: null });
    await renderPage();
    await openHdPanel();
    await mountCard('h1');
    await clickCardRetry();
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

    await videoEnhance('v1');
    const draft = mediaNodes().find((n) => n.id !== 'v1' && n.id !== 'h1')!;
    expect(panelSend()!.disabled).toBe(false);
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);
    expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', target_node_id: draft.id, resolution: '1080p',
    }, expect.objectContaining({ silent: true }));
  });

  it('重试在途选中其它卡再选回本卡：面板重现仍在途只读，不重复受理', async () => {
    seedDoc('failed');
    apiMocks.createVideoEnhancement.mockImplementation(pendingCreate);
    await renderPage();
    await openHdPanel();
    await mountCard('h1');
    await clickCardRetry();
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

    await act(async () => { flowProps.current.onSelectionChange({ nodes: [mediaNode('v1')] }); });
    expect(panelSend()).toBeNull();
    await act(async () => { flowProps.current.onSelectionChange({ nodes: [mediaNode('h1')] }); });
    expect(panelSend()!.disabled).toBe(true);
    await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
  });

  it('合法多在途乱序收尾：旧重试失败返回不关闭新面板、不解除新会话锁，新请求仍可落卡', async () => {
    seedDoc('failed');
    let rejectOld!: (error: unknown) => void;
    let resolveNew!: (value: { job_id: string; status: 'queued' }) => void;
    apiMocks.createVideoEnhancement
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j2', status: 'processing', progress: 30, asset: null });
    await renderPage();
    await openHdPanel();
    await mountCard('h1');
    await clickCardRetry();

    await act(async () => { panelClose()!.click(); });
    await openHdPanel();
    await clickPanelResolution('2k');
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);

    await act(async () => {
      rejectOld(new Error('old network'));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(panelSend()).toBeTruthy();
    expect(panelSend()!.disabled).toBe(true);
    expect((mediaNode('h1').data as Record<string, unknown>).genStatus).toBe('failed');

    await mountCard('h1');
    await clickCardRetry();
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveNew({ job_id: 'j2', status: 'queued' });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const data = mediaNode('h1').data as Record<string, unknown>;
    expect(data.genStatus).toBe('generating');
    expect(data.jobId).toBe('j2');
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j2');
  });

  it.each(['success', 'failure'] as const)('新会话发送先失败而旧重试仍等待：面板保持只读不产生 C（共 2 次），旧重试%s收尾后各自释放', async (outcome) => {
    seedDoc('failed');
    let settleOld!: (value: { job_id: string; status: 'queued' }) => void;
    let rejectOld!: (error: unknown) => void;
    let rejectNew!: (error: unknown) => void;
    apiMocks.createVideoEnhancement
      .mockImplementationOnce(() => new Promise((resolve, reject) => { settleOld = resolve; rejectOld = reject; }))
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectNew = reject; }))
      .mockImplementation(pendingCreate);
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j-old', status: 'processing', progress: 10, asset: null });
    await renderPage();
    await openHdPanel();
    await mountCard('h1');
    await clickCardRetry();
    await act(async () => { panelClose()!.click(); });
    await openHdPanel();
    await clickPanelResolution('2k');
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);

    await act(async () => {
      rejectNew(new Error('new network'));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(toast.error).toHaveBeenCalledWith('HD 高清任务创建失败，请重试');
    expect(panelSend()!.disabled).toBe(true);
    expect(panelResolution('2k')!.disabled).toBe(true);
    await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);

    await act(async () => {
      if (outcome === 'success') settleOld({ job_id: 'j-old', status: 'queued' });
      else rejectOld(new Error('old network'));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const data = mediaNode('h1').data as Record<string, unknown>;
    expect(data.genStatus).toBe('failed');
    expect(data.jobId).toBe('88');
    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalledWith('j-old');
    expect(panelSend()!.disabled).toBe(false);
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(3);
  });

  it.each(['success', 'failure'] as const)('旧重试先%s返回而新会话发送仍等待：新会话锁不被旧收尾复位，再点不受理', async (outcome) => {
    seedDoc('failed');
    let settleOld!: (value: { job_id: string; status: 'queued' }) => void;
    let rejectOld!: (error: unknown) => void;
    apiMocks.createVideoEnhancement
      .mockImplementationOnce(() => new Promise((resolve, reject) => { settleOld = resolve; rejectOld = reject; }))
      .mockImplementation(pendingCreate);
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j-old', status: 'processing', progress: 10, asset: null });
    await renderPage();
    await openHdPanel();
    await mountCard('h1');
    await clickCardRetry();
    await act(async () => { panelClose()!.click(); });
    await openHdPanel();
    await clickPanelResolution('2k');
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);

    await act(async () => {
      if (outcome === 'success') settleOld({ job_id: 'j-old', status: 'queued' });
      else rejectOld(new Error('old network'));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(panelSend()!.disabled).toBe(true);
    expect(panelResolution('2k')!.disabled).toBe(true);
    await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);
    const data = mediaNode('h1').data as Record<string, unknown>;
    expect(data.genStatus).toBe('failed');
    expect(data.jobId).toBe('88');
    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalledWith('j-old');
  });

  describe('IKJPM5 选择隐藏返回在途只读', () => {
    async function clickCardBack(id: string, order: 'node-first' | 'selection-first' = 'node-first') {
      const nodeClick = () => flowProps.current.onNodeClick(mediaNode(id));
      const selection = () => flowProps.current.onSelectionChange({ nodes: [mediaNode(id)] });
      const chain = order === 'node-first' ? [nodeClick, selection] : [selection, nodeClick];
      await act(async () => {
        const listener = () => chain.forEach((call) => call());
        cardHost!.addEventListener('click', listener);
        try {
          const cardBody = cardHost!.querySelector('span') ?? cardHost!;
          cardBody.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        } finally {
          cardHost!.removeEventListener('click', listener);
        }
      });
    }

    async function setupRetryHiddenPanel() {
      seedDoc('failed');
      apiMocks.createVideoEnhancement.mockImplementation(pendingCreate);
      await renderPage();
      await openHdPanel();
      await clickPanelResolution('2k');
      await mountCard('h1');
      await clickCardRetry();
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
      await act(async () => { flowProps.current.onSelectionChange({ nodes: [mediaNode('v1')] }); });
      expect(panelSend()).toBeNull();
    }

    it('A 重试等待→点其他卡→真实点原卡返回（节点点击先于选择通知）：仍只读、参数保留，创建总数 1', async () => {
      await setupRetryHiddenPanel();
      await clickCardBack('h1', 'node-first');
      expect(panelSend()!.disabled).toBe(true);
      expect(panelResolution('2k')!.disabled).toBe(true);
      expect(panelResolution('2k')!.className).toContain('resolutionBtnActive');
      await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    });

    it('先选择再显示路径同规则：选择通知先恢复（只读），真实点卡重入不洗锁、不重复受理', async () => {
      await setupRetryHiddenPanel();
      await clickCardBack('h1', 'selection-first');
      expect(panelSend()!.disabled).toBe(true);
      expect(panelResolution('2k')!.disabled).toBe(true);
      await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    });

    it('选择隐藏期间的空选中过渡不当显式关闭：点回原卡仍恢复只读会话，创建总数 1', async () => {
      await setupRetryHiddenPanel();
      await act(async () => { flowProps.current.onSelectionChange({ nodes: [] }); });
      await clickCardBack('h1');
      expect(panelSend()!.disabled).toBe(true);
      expect(panelResolution('2k')!.disabled).toBe(true);
      expect(panelResolution('2k')!.className).toContain('resolutionBtnActive');
      await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    });

    it('A 重试等待→点其他卡→真实点回原卡（resume 恢复同会话）：A 失败提示保留，创建总数 1', async () => {
      seedDoc('failed');
      let rejectA!: (error: unknown) => void;
      apiMocks.createVideoEnhancement.mockImplementationOnce(() => new Promise<never>((_, reject) => { rejectA = reject; }));
      await renderPage();
      await openHdPanel();
      await mountCard('h1');
      await clickCardRetry();
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
      await act(async () => { flowProps.current.onSelectionChange({ nodes: [mediaNode('v1')] }); });
      expect(panelSend()).toBeNull();
      await clickCardBack('h1', 'node-first');

      await act(async () => {
        rejectA(new Error('network down'));
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(toast.error).toHaveBeenCalledWith('HD 高清任务创建失败，请重试');
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
      expect(panelSend()!.disabled).toBe(false);
    });
  });

  it('新会话发送失败而旧重试仍等待时，再次显式关闭重开仍可按新会话例外主动发送', async () => {
    seedDoc('failed');
    apiMocks.createVideoEnhancement
      .mockImplementationOnce(pendingCreate)
      .mockImplementationOnce(() => Promise.reject(new Error('new network')))
      .mockImplementation(pendingCreate);
    await renderPage();
    await openHdPanel();
    await mountCard('h1');
    await clickCardRetry();
    await act(async () => { panelClose()!.click(); });
    await openHdPanel();
    await clickPanelResolution('2k');
    await act(async () => { panelSend()!.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);
    expect(panelSend()!.disabled).toBe(true);

    await act(async () => { panelClose()!.click(); });
    await openHdPanel();
    expect(panelSend()!.disabled).toBe(false);
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(3);
    expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', target_node_id: 'h1', resolution: '2k',
    }, expect.objectContaining({ silent: true }));
  });

  describe('IKJPM7 旧重试失败按有效会话归属（真实创建客户端与 HTTP 链）', () => {
    const { fetchMock, jsonEnvelope, settle } = setupRealCreateClient();

    it('A 重试后显式关闭重开（未再发送）：A 网络失败全链路无旧错误，新面板与参数保留', async () => {
      seedDoc('failed');
      let rejectA!: (error: unknown) => void;
      fetchMock.mockImplementationOnce(() => new Promise<Response>((_, reject) => { rejectA = reject; }));
      await renderPage();
      await openHdPanel();
      await mountCard('h1');
      await clickCardRetry();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await act(async () => { panelClose()!.click(); });
      await openHdPanel();
      await act(async () => { rejectA(new TypeError('Failed to fetch')); });
      await settle();

      expect(toast.error).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain('网络请求失败');
      expect(document.body.textContent).not.toContain('HD 高清任务创建失败，请重试');
      expect(panelSend()).toBeTruthy();
      expect(panelSend()!.disabled).toBe(false);
      expect(panelResolution('4k')!.className).toContain('resolutionBtnActive');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('新会话 B 等待中旧 A 的 HTTP 422：不触发 HTTP 默认提示，也不解 B 的锁，参数保留', async () => {
      seedDoc('failed');
      let resolveA!: (value: Response) => void;
      fetchMock
        .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveA = resolve; }))
        .mockImplementationOnce(() => new Promise<Response>(() => {}));
      await renderPage();
      await openHdPanel();
      await mountCard('h1');
      await clickCardRetry();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await act(async () => { panelClose()!.click(); });
      await openHdPanel();
      await clickPanelResolution('2k');
      await act(async () => { panelSend()!.click(); });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(panelSend()!.disabled).toBe(true);

      await act(async () => { resolveA(jsonEnvelope(422, '分辨率档不可用', 422)); });
      await settle();

      expect(toast.error).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain('分辨率档不可用');
      expect(document.body.textContent).not.toContain('HD 高清任务创建失败，请重试');
      expect(panelSend()!.disabled).toBe(true);
      await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(panelResolution('2k')!.className).toContain('resolutionBtnActive');
    });

    it('对照：当前有效重试 HTTP 422 保留原有提示（sonner 一条 + 页面文案），无重复', async () => {
      seedDoc('failed');
      fetchMock.mockImplementationOnce(async () => jsonEnvelope(422, '分辨率档不可用', 422));
      await renderPage();
      await openHdPanel();
      await mountCard('h1');
      await clickCardRetry();
      await settle();

      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledWith('分辨率档不可用');
      expect(toast.error).toHaveBeenCalledWith('分辨率档不可用');
      expect(panelSend()!.disabled).toBe(false);
    });

    it('对照：当前有效重试 401 保持原有静默，不新增提示', async () => {
      seedDoc('failed');
      fetchMock.mockImplementationOnce(async () => jsonEnvelope(401, '请重新登录', 401));
      await renderPage();
      await openHdPanel();
      await mountCard('h1');
      await clickCardRetry();
      await settle();

      expect(toast.error).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain('请重新登录');
      expect(document.body.textContent).not.toContain('HD 高清任务创建失败，请重试');
    });
  });

  describe('IKJPM7 修订：探针不过度失效（他工具打开与纯关闭）', () => {
    it('场景ii：A 重试等待时打开另一张卡的另一工具面板（插帧）：A 失败提示保留，创建总数 1', async () => {
      seedDoc('failed');
      let rejectA!: (error: unknown) => void;
      apiMocks.createVideoEnhancement.mockImplementationOnce(() => new Promise<never>((_, reject) => { rejectA = reject; }));
      await renderPage();
      await openHdPanel();
      await mountCard('h1');
      await clickCardRetry();
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

      await act(async () => {
        ((mediaNode('v1').data as Record<string, unknown>).onFrameInterpolation as (id: string) => void)('v1');
      });
      expect(panelSend()).toBeNull();

      await act(async () => {
        rejectA(new Error('network down'));
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(toast.error).toHaveBeenCalledWith('HD 高清任务创建失败，请重试');
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    });

    it('边界（父级裁定）：A 重试等待→纯显式关闭未重开：A 失败仍按当前有效请求保留提示', async () => {
      seedDoc('failed');
      let rejectA!: (error: unknown) => void;
      apiMocks.createVideoEnhancement.mockImplementationOnce(() => new Promise<never>((_, reject) => { rejectA = reject; }));
      await renderPage();
      await openHdPanel();
      await mountCard('h1');
      await clickCardRetry();
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

      await act(async () => { panelClose()!.click(); });
      expect(panelSend()).toBeNull();

      await act(async () => {
        rejectA(new Error('network down'));
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(toast.error).toHaveBeenCalledWith('HD 高清任务创建失败，请重试');
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    });
  });

  describe('IKJPXN 换目标会话隔离旧重试失败提示（真实创建客户端与 HTTP 链）', () => {
    const { fetchMock, jsonEnvelope, settle } = setupRealCreateClient();

    it('h1 重试 A 等待时直接打开 h2：A 网络失败不提示到新 HD 会话，h2 面板与参数保持', async () => {
      seedDoc('twoFailed');
      let rejectA!: (error: unknown) => void;
      fetchMock.mockImplementationOnce(() => new Promise<Response>((_, reject) => { rejectA = reject; }));
      await renderPage();
      await openHdPanel('h1');
      await mountCard('h1');
      await clickCardRetry();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await openHdPanel('h2');
      expect(panelResolution('2k')!.className).toContain('resolutionBtnActive');
      expect(panelSend()!.disabled).toBe(false);

      await act(async () => { rejectA(new TypeError('Failed to fetch')); });
      await settle();

      expect(toast.error).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain('网络请求失败');
      expect(document.body.textContent).not.toContain('HD 高清任务创建失败，请重试');
      expect(panelSend()).toBeTruthy();
      expect(panelSend()!.disabled).toBe(false);
      expect(panelResolution('2k')!.className).toContain('resolutionBtnActive');
      expect((mediaNode('h1').data as Record<string, unknown>).genStatus).toBe('failed');
      expect(identityOf(mediaNode('h1'))).toEqual({ sourceAssetId: '5', lastParams: { resolution: '4k' } });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('h2 已发送 B 仍等待时旧 A 以 HTTP 422 返回：不触发 HTTP 默认提示，h2 锁与请求次数保持', async () => {
      seedDoc('twoFailed');
      let resolveA!: (value: Response) => void;
      fetchMock
        .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveA = resolve; }))
        .mockImplementationOnce(() => new Promise<Response>(() => {}));
      await renderPage();
      await openHdPanel('h1');
      await mountCard('h1');
      await clickCardRetry();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await openHdPanel('h2');
      await act(async () => { panelSend()!.click(); });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
        source_asset_id: '5', target_node_id: 'h2', resolution: '2k',
        canvas_binding: expect.objectContaining({ protocol_version: 1, target_node_id: 'h2', submission_id: expect.any(String) }),
      });
      expect(panelSend()!.disabled).toBe(true);

      await act(async () => { resolveA(jsonEnvelope(422, '分辨率档不可用', 422)); });
      await settle();

      expect(toast.error).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain('分辨率档不可用');
      expect(document.body.textContent).not.toContain('HD 高清任务创建失败，请重试');
      expect(panelSend()!.disabled).toBe(true);
      await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(panelResolution('2k')!.className).toContain('resolutionBtnActive');
    });
  });

  describe('IKJPXM 可见同卡重入保留失败反馈（真实 NodeWrapper 事件链）', () => {
    let realFlowRoot: Root | null = null;
    let realFlowHost: HTMLDivElement | null = null;
    let syncRealFlow: (() => void) | null = null;
    let measureSpies: Array<{ mockRestore(): void }> = [];
    const realFlowNodeTypes = { mediaNode: MediaNode };

    function RealFlowBridge() {
      const [nodes, setNodes] = useState<Node[]>(() => flowProps.current.mediaNodes);
      syncRealFlow = () => setNodes([...mediaNodes()]);
      return createElement(ReactFlow, {
        nodes,
        edges: [],
        nodeTypes: realFlowNodeTypes,
        onNodesChange: (changes: Parameters<typeof applyNodeChanges>[0]) =>
          setNodes((current) => applyNodeChanges(changes, current)),
        onNodeClick: (_event: unknown, node: Node) => {
          flowProps.current.onNodeClick(mediaNodes().find((n) => n.id === node.id) ?? node);
        },
        onSelectionChange: ({ nodes: selected }: { nodes: Node[] }) => {
          flowProps.current.onSelectionChange({
            nodes: selected.map((s) => mediaNodes().find((n) => n.id === s.id) ?? s),
          });
        },
      });
    }

    async function mountRealFlow() {
      realFlowHost = document.createElement('div');
      document.body.appendChild(realFlowHost);
      realFlowRoot = createRoot(realFlowHost);
      await act(async () => { realFlowRoot!.render(createElement(RealFlowBridge)); });
    }

    async function realClickNode(id: string) {
      await act(async () => { syncRealFlow?.(); });
      const el = realFlowHost!.querySelector(`.react-flow__node[data-id="${id}"]`);
      expect(el).toBeTruthy();
      await act(async () => {
        el!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
    }

    beforeEach(() => {
      vi.stubGlobal('ResizeObserver', class {
        callback: ResizeObserverCallback;
        constructor(cb: ResizeObserverCallback) { this.callback = cb; }
        observe(target: Element) {
          this.callback(
            [{ target, contentRect: { width: 1000, height: 800 } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
        }
        unobserve() {}
        disconnect() {}
      });
      vi.stubGlobal('DOMMatrixReadOnly', class {
        m22: number;
        constructor(transform?: string) {
          const scale = transform?.match(/scale\(([1-9.])\)/)?.[1];
          this.m22 = scale !== undefined ? +scale : 1;
        }
      });
      measureSpies = [
        vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000),
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800),
      ];
    });

    afterEach(async () => {
      if (realFlowRoot) await act(async () => realFlowRoot!.unmount());
      realFlowHost?.remove();
      realFlowRoot = null;
      realFlowHost = null;
      syncRealFlow = null;
      measureSpies.forEach((spy) => spy.mockRestore());
      measureSpies = [];
      fetchGuard.unstubGlobals();
    });

    it('初值 4K 改 2K 发送 B 等待，真实点击当前可见同卡：B 失败仍显示原有原因，参数保留、创建仅一次、失败后恢复操作', async () => {
      seedDoc('failed');
      let rejectB!: (error: unknown) => void;
      apiMocks.createVideoEnhancement.mockImplementationOnce(
        () => new Promise<{ job_id: string; status: 'queued' }>((_, reject) => { rejectB = reject; }),
      );
      await renderPage();
      await openHdPanel();
      expect(panelResolution('4k')!.className).toContain('resolutionBtnActive');
      await clickPanelResolution('2k');
      await act(async () => { panelSend()!.click(); });
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
      expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
        source_asset_id: '5', target_node_id: 'h1', resolution: '2k',
      }, expect.objectContaining({ silent: true }));

      await mountRealFlow();
      await realClickNode('h1');
      expect(panelSend()).toBeTruthy();
      expect(panelSend()!.disabled).toBe(true);
      expect(panelResolution('2k')!.className).toContain('resolutionBtnActive');
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

      await act(async () => {
        rejectB(new Error('network down'));
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(toast.error).toHaveBeenCalledWith('HD 高清任务创建失败，请重试');
      expect(panelSend()!.disabled).toBe(false);
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    });

    it('对照：未改参数时可见同卡多次真实重入，当前有效失败提示同样保留', async () => {
      seedDoc('failed');
      let rejectB!: (error: unknown) => void;
      apiMocks.createVideoEnhancement.mockImplementationOnce(
        () => new Promise<{ job_id: string; status: 'queued' }>((_, reject) => { rejectB = reject; }),
      );
      await renderPage();
      await openHdPanel();
      await act(async () => { panelSend()!.click(); });
      expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
        source_asset_id: '5', target_node_id: 'h1', resolution: '4k',
      }, expect.objectContaining({ silent: true }));

      await mountRealFlow();
      await realClickNode('h1');
      await realClickNode('h1');
      expect(panelSend()!.disabled).toBe(true);
      expect(panelResolution('4k')!.className).toContain('resolutionBtnActive');

      await act(async () => {
        rejectB(new Error('network down'));
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(toast.error).toHaveBeenCalledWith('HD 高清任务创建失败，请重试');
      expect(panelSend()!.disabled).toBe(false);
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    });

    it('选择隐藏（含空选中过渡）：真实点击其他卡隐藏面板、真实点回原卡恢复——参数与在途只读保留、无额外创建，A 失败反馈仍保留', async () => {
      seedDoc('failed');
      let rejectA!: (error: unknown) => void;
      apiMocks.createVideoEnhancement.mockImplementationOnce(
        () => new Promise<{ job_id: string; status: 'queued' }>((_, reject) => { rejectA = reject; }),
      );
      await renderPage();
      await openHdPanel();
      await clickPanelResolution('2k');
      await mountCard('h1');
      await clickCardRetry();
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

      await mountRealFlow();
      expect(realFlowHost!.textContent).toContain('素材视频');
      await realClickNode('v1');
      expect(panelSend()).toBeNull();
      await act(async () => { flowProps.current.onSelectionChange({ nodes: [] }); });

      await realClickNode('h1');
      expect(panelSend()).toBeTruthy();
      expect(panelSend()!.disabled).toBe(true);
      expect(panelResolution('2k')!.disabled).toBe(true);
      expect(panelResolution('2k')!.className).toContain('resolutionBtnActive');
      await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

      await act(async () => {
        rejectA(new Error('network down'));
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(toast.error).toHaveBeenCalledWith('HD 高清任务创建失败，请重试');
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    });
  });
});
