// @vitest-environment jsdom
/* IKI68X 三来源和多段选材的 CanvasPage 集成验收。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { AUDIO_MIX_EDGE_ORIGIN } from './audioMix';
import type { GenerationModel } from '@/api/generation';

vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

/** FlowCanvas 打桩：透出 props 供测试读取节点与触发画布回调 */
type FlowProps = { mediaNodes: Node[]; edges: Array<{ source: string; target: string; data?: Record<string, unknown> }>; onDeleteNode?: (ids: string[]) => void; onViewportChange?: (viewport: { x: number; y: number; zoom: number }) => void };
const flowProps: { current: FlowProps } = { current: { mediaNodes: [], edges: [] } };
vi.mock('./components/Canvas', () => ({
  default: (props: FlowProps) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

vi.mock('./components/CanvasToolbar', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));

vi.mock('./components/CanvasHeader', () => ({
  default: ({ currentProjectId, onSelectProject }: { currentProjectId: string; onSelectProject: (id: string) => void }) =>
    createElement('button', { 'data-testid': 'switch-p2', onClick: () => onSelectProject('p2') }, currentProjectId),
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
  fetchQuota: vi.fn(async () => ({})),
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
  fetchAssetPage: vi.fn(),
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
  fetchQuota: apiMocks.fetchQuota,
  toSessionUser: apiMocks.toSessionUser,
}));
vi.mock('@/api/assets', () => ({
  UPLOAD_SIZE_LIMIT: 100 * 1024 * 1024,
  fetchUploadPresign: vi.fn(),
  putToPresignedUrl: vi.fn(),
  completeUpload: vi.fn(),
  fetchAllAssets: vi.fn(async () => []),
  fetchAssetDetail: vi.fn(),
  assetPageQueryOptions: () => ({ queryKey: ["assets", "audio", 30], initialPageParam: 1, queryFn: () => apiMocks.fetchAssetPage(), getNextPageParam: () => undefined }),
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
  createAudioMix: apiMocks.createAudioMix,
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

/** 画布：一个就绪音频节点 a1（15 秒 mp3，assetId 满足置灰门槛；无连线）+ 一个视频卡
 *  v1（互斥用例的分离会话源卡） */
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

/** 从音频卡工具栏进入混合编辑态。 */
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

/** 等创建请求与首轮轮询完成。 */
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
  apiMocks.fetchAssetPage.mockReset();
  apiMocks.fetchAssetPage.mockResolvedValue({ records: [{ id: 7, type: "audio", url: "http://aud/7.mp3", duration: null, width: null, height: null, source: "uploaded", model: null, created_at: null }], total: 1, current: 1, size: 30 });
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
    await sendMix();
    expect(apiMocks.createAudioMix).toHaveBeenCalledWith('p1', {
      source_node_id: 'a1',
      inputs: [
        { asset_id: '8', node_id: 'a1' },
        { asset_id: '6', node_id: 'a2' },
        { asset_id: '7' },
        { asset_id: '9' },
      ],
      output_format: 'wav',
    }, { silent: true });
    expect(flowProps.current.edges.filter((edge) => edge.target === 'audio-mix-j1')
      .map((edge) => [edge.source, edge.data?.origin])).toEqual([
        ['a1', AUDIO_MIX_EDGE_ORIGIN], ['a2', AUDIO_MIX_EDGE_ORIGIN],
      ]);
    expect(flowProps.current.mediaNodes.map((node) => node.id).sort()).toEqual(['a1', 'a2', 'audio-mix-j1']);
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
});
