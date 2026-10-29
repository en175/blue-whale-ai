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
import { Toaster, toast } from 'sonner';

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

type FlowProps = { mediaNodes: Node[]; edges: Array<{ source: string; target: string; data?: Record<string, unknown> }>; onDeleteNode?: (ids: string[]) => void; onViewportChange?: (viewport: { x: number; y: number; zoom: number }) => void };
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
  default: ({ currentProjectId, onSelectProject }: { currentProjectId: string; onSelectProject: (id: string) => void }) =>
    createElement('button', { 'data-testid': 'switch-p2', onClick: () => onSelectProject('p2') }, currentProjectId),
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
  linkAssetToProject: vi.fn(),
  fetchAssetPage: vi.fn(),
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
  assetPageQueryOptions: () => ({ queryKey: ["assets", "audio", 30], initialPageParam: 1, queryFn: () => apiMocks.fetchAssetPage(), getNextPageParam: () => undefined }),
  linkAssetToProject: apiMocks.linkAssetToProject,
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
  toast.dismiss();

  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(MemoryRouter, null, createElement(CanvasPage), createElement(Toaster, { duration: Infinity })),
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

function sendBar(): HTMLElement | null {
  return document.body.querySelector('[data-testid="audio-mix-send-bar"]');
}

async function sendMix() {
  await click('audio-mix-send');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiMocks.createAudioMix.mockReset();
  let keySequence = 0;
  apiMocks.newIdempotencyKey.mockImplementation(() => `mix-key-${++keySequence}`);
  apiMocks.fetchAssetPage.mockReset();
  apiMocks.fetchAssetPage.mockResolvedValue({ records: [{ id: 7, type: "audio", status: "normal", url: "http://aud/7.mp3", duration: null, width: null, height: null, source: "uploaded", model: null, created_at: null }], total: 1, current: 1, size: 30 });
  apiMocks.linkAssetToProject.mockReset();
  apiMocks.linkAssetToProject.mockResolvedValue({ projectId: 'p1', assetId: '7' });
  apiMocks.uploadAssetFile.mockReset();
  apiMocks.saveCanvasDoc.mockReset();
  apiMocks.saveCanvasDoc.mockResolvedValue({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' });
  apiMocks.fetchProjects.mockResolvedValue([{ id: 'p1', name: '项目一' }, { id: 'p2', name: '项目二' }]);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKI68X 三来源与多段提交', () => {
  it('按画布、素材库、上传选择顺序提交，结果只连接被选中的画布卡', async () => {
    apiMocks.createAudioMix.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
    apiMocks.uploadAssetFile.mockResolvedValue({
      asset_id: '9', status: 'ready', type: 'audio', url: 'http://aud/9.mp3', duration: 40,
    });
    await renderPage();
    await enterMix();
    await click('audio-mix-add');
    await click('audio-mix-candidate-a2');
    await click('audio-mix-tab-library');
    await act(async () => { await vi.waitFor(() => expect(document.body.querySelector('[data-testid="audio-mix-library-7"]')).not.toBeNull()); });
    await click('audio-mix-library-7');
    await click('audio-mix-tab-upload');
    const file = new File(['audio'], '上传音频.mp3', { type: 'audio/mpeg' });
    const input = document.body.querySelector<HTMLInputElement>('[data-testid="audio-mix-upload-input"]')!;
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click('audio-mix-format-trigger');
    await click('audio-mix-format-wav');
    expect(apiMocks.linkAssetToProject).not.toHaveBeenCalled();
    await sendMix();
    expect(apiMocks.linkAssetToProject).toHaveBeenCalledWith('p1', '7', { silent: true });
    expect(apiMocks.linkAssetToProject).toHaveBeenCalledWith('p1', '9', { silent: true });
    expect(apiMocks.createAudioMix).toHaveBeenCalledWith('p1', {
      source_node_id: 'a1',
      inputs: [
        { asset_id: '8', node_id: 'a1' },
        { asset_id: '6', node_id: 'a2' },
        { asset_id: '7' },
        { asset_id: '9' },
      ],
      output_format: 'wav',
      canvas_binding: {
        protocol_version: 1,
        submission_id: expect.any(String),
        target_node_id: expect.stringMatching(/^audio-mix-/),
        expected_binding_revision: 0,
        recovery_seed: {
          target: { role: 'result-placeholder', x: expect.any(Number), y: expect.any(Number), width: 480, height: 284, name: '混合结果.wav' },
          sources: [
            { node_id: 'a1', x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number), name: '播客片头.mp3' },
            { node_id: 'a2', x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number), name: '背景乐.mp3' },
          ],
        },
      },
    }, { silent: true, idempotencyKey: expect.any(String) });
    const mixCard = flowProps.current.mediaNodes.find((node) => /^audio-mix-/.test(node.id) && node.id !== 'audio-mix-a1');
    expect(mixCard?.data).toMatchObject({ jobId: 'j1', genStatus: 'generating', mediaType: 'audio' });
    expect(flowProps.current.edges.filter((edge) => edge.target === mixCard!.id)
      .map((edge) => [edge.source, edge.data?.origin])).toEqual([
        ['a1', AUDIO_MIX_EDGE_ORIGIN], ['a2', AUDIO_MIX_EDGE_ORIGIN],
      ]);
    expect(flowProps.current.mediaNodes.map((node) => node.id).sort()).toEqual(['a1', 'a2', mixCard!.id].sort());
  });

  it('服务端拒绝新增资产时保留三来源选择和格式，可直接重发', async () => {
    apiMocks.createAudioMix.mockRejectedValueOnce(new Error('拒绝无权资产'));
    await renderPage();
    await enterMix();
    await click('audio-mix-add');
    await click('audio-mix-tab-library');
    await act(async () => { await vi.waitFor(() => expect(document.body.querySelector('[data-testid="audio-mix-library-7"]')).not.toBeNull()); });
    await click('audio-mix-library-7');
    await click('audio-mix-format-trigger');
    await click('audio-mix-format-flac');
    await sendMix();
    expect(sendBar()).not.toBeNull();
    expect(bodyBtn('audio-mix-send').disabled).toBe(false);
    expect(bodyBtn('audio-mix-add').textContent).toContain('2/100');
    expect(bodyBtn('audio-mix-format-trigger').textContent).toContain('flac');
    expect(flowProps.current.edges).toEqual([]);
  });

  it('跨项目素材关联失败时保留清单与格式，提示错误且不创建任务', async () => {
    apiMocks.linkAssetToProject.mockRejectedValueOnce(new Error('关联接口不可用'));
    await renderPage();
    await enterMix();
    await click('audio-mix-add');
    await click('audio-mix-tab-library');
    await act(async () => { await vi.waitFor(() => expect(document.body.querySelector('[data-testid="audio-mix-library-7"]')).not.toBeNull()); });
    await click('audio-mix-library-7');
    await click('audio-mix-format-trigger');
    await click('audio-mix-format-flac');
    expect(apiMocks.linkAssetToProject).not.toHaveBeenCalled();
    await sendMix();
    expect(sendBar()).not.toBeNull();
    expect(bodyBtn('audio-mix-add').textContent).toContain('2/100');
    expect(bodyBtn('audio-mix-format-trigger').textContent).toContain('flac');
    await vi.waitFor(() => expect(document.body.textContent).toContain('素材关联项目失败'), { timeout: 3000 });
    expect(apiMocks.createAudioMix).not.toHaveBeenCalled();
    expect(flowProps.current.edges).toEqual([]);
  });
});
