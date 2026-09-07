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

/** ChipTextEditor 打桩：textarea 输入透传 onChange（驱动 composed 与草稿提示词写回） */
vi.mock('./components/ChipTextEditor', () => ({
  default: ({ onChange }: { onChange?: (v: { segments: Array<{ kind: string; value: string }> }) => void }) =>
    createElement('textarea', {
      'data-testid': 'chip-editor',
      onChange: (e: Event) =>
        onChange?.({ segments: [{ kind: 'text', value: (e.target as HTMLTextAreaElement).value }] }),
    }),
}));

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
      model_id: 'v-test',
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
            draftModelId: 'v-test',
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
  await act(async () => {
    flowProps.current.onNodeClick(node as Node);
  });
}

/** 等待视频模型能力加载完成（发送前置条件） */
async function waitModelReady() {
  await vi.waitFor(() => expect(container.textContent).toContain('测试视频模型'), { timeout: 3000 });
}

/** 经 Dock 槽位入口选取来源节点建立指定角色的连线（真实路径：+ 按钮 → 画布节点点击） */
async function pickRefNode(slotTitle: string, nodeId: string) {
  await vi.waitFor(() => {
    const btn = [...container.querySelectorAll('button')].find((b) => b.title === slotTitle);
    expect(btn).toBeTruthy();
  });
  await act(async () => {
    [...container.querySelectorAll('button')].find((b) => b.title === slotTitle)!.click();
  });
  await clickNode({ id: nodeId, type: 'mediaNode' });
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
  it('侧栏视频入口先建视频草稿卡并绑定面板：自动选中、不创建生成任务', async () => {
    await renderPage();
    const before = flowProps.current.mediaNodes.length;

    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });

    const drafts = videoDrafts();
    const draft = drafts.at(-1)!;
    expect(draft).toBeTruthy();
    expect(flowProps.current.mediaNodes).toHaveLength(before + 1);
    expect(draft.type).toBe('mediaNode');
    expect(draft.data.mediaType).toBe('video');
    expect(draft.data.genStatus).toBe('draft');
    expect(draft.data.draft).toBe(true);
    expect(draft.data.fileName).toBe('视频草稿');
    expect(draft.selected).toBe(true);
    // 仅点击入口不创建任务
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    // 面板打开且绑定该草稿（角色槽可见）
    expect(container.textContent).toContain('首帧');
    expect(container.textContent).toContain('普通参考');
  });

  it('连续点击侧栏入口每次新增独立草稿', async () => {
    await renderPage();
    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });
    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });
    const drafts = flowProps.current.mediaNodes.filter(
      (n: Node) => n.data?.draft === true && n.data?.mediaType === 'video',
    );
    expect(drafts).toHaveLength(3); // seed d1 + 两次新建
    const ids = drafts.map((n: Node) => n.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('点击已保存的视频草稿卡重开绑定面板', async () => {
    await renderPage();
    // 关闭面板后点击草稿卡 d1（seed 中的已保存草稿）
    await clickNode({
      id: 'd1',
      type: 'mediaNode',
      data: { draft: true, mediaType: 'video', genStatus: 'draft' },
    });
    expect(container.textContent).toContain('首帧');
    expect(container.textContent).toContain('普通参考');
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
    await renderPage();
    // 新建草稿 d2（draft 状态）连入 d1
    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });
    const d2 = flowProps.current.mediaNodes.find(
      (n: Node) => n.data?.draft === true && n.data?.mediaType === 'video' && n.id !== 'd1',
    )!;
    await connect(d2.id, 'd1');
    expect(
      flowProps.current.edges.some((e: { source: string }) => e.source === d2.id),
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
  it('仅普通参考连线：提交 reference_asset_ids + target_node_id，先落盘后建任务', async () => {
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
    expect(payload.reference_asset_ids).toEqual(['a1']);
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

  it('首帧+尾帧连线：提交 first/last_frame_asset_id，不携带 reference_asset_ids', async () => {
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await waitModelReady();
    // 经 Dock 首帧/尾帧入口显式指定（不按连入顺序猜测）
    await pickRefNode('到节点选择首帧', 'm1');
    await pickRefNode('到节点选择尾帧', 'm2');
    await vi.waitFor(() => {
      const roles = flowProps.current.edges.map((e: { data?: { refRole?: string } }) => e.data?.refRole);
      expect(roles).toEqual(expect.arrayContaining(['first', 'last']));
    });
    await typePrompt('首尾帧驱动');
    await act(async () => { sendButton().click(); });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1);
    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.first_frame_asset_id).toBe('a1');
    expect(payload.last_frame_asset_id).toBe('a2');
    expect(payload.reference_asset_ids).toBeUndefined();
    expect(payload.target_node_id).toBe('d1');
  });

  it('首尾帧与普通参考混用：提交被阻止并提示，不创建任务', async () => {
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await connect('m1', 'd1');
    await waitModelReady();
    await pickRefNode('到节点选择首帧', 'm2');
    await typePrompt('混用输入');
    await vi.waitFor(() => expect(container.textContent).toContain('首尾帧与普通参考不能混用'));

    // 发送按钮被冲突禁用
    expect(sendButton().disabled).toBe(true);
    expect(container.textContent).toContain('首尾帧与普通参考不能混用');
    await act(async () => { sendButton().click(); });
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
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
