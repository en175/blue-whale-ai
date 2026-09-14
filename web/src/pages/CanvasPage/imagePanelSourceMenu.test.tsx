// @vitest-environment jsdom
/* IKFE8T 图片面板统一附件来源与类型筛选：
   自由面板（首页 AI图片带入，imageSeed 无 targetNodeId）与节点/工具栏面板
   （草稿绑定，imageDraftId 恒定）共用单「+」，菜单仅「从资产中选择 / 从节点添加素材」两项。
   从节点添加素材按图片面板类型边界接纳——图片可入参考，视频/音频画布保留节点但
   禁选并提示，不产生参考或附件；从资产中选择过滤仅图片（列表隐藏视频/音频）。
   FlowCanvas/CanvasToolbar/AssetsPickerModal 打桩透出 props；ImageDialog 用真实实现。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { REF_SOURCE_ENTRY_TITLE } from './components/RefSourceMenu';
import dialogStyles from './components/ImageDialog/index.module.css';

vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

/** FlowCanvas 打桩：透出 props 供测试读取节点与触发画布点击 */
const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/Canvas', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

/** CanvasToolbar 打桩：透出图片入口（工具栏打开绑定草稿的生图面板） */
const toolbarProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/CanvasToolbar', () => ({
  default: (props: Record<string, any>) => {
    toolbarProps.current = props;
    return createElement('div', { 'data-testid': 'canvas-toolbar' });
  },
}));

/** AssetsPickerModal 打桩：透出 mediaTypes 断言「从资产中选择」的类型过滤 */
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

vi.mock('@/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

/** 首页 AI图片 → 画布交接（自由面板唯一入口）：take 即清语义与真实实现一致 */
const genHandoffMock = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock('@/utils/gen-handoff', () => ({
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
  fetchQuota: vi.fn(async () => ({})),
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
  createMediaExtraction: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async () => [
    {
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
      features: { reference_image: true, max_reference_images: 9 },
      version: 1,
      digest: '',
    },
  ]),
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
  linkAssetToProject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/api/canvas', () => ({
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

/* useCanvasDoc 打桩须保持引用稳定；内容经 current 按用例注入 */
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

/** 场景：图片 m1 / 视频 v1 / 音频 s1 三张就绪素材 + 图片草稿 d1，无连线 */
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
          createElement(CanvasPage),
        ),
      ),
    );
  });
}

/** 来源「+」按钮：面板参考区尾部的统一附件入口 */
function sourceEntryButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === REF_SOURCE_ENTRY_TITLE,
  );
}

/** 展开来源菜单：返回菜单项文案列表 */
async function openSourceMenu(): Promise<string[]> {
  const entry = sourceEntryButton()!;
  await act(async () => {
    entry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  return [...container.querySelectorAll('button')]
    .filter((b) => b.textContent === '从资产中选择' || b.textContent === '从节点添加素材')
    .map((b) => b.textContent!);
}

/** 菜单项点击（先展开再点指定文案） */
async function clickMenuItem(label: '从资产中选择' | '从节点添加素材') {
  const entry = sourceEntryButton()!;
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

/** 画布点击指定节点 */
async function clickNode(id: string) {
  const node = flowProps.current.mediaNodes.find((n: Node) => n.id === id)
    ?? flowProps.current.textNodes.find((n: Node) => n.id === id)!;
  await act(async () => {
    flowProps.current.onNodeClick(node);
  });
}

/** 工具栏打开生图面板（绑定新建草稿卡，即节点/工具栏面板形态） */
async function openBoundPanel() {
  await act(async () => {
    toolbarProps.current.onToggleImageDialog();
  });
  await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
}

/** 首页 AI图片带入打开自由面板（imageSeed 无 targetNodeId） */
async function openFreePanelFromHome() {
  genHandoffMock.current = { kind: 'image', text: '', modelId: 'm-test', size: '2k', ratio: '1:1', files: [] };
  await renderPage(true);
  await vi.waitFor(() => expect(sourceEntryButton()).toBeTruthy());
}

/** 面板参考区预览图 alt 列表（自由模式渲染面板本地 files；绑定模式渲染连线 mediaRefs） */
function refImages(): string[] {
  return [...container.querySelectorAll<HTMLImageElement>(`.${dialogStyles.previewRow} img`)].map(
    (img) => img.alt,
  );
}

function toastText(): string {
  return container.textContent ?? '';
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

describe('IKFE8T 图片面板统一附件来源入口', () => {
  it('自由面板（首页带入）：单「+」入口，菜单仅含两项统一来源', async () => {
    await openFreePanelFromHome();

    const entries = [...container.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => b.getAttribute('title') === REF_SOURCE_ENTRY_TITLE,
    );
    expect(entries).toHaveLength(1);
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === '到节点选择')).toBe(false);

    const items = await openSourceMenu();
    expect(items.sort()).toEqual(['从节点添加素材', '从资产中选择']);
  });

  it('工具栏面板（草稿绑定）：单「+」入口，菜单仅含两项统一来源', async () => {
    await renderPage();
    await openBoundPanel();

    const entries = [...container.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => b.getAttribute('title') === REF_SOURCE_ENTRY_TITLE,
    );
    expect(entries).toHaveLength(1);

    const items = await openSourceMenu();
    expect(items.sort()).toEqual(['从节点添加素材', '从资产中选择']);
  });

  it('从资产中选择：资产列表按面板类型过滤，仅图片（隐藏视频/音频）', async () => {
    await renderPage();
    await openBoundPanel();

    await clickMenuItem('从资产中选择');
    expect(assetsPickerProps.current.mediaTypes).toEqual(['image']);
  });

  it('自由面板从节点添加素材：视频节点禁选并提示，零新增；随后图片节点仍可接纳', async () => {
    await openFreePanelFromHome();

    await clickMenuItem('从节点添加素材');
    await clickNode('v1');

    expect(toastText()).toContain('图片参考仅支持图片素材');
    expect(refImages()).toEqual([]);
    // 选取模式保持：紧接点图片节点仍完成注入
    await clickNode('m1');
    await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));
  });

  it('自由面板从节点添加素材：音频节点禁选并提示，零新增', async () => {
    await openFreePanelFromHome();

    await clickMenuItem('从节点添加素材');
    await clickNode('s1');

    expect(toastText()).toContain('图片参考仅支持图片素材');
    expect(refImages()).toEqual([]);
  });

  it('自由面板从节点添加素材：图片节点注入参考（既有链路回归）', async () => {
    await openFreePanelFromHome();

    await clickMenuItem('从节点添加素材');
    await clickNode('m1');

    await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));
  });

  it('绑定面板从节点添加素材：视频节点禁选并提示，不建参考连线；重新发起后图片节点可接纳', async () => {
    await renderPage();
    await openBoundPanel();

    await clickMenuItem('从节点添加素材');
    await clickNode('v1');

    expect(toastText()).toContain('图片参考仅支持图片素材');
    expect(refImages()).toEqual([]);
    // 既有规则：绑定面板禁选提示后退出选取模式；用户重新从菜单发起再选图片即可
    await clickMenuItem('从节点添加素材');
    await clickNode('m1');
    await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));
  });
});


it('IKFEWF 普通文本从图片入口建立附件且重复选取不重复连线', async () => {
  const doc = canvasDocMock.current.doc as { nodes: Node[] };
  doc.nodes.push({ id: 't1', type: 'textNode', position: { x: 0, y: 500 }, data: { text: '普通文本上下文' } });
  await renderPage();
  await openBoundPanel();
  await clickMenuItem('从节点添加素材');
  await clickNode('t1');
  expect(flowProps.current.edges.filter((e: { source: string }) => e.source === 't1')).toHaveLength(1);
  await clickMenuItem('从节点添加素材');
  await clickNode('t1');
  expect(flowProps.current.edges.filter((e: { source: string }) => e.source === 't1')).toHaveLength(1);
});
