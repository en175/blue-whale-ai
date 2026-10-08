// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CanvasPage from './index';

/* IKDLQK 接线测试：打开项目的迁移报告提示（成功/失败/去重）与「迁移历史」只读入口。
   FlowCanvas/CanvasToolbar/AgentPanel 打桩；CanvasHeader 与迁移历史弹窗用真实实现。 */

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
  fetchGenerationRecoveryPage: vi.fn(async () => ({
    protocol_version: 1,
    canvas_version: null,
    records: [],
    next_cursor: null,
  })),
}));
vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

vi.mock('./components/Canvas', () => ({
  default: () => createElement('div', { 'data-testid': 'flow-canvas' }),
}));

vi.mock('./components/CanvasToolbar', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
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
  listLegacyCardHistory: vi.fn(async (_projectId: string) => ({ items: [] as Array<Record<string, unknown>> })),
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

vi.mock('@/api/canvas', () => ({
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => apiMocks.listLegacyCardHistory(projectId), retry: false }),
  applyPromptPreview: vi.fn(),
  saveCanvasDoc: vi.fn(),
  serializeNodes: vi.fn(() => '[]'),
  serializeEdges: vi.fn(() => '[]'),
  listLegacyCardHistory: apiMocks.listLegacyCardHistory,
}));

vi.mock('@/api/jobs', () => ({
  createGenerationJob: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  readJobFailText: vi.fn(() => ''),
}));

vi.mock('@/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));

/* useCanvasDoc 打桩保持外层引用稳定（见 index.test.tsx 注释）；内容经 current 按用例注入 */
const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
    legacyMigration: null as unknown,
  },
}));

vi.mock('./hooks/useCanvasDoc', () => ({
  useCanvasDoc: () => canvasDocMock.current,
}));

const HISTORY_ITEM = {
  historyId: '42',
  nodeId: 'card-1',
  title: '镜头 1',
  promptText: '迁移时的提示词正文',
  visualText: '暮色街道的画面描述',
  source: { sessionId: 's1', revisionId: 'r1', shotNo: 1 },
  cardJson: { shotTitle: '镜头 1' },
  migratedAt: '2026-09-07T01:00:00.000Z',
};

function seedDoc(over: { legacyMigration?: unknown; historyItems?: Array<Record<string, unknown>> } = {}) {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 'card-1', type: 'textNode', position: { x: 100, y: 100 }, data: { title: '镜头 1', text: '迁移后的正文' } },
      ],
      edges: [],
    },
    assets: {},
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
    legacyMigration: over.legacyMigration ?? null,
  };
  apiMocks.listLegacyCardHistory.mockImplementation(async () => ({ items: over.historyItems ?? [] }));
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

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  apiMocks.listLegacyCardHistory.mockClear();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  document.body.querySelectorAll('[data-semantic="root"]').forEach((el) => el.remove());
});

describe('旧生成卡迁移报告与历史入口（IKDLQK）', () => {
  it('本轮发生迁移时提示转换数量', async () => {
    seedDoc({ legacyMigration: { migrated: ['card-1', 'card-2'], failed: [] } });
    await renderPage();
    expect(container.textContent).toContain('已将 2 张旧生成卡转换为普通文本节点');
  });

  it('存在失败卡时给出警告提示（含标题与原因，说明原卡片已保留）', async () => {
    seedDoc({
      legacyMigration: {
        migrated: [],
        failed: [{ nodeId: 'card-9', title: '镜头 9', reason: '提示词缺失或已损坏' }],
      },
    });
    await renderPage();
    expect(container.textContent).toContain('1 张旧生成卡未能迁移');
    expect(container.textContent).toContain('镜头 9');
    expect(container.textContent).toContain('提示词缺失或已损坏');
    expect(container.textContent).toContain('原卡片已保留');
  });

  it('无迁移报告时不提示', async () => {
    seedDoc();
    await renderPage();
    expect(container.textContent).not.toContain('旧生成卡');
  });

  it('有迁移历史时顶栏出现「迁移历史」入口，点击打开只读历史', async () => {
    seedDoc({ historyItems: [HISTORY_ITEM] });
    await renderPage();
    await vi.waitFor(() => expect([...container.querySelectorAll('button')].some(b => b.textContent?.includes('迁移历史'))).toBe(true));
    const entry = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('迁移历史'));
    expect(entry).toBeDefined();
    await act(async () => {
      entry!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    const modalText = document.body.textContent ?? '';
    expect(modalText).toContain('旧生成卡迁移历史');
    expect(modalText).toContain('暮色街道的画面描述');
    expect(modalText).toContain('迁移时的提示词正文');
    expect(modalText).toContain('预览来源');
  });

  it('无历史或读取失败时不渲染入口', async () => {
    seedDoc();
    await renderPage();
    expect([...container.querySelectorAll('button')].some((b) => b.textContent?.includes('迁移历史'))).toBe(false);

    apiMocks.listLegacyCardHistory.mockRejectedValueOnce(new Error('network'));
    await renderPage();
    expect([...container.querySelectorAll('button')].some((b) => b.textContent?.includes('迁移历史'))).toBe(false);
  });
});
