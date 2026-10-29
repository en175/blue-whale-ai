// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CanvasPage from './index';
import headerStyles from './components/CanvasHeader/index.module.css';

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
vi.mock('./components/AgentPanel', () => ({
  default: ({ onClose, open }: { onClose: () => void; open: boolean }) =>
    !open ? null : createElement(
      'button',
      { 'data-testid': 'agent-panel-stub', onClick: onClose },
      'AgentPanel',
    ),
}));

vi.mock('./components/Canvas', () => ({
  default: () => createElement('div', { 'data-testid': 'flow-canvas' }),
}));

const selectorProps: {
  current?: { onSelect: (id: string) => void; onDelete: (id: string) => void };
} = {};

vi.mock('./components/ProjectSelector', () => ({
  default: (props: { onSelect: (id: string) => void; onDelete: (id: string) => void }) => {
    selectorProps.current = props;
    return createElement('div', { 'data-testid': 'project-selector' });
  },
}));

vi.mock('@/custom/components/UserDropdown/RechargeModal', () => ({
  default: () => null,
}));

vi.mock('@/custom/pages/Assets/components/AssetDetailModal', () => ({
  default: () => null,
}));

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [
    { id: 'p1', name: '项目一', last_opened_at: null as string | null, pinned_at: null as string | null },
  ]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchMe: vi.fn(async () => null),
  fetchCredits: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
}));

vi.mock('@/custom/api/projects', () => ({
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
  touchProjectLastOpened: apiMocks.touchProjectLastOpened,
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
  applyPromptPreview: vi.fn(),
  saveCanvasDoc: vi.fn(),
  serializeNodes: vi.fn(() => '[]'),
  serializeEdges: vi.fn(() => '[]'),
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

vi.mock('./hooks/document/useCanvasDoc', () => ({
  useCanvasDoc: () => canvasDocMock,
}));

let root: Root;
let container: HTMLDivElement;
let queryClient: QueryClient;

function LocationProbe() {
  const location = useLocation();
  return createElement('output', { 'data-testid': 'location' }, `${location.pathname}${location.search}`);
}

function agentEntry() {
  return container.querySelector<HTMLElement>(`.${headerStyles.agentBtn}`);
}

async function renderPage(initialEntry = '/canvas?project=p1') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          MemoryRouter,
          { initialEntries: [initialEntry] },
          createElement(CanvasPage),
          createElement(LocationProbe),
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
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

describe('CanvasPage Agent 面板接线（IKDLD4）', () => {
  it('进入画布时面板默认收起、Agent 入口可见（展开状态不持久化）', async () => {
    await renderPage();

    expect(container.querySelector('[data-testid="agent-panel-stub"]')).toBeNull();
    expect(agentEntry()).not.toBeNull();
    expect(agentEntry()!.classList.contains(headerStyles.agentBtnHidden)).toBe(false);
  });

  it('打开面板后右上角 Agent 入口隐藏，关闭后面板隐藏、入口恢复', async () => {
    await renderPage();

    await act(async () => {
      agentEntry()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[data-testid="agent-panel-stub"]')).not.toBeNull();
    expect(agentEntry()!.classList.contains(headerStyles.agentBtnHidden)).toBe(true);

    await act(async () => {
      container
        .querySelector('[data-testid="agent-panel-stub"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[data-testid="agent-panel-stub"]')).toBeNull();
    expect(agentEntry()!.classList.contains(headerStyles.agentBtnHidden)).toBe(false);
  });

  it('切换 Project 后面板收起、入口恢复（展开状态不跨项目携带）', async () => {
    await renderPage();

    await act(async () => {
      agentEntry()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[data-testid="agent-panel-stub"]')).not.toBeNull();

    await act(async () => {
      selectorProps.current!.onSelect('p2');
    });
    expect(container.querySelector('[data-testid="agent-panel-stub"]')).toBeNull();
    expect(agentEntry()!.classList.contains(headerStyles.agentBtnHidden)).toBe(false);
  });

  it('删除当前项目时清除卡片列表缓存并返回项目列表（IKDDHS）', async () => {
    apiMocks.deleteProject.mockResolvedValue(null);
    await renderPage();
    queryClient.setQueryData(['projects', 'pages', 30], { records: ['p1'] });

    await act(async () => {
      selectorProps.current!.onDelete('p1');
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/projects');
    expect(queryClient.getQueryData(['projects', 'pages', 30])).toBeUndefined();
  });
});

describe('画布恢复落点三级规则与打开即记（IKH1YK）', () => {
  const p1 = { id: 'p1', name: '项目一', last_opened_at: '2026-09-01T00:00:00Z', pinned_at: null };
  const p2 = { id: 'p2', name: '项目二', last_opened_at: '2026-09-10T00:00:00Z', pinned_at: null };

  beforeEach(() => {
    apiMocks.fetchProjects.mockClear();
    apiMocks.fetchProjects.mockResolvedValue([{ id: 'p1', name: '项目一', last_opened_at: null, pinned_at: null }]);
    apiMocks.touchProjectLastOpened.mockClear();
    apiMocks.touchProjectLastOpened.mockResolvedValue(undefined);
  });

  it('无 ?project= 时落在上次打开的画布，并记恰一次 last-opened（参数=落点）', async () => {
    apiMocks.fetchProjects.mockResolvedValue([p1, p2]);
    await renderPage('/canvas');

    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/canvas?project=p2');
    expect(apiMocks.touchProjectLastOpened).toHaveBeenCalledTimes(1);
    expect(apiMocks.touchProjectLastOpened).toHaveBeenCalledWith('p2');

    await act(async () => {});
    expect(apiMocks.touchProjectLastOpened).toHaveBeenCalledTimes(1);
  });

  it('显式 ?project= 优先于上次打开（合法值仍打开指定画布）', async () => {
    apiMocks.fetchProjects.mockResolvedValue([p1, p2]);
    await renderPage('/canvas?project=p1');

    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/canvas?project=p1');
    expect(apiMocks.touchProjectLastOpened).toHaveBeenCalledWith('p1');
  });

  it('显式与上次打开均失效时回退最新创建（首项），不弹提示', async () => {
    apiMocks.fetchProjects.mockResolvedValue([
      { id: 'pA', name: 'A', last_opened_at: null, pinned_at: null },
      { id: 'pB', name: 'B', last_opened_at: null, pinned_at: null },
    ]);
    await renderPage('/canvas?project=gone');

    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/canvas?project=pA');
    expect(apiMocks.touchProjectLastOpened).toHaveBeenCalledWith('pA');
  });

  it('last-opened 失败静默降级：页面仍正常渲染、无未捕获错误', async () => {
    apiMocks.touchProjectLastOpened.mockRejectedValue(new Error('network down'));
    await renderPage('/canvas?project=p1');

    expect(apiMocks.touchProjectLastOpened).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="flow-canvas"]')).not.toBeNull();
    expect(agentEntry()).not.toBeNull();
  });

  it('A→B→A 切换每次都记（write-through）', async () => {
    apiMocks.fetchProjects.mockResolvedValue([p1, p2]);
    await renderPage('/canvas?project=p1');
    expect(apiMocks.touchProjectLastOpened).toHaveBeenCalledTimes(1);

    await act(async () => {
      selectorProps.current!.onSelect('p2');
    });
    expect(apiMocks.touchProjectLastOpened).toHaveBeenLastCalledWith('p2');

    await act(async () => {
      selectorProps.current!.onSelect('p1');
    });
    expect(apiMocks.touchProjectLastOpened).toHaveBeenLastCalledWith('p1');
    expect(apiMocks.touchProjectLastOpened).toHaveBeenCalledTimes(3);
  });
});
