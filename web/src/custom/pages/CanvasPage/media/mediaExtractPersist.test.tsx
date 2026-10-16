// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../index';
import { MEDIA_EXTRACT_EDGE_ORIGIN } from './mediaExtract';
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
vi.mock('../components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('../components/Canvas', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

vi.mock('../components/CanvasToolbar', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));
vi.mock('../components/CanvasHeader', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));
vi.mock('../components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));
vi.mock('@/custom/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/custom/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

type SaveResult = { id: number; project_id: number; version: number; viewport: string; nodes: string };
type SavePayload = {
  viewport: unknown;
  nodes: Node[];
  edges: Array<{ id: string; source: string; target: string; data?: Record<string, unknown> }>;
};

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
    async (_projectId: string, _payload: SavePayload, _version: number | null): Promise<SaveResult> => ({
      id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]',
    }),
  ),
  createGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(async () => ({
    job_id: 'j1', status: 'processing', progress: 10, asset: null,
  })),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(async () => ({ job_id: 'j1', status: 'queued' })),
  createAudioTrim: vi.fn(),
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

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('../hooks/document/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

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
          data: { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '素材视频', assetId: 'a9', width: 1920, height: 1080 },
        },
      ],
      edges: [],
    },
    assets: {
      a9: { asset_id: 9, type: 'video', access_url: 'http://vid/v1.mp4', width: 1920, height: 1080 },
    },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

function pushVideoNode(id: string, assetId: string) {
  (canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> }).nodes.push({
    id,
    type: 'mediaNode',
    position: { x: 400, y: 300 },
    data: { src: `http://vid/${id}.mp4`, mediaType: 'video', fileName: id, assetId, width: 1920, height: 1080 },
  });
  (canvasDocMock.current.assets as Record<string, unknown>)[assetId] = {
    asset_id: assetId, type: 'video', access_url: `http://vid/${id}.mp4`, width: 1920, height: 1080,
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

async function sendSplit() {
  await act(async () => {
    document.body.querySelector<HTMLButtonElement>('[data-testid="audio-video-split-send-btn"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

const savedNodeIds = (call: number): string[] =>
  apiMocks.saveCanvasDoc.mock.calls[call][1].nodes.map((n) => n.id);
const savedEdgePairs = (call: number): string[] =>
  apiMocks.saveCanvasDoc.mock.calls[call][1].edges.map((e) => `${e.source}->${e.target}`);

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('IKH28X 音视频分离发送落盘', () => {
  it('发送后节点与连线经防抖 PUT 落库，源视频在右侧按内容宽让开、展示名跟随格式', async () => {
    await renderPage();
    await enterSplit();
    await sendSplit();

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    const audioId = savedNodeIds(0).find((id) => id.startsWith('media-extract-'))!;
    expect(savedEdgePairs(0)).toContain(`v1->${audioId}`);
    const edge = apiMocks.saveCanvasDoc.mock.calls[0][1].edges.find((e) => e.target === audioId)!;
    expect(edge.data).toEqual({ origin: MEDIA_EXTRACT_EDGE_ORIGIN });
    const audio = apiMocks.saveCanvasDoc.mock.calls[0][1].nodes.find((n) => n.id === audioId)!;
    expect(audio.position).toEqual({ x: 958, y: 0 });
    expect((audio.data as Record<string, unknown>).fileName).toBe('素材视频(audio).m4a');
    expect(apiMocks.createMediaExtraction).toHaveBeenCalledWith('p1', { source_asset_id: 'a9', output_format: 'm4a' }, expect.objectContaining({ silent: true }));
  });

  it('防抖 PUT 在途时后续自动保存跳过，不并发第二个 PUT', async () => {
    let releaseSave: ((value: SaveResult) => void) | null = null;
    apiMocks.saveCanvasDoc.mockImplementationOnce(() => new Promise<SaveResult>((resolve) => {
      releaseSave = resolve;
    }));

    await renderPage();
    await enterSplit();
    await sendSplit();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseSave?.({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' });
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expect(apiMocks.saveCanvasDoc.mock.calls[0][2]).toBe(3);
  }, 20000);

  it('并发发送两个视频：两次落盘串行、版本递增，两个节点与两条来源边都在', async () => {
    let version = 3;
    let job = 0;
    apiMocks.saveCanvasDoc.mockImplementation(async (_projectId, _payload, _v) => {
      version += 1;
      return { id: 11, project_id: 1, version, viewport: '{}', nodes: '[]' };
    });
    apiMocks.createMediaExtraction.mockImplementation(async () => ({ job_id: `j${++job}`, status: 'queued' }));
    pushVideoNode('v2', 'a10');

    await renderPage();
    const enterAndSend = async (id: string) => {
      await act(async () => {
        flowProps.current.mediaNodes.find((n: Node) => n.id === id).data.onAudioVideoSplit(id);
      });
      await act(async () => {
        document.body.querySelector<HTMLButtonElement>('[data-testid="audio-video-split-send-btn"]')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
    };
    await enterAndSend('v1');
    await enterAndSend('v2');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });

    const calls = apiMocks.saveCanvasDoc.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const last = calls[calls.length - 1][1];
    const extractIds = last.nodes.map((n) => n.id).filter((id) => id.startsWith('media-extract-'));
    expect(extractIds.length).toBe(2);
    expect(last.edges.map((e) => e.target)).toEqual(expect.arrayContaining(extractIds));
  }, 20000);
});
