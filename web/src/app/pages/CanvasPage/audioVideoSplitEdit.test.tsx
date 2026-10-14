// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { MEDIA_EXTRACT_EDGE_ORIGIN } from './mediaExtract';
import type { GenerationModel } from '@/api/generation';

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
  fetchGenerationRecoveryPage: vi.fn(async () => ({
    protocol_version: 1,
    canvas_version: null,
    records: [],
    next_cursor: null,
  })),
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
  saveCanvasDoc: vi.fn(
    async (): Promise<{ id: number; project_id: number; version: number; viewport: string; nodes: string }> => ({
      id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]',
    }),
  ),
  createGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  createVideoSubtitleErase: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
  uploadAssetFile: vi.fn(),
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
    JSON.stringify(edges.map((e) => JSON.parse(JSON.stringify(e)))),
  ),
}));
vi.mock('@/api/jobs', () => ({
  createGenerationJob: apiMocks.createGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createVideoEnhancement: apiMocks.createVideoEnhancement,
  createMediaExtraction: apiMocks.createMediaExtraction,
  createAudioTrim: apiMocks.createAudioTrim,
  createVideoSubtitleErase: apiMocks.createVideoSubtitleErase,
  readJobFailText: apiMocks.readJobFailText,
}));
vi.mock('@/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/api/generation', () => ({ fetchGenerationModels: apiMocks.fetchGenerationModels }));
vi.mock('@/utils/upload', () => ({ uploadAssetFile: apiMocks.uploadAssetFile }));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('./hooks/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'v1',
          type: 'mediaNode',
          position: { x: 400, y: 0 },
          data: {
            src: 'http://vid/v1.mp4',
            mediaType: 'video',
            fileName: '素材视频',
            assetId: '5',
            width: 1920,
            height: 1080,
            duration: 30,
            mime: 'video/mp4',
          },
        },
      ],
      edges: [],
    },
    assets: { 5: { asset_id: 5, type: 'video', access_url: 'http://vid/v1.mp4', width: 1920, height: 1080 } },
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
        { client: new QueryClient() },
        createElement(MemoryRouter, null, createElement(CanvasPage)),
      ),
    );
  });
}

async function enterSplit() {
  const video = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!;
  await act(async () => {
    video.data.onAudioVideoSplit('v1');
  });
}

function v1Data(): Record<string, unknown> {
  const video = (flowProps.current.mediaNodes as Node[]).find((n) => n.id === 'v1')!;
  return video.data as Record<string, unknown>;
}

function bodyBtn(testId: string): HTMLButtonElement {
  return document.body.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;
}

async function click(testId: string) {
  await act(async () => {
    bodyBtn(testId).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function toolbar(): HTMLElement | null {
  return document.body.querySelector('[data-testid="audio-video-split-close"]');
}

async function selectFormat(format: string) {
  await click('audio-video-split-format-trigger');
  await click(`audio-video-split-format-item-${format}`);
}

async function sendSplit() {
  await click('audio-video-split-send-btn');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

function splitCard(): Node | undefined {
  return (flowProps.current.mediaNodes as Node[]).find((n) => n.id !== 'v1' && n.id.startsWith('media-extract-'));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiMocks.createMediaExtraction.mockReset();
  apiMocks.createVideoSubtitleErase.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKH28U 编辑态呈现（进入不建任务）', () => {
  it('进入编辑态：单条（X 关闭在最左）+ 三要素（格式 M4A/本期免费/发送钮）；splitEditing 与 soloToolbarHidden 注入源卡；不建任务不建卡', async () => {
    await renderPage();
    await enterSplit();
    const close = bodyBtn('audio-video-split-close');
    const sendBar = document.body.querySelector('[data-testid="audio-video-split-send-bar"]')!;
    expect(sendBar.contains(close)).toBe(true);
    expect(sendBar.querySelector('button')).toBe(close);
    expect(bodyBtn('audio-video-split-format-trigger').textContent).toBe('M4A');
    expect(sendBar.textContent).toContain('本期免费');
    expect(bodyBtn('audio-video-split-send-btn')).toBeTruthy();
    expect(v1Data().splitEditing).toBe(true);
    expect(v1Data().soloToolbarHidden).toBe(true);
    expect(apiMocks.createMediaExtraction).not.toHaveBeenCalled();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('与其他工具编辑会话互斥：去字幕会话中点音视频分离，去字幕单条退出、分离浮条接管', async () => {
    await renderPage();
    const video = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!;
    await act(async () => {
      video.data.onVideoSubtitleErase('v1', 'smart');
    });
    expect(document.body.querySelector('[data-testid="subtitle-erase-send-bar"]')).toBeTruthy();
    await enterSplit();
    expect(document.body.querySelector('[data-testid="subtitle-erase-send-bar"]')).toBeNull();
    expect(toolbar()).toBeTruthy();
    expect(v1Data().splitEditing).toBe(true);
    await act(async () => {
      video.data.onVideoSubtitleErase('v1', 'smart');
    });
    expect(toolbar()).toBeNull();
    expect(v1Data().splitEditing).toBeUndefined();
    expect(document.body.querySelector('[data-testid="subtitle-erase-send-bar"]')).toBeTruthy();
  });
});

describe('IKH28U 四退出：未发送退出画布无痕迹', () => {
  it('X 退出：无卡、无边、无任务、编辑标记移除（播放控制恢复）', async () => {
    await renderPage();
    await enterSplit();
    await click('audio-video-split-close');
    expect(toolbar()).toBeNull();
    expect(v1Data().splitEditing).toBeUndefined();
    expect(v1Data().soloToolbarHidden).toBeUndefined();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
    expect(apiMocks.createMediaExtraction).not.toHaveBeenCalled();
  });

  it('Esc 退出：同口径无痕迹', async () => {
    await renderPage();
    await enterSplit();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('点其他卡退出（单选非目标）；空选中不退出', async () => {
    await renderPage();
    await enterSplit();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [{ id: 'other' }] });
    });
    expect(toolbar()).toBeNull();
    await enterSplit();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [] });
    });
    expect(toolbar()).not.toBeNull();
  });

  it('点画布空白退出（PaneClick）', async () => {
    await renderPage();
    await enterSplit();
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });
});

describe('IKH28U 会话口径（!743 体系接入）', () => {
  it('重复进入幂等：退出再进入标记干净（无残留编辑态）', async () => {
    await renderPage();
    await enterSplit();
    await click('audio-video-split-close');
    expect(v1Data().splitEditing).toBeUndefined();
    await enterSplit();
    expect(v1Data().splitEditing).toBe(true);
    expect(toolbar()).toBeTruthy();
  });
});

describe('IKH28X 发送闭环（建任务→占位卡→终态→重试）', () => {
  it('发送（默认 m4a）：按所选格式建任务、先退编辑态再建占位卡、来源边 origin=media-extract、展示名跟随格式', async () => {
    apiMocks.createMediaExtraction.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterSplit();
    await sendSplit();
    expect(apiMocks.createMediaExtraction).toHaveBeenCalledWith('p1', { source_asset_id: '5', output_format: 'm4a' }, expect.objectContaining({ silent: true }));
    expect(toolbar()).toBeNull();
    expect(v1Data().splitEditing).toBeUndefined();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    const audio = splitCard()!;
    expect(audio.data.fileName).toBe('素材视频(audio).m4a');
    expect(audio.data.mediaExtract).toEqual({
      sourceAssetId: '5',
      lastInput: { source_asset_id: '5', output_format: 'm4a' },
    });
    const edge = (flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>)
      .find((e) => e.target === audio.id)!;
    expect(edge.source).toBe('v1');
    expect(edge.data).toEqual({ origin: MEDIA_EXTRACT_EDGE_ORIGIN });
  });

  it('切换格式后发送：任务参数与占位卡展示名跟随所选格式（所见即所得）；未发送退出重进格式复位 m4a', async () => {
    apiMocks.createMediaExtraction.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterSplit();
    await selectFormat('wav');
    expect(bodyBtn('audio-video-split-format-trigger').textContent).toBe('WAV');
    await click('audio-video-split-close');
    await enterSplit();
    expect(bodyBtn('audio-video-split-format-trigger').textContent).toBe('M4A');
    await selectFormat('wav');
    await sendSplit();
    expect(apiMocks.createMediaExtraction).toHaveBeenCalledTimes(1);
    expect(apiMocks.createMediaExtraction).toHaveBeenCalledWith('p1', { source_asset_id: '5', output_format: 'wav' }, expect.objectContaining({ silent: true }));
    expect(splitCard()!.data.fileName).toBe('素材视频(audio).wav');
  });

  it('创建失败（网络）：失败卡可重试（IKJJR3 提交点即交接，会话已退）', async () => {
    apiMocks.createMediaExtraction.mockRejectedValue(new Error('network down'));
    await renderPage();
    await enterSplit();
    await sendSplit();
    await act(async () => {});
    expect(apiMocks.createMediaExtraction).toHaveBeenCalledTimes(1);
    expect(toolbar()).toBeNull();
    const failed = splitCard()!;
    expect(failed.data.genStatus).toBe('failed');
    expect(failed.data.mediaExtract).toEqual({
      sourceAssetId: '5', lastInput: { source_asset_id: '5', output_format: 'm4a' },
    });
  });

  it('轮询终态 succeeded：占位卡收敛为成品音频卡（src/assetId 回填、进度 100、展示名保留）', async () => {
    apiMocks.createMediaExtraction.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j1', status: 'succeeded', progress: 100,
      asset: { id: 'a88', url: 'http://tos/x.m4a', type: 'audio', duration: 65.5 },
    });
    await renderPage();
    await enterSplit();
    await sendSplit();
    const audio = splitCard()!;
    expect(audio.data.genStatus).toBeUndefined();
    expect(audio.data.progress).toBe(100);
    expect(audio.data.src).toBe('http://tos/x.m4a');
    expect(audio.data.assetId).toBe('a88');
    expect(audio.data.duration).toBe(65.5);
    expect(audio.data.fileName).toBe('素材视频(audio).m4a');
  });

  it('轮询终态 failed：1044 火山兜底码映射可读文案；带身份卡原参数重试建新任务并收敛成品', async () => {
    apiMocks.createMediaExtraction.mockResolvedValueOnce({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j1', status: 'failed', progress: 1,
      error: { code: 'media_extract_provider_failed', msg: '' },
    });
    await renderPage();
    await enterSplit();
    await sendSplit();
    const failed = splitCard()!;
    expect(failed.data.genStatus).toBe('failed');
    expect(failed.data.errorText).toBe('音频提取失败，请重试');

    apiMocks.createMediaExtraction.mockResolvedValueOnce({ job_id: 'j2', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j2', status: 'succeeded', progress: 100,
      asset: { id: 'a89', url: 'http://tos/y.m4a', type: 'audio' },
    });
    await act(async () => {
      (failed.data.onRetryJob as (id: string) => void)(failed.id);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(apiMocks.createMediaExtraction).toHaveBeenLastCalledWith('p1', { source_asset_id: '5', output_format: 'm4a' }, expect.objectContaining({ silent: true }));
    const retried = splitCard()!;
    expect(retried.data.jobId).toBe('j2');
    expect(retried.data.genStatus).toBeUndefined();
    expect(retried.data.src).toBe('http://tos/y.m4a');
  });
});

it('提交在途同卡再入会话：submitting 防重只受理一次，受理落定后新会话可再发', async () => {
  let accept!: (value: { job_id: string; status: string }) => void;
  apiMocks.createMediaExtraction.mockImplementationOnce(() => new Promise((resolve) => { accept = resolve; }));
  apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'old', status: 'processing', progress: 1, asset: null });
  await renderPage();
  await enterSplit();
  await click('audio-video-split-send-btn');
  expect(toolbar()).toBeNull();
  expect(splitCard()!.data.mediaExtract).toEqual({
    sourceAssetId: '5', lastInput: { source_asset_id: '5', output_format: 'm4a' },
  });
  await act(async () => { accept({ job_id: 'old', status: 'queued' }); });
  expect(splitCard()!.data.jobId).toBe('old');
});

it.each(['success', 'failure'] as const)('提交后关闭重开：旧 %s 不污染当前会话与提交锁（IKJJR3 提交点即交接）', async (outcome) => {
  let acceptOld!: (value: { job_id: string; status: string }) => void;
  let rejectOld!: (error: Error) => void;
  apiMocks.createMediaExtraction.mockImplementationOnce(() => new Promise((resolve, reject) => { acceptOld = resolve; rejectOld = reject; }));
  apiMocks.fetchJobStatus.mockResolvedValue({ status: 'processing', progress: 1, asset: null });
  await renderPage();
  await enterSplit();
  await click('audio-video-split-send-btn');
  expect(toolbar()).toBeNull();
  await enterSplit();
  await selectFormat('wav');
  await act(async () => {
    if (outcome === 'success') acceptOld({ job_id: 'old', status: 'queued' });
    else rejectOld(new Error('旧请求失败'));
  });
  expect(toolbar()).not.toBeNull();
  expect(bodyBtn('audio-video-split-format-trigger').textContent).toBe('WAV');
  expect(document.body.textContent).not.toContain('音视频分离任务创建失败');
});
