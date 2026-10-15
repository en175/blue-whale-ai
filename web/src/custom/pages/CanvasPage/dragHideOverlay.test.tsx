// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';

vi.setConfig({ testTimeout: 20_000, hookTimeout: 60_000 });
const WAIT_TIMEOUT_MS = 10_000;

vi.hoisted(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
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

vi.mock('@/custom/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/custom/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

vi.mock('./components/PromptRefEditor', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  type StubDoc = { version: number; segments: Array<{ kind: string; text?: string }> };
  const flatten = (doc: StubDoc | null | undefined, initialText?: string) => {
    if (doc && Array.isArray(doc.segments)) {
      return doc.segments.map((s) => s.text ?? '').join('');
    }
    return initialText ?? '';
  };
  return {
    default: forwardRef(function StubPromptRefEditor(
      { initialDoc, initialText }: {
        initialDoc?: StubDoc | null;
        initialText?: string;
        onChange?: (doc: StubDoc) => void;
      },
      ref: React.Ref<unknown>,
    ) {
      useImperativeHandle(ref, () => ({
        insertRefAtMention: () => {},
        consumeMentionForPendingInsert: () => {},
        insertRefAtPending: () => {},
        dismissMention: () => {},
        replaceRefAt: () => {},
        clear: () => {},
      }));
      return createElement('textarea', {
        'data-testid': 'chip-editor',
        value: flatten(initialDoc, initialText),
        onChange: () => {},
      });
    }),
  };
});

const imageModel = {
  model_id: 'm-test',
  provider_id: 'prov',
  model_label: '测试生图模型',
  icon: null,
  supported_sizes: [{ id: '2k', label: '2K' }],
  supported_aspect_ratios: [{ id: '1:1', label: '1:1' }],
  supported_formats: [],
  supported_durations: null,
  default_size: '2k',
  default_format: null,
  default_aspect_ratio: '1:1',
  default_duration: null,
  features: {},
  version: 1,
  digest: '',
};

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchMe: vi.fn(async () => null),
  fetchCredits: vi.fn(async () => ({ credits: 0 })),
  toSessionUser: vi.fn(() => null),
  applyPromptPreview: vi.fn(),
  referencePromptPlan: vi.fn(),
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => Promise.resolve({ items: [] }), retry: false }),
  saveCanvasDoc: vi.fn(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  createGenerationJob: vi.fn(async () => ({ generation_job_id: 'j1', cursor: 1 })),
  fetchJobStatus: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(),
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
  assetPageQueryOptions: vi.fn((type: string, size: number) => ({
    queryKey: ['asset-pages', type, size],
    initialPageParam: 1,
    queryFn: () => Promise.resolve({ records: [], total: 0, current: 1 }),
    getNextPageParam: () => undefined,
  })),
  assetDetailQueryOptions: vi.fn((id: unknown) => ({
    queryKey: ['asset-detail', id],
    queryFn: () => Promise.resolve(null),
    enabled: id != null,
  })),
  deleteAsset: vi.fn(),
  fetchAssetReferences: vi.fn(),
}));

vi.mock('@/custom/api/canvas', () => ({
  applyPromptPreview: apiMocks.applyPromptPreview,
  referencePromptPlan: apiMocks.referencePromptPlan,
  listLegacyCardHistory: apiMocks.listLegacyCardHistory,
  createConversationQuote: apiMocks.createConversationQuote,
  legacyCardHistoryOptions: apiMocks.legacyCardHistoryOptions,
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn(
    (edges: Array<{ id: string; source: string; target: string; data?: unknown }>) =>
      JSON.stringify(edges.map((e) => ({ id: e.id, source: e.source, target: e.target, data: e.data }))),
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

vi.mock('@/custom/api/generation', () => ({
  fetchGenerationModels: apiMocks.fetchGenerationModels,
}));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));

vi.mock('./hooks/useCanvasDoc', () => ({
  useCanvasDoc: () => canvasDocMock.current,
}));

function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'd1',
          type: 'mediaNode',
          position: { x: 400, y: 0 },
          data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '图片草稿提示词' },
        },
        {
          id: 'v1',
          type: 'mediaNode',
          position: { x: 800, y: 0 },
          data: { src: '', mediaType: 'video', fileName: '视频草稿', genStatus: 'draft', draft: true, prompt: '视频草稿提示词' },
        },
        {
          id: 'au1',
          type: 'mediaNode',
          position: { x: 1500, y: 0 },
          data: { src: '', mediaType: 'audio', fileName: '音频草稿', genStatus: 'draft', draft: true, prompt: '音频草稿提示词' },
        },
        { id: 'group-a', type: 'groupFrame', position: { x: 350, y: -50 }, data: { box: { x: 350, y: -50, w: 900, h: 600 }, excludedIds: [] } },
        { id: 'group-b', type: 'groupFrame', position: { x: 1450, y: -50 }, data: { box: { x: 1450, y: -50, w: 450, h: 600 }, excludedIds: [] } },
      ],
      edges: [],
    },
    assets: {},
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

let root: Root;
let container: HTMLDivElement;

async function renderPage() {
  const { default: Page } = await import('./index');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(MemoryRouter, { initialEntries: ['/canvas?project=p1'] }, createElement(Page) as ReactElement),
      ),
    );
  });
}

function node(id: string): HTMLElement {
  return container.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
}

function pane(): HTMLElement {
  return container.querySelector<HTMLElement>('.react-flow__pane')!;
}

function fireMouse(type: 'mousedown' | 'mousemove' | 'mouseup' | 'click', target: EventTarget, cx: number, cy: number) {
  const event = new MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' || type === 'click' ? 0 : 1,
    clientX: cx, clientY: cy,
  });
  Object.defineProperty(event, 'view', { value: window });
  target.dispatchEvent(event);
}

function firePointer(type: 'pointerdown' | 'pointermove' | 'pointerup', target: EventTarget, cx: number, cy: number) {
  const event = new MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX: cx, clientY: cy,
  });
  Object.defineProperty(event, 'view', { value: window });
  Object.defineProperty(event, 'isPrimary', { value: true });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
}

async function clickCard(id: string, x: number, y: number) {
  const el = node(id);
  await act(async () => {
    fireMouse('mousedown', el, x, y);
    fireMouse('mousemove', window, x + 4, y + 3);
    fireMouse('mousemove', window, x, y);
    fireMouse('mouseup', window, x, y);
    fireMouse('click', node(id), x, y);
  });
}

const imageOpen = () => container.textContent!.includes('测试生图模型');

function panelRoot(): HTMLElement {
  const editor = container.querySelector('[data-testid="chip-editor"]');
  expect(editor).toBeTruthy();
  return editor!.closest('[data-gen-panel-territory]') as HTMLElement;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('页面测试禁止真实出网'); }));
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  document.elementsFromPoint = () => [];
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(2000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rectOf(this: HTMLElement) {
    if (this.closest('[data-canvas-chrome], .react-flow__minimap')) {
      return { x: 980, y: 760, left: 980, top: 760, right: 1000, bottom: 800, width: 20, height: 20, toJSON: () => ({}) };
    }
    return { x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, toJSON: () => ({}) };
  });
  Element.prototype.scrollTo = () => {};
  seedDoc();
  apiMocks.fetchGenerationModels.mockImplementation(async (type?: string) => {
    if (type === 'image') return [imageModel];
    return [];
  });
});

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  container?.remove();
  document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
  Reflect.deleteProperty(document, 'elementsFromPoint');
  expect(fetch).not.toHaveBeenCalled();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('IKJR9J 画布锚定浮层拖拽隐藏（页面级真实手势）', () => {
  it('拖锚定卡：拖拽中面板 visibility 隐藏且编辑器不卸载，落定在新锚点重现', async () => {
    await renderPage();
    await vi.waitFor(() => expect(node('d1')).toBeTruthy(), { timeout: WAIT_TIMEOUT_MS });

    await clickCard('d1', 520, 90);
    await vi.waitFor(() => expect(imageOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    const panel = panelRoot();
    const editorEl = container.querySelector('[data-testid="chip-editor"]');
    const topBefore = panel.style.top;
    const leftBefore = panel.style.left;
    expect(panel.style.visibility).toBe('');

    await act(async () => { fireMouse('mousedown', node('d1'), 520, 90); });
    await act(async () => { fireMouse('mousemove', window, 524, 93); });
    await act(async () => { fireMouse('mousemove', window, 620, 160); });

    await vi.waitFor(() => expect(panel.style.visibility).toBe('hidden'), { timeout: WAIT_TIMEOUT_MS });
    expect(container.querySelector('[data-testid="chip-editor"]')).toBe(editorEl);
    expect(document.contains(editorEl)).toBe(true);

    await act(async () => { fireMouse('mouseup', window, 620, 160); });


    await vi.waitFor(() => {
      expect(panel.style.visibility).toBe('');
      expect(Number.parseInt(panel.style.left) - Number.parseInt(leftBefore)).toBe(96);
      expect(Number.parseInt(panel.style.top) - Number.parseInt(topBefore)).toBe(67);
    }, { timeout: WAIT_TIMEOUT_MS });
    expect(container.querySelector('[data-testid="chip-editor"]')).toBe(editorEl);
    expect(imageOpen()).toBe(true);
  });

  it('组框整组拖含锚定卡：拖拽中面板隐藏，落定在新锚点重现', async () => {
    await renderPage();
    await vi.waitFor(() => expect(node('d1')).toBeTruthy(), { timeout: WAIT_TIMEOUT_MS });

    await clickCard('d1', 520, 90);
    await vi.waitFor(() => expect(imageOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    const panel = panelRoot();
    const topBefore = panel.style.top;
    const leftBefore = panel.style.left;

    await act(async () => { firePointer('pointerdown', pane(), 400, 500); });
    await act(async () => { firePointer('pointermove', window, 600, 600); });
    await vi.waitFor(() => expect(panel.style.visibility).toBe('hidden'), { timeout: WAIT_TIMEOUT_MS });

    await act(async () => { firePointer('pointerup', window, 600, 600); });
    await vi.waitFor(() => {
      expect(panel.style.visibility).toBe('');
      expect(Number.parseInt(panel.style.left) - Number.parseInt(leftBefore)).toBe(200);
      expect(Number.parseInt(panel.style.top) - Number.parseInt(topBefore)).toBe(100);
    }, { timeout: WAIT_TIMEOUT_MS });
    expect(imageOpen()).toBe(true);
  });

  it('拖「不含锚定卡」的组框：面板原地不动、不隐藏', async () => {
    await renderPage();
    await vi.waitFor(() => expect(node('d1')).toBeTruthy(), { timeout: WAIT_TIMEOUT_MS });

    await clickCard('d1', 520, 90);
    await vi.waitFor(() => expect(imageOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    const panel = panelRoot();
    const topBefore = panel.style.top;
    const leftBefore = panel.style.left;

    await act(async () => { firePointer('pointerdown', pane(), 1850, 500); });
    await act(async () => { firePointer('pointermove', window, 1900, 560); });
    expect(panel.style.visibility).toBe('');
    expect(panel.style.left).toBe(leftBefore);
    expect(panel.style.top).toBe(topBefore);

    await act(async () => { firePointer('pointerup', window, 1900, 560); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(panel.style.visibility).toBe('');
    expect(panel.style.left).toBe(leftBefore);
    expect(panel.style.top).toBe(topBefore);
    expect(imageOpen()).toBe(true);
  });
});
