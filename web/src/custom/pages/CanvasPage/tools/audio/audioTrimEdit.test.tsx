// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../../index';
import { AUDIO_TRIM_EDGE_ORIGIN } from './audioTrim';
import type { GenerationModel } from '@/custom/api/generation';

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
  createConversationQuote: vi.fn(),
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
  createAudioTrim: apiMocks.createAudioTrim,
  readJobFailText: apiMocks.readJobFailText,
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
          id: 'a1',
          type: 'mediaNode',
          position: { x: 400, y: 0 },
          data: {
            src: 'http://aud/a1.mp3',
            mediaType: 'audio',
            fileName: '播客片头.mp3',
            assetId: '8',
            duration: 15,
            mime: 'audio/mpeg',
          },
        },
        {
          id: 'v1',
          type: 'mediaNode',
          position: { x: 1000, y: 0 },
          data: {
            src: 'http://vid/v1.mp4',
            mediaType: 'video',
            fileName: '素材视频',
            assetId: '6',
            width: 1920,
            height: 1080,
            duration: 30,
            mime: 'video/mp4',
          },
        },
      ],
      edges: [],
    },
    assets: {
      8: { asset_id: 8, type: 'audio', access_url: 'http://aud/a1.mp3', duration: 15 },
      6: { asset_id: 6, type: 'video', access_url: 'http://vid/v1.mp4', width: 1920, height: 1080 },
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
        { client: new QueryClient() },
        createElement(MemoryRouter, null, createElement(CanvasPage)),
      ),
    );
  });
}

async function enterTrim() {
  const audio = flowProps.current.mediaNodes.find((n: Node) => n.id === 'a1')!;
  await act(async () => {
    audio.data.onTrimAudio('a1');
  });
}

function a1Data(): Record<string, unknown> {
  const audio = (flowProps.current.mediaNodes as Node[]).find((n) => n.id === 'a1')!;
  return audio.data as Record<string, unknown>;
}

function bodyBtn(testId: string): HTMLButtonElement {
  return document.body.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;
}

async function click(testId: string) {
  await act(async () => {
    bodyBtn(testId).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function sendBar(): HTMLElement | null {
  return document.body.querySelector('[data-testid="audio-trim-send-bar"]');
}

async function selectFormat(format: string) {
  await click('audio-trim-format-trigger');
  await click(`audio-trim-format-item-${format}`);
}

async function sendTrim() {
  await click('audio-trim-send-btn');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

function trimCard(): Node | undefined {
  return (flowProps.current.mediaNodes as Node[]).find((n) => n.id !== 'a1' && n.id.startsWith('audio-trim-'));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiMocks.createAudioTrim.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKHB7A 编辑态呈现（进入不建任务）', () => {
  it('进入编辑态：默认全选 0 到全长、发送条五要素、格式默认跟随源格式（mp3）；trimEditing 与 soloToolbarHidden 注入源卡；不建任务不建卡', async () => {
    await renderPage();
    await enterTrim();
    const trimEditing = a1Data().trimEditing as { selection: { start: number; end: number }; duration: number };
    expect(trimEditing).toBeTruthy();
    expect(trimEditing.selection).toEqual({ start: 0, end: 15 });
    expect(trimEditing.duration).toBe(15);
    expect(a1Data().soloToolbarHidden).toBe(true);
    expect(sendBar()).toBeTruthy();
    expect(bodyBtn('audio-trim-close')).toBeTruthy();
    expect(document.querySelector('[data-testid="audio-trim-range"]')!.textContent).toBe('00:00 - 00:15');
    expect(bodyBtn('audio-trim-format-trigger').textContent).toBe('mp3');
    expect(bodyBtn('audio-trim-send-btn')).toBeTruthy();
    expect(apiMocks.createAudioTrim).not.toHaveBeenCalled();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('与其他工具编辑会话互斥：分离会话中点截取，分离发送条退出、截取发送条接管（反向亦然）', async () => {
    await renderPage();
    const video = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!;
    await act(async () => {
      video.data.onAudioVideoSplit('v1');
    });
    expect(document.body.querySelector('[data-testid="audio-video-split-send-bar"]')).toBeTruthy();
    await enterTrim();
    expect(document.body.querySelector('[data-testid="audio-video-split-send-bar"]')).toBeNull();
    expect(sendBar()).toBeTruthy();
    expect(a1Data().trimEditing).toBeTruthy();
    await act(async () => {
      video.data.onAudioVideoSplit('v1');
    });
    expect(sendBar()).toBeNull();
    expect(a1Data().trimEditing).toBeUndefined();
    expect(document.body.querySelector('[data-testid="audio-video-split-send-bar"]')).toBeTruthy();
  });
});

describe('IKHB7A 四退出：未发送退出画布无痕迹', () => {
  it('X 退出：无卡、无边、无任务、trimEditing 移除（试听与遮罩恢复）', async () => {
    await renderPage();
    await enterTrim();
    await click('audio-trim-close');
    expect(sendBar()).toBeNull();
    expect(a1Data().trimEditing).toBeUndefined();
    expect(a1Data().soloToolbarHidden).toBeUndefined();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    expect(flowProps.current.edges).toEqual([]);
    expect(apiMocks.createAudioTrim).not.toHaveBeenCalled();
  });

  it('Esc 退出：同口径无痕迹', async () => {
    await renderPage();
    await enterTrim();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(sendBar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('点其他卡退出（单选非目标）；空选中不退出', async () => {
    await renderPage();
    await enterTrim();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [{ id: 'v1' }] });
    });
    expect(sendBar()).toBeNull();
    await enterTrim();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [] });
    });
    expect(sendBar()).not.toBeNull();
  });

  it('点画布空白退出（PaneClick）', async () => {
    await renderPage();
    await enterTrim();
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(sendBar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('重复进入幂等：选区回默认全选、格式回源格式（进入重置不跨会话记忆）', async () => {
    await renderPage();
    await enterTrim();
    await selectFormat('wav');
    expect(bodyBtn('audio-trim-format-trigger').textContent).toBe('wav');
    await click('audio-trim-close');
    expect(a1Data().trimEditing).toBeUndefined();
    await enterTrim();
    const trimEditing = a1Data().trimEditing as { selection: { start: number; end: number } };
    expect(trimEditing.selection).toEqual({ start: 0, end: 15 });
    expect(bodyBtn('audio-trim-format-trigger').textContent).toBe('mp3');
  });
});

describe('IKHB7A 发送闭环（建任务→占位卡→终态→重试）', () => {
  it('抓手拖拽实时联动发送条时间范围（遮罩上抛 onSelectionChange → 受控刷新）', async () => {
    await renderPage();
    await enterTrim();
    const onSelectionChange = (a1Data().trimEditing as { onSelectionChange: (s: { start: number; end: number }) => void }).onSelectionChange;
    await act(async () => {
      onSelectionChange({ start: 2.4, end: 13 });
    });
    expect(document.querySelector('[data-testid="audio-trim-range"]')!.textContent).toBe('00:02 - 00:13');
  });

  it('发送（中间段）：贴边省略不触发、两位小数收口、先退编辑态再建占位卡、来源边 origin=audio-trim、身份冻结 lastInput', async () => {
    apiMocks.createAudioTrim.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterTrim();
    await act(async () => {
      (a1Data().trimEditing as { onSelectionChange: (s: { start: number; end: number }) => void }).onSelectionChange({ start: 2.4, end: 13 });
    });
    await sendTrim();
    expect(apiMocks.createAudioTrim).toHaveBeenCalledWith('p1', {
      source_asset_id: '8',
      start_time: 2.4,
      end_time: 13,
      output_format: 'mp3',
    }, expect.objectContaining({ silent: true }));
    expect(sendBar()).toBeNull();
    expect(a1Data().trimEditing).toBeUndefined();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(3);
    const placeholder = trimCard()!;
    expect(placeholder.data.fileName).toBe('播客片头(截取).mp3');
    expect(placeholder.data.mediaType).toBe('audio');
    expect(placeholder.data.genStatus).toBe('generating');
    expect(placeholder.position.x).toBe(400 + 480 + 60);
    expect(placeholder.data.audioTrim).toEqual({
      sourceAssetId: '8',
      lastInput: { source_asset_id: '8', start_time: 2.4, end_time: 13, output_format: 'mp3' },
    });
    const edge = (flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>)
      .find((e) => e.target === placeholder.id)!;
    expect(edge.source).toBe('a1');
    expect(edge.data).toEqual({ origin: AUDIO_TRIM_EDGE_ORIGIN });
  });

  it('发送（全选双贴边）：start_time/end_time 键都不出现（走官方默认片头片尾）；格式切换后发送跟随所选', async () => {
    apiMocks.createAudioTrim.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterTrim();
    await selectFormat('flac');
    await sendTrim();
    expect(apiMocks.createAudioTrim).toHaveBeenCalledTimes(1);
    expect(apiMocks.createAudioTrim).toHaveBeenCalledWith('p1', {
      source_asset_id: '8',
      output_format: 'flac',
    }, expect.objectContaining({ silent: true }));
    expect(trimCard()!.data.fileName).toBe('播客片头(截取).flac');
  });

  it('创建失败（网络）：失败卡可重试（IKJJR3 提交点即交接，会话已退）', async () => {
    apiMocks.createAudioTrim.mockRejectedValue(new Error('network down'));
    await renderPage();
    await enterTrim();
    await sendTrim();
    await act(async () => {});
    expect(apiMocks.createAudioTrim).toHaveBeenCalledTimes(1);
    expect(sendBar()).toBeNull();
    const failed = trimCard()!;
    expect(failed.data.genStatus).toBe('failed');
    expect((flowProps.current.edges as unknown[]).length).toBe(1);
  });

  it('轮询终态 succeeded：占位卡收敛为成品音频卡（src/assetId/火山权威时长回填、展示名保留）', async () => {
    apiMocks.createAudioTrim.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j1', status: 'succeeded', progress: 100,
      asset: { id: 'a88', url: 'http://tos/x.mp3', type: 'audio', duration: 10.62 },
    });
    await renderPage();
    await enterTrim();
    await sendTrim();
    const done = trimCard()!;
    expect(done.data.genStatus).toBeUndefined();
    expect(done.data.progress).toBe(100);
    expect(done.data.src).toBe('http://tos/x.mp3');
    expect(done.data.assetId).toBe('a88');
    expect(done.data.duration).toBe(10.62);
    expect(done.data.fileName).toBe('播客片头(截取).mp3');
  });

  it('轮询终态 failed：1048 兜底码映射可读文案；带身份卡原参数重试建新任务并收敛成品', async () => {
    apiMocks.createAudioTrim.mockResolvedValueOnce({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j1', status: 'failed', progress: 1,
      error: { code: 'audio_trim_failed', msg: '' },
    });
    await renderPage();
    await enterTrim();
    await act(async () => {
      (a1Data().trimEditing as { onSelectionChange: (s: { start: number; end: number }) => void }).onSelectionChange({ start: 2.4, end: 13 });
    });
    await sendTrim();
    const failed = trimCard()!;
    expect(failed.data.genStatus).toBe('failed');
    expect(failed.data.errorText).toBe('音频截取失败，请重试');

    apiMocks.createAudioTrim.mockResolvedValueOnce({ job_id: 'j2', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j2', status: 'succeeded', progress: 100,
      asset: { id: 'a89', url: 'http://tos/y.mp3', type: 'audio', duration: 10.6 },
    });
    await act(async () => {
      (failed.data.onRetryJob as (id: string) => void)(failed.id);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(apiMocks.createAudioTrim).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '8',
      start_time: 2.4,
      end_time: 13,
      output_format: 'mp3',
    }, expect.objectContaining({ silent: true }));
    const retried = trimCard()!;
    expect(retried.data.jobId).toBe('j2');
    expect(retried.data.genStatus).toBeUndefined();
    expect(retried.data.src).toBe('http://tos/y.mp3');
  });
});
