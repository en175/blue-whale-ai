// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';

/* IKFYH6 生成面板「点面板外 / Esc」统一关闭：五面板（视频/图片/音频/文本生成/音乐）同口径。
   覆盖拍板口径：空白 PaneClick 统一关、选中变化补自由面板、document 捕获 click 管画布外 UI
   （拖拽位移抑制、.react-flow 与「面板领土」豁免）、Esc 优先级链（@菜单→选取→输入框→关面板）、
   持续选取会话中空白点击只退选取（推翻 IKFR4X/Y/Z 空白不退出旧口径）。
   FlowCanvas/CanvasToolbar 打桩透出 props；面板真实渲染（PromptRefEditor 打桩 textarea）。 */

vi.mock('./characterLibraryDeposit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./characterLibraryDeposit')>()),
  depositCanvasAssetToCharacterLibrary: vi.fn(async () => ({ materialId: 'asset-compliance-test' })),
}));

vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/Canvas', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

const toolbarProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/CanvasToolbar', () => ({
  default: (props: Record<string, any>) => {
    toolbarProps.current = props;
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

/** PromptRefEditor 打桩：textarea 输入透传结构化 onChange（与 videoDraft 同款） */
vi.mock('./components/PromptRefEditor', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    default: forwardRef(function StubPromptRefEditor(
      { onChange }: { onChange?: (doc: { version: number; segments: Array<{ kind: 'text'; text: string }> }) => void },
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
    max_reference_images: 10,
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
  fetchJobStatus: vi.fn(async () => ({
    job_id: 'j1',
    status: 'succeeded',
    progress: 100,
    asset: { id: 'a2', url: 'http://vid/out.mp4', type: 'video' },
  })),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createMediaExtraction: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(),
}));

vi.mock('@/api/projects', () => ({
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
  // 资产选择弹窗（AssetsPickerModal）useInfiniteQuery 数据源：空列表
  assetPageQueryOptions: vi.fn((type: string, size: number) => ({
    queryKey: ['asset-pages', type, size],
    initialPageParam: 1,
    queryFn: () => Promise.resolve({ records: [], total: 0, current: 1 }),
    getNextPageParam: () => undefined,
  })),
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
  createMediaExtraction: apiMocks.createMediaExtraction,
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

/** 组合夹具：普通素材 m1 / 图片草稿 d1 / 视频草稿 v1 / 音频草稿 au1 / 文生文卡 tg1 / 资产卡 c1 */
function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'm1',
          type: 'mediaNode',
          position: { x: 0, y: 0 },
          data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '普通素材', assetId: 'a1' },
        },
        {
          id: 'd1',
          type: 'mediaNode',
          position: { x: 200, y: 0 },
          data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '' },
        },
        {
          id: 'v1',
          type: 'mediaNode',
          position: { x: 400, y: 0 },
          data: { src: '', mediaType: 'video', fileName: '视频草稿', genStatus: 'draft', draft: true, prompt: '' },
        },
        {
          id: 'au1',
          type: 'mediaNode',
          position: { x: 600, y: 0 },
          data: { src: '', mediaType: 'audio', fileName: '音频草稿', genStatus: 'draft', draft: true, prompt: '' },
        },
        {
          id: 'tg1',
          type: 'textNode',
          position: { x: 800, y: 0 },
          data: { title: '文生文卡', text: '初始文案', textGen: true, prompt: '' },
        },
        {
          id: 'c1',
          type: 'assetNode',
          position: { x: 1000, y: 0 },
          data: { kind: 'custom' },
        },
        {
          id: 'g1',
          type: 'mediaNode',
          position: { x: 1200, y: 0 },
          data: { src: 'http://img/g1.png', mediaType: 'image', fileName: '生成中成品', assetId: 'a2', jobId: 'j1', genStatus: 'generating', prompt: '原提示词' },
        },
      ],
      edges: [],
    },
    assets: {
      a1: { asset_id: 1, type: 'image', access_url: 'http://img/m1.png', width: 100, height: 100 },
      a2: { asset_id: 2, type: 'image', access_url: 'http://img/g1.png', width: 100, height: 100 },
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

function fullNode(id: string): Node {
  const pools: Node[][] = [
    flowProps.current.mediaNodes ?? [],
    flowProps.current.textNodes ?? [],
    flowProps.current.assetNodes ?? [],
    flowProps.current.productNodes ?? [],
  ];
  const found = pools.flat().find((n) => n.id === id);
  if (!found) throw new Error(`节点不存在: ${id}`);
  return found;
}

async function clickNode(id: string) {
  const node = fullNode(id);
  await act(async () => {
    flowProps.current.onNodeClick(node);
  });
}

async function paneClick() {
  await act(async () => {
    flowProps.current.onPaneClick();
  });
}

async function selectNodes(ids: string[]) {
  await act(async () => {
    flowProps.current.onSelectionChange({ nodes: ids.map(fullNode), edges: [] });
  });
}

/** 面板开关标记（各面板模型选择器/标题文案仅在该面板打开时渲染） */
const imageOpen = () => container.textContent!.includes('测试生图模型');
const videoOpen = () => container.textContent!.includes('测试视频模型');
const audioOpen = () => container.textContent!.includes('测试音频模型');
const textGenOpen = () => container.textContent!.includes('文本生成 · 文生文');

async function openImageDraftPanel() {
  await clickNode('d1');
  await vi.waitFor(() => expect(imageOpen()).toBe(true));
}
async function openVideoDraftPanel() {
  await clickNode('v1');
  await vi.waitFor(() => expect(videoOpen()).toBe(true), { timeout: 3000 });
}
async function openAudioDraftPanel() {
  await clickNode('au1');
  await vi.waitFor(() => expect(audioOpen()).toBe(true), { timeout: 3000 });
}
async function openTextGenPanel() {
  await clickNode('tg1');
  await vi.waitFor(() => expect(textGenOpen()).toBe(true));
}
/** 自由图片面板（资产卡「生成图片」入口，无绑定草稿） */
async function openFreeImagePanel() {
  const card = (flowProps.current.assetNodes as Node[]).find((n) => n.id === 'c1')!;
  await act(async () => {
    (card.data as Record<string, () => void>).onGenerateImage();
  });
  await vi.waitFor(() => expect(imageOpen()).toBe(true));
}

/** 小地图按钮：面板领土与画布区域之外的中立 UI 元素 */
function mapButton(): HTMLButtonElement {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.title === '显示小地图' || b.title === '隐藏小地图',
  )!;
}

/** 原地点击元素（先 mousedown 后 click，无位移） */
async function clickElement(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
  });
}

async function pressEscape(target: EventTarget = window) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

/** 进入图片面板持续选取会话（会话提示条「完成选取」出现即活跃）；
 *  IKGB7U 起经附件操作条「+ 参考」直达（旧「+」菜单已退役） */
async function startImagePickSession() {
  await act(async () => {
    [...container.querySelectorAll('button')].find((b) => b.title === '从节点添加素材')!.click();
  });
  await vi.waitFor(() => expect(finishPickButton()).toBeTruthy());
}

function finishPickButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === '完成选取',
  );
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  // jsdom 无 scrollTo 实现：资产选择弹窗切换 tab 时调用，补空实现
  Element.prototype.scrollTo = () => {};
  seedDoc();
  apiMocks.fetchGenerationModels.mockImplementation(async (type?: string) => {
    if (type === 'audio') return [audioModel];
    if (type === 'video') return [videoModel];
    return [imageModel];
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
  vi.clearAllMocks();
});

describe('IKFYH6 空白点击统一关闭五面板', () => {
  it('绑定图片面板：点画布空白关闭', async () => {
    await renderPage();
    await openImageDraftPanel();

    await paneClick();

    expect(imageOpen()).toBe(false);
  });

  it('绑定视频面板：点画布空白关闭（推翻「视频点空白不关」旧设计）', async () => {
    await renderPage();
    await openVideoDraftPanel();

    await paneClick();

    expect(videoOpen()).toBe(false);
  });

  it('绑定音频面板：点画布空白关闭', async () => {
    await renderPage();
    await openAudioDraftPanel();

    await paneClick();

    expect(audioOpen()).toBe(false);
  });

  it('文本生成面板：点画布空白关闭', async () => {
    await renderPage();
    await openTextGenPanel();

    await paneClick();

    expect(textGenOpen()).toBe(false);
  });

  it('自由图片面板（无绑定草稿）：点画布空白关闭', async () => {
    await renderPage();
    await openFreeImagePanel();

    await paneClick();

    expect(imageOpen()).toBe(false);
  });

  it('生成中只读面板：点画布空白关闭，生成任务不受影响（验收 7）', async () => {
    // 任务持续进行中（不完成），卡片保持「生成中」只读（asset 字段仅为满足 mock 签名，running 态不消费）
    apiMocks.fetchJobStatus.mockImplementation(async () => ({ job_id: 'j1', status: 'running', progress: 40, asset: { id: '', url: '', type: 'image' } }));
    await renderPage();
    await clickNode('g1');
    // 只读视图不渲染模型名摘要，以编辑器存在判定面板打开
    const editorPresent = () => container.querySelector('[data-testid="chip-editor"]') !== null;
    await vi.waitFor(() => expect(editorPresent()).toBe(true));

    await paneClick();

    expect(editorPresent()).toBe(false);
    expect(apiMocks.cancelGenerationJob).not.toHaveBeenCalled();
  });
});

describe('IKFYH6 选中变化关闭', () => {
  it('自由图片面板：单选其他卡关闭', async () => {
    await renderPage();
    await openFreeImagePanel();

    await selectNodes(['m1']);

    expect(imageOpen()).toBe(false);
  });

  it('文本生成面板：单选其他卡关闭，单选绑定卡保持', async () => {
    await renderPage();
    await openTextGenPanel();

    await selectNodes(['tg1']);
    expect(textGenOpen()).toBe(true);

    await selectNodes(['m1']);
    expect(textGenOpen()).toBe(false);
  });

  it('框选多选：自由面板与绑定面板统一关闭', async () => {
    await renderPage();
    await openFreeImagePanel();
    await selectNodes(['m1', 'd1']);
    expect(imageOpen()).toBe(false);

    await openAudioDraftPanel();
    await selectNodes(['m1', 'd1']);
    expect(audioOpen()).toBe(false);
  });

  it('点另一张草稿卡：旧面板关闭、新面板打开', async () => {
    await renderPage();
    await openImageDraftPanel();

    await clickNode('v1');

    await vi.waitFor(() => expect(videoOpen()).toBe(true), { timeout: 3000 });
    expect(imageOpen()).toBe(false);
  });
});

describe('IKFYH6 画布外 UI 点击关闭（document click）', () => {
  it('点面板以外界面区域（小地图按钮）关闭面板', async () => {
    await renderPage();
    await openImageDraftPanel();

    await clickElement(mapButton());

    expect(imageOpen()).toBe(false);
  });

  it('点面板自身（面板领土）不关闭', async () => {
    await renderPage();
    await openImageDraftPanel();

    await clickElement(container.querySelector('[data-testid="chip-editor"]')!);

    expect(imageOpen()).toBe(true);
  });

  it('拖拽平移后产生的 click（按下与抬起有位移）不关闭', async () => {
    await renderPage();
    await openImageDraftPanel();

    await act(async () => {
      const el = mapButton();
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 220, clientY: 180 }));
    });
    expect(imageOpen()).toBe(true);

    // 中键 click 同样不触发关闭
    await act(async () => {
      mapButton().dispatchEvent(new MouseEvent('click', { bubbles: true, button: 1 }));
    });
    expect(imageOpen()).toBe(true);
  });

  it('点画布区域（.react-flow 内）不归 document 监听关闭', async () => {
    await renderPage();
    await openImageDraftPanel();

    const flow = document.createElement('div');
    flow.className = 'react-flow';
    const pane = document.createElement('div');
    pane.className = 'react-flow__pane';
    flow.appendChild(pane);
    document.body.appendChild(flow);
    await clickElement(pane);
    flow.remove();

    expect(imageOpen()).toBe(true);
  });

  it('资产选择弹窗内点击不关闭面板', async () => {
    await renderPage();
    await openFreeImagePanel();

    // IKGB7U 起经附件操作条「资产库」pill 直达资产库弹窗（旧「+」菜单已退役）
    await act(async () => {
      [...container.querySelectorAll('button')].find((b) => b.title === '从资产中选择')!.click();
    });
    const dialog = await vi.waitFor(() => {
      const el = document.body.querySelector('[role="dialog"]');
      expect(el).toBeTruthy();
      return el!;
    });

    await clickElement(dialog);

    expect(imageOpen()).toBe(true);
  });
});

describe('IKFYH6 Esc 优先级链', () => {
  it('光标在输入框内按 Esc 不关闭面板', async () => {
    await renderPage();
    await openImageDraftPanel();

    const editor = container.querySelector<HTMLElement>('[data-testid="chip-editor"]')!;
    await pressEscape(editor);

    expect(imageOpen()).toBe(true);
  });

  it('光标不在输入框按 Esc 关闭面板', async () => {
    await renderPage();
    await openImageDraftPanel();

    await pressEscape();

    expect(imageOpen()).toBe(false);
  });

  it('@ 菜单开着时按 Esc 不关闭面板（菜单自行处理 Esc）', async () => {
    await renderPage();
    await openImageDraftPanel();

    const mention = document.createElement('div');
    mention.setAttribute('data-canvas-keyboard-scope', 'mention');
    document.body.appendChild(mention);
    await pressEscape();
    mention.remove();

    expect(imageOpen()).toBe(true);
  });

  it('持续选取会话中按 Esc：退出选取、面板保留', async () => {
    await renderPage();
    await openImageDraftPanel();
    await startImagePickSession();

    await pressEscape();

    expect(finishPickButton()).toBeUndefined();
    expect(imageOpen()).toBe(true);
  });
});

describe('IKFYH6 选取会话与空白点击分层', () => {
  it('会话中点空白只退选取、面板保留；再点空白才关面板', async () => {
    await renderPage();
    await openImageDraftPanel();
    await startImagePickSession();

    await paneClick();
    expect(finishPickButton()).toBeUndefined();
    expect(imageOpen()).toBe(true);

    await paneClick();
    expect(imageOpen()).toBe(false);
  });

  it('会话中点画布卡片正常选取、面板不关', async () => {
    await renderPage();
    await openImageDraftPanel();
    await startImagePickSession();

    await clickNode('m1');

    expect(imageOpen()).toBe(true);
    expect(finishPickButton()).toBeTruthy();
  });
});
