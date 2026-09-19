// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { typePromptRefText } from './testing/promptRefEditor';

/* IKDLQF 接线测试：连线受控化（水合恢复/自动保存签名）、图片面板附件展示、
   目标节点提交的保存串行化与 target_node_id 携带。
   FlowCanvas/CanvasToolbar 打桩透出 props；ImageDialog 用真实实现验证附件区。 */

// IKFJJT 合并 0915 适配：视频提交前会对参考图做合规入库（ensureVideoImageRefsCompliance →
// depositCanvasAssetToCharacterLibrary）。测试环境固定返回 materialId，避免真实调素材入库 API。
vi.mock('./characterLibraryDeposit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./characterLibraryDeposit')>()),
  depositCanvasAssetToCharacterLibrary: vi.fn(async () => ({ materialId: 'asset-compliance-test' })),
  // IKFVMQ 合规改轮询 GetAsset：带 materialId 的参考会走真实 waitAssetReady
  // （getAsset 未 mock 致视频提交中止），测试环境跳过轮询等待
  waitComplianceAssetReady: vi.fn(async () => ({})),
}));

vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

/** FlowCanvas 打桩：透出 props 供测试直接读取 edges 与触发节点回调 */
const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/Canvas', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

/** CanvasToolbar 打桩：透出 onToggleImageDialog 模拟底部固定入口 */
const toolbarProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/CanvasToolbar', () => ({
  default: (props: Record<string, any>) => {
    toolbarProps.current = props;
    return createElement('div', { 'data-testid': 'canvas-toolbar' });
  },
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
  createConversationQuote: vi.fn(),
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
      features: {},
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
  createConversationQuote: apiMocks.createConversationQuote,
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => Promise.resolve({ items: [] }), retry: false }),
  applyPromptPreview: apiMocks.applyPromptPreview,
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn((edges: Array<{ id: string; source: string; target: string }>) =>
    JSON.stringify(edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))),
  ),
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
}));

vi.mock('@/api/jobs', () => ({
  createGenerationJob: apiMocks.createGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createMediaExtraction: apiMocks.createMediaExtraction,
  readJobFailText: vi.fn(() => ''),
}));

vi.mock('@/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));

vi.mock('@/api/generation', () => ({
  fetchGenerationModels: apiMocks.fetchGenerationModels,
}));

/* useCanvasDoc 打桩须保持引用稳定（见 index.test.tsx 注释）；内容经 current 按用例注入 */
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

/** 画布文档：文本节点 t1/t2 + 图片媒体节点 m1 + 图片草稿 d1，连线 e1: t1 → m1
 *  d1 作为合法连线目标（connectPair 要求 genKindOf 非空）；m1 为成品卡，不再接受新连线。 */
function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { title: '故事文案', text: '一只蓝鲸在海里' } },
        { id: 't2', type: 'textNode', position: { x: 40, y: 40 }, data: { title: '配色参考', text: '深蓝与银白' } },
        {
          id: 'm1',
          type: 'mediaNode',
          position: { x: 200, y: 0 },
          data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '目标图', assetId: 'a1' },
        },
        {
          id: 'd1',
          type: 'mediaNode',
          position: { x: 420, y: 160 },
          data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '' },
        },
      ],
      edges: [{ id: 'e1', source: 't1', target: 'm1' }],
    },
    assets: {
      a1: { asset_id: 1, type: 'image', access_url: 'http://img/m1.png', width: 100, height: 100 },
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

describe('IKDLQF 连线受控化与目标生图接线', () => {
  it('水合恢复连线且连线默认可见（showEdges 初始 true）', async () => {
    await renderPage();

    expect(flowProps.current.showEdges).toBe(true);
    expect(flowProps.current.edges).toEqual([
      { id: 'e1', source: 't1', target: 'm1', type: 'custom', style: { stroke: '#444' } },
    ]);
  });

  it('无变更不保存；连线变更进入自动保存签名并随下次保存上送', async () => {
    // 新连线只允许进入生成节点；普通成品图不再是合法目标。
    const doc = canvasDocMock.current.doc as { nodes: Node[] };
    doc.nodes.find((n) => n.id === 'm1')!.data.draft = true;
    await renderPage();

    // 水合基线与当前内容一致：超过防抖窗口也不应发起保存
    await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();

    // 连线目标须为草稿节点（connectPair 要求 genKindOf 非空；m1 为成品卡不再接受新连线）
    await act(async () => {
      flowProps.current.onConnect({ source: 't2', target: 'd1', sourceHandle: null, targetHandle: null });
    });

    await vi.waitFor(
      () => expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1),
      { timeout: 3000 },
    );
    const payload = apiMocks.saveCanvasDoc.mock.calls[0]![1];
    expect(payload.edges).toHaveLength(2);
    expect(payload.edges.map((e) => ({ source: e.source, target: e.target }))).toEqual([
      { source: 't1', target: 'm1' },
      { source: 't2', target: 'd1' },
    ]);
  });

  it('拒绝自环与重复 (source,target) 连线，不进入保存签名', async () => {
    await renderPage();
    expect(flowProps.current.edges).toHaveLength(1);

    await act(async () => {
      flowProps.current.onConnect({ source: 't1', target: 'm1', sourceHandle: null, targetHandle: null });
      flowProps.current.onConnect({ source: 't1', target: 't1', sourceHandle: null, targetHandle: null });
    });

    expect(flowProps.current.edges).toHaveLength(1);
    await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
  });

  it('删除文本节点后连线级联移除，并随自动保存上送空连线', async () => {    await renderPage();
    expect(flowProps.current.edges).toHaveLength(1);

    await act(async () => {
      flowProps.current.onDeleteNode(['t1']);
    });

    expect(flowProps.current.edges).toEqual([]);
    await vi.waitFor(
      () => expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1),
      { timeout: 3000 },
    );
    const payload = apiMocks.saveCanvasDoc.mock.calls[0]![1];
    expect(payload.edges).toEqual([]);
    expect(payload.nodes.find((n) => n.id === 't1')).toBeUndefined();
  });

  it('从图片节点打开面板展示文本附件；提交先落盘当前编辑再携带 target_node_id', async () => {
    // IKFZ9W 起「图片节点生成图片」改为新建草稿卡并自动连原图为参考（与生成视频入口对齐），
    // 成品图不再是面板绑定目标；本用例验证带文本附件的图片面板，故把 m1 置为草稿卡后点节点打开
    const doc = canvasDocMock.current.doc as { nodes: Node[] };
    doc.nodes.find((n) => n.id === 'm1')!.data.draft = true;
    await renderPage();

    await act(async () => {
      flowProps.current.onNodeClick(flowProps.current.mediaNodes.find((n: Node) => n.id === 'm1'));
    });

    // 面板打开即展示当前附件（IKFCKN：FileText 缩略图进参考栏，正文在悬停预览）
    await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="dock-text-ref"]')).toHaveLength(1));

    // 模型能力就位后，空提示词 + 非空附件正文即可发送（契约：附件可单独驱动生成）
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    expect(sendButton().disabled).toBe(false);

    // 制造一笔未防抖落盘的正文编辑
    const text = flowProps.current.textNodes.find((n: Node) => n.id === 't1');
    await act(async () => {
      text.data.onTextChange('t1', '一只蓝鲸在海里游');
    });

    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const [projectId, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(projectId).toBe('p1');
    expect(payload.type).toBe('image');
    expect(payload.target_node_id).toBe('m1');
    // 草稿卡面板的参考只来自连线；本用例未挂媒体参考边，走「附件正文单独驱动生成」路径
    // （图片参考 → input_asset_ids 的推导覆盖在 imageRefPersist 套件）
    expect(payload.input_asset_ids).toBeUndefined();
    expect(payload.parameters.prompt).toBe('一只蓝鲸在海里游');

    // 保存串行化：先落盘（含未防抖编辑与连线）再创建任务
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expect(apiMocks.saveCanvasDoc.mock.invocationCallOrder[0]!).toBeLessThan(
      apiMocks.createGenerationJob.mock.invocationCallOrder[0]!,
    );
    const saved = apiMocks.saveCanvasDoc.mock.calls[0]![1];
    expect(saved.nodes.find((n) => n.id === 't1')!.data.text).toBe('一只蓝鲸在海里游');
    expect(saved.edges).toHaveLength(1);
  });

  it('资产卡「生成图片」打开空白面板：提交不携带 target_node_id，也不做提交前落盘', async () => {
    // IKDMQQ 起侧栏图片入口改为先建草稿卡（必带 target_node_id）；
    // 不带目标节点的旧链路改由资产卡「生成图片」入口承载（空白面板）。
    canvasDocMock.current = {
      doc: {
        id: 11,
        version: 3,
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { title: '故事文案', text: '一只蓝鲸在海里' } },
          { id: 'c1', type: 'assetNode', position: { x: 300, y: 0 }, data: { kind: 'custom' } },
        ],
        edges: [],
      },
      assets: {},
      refetch: () => Promise.resolve([]),
      acceptDoc: vi.fn(),
    };
    await renderPage();

    const card = flowProps.current.assetNodes.find((n: Node) => n.id === 'c1');
    await act(async () => {
      card.data.onGenerateImage();
    });
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    // 无目标节点：不展示附件区
    expect(container.textContent).not.toContain('故事文案');

    // 未落盘编辑 + 输入提示词后发送
    const text = flowProps.current.textNodes.find((n: Node) => n.id === 't1');
    await act(async () => {
      text.data.onTextChange('t1', '未落盘的编辑');
    });
    await typePrompt('画一只猫');
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const payload = apiMocks.createGenerationJob.mock.calls[0]![1];
    expect('target_node_id' in payload).toBe(false);
    expect(payload.parameters.prompt).toBe('画一只猫');
    // 旧链路行为不变：提交前不主动落盘（800ms 防抖尚未到点）
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
  });
});

/* IKDLQG 视频目标接线：视频节点面板附件展示、提交前保存串行化与 target_node_id 携带。
   BottomDialog 用真实实现验证附件区；视频节点 v1 由 seedVideoDoc 注入。 */
function seedVideoDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { title: '故事文案', text: '一只蓝鲸在海里' } },
        {
          id: 'v1',
          type: 'mediaNode',
          position: { x: 200, y: 0 },
          data: { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '目标视频', assetId: 'a9', jobId: 'j1', draftModelId: 'm-test', draftSize: '2k', draftRatio: '1:1' },
        },
      ],
      edges: [{ id: 'e1', source: 't1', target: 'v1' }],
    },
    assets: {
      a9: { asset_id: 9, type: 'video', access_url: 'http://vid/v1.mp4', width: 100, height: 100 },
    },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

describe('IKDLQG 视频目标接线', () => {
  it('从视频节点打开面板展示文本附件；提交先落盘当前编辑再携带 target_node_id', async () => {
    seedVideoDoc();
    await renderPage();

    const media = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1');
    await act(async () => {
      media.data.onGenVideo('v1');
    });

    // 面板打开即展示当前附件（IKFCKQ：FileText 缩略图进参考栏，标题在缩略图 title）
    await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="dock-text-ref"]')).toHaveLength(1));
    expect(container.querySelector('[data-testid="dock-text-ref"]')!.getAttribute('title')).toBe('故事文案');

    // 模型能力就位后，空提示词 + 非空附件正文即可发送（契约：附件可单独驱动生成）
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    expect(sendButton().disabled).toBe(false);

    // 制造一笔未防抖落盘的正文编辑
    const text = flowProps.current.textNodes.find((n: Node) => n.id === 't1');
    await act(async () => {
      text.data.onTextChange('t1', '一只蓝鲸在海里游');
    });

    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const [projectId, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(projectId).toBe('p1');
    expect(payload.type).toBe('video');
    expect(payload.target_node_id).toBe('v1');
    // 原位重新生成：视频节点自身不再作为参考素材（旧自由模式语义已随统一迁移退役）
    expect(payload.reference_asset_ids).toBeUndefined();
    // 音视频与图片同口径（!647）：无结构化正文时，连线文本节点的正文拼入 prompt
    expect(payload.parameters.prompt).toBe('一只蓝鲸在海里游');

    // 保存串行化：先落盘（含未防抖编辑与连线）再创建任务
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expect(apiMocks.saveCanvasDoc.mock.invocationCallOrder[0]!).toBeLessThan(
      apiMocks.createGenerationJob.mock.invocationCallOrder[0]!,
    );
    const saved = apiMocks.saveCanvasDoc.mock.calls[0]![1];
    expect(saved.nodes.find((n) => n.id === 't1')!.data.text).toBe('一只蓝鲸在海里游');
    expect(saved.edges).toHaveLength(1);
  });

  it('重新编辑入口同样携带目标节点与附件快照', async () => {
    seedVideoDoc();
    await renderPage();

    const media = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1');
    await act(async () => {
      media.data.onReEdit('v1');
    });

    await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="dock-text-ref"]')).toHaveLength(1));
    expect(container.querySelector('[data-testid="dock-text-ref"]')!.getAttribute('title')).toBe('故事文案');

    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const payload = apiMocks.createGenerationJob.mock.calls[0]![1];
    expect(payload.type).toBe('video');
    expect(payload.target_node_id).toBe('v1');
  });

  it('底部固定入口打开视频对话框：无附件区、空提示词禁用发送', async () => {
    seedVideoDoc();
    await renderPage();

    await act(async () => {
      toolbarProps.current.onToggleVideoDialog();
    });
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    // 无目标节点：不展示附件缩略图，空提示词保持发送禁用（无附件语义）
    expect(container.querySelector('[data-testid="dock-text-ref"]')).toBeNull();
    expect(sendButton().disabled).toBe(true);
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });
});

/* IKDLQH 多附件排序接线：面板重排回调 → 该目标文本附件边原地重排（其他边相对位置不变）→
   自动保存/提交前落盘上送新顺序。面板用真实 BottomDialog 实现。
   IKFCKN：图片面板旧「文本附件（N）」区块（含上移/下移）整体下线，图片面板排序用例随之移除。
   IKFCKQ：视频面板同样接入共享缩略图，上移/下移入口随独立区块下线，视频面板排序用例移除；
   排序能力的补位由 T5 拖拽排序切片承接。
   注：handleReorderAttachments 的「快照与连线不一致不重排」守卫仍在（服务防御），
   但现存 UI 已无该路径（两侧面板排序入口均已下线），待 T5 拖拽交互定稿时一并处置。 */


describe('IKDL9U review text input consistency', () => {
  it('shows a legacy HTML text attachment', async () => {
    const doc = canvasDocMock.current.doc as any;
    doc.nodes[0].data = { title: '旧文本', html: '<div>蓝鲸 &amp; 海</div><div>夜景</div>' };
    // IKFZ9W 起成品图不再是面板绑定目标，验证带附件的图片面板须走草稿卡
    doc.nodes.find((n: Node) => n.id === 'm1')!.data.draft = true;
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(flowProps.current.mediaNodes.find((n: Node) => n.id === 'm1'));
    });
    // IKFCKN：进栏后正文经悬停 200ms 预览展示（legacy HTML 先提取纯文本）
    const thumb = container.querySelector('[data-testid="dock-text-ref"]')!;
    await act(async () => {
      thumb.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    });
    await act(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 250); });
    });
    const previewText = document.querySelector('[data-testid="ref-thumb-preview"]')?.textContent ?? '';
    expect(previewText).toContain('蓝鲸 & 海');
    expect(previewText).toContain('夜景');
  });
  it('pauses autosave for invalid drafts and resumes after correction', async () => {
    // 新连线只允许进入生成节点；普通成品图不再是合法目标。
    const doc = canvasDocMock.current.doc as { nodes: Node[] };
    doc.nodes.find((n) => n.id === 'm1')!.data.draft = true;
    await renderPage();
    await act(async () => {
      flowProps.current.textNodes[0].data.onDraftError('t1', '正文超限');
      // 连线目标须为草稿节点（m1 为成品卡不再接受新连线）
      flowProps.current.onConnect({ source: 't2', target: 'd1', sourceHandle: null, targetHandle: null });
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
    await act(async () => flowProps.current.textNodes[0].data.onDraftError('t1', ''));
    await vi.waitFor(() => expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });
  it('blocks quoting an invalid draft instead of quoting the previous saved text', async () => {
    await renderPage();
    await act(async () => {
      flowProps.current.textNodes[0].data.onDraftError('t1', '正文超限');
      flowProps.current.textNodes[0].data.onAddToChat('t1');
    });
    expect(apiMocks.createConversationQuote).not.toHaveBeenCalled();
    expect(container.textContent).toContain('正文超限');
  });
  it('blocks generation while a connected text has an invalid draft', async () => {
    // IKFZ9W 起成品图不再是面板绑定目标，验证带附件的图片面板须走草稿卡
    (canvasDocMock.current.doc as { nodes: Node[] }).nodes.find((n) => n.id === 'm1')!.data.draft = true;
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(flowProps.current.mediaNodes.find((n: Node) => n.id === 'm1'));
    });
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await act(async () => flowProps.current.textNodes[0].data.onDraftError?.('t1', '正文超限'));
    await act(async () => sendButton().click());
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    // 草稿卡绑定模式下，无效草稿经保存失败通道直接锁住发送（按钮不可用 + 面板「保存失败，请重试」），
    // 与旧成品图入口「点击后再弹正文超限」的呈现不同；拦截本身两种入口一致
    expect(sendButton().disabled).toBe(true);
  });
});

describe('IKFCKT 参考栏拖拽换位', () => {
  /** jsdom 无 DragEvent 且 rect 恒 0：手工挂 dataTransfer / clientX，rect mock 出前半落点 */
  function dragEvent(type: 'dragstart' | 'dragover' | 'drop', clientX: number) {
    const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
      dataTransfer: { setData: () => void; effectAllowed: string; dropEffect: string };
      clientX: number;
    };
    event.dataTransfer = { setData: () => {}, effectAllowed: '', dropEffect: '' };
    event.clientX = clientX;
    return event;
  }

  it('混排保存至目标草稿并在关闭重开及画布重新挂载后恢复', async () => {
    const doc = canvasDocMock.current.doc as { nodes: Node[]; edges: Array<{ id: string; source: string; target: string }> };
    doc.edges.push({ id: 'media-edge', source: 'm1', target: 'd1' }, { id: 'text-edge', source: 't1', target: 'd1' }, { id: 'text-edge2', source: 't2', target: 'd1' });
    await renderPage();
    const open = async () => {
      await act(async () => flowProps.current.onNodeClick(flowProps.current.mediaNodes.find((n: Node) => n.id === 'd1')));
      await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="dock-media-ref"]')).toHaveLength(1));
    };
    await open();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100, right: 100, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const text = container.querySelector('[data-testid="dock-text-ref"]')!;
    const media = container.querySelector('[data-testid="dock-media-ref"]')!;
    await act(async () => text.dispatchEvent(dragEvent('dragstart', 0)));
    await act(async () => media.dispatchEvent(dragEvent('drop', 10)));
    const order = () => [...container.querySelectorAll('[data-testid="dock-media-ref"], [data-testid="dock-text-ref"]')].map(el => el.getAttribute('title'));
    expect(order()).toEqual(['故事文案', '目标图', '配色参考']);
    const text2 = container.querySelectorAll('[data-testid="dock-text-ref"]')[1]!;
    await act(async () => text2.dispatchEvent(dragEvent('dragstart', 0)));
    await act(async () => text.dispatchEvent(dragEvent('drop', 10)));
    expect(order()).toEqual(['配色参考', '故事文案', '目标图']);
    expect([...container.querySelectorAll('[data-testid="dock-text-ref"] [data-testid="ref-thumb-badge"]')].map(el => el.textContent)).toEqual(['1', '2']);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1200)); });
    const payload = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
    expect(payload.nodes.find(n => n.id === 'd1')!.data.referenceStripOrder).toEqual(['text:t2', 'text:t1', 'media:node:m1']);
    expect(payload.edges.filter(e => e.target === 'd1').map(e => e.source)).toEqual(['t2', 't1', 'm1']);
    await act(async () => container.querySelector<HTMLButtonElement>('button[title="关闭"]')!.click());
    await open();
    expect(order()).toEqual(['配色参考', '故事文案', '目标图']);
    await act(async () => root.unmount());
    container.remove();
    canvasDocMock.current.doc = { ...doc, ...payload, id: 11, version: 4 };
    await renderPage();
    await open();
    expect(order()).toEqual(['配色参考', '故事文案', '目标图']);
  });

  it('图片面板拖拽文本附件换位：边序重排随自动保存上送（拼接顺序随之），角标与新序联动', async () => {
    // 追加第二条文本连线：附件顺序 = 连入边序 [t1, t2]
    const doc = canvasDocMock.current.doc as { nodes: Node[]; edges: Array<{ id: string; source: string; target: string }> };
    doc.edges.push({ id: 'e2', source: 't2', target: 'm1' });
    // IKFZ9W 起成品图不再是面板绑定目标，验证带附件的图片面板须走草稿卡
    doc.nodes.find((n) => n.id === 'm1')!.data.draft = true;
    await renderPage();

    await act(async () => {
      flowProps.current.onNodeClick(flowProps.current.mediaNodes.find((n: Node) => n.id === 'm1'));
    });

    await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="dock-text-ref"]')).toHaveLength(2));
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    const titles = () =>
      [...container.querySelectorAll('[data-testid="dock-text-ref"]')].map((el) => el.getAttribute('title'));
    expect(titles()).toEqual(['故事文案', '配色参考']);

    // 拖拽换位：「配色参考」（t2）拖到「故事文案」（t1）前半
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, width: 100, right: 100, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect);
    const thumbs = [...container.querySelectorAll('[data-testid="dock-text-ref"]')];
    await act(async () => { thumbs[1]!.dispatchEvent(dragEvent('dragstart', 0)); });
    await act(async () => { thumbs[0]!.dispatchEvent(dragEvent('dragover', 10)); });
    await act(async () => { thumbs[0]!.dispatchEvent(dragEvent('drop', 10)); });

    // 面板附件与新序联动（角标按新序紧凑重派生）
    await vi.waitFor(() => expect(titles()).toEqual(['配色参考', '故事文案']));

    // 边序重排随自动保存上送：t2 连线排在 t1 前（服务端按连线序推导 text_attachments，拼接顺序随之）
    await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalled();
    const payload = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
    const sources = (payload.edges as Array<{ source: string; target: string }>)
      .filter((e) => e.target === 'm1')
      .map((e) => e.source);
    expect(sources).toEqual(['t2', 't1']);
  });
});

describe('IKFCJG 跨来源视频参考提交顺序', () => {
  it('material 拖到画布图片前后，编号与请求 references 使用相同顺序', async () => {
    seedVideoDoc();
    const doc = canvasDocMock.current.doc as { nodes: Node[]; edges: Array<Record<string, string>> };
    Object.assign(doc.nodes.find(n => n.id === 'v1')!.data, {
      src: '', draft: true, genStatus: 'draft', draftMode: 'all', prompt: '组合图片1和图片2',
      draftMaterialRefs: [{ materialId: 'asset-lib1', url: 'http://img/lib.png', name: '角色立绘', mediaType: 'image', role: 'reference' }],
      promptDoc: { version: 1, flat: '组合图片1和图片2', segments: [
        { kind: 'text', text: '组合' }, { kind: 'asset_ref', asset_id: '101', label: '图片1' },
        { kind: 'text', text: '和' }, { kind: 'asset_ref', asset_id: 'asset-lib1', label: '图片2' },
      ] },
    });
    doc.nodes.push({ id: 'source-image', type: 'mediaNode', position: { x: 0, y: 200 }, data: { src: 'http://img/101.png', mediaType: 'image', assetId: '101', fileName: '画布图片' } });
    doc.edges.push({ id: 'image-video', source: 'source-image', target: 'v1', role: 'reference' });
    canvasDocMock.current.assets['101'] = { asset_id: 101, type: 'image', access_url: 'http://img/101.png', width: 100, height: 100 };
    const models = await apiMocks.fetchGenerationModels();
    apiMocks.fetchGenerationModels.mockResolvedValueOnce(models.map(model => ({ ...model, features: { reference_image: true, max_reference_images: 9 } })));
    await renderPage();
    await act(async () => flowProps.current.onNodeClick(flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')));
    await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="dock-video-ref"]')).toHaveLength(2));
    await vi.waitFor(() => expect(sendButton()?.disabled).toBe(false));
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100, right: 100, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const drag = (type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { dataTransfer: { setData: () => {}, effectAllowed: '', dropEffect: '' }, clientX: 10 });
      return event;
    };
    try {
      const thumbs = [...container.querySelectorAll('[data-testid="dock-video-ref"]')];
      await act(async () => thumbs[1]!.dispatchEvent(drag('dragstart')));
      await act(async () => thumbs[0]!.dispatchEvent(drag('drop')));
      expect([...container.querySelectorAll('[data-testid="dock-video-ref"]')].map(el => el.getAttribute('title'))).toEqual(['角色立绘', '画布图片']);
      expect([...container.querySelectorAll('[data-testid="dock-video-ref"] [data-testid="ref-thumb-badge"]')].map(el => el.textContent)).toEqual(['1', '2']);
      await act(async () => sendButton().click());
      await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
      const payload = apiMocks.createGenerationJob.mock.calls[0]![1];
      // !718：角色库来源保持 material_id；画布图片不再上传换 materialId，按本地 asset_id 提交（顺序与编号一致）
      expect(payload.references).toEqual([{ material_id: 'asset-lib1', type: 'image', role: 'reference' }, { asset_id: '101', type: 'image', role: 'reference' }]);
      // !723：图片标签写素材 id（&素材id& 形态）、正文直连；!722：prompt_doc 退役不再上送（IKGJT2/IKGJT5 行为）
      expect(payload.parameters.prompt).toBe('一只蓝鲸在海里组合&101&和&asset-lib1&');
    } finally {
      rect.mockRestore();
    }
  });
});
