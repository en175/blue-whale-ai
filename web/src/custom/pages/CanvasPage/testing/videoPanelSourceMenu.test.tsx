// @vitest-environment jsdom











import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../index';
import { clickSelectOption } from './radixSelect';
import { REF_SOURCE_ENTRY_TITLE } from '../components/RefSourceMenu';
import {
  ATTACHMENT_ACTION_PICK_ASSETS_TITLE,
  ATTACHMENT_ACTION_PICK_CANVAS_TITLE,
} from '../components/AttachmentActionBar';
import barStyles from '../components/AttachmentActionBar/index.module.css';
import dialogStyles from '../components/BottomDialog/index.module.css';
import { Toaster, toast } from 'sonner';

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


const assetsPickerProps: { current: Record<string, any> } = { current: {} };
vi.mock('../components/AssetsPickerModal', () => ({
  default: (props: Record<string, any>) => {
    assetsPickerProps.current = props;
    return createElement('div', { 'data-testid': 'assets-picker-stub' });
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


const genHandoffMock = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock('@/custom/utils/gen-handoff', () => ({
  setGenHandoff: vi.fn(),
  takeGenHandoff: () => {
    const h = genHandoffMock.current;
    genHandoffMock.current = null;
    return h;
  },
}));

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchMe: vi.fn(async () => null),
  fetchCredits: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  saveCanvasDoc: vi.fn(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  createGenerationJob: vi.fn(async (_projectId: string, _payload: Record<string, any>) => ({ generation_job_id: 'j1', cursor: 1 })),
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
  fetchGenerationModels: vi.fn(async () => [
    {
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
    },
  ]),
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
  linkAssetToProject: vi.fn(async () => undefined),
}));

vi.mock('@/custom/api/canvas', () => ({
  applyPromptPreview: vi.fn(),
  referencePromptPlan: vi.fn(),
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => Promise.resolve({ items: [] }), retry: false }),
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn((edges: Array<{ id: string; source: string; target: string; data?: unknown }>) =>
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
        { id: 'm1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '首图', assetId: 'a1' } },
        { id: 'm2', type: 'mediaNode', position: { x: 400, y: 0 }, data: { src: 'http://img/m2.png', mediaType: 'image', fileName: '次图', assetId: 'a2' } },
        { id: 'v1', type: 'mediaNode', position: { x: 800, y: 0 }, data: { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '参考视频', assetId: 'a3' } },
        { id: 's1', type: 'mediaNode', position: { x: 1000, y: 0 }, data: { src: 'http://aud/s1.mp3', mediaType: 'audio', fileName: '参考音频', assetId: 'a4' } },
        { id: 'd1', type: 'mediaNode', position: { x: 200, y: 300 }, data: { src: '', mediaType: 'video', fileName: '视频草稿', genStatus: 'draft', draft: true, prompt: '', draftModelId: 'seedance-2', draftSize: '720p', draftRatio: '16:9', draftDuration: 5 } },
      ],
      edges: [],
    },
    assets: {
      a1: { asset_id: 1, type: 'image', access_url: 'http://img/m1.png', width: 100, height: 100 },
      a2: { asset_id: 2, type: 'image', access_url: 'http://img/m2.png', width: 100, height: 100 },
      a3: { asset_id: 3, type: 'video', access_url: 'http://vid/v1.mp4', width: 100, height: 100 },
      a4: { asset_id: 4, type: 'audio', access_url: 'http://aud/s1.mp3', width: 100, height: 100 },
    },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

let root: Root;
let container: HTMLDivElement;

async function renderPage(withHomeHandoff = false) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  toast.dismiss();

  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(
          MemoryRouter,
          withHomeHandoff
            ? { initialEntries: [{ pathname: '/c', state: { genKind: 'video' } }] }
            : undefined,
          createElement(CanvasPage), createElement(Toaster, { duration: Infinity }),
        ),
      ),
    );
  });
}


function sourceEntryButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === REF_SOURCE_ENTRY_TITLE,
  );
}


function pickReferenceButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '参考');
}


function assetsLibraryButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '资产库');
}


async function clickPickReference() {
  await act(async () => {
    pickReferenceButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}


async function clickAssetsLibrary() {
  await act(async () => {
    assetsLibraryButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}


function attachmentStrip(): Element | null {
  return container.querySelector(`.${dialogStyles.refSlot}`);
}


async function clickMenuItem(entry: HTMLButtonElement, label: '从资产中选择' | '从节点添加素材') {
  await act(async () => {
    entry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  const item = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label,
  )!;
  await act(async () => {
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}


async function clickNode(id: string) {
  const node = flowProps.current.mediaNodes.find((n: Node) => n.id === id)
    ?? flowProps.current.textNodes.find((n: Node) => n.id === id)!;
  await act(async () => {
    flowProps.current.onNodeClick(node);
  });
}


async function openBoundPanel() {
  await act(async () => {
    toolbarProps.current.onToggleVideoDialog();
  });
  await vi.waitFor(() => expect(container.textContent).toContain('测试视频模型'));
}


async function openFreePanelFromHome(mode: 'omni' | 'first_last_frame' | 'image_reference' = 'omni') {
  genHandoffMock.current = { kind: 'video', text: '', modelId: 'seedance-2', aspectRatio: '16:9', resolution: '720p', duration: 5, mode, refs: [] };
  await renderPage(true);
  await vi.waitFor(() => expect(pickReferenceButton()).toBeTruthy());
}


function dockRefCount(): number {
  return container.querySelectorAll('[data-testid="dock-video-ref"]').length;
}


function frameBadges(): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-testid="ref-thumb-badge"]')].map((el) => el.textContent ?? '');
}


function currentVideoDraftId(): string {
  const drafts = flowProps.current.mediaNodes.filter(
    (n: Node) => n.data?.draft === true && n.data?.mediaType === 'video',
  );
  return drafts[drafts.length - 1].id;
}


function edgePairs(): string[] {
  const target = currentVideoDraftId();
  return flowProps.current.edges
    .filter((e: { target: string }) => e.target === target)
    .map((e: { source: string; target: string }) => `${e.source}->${e.target}`);
}

const MODE_LABELS = ['文生视频', '全能参考', '图片参考', '图生视频', '首尾帧', '视频编辑', '视频延长'];



async function switchMode(label: '全能参考' | '图片参考' | '首尾帧') {
  const modeButtons = () => [...container.querySelectorAll('button')].filter((b) => MODE_LABELS.includes(b.textContent ?? ''));
  if (modeButtons().length <= 1) {
    await act(async () => { modeButtons()[0]!.click(); });
  }
  await clickSelectOption(label);
  await act(async () => { await Promise.resolve(); });
}

function toastText(): string {
  return document.body.textContent ?? '';
}


async function pressEscape() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  let now = 1_000;
  vi.spyOn(Date, 'now').mockImplementation(() => ++now);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.restoreAllMocks();
});

describe('IKGB7W 视频面板附件操作条（普通参考模式）', () => {
  it('首页带入面板（新建草稿卡绑定）：操作条「+ 参考」「资产库」常显，栏尾旧「+」退役，无角色库与媒体专属图标', async () => {
    await openFreePanelFromHome('omni');

    expect(pickReferenceButton()).toBeTruthy();
    expect(assetsLibraryButton()).toBeTruthy();
    expect(pickReferenceButton()!.getAttribute('title')).toBe(ATTACHMENT_ACTION_PICK_CANVAS_TITLE);
    expect(assetsLibraryButton()!.getAttribute('title')).toBe(ATTACHMENT_ACTION_PICK_ASSETS_TITLE);

    expect(sourceEntryButton()).toBeUndefined();

    expect([...container.querySelectorAll('button')].some((b) => (b.title ?? '').startsWith('添加图片参考'))).toBe(false);
    expect([...container.querySelectorAll('button')].some((b) => (b.title ?? '').startsWith('添加视频参考'))).toBe(false);
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === '角色库')).toBe(false);
  });

  it('工具栏面板（草稿绑定）：操作条两入口常显，旧「+」退役；展开/关闭并入操作条右侧', async () => {
    await renderPage();
    await openBoundPanel();

    const bar = pickReferenceButton()!.closest(`.${barStyles.actionBar}`)!;
    expect(bar).toBeTruthy();
    expect(bar.querySelector(`.${barStyles.trailing} button[title="展开"]`)).toBeTruthy();
    expect(bar.querySelector(`.${barStyles.trailing} button[title="关闭"]`)).toBeTruthy();
    expect(assetsLibraryButton()).toBeTruthy();
    expect(sourceEntryButton()).toBeUndefined();
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === '角色库')).toBe(false);
  });

  it('空态：无附件时附件栏不渲染；点选首个参考后附件栏出现在操作条与输入框之间', async () => {
    await renderPage();
    await openBoundPanel();
    expect(attachmentStrip()).toBeNull();

    await clickPickReference();
    await clickNode('m1');

    await vi.waitFor(() => expect(dockRefCount()).toBe(1));
    const bar = pickReferenceButton()!.closest(`.${barStyles.actionBar}`)!;
    const strip = attachmentStrip()!;
    const editor = container.querySelector('[contenteditable]')!;
    expect(bar.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('点「+ 参考」直接进入画布点选模式且按钮高亮（picking 态）', async () => {
    await openFreePanelFromHome('omni');

    await clickPickReference();

    await vi.waitFor(() => expect(container.textContent).toContain('连续点击画布中的图片、视频或音频节点带入参考'), { timeout: 3000 });
    expect(pickReferenceButton()!.classList.contains(barStyles.picking)).toBe(true);
    expect(assetsLibraryButton()!.classList.contains(barStyles.picking)).toBe(false);
  });

  it('全能参考点「资产库」：直接打开同一资产库弹窗，列表过滤含图片/视频/音频', async () => {
    await renderPage();
    await openBoundPanel();
    await switchMode('全能参考');

    await clickAssetsLibrary();
    expect(assetsPickerProps.current.mediaTypes).toEqual(['image', 'video', 'audio']);
  });

  it('图片参考点「资产库」：列表过滤仅图片（隐藏视频/音频）', async () => {
    await renderPage();
    await openBoundPanel();
    await clickPickReference();
    await clickNode('m1');
    await pressEscape();
    await switchMode('图片参考');

    await clickAssetsLibrary();
    expect(assetsPickerProps.current.mediaTypes).toEqual(['image']);
  });

  it('全能参考点「+ 参考」：图片/视频/音频节点均接纳建线（IKFE8U 音频参考入口补齐口径不变）', async () => {
    await renderPage();
    await openBoundPanel();
    await switchMode('全能参考');

    await clickPickReference();
    await clickNode('m1');
    expect(edgePairs()).toEqual(['m1->' + currentVideoDraftId()]);

    await clickNode('v1');
    await clickNode('s1');

    expect(edgePairs().sort()).toEqual(['m1->' + currentVideoDraftId(), 's1->' + currentVideoDraftId(), 'v1->' + currentVideoDraftId()]);
    await vi.waitFor(() => expect(dockRefCount()).toBe(3));
  });

  it('图片参考点「+ 参考」：视频节点禁选并提示且零新增；图片节点仍可接纳', async () => {
    await renderPage();
    await openBoundPanel();
    await clickPickReference();
    await clickNode('m1');

    await pressEscape();
    await switchMode('图片参考');

    await clickPickReference();
    await clickNode('v1');

    await vi.waitFor(() => expect(toastText()).toContain('图片参考仅支持图片素材'), { timeout: 3000 });
    expect(edgePairs()).toEqual(['m1->' + currentVideoDraftId()]);

    await clickNode('m2');
    expect(edgePairs().sort()).toEqual(['m1->' + currentVideoDraftId(), 'm2->' + currentVideoDraftId()]);
  });

  it('首尾帧具名槽位（seed 恢复满帧）：槽位保留、角色不串位；操作条常显、两槽满置灰并说明原因', async () => {


    const doc = canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>>; edges: unknown[] };
    (doc.nodes.find((n) => n.id === 'd1')!.data as Record<string, unknown>).draftMode = 'first_last_frame';
    doc.edges = [
      { id: 'f1', source: 'm1', target: 'd1', data: { refRole: 'first' } },
      { id: 'f2', source: 'm2', target: 'd1', data: { refRole: 'last' } },
    ];
    await renderPage();
    await clickNode('d1');
    await vi.waitFor(() => expect(container.textContent).toContain('测试视频模型'));


    await vi.waitFor(() => expect(dockRefCount()).toBe(2));
    expect(frameBadges()).toEqual(['首帧', '尾帧']);


    expect(sourceEntryButton()).toBeUndefined();
    expect([...container.querySelectorAll('button')].some((b) => (b.title ?? '').startsWith('添加图片参考'))).toBe(false);
    expect([...container.querySelectorAll('button')].some((b) => (b.title ?? '').startsWith('添加视频参考'))).toBe(false);
    expect(pickReferenceButton()).toBeTruthy();
    for (const btn of [pickReferenceButton()!, assetsLibraryButton()!]) {
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.getAttribute('title')).toBe('首帧已指定，请先移除后再添加');
    }
  });

  it('全能参考资产库确认：音频接纳落画布建线，音频满额跳过并提示（IKFE8U 音频联算口径不变）', async () => {
    await renderPage();
    await openBoundPanel();
    await switchMode('全能参考');


    const audioAsset = (i: number) => ({
      id: 900 + i, type: 'audio' as const, url: `http://aud/pick${i}.mp3`, width: null, height: null, duration: 12,
    });
    await clickAssetsLibrary();
    await act(async () => {
      assetsPickerProps.current.onSelect([audioAsset(0), audioAsset(1)]);
    });
    await vi.waitFor(() => expect(edgePairs().length).toBe(2));
    await vi.waitFor(() => expect(dockRefCount()).toBe(2));


    await clickAssetsLibrary();
    await act(async () => {
      assetsPickerProps.current.onSelect([audioAsset(2), audioAsset(3)]);
    });
    await vi.waitFor(() => expect(toastText()).toContain('参考音频最多 3 段'), { timeout: 3000 });
    await vi.waitFor(() => expect(edgePairs().length).toBe(3));
  });

  it('选取模式提示条：进入即持续会话文案，命中后不退出（IKFR4Y 语义）', async () => {
    await renderPage();
    await openBoundPanel();
    await switchMode('全能参考');

    await clickPickReference();

    await vi.waitFor(() => expect(container.textContent).toContain('连续点击画布中的图片、视频或音频节点带入参考'), { timeout: 3000 });
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === '完成选取')).toBe(true);

    await clickNode('m1');
    await vi.waitFor(() => expect(container.textContent).toContain('完成选取'), { timeout: 3000 });
    expect(container.textContent).not.toContain('点击空白处取消');
  });
});


describe('IKGB7Y 首尾帧操作条顺序填充与溢出处理', () => {

  function seedKeyframeEmptySlots() {
    const doc = canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>>; edges: unknown[] };
    (doc.nodes.find((n) => n.id === 'd1')!.data as Record<string, unknown>).draftMode = 'first_last_frame';
    doc.edges = [
      { id: 'e-m1-d1', source: 'm1', target: 'd1' },
      { id: 'e-m2-d1', source: 'm2', target: 'd1' },
    ];
  }


  function seedKeyframeFirstFilled() {
    const doc = canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>>; edges: unknown[] };
    (doc.nodes.find((n) => n.id === 'd1')!.data as Record<string, unknown>).draftMode = 'first_last_frame';
    doc.edges = [{ id: 'f1', source: 'm1', target: 'd1', data: { refRole: 'first' } }];
  }


  function pushImageNode(id: string, assetId: string, name: string) {
    const doc = canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> };
    doc.nodes.push({
      id, type: 'mediaNode', position: { x: 0, y: 700 },
      data: { src: `http://img/${id}.png`, mediaType: 'image', fileName: name, assetId },
    });
    (canvasDocMock.current.assets as Record<string, unknown>)[assetId] =
      { asset_id: Number(assetId.slice(1)), type: 'image', access_url: `http://img/${id}.png`, width: 100, height: 100 };
  }


  async function openSeededPanel() {
    await renderPage();
    await clickNode('d1');
    await vi.waitFor(() => expect(container.textContent).toContain('测试视频模型'));
  }

  const pickActive = () => flowProps.current.refPickActive === true;
  const finishPickButton = () =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '完成选取');

  const frameEdges = () =>
    (flowProps.current.edges as Array<{ source: string; target: string; data?: { refRole?: string } }>)
      .filter((e) => e.target === 'd1' && (e.data?.refRole === 'first' || e.data?.refRole === 'last'));
  const nodeAssetId = (id: string) =>
    String(((flowProps.current.mediaNodes.find((n: Node) => n.id === id)?.data ?? {}) as Record<string, unknown>).assetId);
  const canvasHasAsset = (assetId: string) =>
    flowProps.current.mediaNodes.some((n: Node) => String((n.data as Record<string, unknown>).assetId) === assetId);

  const imageAsset = (i: number) => ({
    id: 900 + i, type: 'image' as const, url: `http://img/pick${i}.png`, width: 100, height: 100,
  });

  it('首帧已有、尾帧空：操作条「+ 参考」点选进尾帧；两槽填满自动退出选取并提示「首尾帧已就绪」', async () => {
    seedKeyframeFirstFilled();
    await openSeededPanel();
    await vi.waitFor(() => expect(frameBadges()).toEqual(['首帧']));


    expect(pickReferenceButton()!.getAttribute('aria-disabled')).toBeNull();
    expect(assetsLibraryButton()!.getAttribute('aria-disabled')).toBeNull();

    await clickPickReference();

    expect(pickActive()).toBe(true);
    expect(finishPickButton()).toBeTruthy();
    expect(pickReferenceButton()!.classList.contains(barStyles.picking)).toBe(true);

    await clickNode('m2');

    expect(frameEdges().some((e) => e.source === 'm2' && e.data?.refRole === 'last')).toBe(true);

    expect(pickActive()).toBe(false);
    expect(finishPickButton()).toBeUndefined();
    await vi.waitFor(() => expect(toastText()).toContain('首尾帧已就绪'), { timeout: 3000 });
    await vi.waitFor(() => expect(frameBadges()).toEqual(['首帧', '尾帧']));
  });

  it('两槽均空：第一张点选进首帧且会话保持（未填满不退出），再次发起第二张进尾帧后自动退出', async () => {
    seedKeyframeEmptySlots();
    pushImageNode('m3', 'a5', '候选图一');
    pushImageNode('m4', 'a6', '候选图二');
    await openSeededPanel();


    expect(pickReferenceButton()!.getAttribute('aria-disabled')).toBeNull();
    await clickPickReference();
    await clickNode('m3');
    expect(frameEdges().some((e) => e.source === 'm3' && e.data?.refRole === 'first')).toBe(true);

    expect(pickActive()).toBe(true);
    expect(finishPickButton()).toBeTruthy();
    expect(toastText()).not.toContain('首尾帧已就绪');


    await pressEscape();
    await clickPickReference();
    await clickNode('m4');
    expect(frameEdges().some((e) => e.source === 'm4' && e.data?.refRole === 'last')).toBe(true);
    expect(pickActive()).toBe(false);
    await vi.waitFor(() => expect(toastText()).toContain('首尾帧已就绪'), { timeout: 3000 });
  });

  it('资产库多选超剩余空槽（两槽均空选 3 张）：按选择顺序只取前两张填满首/尾帧并 toast 提示', async () => {
    seedKeyframeEmptySlots();
    await openSeededPanel();

    await clickAssetsLibrary();

    expect(assetsPickerProps.current.mediaTypes).toEqual(['image']);
    await act(async () => {
      assetsPickerProps.current.onSelect([imageAsset(1), imageAsset(2), imageAsset(3)]);
    });


    const first = frameEdges().find((e) => e.data?.refRole === 'first')!;
    const last = frameEdges().find((e) => e.data?.refRole === 'last')!;
    expect(nodeAssetId(first.source)).toBe('901');
    expect(nodeAssetId(last.source)).toBe('902');
    expect(canvasHasAsset('903')).toBe(false);
    await vi.waitFor(() => expect(toastText()).toContain('首尾帧最多两张图片，已按选择顺序取前两张'), { timeout: 3000 });
    await vi.waitFor(() => expect(frameBadges()).toEqual(['首帧', '尾帧']));
  });

  it('资产库多选仅剩一个空槽（首帧已有选 2 张）：只取第一张进尾帧并提示', async () => {
    seedKeyframeFirstFilled();
    await openSeededPanel();
    await vi.waitFor(() => expect(frameBadges()).toEqual(['首帧']));

    await clickAssetsLibrary();
    await act(async () => {
      assetsPickerProps.current.onSelect([imageAsset(1), imageAsset(2)]);
    });

    const last = frameEdges().find((e) => e.data?.refRole === 'last')!;
    expect(nodeAssetId(last.source)).toBe('901');
    expect(canvasHasAsset('902')).toBe(false);
    await vi.waitFor(() => expect(toastText()).toContain('首尾帧仅支持一张图片，已取首张'), { timeout: 3000 });
    await vi.waitFor(() => expect(frameBadges()).toEqual(['首帧', '尾帧']));
  });
});


describe('IKFEWF 文本选取边界', () => {
  it('普通文本通过视频入口建立附件且重复选取不重复连线', async () => {
    const doc = canvasDocMock.current.doc as { nodes: Node[] };
    doc.nodes.push({ id: 't1', type: 'textNode', position: { x: 0, y: 500 }, data: { text: '普通文本上下文' } });
    await renderPage();
    await openBoundPanel();
    await clickPickReference();
    await clickNode('t1');
    expect(edgePairs()).toEqual([`t1->${currentVideoDraftId()}`]);

    await clickNode('t1');
    expect(edgePairs()).toHaveLength(1);
  });

  it.each([false, true])('首尾帧槽拒绝文本（方案=%s）并保持选取', async (plan) => {
    const doc = canvasDocMock.current.doc as { nodes: Node[]; edges: unknown[] };
    doc.nodes.push({ id: 't1', type: 'textNode', position: { x: 0, y: 500 }, data: { text: '文本上下文', ...(plan ? { promptSource: { kind: 'plan' } } : {}) } });
    doc.nodes.push({ id: 'm3', type: 'mediaNode', position: { x: 0, y: 700 }, data: { src: 'http://img/m3.png', mediaType: 'image', assetId: 'a5' } });
    canvasDocMock.current.assets.a5 = { asset_id: 5, type: 'image', access_url: 'http://img/m3.png', width: 100, height: 100 };

    doc.edges = [{ id: 'e3', source: 'm3', target: 'd1' }, { id: 'e1', source: 'm1', target: 'd1', data: { refRole: 'first' } }, { id: 'e2', source: 'm2', target: 'd1', data: { refRole: 'last' } }];
    doc.nodes.find(n => n.id === 'd1')!.data.draftMode = 'first_last_frame';
    await renderPage();
    await clickNode('d1');
    await switchMode('首尾帧');
    const remove = container.querySelectorAll<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title="移除"]')[1]!;
    await act(async () => remove.click());
    const slot = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.title.includes('尾帧') && b.title.includes('从资产'))!;
    await clickMenuItem(slot, '从节点添加素材');
    await clickNode('t1');
    await vi.waitFor(() => expect(toastText()).toContain('首尾帧仅支持图片素材'), { timeout: 3000 });
    expect(flowProps.current.edges.some((e: { source: string }) => e.source === 't1')).toBe(false);
    await clickNode('m2');
    expect(flowProps.current.edges.some((e: { source: string; data?: { refRole?: string } }) => e.source === 'm2' && e.data?.refRole === 'last')).toBe(true);
  });
});
