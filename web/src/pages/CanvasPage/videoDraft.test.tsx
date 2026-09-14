// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';

/* IKDMQS 视频草稿：侧栏建卡 / 重复创建 / 连线角色与提交推导 / 组合约束 /
   无效来源拒绝 / 移除断线 / 生成中连线只读。
   FlowCanvas/CanvasToolbar 打桩透出 props；BottomDialog 用真实实现（ChipTextEditor 打桩）。 */

// IKFJJT 合并 0915 适配：视频提交前会对参考图做合规入库（ensureVideoImageRefsCompliance →
// depositCanvasAssetToCharacterLibrary）。测试环境固定返回 materialId，避免真实调素材入库 API。
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

const headerProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/CanvasHeader', () => ({
  default: (props: Record<string, any>) => {
    headerProps.current = props;
    return createElement('div', { 'data-testid': 'canvas-header' });
  },
}));

vi.mock('./components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

vi.mock('@/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

/** PromptRefEditor 打桩（IKFA1O 编辑器替换）：textarea 输入透传结构化 onChange（驱动草稿提示词写回） */
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

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [
    { id: 'p1', name: '项目一' },
    { id: 'p2', name: '项目二' },
  ]),
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
  createGenerationJob: vi.fn(async (_projectId: string, _payload: Record<string, unknown>) => ({ generation_job_id: 'j1', cursor: 1 })),
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
  fetchGenerationModels: vi.fn(async () => [
    {
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

/** 默认画布文档：图片成品 m1/m2 + 视频成品 v1 + 待生成草稿视频 d1 */
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
          data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '首图', assetId: 'a1' },
        },
        {
          id: 'm2',
          type: 'mediaNode',
          position: { x: 400, y: 0 },
          data: { src: 'http://img/m2.png', mediaType: 'image', fileName: '次图', assetId: 'a2' },
        },
        {
          id: 'v1',
          type: 'mediaNode',
          position: { x: 800, y: 0 },
          data: { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '参考视频', assetId: 'a3' },
        },
        {
          id: 'd1',
          type: 'mediaNode',
          position: { x: 200, y: 300 },
          data: {
            src: '',
            mediaType: 'video',
            fileName: '视频草稿',
            genStatus: 'draft',
            draft: true,
            prompt: '',
            draftModelId: 'seedance-2',
            draftSize: '720p', draftRatio: '16:9', draftDuration: 5,
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

async function typePrompt(text: string) {
  const textarea = container.querySelector('textarea')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function connect(source: string, target: string) {
  await act(async () => {
    flowProps.current.onConnect({ source, target });
  });
}

async function clickNode(node: { id: string; type: string; data?: Record<string, unknown> }) {
  // 与真实 Canvas 行为对齐：onNodeClick 传入完整节点（含 data），
  // 而非测试构造的局部对象——handleCanvasNodeClick 从 node.data 读取 assetId 等字段
  const fullNode = flowProps.current.mediaNodes?.find((n: Node) => n.id === node.id);
  await act(async () => {
    flowProps.current.onNodeClick((fullNode ?? node) as Node);
  });
}

/** 等待视频模型能力加载完成（发送前置条件） */
async function waitModelReady() {
  await vi.waitFor(() => expect(container.textContent).toContain('测试视频模型'), { timeout: 3000 });
}

/** 1f2f498d 起模式选择器为下拉：先点底部当前模式按钮展开，再从下拉选项切首尾帧 */
async function selectMode(label: string) {
  const modeLabels = ['文生视频', '全能参考', '图生视频', '首尾帧'];
  await act(async () => {
    [...container.querySelectorAll('button')].find((b) => modeLabels.includes(b.textContent ?? ''))!.click();
  });
  await act(async () => {
    [...container.querySelectorAll('button')].find((b) => b.textContent === label)!.click();
  });
}

async function selectKeyframeMode() {
  await selectMode('首尾帧');
}

/** 经 Dock 槽位入口选取来源节点建立指定角色的连线（真实路径：+ 按钮弹来源菜单 →「从节点添加素材」→ 画布节点点击） */
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
  await clickNode(flowProps.current.mediaNodes.find((n: Node) => n.id === nodeId)!);
}

/** 视频草稿节点集合（画布 state 中的实时形态） */
function videoDrafts(): Node[] {
  return flowProps.current.mediaNodes.filter(
    (n: Node) => n.data?.draft === true && n.data?.mediaType === 'video',
  );
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

describe('IKDMQS 视频草稿创建与编辑', () => {
  it('侧栏视频入口先建草稿卡再开绑定面板：不创建任务（1f2f498d 起入口统一建卡）', async () => {
    await renderPage();
    const before = flowProps.current.mediaNodes.length;

    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });

    // 工具栏入口先建视频草稿卡再打开跟随输入框：seed 的 d1 之外新增一张草稿
    expect(flowProps.current.mediaNodes).toHaveLength(before + 1);
    expect(videoDrafts()).toHaveLength(2);
    // 仅点击入口不创建任务
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    // 面板打开：绑定空草稿卡默认跟随模式「文生视频」（下拉收起仅显示当前模式名）
    expect(container.textContent).toContain('文生视频');
    expect(container.querySelector('button[title="从资产中选择 / 从节点添加素材"]')).toBeTruthy();
  });

  it('侧栏入口发送：绑定新建草稿卡生成（带 target_node_id），不另落生成卡', async () => {
    await renderPage();
    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });
    await waitModelReady();
    await typePrompt('自由模式输入');

    await act(async () => { sendButton().click(); });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.type).toBe('video');
    // IKFC1T：新建默认文生视频，仅提示词提交——省略 references 字段，不发 references: []
    expect(payload.references).toBeUndefined();
    expect('references' in payload).toBe(false);
    // 发送绑定入口新建的草稿卡，在原卡生成
    expect(typeof payload.target_node_id).toBe('string');
    expect((payload.parameters as Record<string, unknown>).prompt).toBe('自由模式输入');
    // seed 4 节点 + 入口建的 1 张草稿卡；生成发生在原卡，不新增节点
    expect(flowProps.current.mediaNodes).toHaveLength(5);
    // 绑定草稿卡发送在原卡生成，面板保持打开供继续调整
    expect(container.querySelector('textarea')).toBeTruthy();
  });

  it('连续点击侧栏入口：每次新建草稿卡，面板保持打开', async () => {
    await renderPage();
    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });
    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });
    expect(videoDrafts()).toHaveLength(3); // seed d1 + 两次点击各建一张
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    expect(container.textContent).toContain('文生视频');
  });

  it('点击已保存的视频草稿卡重开绑定面板', async () => {
    await renderPage();
    // 关闭面板后点击草稿卡 d1（seed 中的已保存草稿）
    await clickNode({
      id: 'd1',
      type: 'mediaNode',
      data: { draft: true, mediaType: 'video', genStatus: 'draft' },
    });
    expect(container.textContent).toContain('文生视频');
    expect(container.querySelector('button[title="从资产中选择 / 从节点添加素材"]')).toBeTruthy();
  });
});

describe('IKDMQS 视频参考连线与显式角色', () => {
  it('画布拖线默认普通参考角色；首帧/尾帧由 Dock 入口显式指定', async () => {
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });

    await connect('m1', 'd1');
    const edge = flowProps.current.edges.find((e: { source: string; target: string }) => e.source === 'm1' && e.target === 'd1');
    expect(edge).toBeTruthy();
    // 缺省角色不写 data（普通参考）
    expect(edge.data?.refRole).toBeUndefined();
    // Dock 普通参考区显示该项
    expect(container.querySelector('[data-testid="dock-video-ref"]')).toBeTruthy();
  });

  it('无效来源被拒绝并提示：待生成草稿不能作为参考', async () => {
    // 追加第二个待生成草稿 d2 作为无效来源（draft 状态不可作参考）
    (canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> }).nodes.push({
      id: 'd2',
      type: 'mediaNode',
      position: { x: 300, y: 300 },
      data: { src: '', mediaType: 'video', fileName: '视频草稿', genStatus: 'draft', draft: true, prompt: '' },
    });
    await renderPage();
    await connect('d2', 'd1');
    expect(
      flowProps.current.edges.some((e: { source: string }) => e.source === 'd2'),
    ).toBe(false);
  });

  it('同一素材重复连入被拒绝（跨角色按 assetId 判重）', async () => {
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await connect('m1', 'd1');
    await connect('m1', 'd1');
    const edges = flowProps.current.edges.filter((e: { source: string; target: string }) => e.source === 'm1' && e.target === 'd1');
    expect(edges).toHaveLength(1);
  });
});

describe('IKDMQS 提交推导与组合约束', () => {
  it('仅普通参考连线：提交 references + target_node_id，先落盘后建任务', async () => {
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await connect('m1', 'd1');
    await waitModelReady();
    await typePrompt('大海与蓝鲸');

    await act(async () => { sendButton().click(); });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    expect(apiMocks.saveCanvasDoc).toHaveBeenCalled();
    const [projectId, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(projectId).toBe('p1');
    expect(payload.type).toBe('video');
    expect(payload.target_node_id).toBe('d1');
    expect(payload.references).toEqual([{ material_id: 'asset-compliance-test', type: 'image', role: 'reference' }]);
    expect(payload.first_frame_asset_id).toBeUndefined();
    // 原位承接 + 首次结果回填同一张卡（fetchJobStatus mock 秒回 succeeded）：
    // 节点数量与身份不变，草稿标记清除、结果 src/assetId 写入同节点
    await vi.waitFor(() => {
      const d1 = flowProps.current.mediaNodes.find((n: Node) => n.id === 'd1');
      const data = d1!.data as Record<string, unknown>;
      expect(data.src).toBe('http://vid/out.mp4');
      expect(data.assetId).toBe('a2');
      expect(data.draft).toBeUndefined();
      expect(data.genStatus).toBeUndefined();
    });
    expect(flowProps.current.mediaNodes).toHaveLength(4);
  });

  // 1f2f498d 起跟随模式按已连素材门控：空素材仅「文生视频」，首尾帧需 ≥2 图，
  // 且普通参考存在时切换被拒——「空素材直接选首尾帧」旧路径已不可达，待与产品确认新路径后重写
  it.skip('首尾帧选取暂存，发送时落线并提交带角色的 references', async () => {
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await waitModelReady();
    await selectKeyframeMode();
    // 经 Dock 首帧/尾帧入口显式指定（不按连入顺序猜测）
    await pickRefNode('添加首帧（从资产中选择 / 从节点添加素材）', 'm1');
    await pickRefNode('添加尾帧（从资产中选择 / 从节点添加素材）', 'm2');
    expect(flowProps.current.edges).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="dock-video-ref"]')).toHaveLength(2);
    await typePrompt('首尾帧驱动');
    await act(async () => { sendButton().click(); });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1);
    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.references).toEqual([
      { material_id: 'asset-compliance-test', type: 'image', role: 'first_frame' },
      { material_id: 'asset-compliance-test', type: 'image', role: 'last_frame' },
    ]);
    expect(flowProps.current.edges.map((e: { data?: { refRole?: string } }) => e.data?.refRole))
      .toEqual(expect.arrayContaining(['first', 'last']));
    expect(payload.reference_asset_ids).toBeUndefined();
    expect(payload.target_node_id).toBe('d1');
  });

  it('恢复的首尾帧与普通参考混用时禁止提交', async () => {
    const doc = canvasDocMock.current.doc as { edges: unknown[] };
    doc.edges = [
      { id: 'ref', source: 'm1', target: 'd1' },
      { id: 'first', source: 'm2', target: 'd1', data: { refRole: 'first' } },
    ];
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await waitModelReady();
    await typePrompt('混用输入');
    expect(container.textContent).toContain('首尾帧与普通参考不能混用');
    expect(sendButton().disabled).toBe(true);
    await act(async () => { sendButton().click(); });
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });

  it('已有 2 张普通参考图片时切换首尾帧模式：自动转为首帧/尾帧槽（IKFJJT）', async () => {
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    // 2 张图片连线后首尾帧模式可选；切换时自动把第 1/2 张转为首帧/尾帧（不再要求先移除）
    await connect('m1', 'd1');
    await connect('m2', 'd1');
    await waitModelReady();
    await selectKeyframeMode();
    // 连线保留并带上角色：m1→first、m2→last
    await vi.waitFor(() => {
      const edges = flowProps.current.edges as Array<{ source: string; data?: { refRole?: string } }>;
      expect(edges.find((e) => e.source === 'm1')?.data?.refRole).toBe('first');
      expect(edges.find((e) => e.source === 'm2')?.data?.refRole).toBe('last');
    });
    expect(flowProps.current.edges).toHaveLength(2);
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });

  it('首尾帧模式切回全能参考：首帧/尾帧转回普通参考（IKFJJT 对称转换）', async () => {
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await connect('m1', 'd1');
    await connect('m2', 'd1');
    await waitModelReady();
    await selectKeyframeMode();
    await vi.waitFor(() => {
      const edges = flowProps.current.edges as Array<{ source: string; data?: { refRole?: string } }>;
      expect(edges.find((e) => e.source === 'm1')?.data?.refRole).toBe('first');
    });
    // 切回全能参考：首尾帧转回普通参考（refRole 字段移除 = 缺省 reference）
    await selectMode('全能参考');
    await vi.waitFor(() => {
      const edges = flowProps.current.edges as Array<{ source: string; data?: { refRole?: string } }>;
      expect(edges.find((e) => e.source === 'm1')?.data?.refRole).toBeUndefined();
      expect(edges.find((e) => e.source === 'm2')?.data?.refRole).toBeUndefined();
    });
    expect(flowProps.current.edges).toHaveLength(2);
  });
});

describe('IKDMQS 生成中连线只读', () => {
  it('生成中的视频草稿：新建连线被拦截并提示', async () => {
    await renderPage();
    // 提交使 d1 原地转生成中
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await connect('m1', 'd1');
    await waitModelReady();
    await typePrompt('转生成中');
    // 轮询挂起在执行中，保持 generating 只读态
    apiMocks.fetchJobStatus.mockImplementation(async () => ({ job_id: 'j1', status: 'running', progress: 10 }) as unknown as Awaited<ReturnType<typeof apiMocks.fetchJobStatus>>);
    await act(async () => { sendButton().click(); });
    await vi.waitFor(() => {
      const d1 = flowProps.current.mediaNodes.find((n: Node) => n.id === 'd1');
      expect((d1!.data as Record<string, unknown>).genStatus).toBe('generating');
    });

    // 生成中再连入新来源被拦
    await connect('m2', 'd1');
    expect(
      flowProps.current.edges.some((e: { source: string; target: string }) => e.source === 'm2' && e.target === 'd1'),
    ).toBe(false);
  });
});

describe('IKDWL8 视频失效引用保护', () => {
  it.each(['reference', 'first', 'last'])('恢复的 %s 引用失效时显示原因，必须断线后才能发送', async (role) => {
    const doc = canvasDocMock.current.doc as { nodes: Node[]; edges: unknown[] };
    doc.nodes.find(n => n.id === 'm1')!.data.genStatus = 'failed';
    doc.edges = [{ id: 'invalid-ref', source: 'm1', target: 'd1', data: { refRole: role } }];
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video', genStatus: 'draft' } });
    await waitModelReady();
    await typePrompt('保留参考意图');
    expect(container.textContent).toContain('生成失败的卡片不能作为参考');
    expect(sendButton().disabled).toBe(true);
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    expect(flowProps.current.edges).toHaveLength(1);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="移除失效引用 首图"]')!.click();
    });
    expect(flowProps.current.edges).toHaveLength(0);
    expect(flowProps.current.mediaNodes.some((n: Node) => n.id === 'm1')).toBe(true);
    expect(sendButton().disabled).toBe(false);
  });
});

/* IKFC1T 文生视频入口与媒体参考自动切换：新建默认文生视频（仅提示词省略 references）、
   文本附件不触发切换、三个接入路径（连线/从节点添加素材落线）触发自动切全能参考并保留输入、
   存在媒体参考时文生视频置灰（部分删除仍置灰，全部删除恢复可选但不自动切回）、草稿恢复保持已存模式。 */
const MODE_LABELS = ['文生视频', '全能参考', '图生视频', '首尾帧'];

function modeButton(): HTMLButtonElement {
  return [...container.querySelectorAll('button')].find((b) => MODE_LABELS.includes(b.textContent ?? ''))!;
}

async function expectMode(label: string) {
  await vi.waitFor(() => expect(modeButton().textContent).toBe(label));
}

/** 展开模式下拉（幂等）：下拉已展开（出现多个模式按钮）时不再点击——jsdom click 不触发
 *  mousedown 关不掉了 useDismissOnOutside，二次点击会误选下拉首项 */
async function openModeMenu() {
  const modeButtons = () => [...container.querySelectorAll('button')].filter((b) => MODE_LABELS.includes(b.textContent ?? ''));
  if (modeButtons().length > 1) return; // 已展开（收起态仅当前模式一个按钮）
  await act(async () => { modeButtons()[0]!.click(); });
}

function modeOption(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === label);
}

function draftDataOf(nodeId: string): Record<string, unknown> {
  return flowProps.current.mediaNodes.find((n: Node) => n.id === nodeId)!.data as Record<string, unknown>;
}

describe('IKFC1T 文生视频入口与媒体参考自动切换', () => {
  it('文本附件不触发模式切换：连入文本节点后保持文生视频，附件驱动可提交', async () => {
    const doc = canvasDocMock.current.doc as { nodes: Node[] };
    doc.nodes.push({
      id: 't1',
      type: 'textNode',
      position: { x: 0, y: 600 },
      data: { title: '故事文案', text: '一只蓝鲸的深海旅程' },
    });
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await expectMode('文生视频');

    await connect('t1', 'd1');

    await expectMode('文生视频');
    // IKFCKQ：文本附件以 FileText 缩略图进参考栏（独立区块下线）
    expect(container.querySelectorAll('[data-testid="dock-text-ref"]')).toHaveLength(1);
    await waitModelReady();
    expect(sendButton().disabled).toBe(false);
  });

  it('画布连线图片成为参考：自动切全能参考并保留输入（提示词与文本附件），提交携带完整引用', async () => {
    const doc = canvasDocMock.current.doc as { nodes: Node[] };
    doc.nodes.push({
      id: 't1',
      type: 'textNode',
      position: { x: 0, y: 600 },
      data: { title: '故事文案', text: '一只蓝鲸的深海旅程' },
    });
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await waitModelReady();
    await expectMode('文生视频');
    await typePrompt('海边日落');
    await connect('t1', 'd1'); // 文本附件先入（不触发切换）
    await expectMode('文生视频');

    await connect('m1', 'd1');

    await expectMode('全能参考');
    expect(container.textContent).toContain('已根据当前素材切换生成模式');
    // 自动切换保留文本附件与提示词（缩略图仍在参考栏）
    expect(container.querySelectorAll('[data-testid="dock-text-ref"]')).toHaveLength(1);
    await vi.waitFor(() => expect(draftDataOf('d1').draftMode).toBe('all'));
    await vi.waitFor(() => expect(draftDataOf('d1').prompt).toBe('海边日落'));

    await act(async () => { sendButton().click(); });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.references).toEqual([{ material_id: 'asset-compliance-test', type: 'image', role: 'reference' }]);
  });

  it('角色库 material 参考成为参考（草稿 data，无连线）：打开面板即自动切全能参考', async () => {
    const doc = canvasDocMock.current.doc as { nodes: Node[] };
    doc.nodes.find(n => n.id === 'd1')!.data.draftMaterialRefs = [
      { materialId: 'asset-lib1', url: 'http://img/lib1.png', name: '角色立绘', mediaType: 'image', role: 'reference' },
    ];
    await renderPage();
    // 面板未开：角色库参考不触发任何行为；打开后按实际参考判定
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await expectMode('全能参考');
    expect(flowProps.current.edges).toHaveLength(0);
  });

  it('从节点添加素材参考：选取即落线成为当前参考（IKFDFW），自动切全能参考', async () => {
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await waitModelReady();
    await expectMode('文生视频');

    await pickRefNode('从资产中选择 / 从节点添加素材', 'm1');

    expect(flowProps.current.edges).toHaveLength(1); // IKFDFW：选取即建连线，不再经暂存
    await expectMode('全能参考');
  });

  it('存在媒体参考时文生视频置灰；部分删除仍置灰；全部删除恢复可选但不自动切回', async () => {
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await waitModelReady();
    await connect('m1', 'd1');
    await connect('m2', 'd1');
    await expectMode('全能参考');

    await openModeMenu();
    expect(modeOption('文生视频')!.disabled).toBe(true);

    // 移除部分参考：仍有媒体参考，文生视频保持置灰（IKFCKQ：× 为共享缩略图按钮，title=移除）
    const removeButtons = () => container.querySelectorAll<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title="移除"]');
    await act(async () => { removeButtons()[0]!.click(); });
    await openModeMenu();
    expect(modeOption('文生视频')!.disabled).toBe(true);

    // 全部移除：文生视频恢复可选，当前模式保持全能参考（不自动切回，不代用户改模式）
    await act(async () => { removeButtons()[0]!.click(); });
    await vi.waitFor(() => expect(flowProps.current.edges).toHaveLength(0));
    await openModeMenu();
    expect(modeOption('文生视频')!.disabled).toBe(false);
    expect(modeButton().textContent).toBe('全能参考');
  });

  it('草稿恢复保持已保存模式：首尾帧草稿恢复首尾帧，文生视频草稿无媒体恢复文生视频', async () => {
    const doc = canvasDocMock.current.doc as { nodes: Node[]; edges: unknown[] };
    // 已保存首尾帧草稿：模式与首尾帧连线一并恢复
    doc.nodes.find(n => n.id === 'd1')!.data.draftMode = 'keyframe';
    doc.edges = [
      { id: 'f1', source: 'm1', target: 'd1', data: { refRole: 'first' } },
      { id: 'f2', source: 'm2', target: 'd1', data: { refRole: 'last' } },
    ];
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await expectMode('首尾帧');

    // 已保存文生视频草稿 + 画布连线加入媒体（面板关闭时）：重开面板自动切全能参考
    doc.nodes.find(n => n.id === 'd1')!.data.draftMode = 'prompt';
    doc.edges = [{ id: 'r1', source: 'm1', target: 'd1' }];
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await expectMode('全能参考');
    expect(container.textContent).toContain('已根据当前素材切换生成模式');

    // 已保存文生视频草稿 + 无媒体：恢复文生视频
    doc.edges = [];
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await expectMode('文生视频');
  });
});

/* IKFC26 方案绑定媒体同步视频模式：方案把媒体实际绑定到文生视频目标后，服务端随连线一并
   持久化切换（文生视频 → 全能参考）；前端绑定回调以服务端返回为准同步本地节点，
   面板重开恢复与持久化一致的模式，后续自动保存不把切换结果覆盖回旧模式；纯文本方案不触发切换。 */
describe('IKFC26 方案绑定媒体同步视频模式', () => {
  /** 画布加方案节点（promptSource 方案，媒体索引可选）并把视频草稿置为文生视频；
   *  方案素材索引 assetId 须为纯数字（promptMentionSchema 契约），自建 m9 承载 */
  function seedPlanDoc(mediaMentions: boolean) {
    seedDoc();
    const doc = canvasDocMock.current.doc as { nodes: Node[] };
    doc.nodes.push({
      id: 'm9',
      type: 'mediaNode',
      position: { x: 600, y: 600 },
      data: { src: 'http://img/m9.png', mediaType: 'image', fileName: '方案素材', assetId: '101' },
    });
    doc.nodes.push({
      id: 'plan1',
      type: 'textNode',
      position: { x: 0, y: 600 },
      data: mediaMentions
        ? {
            title: '方案', text: '图A的故事', promptSource: { sessionId: 's1', revisionId: 'r1', shotNo: 1 },
            promptMentions: [{ start: 0, end: 2, index: 1, assetId: '101' }],
            promptMaterials: [{ assetId: '101', mediaType: 'image', url: 'http://img/m9.png' }],
          }
        : {
            title: '方案', text: '只有文字', promptSource: { sessionId: 's1', revisionId: 'r1', shotNo: 1 },
            promptMentions: [], promptMaterials: [],
          },
    });
    doc.nodes.find(n => n.id === 'd1')!.data.draftMode = 'prompt';
    // 素材字典补 101：水合按字典推导 assetMissing，缺失会被判「素材已被删除」排除出参考
    canvasDocMock.current.assets = {
      ...canvasDocMock.current.assets,
      101: { asset_id: 101, type: 'image', access_url: 'http://img/m9.png', width: 100, height: 100 },
    };
  }

  /** 方案绑定 API 返回：服务端按切换规则写回目标 draftMode，素材边/方案边随 edges 返回 */
  function mockReferenceSaved(draftModeAfter: 'all' | 'prompt', withMaterialEdges: boolean) {
    const doc = canvasDocMock.current.doc as { nodes: Node[] };
    const nodes = doc.nodes.map(n => n.id === 'd1' ? { ...n, data: { ...n.data, draftMode: draftModeAfter } } : n);
    const edges = withMaterialEdges
      ? [
          { id: 'e-m9-d1', source: 'm9', target: 'd1', data: { inputSources: { manual: false, planNodeIds: ['plan1'] } } },
          { id: 'e-plan1-d1', source: 'plan1', target: 'd1', data: { promptReference: { bindings: [{ index: 1, assetId: '101' }] } } },
        ]
      : [{ id: 'e-plan1-d1', source: 'plan1', target: 'd1', data: { promptReference: { bindings: [] } } }];
    apiMocks.referencePromptPlan.mockImplementation(async () => ({
      id: 11, project_id: 1, version: 4, viewport: '{}',
      nodes: JSON.stringify(nodes), edges: JSON.stringify(edges),
    }));
  }

  it('方案绑定媒体：本地跟随服务端切全能参考，面板重开恢复一致，后续自动保存不回退', async () => {
    seedPlanDoc(true);
    mockReferenceSaved('all', true);
    await renderPage();
    await connect('plan1', 'd1'); // 画布拖方案到视频目标（面板未开，服务端路径）

    await vi.waitFor(() => expect(draftDataOf('d1').draftMode).toBe('all'));
    await vi.waitFor(() => expect(flowProps.current.edges).toHaveLength(2));

    // 面板重开：恢复显示与持久化一致的全能参考（素材连线在，门控同向）
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await expectMode('全能参考');

    // 绑定后再编辑触发自动保存：提交的节点保留切换结果（不把服务端切换覆盖回旧模式）
    await typePrompt('绑定后再编辑');
    await vi.waitFor(() => {
      const last = apiMocks.saveCanvasDoc.mock.calls.at(-1) as unknown as [string, { nodes: Node[] }] | undefined;
      expect(last).toBeTruthy();
      expect(last![1].nodes.find((n: Node) => n.id === 'd1')!.data.draftMode).toBe('all');
    }, { timeout: 3000 });

    // 生成提交使用目标实际参考：完整携带方案绑定引入的素材引用
    await waitModelReady();
    await act(async () => { sendButton().click(); });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]! as unknown as [string, Record<string, unknown>];
    expect(payload.references).toEqual([{ material_id: 'asset-compliance-test', type: 'image', role: 'reference' }]);
  });

  it('方案仅文本：服务端不切换，本地保持文生视频，重开面板恢复文生视频', async () => {
    seedPlanDoc(false);
    mockReferenceSaved('prompt', false);
    await renderPage();
    await connect('plan1', 'd1');

    await vi.waitFor(() => expect(flowProps.current.edges).toHaveLength(1));
    expect(draftDataOf('d1').draftMode).toBe('prompt');

    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await expectMode('文生视频');
  });
});
