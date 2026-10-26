// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import type { GenerationQuote } from '@/custom/api/generationQuote';
import type { GenerationRecoveryPage } from '@/custom/api/canvasRecovery';
import type { ProjectRecord } from '@/custom/api/projects';









vi.setConfig({ testTimeout: 20_000, hookTimeout: 60_000 });
const WAIT_TIMEOUT_MS = 10_000;

vi.hoisted(() => {

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

vi.mock('../components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));




let pageRenderCount = 0;
vi.mock('../components/CanvasToolbar', () => ({
  default: () => {
    pageRenderCount += 1;
    return createElement('div', { 'data-testid': 'canvas-toolbar' });
  },
}));

vi.mock('../components/CanvasHeader', () => ({
  default: ({ projects, currentProjectId }: ComponentProps<typeof import('../components/CanvasHeader').default>) =>
    createElement('div', { 'data-testid': 'canvas-header', 'data-project-id': currentProjectId },
      projects.find((project) => project.id === currentProjectId)?.name),
}));

vi.mock('../components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

vi.mock('@/custom/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/custom/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));





let editorMountCount = 0;
vi.mock('../components/PromptRefEditor', async () => {
  const { forwardRef, useEffect, useImperativeHandle } = await import('react');
  type StubDoc = { version: number; segments: Array<{ kind: string; text?: string }> };
  const flatten = (doc: StubDoc | null | undefined, initialText?: string) => {
    if (doc && Array.isArray(doc.segments)) {
      return doc.segments.map((s) => s.text ?? '').join('');
    }
    return initialText ?? '';
  };
  return {
    default: forwardRef(function StubPromptRefEditor(
      {
        initialDoc,
        initialText,
        onChange,
      }: {
        initialDoc?: StubDoc | null;
        initialText?: string;
        onChange?: (doc: StubDoc) => void;
      },
      ref: React.Ref<unknown>,
    ) {
      useEffect(() => { editorMountCount += 1; }, []);
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
        onChange: (e: Event) => {
          const value = (e.target as HTMLTextAreaElement).value;
          onChange?.({ version: 1, segments: value ? [{ kind: 'text', text: value }] : [] });
        },
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
const videoModel = {
  model_id: 'seedance-2',
  provider_id: 'prov',
  model_label: '测试视频模型',
  icon: null,
  supported_sizes: [{ id: '720p', label: '720p', api_value: '720p' }, { id: '1080p', label: '1080P', api_value: '1080p' }],
  supported_aspect_ratios: [{ id: '16:9', label: '16:9' }, { id: '9:16', label: '9:16' }],
  supported_formats: [],
  supported_durations: { min: 4, max: 12, step: 1 },
  default_size: '720p',
  default_format: null,
  default_aspect_ratio: '16:9',
  default_duration: 5,
  features: {
    reference_image: true,
    image_reference_max: 10,
    watermark: false,
    quantity_max: 1,
    sequential_image_generation: false,
    stream: false,
    tools: false,
    first_frame: true,
    last_frame: true,
    first_last_frame: true,
    task_types: {
      text2video: {},
      omni: {},
      image_reference: {},
      first_frame: {},
      first_last_frame: {},
    },
    audio: true,
  },
  version: 1,
  digest: '',
};
const fallbackVideoModel = { ...videoModel, model_id: 'other-video', model_label: '默认视频模型' };
const audioModel = {
  model_id: 'a-test',
  provider_id: 'prov',
  model_label: '测试音频模型',
  icon: null,
  supported_sizes: null,
  supported_aspect_ratios: null,
  supported_formats: [],
  supported_durations: null,
  default_size: null,
  default_format: null,
  default_aspect_ratio: null,
  default_duration: null,
  features: {},
  version: 1,
  digest: '',
};

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一', thumb: null, previews: [], created_at: '2026-01-01T00:00:00Z', last_opened_at: null, pinned_at: null }]),
  createProject: vi.fn(async () => ({
    id: 'p2',
    name: '未命名项目',
    thumb: null,
    previews: [],
    created_at: '2026-01-01T00:00:00Z',
    last_opened_at: null,
    pinned_at: null,
  }) satisfies ProjectRecord),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchMe: vi.fn(async () => null),

  fetchCredits: vi.fn(async () => ({ credits: 0, by_source: [] })),
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
    queryFn: () => Promise.resolve({ records: [], total: 0, size, current: 1 }),
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
    queryFn: async () => ({ credits: null, quote_revision: null }) satisfies GenerationQuote,
  })),
}));

vi.mock('@/custom/api/canvasRecovery', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/api/canvasRecovery')>()),
  generationRecoveryPageOptions: vi.fn(() => ({
    queryKey: ['generation-recovery', 'mock'],
    queryFn: async () => ({ records: [], next_cursor: null, protocol_version: 1, canvas_version: null }) satisfies GenerationRecoveryPage,
  })),
  fetchGenerationRecoveryPage: vi.fn(async () => ({
    protocol_version: 1,
    canvas_version: null,
    records: [],
    next_cursor: null,
  }) satisfies GenerationRecoveryPage),
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

vi.mock('../hooks/document/useCanvasDoc', () => ({
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
          position: { x: 0, y: 0 },
          data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '图片草稿提示词' },
        },
        {
          id: 'v1',
          type: 'mediaNode',
          position: { x: 300, y: 0 },
          data: {
            src: '', mediaType: 'video', fileName: '视频草稿', genStatus: 'draft', draft: true,
            prompt: '视频草稿提示词', draftModelId: 'seedance-2', draftRatio: '9:16',
            draftSize: '1080p', draftDuration: 8, draftMode: 'all', draftGenerateAudio: false,
          },
        },
        {
          id: 'au1',
          type: 'mediaNode',
          position: { x: 600, y: 0 },
          data: { src: '', mediaType: 'audio', fileName: '音频草稿', genStatus: 'draft', draft: true, prompt: '音频草稿提示词' },
        },
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

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

let Page: typeof import('../index').default;

beforeAll(async () => {
  Page = (await import('../index')).default;
});

async function renderPage() {
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



function fireMouse(type: 'mousedown' | 'mousemove' | 'mouseup' | 'click', target: EventTarget, cx: number, cy: number) {
  const event = new MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' || type === 'click' ? 0 : 1,
    clientX: cx, clientY: cy,
  });
  Object.defineProperty(event, 'view', { value: window });
  target.dispatchEvent(event);
}






async function clickCard(id: string, x = 120, y = 90) {
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
const videoOpen = () => container.textContent!.includes('测试视频模型');
const audioOpen = () => container.textContent!.includes('测试音频模型');


function panelPromptText(): string {
  const editor = container.querySelector<HTMLTextAreaElement>('[data-testid="chip-editor"]');
  return editor ? editor.value : '';
}


function expectNoUpdateDepthLoop() {
  const looped = consoleErrorSpy.mock.calls.some((args) =>
    args.some((a) => typeof a === 'string' && a.includes('Maximum update depth exceeded')),
  );
  expect(looped).toBe(false);
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
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);


  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rectOf(this: HTMLElement) {
    if (this.closest('[data-canvas-chrome], .react-flow__minimap')) {
      return { x: 980, y: 760, left: 980, top: 760, right: 1000, bottom: 800, width: 20, height: 20, toJSON: () => ({}) };
    }
    return { x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, toJSON: () => ({}), };
  });
  Element.prototype.scrollTo = () => {};
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  pageRenderCount = 0;
  editorMountCount = 0;
  seedDoc();
  apiMocks.fetchGenerationModels.mockImplementation(async (type?: string) => {
    if (type === 'audio') return [audioModel];
    if (type === 'video') return [fallbackVideoModel, videoModel];
    return [imageModel];
  });
});

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  container?.remove();
  document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
  expect(fetch).not.toHaveBeenCalled();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('IKK792 空项目自动新建', () => {
  it('项目列表为空时显示新建项目名称并选中其 id', async () => {
    apiMocks.fetchProjects.mockResolvedValueOnce([]);
    await renderPage();

    await vi.waitFor(() => {
      const header = container.querySelector('[data-testid="canvas-header"]');
      expect(header?.textContent).toBe('未命名项目');
      expect(header?.getAttribute('data-project-id')).toBe('p2');
    });
    expect(apiMocks.createProject).toHaveBeenCalledWith('未命名项目');
  });
});

describe('IKIJ60 草稿面板切换崩溃回归（真实画布选中通报路径）', () => {
  it('图片草稿面板打开后点视频草稿卡：不崩溃，视频面板打开、草稿参数回填、图片面板关闭、选中落视频卡', async () => {
    await renderPage();

    await vi.waitFor(() => expect(node('d1')).toBeTruthy(), { timeout: WAIT_TIMEOUT_MS });
    expect(node('v1')).toBeTruthy();


    await clickCard('d1', 120, 90);
    await vi.waitFor(() => expect(imageOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expect(panelPromptText()).toBe('图片草稿提示词');



    const rendersBeforeSwitch = pageRenderCount;
    await clickCard('v1', 420, 90);

    await vi.waitFor(() => expect(videoOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expectNoUpdateDepthLoop();

    expect(pageRenderCount - rendersBeforeSwitch).toBeLessThan(10);

    expect(panelPromptText()).toBe('视频草稿提示词');
    expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent?.trim() === '全能参考')).toBe(true);
    const configButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('测试视频模型') && button.textContent?.includes('8s'),
    );
    expect(configButton).toBeTruthy();
    expect(configButton!.textContent).toContain('9:16');
    expect(configButton!.textContent).toContain('1080P');
    await act(async () => { configButton!.click(); });
    expect(container.querySelector('button[role="switch"][aria-label="生成的视频带音频"]')?.getAttribute('aria-checked')).toBe('false');

    expect(imageOpen()).toBe(false);

    expect(node('v1').classList.contains('selected')).toBe(true);
    expect(node('d1').classList.contains('selected')).toBe(false);
  });

  it('图片/视频/音频草稿卡两两连续切换点击均安全', async () => {
    await renderPage();
    await vi.waitFor(() => expect(node('au1')).toBeTruthy(), { timeout: WAIT_TIMEOUT_MS });


    await clickCard('d1', 120, 90);
    await vi.waitFor(() => expect(imageOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    await clickCard('v1', 420, 90);
    await vi.waitFor(() => expect(videoOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expect(imageOpen()).toBe(false);

    await clickCard('au1', 720, 90);
    await vi.waitFor(() => expect(audioOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expect(videoOpen()).toBe(false);

    await clickCard('d1', 120, 90);
    await vi.waitFor(() => expect(imageOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expect(audioOpen()).toBe(false);

    await clickCard('au1', 720, 90);
    await vi.waitFor(() => expect(audioOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expect(imageOpen()).toBe(false);

    await clickCard('v1', 420, 90);
    await vi.waitFor(() => expect(videoOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expect(audioOpen()).toBe(false);

    expectNoUpdateDepthLoop();
  });

  it('同一序列快速连点亦安全（无循环通报级联）', async () => {
    await renderPage();
    await vi.waitFor(() => expect(node('d1')).toBeTruthy(), { timeout: WAIT_TIMEOUT_MS });


    await clickCard('d1', 120, 90);
    await clickCard('v1', 420, 90);
    await clickCard('v1', 420, 90);
    await clickCard('d1', 120, 90);
    await clickCard('v1', 420, 90);

    await vi.waitFor(() => expect(videoOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expectNoUpdateDepthLoop();
    expect(node('v1').classList.contains('selected')).toBe(true);
  });
});









describe('IKIJ61 草稿面板 seed 等值写入与互关清绑定', () => {



  async function selectCard(id: string, x = 120, y = 90) {
    const el = node(id);
    await act(async () => {
      fireMouse('mousedown', el, x, y);
      fireMouse('mousemove', window, x + 4, y + 3);
      fireMouse('mousemove', window, x, y);
      fireMouse('mouseup', window, x, y);
    });
  }


  const panelEditor = (): HTMLTextAreaElement | null =>
    container.querySelector<HTMLTextAreaElement>('[data-testid="chip-editor"]');

  it('纯选中通报（无 click）可打开草稿面板——锁定 selection 路径存在，互关守卫测试的机制前提', async () => {
    await renderPage();
    await vi.waitFor(() => expect(node('v1')).toBeTruthy(), { timeout: WAIT_TIMEOUT_MS });

    await selectCard('v1', 420, 90);
    await vi.waitFor(() => expect(videoOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expect(panelPromptText()).toBe('视频草稿提示词');
    expectNoUpdateDepthLoop();
  });

  it('同一图片草稿卡等值重复打开：seed 内容等值跳过写入，面板不重挂载（编辑器只挂载一次）', async () => {
    await renderPage();
    await vi.waitFor(() => expect(node('d1')).toBeTruthy(), { timeout: WAIT_TIMEOUT_MS });




    await clickCard('d1', 120, 90);
    await vi.waitFor(() => expect(imageOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expect(panelPromptText()).toBe('图片草稿提示词');
    expect(editorMountCount).toBe(1);


    await selectCard('d1', 120, 90);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(imageOpen()).toBe(true);
    expect(editorMountCount).toBe(1);
    expectNoUpdateDepthLoop();
  });

  it('视频面板打开后图片卡纯选中通报：面板原子切换收敛，无双面板叠加、无循环通报', async () => {
    await renderPage();
    await vi.waitFor(() => expect(node('d1')).toBeTruthy(), { timeout: WAIT_TIMEOUT_MS });

    await clickCard('d1', 120, 90);
    await vi.waitFor(() => expect(imageOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });

    await clickCard('v1', 420, 90);
    await vi.waitFor(() => expect(videoOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expect(imageOpen()).toBe(false);



    await selectCard('d1', 120, 90);
    await vi.waitFor(() => expect(imageOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expect(videoOpen()).toBe(false);
    expectNoUpdateDepthLoop();


    await selectCard('v1', 420, 90);
    await vi.waitFor(() => expect(videoOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expect(imageOpen()).toBe(false);
    expectNoUpdateDepthLoop();
  });

  it('互关清绑定后图片卡纯选中通报原子切换重开，手动点卡重开照常', async () => {
    await renderPage();
    await vi.waitFor(() => expect(node('d1')).toBeTruthy(), { timeout: WAIT_TIMEOUT_MS });

    await clickCard('d1', 120, 90);
    await vi.waitFor(() => expect(imageOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    await clickCard('v1', 420, 90);
    await vi.waitFor(() => expect(videoOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expect(imageOpen()).toBe(false);




    await selectCard('d1', 120, 90);
    await vi.waitFor(() => expect(imageOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expect(videoOpen()).toBe(false);

    await selectCard('v1', 420, 90);
    await vi.waitFor(() => expect(videoOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });



    await clickCard('d1', 120, 90);
    await vi.waitFor(() => expect(imageOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expect(panelPromptText()).toBe('图片草稿提示词');
    expect(videoOpen()).toBe(false);
    expectNoUpdateDepthLoop();
  });

  it('音频面板打开后视频卡纯选中通报：对称原子切换收敛（视频绑定已清，无叠加无循环）', async () => {
    await renderPage();
    await vi.waitFor(() => expect(node('v1')).toBeTruthy(), { timeout: WAIT_TIMEOUT_MS });

    await clickCard('v1', 420, 90);
    await vi.waitFor(() => expect(videoOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });

    await clickCard('au1', 720, 90);
    await vi.waitFor(() => expect(audioOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expect(videoOpen()).toBe(false);


    await selectCard('v1', 420, 90);
    await vi.waitFor(() => expect(videoOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expect(audioOpen()).toBe(false);
    expectNoUpdateDepthLoop();


    await selectCard('au1', 720, 90);
    await vi.waitFor(() => expect(audioOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expect(videoOpen()).toBe(false);
    expectNoUpdateDepthLoop();
  });

  it('草稿内容变化后重开：seed 真实变化仍写入并重挂载回填（等值跳过不误伤真实变化）', async () => {
    await renderPage();
    await vi.waitFor(() => expect(node('d1')).toBeTruthy(), { timeout: WAIT_TIMEOUT_MS });

    await clickCard('d1', 120, 90);
    await vi.waitFor(() => expect(imageOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    const editorInitial = panelEditor()!;


    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(editorInitial, '编辑后的草稿提示词');
      editorInitial.dispatchEvent(new Event('input', { bubbles: true }));
    });



    await clickCard('v1', 420, 90);
    await vi.waitFor(() => expect(videoOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expect(imageOpen()).toBe(false);

    await clickCard('d1', 120, 90);
    await vi.waitFor(() => expect(imageOpen()).toBe(true), { timeout: WAIT_TIMEOUT_MS });
    expect(panelPromptText()).toBe('编辑后的草稿提示词');
    expect(panelEditor()).not.toBe(editorInitial);
    expectNoUpdateDepthLoop();
  });
});



describe('IKIJ61 draftSeedEquals 内容等值契约', () => {
  it('ts 不同其余字段等值 → 等值；targetNodeId / 参数 / attachments 内容差异 → 不等值', async () => {
    const { draftSeedEquals } = await import('../graph/draftSeed');
    const seedA = { ts: 1, text: '正文', targetNodeId: 'd1', params: { modelId: 'm1', ratio: '1:1' }, attachments: [{ nodeId: 't1', title: '文本' }] };
    const seedB = { ts: 2, text: '正文', targetNodeId: 'd1', params: { modelId: 'm1', ratio: '1:1' }, attachments: [{ nodeId: 't1', title: '文本' }] };

    expect(draftSeedEquals(seedA, seedB)).toBe(true);
    expect(draftSeedEquals(seedB, seedA)).toBe(true);

    expect(draftSeedEquals(seedA, seedA)).toBe(true);

    expect(draftSeedEquals(seedA, { ...seedB, targetNodeId: 'd2' })).toBe(false);

    expect(draftSeedEquals(seedA, { ...seedB, params: { modelId: 'm2', ratio: '1:1' } })).toBe(false);
    expect(draftSeedEquals(seedA, { ...seedB, text: '新正文' })).toBe(false);

    expect(draftSeedEquals(seedA, { ...seedB, attachments: [{ nodeId: 't1', title: '文本' }, { nodeId: 't2', title: '文本2' }] })).toBe(false);
    expect(draftSeedEquals(seedA, { ...seedB, attachments: [{ nodeId: 't2', title: '文本' }] })).toBe(false);

    expect(draftSeedEquals(null, seedB)).toBe(false);
    expect(draftSeedEquals(undefined, seedB)).toBe(false);
  });
});






describe('IKIJ60 画布容器选中回调稳定化（真实 ReactFlow 通报契约哨兵）', () => {
  it('父层等价重渲染不再等值通报；选中真实变化仍正常通报', async () => {
    const { default: FlowCanvas } = await import('../components/Canvas');
    const onSelectionChange = vi.fn();
    const mediaNode = (id: string, x: number) => ({
      id, type: 'mediaNode' as const, position: { x, y: 0 },
      data: { mediaType: 'image', src: 'blob:test', fileName: id, toolMode: 'select' },
    });
    const baseProps = {
      toolMode: 'select' as const, showMiniMap: false, showEdges: false, hideZoomControl: true,
      extraNodes: [] as Node[], textNodes: [] as Node[], productNodes: [] as Node[], assetNodes: [] as Node[],
      edges: [], onEdgesChange: vi.fn(), onConnect: vi.fn(),
      mediaNodes: [mediaNode('draft-a', 50), mediaNode('draft-b', 500)],
      viewport: { x: 0, y: 0, zoom: 1 },
      onDeleteNode: vi.fn(), onNodeDragStop: vi.fn(), onViewportChange: vi.fn(),
      onSelectionChange,
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(createElement(FlowCanvas, baseProps)); });
    await act(async () => {});

    const afterMount = onSelectionChange.mock.calls.length;
    expect(afterMount).toBeGreaterThanOrEqual(1);


    await clickCard('draft-a', 120, 90);
    expect(onSelectionChange.mock.lastCall![0].nodes.map((n: Node) => n.id)).toEqual(['draft-a']);
    const afterSelect = onSelectionChange.mock.calls.length;
    expect(afterSelect).toBeGreaterThanOrEqual(afterMount + 1);




    await act(async () => {
      root.render(createElement(FlowCanvas, {
        ...baseProps,
        mediaNodes: [mediaNode('draft-a', 50), mediaNode('draft-b', 500)],
      }));
    });
    await act(async () => {});
    expect(onSelectionChange).toHaveBeenCalledTimes(afterSelect);


    await clickCard('draft-b', 420, 90);
    expect(onSelectionChange.mock.lastCall![0].nodes.map((n: Node) => n.id)).toEqual(['draft-b']);
    expect(onSelectionChange.mock.calls.length).toBe(afterSelect + 1);
  });
});
