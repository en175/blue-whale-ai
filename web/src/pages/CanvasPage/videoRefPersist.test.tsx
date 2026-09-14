// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
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

vi.mock('./components/CanvasToolbar', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
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
    _payload: { viewport: unknown; nodes: Node[]; edges: Array<{ id: string; source: string; target: string; data?: { refRole?: string } }> },
    _version: number | null,
  ) => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  createGenerationJob: vi.fn(async (_projectId: string, _payload: Record<string, any>) => ({ generation_job_id: 'j1', cursor: 1 })),
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

/* 序列化保持与真实实现同构（JSON 可序列化字段参与签名），否则签名断言失真；
 * serializeEdges 保留 data —— 视频参考角色（refRole）随连线 data 持久化是本票断言对象 */
vi.mock('@/api/canvas', () => ({
  applyPromptPreview: apiMocks.applyPromptPreview,
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => Promise.resolve({ items: [] }), retry: false }),
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

/** 视频模型（能力项按需覆盖）：seedance-2 系全能力 */
function videoModel(
  modelId: string,
  label: string,
  features: Partial<ModelFeatures> = {},
): GenerationModel {
  return {
    model_id: modelId,
    provider_id: 'prov',
    model_label: label,
    icon: null,
    supported_sizes: [{ id: '720p', label: '720p', api_value: '720p' }, { id: '1080p', label: '1080p', api_value: '1080p' }],
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
      // ADR-0086：seedance-2 系视频参考能力位——测试模型默认支持视频/音频参考，可被用例覆盖
      video_reference: modelId === 'seedance-2',
      video_reference_max: 3,
      audio_reference: modelId === 'seedance-2',
      audio_reference_max: 3,
      image_reference_max: 1,
      max_reference_duration_sec: 15,
      ...features,
    },
    is_default: modelId === 'seedance-2',
    version: 1,
    digest: '',
  };
}

const apiGenerationMocks = vi.hoisted(() => ({
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
}));

vi.mock('@/api/generation', () => ({
  fetchGenerationModels: apiGenerationMocks.fetchGenerationModels,
}));

/** 默认画布：图片成品 m1/m2 + 视频成品 v1 + 视频草稿 d1（draftMode 可选注入） */
function seedDoc(draftMode?: string) {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 'm1', type: 'mediaNode', position: { x: 0, y: 0 }, data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '首图', assetId: 'a1' } },
        { id: 'm2', type: 'mediaNode', position: { x: 400, y: 0 }, data: { src: 'http://img/m2.png', mediaType: 'image', fileName: '次图', assetId: 'a2' } },
        { id: 'v1', type: 'mediaNode', position: { x: 800, y: 0 }, data: { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '参考视频', assetId: 'a3' } },
        {
          id: 'd1', type: 'mediaNode', position: { x: 200, y: 300 },
          data: {
            src: '', mediaType: 'video', fileName: '视频草稿', genStatus: 'draft', draft: true, prompt: '',
            draftModelId: 'seedance-2',
            draftSize: '720p', draftRatio: '16:9', draftDuration: 5,
            ...(draftMode ? { draftMode } : {}),
          },
        },
      ],
      edges: [],
    },
    assets: {
      a1: { asset_id: 1, type: 'image', access_url: 'http://img/m1.png', width: 100, height: 100 },
      a2: { asset_id: 2, type: 'image', access_url: 'http://img/m2.png', width: 100, height: 100 },
      a3: { asset_id: 3, type: 'video', access_url: 'http://vid/v1.mp4', width: 100, height: 100 },
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
  return container.querySelector<HTMLButtonElement>('[data-testid="video-send"]')!;
}

/** PromptRefEditor（IKFA1O）整体替换文本 */
async function typePrompt(text: string) {
  await typePromptRefText(container, text);
}

/** 点击画布媒体节点（打开/切换绑定面板） */
async function clickNode(id: string) {
  const node = flowProps.current.mediaNodes.find((n: Node) => n.id === id);
  await act(async () => {
    flowProps.current.onNodeClick(node);
  });
}

const edgePairs = () =>
  flowProps.current.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`);

/** 连线角色（首帧/尾帧随 edge.data.refRole 持久化；普通参考无 data） */
const edgeRoles = () =>
  flowProps.current.edges.map((e: { data?: { refRole?: string } }) => e.data?.refRole ?? 'reference');

/** Dock 视频参考项名称列表（RefThumbnail 根元素 title=素材名） */
function dockRefNames(): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-testid="dock-video-ref"]')].map(
    (el) => el.title,
  );
}

/** Dock 首尾帧徽标列表（首帧/尾帧槽的角色徽标文本） */
function frameBadges(): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-testid="ref-thumb-badge"]')].map((el) => el.textContent ?? '');
}

/** 经 Dock 槽位入口选取来源节点建立指定角色的连线（真实路径：槽位 + 按钮弹来源菜单 →「从节点添加素材」→ 画布节点点击） */
async function pickRefNode(slotTitle: string, nodeId: string) {
  await vi.waitFor(() => {
    const btn = [...container.querySelectorAll('button')].find((b) => b.title === slotTitle);
    expect(btn).toBeTruthy();
  });
  await act(async () => {
    [...container.querySelectorAll('button')].find((b) => b.title === slotTitle)!.click();
  });
  await vi.waitFor(() => {
    const item = [...container.querySelectorAll('button')].find((b) => b.textContent === '从节点添加素材');
    expect(item).toBeTruthy();
  });
  await act(async () => {
    [...container.querySelectorAll('button')].find((b) => b.textContent === '从节点添加素材')!.click();
  });
  await clickNode(nodeId);
}

/** 等待视频模型能力加载完成（发送前置条件） */
async function waitModelReady() {
  await vi.waitFor(() => expect(container.textContent).toContain('测试视频模型'), { timeout: 3000 });
}

function panelVisible(): boolean {
  return container.querySelector('[contenteditable="true"]') !== null;
}

/** 追加一个视频草稿节点（draftMode 可选注入） */
function pushDraftNode(id: string, draftMode?: string) {
  (canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> }).nodes.push({
    id, type: 'mediaNode', position: { x: 440, y: 300 },
    data: {
      src: '', mediaType: 'video', fileName: '视频草稿二', genStatus: 'draft', draft: true, prompt: '',
      draftModelId: 'seedance-2',
      draftSize: '720p', draftRatio: '16:9', draftDuration: 5,
      ...(draftMode ? { draftMode } : {}),
    },
  });
}

/** 切换视频模型：底栏摘要按钮（模型名|比例|分辨率|时长）展开配置面板 → 模型选择器（精确当前名，
 *  摘要按钮文本含 '|' 被精确匹配排除）→ 目标选项；再点摘要按钮收起面板 */
async function switchModel(currentLabel: string, targetLabel: string) {
  const summaryOf = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => (b.textContent ?? '').includes(label) && (b.textContent ?? '').includes('|'),
    )!;
  await act(async () => { summaryOf(currentLabel).click(); });
  await act(async () => {
    [...container.querySelectorAll('button')].find((b) => b.textContent === currentLabel)!.click();
  });
  await act(async () => {
    [...container.querySelectorAll('button')].find((b) => b.textContent === targetLabel)!.click();
  });
  await act(async () => { summaryOf(targetLabel).click(); });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiGenerationMocks.fetchGenerationModels.mockImplementation(async (): Promise<GenerationModel[]> => [
    videoModel('seedance-2', '测试视频模型'),
  ]);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

/* IKFDFW 视频节点参考持久化与角色恢复：普通参考选取即连线并随既有自动保存落盘；首尾帧角色随
   edge.data.refRole 持久化，关闭/切换/重开经连线推导恢复；保存失败保留与阻断；模型不兼容保留
   并说明原因；移除断线重开不复活；发送按角色路由 references。
   边界：首尾帧「从零添加」的槽位入口受 1f2f498d 起模式门控限制（空素材不可达，与 videoDraft.test
   的 skip 用例同一产品现状），首尾帧验收以已建角色连线的草稿覆盖保存恢复/删除/发送角色校验。
   FlowCanvas/CanvasToolbar/CanvasHeader 打桩透出 props；BottomDialog 用真实实现。 */
describe('IKFDFW 视频参考即时保存与角色恢复', () => {
  /** 关闭当前绑定面板（右上角 ×） */
  async function closePanel() {
    const btn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('title') === '关闭',
    )!;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  it('普通参考（图片+视频）连续选取：立即逐条建线，身份、数量、顺序随自动保存完整上送', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await pickRefNode('从资产中选择 / 从节点添加素材', 'm1');
    expect(edgePairs()).toEqual(['m1->d1']);
    expect(edgeRoles()).toEqual(['reference']);
    await pickRefNode('从资产中选择 / 从节点添加素材', 'v1');
    expect(edgePairs()).toEqual(['m1->d1', 'v1->d1']);
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图', '参考视频']), { timeout: 3000 });

    // 自动保存载荷：两条连线按边序完整上送（普通参考不写 refRole data；未发送生成）
    await vi.waitFor(() => {
      const saved = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
      expect(saved.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`))
        .toEqual(['m1->d1', 'v1->d1']);
    }, { timeout: 3000 });
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });

  it('首尾帧草稿保存恢复：refRole 角色随自动保存上送，面板重开按角色还原', async () => {
    seedDoc('keyframe');
    (canvasDocMock.current.doc as { edges: unknown[] }).edges = [
      { id: 'e-m1-d1', source: 'm1', target: 'd1', data: { refRole: 'first' } },
      { id: 'e-m2-d1', source: 'm2', target: 'd1', data: { refRole: 'last' } },
    ];
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    // 角色随连线 data.refRole 持久化：面板打开触发的自动保存按原角色上送
    expect(edgePairs()).toEqual(['m1->d1', 'm2->d1']);
    expect(edgeRoles()).toEqual(['first', 'last']);
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图', '次图']), { timeout: 3000 });
    await vi.waitFor(() => expect(frameBadges()).toEqual(['首帧', '尾帧']));
    await vi.waitFor(() => {
      const saved = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
      expect(saved.edges.map((e: { source: string; data?: { refRole?: string } }) => `${e.source}:${e.data?.refRole ?? 'reference'}`))
        .toEqual(['m1:first', 'm2:last']);
    }, { timeout: 3000 });
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });

  it('首尾帧草稿移除尾帧：断开对应连线，重开不复活', async () => {
    seedDoc('keyframe');
    (canvasDocMock.current.doc as { edges: unknown[] }).edges = [
      { id: 'e-m1-d1', source: 'm1', target: 'd1', data: { refRole: 'first' } },
      { id: 'e-m2-d1', source: 'm2', target: 'd1', data: { refRole: 'last' } },
    ];
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图', '次图']));

    // Dock 移除尾帧：仅断开尾帧连线，首帧引用保持（面板随素材自动切换模式属既有门控行为，
    // 切出首尾帧模式后首帧槽不再渲染，首帧连线保留可从连线与提示验证）
    const removeButtons = () => [...container.querySelectorAll<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title="移除"]')];
    await act(async () => { removeButtons().at(-1)!.click(); });
    expect(edgePairs()).toEqual(['m1->d1']);
    expect(edgeRoles()).toEqual(['first']);
    // 首帧连线保留的组合校验证据：尾帧缺失 → 提示补全（referenceConflict 优先于模式冲突提示）
    await vi.waitFor(() => expect(container.textContent).toContain('请补充尾帧'));

    // 断线随自动保存上送；关闭重开不复活（模式随素材自动切换属既有门控行为）
    await vi.waitFor(() => {
      const saved = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
      expect(saved.edges.map((e: { source: string }) => e.source)).toEqual(['m1']);
    }, { timeout: 3000 });
    await closePanel();
    await clickNode('d1');
    await vi.waitFor(() => expect(panelVisible()).toBe(true));
    expect(edgePairs()).toEqual(['m1->d1']);
  });

  it('首尾帧生成请求角色校验：references 按 first_frame/last_frame 路由', async () => {
    seedDoc('keyframe');
    (canvasDocMock.current.doc as { edges: unknown[] }).edges = [
      { id: 'e-m1-d1', source: 'm1', target: 'd1', data: { refRole: 'first' } },
      { id: 'e-m2-d1', source: 'm2', target: 'd1', data: { refRole: 'last' } },
    ];
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await typePrompt('首尾帧驱动');
    await act(async () => { sendButton().click(); });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.target_node_id).toBe('d1');
    expect(payload.references).toEqual([
      { asset_id: 'a1', type: 'image', role: 'first_frame' },
      { asset_id: 'a2', type: 'image', role: 'last_frame' },
    ]);
  });

  it('普通参考生成请求角色校验：references 按连线顺序提交 reference 角色', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await pickRefNode('从资产中选择 / 从节点添加素材', 'm1');
    await pickRefNode('从资产中选择 / 从节点添加素材', 'v1');
    await typePrompt('多媒体参考');
    await act(async () => { sendButton().click(); });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.target_node_id).toBe('d1');
    expect(payload.references).toEqual([
      { asset_id: 'a1', type: 'image', role: 'reference' },
      { asset_id: 'a3', type: 'video', role: 'reference' },
    ]);
  });

  it('首尾帧草稿关闭重开：角色连线、徽标、提示词与配置完整恢复', async () => {
    seedDoc('keyframe');
    (canvasDocMock.current.doc as { edges: unknown[] }).edges = [
      { id: 'e-m1-d1', source: 'm1', target: 'd1', data: { refRole: 'first' } },
      { id: 'e-m2-d1', source: 'm2', target: 'd1', data: { refRole: 'last' } },
    ];
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await typePrompt('保留我的编辑');

    // 关闭按钮：面板消失，画布连线（含角色）保留
    await closePanel();
    expect(panelVisible()).toBe(false);
    expect(edgePairs()).toEqual(['m1->d1', 'm2->d1']);
    expect(edgeRoles()).toEqual(['first', 'last']);

    // 重新点击草稿卡：首尾帧参考、徽标、提示词与生成配置恢复
    await clickNode('d1');
    await vi.waitFor(() => expect(panelVisible()).toBe(true));
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图', '次图']));
    await vi.waitFor(() => expect(frameBadges()).toEqual(['首帧', '尾帧']));
    expect(readPromptRefText(container)).toBe('保留我的编辑');
    await vi.waitFor(() => expect(container.textContent).toContain('测试视频模型'));
    expect(container.textContent).toContain('720p');
  });

  it('点击画布空白：视频面板保持打开（既有行为），参考与提示词保留', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await pickRefNode('从资产中选择 / 从节点添加素材', 'm1');
    await typePrompt('空白点击保留');
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图']));

    // 视频底部对话框点击画布空白不自动关闭（CanvasPage 既有语义），编辑与连线保留
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(panelVisible()).toBe(true);
    expect(edgePairs()).toEqual(['m1->d1']);
    expect(readPromptRefText(container)).toBe('空白点击保留');

    // 重开草稿卡：恢复；不恢复选取模式（无选取提示条）
    await closePanel();
    await clickNode('d1');
    await vi.waitFor(() => expect(panelVisible()).toBe(true));
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图']));
    expect(readPromptRefText(container)).toBe('空白点击保留');
    expect(container.textContent).not.toContain('点击画布中的');
  });

  it('A→B→A 切换编辑目标：A 的参考与提示词完整恢复，B 不串入', async () => {
    pushDraftNode('d2');
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await pickRefNode('从资产中选择 / 从节点添加素材', 'm1');
    await pickRefNode('从资产中选择 / 从节点添加素材', 'v1');
    await typePrompt('A 的提示词');
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图', '参考视频']));

    // 切到 B：B 不出现 A 的参考与提示词
    await clickNode('d2');
    await vi.waitFor(() => expect(dockRefNames()).toEqual([]));
    expect(readPromptRefText(container)).toBe('');
    await typePrompt('B 的提示词');

    // 切回 A：A 的参考与提示词完整恢复，B 的编辑不串入
    await clickNode('d1');
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图', '参考视频']));
    expect(readPromptRefText(container)).toBe('A 的提示词');
  });

  it('保存失败：选择保留并显示未保存，阻止切换其他目标与发送，重试成功恢复', async () => {
    pushDraftNode('d2');
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await typePrompt('保存前编辑');

    // 保存持续失败：选取仍立即建线并保留在页面
    apiMocks.saveCanvasDoc.mockImplementation(() => Promise.reject(new Error('boom')));
    await pickRefNode('从资产中选择 / 从节点添加素材', 'm1');
    expect(edgePairs()).toEqual(['m1->d1']);

    // 自动保存失败：显示未保存；连线与 Dock 参考保留
    await vi.waitFor(() => expect(container.textContent).toContain('保存失败，请重试'), { timeout: 3000 });
    expect(edgePairs()).toEqual(['m1->d1']);
    expect(dockRefNames()).toEqual(['首图']);

    // 阻止切换其他编辑目标；阻止发送（提示词非空，仅因未保存被禁）
    await clickNode('d2');
    expect(dockRefNames()).toEqual(['首图']);
    expect(readPromptRefText(container)).toBe('保存前编辑');
    expect(sendButton().disabled).toBe(true);

    // 允许关闭并重开原目标：编辑仍在
    await closePanel();
    expect(panelVisible()).toBe(false);
    await clickNode('d1');
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图']));

    // 重试成功：落盘载荷含参考连线，恢复可切换可发送
    apiMocks.saveCanvasDoc.mockImplementation(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' }));
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === '重试保存')!;
    await act(async () => { retry.click(); });
    await vi.waitFor(() => expect(container.textContent).toContain('已保存'));
    const saved = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
    expect(saved.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`)).toEqual(['m1->d1']);
    expect(sendButton().disabled).toBe(false);
    await clickNode('d2');
    await vi.waitFor(() => expect(dockRefNames()).toEqual([]));
  });

  it('切换不支持视频参考的模型：保留全部参考、说明原因并阻止发送，换回兼容模型恢复', async () => {
    apiGenerationMocks.fetchGenerationModels.mockImplementation(async (): Promise<GenerationModel[]> => [
      videoModel('seedance-2', '测试视频模型'),
      videoModel('other-video', '普通视频模型', { video_reference: false, audio_reference: false }),
    ]);
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await pickRefNode('从资产中选择 / 从节点添加素材', 'v1');
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['参考视频']));
    await typePrompt('参考绘制');
    expect(sendButton().disabled).toBe(false);

    // 切换不支持视频参考的模型（非 Seedance 2.0 系）：参考保留不删除，原因明确，发送被阻止
    await switchModel('测试视频模型', '普通视频模型');
    await vi.waitFor(() => expect(container.textContent).toContain('当前模型不支持视频或音频参考，请更换模型或调整引用'));
    expect(sendButton().disabled).toBe(true);
    expect(dockRefNames()).toEqual(['参考视频']);
    expect(edgePairs()).toEqual(['v1->d1']);

    // 换回兼容模型：恢复可发送
    await switchModel('普通视频模型', '测试视频模型');
    await vi.waitFor(() => expect(container.textContent).not.toContain('当前模型不支持视频或音频参考'));
    expect(sendButton().disabled).toBe(false);
  });

  it('面板移除普通引用后关闭重开不复活，其他目标的引用保持完整', async () => {
    pushDraftNode('d2');
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await pickRefNode('从资产中选择 / 从节点添加素材', 'm1');
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图']));
    // B 目标对同一来源独立引用（m2→d2），移除 A 的引用不应影响
    await act(async () => {
      flowProps.current.onConnect({ source: 'm2', target: 'd2' });
    });
    expect(edgePairs()).toEqual(['m1->d1', 'm2->d2']);

    // Dock 移除 A 的引用：断开对应连线，B 的引用保持
    const removeBtn = container.querySelector<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title="移除"]')!;
    await act(async () => {
      removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(dockRefNames()).toEqual([]));
    expect(edgePairs()).toEqual(['m2->d2']);

    // 断线随自动保存上送；关闭重开不复活
    await vi.waitFor(() => {
      const saved = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
      expect(saved.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`)).toEqual(['m2->d2']);
    }, { timeout: 3000 });
    await closePanel();
    await clickNode('d1');
    await vi.waitFor(() => expect(panelVisible()).toBe(true));
    expect(dockRefNames()).toEqual([]);
    expect(edgePairs()).toEqual(['m2->d2']);
  });

  it('切换参考数量上限不足的模型：保留全部参考并说明原因，用户删除超限项后恢复发送', async () => {
    apiGenerationMocks.fetchGenerationModels.mockImplementation(async (): Promise<GenerationModel[]> => [
      videoModel('seedance-2', '测试视频模型'),
      videoModel('cap1-video', '单参考视频模型', { max_reference_images: 1, video_reference_max: 0, audio_reference_max: 0 }),
    ]);
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await pickRefNode('从资产中选择 / 从节点添加素材', 'm1');
    await pickRefNode('从资产中选择 / 从节点添加素材', 'm2');
    expect(edgePairs()).toEqual(['m1->d1', 'm2->d1']);
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图', '次图']));
    await typePrompt('两张参考');
    expect(sendButton().disabled).toBe(false);

    // 上限不足：参考保留不截断，说明原因并阻止发送
    await switchModel('测试视频模型', '单参考视频模型');
    await vi.waitFor(() => expect(container.textContent).toContain('图片参考超出当前模型上限（最多 1 张），请调整引用或模型'));
    expect(sendButton().disabled).toBe(true);
    expect(dockRefNames()).toEqual(['首图', '次图']);
    expect(edgePairs()).toEqual(['m1->d1', 'm2->d1']);

    // 用户主动删除超限项：恢复发送
    const removeButtons = () => [...container.querySelectorAll<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title="移除"]')];
    await act(async () => { removeButtons()[0]!.click(); });
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['次图']));
    await vi.waitFor(() => expect(container.textContent).not.toContain('图片参考超出当前模型上限'));
    expect(sendButton().disabled).toBe(false);
  });

  it('@ 菜单选择画布图片：立即建立连线并在正文插入素材标签', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await typePromptRefRaw(container, '参考@首');
    // AtMentionMenu 经 portal 挂在 body；带检索词时直接列匹配项
    await vi.waitFor(() => expect(document.body.querySelector('[data-testid="mention-menu"] button')).toBeTruthy());
    const item = [...document.body.querySelectorAll<HTMLButtonElement>('[data-testid="mention-menu"] button')].find(
      (b) => b.textContent?.includes('首图'),
    )!;
    await act(async () => { item.click(); });

    // 立即建立连线（不等待发送）；Dock 显示同一参考
    expect(edgePairs()).toEqual(['m1->d1']);
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图']));
  });
});
