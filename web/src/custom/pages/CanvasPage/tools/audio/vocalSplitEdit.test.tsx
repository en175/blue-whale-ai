// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../../index';
import { VOCAL_SPLIT_EDGE_ORIGIN, isVocalSplitNodeId } from './vocalSplit';
import type { GenerationModel } from '@/custom/api/generation';

vi.mock('@/custom/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));
vi.mock('../../components/AgentPanel/index', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('../../components/Canvas/index', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

vi.mock('../../components/CanvasToolbar/index', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));

vi.mock('../../components/CanvasHeader/index', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));

vi.mock('../../components/ProjectSelector/index', () => ({
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
    async (
      _projectId: string,
      _payload: { nodes: Array<{ id: string }>; edges: Array<{ source: string; target: string; data?: unknown }> },
      _version: number | null,
    ): Promise<{ id: number; project_id: number; version: number; viewport: string; nodes: string }> => ({
      id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]',
    }),
  ),
  createGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createVocalSplit: vi.fn(),
  createVideoSubtitleErase: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
  uploadAssetFile: vi.fn(),
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
    JSON.stringify(edges.map((e) => JSON.parse(JSON.stringify(e)))),
  ),
}));
vi.mock('@/custom/api/jobs', () => ({
  createGenerationJob: apiMocks.createGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createVideoEnhancement: apiMocks.createVideoEnhancement,
  createMediaExtraction: apiMocks.createMediaExtraction,
  createVocalSplit: apiMocks.createVocalSplit,
  createVideoSubtitleErase: apiMocks.createVideoSubtitleErase,
  createVideoSceneSplit: vi.fn(async () => ({ job_id: 'ss1', status: 'queued' })),
  readJobFailText: apiMocks.readJobFailText,
}));
vi.mock('@/custom/api/canvasRecovery', () => ({
  fetchGenerationRecoveryPage: vi.fn(async () => ({ protocol_version: 1, canvas_version: null, records: [], next_cursor: null })),
  resolveGenerationRecovery: vi.fn(async () => ({ protocol_version: 1, records: [] })),
  putCanvasDocWithRecovery: vi.fn(),
  generationRecoveryPageOptions: vi.fn(() => ({
    queryKey: ['generation-recovery', 'mock'],
    queryFn: async () => ({ protocol_version: 1, canvas_version: null, records: [], next_cursor: null }),
  })),
}));
vi.mock('@/custom/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/custom/api/generation', () => ({ fetchGenerationModels: apiMocks.fetchGenerationModels }));
vi.mock('@/custom/utils/upload', () => ({ uploadAssetFile: apiMocks.uploadAssetFile }));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('../../hooks/document/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

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

async function enterVocal() {
  const video = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!;
  await act(async () => {
    video.data.onVocalBackgroundSplit('v1');
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
  return document.body.querySelector('[data-testid="vocal-split-close"]');
}

function sendBar(): HTMLElement | null {
  return document.body.querySelector('[data-testid="vocal-split-send-bar"]');
}

async function selectScene(scene: string) {
  await click('vocal-split-scene-trigger');
  await click(`vocal-split-scene-item-${scene}`);
}

async function selectFormat(format: string) {
  await click('vocal-split-format-trigger');
  await click(`vocal-split-format-item-${format}`);
}

async function sendVocal() {
  await click('vocal-split-send-btn');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

function placeholderNode(): Node | undefined {
  return (flowProps.current.mediaNodes as Node[]).find((n) => isVocalSplitNodeId(n.id) && n.id !== 'v1');
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiMocks.createVocalSplit.mockReset();
  apiMocks.createMediaExtraction.mockReset();
  apiMocks.createVideoSubtitleErase.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKHA2W 编辑态呈现（进入不建任务）', () => {
  it('进入编辑态：单条（X 关闭在最左）+ 发送条要素（场景默认通用/格式默认 AAC/本期免费/发送钮）；splitEditing 与 soloToolbarHidden 注入源卡；不建任务不建卡', async () => {
    await renderPage();
    await enterVocal();
    const close = bodyBtn('vocal-split-close');
    const bar = sendBar()!;
    expect(bar.contains(close)).toBe(true);
    expect(bar.querySelector('button')).toBe(close);
    expect(bodyBtn('vocal-split-scene-trigger').textContent).toBe('通用');
    expect(bodyBtn('vocal-split-format-trigger').textContent).toBe('AAC');
    expect(bar.textContent).not.toContain('本期免费');
    expect(bodyBtn('vocal-split-send-btn')).toBeTruthy();
    expect(v1Data().splitEditing).toBe(true);
    expect(v1Data().soloToolbarHidden).toBe(true);
    expect(apiMocks.createVocalSplit).not.toHaveBeenCalled();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('与音视频分离会话互斥（下拉第一项↔第二项互为替代会话）：分离态中点人声分离，分离浮条退出、人声浮条接管；反向亦然', async () => {
    await renderPage();
    const video = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!;
    await act(async () => {
      video.data.onAudioVideoSplit('v1');
    });
    expect(document.body.querySelector('[data-testid="audio-video-split-send-bar"]')).toBeTruthy();
    await enterVocal();
    expect(document.body.querySelector('[data-testid="audio-video-split-send-bar"]')).toBeNull();
    expect(sendBar()).toBeTruthy();
    expect(v1Data().splitEditing).toBe(true);
    await act(async () => {
      video.data.onAudioVideoSplit('v1');
    });
    expect(toolbar()).toBeNull();
    expect(sendBar()).toBeNull();
    expect(v1Data().splitEditing).toBe(true);
    expect(document.body.querySelector('[data-testid="audio-video-split-send-bar"]')).toBeTruthy();
  });

  it('与去字幕会话互斥：去字幕单条先退出、人声浮条接管', async () => {
    await renderPage();
    const video = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!;
    await act(async () => {
      video.data.onVideoSubtitleErase('v1', 'smart');
    });
    expect(document.body.querySelector('[data-testid="subtitle-erase-send-bar"]')).toBeTruthy();
    await enterVocal();
    expect(document.body.querySelector('[data-testid="subtitle-erase-send-bar"]')).toBeNull();
    expect(sendBar()).toBeTruthy();
  });
});

describe('IKHA2W 四退出：未发送退出画布无痕迹', () => {
  it('X 退出：无卡、无边、无任务、编辑标记移除（播放控制恢复）', async () => {
    await renderPage();
    await enterVocal();
    await click('vocal-split-close');
    expect(toolbar()).toBeNull();
    expect(v1Data().splitEditing).toBeUndefined();
    expect(v1Data().soloToolbarHidden).toBeUndefined();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
    expect(apiMocks.createVocalSplit).not.toHaveBeenCalled();
  });

  it('Esc 退出：同口径无痕迹', async () => {
    await renderPage();
    await enterVocal();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('点其他卡退出（单选非目标）', async () => {
    await renderPage();
    await enterVocal();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [{ id: 'other' }] });
    });
    expect(toolbar()).toBeNull();
    expect(v1Data().splitEditing).toBeUndefined();
  });

  it('点画布空白退出（PaneClick）', async () => {
    await renderPage();
    await enterVocal();
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });
});

describe('IKHA2W 发送闭环（建任务→占位卡→来源边→落盘）', () => {
  it('发送（默认通用/aac）：三键参数建任务（canvas_binding + Idempotency-Key）、先退编辑态再预建占位卡、来源边 origin=vocal-split、受理前不落盘', async () => {
    apiMocks.createVocalSplit.mockResolvedValue({ job_id: 'j701', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j701', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterVocal();
    await sendVocal();
    const [sentProject, sentPayload, sentInit] = apiMocks.createVocalSplit.mock.calls[0] as unknown as [
      string, { source_asset_id: string; scene: string; output_format: string; canvas_binding?: { submission_id: string } }, { silent: boolean; idempotencyKey?: string },
    ];
    expect(sentProject).toBe('p1');
    expect(sentPayload).toMatchObject({ source_asset_id: '5', scene: 'audio', output_format: 'aac' });
    expect(sentPayload.canvas_binding).toMatchObject({ protocol_version: 1, target_node_id: expect.stringMatching(/^vocal-split-/) });
    expect(sentInit?.idempotencyKey).toBe(sentPayload.canvas_binding!.submission_id);
    expect(toolbar()).toBeNull();
    expect(v1Data().splitEditing).toBeUndefined();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    const audio = placeholderNode()!;
    expect(isVocalSplitNodeId(audio.id)).toBe(true);
    expect(audio.data.fileName).toBe('素材视频(人声背景分离)');
    expect(audio.data.mediaType).toBe('audio');
    expect(audio.data.genStatus).toBe('generating');
    expect(audio.data.jobId).toBe('j701');
    expect(audio.data.vocalSplit).toEqual({
      sourceAssetId: '5',
      lastInput: { source_asset_id: '5', scene: 'audio', output_format: 'aac' },
    });
    const edge = (flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>)
      .find((e) => e.target === audio.id)!;
    expect(edge.source).toBe('v1');
    expect(edge.data).toEqual({ origin: VOCAL_SPLIT_EDGE_ORIGIN });
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
  });

  it('切换场景与格式后发送：任务参数与请求体跟随所选（所见即所得）；未发送退出重进参数复位默认', async () => {
    apiMocks.createVocalSplit.mockResolvedValue({ job_id: 'j702', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j702', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterVocal();
    await selectScene('drama');
    expect(bodyBtn('vocal-split-scene-trigger').textContent).toBe('短剧');
    await selectFormat('flac');
    expect(bodyBtn('vocal-split-format-trigger').textContent).toBe('FLAC');
    await click('vocal-split-close');
    await enterVocal();
    expect(bodyBtn('vocal-split-scene-trigger').textContent).toBe('通用');
    expect(bodyBtn('vocal-split-format-trigger').textContent).toBe('AAC');
    await selectScene('drama');
    await selectFormat('flac');
    await sendVocal();
    expect(apiMocks.createVocalSplit).toHaveBeenCalledTimes(1);
    expect(apiMocks.createVocalSplit).toHaveBeenCalledWith('p1', {
      source_asset_id: '5', scene: 'drama', output_format: 'flac',
      canvas_binding: expect.any(Object),
    }, expect.objectContaining({ silent: true }));
    expect(placeholderNode()!.data.vocalSplit).toEqual({
      sourceAssetId: '5',
      lastInput: { source_asset_id: '5', scene: 'drama', output_format: 'flac' },
    });
  });

  it('创建失败（网络）：预建占位卡转失败态（卡上重试），编辑态已按发送即退会话退出', async () => {
    apiMocks.createVocalSplit.mockRejectedValue(new Error('network down'));
    await renderPage();
    await enterVocal();
    await sendVocal();
    expect(apiMocks.createVocalSplit).toHaveBeenCalledTimes(1);
    const failed = placeholderNode()!;
    expect(failed.data.genStatus).toBe('failed');
    expect(failed.data.errorText).toBe('人声背景分离任务创建失败，请重试');
    expect(toolbar()).toBeNull();
  });

  it('同一视频连续多次发送（不同场景/格式）：各建各的任务与占位卡', async () => {
    apiMocks.createVocalSplit
      .mockResolvedValueOnce({ job_id: 'j710', status: 'queued' })
      .mockResolvedValueOnce({ job_id: 'j711', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterVocal();
    await selectFormat('mp3');
    await sendVocal();
    await enterVocal();
    await selectScene('music');
    await selectFormat('wav');
    await sendVocal();
    expect(apiMocks.createVocalSplit).toHaveBeenNthCalledWith(1, 'p1', {
      source_asset_id: '5', scene: 'audio', output_format: 'mp3',
      canvas_binding: expect.any(Object),
    }, expect.objectContaining({ silent: true }));
    expect(apiMocks.createVocalSplit).toHaveBeenNthCalledWith(2, 'p1', {
      source_asset_id: '5', scene: 'music', output_format: 'wav',
      canvas_binding: expect.any(Object),
    }, expect.objectContaining({ silent: true }));
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(3);
    const placeholders = (flowProps.current.mediaNodes as Node[]).filter((n) => isVocalSplitNodeId(n.id));
    expect(placeholders).toHaveLength(2);
    expect(placeholders.find((n) => n.data.jobId === 'j710')).toBeTruthy();
    expect(placeholders.find((n) => n.data.jobId === 'j711')!.data.vocalSplit).toEqual({
      sourceAssetId: '5',
      lastInput: { source_asset_id: '5', scene: 'music', output_format: 'wav' },
    });
    const targets = (flowProps.current.edges as Array<{ source: string; target: string }>)
      .filter((e) => e.source === 'v1').map((e) => e.target);
    expect(targets).toEqual(expect.arrayContaining(placeholders.map((n) => n.id)));
  });
});

describe('IKHA2W 轮询终态与失败重试', () => {
  it('轮询终态 failed：错误码映射可读文案 + 重试钮；重试按 lastInput 三键原样重发建新任务', async () => {
    apiMocks.createVocalSplit.mockResolvedValueOnce({ job_id: 'j720', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j720', status: 'failed', progress: 1,
      error: { code: 'vocal_split_failed', msg: '' },
    });
    await renderPage();
    await enterVocal();
    await selectScene('narrate');
    await sendVocal();
    const failed = placeholderNode()!;
    expect(failed.data.genStatus).toBe('failed');
    expect(failed.data.errorText).toBe('人声背景分离失败，请重试');

    apiMocks.createVocalSplit.mockResolvedValueOnce({ job_id: 'j721', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({ job_id: 'j721', status: 'processing', progress: 2, asset: null });
    await act(async () => {
      (failed.data.onRetryJob as (id: string) => void)(failed.id);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(apiMocks.createVocalSplit).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', scene: 'narrate', output_format: 'aac',
    }, { silent: true });
    const retried = placeholderNode()!;
    expect(retried.id).toBe(failed.id);
    expect(retried.data.jobId).toBe('j721');
    expect(retried.data.genStatus).toBe('generating');
    expect(retried.data.errorText).toBe('');
  });

  it('入队失败经轮询呈现：enqueue_failed 映射「任务入队失败，请重试」', async () => {
    apiMocks.createVocalSplit.mockResolvedValueOnce({ job_id: 'j730', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j730', status: 'failed', progress: 0,
      error: { code: 'enqueue_failed', msg: '' },
    });
    await renderPage();
    await enterVocal();
    await sendVocal();
    const failed = placeholderNode()!;
    expect(failed.data.genStatus).toBe('failed');
    expect(failed.data.errorText).toBe('任务入队失败，请重试');
  });

  it('轮询终态 succeeded 但无 tracks：空轨防御路径 = 占位卡停生成中（progress 100、genStatus 清除）不扇出（成功逐轨扇出由 vocalSplitFanout.test 覆盖）', async () => {
    apiMocks.createVocalSplit.mockResolvedValueOnce({ job_id: 'j740', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j740', status: 'succeeded', progress: 100,
      asset: { id: 'a1', url: 'http://tos/voice.aac', type: 'audio' },
    });
    await renderPage();
    await enterVocal();
    await sendVocal();
    const settled = placeholderNode()!;
    expect(settled.data.genStatus).toBeUndefined();
    expect(settled.data.progress).toBe(100);
    expect(settled.data.src).toBe('');
    expect(settled.data.assetId).toBeUndefined();
  });
});

it.each(['success', 'failure'] as const)('同卡关闭重开后的旧 %s 不改变新场景、格式和界面锁', async (outcome) => {
  let acceptOld!: (value: { job_id: string; status: string }) => void;
  let rejectOld!: (error: Error) => void;
  let acceptNew!: (value: { job_id: string; status: string }) => void;
  apiMocks.createVocalSplit.mockImplementationOnce(() => new Promise((resolve, reject) => { acceptOld = resolve; rejectOld = reject; }));
  apiMocks.createVocalSplit.mockImplementationOnce(() => new Promise((resolve) => { acceptNew = resolve; }));
  apiMocks.fetchJobStatus.mockResolvedValue({ status: 'processing', progress: 1, asset: null });
  await renderPage();
  await enterVocal();
  await click('vocal-split-send-btn');
  await enterVocal();
  await selectScene('drama'); await selectFormat('flac');
  await click('vocal-split-send-btn');
  await act(async () => {
    if (outcome === 'success') acceptOld({ job_id: 'old', status: 'queued' });
    else rejectOld(new Error('old request failure'));
  });
  expect(document.body.textContent).not.toContain('人声背景分离任务创建失败');
  const placeholdersAfterOld = (flowProps.current.mediaNodes as Node[]).filter((n) => isVocalSplitNodeId(n.id));
  if (outcome === 'success') expect(placeholdersAfterOld.some((n) => n.data.jobId === 'old')).toBe(true);
  await act(async () => { acceptNew({ job_id: 'new', status: 'queued' }); });
  expect(toolbar()).toBeNull();
  const placeholders = (flowProps.current.mediaNodes as Node[]).filter((n) => isVocalSplitNodeId(n.id));
  expect(placeholders.find((n) => n.data.jobId === 'new')!.data.vocalSplit).toEqual({
    sourceAssetId: '5', lastInput: { source_asset_id: '5', scene: 'drama', output_format: 'flac' },
  });
});
