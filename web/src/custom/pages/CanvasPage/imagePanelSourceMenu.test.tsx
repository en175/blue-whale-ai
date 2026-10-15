// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { REF_SOURCE_ENTRY_TITLE } from './components/RefSourceMenu';
import {
  ATTACHMENT_ACTION_PICK_ASSETS_TITLE,
  ATTACHMENT_ACTION_PICK_CANVAS_TITLE,
} from './components/AttachmentActionBar';
import barStyles from './components/AttachmentActionBar/index.module.css';
import dialogStyles from './components/ImageDialog/index.module.css';
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

const assetsPickerProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/AssetsPickerModal', () => ({
  default: (props: Record<string, any>) => {
    assetsPickerProps.current = props;
    return createElement('div', { 'data-testid': 'assets-picker-stub' });
  },
}));

vi.mock('./components/CanvasHeader', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));

vi.mock('./components/ProjectSelector', () => ({
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
    asset: { id: 'a2', url: 'http://img/out.png', type: 'image' },
  })),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async () => [
    {
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
      features: { reference_image: true, image_reference_max: 9 },
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
  linkAssetToProject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/custom/api/canvas', () => ({
  applyPromptPreview: vi.fn(),
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => Promise.resolve({ items: [] }), retry: false }),
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn((edges: Array<{ id: string; source: string; target: string }>) =>
    JSON.stringify(edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))),
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
        { id: 'm1', type: 'mediaNode', position: { x: 200, y: 0 }, data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '素材图一', assetId: 'a1' } },
        { id: 'v1', type: 'mediaNode', position: { x: 400, y: 0 }, data: { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '素材视频', assetId: 'a9' } },
        { id: 's1', type: 'mediaNode', position: { x: 600, y: 0 }, data: { src: 'http://aud/s1.mp3', mediaType: 'audio', fileName: '素材音频', assetId: 'a8' } },
        { id: 'd1', type: 'mediaNode', position: { x: 420, y: 160 }, data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '' } },
      ],
      edges: [],
    },
    assets: {
      a1: { asset_id: 1, type: 'image', access_url: 'http://img/m1.png', width: 100, height: 100 },
      a9: { asset_id: 9, type: 'video', access_url: 'http://vid/v1.mp4', width: 100, height: 100 },
      a8: { asset_id: 8, type: 'audio', access_url: 'http://aud/s1.mp3', width: 100, height: 100 },
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
            ? { initialEntries: [{ pathname: '/c', state: { genKind: 'image' } }] }
            : undefined,
          createElement(CanvasPage), createElement(Toaster, { duration: Infinity }),
        ),
      ),
    );
  });
}

function pickReferenceButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === ATTACHMENT_ACTION_PICK_CANVAS_TITLE,
  );
}

function assetsLibraryButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === ATTACHMENT_ACTION_PICK_ASSETS_TITLE,
  );
}

function attachmentStrip(): Element | null {
  return container.querySelector(`.${dialogStyles.previewRow}`);
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

async function clickNode(id: string) {
  const node = flowProps.current.mediaNodes.find((n: Node) => n.id === id)
    ?? flowProps.current.textNodes.find((n: Node) => n.id === id)!;
  await act(async () => {
    flowProps.current.onNodeClick(node);
  });
}

async function openBoundPanel() {
  await act(async () => {
    toolbarProps.current.onToggleImageDialog();
  });
  await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
}

async function openFreePanelFromHome() {
  genHandoffMock.current = { kind: 'image', text: '', modelId: 'm-test', size: '2k', ratio: '1:1', files: [] };
  await renderPage(true);
  await vi.waitFor(() => expect(pickReferenceButton()).toBeTruthy());
}

function refImages(): string[] {
  return [...container.querySelectorAll<HTMLImageElement>(`.${dialogStyles.previewRow} img`)].map(
    (img) => img.alt,
  );
}

function toastText(): string {
  return document.body.textContent ?? '';
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

describe('IKGB7U 图片面板附件操作条', () => {
  it('自由面板（首页带入）：操作条「+ 参考」「资产库」常显，栏尾旧「+」入口不再出现', async () => {
    await openFreePanelFromHome();

    expect(pickReferenceButton()).toBeTruthy();
    expect(assetsLibraryButton()).toBeTruthy();
    expect(
      [...container.querySelectorAll<HTMLButtonElement>('button')].some(
        (b) => b.getAttribute('title') === REF_SOURCE_ENTRY_TITLE,
      ),
    ).toBe(false);
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === '到节点选择')).toBe(false);
  });

  it('工具栏面板（草稿绑定）：操作条两入口常显，旧「+」入口不再出现；展开/关闭并入操作条右侧', async () => {
    await renderPage();
    await openBoundPanel();

    const bar = pickReferenceButton()!.closest(`.${barStyles.actionBar}`)!;
    expect(bar).toBeTruthy();
    expect(bar.querySelector(`button[title="${ATTACHMENT_ACTION_PICK_ASSETS_TITLE}"]`)).toBeTruthy();
    expect(bar.querySelector(`button[title="展开"]`)).toBeTruthy();
    expect(bar.querySelector(`button[title="关闭"]`)).toBeTruthy();
    expect(
      [...container.querySelectorAll<HTMLButtonElement>('button')].some(
        (b) => b.getAttribute('title') === REF_SOURCE_ENTRY_TITLE,
      ),
    ).toBe(false);
  });

  it('空态：无附件时附件栏不渲染；点选首个附件后附件栏出现在操作条与输入框之间', async () => {
    await renderPage();
    await openBoundPanel();
    expect(attachmentStrip()).toBeNull();

    await clickPickReference();
    await clickNode('m1');

    await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));
    const bar = pickReferenceButton()!.closest(`.${barStyles.actionBar}`)!;
    const strip = attachmentStrip()!;
    const editor = container.querySelector('[contenteditable]')!;
    expect(bar.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('点「+ 参考」直接进入画布点选模式且按钮高亮', async () => {
    await openFreePanelFromHome();

    await clickPickReference();

    await vi.waitFor(() => expect(toastText()).toContain('从节点添加素材'), { timeout: 3000 });
    expect(pickReferenceButton()!.classList.contains(barStyles.picking)).toBe(true);
  });

  it('点「资产库」直接打开同一资产库弹窗，按面板类型过滤仅图片（隐藏视频/音频）', async () => {
    await renderPage();
    await openBoundPanel();

    await clickAssetsLibrary();
    expect(assetsPickerProps.current.mediaTypes).toEqual(['image']);
  });

  it('自由面板画布点选：视频节点禁选并提示，零新增；随后图片节点仍可接纳', async () => {
    await openFreePanelFromHome();

    await clickPickReference();
    await clickNode('v1');

    await vi.waitFor(() => expect(toastText()).toContain('图片参考仅支持图片素材'), { timeout: 3000 });
    expect(refImages()).toEqual([]);
    await clickNode('m1');
    await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));
  });

  it('自由面板画布点选：音频节点禁选并提示，零新增', async () => {
    await openFreePanelFromHome();

    await clickPickReference();
    await clickNode('s1');

    await vi.waitFor(() => expect(toastText()).toContain('图片参考仅支持图片素材'), { timeout: 3000 });
    expect(refImages()).toEqual([]);
  });

  it('自由面板画布点选：图片节点注入参考（既有链路回归）', async () => {
    await openFreePanelFromHome();

    await clickPickReference();
    await clickNode('m1');

    await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));
  });

  it('绑定面板画布点选：视频节点禁选并提示，不建参考连线；重新发起后图片节点可接纳', async () => {
    await renderPage();
    await openBoundPanel();

    await clickPickReference();
    await clickNode('v1');

    await vi.waitFor(() => expect(toastText()).toContain('图片参考仅支持图片素材'), { timeout: 3000 });
    expect(refImages()).toEqual([]);
    await clickPickReference();
    await clickNode('m1');
    await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));
  });
});


it('IKFEWF 普通文本从图片入口建立附件且重复选取不重复连线', async () => {
  const doc = canvasDocMock.current.doc as { nodes: Node[] };
  doc.nodes.push({ id: 't1', type: 'textNode', position: { x: 0, y: 500 }, data: { text: '普通文本上下文' } });
  await renderPage();
  await openBoundPanel();
  await clickPickReference();
  await clickNode('t1');
  expect(flowProps.current.edges.filter((e: { source: string }) => e.source === 't1')).toHaveLength(1);
  await clickPickReference();
  await clickNode('t1');
  expect(flowProps.current.edges.filter((e: { source: string }) => e.source === 't1')).toHaveLength(1);
});
