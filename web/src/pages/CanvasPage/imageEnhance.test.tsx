// @vitest-environment jsdom
/* IKGM9F 图片卡「高清放大」入口：建卡/连线/选中链。
   点工具条「高清放大」→ 源卡右侧建「高清」草稿卡（带高清身份标记）→ 连纯视觉来源边
   （origin 标记，不占参考位）→ 自动选中新卡。本票不开任何面板（IKGM9O 范围）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { IMAGE_ENHANCE_EDGE_ORIGIN } from './imageEnhance';
import { imageMediaRefsOf } from './mediaRefs';
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
}));
vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

/** FlowCanvas 打桩：透出 props 供测试读取节点/连线与触发画布回调 */
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
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
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

/* 序列化保持与真实实现同构（JSON 可序列化字段参与签名），否则签名断言失真 */
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
    JSON.stringify(edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))),
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
  readJobFailText: apiMocks.readJobFailText,
}));
vi.mock('@/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/api/generation', () => ({ fetchGenerationModels: apiMocks.fetchGenerationModels }));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));

vi.mock('@/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    queryFn: async () => ({ credits: null }),
  })),
}));

vi.mock('@/api/canvasRecovery', async (importActual) => ({
  ...(await importActual<typeof import('@/api/canvasRecovery')>()),
  fetchGenerationRecoveryPage: vi.fn(async () => ({
    protocol_version: 1,
    canvas_version: null,
    records: [],
    next_cursor: null,
  })),
  generationRecoveryPageOptions: vi.fn(() => ({
    queryKey: ['generation-recovery', 'mock'],
    queryFn: async () => ({ records: [], next_cursor: null }),
  })),
}));
vi.mock('./hooks/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

/** 画布：一个就绪图片节点 i1（assetId a5，16:9），无连线 */
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

/** 走图片节点工具栏的「高清放大」入口（回调挂在节点 data 上） */
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
    // 高清身份标记：本票只写源素材身份；lastParams 位由 IKGM9O 提交时写入
    expect(data.imageEnhance).toEqual({ sourceAssetId: 'a5' });
    // 源卡右侧让开一格：16:9 内容宽 280×16/9≈497.78 → x = 400 + 498 + 60
    expect(draft.position).toEqual({ x: 958, y: 0 });
    // 源卡不动
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
    // 纯视觉来源表达：仅 origin 标记，不携带任何参考角色
    expect(edge.data).toEqual({ origin: IMAGE_ENHANCE_EDGE_ORIGIN });
    // 图片参考推导跳过来源边：高清卡参考位为空（不参与 @ 编号与媒体索引）
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
