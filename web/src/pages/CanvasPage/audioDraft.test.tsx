// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { typePromptRefText, readPromptRefText, promptRefReadOnly } from './testing/promptRefEditor';

/* IKDMQT 音频生成草稿：侧栏建卡 / 重复创建 / 参数写回与水合恢复 / 原位提交回填 /
   生成中只读（面板 + 连线）/ 保存失败阻断生成 / 401 回退与失败保留。
   FlowCanvas/CanvasToolbar/CanvasHeader 打桩透出 props；AudioDialog 用真实实现（原生 textarea）。 */

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

/** CanvasToolbar 打桩：透出侧栏音频入口 */
const toolbarProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/CanvasToolbar', () => ({
  default: (props: Record<string, any>) => {
    toolbarProps.current = props;
    return createElement('div', { 'data-testid': 'canvas-toolbar' });
  },
}));

/** CanvasHeader 打桩：透出项目切换入口与当前项目 id */
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

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [
    { id: 'p1', name: '项目一' },
    { id: 'p2', name: '项目二' },
  ]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchMe: vi.fn(async () => null),
  fetchQuota: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  applyPromptPreview: vi.fn(),
  referencePromptPlan: vi.fn(async () => ({ id: 11, version: 5, viewport: '{}', nodes: '[]', edges: '[]' })),
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
    asset: { id: 'a2', url: 'http://audio/out.mp3', type: 'audio', duration: 30 },
  })),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async () => [
    {
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
    },
    {
      model_id: 'a-test-2',
      provider_id: 'prov',
      model_label: '测试音频模型二',
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
    },
  ]),
}));

vi.mock('@/api/projects', () => ({
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
  touchProjectLastOpened: apiMocks.touchProjectLastOpened,
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
  referencePromptPlan: apiMocks.referencePromptPlan,
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
  createVideoEnhancement: apiMocks.createVideoEnhancement,
  createMediaExtraction: apiMocks.createMediaExtraction,
  createAudioTrim: apiMocks.createAudioTrim,
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

/** 默认画布文档：文本节点 t1 + 成品图片节点 m1 */
function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { title: '故事文案', text: '一只蓝鲸在海里' } },
        {
          id: 'm1',
          type: 'mediaNode',
          position: { x: 200, y: 0 },
          data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '目标图', assetId: 'a1' },
        },
      ],
      edges: [],
    },
    assets: {
      a1: { asset_id: 1, type: 'image', access_url: 'http://img/m1.png', width: 100, height: 100 },
    },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

/** 含已保存音频草稿 d1 的画布文档（IKDMQT 参数集：prompt + draftModelId） */
function seedDraftDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { title: '故事文案', text: '一只蓝鲸在海里' } },
        {
          id: 'd1',
          type: 'mediaNode',
          position: { x: 420, y: 160 },
          data: {
            src: '',
            mediaType: 'audio',
            fileName: '音频草稿',
            genStatus: 'draft',
            draft: true,
            prompt: '恢复的描述',
            draftModelId: 'a-test',
          },
        },
      ],
      edges: [],
    },
    assets: {},
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

/** 含空白音频草稿 d1 的画布文档（无参数无连线）：绑定面板默认参数落值与提交链路的测试基线 */
function seedEmptyDraftDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { title: '故事文案', text: '一只蓝鲸在海里' } },
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
          data: { src: '', mediaType: 'audio', fileName: '音频草稿', genStatus: 'draft', draft: true, prompt: '' },
        },
      ],
      edges: [],
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
  return container.querySelector<HTMLButtonElement>('[data-testid="audio-send"]')!;
}

function promptTextarea(): HTMLTextAreaElement {
  return container.querySelector<HTMLTextAreaElement>('[data-testid="audio-input"]')!;
}

/** React 受控 textarea 赋值 */
async function typePrompt(text: string) { await typePromptRefText(container, text); }

/** 点击侧栏音频入口后，画布上最新加入的音频草稿节点 */
function draftNodes(): Node[] {
  return flowProps.current.mediaNodes.filter(
    (n: Node) => n.data?.draft === true && n.data?.mediaType === 'audio',
  );
}

async function clickSidebarAudio() {
  await act(async () => {
    toolbarProps.current.onToggleAudioDialog();
  });
}

/** 点击画布草稿卡 d1 打开绑定面板（草稿绑定路径），返回草稿节点 id */
async function openDraftPanel(): Promise<string> {
  const draft = flowProps.current.mediaNodes.find((n: Node) => n.id === 'd1')!;
  await act(async () => {
    flowProps.current.onNodeClick(draft);
  });
  return 'd1';
}

/** 等待音频模型能力加载完成（发送前置条件） */
async function waitModelReady() {
  await vi.waitFor(() => expect(container.textContent).toContain('测试音频模型'), { timeout: 3000 });
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

describe('IKDMQT 音频草稿创建与编辑', () => {
  it('侧栏音频入口先建草稿卡再开绑定面板：不创建任务（1f2f498d 起入口统一建卡）', async () => {
    await renderPage();
    const before = flowProps.current.mediaNodes.length;

    await clickSidebarAudio();

    // 工具栏入口先建音频草稿卡再打开跟随输入框
    expect(flowProps.current.mediaNodes).toHaveLength(before + 1);
    expect(draftNodes()).toHaveLength(1);
    // 仅点击入口不创建任务
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    // 面板打开（模型能力加载后空描述时发送禁用）
    expect(promptTextarea()).toBeTruthy();
    await waitModelReady();
    expect(sendButton().disabled).toBe(true);
  });

  it('侧栏入口发送：绑定新建草稿卡生成（带 target_node_id），不另落生成卡', async () => {
    await renderPage();
    await clickSidebarAudio();
    await waitModelReady();
    await typePrompt('自由模式音效');

    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.type).toBe('audio');
    // 发送绑定入口新建的草稿卡，在原卡生成
    expect(typeof payload.target_node_id).toBe('string');
    expect(payload.parameters.prompt).toBe('自由模式音效');
    expect(payload.parameters.model_id).toBe('a-test');
    // seed m1 + 入口建的 1 张草稿卡；生成发生在原卡，不新增节点
    expect(flowProps.current.mediaNodes).toHaveLength(2);
    // IKFXZD：创建请求发出即隐藏面板（提交前校验/落盘/上传失败则保持打开）
    expect(container.querySelector('[data-testid="audio-input"]')).toBeNull();
  });

  it('连续点击侧栏入口：每次新建草稿卡，面板保持打开', async () => {
    await renderPage();

    await clickSidebarAudio();
    await clickSidebarAudio();

    expect(flowProps.current.mediaNodes).toHaveLength(3); // seed m1 + 两次点击各建一张
    expect(draftNodes()).toHaveLength(2);
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    expect(promptTextarea()).toBeTruthy();
  });

  it('面板编辑实时写回草稿节点（描述与模型）；参数随自动保存落盘', async () => {
    seedEmptyDraftDoc();
    await renderPage();
    const draftId = await openDraftPanel();

    await waitModelReady();
    await typePrompt('轻快的海浪声');

    const draft = () => flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!;
    await vi.waitFor(() => expect(draft().data.prompt).toBe('轻快的海浪声'));
    // 模型默认选中第一个并写回
    expect(draft().data.draftModelId).toBe('a-test');

    // 切换第二个模型：draftModelId 跟随写回
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.includes('测试音频模型'))!
        .click();
    });
    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent === '测试音频模型二')!
        .click();
    });
    expect(draft().data.draftModelId).toBe('a-test-2');

    // 参数随自动保存落盘
    await vi.waitFor(
      () => {
        const last = apiMocks.saveCanvasDoc.mock.calls.at(-1);
        expect(last).toBeTruthy();
        const saved = last![1].nodes.find((n) => n.id === draftId)!;
        expect(saved.data.prompt).toBe('轻快的海浪声');
        expect(saved.data.draftModelId).toBe('a-test-2');
      },
      { timeout: 3000 },
    );
  });

  it('水合恢复音频草稿：不标素材缺失；点击草稿卡重开面板恢复描述与模型', async () => {
    seedDraftDoc();
    await renderPage();

    const draft = flowProps.current.mediaNodes.find((n: Node) => n.id === 'd1')!;
    expect(draft.data.genStatus).toBe('draft');
    expect(draft.data.assetMissing).toBeUndefined();

    await act(async () => {
      flowProps.current.onNodeClick(draft);
    });

    // 描述与模型按草稿参数恢复（草稿带入的 a-test 优先于列表默认）
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('恢复的描述'));
    await vi.waitFor(() => expect(container.textContent).toContain('测试音频模型'));
    // 音频面板无文本附件区（音频草稿不消费文本连线）
    expect(container.textContent).not.toContain('文本附件');
  });
});

describe('IKDMQT 原位提交与首次生成', () => {
  it('点击生成才提交：先落盘后建任务、携带 target_node_id、节点数不变、成功回填同一张卡', async () => {
    seedEmptyDraftDoc();
    await renderPage();
    const draftId = await openDraftPanel();
    const positionBefore = { ...flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!.position };

    await waitModelReady();
    await typePrompt('轻快的海浪声');
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const [projectId, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(projectId).toBe('p1');
    expect(payload.type).toBe('audio');
    expect(payload.target_node_id).toBe(draftId);
    expect(payload.parameters.prompt).toBe('轻快的海浪声');
    expect(payload.parameters.model_id).toBe('a-test');
    // 音频无参考素材字段
    expect(payload.input_asset_ids).toBeUndefined();
    expect(payload.reference_asset_ids).toBeUndefined();

    // 保存串行化：先落盘再创建任务
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalled();
    expect(apiMocks.saveCanvasDoc.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      apiMocks.createGenerationJob.mock.invocationCallOrder[0]!,
    );

    // 原位生成：不新建 media-gen 占位卡（节点数不变）
    expect(flowProps.current.mediaNodes).toHaveLength(2);

    // 成功结果填回同一张卡：身份、位置不变，草稿标记清除
    await vi.waitFor(() => {
      const node = flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!;
      expect(node.data.genStatus).toBeUndefined();
    });
    const done = flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!;
    expect(flowProps.current.mediaNodes).toHaveLength(2);
    expect(done.position).toEqual(positionBefore);
    expect(done.data.src).toBe('http://audio/out.mp3');
    expect(done.data.assetId).toBe('a2');
    expect(done.data.draft).toBeUndefined();
  });

  it('生成中只读：面板禁用编辑与发送；连线建立与删除被拦截', async () => {
    apiMocks.fetchJobStatus.mockImplementation(async (): Promise<any> => ({
      job_id: 'j1',
      status: 'processing',
      progress: 10,
      asset: null,
    }));
    seedEmptyDraftDoc();
    // 预置连线：connectPair 要求 genKindOf 非空且 ABILITY 匹配（单源 text/image 均无法连入 audio 草稿），
    // 因此直接在文档中预置连线，测试重点在于生成中删除被拦截。
    (canvasDocMock.current.doc as { edges: Array<{ id: string; source: string; target: string }> }).edges = [
      { id: 'e-seed', source: 't1', target: 'd1' },
    ];
    await renderPage();
    const draftId = await openDraftPanel();

    expect(flowProps.current.edges.some((e: { source: string; target: string }) => e.source === 't1' && e.target === draftId)).toBe(true);
    const draftEdgeId = flowProps.current.edges.find((e: { source: string; target: string }) => e.target === draftId)!.id;

    await waitModelReady();
    await typePrompt('轻快的海浪声');
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => {
      const node = flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!;
      expect(node.data.genStatus).toBe('generating');
    });

    // IKFXZD：发送成功即隐藏面板
    expect(container.querySelector('[data-testid="audio-input"]')).toBeNull();

    // 生成中点卡片重开只读面板（IKFXZD 口径：自动关闭不动只读入口）：描述输入与发送禁用，提示可见
    await openDraftPanel();
    expect(promptRefReadOnly(container)).toBe(true);
    expect(sendButton().disabled).toBe(true);
    expect(container.textContent).toContain('生成中，参数只读');

    // 向生成中节点新建连线被拦截
    await act(async () => {
      flowProps.current.onConnect({ source: 'm1', target: draftId, sourceHandle: null, targetHandle: null });
    });
    expect(flowProps.current.edges.some((e: { source: string; target: string }) => e.source === 'm1' && e.target === draftId)).toBe(false);

    // 删除生成中节点的入边被拦截
    await act(async () => {
      flowProps.current.onEdgesChange([{ type: 'remove', id: draftEdgeId }]);
    });
    expect(flowProps.current.edges.some((e: { id: string }) => e.id === draftEdgeId)).toBe(true);
    expect(container.textContent).toContain('生成中，输入连线只读');
  });

  it('建任务 401：草稿回退待生成（标题恢复「音频草稿」），卡片与参数保留', async () => {
    const { ApiError } = await import('@/api/http');
    apiMocks.createGenerationJob.mockRejectedValueOnce(new ApiError(401, '未登录'));
    seedEmptyDraftDoc();
    await renderPage();
    const draftId = await openDraftPanel();

    await waitModelReady();
    await typePrompt('轻快的海浪声');
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => {
      const node = flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!;
      expect(node.data.genStatus).toBe('draft');
    });
    const back = flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!;
    expect(back.data.fileName).toBe('音频草稿');
    expect(back.data.draft).toBe(true);
    expect(back.data.prompt).toBe('轻快的海浪声');
    expect(flowProps.current.mediaNodes).toHaveLength(2);
  });

  it('建任务 402（配额耗尽）：草稿回退待生成（标题恢复「音频草稿」），卡片与参数保留', async () => {
    const { ApiError } = await import('@/api/http');
    apiMocks.createGenerationJob.mockRejectedValueOnce(new ApiError(402, '积分不足'));
    seedEmptyDraftDoc();
    await renderPage();
    const draftId = await openDraftPanel();

    await waitModelReady();
    await typePrompt('轻快的海浪声');
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => {
      const node = flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!;
      expect(node.data.genStatus).toBe('draft');
    });
    const back = flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!;
    expect(back.data.fileName).toBe('音频草稿');
    expect(back.data.draft).toBe(true);
    expect(back.data.prompt).toBe('轻快的海浪声');
    expect(flowProps.current.mediaNodes).toHaveLength(2);
  });

  it('任务失败：卡片、参数与原因保留，点击可重开面板继续编辑', async () => {
    apiMocks.fetchJobStatus.mockImplementation(async (): Promise<any> => ({
      job_id: 'j1',
      status: 'failed',
      progress: 100,
      asset: null,
      error: { msg: '供应商超时' },
    }));
    seedEmptyDraftDoc();
    await renderPage();
    const draftId = await openDraftPanel();

    await waitModelReady();
    await typePrompt('轻快的海浪声');
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => {
      const node = flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!;
      expect(node.data.genStatus).toBe('failed');
    });
    const failed = flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!;
    expect(failed.data.errorText).toBe('供应商超时');
    expect(failed.data.draft).toBe(true);
    expect(failed.data.prompt).toBe('轻快的海浪声');
    expect(flowProps.current.mediaNodes).toHaveLength(2);

    // 失败卡可重开面板（非只读）
    await act(async () => {
      flowProps.current.onNodeClick(failed);
    });
    expect(promptRefReadOnly(container)).toBe(false);
  });
});

describe('IKDMQT 保存失败暂停生成', () => {
  it('落盘失败中止提交并保留草稿：提示保存失败、不创建任务', async () => {
    seedEmptyDraftDoc();
    await renderPage();
    const draftId = await openDraftPanel();

    await waitModelReady();
    await typePrompt('轻快的海浪声');

    // 保存持续失败：提交被阻断、不创建任务、草稿不回滚
    apiMocks.saveCanvasDoc.mockImplementation(() => Promise.reject(new Error('boom')));
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(container.textContent).toContain('保存失败，请重试'));
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();

    const draft = flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!;
    expect(draft.data.draft).toBe(true);
    expect(draft.data.genStatus).toBe('draft');
    expect(draft.data.prompt).toBe('轻快的海浪声');
    // IKFXZD：失败分支面板保持打开（成功才关）
    expect(promptTextarea()).toBeTruthy();
  });
});

describe('IKFCXE 音频文本附件：到节点选择文本卡建连线', () => {
  /** 经音频面板真实入口进入画布选择模式（IKGB82：操作条「+ 参考」pill 直达，旧「+」菜单两步已退役） */
  async function enterCanvasPick() {
    await vi.waitFor(() => {
      const btn = [...container.querySelectorAll('button')].find((b) => (b.title ?? '') === '从节点添加素材');
      expect(btn).toBeTruthy();
    });
    await act(async () => {
      [...container.querySelectorAll('button')].find((b) => (b.title ?? '') === '从节点添加素材')!.click();
    });
  }

  it('pickMode 音频下点击文本卡 → 建立来源→草稿连线（与画布拖线同一本地建边；普通卡与方案卡均可）', async () => {
    // 前序用例可能将 saveCanvasDoc 改为 reject（clearAllMocks 不重置实现），恢复成功落盘
    apiMocks.saveCanvasDoc.mockImplementation(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' }));
    seedEmptyDraftDoc();
    await renderPage();
    await openDraftPanel();

    await enterCanvasPick();

    // 点击普通文本卡（无 promptSource；音频建线准入与拖线一致，不限方案卡）
    const textNode = (canvasDocMock.current.doc as { nodes: Node[] }).nodes.find((n) => n.id === 't1')!;
    await act(async () => {
      flowProps.current.onNodeClick(textNode);
    });

    // 与画布拖线同款本地建边（addCanvasEdge，自动保存持久）；不走 referencePromptPlan
    //（该服务端链路仅放行图片/视频目标）
    await vi.waitFor(() => {
      expect(flowProps.current.edges.some((e: { id: string; source: string; target: string }) =>
        e.id === 'e-t1-d1' && e.source === 't1' && e.target === 'd1')).toBe(true);
    });
    expect(apiMocks.referencePromptPlan).not.toHaveBeenCalled();
  });

  it('重复选择同一文本卡只保留一条连线（去重）', async () => {
    apiMocks.saveCanvasDoc.mockImplementation(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' }));
    seedEmptyDraftDoc();
    await renderPage();
    await openDraftPanel();

    await enterCanvasPick();
    const textNode = (canvasDocMock.current.doc as { nodes: Node[] }).nodes.find((n) => n.id === 't1')!;
    await act(async () => {
      flowProps.current.onNodeClick(textNode);
    });
    await vi.waitFor(() => {
      expect(flowProps.current.edges.filter((e: { source: string; target: string }) => e.source === 't1' && e.target === 'd1')).toHaveLength(1);
    });

    // 重新进入选择模式再选同一文本卡：addCanvasEdge 同源去重，连线数量不变
    await enterCanvasPick();
    await act(async () => {
      flowProps.current.onNodeClick(textNode);
    });
    expect(flowProps.current.edges.filter((e: { source: string; target: string }) => e.source === 't1' && e.target === 'd1')).toHaveLength(1);
  });
});

 describe('IKFCJG 音频草稿结构', () => {
  it('正文结构与拍平镜像随草稿一起保存', async () => {
    seedDraftDoc();
    await renderPage();
    await openDraftPanel();
    await waitModelReady();
    await typePrompt('生成声音');
    expect(flowProps.current.mediaNodes.find((n: Node) => n.id === 'd1').data.promptDoc).toMatchObject({ version: 1, flat: '生成声音' });
  });
});

 describe('IKFCJG 恢复音频引用请求', () => {
  it('结构与音频参考恢复后携带真实 references 和 prompt_doc（IKFDFZ：存量 audioRefs 打开时迁移为连线）', async () => {
    seedDraftDoc();
    // 存量 audioRefs 的画布项须有对应画布来源节点（迁移按节点 id 找回来源建线）
    (canvasDocMock.current.doc as { nodes: Node[] }).nodes.push({
      id: 'r1', type: 'mediaNode', position: { x: 100, y: 0 },
      data: { src: 'https://x/a.mp3', mediaType: 'audio', fileName: '雨声', assetId: '601' },
    });
    canvasDocMock.current.assets = { '601': { asset_id: 601, type: 'audio', access_url: 'https://x/a.mp3' } };
    const draft = (canvasDocMock.current.doc as { nodes: Node[] }).nodes.find((n: Node) => n.id === 'd1')!;
    Object.assign(draft.data, {
      prompt: '音频1',
      audioRefs: [{ id: 'r1', source: 'canvas', assetId: '601', kind: 'audio', name: '雨声', src: 'https://x/a.mp3' }],
      promptDoc: { version: 1, flat: '音频1', segments: [{ kind: 'asset_ref', asset_id: '601', label: '音频1' }] },
    });
    await renderPage(); await openDraftPanel(); await waitModelReady();
    expect(readPromptRefText(container)).toBe('音频1');
    await vi.waitFor(() => expect(container.querySelector('[data-testid="audio-ref-thumb"]')!.getAttribute('title')).toBe('雨声'));
    await act(async () => sendButton().click());
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    // !722：prompt_doc 退役，payload 不再携带；音频引用以 references 提交（IKGJT2 行为）
    expect(apiMocks.createGenerationJob.mock.calls[0][1]).toMatchObject({
      references: [{ role: 'reference', asset_id: '601', type: 'audio' }],
    });
  });
});

 describe('IKFCJG 音频引用删除恢复', () => {
  it('删除刚选中的音频再重开面板，不回放旧 externalPick', async () => {
    seedEmptyDraftDoc();
    const node = (canvasDocMock.current.doc as { nodes: Node[] }).nodes.find(n => n.id === 'm1')!;
    Object.assign(node.data, { mediaType: 'audio', src: 'http://audio/a.mp3', assetId: '601', fileName: '雨声' });
    canvasDocMock.current.assets = { '601': { asset_id: 601, type: 'audio', access_url: 'http://audio/a.mp3' } };
    await renderPage(); await openDraftPanel(); await waitModelReady();
    // IKGB82：操作条「+ 参考」pill 直达（等价旧菜单项「从节点添加素材」）
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.title === '从节点添加素材')!.click());
    await act(async () => flowProps.current.onNodeClick(flowProps.current.mediaNodes.find((n: Node) => n.id === 'm1')));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="audio-ref-thumb"]')).not.toBeNull());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="移除 雨声"]')!.click());
    expect(container.querySelector('[data-testid="audio-ref-thumb"]')).toBeNull();
    await openDraftPanel();
    expect(container.querySelector('[data-testid="audio-ref-thumb"]')).toBeNull();
  });
});
