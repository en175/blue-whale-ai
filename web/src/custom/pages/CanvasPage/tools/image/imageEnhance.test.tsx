// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../../index';
import { IMAGE_ENHANCE_EDGE_ORIGIN } from './imageEnhance';
import { imageMediaRefsOf } from '../../media/mediaRefs';
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
vi.mock('../../hooks/document/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'i1',
          type: 'mediaNode',
          position: { x: 400, y: 0 },
          data: { src: 'http://img/i1.png', mediaType: 'image', fileName: '素材图', assetId: 'a5', width: 1600, height: 900 },
        },
      ],
      edges: [],
    },
    assets: {
      a5: { asset_id: 5, type: 'image', access_url: 'http://img/i1.png', width: 1600, height: 900 },
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

async function enhanceImage() {
  const image = flowProps.current.mediaNodes.find((n: Node) => n.id === 'i1')!;
  await act(async () => {
    image.data.onEnhanceImage('i1');
  });
}

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

describe('IKGM9F 高清放大建卡链', () => {
  it('点击后在源卡右侧建「高清」草稿卡：标记、标题、占位身份字段齐备', async () => {
    await renderPage();
    await enhanceImage();

    const mediaNodes = flowProps.current.mediaNodes as Node[];
    const draft = mediaNodes.find((n) => n.id !== 'i1')!;
    expect(draft.type).toBe('mediaNode');
    const data = draft.data as Record<string, unknown>;
    expect(data.fileName).toBe('高清');
    expect(data.genStatus).toBe('draft');
    expect(data.draft).toBe(true);
    expect(data.mediaType).toBe('image');
    expect(data.imageEnhance).toEqual({ sourceAssetId: 'a5' });
    expect(draft.position).toEqual({ x: 958, y: 0 });
    const source = mediaNodes.find((n) => n.id === 'i1')!;
    expect((source.data as Record<string, unknown>).src).toBe('http://img/i1.png');
  });

  it('自动连一条纯视觉来源边：带 origin 标记、无参考角色，源图不占参考位', async () => {
    await renderPage();
    await enhanceImage();

    const draftId = (flowProps.current.mediaNodes as Node[]).find((n) => n.id !== 'i1')!.id;
    const edges = flowProps.current.edges as Array<{ id: string; source: string; target: string; data?: Record<string, unknown> }>;
    const edge = edges.find((e) => e.target === draftId)!;
    expect(edge).toBeTruthy();
    expect(edge.source).toBe('i1');
    expect(edge.data).toEqual({ origin: IMAGE_ENHANCE_EDGE_ORIGIN });
    expect(imageMediaRefsOf(draftId, edges as never[], flowProps.current.mediaNodes)).toEqual([]);
  });

  it('自动选中新卡（源卡取消选中）', async () => {
    await renderPage();
    await enhanceImage();

    const draftId = (flowProps.current.mediaNodes as Node[]).find((n) => n.id !== 'i1')!.id;
    expect(flowProps.current.selectRequest).toEqual(expect.objectContaining({ id: draftId }));
    const draft = (flowProps.current.mediaNodes as Node[]).find((n) => n.id === draftId)!;
    expect(draft.selected).toBe(true);
    const source = (flowProps.current.mediaNodes as Node[]).find((n) => n.id === 'i1')!;
    expect(source.selected).toBeFalsy();
  });

  it('草稿卡来源再点高清放大被预检拒绝，不建卡', async () => {
    await renderPage();
    await enhanceImage();
    const draft = (flowProps.current.mediaNodes as Node[]).find((n) => n.id !== 'i1')!;

    await act(async () => {
      ((draft.data as Record<string, unknown>).onEnhanceImage as (id: string) => void)(draft.id);
    });
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
  });
});
