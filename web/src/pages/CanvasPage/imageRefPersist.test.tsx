// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { REF_SOURCE_ENTRY_TITLE } from './components/RefSourceMenu';
import { readPromptRefText, typePromptRefRaw, typePromptRefText } from './testing/promptRefEditor';
import type { GenerationModel, ModelFeatures } from '@/api/generation';

vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

/** FlowCanvas 打桩：透出 props 供测试读取节点/连线与触发画布回调 */
const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/Canvas', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

/** CanvasToolbar 打桩：透出侧栏图片入口 */
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

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchMe: vi.fn(async () => null),
  fetchQuota: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  applyPromptPreview: vi.fn(),
  saveCanvasDoc: vi.fn(async (
    _projectId: string,
    _payload: { viewport: unknown; nodes: Node[]; edges: Array<{ id: string; source: string; target: string }> },
    _version: number | null,
  ) => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
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
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => [
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
      features: {
        reference_image: true, max_reference_images: 9, watermark: false, quantity_max: 1,
        sequential_image_generation: false, stream: false, tools: false,
        first_frame: false, last_frame: false, first_last_frame: false, audio: false,
      },
      is_default: true,
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
  linkAssetToProject: vi.fn(),
}));

/* 序列化保持与真实实现同构（JSON 可序列化字段参与签名），否则签名断言失真 */
vi.mock('@/api/canvas', () => ({
  applyPromptPreview: apiMocks.applyPromptPreview,
  // IKDLQK 起 CanvasPage 还引入这两个调用：mock 补齐，否则组件挂载即抛错（IKDLQK 合入时的既有欠账）
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

/** 默认画布：文本节点 t1 + 就绪图片 m1（assetId a1）+ 视频节点 v1 + 图片草稿 d1 */
function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { title: '故事文案', text: '一只蓝鲸在海里' } },
        { id: 'm1', type: 'mediaNode', position: { x: 200, y: 0 }, data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '素材图一', assetId: 'a1' } },
        { id: 'v1', type: 'mediaNode', position: { x: 400, y: 0 }, data: { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '素材视频', assetId: 'a9' } },
        { id: 'd1', type: 'mediaNode', position: { x: 420, y: 160 }, data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '' } },
      ],
      edges: [],
    },
    assets: {
      a1: { asset_id: 1, type: 'image', access_url: 'http://img/m1.png', width: 100, height: 100 },
      a9: { asset_id: 9, type: 'video', access_url: 'http://vid/v1.mp4', width: 100, height: 100 },
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

function sendButton(): HTMLButtonElement {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === '发送',
  )!;
}

/** PromptRefEditor（IKFA1M）整体替换文本 */
async function typePrompt(text: string) {
  await typePromptRefText(container, text);
}

/** 点击画布草稿卡 d1 打开绑定面板（草稿绑定路径），返回草稿节点 id */
async function createDraft(): Promise<string> {
  const draft = flowProps.current.mediaNodes.find((n: Node) => n.id === 'd1')!;
  await act(async () => {
    flowProps.current.onNodeClick(draft);
  });
  return 'd1';
}

const edgePairs = () =>
  flowProps.current.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`);

/** Dock 参考图预览项的图片 alt 列表（草稿绑定面板按连线推导渲染） */
function dockRefImages(): string[] {
  return [...container.querySelectorAll<HTMLImageElement>('[data-testid="dock-media-ref"] img')].map(
    (img) => img.alt,
  );
}

/** Dock 媒体入口已改为来源菜单（画布资产改造融合）：先点入口按钮弹菜单，再点「从节点添加素材」项进入选取模式 */
const enterPickMode = async () => {
  const entry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === REF_SOURCE_ENTRY_TITLE,
  )!;
  await act(async () => {
    entry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  const item = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === '从节点添加素材',
  )!;
  await act(async () => {
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

/** 追加一个就绪图片素材节点（含资产快照） */
function pushImageNode(id: string, assetId: string, name: string) {
  (canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> }).nodes.push({
    id, type: 'mediaNode', position: { x: 240, y: 0 },
    data: { src: `http://img/${id}.png`, mediaType: 'image', fileName: name, assetId },
  });
  (canvasDocMock.current.assets as Record<string, unknown>)[assetId] = {
    asset_id: assetId, type: 'image', access_url: `http://img/${id}.png`,
  };
}

/** 追加一个图片草稿节点 */
function pushDraftNode(id: string) {
  (canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> }).nodes.push({
    id, type: 'mediaNode', position: { x: 440, y: 160 },
    data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '' },
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

/* IKFDFT 图片节点参考即时保存与编辑恢复：选中即连线并随既有自动保存落盘（不再等发送）；
   关闭/切换/重开经连线推导恢复；保存失败保留选择与阻断；模型不兼容保留并说明原因。
   FlowCanvas/CanvasToolbar/CanvasHeader 打桩透出 props；ImageDialog 用真实实现。 */
describe('IKFDFT 图片参考即时保存与编辑恢复', () => {
  /** 关闭当前绑定面板（右上角 ×） */
  async function closePanel() {
    const btn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('title') === '关闭',
    )!;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  /** 点击画布媒体节点（打开/切换绑定面板） */
  async function clickNode(id: string) {
    const node = flowProps.current.mediaNodes.find((n: Node) => n.id === id)!;
    await act(async () => {
      flowProps.current.onNodeClick(node);
    });
  }

  /** 从节点添加素材：进入持续选取会话（IKFR4X：会话绑定进入时的目标，一次进入可连续选择） */
  async function pickFromCanvas(sourceId: string) {
    await enterPickMode();
    await clickNode(sourceId);
  }

  /** 结束持续选取会话：点击提示条「完成选取」按钮 */
  async function finishPick() {
    const btn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === '完成选取',
    )!;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  function panelVisible(): boolean {
    return container.querySelector('[contenteditable="true"]') !== null;
  }

  /** 配置面板切换模型：底栏摘要按钮（模型名+比例+分辨率）展开配置面板（已展开则不重复点，
   *  避免 toggle 收起）→ 模型选择器（精确当前名）→ 目标选项；选项点击只收下拉不收配置面板 */
  async function switchModel(currentLabel: string, targetLabel: string) {
    let selectBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === currentLabel,
    );
    if (!selectBtn) {
      const configBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => (b.textContent ?? '').includes(currentLabel) && (b.textContent ?? '').includes(':'),
      )!;
      await act(async () => { configBtn.click(); });
      selectBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === currentLabel,
      )!;
    }
    await act(async () => { selectBtn.click(); });
    const option = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === targetLabel,
    )!;
    await act(async () => { option.click(); });
    // 收起配置面板（选项点击只收下拉不收面板；避免面板的关闭按钮与对话框关闭按钮重名歧义）
    const toggle = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => (b.textContent ?? '').includes(targetLabel) && (b.textContent ?? '').includes(':'),
    )!;
    await act(async () => { toggle.click(); });
  }

  /** 无参考/限量/高清模型（能力项与 m-test 同形，features 按需覆盖默认值） */
  function modelVariant(
    modelId: string,
    label: string,
    features: Partial<ModelFeatures>,
    sizes: Array<{ id: string; label: string }> = [{ id: '2k', label: '2K' }],
  ): GenerationModel {
    return {
      model_id: modelId,
      provider_id: 'prov',
      model_label: label,
      icon: null,
      supported_sizes: sizes,
      default_size: sizes[0]?.id,
      supported_aspect_ratios: ['1:1'],
      supported_formats: [],
      supported_durations: null,
      default_format: null,
      default_aspect_ratio: '1:1',
      default_duration: null,
      features: {
        reference_image: false, max_reference_images: 9, watermark: false, quantity_max: 1,
        sequential_image_generation: false, stream: false, tools: false,
        first_frame: false, last_frame: false, first_last_frame: false, audio: false,
        ...features,
      },
      is_default: false,
      version: 1,
      digest: '',
    };
  }

  it('连续选取多项参考：立即逐条建立连线，身份、数量、顺序随自动保存完整上送', async () => {
    pushImageNode('m2', 'a2', '素材图二');
    pushImageNode('m3', 'a3', '素材图三');
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    // IKFR4X：一次进入持续会话，连续点击三个来源均即时建线，模式不退出
    await enterPickMode();
    await clickNode('m1');
    expect(edgePairs()).toEqual([`m1->${draftId}`]);
    await clickNode('m2');
    expect(edgePairs()).toEqual([`m1->${draftId}`, `m2->${draftId}`]);
    await clickNode('m3');
    expect(edgePairs()).toEqual([`m1->${draftId}`, `m2->${draftId}`, `m3->${draftId}`]);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一', '素材图二', '素材图三']));

    // 自动保存载荷：三条连线按边序完整上送（未发送生成）
    await vi.waitFor(() => {
      const saved = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
      expect(saved.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`))
        .toEqual([`m1->${draftId}`, `m2->${draftId}`, `m3->${draftId}`]);
    }, { timeout: 3000 });
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });

  it('关闭按钮结束面板后重开：参考、提示词与配置完整恢复', async () => {
    apiMocks.fetchGenerationModels.mockImplementation(async () => [
      modelVariant('m-test', '测试生图模型', { reference_image: true, max_reference_images: 9 }),
      modelVariant('m-hd', '高清模型', { reference_image: true, max_reference_images: 9 }, [{ id: '4k', label: '4K' }]),
    ]);
    pushImageNode('m2', 'a2', '素材图二');
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    // 会话中连续选取两张（IKFR4X：一次进入持续选择），再切换模型验证配置写回
    await enterPickMode();
    await clickNode('m1');
    await clickNode('m2');
    await finishPick();
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一', '素材图二']));
    await typePrompt('保留我的编辑');
    // 切换非默认模型（其默认分辨率档位 4k）：配置随草稿节点写回
    await switchModel('测试生图模型', '高清模型');
    await vi.waitFor(() => expect(container.textContent).toContain('高清模型'));

    // 关闭按钮：面板消失，画布连线保留
    await closePanel();
    expect(panelVisible()).toBe(false);
    expect(edgePairs()).toEqual([`m1->${draftId}`, `m2->${draftId}`]);

    // 重新点击草稿卡：参考、提示词与生成配置（模型/分辨率/比例）恢复
    await clickNode(draftId);
    await vi.waitFor(() => expect(panelVisible()).toBe(true));
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一', '素材图二']));
    expect(readPromptRefText(container)).toBe('保留我的编辑');
    await vi.waitFor(() => expect(container.textContent).toContain('高清模型'));
    expect(container.textContent).toContain('4K');
  });

  it('点击空白隐藏面板后重开：参考与提示词保留，选取模式不恢复', async () => {
    pushImageNode('m2', 'a2', '素材图二');
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    await clickNode('m2');
    await finishPick();
    await typePrompt('空白隐藏保留');
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一', '素材图二']));

    // 普通模式点击画布空白：面板隐藏，连线与写回内容保留
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(panelVisible()).toBe(false);
    expect(edgePairs()).toEqual([`m1->${draftId}`, `m2->${draftId}`]);

    // 重开草稿卡：恢复；不恢复选取模式（无持续会话提示与完成按钮）
    await clickNode(draftId);
    await vi.waitFor(() => expect(panelVisible()).toBe(true));
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一', '素材图二']));
    expect(readPromptRefText(container)).toBe('空白隐藏保留');
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === '完成选取')).toBe(false);
  });

  it('A→B→A 切换编辑目标：A 的参考与提示词完整恢复，B 不串入', async () => {
    pushImageNode('m2', 'a2', '素材图二');
    pushDraftNode('d2');
    await renderPage();
    const aId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    // 会话中连续选取两张后先结束（IKFR4X：切换编辑目标须先完成选取）
    await enterPickMode();
    await clickNode('m1');
    await clickNode('m2');
    await finishPick();
    await typePrompt('A 的提示词');
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一', '素材图二']));

    // 切到 B：B 不出现 A 的参考与提示词
    await clickNode('d2');
    await vi.waitFor(() => expect(dockRefImages()).toEqual([]));
    expect(readPromptRefText(container)).toBe('');
    await typePrompt('B 的提示词');

    // 切回 A：A 的参考与提示词完整恢复，B 的编辑不串入
    await clickNode(aId);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一', '素材图二']));
    expect(readPromptRefText(container)).toBe('A 的提示词');
  });

  it('保存失败：选择保留并显示未保存，阻止切换其他目标与发送，重试成功恢复', async () => {
    pushDraftNode('d2');
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await typePrompt('保存前编辑');

    // 保存持续失败：选取仍立即建线并保留在页面；会话不受保存失败影响（IKFR4X AC5：保留本地参考和模式）
    apiMocks.saveCanvasDoc.mockImplementation(() => Promise.reject(new Error('boom')));
    await enterPickMode();
    await clickNode('m1');
    await vi.waitFor(() => expect(container.textContent).toContain('保存失败，请重试'), { timeout: 3000 });
    expect(flowProps.current.refPickActive).toBe(true);
    await finishPick();
    expect(edgePairs()).toEqual([`m1->${draftId}`]);

    // 自动保存失败：显示未保存；连线与 Dock 参考保留
    await vi.waitFor(() => expect(container.textContent).toContain('保存失败，请重试'), { timeout: 3000 });
    expect(edgePairs()).toEqual([`m1->${draftId}`]);
    expect(dockRefImages()).toEqual(['素材图一']);

    // 阻止切换其他编辑目标；阻止发送（提示词非空，仅因未保存被禁）
    await clickNode('d2');
    expect(dockRefImages()).toEqual(['素材图一']);
    expect(readPromptRefText(container)).toBe('保存前编辑');
    expect(sendButton().disabled).toBe(true);

    // 允许关闭并重开原目标：编辑仍在
    await closePanel();
    expect(panelVisible()).toBe(false);
    await clickNode(draftId);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));

    // 重试成功：落盘载荷含参考连线，恢复可切换可发送
    apiMocks.saveCanvasDoc.mockImplementation(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' }));
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === '重试保存')!;
    await act(async () => { retry.click(); });
    await vi.waitFor(() => expect(container.textContent).toContain('已保存'));
    const saved = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
    expect(saved.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`)).toEqual([`m1->${draftId}`]);
    expect(sendButton().disabled).toBe(false);
    await clickNode('d2');
    await vi.waitFor(() => expect(dockRefImages()).toEqual([]));
  });

  it('切换不支持参考的模型：保留全部参考、说明原因并阻止发送，换回兼容模型恢复', async () => {
    apiMocks.fetchGenerationModels.mockImplementation(async () => [
      modelVariant('m-test', '测试生图模型', { reference_image: true, max_reference_images: 9 }),
      modelVariant('m-noref', '无参考模型', {}),
    ]);
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    // 会话中选取后结束，再验证模型兼容切换（IKFR4X：会话中模型入口禁用）
    await enterPickMode();
    await clickNode('m1');
    await finishPick();
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));
    await typePrompt('参考绘制');
    expect(sendButton().disabled).toBe(false);

    // 切换不支持参考的模型：参考保留不删除，原因明确，发送被阻止
    await switchModel('测试生图模型', '无参考模型');
    await vi.waitFor(() => expect(container.textContent).toContain('当前模型不支持图片参考，请调整模型或参考'));
    expect(sendButton().disabled).toBe(true);
    expect(dockRefImages()).toEqual(['素材图一']);
    expect(edgePairs()).toEqual([`m1->${draftId}`]);

    // 换回兼容模型：恢复可发送
    await switchModel('无参考模型', '测试生图模型');
    await vi.waitFor(() => expect(container.textContent).not.toContain('当前模型不支持图片参考'));
    expect(sendButton().disabled).toBe(false);
  });

  it('切换参考数量上限不足的模型：保留全部参考并说明原因，用户删除超限项后恢复发送', async () => {
    apiMocks.fetchGenerationModels.mockImplementation(async () => [
      modelVariant('m-test', '测试生图模型', { reference_image: true, max_reference_images: 9 }),
      modelVariant('m-cap1', '单参考模型', { reference_image: true, max_reference_images: 1 }),
    ]);
    pushImageNode('m2', 'a2', '素材图二');
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    // 会话中连续选取两张后结束，再切换上限不足模型（IKFR4X：会话中模型入口禁用）
    await enterPickMode();
    await clickNode('m1');
    await clickNode('m2');
    await finishPick();
    expect(edgePairs()).toEqual([`m1->${draftId}`, `m2->${draftId}`]);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一', '素材图二']));
    await typePrompt('两张参考');
    expect(sendButton().disabled).toBe(false);

    // 上限不足：参考保留不截断，说明原因并阻止发送
    await switchModel('测试生图模型', '单参考模型');
    await vi.waitFor(() => expect(container.textContent).toContain('参考图片数量超过模型支持上限，请调整参考'));
    expect(sendButton().disabled).toBe(true);
    expect(dockRefImages()).toEqual(['素材图一', '素材图二']);

    // 用户主动删除超限项：恢复发送
    const removeBtn = container.querySelector<HTMLButtonElement>('[data-testid="dock-media-ref"] button[title="移除"]')!;
    await act(async () => {
      removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图二']));
    await vi.waitFor(() => expect(container.textContent).not.toContain('参考图片数量超过模型支持上限'));
    expect(sendButton().disabled).toBe(false);
  });

  it('面板移除引用后关闭重开不复活', async () => {
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await pickFromCanvas('m1');
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));

    // Dock 移除引用：断开连线
    const removeBtn = container.querySelector<HTMLButtonElement>('[data-testid="dock-media-ref"] button[title="移除"]')!;
    await act(async () => {
      removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(dockRefImages()).toEqual([]));
    expect(edgePairs()).toEqual([]);

    // 关闭重开：引用不复活
    await closePanel();
    await clickNode(draftId);
    await vi.waitFor(() => expect(panelVisible()).toBe(true));
    expect(dockRefImages()).toEqual([]);
  });

  it('@ 菜单选择画布图片：立即建立连线并在正文插入素材标签', async () => {
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    // IKFA1J 起 @ 检索直接弹出 AtMentionMenu（原「引用画布素材」二级入口已随素材菜单改版移除）
    await typePromptRefRaw(container, '参考@素');
    // AtMentionMenu 经 portal 挂在 body；带检索词时直接列匹配项（无检索词则按类型分组悬停展开）
    await vi.waitFor(() => expect(document.body.querySelector('[data-testid="mention-menu"] button')).toBeTruthy());
    const item = [...document.body.querySelectorAll<HTMLButtonElement>('[data-testid="mention-menu"] button')].find(
      (b) => b.textContent?.includes('素材图一'),
    )!;
    await act(async () => { item.click(); });

    // 立即建立连线（不等待发送）；Dock 显示同一参考；正文落「图片1」标签
    expect(edgePairs()).toEqual([`m1->${draftId}`]);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('参考图片1'));
  });
});

/* IKFR4X 图片参考持续选取与完整退出闭环：一次进入连续选择、拒绝保持模式、
   操作隔离、完成/Esc/关闭退出与目标失效结束。FlowCanvas 打桩透出 props，
   会话与勾选断言走 pickInteractionLock / pickMarks 透出值。 */
describe('IKFR4X 图片参考持续选取与完整退出闭环', () => {
  async function clickNode(id: string) {
    const node = flowProps.current.mediaNodes.find((n: Node) => n.id === id)!;
    await act(async () => {
      flowProps.current.onNodeClick(node);
    });
  }

  function pickLock(): boolean {
    return flowProps.current.refPickActive === true;
  }

  function pickMarks(): string[] {
    return (flowProps.current.refPickMarkedIds ?? []) as string[];
  }

  /** 图片面板（Dock）在本页是否可见：会话中编辑器只读（contenteditable=false），以发送按钮为准 */
  function panelOpen(): boolean {
    return [...container.querySelectorAll<HTMLButtonElement>('button')].some(
      (b) => b.getAttribute('title') === '发送',
    );
  }

  async function pressEscape() {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
  }

  /** 结束持续选取会话：点击提示条「完成选取」按钮 */
  async function finishPick() {
    await act(async () => {
      finishButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  /** 完成选取按钮是否存在（会话提示条专属，普通模式无） */
  function finishButton(): HTMLButtonElement | undefined {
    return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === '完成选取',
    );
  }

  it('一次进入连续选取三张：三次即时建线，Dock 持续可见，勾选随连线同步', async () => {
    pushImageNode('m2', 'a2', '素材图二');
    pushImageNode('m3', 'a3', '素材图三');
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    expect(pickLock()).toBe(true);
    for (const id of ['m1', 'm2', 'm3']) {
      await clickNode(id);
      expect(panelOpen()).toBe(true);
      expect(finishButton()).toBeTruthy();
    }
    expect(edgePairs()).toEqual([`m1->${draftId}`, `m2->${draftId}`, `m3->${draftId}`]);
    expect([...pickMarks()].sort()).toEqual(['m1', 'm2', 'm3']);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一', '素材图二', '素材图三']));

    await vi.waitFor(() => {
      const saved = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
      expect(saved.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`))
        .toEqual([`m1->${draftId}`, `m2->${draftId}`, `m3->${draftId}`]);
    }, { timeout: 3000 });
  });

  it('重复点击已选节点：不新增、不移除，提示已连入且模式持续', async () => {
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    await clickNode('m1');
    expect(edgePairs()).toEqual([`m1->${draftId}`]);
    expect(pickMarks()).toEqual(['m1']);
    expect(container.textContent).toContain('该素材已连入当前草稿');
    expect(pickLock()).toBe(true);
  });

  it('非法来源明确提示原因：不写入、不退出、不关闭 Dock，改选合法来源可继续', async () => {
    await renderPage();
    await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    // 视频节点：图片面板类型边界（IKFE8T 同口径文案）
    await clickNode('v1');
    expect(edgePairs()).toEqual([]);
    expect(pickLock()).toBe(true);
    expect(panelOpen()).toBe(true);
    expect(container.textContent).toContain('图片参考仅支持图片素材');

    // 改选合法来源仍然生效，模式继续
    await clickNode('m1');
    expect(edgePairs()).toEqual(['m1->d1']);
    expect(pickMarks()).toEqual(['m1']);
  });

  it('Dock 移除：勾选同步消失，同模式可立即再次选择', async () => {
    await renderPage();
    await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    expect(pickMarks()).toEqual(['m1']);

    // 会话中 Dock 移除仍可用：断开当前目标对应连线，勾选同步
    const removeBtn = container.querySelector<HTMLButtonElement>('[data-testid="dock-media-ref"] button[title="移除"]')!;
    expect(removeBtn.disabled).toBe(false);
    await act(async () => {
      removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(dockRefImages()).toEqual([]));
    expect(edgePairs()).toEqual([]);
    expect(pickMarks()).toEqual([]);
    expect(pickLock()).toBe(true);

    // 同一模式内立即再次选择
    await clickNode('m1');
    expect(edgePairs()).toEqual(['m1->d1']);
    expect(pickMarks()).toEqual(['m1']);
  });

  it('模式内空白点击不退出：面板与模式保持，继续选取有效', async () => {
    pushImageNode('m2', 'a2', '素材图二');
    await renderPage();
    await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(pickLock()).toBe(true);
    expect(panelOpen()).toBe(true);
    expect(edgePairs()).toEqual(['m1->d1']);

    // 空白点击后继续选取仍有效
    await clickNode('m2');
    expect(edgePairs()).toEqual(['m1->d1', 'm2->d1']);
  });

  it('完成按钮退出：保留参考与原目标 Dock，恢复普通编辑与普通切换', async () => {
    pushDraftNode('d2');
    await renderPage();
    await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    // 会话内普通选中变化不关闭/切换原目标 Dock（选取进行中 selection 被隔离）
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [flowProps.current.mediaNodes.find((n: Node) => n.id === 'm1')!], edges: [] });
    });
    expect(panelOpen()).toBe(true);
    await finishPick();
    expect(pickLock()).toBe(false);
    expect(finishButton()).toBeUndefined();
    // 原目标 Dock 保持、参考保留
    expect(panelOpen()).toBe(true);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));
    expect(edgePairs()).toEqual(['m1->d1']);
    // 未触发生成
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();

    // 恢复普通编辑：点击其他草稿卡可正常切换面板
    await clickNode('d2');
    await vi.waitFor(() => expect(dockRefImages()).toEqual([]));
  });

  it('Esc 退出：保留参考与面板，画布交互锁解除', async () => {
    await renderPage();
    await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    await pressEscape();
    expect(pickLock()).toBe(false);
    expect(panelOpen()).toBe(true);
    expect(edgePairs()).toEqual(['m1->d1']);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));
  });

  it('关闭 Dock 直接退出且保留参考：重开为普通模式', async () => {
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    const closeBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('title') === '关闭',
    )!;
    await act(async () => {
      closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(panelOpen()).toBe(false);
    expect(pickLock()).toBe(false);
    expect(edgePairs()).toEqual([`m1->${draftId}`]);

    // 重开：参考恢复，普通模式（无会话提示与完成按钮）
    await clickNode(draftId);
    await vi.waitFor(() => expect(panelOpen()).toBe(true));
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));
    expect(finishButton()).toBeUndefined();
  });

  it('活动目标被删除：结束模式并关闭 Dock，后续点击不写入已删目标', async () => {
    await renderPage();
    await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    expect(pickLock()).toBe(true);

    // 删除活动目标：模式与 Dock 一并结束（旧会话不得写向其他目标）
    await act(async () => {
      flowProps.current.onDeleteNode('d1');
    });
    await vi.waitFor(() => expect(panelOpen()).toBe(false));
    expect(pickLock()).toBe(false);
    expect(finishButton()).toBeUndefined();

    // 后续点击来源节点走普通分支，不产生指向已删目标的连线
    await clickNode('m1');
    expect(edgePairs().some((p: string) => p.endsWith('->d1'))).toBe(false);
  });

  it('会话中操作隔离：提示词只读、模型入口与发送禁用，Dock 移除可用', async () => {
    await renderPage();
    await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await typePrompt('会话前输入');

    await enterPickMode();
    // 会话中先选取一张：Dock 出现参考项后验证移除入口仍可用
    await clickNode('m1');
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));
    // 提示词编辑被隔离（Lexical readOnly → contenteditable=false）
    const editor = container.querySelector('[contenteditable]')!;
    expect(editor.getAttribute('contenteditable')).toBe('false');
    // 模型入口与发送被隔离（底栏摘要按钮含模型名+比例+分辨率，用 includes 定位）
    const configBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => (b.textContent ?? '').includes('测试生图模型') && (b.textContent ?? '').includes(':'),
    )!;
    expect(configBtn.disabled).toBe(true);
    expect(sendButton().disabled).toBe(true);
    // Dock 移除与退出仍可用
    expect(finishButton()!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="dock-media-ref"] button[title="移除"]')).toBeTruthy();

    // 退出后恢复编辑
    await finishPick();
    const restored = container.querySelector('[contenteditable]')!;
    expect(restored.getAttribute('contenteditable')).toBe('true');
    expect(sendButton().disabled).toBe(false);
  });

  it('会话中切换编辑目标被隔离：点击其他草稿卡不切换面板', async () => {
    pushDraftNode('d2');
    await renderPage();
    await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    // 点击另一草稿卡：仍为原目标选参考（草稿卡不是合法图片来源，提示后保持）
    await clickNode('d2');
    expect(pickLock()).toBe(true);
    expect(edgePairs()).toEqual(['m1->d1']);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));
    expect(readPromptRefText(container)).toBe('');
  });
});
