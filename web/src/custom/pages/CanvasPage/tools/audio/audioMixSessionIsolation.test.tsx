// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../../index';
import { AUDIO_MIX_EDGE_ORIGIN } from './audioMix';
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

type FlowProps = { mediaNodes: Node[]; edges: Array<{ source: string; target: string; data?: Record<string, unknown> }> };
const flowProps: { current: FlowProps } = { current: { mediaNodes: [], edges: [] } };
vi.mock('../../components/Canvas/index', () => ({
  default: (props: FlowProps) => {
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
  createAudioMix: vi.fn(),
  newIdempotencyKey: vi.fn(),
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
  createAudioMix: apiMocks.createAudioMix,
  newIdempotencyKey: apiMocks.newIdempotencyKey,
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
          id: 'a2',
          type: 'mediaNode',
          position: { x: 1000, y: 0 },
          data: {
            src: 'http://aud/a2.mp3',
            mediaType: 'audio',
            fileName: '背景乐.mp3',
            assetId: '6',
            duration: 30,
            mime: 'audio/mpeg',
          },
        },
      ],
      edges: [],
    },
    assets: {
      8: { asset_id: 8, type: 'audio', access_url: 'http://aud/a1.mp3', duration: 15 },
      6: { asset_id: 6, type: 'audio', access_url: 'http://aud/a2.mp3', duration: 30 },
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

async function enterMix() {
  const audio = flowProps.current.mediaNodes.find((n: Node) => n.id === 'a1')!;
  await act(async () => {
    (audio.data.onMixAudio as (id: string) => void)('a1');
  });
}

function bodyBtn(testId: string): HTMLButtonElement {
  return document.body.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;
}

async function click(testId: string) {
  await act(async () => {
    bodyBtn(testId).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function armSession(format: 'mp3' | 'wav') {
  await click('audio-mix-add');
  await click('audio-mix-candidate-a2');
  await click('audio-mix-format-trigger');
  await click(`audio-mix-format-${format}`);
}

async function sendMix() {
  await click('audio-mix-send');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

async function pressEsc() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

const flush = () => act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
});

function sendBar(): HTMLElement | null {
  return document.body.querySelector('[data-testid="audio-mix-send-bar"]');
}

function mixCardByJobId(jobId: string): Node | undefined {
  return (flowProps.current.mediaNodes as Node[]).find(
    (n) => n.id.startsWith('audio-mix-') && String(n.data?.jobId) === jobId,
  );
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiMocks.createAudioMix.mockReset();
  apiMocks.newIdempotencyKey.mockReset();
  apiMocks.newIdempotencyKey.mockImplementation(() => 'session-iso-key');
  apiMocks.saveCanvasDoc.mockReset();
  apiMocks.saveCanvasDoc.mockResolvedValue({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' });
  apiMocks.fetchJobStatus.mockReset();
  apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKI8L8 音频混合会话纪元：Esc 在途退出重开后旧响应不打扰新会话', () => {
  it('当前混合任务受理后建卡并轮询；首保存骨架移除后落盘失败不阻断任务追踪', async () => {
    apiMocks.createAudioMix.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    await renderPage();
    await enterMix();
    await armSession('mp3');

    await sendMix();
    await flush();

    expect(mixCardByJobId('j1')).toBeTruthy();
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j1');
  });


  it('旧成功迟到：新会话仍开、WAV 保留；旧任务照常建卡连线首保存轮询；锁释放后可再发送', async () => {
    let resolveOld!: (value: { job_id: string; status: string }) => void;
    apiMocks.createAudioMix.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    apiMocks.createAudioMix.mockResolvedValue({ job_id: 'j2', status: 'queued' });
    await renderPage();
    await enterMix();
    await armSession('wav');
    await sendMix();
    expect(apiMocks.createAudioMix).toHaveBeenCalledTimes(1);
    expect(bodyBtn('audio-mix-close').disabled).toBe(true);
    expect(bodyBtn('audio-mix-send').disabled).toBe(true);
    await pressEsc();
    expect(sendBar()).toBeNull();
    await enterMix();
    await armSession('wav');
    expect(bodyBtn('audio-mix-format-trigger').textContent).toContain('wav');
    await act(async () => { resolveOld({ job_id: 'j1', status: 'queued' }); });
    await flush();
    expect(sendBar()).not.toBeNull();
    expect(bodyBtn('audio-mix-format-trigger').textContent).toContain('wav');
    const placeholder = mixCardByJobId('j1')!;
    expect(placeholder).toBeTruthy();
    expect(placeholder.data).toMatchObject({ fileName: '混合结果.wav', genStatus: 'generating', jobId: 'j1' });
    const lines = (flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>)
      .filter((edge) => edge.target === placeholder.id);
    expect(lines.map((edge) => [edge.source, edge.data?.origin]))
      .toEqual([['a1', AUDIO_MIX_EDGE_ORIGIN], ['a2', AUDIO_MIX_EDGE_ORIGIN]]);
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j1');
    expect(bodyBtn('audio-mix-send').disabled).toBe(false);
    await sendMix();
    expect(apiMocks.createAudioMix).toHaveBeenCalledTimes(2);
    expect(apiMocks.createAudioMix).toHaveBeenLastCalledWith('p1', expect.objectContaining({ output_format: 'wav' }), expect.objectContaining({ silent: true }));
    expect(sendBar()).toBeNull();
    expect(mixCardByJobId('j2')).toBeTruthy();
  });

  it('旧失败迟到：新会话状态参数不变、无旧错误提示、无占位卡；锁释放后可再发送', async () => {
    let rejectOld!: (error: unknown) => void;
    apiMocks.createAudioMix.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    apiMocks.createAudioMix.mockResolvedValue({ job_id: 'j2', status: 'queued' });
    await renderPage();
    await enterMix();
    await armSession('wav');
    await sendMix();
    expect(bodyBtn('audio-mix-close').disabled).toBe(true);
    await pressEsc();
    await enterMix();
    await armSession('wav');
    await act(async () => { rejectOld(new Error('旧会话时代的创建失败')); });
    await flush();
    expect(sendBar()).not.toBeNull();
    expect(bodyBtn('audio-mix-format-trigger').textContent).toContain('wav');
    expect(bodyBtn('audio-mix-send').disabled).toBe(false);
    expect(document.body.textContent).not.toContain('旧会话时代的创建失败');
    expect(document.body.textContent).not.toContain('音频混合任务创建失败');
    expect((flowProps.current.mediaNodes as Node[]).filter((node) => node.id.startsWith('audio-mix-'))).toEqual([]);
    expect(flowProps.current.edges).toEqual([]);
    await sendMix();
    expect(apiMocks.createAudioMix).toHaveBeenCalledTimes(2);
    expect(mixCardByJobId('j2')).toBeTruthy();
    expect(sendBar()).toBeNull();
  });
});
