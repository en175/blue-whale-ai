// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CanvasPage from '../index';
import pageStyles from '../index.module.css';
import { SNAP_ALIGNMENT_STORAGE_KEY } from './snapPreference';


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
  default: () => null,
}));

const flowCanvasProps: { current?: ComponentProps<typeof import('../components/Canvas').default> } = {};

vi.mock('../components/Canvas', () => ({
  default: (props: unknown) => {
    flowCanvasProps.current = props as never;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

vi.mock('../components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

vi.mock('@/custom/components/UserDropdown/RechargeModal', () => ({
  default: () => null,
}));

vi.mock('@/custom/pages/Assets/components/AssetDetailModal', () => ({
  default: () => null,
}));

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchMe: vi.fn(async () => null),
  fetchCredits: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
}));

vi.mock('@/custom/api/projects', () => ({
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
  projectKeys: {
    all: ['projects'],
    pages: (size: number) => ['projects', 'pages', size],
  },
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
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => Promise.resolve({ items: [] }), retry: false }),
  applyPromptPreview: vi.fn(),
  saveCanvasDoc: vi.fn(),
  serializeNodes: vi.fn(() => '[]'),
  serializeEdges: vi.fn(() => '[]'),
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
}));

vi.mock('@/custom/api/generation', () => ({ fetchGenerationModels: vi.fn(async () => []) }));

vi.mock('@/custom/api/jobs', () => ({
  createGenerationJob: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  readJobFailText: vi.fn(() => ''),
}));

vi.mock('@/custom/api/sharedAssets', () => ({
  saveSharedAsset: vi.fn(),
}));

const canvasDocMock = vi.hoisted(() => ({
  doc: { id: null, version: null, viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] },
  assets: {},
  refetch: vi.fn(),
}));

vi.mock('../hooks/document/useCanvasDoc', () => ({
  useCanvasDoc: () => canvasDocMock,
}));

let root: Root;
let container: HTMLDivElement;

function snapToggleBtn() {
  return container.querySelector<HTMLElement>('button[title*="对齐吸附"]')!;
}

async function renderPage() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          MemoryRouter,
          { initialEntries: ['/canvas?project=p1'] },
          createElement(CanvasPage),
        ),
      ),
    );
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('画布左下角对齐吸附开关（IKGGCT T3）', () => {
  it('初始渲染读 localStorage：无记录默认开——按钮激活态且 FlowCanvas 收到开启', async () => {
    await renderPage();

    expect(snapToggleBtn()).not.toBeNull();
    expect(snapToggleBtn().classList.contains(pageStyles.mapBtnActive)).toBe(true);
    expect(flowCanvasProps.current!.snapAlignmentEnabled).toBe(true);
  });

  it("初始渲染读 localStorage：存 'off' 时关闭——按钮无激活态且 FlowCanvas 收到关闭", async () => {
    localStorage.setItem(SNAP_ALIGNMENT_STORAGE_KEY, 'off');
    await renderPage();

    expect(snapToggleBtn().classList.contains(pageStyles.mapBtnActive)).toBe(false);
    expect(flowCanvasProps.current!.snapAlignmentEnabled).toBe(false);
  });

  it('点击磁铁按钮：激活态与 FlowCanvas prop 翻转，localStorage 写入新值；再点翻回', async () => {
    await renderPage();

    await act(async () => {
      snapToggleBtn().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(snapToggleBtn().classList.contains(pageStyles.mapBtnActive)).toBe(false);
    expect(flowCanvasProps.current!.snapAlignmentEnabled).toBe(false);
    expect(localStorage.getItem(SNAP_ALIGNMENT_STORAGE_KEY)).toBe('off');

    await act(async () => {
      snapToggleBtn().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(snapToggleBtn().classList.contains(pageStyles.mapBtnActive)).toBe(true);
    expect(flowCanvasProps.current!.snapAlignmentEnabled).toBe(true);
    expect(localStorage.getItem(SNAP_ALIGNMENT_STORAGE_KEY)).toBe('on');
  });
});
