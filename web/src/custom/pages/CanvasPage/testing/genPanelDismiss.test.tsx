// @vitest-environment jsdom
import { act, createElement, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import CanvasPage from '../index';
import { clickSelectOption } from './radixSelect';
import type { GenerationDockDefinition } from '../generation/generationDockCoordinator';
import { createTextGenerationDock } from '../generation/textGenerationDock';
import TextGenerationDockPanel from '../generation/textGenerationDockPanel';


const addedDock = vi.hoisted(() => {
  const nodes: Node[] = [];
  return { open: () => {}, active: (): string | null => null, nodes };
});

vi.mock('../generation/generationDockCoordinator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../generation/generationDockCoordinator')>();
  return { ...actual, createGenerationDockCoordinator<R extends Record<string, GenerationDockDefinition>>(registry: R) {
    const added: ReturnType<typeof createTextGenerationDock> = createTextGenerationDock(() => ({
      getNodes: () => addedDock.nodes, getEdges: () => [], attachmentsOf: () => [], beginEdit() {},
      patchNode: (id, patch) => {
        const node = addedDock.nodes.find(node => node.id === id)!;
        node.data = { ...node.data, ...patch };
      },
      render: (): ReactNode => createElement(TextGenerationDockPanel, {
        view: added.view(), resources: {}, actions: {
          close: () => dock.close('added'),
          updateDraft: patch => dock.updateDraft('added', patch),
          submit: input => dock.submit('added', input),
        },
      }),
    }));
    const dock = actual.createGenerationDockCoordinator({ ...registry, added });
    addedDock.open = () => { dock.open('added', { nodeId: 'added' }); };
    addedDock.active = () => String(dock.view.activePanel ?? '') || null;
    return dock;
  } };
});


type ConnectMenuProps = ComponentProps<typeof import('../components/ConnectTypeMenu').default>;
const connectMenuProps = vi.hoisted(() => ({ current: null as ConnectMenuProps | null }));
vi.mock('../components/ConnectTypeMenu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/ConnectTypeMenu')>();
  return { ...actual, default: (props: ConnectMenuProps) => { connectMenuProps.current = props; return createElement(actual.default, props); } };
});

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
vi.mock('../assets/characterLibraryDeposit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../assets/characterLibraryDeposit')>()),
  depositCanvasAssetToCharacterLibrary: vi.fn(async () => ({ materialId: 'asset-compliance-test' })),
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

const toolbarProps: { current: Record<string, any> } = { current: {} };
vi.mock('../components/CanvasToolbar', () => ({
  default: (props: Record<string, any>) => {
    toolbarProps.current = props;
    return createElement('div', { 'data-testid': 'canvas-toolbar' });
  },
}));

vi.mock('../components/CanvasHeader', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));

vi.mock('../components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

vi.mock('@/custom/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/custom/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

vi.mock('../components/PromptRefEditor', async () => {
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
  supported_sizes: [{ id: '720p', label: '720p', api_value: '720p' }],
  supported_aspect_ratios: [{ id: '16:9', label: '16:9' }],
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
  fetchCredits: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  applyPromptPreview: vi.fn(),
  referencePromptPlan: vi.fn(),
  createConversationQuote: vi.fn(),
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
  createConversationQuote: apiMocks.createConversationQuote,
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
async function openFreeImagePanel() {
  const card = (flowProps.current.assetNodes as Node[]).find((n) => n.id === 'c1')!;
  await act(async () => {
    (card.data as Record<string, () => void>).onGenerateImage();
  });
  await vi.waitFor(() => expect(imageOpen()).toBe(true));
}

function mapButton(): HTMLButtonElement {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.title === '显示小地图' || b.title === '隐藏小地图',
  )!;
}

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
    apiMocks.fetchJobStatus.mockImplementation(async () => ({ job_id: 'j1', status: 'running', progress: 40, asset: { id: '', url: '', type: 'image' } }));
    await renderPage();
    await clickNode('g1');
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

  it('时长滑杆（原生 range）聚焦按 Esc 关闭视频底部对话框（IKI61N：组件内自闭环，不被 INPUT 豁免吞键）', async () => {
    await renderPage();
    await openVideoDraftPanel();
    const configBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('16:9'))!;
    await act(async () => {
      configBtn.click();
    });
    const slider = container.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(slider).toBeTruthy();

    await pressEscape(slider);

    expect(videoOpen()).toBe(false);
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


describe('IKJUGY 文生文真实页面接线', () => {
  it('点卡输入与模型写回，当前附件加正文只写本地卡片，不创建任务', async () => {
    const doc = canvasDocMock.current.doc as { nodes: Node[]; edges: Edge[] };
    const target = doc.nodes.find(node => node.id === 'tg1')!;
    target.data = { ...target.data, prompt: '原描述', draftModelId: 'stored-text-model' };
    doc.nodes.push({ id: 'source-text', type: 'textNode', position: { x: 0, y: 100 }, data: { title: '附加文案', text: '附件正文' } });
    doc.edges.push({ id: 'attachment-edge', source: 'source-text', target: 'tg1' });
    apiMocks.fetchGenerationModels.mockResolvedValue([
      { ...imageModel, model_id: 'default-text-model', model_label: '默认文本模型', is_default: true },
      { ...imageModel, model_id: 'stored-text-model', model_label: '旧文本模型', is_default: false },
    ]);
    await renderPage();
    await openTextGenPanel();
    await vi.waitFor(() => expect(container.textContent).toContain('默认文本模型'));
    const input = container.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(input.value).toBe('原描述');
    await vi.waitFor(() => expect(container.textContent).toContain('附加文案：附件正文'), { timeout: 3000 });
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '新的正文');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(fullNode('tg1').data.prompt).toBe('新的正文');
    const model = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === '默认文本模型')!;
    await act(async () => { model.click(); });
    await clickSelectOption('旧文本模型');
    expect(fullNode('tg1').data.draftModelId).toBe('stored-text-model');
    await act(async () => { container.querySelector<HTMLButtonElement>('button[title="发送"]')!.click(); });
    expect(fullNode('tg1').data).toMatchObject({ text: '附件正文\n\n新的正文', prompt: '新的正文', draftModelId: 'stored-text-model' });
    expect(textGenOpen()).toBe(false);
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });
  it('水合卡自己写内容后跳过一次点卡，关闭后的纯选中不回弹', async () => {
    await renderPage();
    await openTextGenPanel();
    const writeSelf = fullNode('tg1').data.onWriteSelf;
    if (typeof writeSelf !== 'function') throw new Error('缺少自己写内容入口');
    await act(async () => { writeSelf(); });
    expect(textGenOpen()).toBe(false);
    await clickNode('tg1');
    expect(textGenOpen()).toBe(false);
    await clickNode('tg1');
    expect(textGenOpen()).toBe(true);
    await paneClick();
    await selectNodes(['tg1']);
    expect(textGenOpen()).toBe(false);
  });
  it('真实菜单保留三项，文本新建仅验证页面回调，新卡自己写内容也只跳过一次', async () => {
    await renderPage();
    await act(async () => { flowProps.current.onConnectGroupDrop(['tg1'], null, { x: 100, y: 100 }); });
    const labels = Array.from(document.body.querySelectorAll('button')).map(button => button.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(['图片生成', '视频生成', '音频生成']));
    expect(labels).not.toContain('文本生成');
    expect(connectMenuProps.current?.onSelect).toBeTypeOf('function');
    await act(async () => { connectMenuProps.current!.onSelect('text'); });
    const added = flowProps.current.textNodes.find((node: Node) => node.id !== 'tg1' && node.data.textGen === true);
    expect(added).toBeTruthy();
    expect(textGenOpen()).toBe(true);
    expect(flowProps.current.edges.some((edge: { source: string; target: string }) => edge.source === 'tg1' && edge.target === added.id)).toBe(true);
    await act(async () => { added.data.onWriteSelf(); });
    await clickNode(added.id);
    expect(textGenOpen()).toBe(false);
    await clickNode(added.id);
    expect(textGenOpen()).toBe(true);
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });
});


describe('IKJUH5 注册扩展的真实页面契约', () => {
  beforeEach(() => {
    addedDock.nodes = [{ id: 'added', type: 'textNode', position: { x: 0, y: 0 }, data: { textGen: true, prompt: '新增定义的正文' } }];
    apiMocks.fetchGenerationModels.mockResolvedValue([{ ...imageModel, model_id: 'text-model', model_label: '扩展测试模型' }]);
  });

  it('只加registry定义，真实Page无参render自动显示真实组件，原面板互斥与submit写宿主结果均工作', async () => {
    await renderPage();
    await clickNode('d1');
    expect(addedDock.active()).toBe('image');
    await act(async () => { addedDock.open(); });
    expect(addedDock.active()).toBe('added');
    expect(document.body.querySelectorAll('textarea[placeholder="描述你希望生成的文案，可结合连入的参考。"]')).toHaveLength(1);
    expect(document.body.querySelectorAll('[data-gen-panel-territory] button[title="发送"]')).toHaveLength(1);
    await act(async () => { document.body.querySelector<HTMLButtonElement>('[data-gen-panel-territory] button[title="发送"]')!.click(); });
    expect(addedDock.nodes[0].data).toMatchObject({ text: '新增定义的正文', prompt: '新增定义的正文', draftModelId: 'text-model' });
    expect(addedDock.active()).toBeNull();
    expect(document.body.querySelector('textarea[placeholder="描述你希望生成的文案，可结合连入的参考。"]')).toBeNull();
    await act(async () => { addedDock.open(); });
    await act(async () => { document.body.querySelector<HTMLButtonElement>('[data-gen-panel-territory] button[title="关闭"]')!.click(); });
    expect(addedDock.active()).toBeNull();
  });

  it('新增registry定义仍由原页面Esc和空白全收起链关闭，不添加kind事件分支', async () => {
    await renderPage();
    await act(async () => { addedDock.open(); });
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(addedDock.active()).toBeNull();
    await act(async () => { addedDock.open(); });
    await act(async () => { flowProps.current.onPaneClick(); });
    expect(addedDock.active()).toBeNull();
  });

  it('页面卸载清监听，旧实例不再消费Esc或画布外点击', async () => {
    await renderPage();
    await act(async () => { addedDock.open(); });
    await act(async () => { root.unmount(); });
    container.remove();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(addedDock.active()).toBe('added');
  });

  it('新增registry定义仍由原页面画布外点击链收起，面板领土内点击保持可见', async () => {
    await renderPage();
    await act(async () => { addedDock.open(); });
    const textarea = document.body.querySelector<HTMLTextAreaElement>('textarea[placeholder="描述你希望生成的文案，可结合连入的参考。"]')!;
    await act(async () => { textarea.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(addedDock.active()).toBe('added');
    const neutral = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(button => button.title === '显示小地图')!;
    await act(async () => {
      neutral.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
      neutral.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    expect(addedDock.active()).toBeNull();
  });

  it('面板领土内按下、click 被重定向到 body：不收起面板（IKM0TP Radix 下拉开合）', async () => {
    await renderPage();
    await act(async () => { addedDock.open(); });
    const territory = document.body.querySelector<HTMLElement>('[data-gen-panel-territory]')!;
    expect(territory).toBeTruthy();
    await act(async () => {
      territory.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    expect(addedDock.active()).toBe('added');
  });

  it('无配对 mousedown 的重定向 click（Radix 触发器 preventDefault 抑制 mousedown）不收起面板', async () => {
    await renderPage();
    await act(async () => { addedDock.open(); });
    await act(async () => {
      document.documentElement.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    expect(addedDock.active()).toBe('added');
  });

  it('真实点画布空白（有 mousedown 起点、不在领土内）仍收起面板', async () => {
    await renderPage();
    await act(async () => { addedDock.open(); });
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 10, clientY: 10 }));
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    expect(addedDock.active()).toBeNull();
  });
});
