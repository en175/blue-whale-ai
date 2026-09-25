// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';

/* IKIJ60 草稿面板切换崩溃回归（页面级）：用户点图片草稿卡展开生成面板后，再点视频草稿卡，
   页面曾崩溃为整页 Maximum update depth exceeded。根因在 @xyflow/react 12.11.2 的
   SelectionListener——effect 把 onSelectionChange 回调自身列入依赖且不检查选中是否真的
   变化，回调引用一变就把当前选中等值再通报一次；画布容器内联包裹与页面处理函数每轮渲染
   重建引用，等值通报无限再生，叠加双面板互相关闭对方形成三拍循环。
   本文件画布容器（components/Canvas）保持真实实现（不打桩），经真实 ReactFlow 选中通报
   路径复刻崩溃序列；打桩清单沿用 genPanelDismiss.test.tsx 先例（唯独不 mock Canvas）。 */

vi.hoisted(() => {
  // 开发期代码定位插件在导入时探测 Canvas；本测试不绘制位图。
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

// 注意：components/Canvas 不打桩——本测试的核心就是真实 ReactFlow 选中通报路径。

/** 页面渲染计数哨兵：打桩组件随页面每轮渲染重渲染，计数即页面渲染次数（验收：切换渲染次数维持个位数） */
let pageRenderCount = 0;
vi.mock('./components/CanvasToolbar', () => ({
  default: () => {
    pageRenderCount += 1;
    return createElement('div', { 'data-testid': 'canvas-toolbar' });
  },
}));

vi.mock('./components/CanvasHeader', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));

vi.mock('./components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

vi.mock('@/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

/** PromptRefEditor 打桩（Lexical 过重）：回填断言所需——textarea 值由 initialDoc/initialText
 *  展平而来（面板打开时种子正文即呈现在值里），onChange 透传结构化文档（先例同 genPanelDismiss）。 */
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
  supported_aspect_ratios: ['1:1'],
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
  supported_sizes: [{ id: '720p', label: '720p', api_value: '720p' }],
  supported_aspect_ratios: ['16:9'],
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
    audio: false,
  },
  version: 1,
  digest: '',
};
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
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchMe: vi.fn(async () => null),
  fetchQuota: vi.fn(async () => ({})),
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

vi.mock('@/api/canvas', () => ({
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

vi.mock('@/api/generation', () => ({
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

/** 组合夹具：图片草稿 d1 / 视频草稿 v1 / 音频草稿 au1（各带可断言的草稿 prompt） */
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
          data: { src: '', mediaType: 'video', fileName: '视频草稿', genStatus: 'draft', draft: true, prompt: '视频草稿提示词' },
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
/** React 深度更新哨兵：捕获 Maximum update depth exceeded 的 console.error（act 内同时会抛错使用例失败） */
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

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

/** 画布节点元素（真实 ReactFlow 渲染出的节点包裹层） */
function node(id: string): HTMLElement {
  return container.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
}

/** 点选一张草稿卡：mousedown 于节点元素 → 小幅来回位移越过拖拽阈值（jsdom 中 d3-drag
 *  需首个 mousemove 才进入并选中，marqueeSelect「原地点击」先例）→ mouseup 于 window →
 *  补发原生 click（jsdom 不会从合成序列自动派生 click；浏览器中 click 紧随抬键）。
 *  整个手势在单个 act 内派发：贴近浏览器「一次手势一个任务」的级联时序，
 *  选中通报—渲染—effect 再通报的循环若存在会在同一刷新内滚成深度更新溢出。 */
async function clickCard(id: string, x = 120, y = 90) {
  const el = node(id);
  const fire = (type: 'mousedown' | 'mousemove' | 'mouseup' | 'click', target: EventTarget, cx: number, cy: number) => {
    const event = new MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0, buttons: type === 'mouseup' || type === 'click' ? 0 : 1,
      clientX: cx, clientY: cy,
    });
    Object.defineProperty(event, 'view', { value: window });
    target.dispatchEvent(event);
  };
  await act(async () => {
    fire('mousedown', el, x, y);
    fire('mousemove', window, x + 4, y + 3);
    fire('mousemove', window, x, y);
    fire('mouseup', window, x, y);
    fire('click', el, x, y);
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

/** 面板开关标记（各面板模型选择器文案仅在该面板打开时渲染） */
const imageOpen = () => container.textContent!.includes('测试生图模型');
const videoOpen = () => container.textContent!.includes('测试视频模型');
const audioOpen = () => container.textContent!.includes('测试音频模型');

/** 当前打开面板中的正文（PromptRefEditor 打桩 textarea 的值） */
function panelPromptText(): string {
  const editor = container.querySelector<HTMLTextAreaElement>('[data-testid="chip-editor"]');
  return editor ? editor.value : '';
}

/** 断言未发生深度更新循环（崩溃的正主） */
function expectNoUpdateDepthLoop() {
  const looped = consoleErrorSpy.mock.calls.some((args) =>
    args.some((a) => typeof a === 'string' && a.includes('Maximum update depth exceeded')),
  );
  expect(looped).toBe(false);
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  // jsdom 不做布局；只补浏览器测量 API，React Flow 与卡片均使用真实实现（marqueeSelect 先例）。
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800);
  // 画布上层控件（canvas-chrome/小地图）给右下角小矩形：若与画布同 1000×800 大矩形，
  // chromeHitGuard 会把任意点击坐标判为「命中工具栏」而吞掉选中（真实布局中两者不重叠）。
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rectOf(this: HTMLElement) {
    if (this.closest('[data-canvas-chrome], .react-flow__minimap')) {
      return { x: 980, y: 760, left: 980, top: 760, right: 1000, bottom: 800, width: 20, height: 20, toJSON: () => ({}) };
    }
    return { x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, toJSON: () => ({}), };
  });
  Element.prototype.scrollTo = () => {};
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  pageRenderCount = 0;
  seedDoc();
  apiMocks.fetchGenerationModels.mockImplementation(async (type?: string) => {
    if (type === 'audio') return [audioModel];
    if (type === 'video') return [videoModel];
    return [imageModel];
  });
});

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  container?.remove();
  document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('IKIJ60 草稿面板切换崩溃回归（真实画布选中通报路径）', () => {
  it('图片草稿面板打开后点视频草稿卡：不崩溃，视频面板打开、草稿参数回填、图片面板关闭、选中落视频卡', async () => {
    await renderPage();
    // 草稿卡水合进真实画布
    await vi.waitFor(() => expect(node('d1')).toBeTruthy());
    expect(node('v1')).toBeTruthy();

    // 第一步：点图片草稿卡 → 图片面板打开、prompt 回填
    await clickCard('d1', 120, 90);
    await vi.waitFor(() => expect(imageOpen()).toBe(true));
    expect(panelPromptText()).toBe('图片草稿提示词');

    // 第二步：点视频草稿卡——用户环境曾在此步崩溃为 Maximum update depth exceeded 整页错误。
    // jsdom 合成布局下该级联不复现（见文末哨兵测试与交付报告的降级说明），本用例锁定外部行为不回归。
    const rendersBeforeSwitch = pageRenderCount;
    await clickCard('v1', 420, 90);

    await vi.waitFor(() => expect(videoOpen()).toBe(true), { timeout: 3000 });
    expectNoUpdateDepthLoop();
    // 选中切换渲染次数维持个位数（无明显性能退化，验收项）
    expect(pageRenderCount - rendersBeforeSwitch).toBeLessThan(10);
    // 草稿参数完整回填（视频面板正文 = 视频草稿 prompt）
    expect(panelPromptText()).toBe('视频草稿提示词');
    // 原图片面板按既有交互正常关闭
    expect(imageOpen()).toBe(false);
    // 选中状态落在视频草稿卡
    expect(node('v1').classList.contains('selected')).toBe(true);
    expect(node('d1').classList.contains('selected')).toBe(false);
  });

  it('图片/视频/音频草稿卡两两连续切换点击均安全', async () => {
    await renderPage();
    await vi.waitFor(() => expect(node('au1')).toBeTruthy());

    // 两两切换：图片→视频→音频→图片→音频→视频（覆盖全部有序对）
    await clickCard('d1', 120, 90);
    await vi.waitFor(() => expect(imageOpen()).toBe(true));
    await clickCard('v1', 420, 90);
    await vi.waitFor(() => expect(videoOpen()).toBe(true), { timeout: 3000 });
    expect(imageOpen()).toBe(false);

    await clickCard('au1', 720, 90);
    await vi.waitFor(() => expect(audioOpen()).toBe(true), { timeout: 3000 });
    expect(videoOpen()).toBe(false);

    await clickCard('d1', 120, 90);
    await vi.waitFor(() => expect(imageOpen()).toBe(true), { timeout: 3000 });
    expect(audioOpen()).toBe(false);

    await clickCard('au1', 720, 90);
    await vi.waitFor(() => expect(audioOpen()).toBe(true), { timeout: 3000 });
    expect(imageOpen()).toBe(false);

    await clickCard('v1', 420, 90);
    await vi.waitFor(() => expect(videoOpen()).toBe(true), { timeout: 3000 });
    expect(audioOpen()).toBe(false);

    expectNoUpdateDepthLoop();
  });

  it('同一序列快速连点亦安全（无循环通报级联）', async () => {
    await renderPage();
    await vi.waitFor(() => expect(node('d1')).toBeTruthy());

    // 快速连点：同一张视频卡连续两次 + 与图片卡快速交替，不等待面板稳定
    await clickCard('d1', 120, 90);
    await clickCard('v1', 420, 90);
    await clickCard('v1', 420, 90);
    await clickCard('d1', 120, 90);
    await clickCard('v1', 420, 90);

    await vi.waitFor(() => expect(videoOpen()).toBe(true), { timeout: 3000 });
    expectNoUpdateDepthLoop();
    expect(node('v1').classList.contains('selected')).toBe(true);
  });
});

/* 机制层哨兵（降级锁定）：@xyflow/react 12.11.2 的 SelectionListener 把 onSelectionChange
   回调自身列入 effect 依赖且不检查选中是否真的变化——回调引用一变就把当前选中等值再通报一次。
   jsdom 合成布局无法滚出浏览器里的 Maximum update depth 级联（其燃料依赖真实布局下的选中
   翻转），故按工单降级口径在此直接锁定机制契约：传给 ReactFlow 的选中回调引用在渲染间稳定，
   父层等价重渲染不再产生等值通报；选中真实变化仍正常通报。 */
describe('IKIJ60 画布容器选中回调稳定化（真实 ReactFlow 通报契约哨兵）', () => {
  it('父层等价重渲染不再等值通报；选中真实变化仍正常通报', async () => {
    const { default: FlowCanvas } = await import('./components/Canvas');
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
    // 挂载/水合期通报次数（含 SelectionListener 首轮 effect 的空选中通报）
    const afterMount = onSelectionChange.mock.calls.length;
    expect(afterMount).toBeGreaterThanOrEqual(1);

    // 点选 draft-a：真实选中变化 → 通报 [draft-a]
    await clickCard('draft-a', 120, 90);
    expect(onSelectionChange.mock.lastCall![0].nodes.map((n: Node) => n.id)).toEqual(['draft-a']);
    const afterSelect = onSelectionChange.mock.calls.length;
    expect(afterSelect).toBeGreaterThanOrEqual(afterMount + 1);

    // 父层等价重渲染：mediaNodes 数组引用重建（同内容）、回调 prop 同引用——复刻页面每轮渲染
    // 下传新数组/新处理函数的场景。修复前：容器内联包裹每轮重建 → SelectionListener 等值再通报；
    // 修复后：回调引用稳定，通报次数不变。
    await act(async () => {
      root.render(createElement(FlowCanvas, {
        ...baseProps,
        mediaNodes: [mediaNode('draft-a', 50), mediaNode('draft-b', 500)],
      }));
    });
    await act(async () => {});
    expect(onSelectionChange).toHaveBeenCalledTimes(afterSelect);

    // 选中真实变化（改点 draft-b）仍正常通报，行为无损
    await clickCard('draft-b', 420, 90);
    expect(onSelectionChange.mock.lastCall![0].nodes.map((n: Node) => n.id)).toEqual(['draft-b']);
    expect(onSelectionChange.mock.calls.length).toBe(afterSelect + 1);
  });
});
