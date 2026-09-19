// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { readPromptRefText, typePromptRefText } from './testing/promptRefEditor';

/* IKDMQV 失败重试与修改后重新生成：
   双路径严格区分——节点「重试」按钮走 retryGenerationJob（沿用失败任务冻结快照，
   不读画布不落盘）；面板修改参数后「发送」走 createGenerationJob（按现行规则冻结新输入，
   原位承接不新建卡）。重试防重入：generating 态再次触发直接忽略。
   保存失败保护沿用 flushCanvasSave 串行化（IKDMQQ），失败卡重新生成路径同样受保护。
   FlowCanvas/CanvasToolbar/CanvasHeader 打桩透出 props；ImageDialog 用真实实现。 */

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
  fetchMe: vi.fn(async () => null),
  fetchQuota: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  saveCanvasDoc: vi.fn(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  createGenerationJob: vi.fn(async (_projectId: string, _body: Record<string, unknown>) => ({ generation_job_id: 'j8', cursor: 1 })),
  fetchJobStatus: vi.fn(async () => ({
    job_id: 'j9',
    status: 'succeeded',
    progress: 100,
    asset: { id: 'a9', url: 'http://img/out.png', type: 'image' },
  })),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(async (_projectId: string, _jobId: number | string) => ({ generation_job_id: 'j9', cursor: 2 })),
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
      features: {},
      version: 1,
      digest: '',
    },
  ]),
}));

vi.mock('@/api/projects', () => ({
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchProjects: apiMocks.fetchProjects,
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
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

/** 默认画布：失败草稿卡 f1（首生成失败，参数与身份保留）+ 失败成品卡 g1（重新生成失败，旧素材保留） */
function seedFailureDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'f1',
          type: 'mediaNode',
          position: { x: 0, y: 0 },
          data: {
            src: '',
            mediaType: 'image',
            fileName: '图片生成中',
            genStatus: 'failed',
            draft: true,
            jobId: 'j1',
            errorText: '上游生成失败',
            prompt: '原提示词',
            draftModelId: 'm-test',
            draftSize: '2k',
            draftRatio: '1:1',
          },
        },
        {
          id: 'g1',
          type: 'mediaNode',
          position: { x: 360, y: 0 },
          data: {
            src: 'http://img/g1.png',
            mediaType: 'image',
            fileName: '生成-j1',
            assetId: 'a1',
            jobId: 'j1',
            genStatus: 'failed',
            errorText: '上游生成失败',
            prompt: '成品提示词',
            draftModelId: 'm-test',
            draftSize: '2k',
            draftRatio: '1:1',
          },
        },
      ],
      edges: [],
    },
    assets: {
      a1: { asset_id: 1, type: 'image', access_url: 'http://img/g1.png', width: 100, height: 100 },
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

function nodeOf(id: string): Node {
  return flowProps.current.mediaNodes.find((n: Node) => n.id === id)!;
}

async function clickNode(id: string) {
  await act(async () => {
    flowProps.current.onNodeClick(nodeOf(id));
  });
}

/** 触发节点「重试」（MediaNode 失败角标/占位按钮的真实回调，经 attachCallbacks 注入） */
async function clickRetry(id: string) {
  await act(async () => {
    const onRetryJob = (nodeOf(id).data as Record<string, unknown>).onRetryJob as (id: string) => void;
    onRetryJob(id);
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedFailureDoc();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('IKDMQV 直接重试：沿用失败任务冻结快照', () => {
  it('失败草稿卡点重试走 retry 接口（不读画布不落盘不建新任务），原卡承接新结果', async () => {
    await renderPage();

    await clickRetry('f1');

    // retry 以原任务 id 调用；create（修改后新生成路径）不被触碰；保存也不发生（快照冻结，无需落盘）
    expect(apiMocks.retryGenerationJob).toHaveBeenCalledTimes(1);
    expect(apiMocks.retryGenerationJob).toHaveBeenCalledWith('p1', 'j1');
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();

    // 原卡承接：同一张卡转成品（draft 清除、jobId 更新、成功结果回填），节点数不变
    await vi.waitFor(() => expect(nodeOf('f1').data.src).toBe('http://img/out.png'));
    const node = nodeOf('f1');
    expect(node.data.draft).toBeUndefined();
    expect(node.data.genStatus).toBeUndefined();
    expect(node.data.jobId).toBe('j9');
    expect(node.data.errorText).toBeUndefined();
    expect(flowProps.current.mediaNodes).toHaveLength(2);
  });

  it('重试防重入：生成中再次触发重试被直接忽略', async () => {
    let resolveRetry: (value: { generation_job_id: string; cursor: number }) => void = () => {};
    apiMocks.retryGenerationJob.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRetry = resolve; }),
    );
    await renderPage();

    await clickRetry('f1');
    await vi.waitFor(() => expect(nodeOf('f1').data.genStatus).toBe('generating'));

    // retry 请求飞行中（generating 态）再次点重试：不发第二次 retry
    await clickRetry('f1');
    expect(apiMocks.retryGenerationJob).toHaveBeenCalledTimes(1);

    await act(async () => { resolveRetry({ generation_job_id: 'j9', cursor: 2 }); });
    await vi.waitFor(() => expect(nodeOf('f1').data.src).toBe('http://img/out.png'));
  });

  it('失败成品卡点重试同样原位承接，旧素材被新结果替换', async () => {
    await renderPage();

    await clickRetry('g1');

    expect(apiMocks.retryGenerationJob).toHaveBeenCalledWith('p1', 'j1');
    await vi.waitFor(() => expect(nodeOf('g1').data.src).toBe('http://img/out.png'));
    expect(nodeOf('g1').data.jobId).toBe('j9');
    expect(flowProps.current.mediaNodes).toHaveLength(2);
  });
});

describe('IKDMQV 修改后新生成：新任务新快照，原失败卡承接', () => {
  it('失败草稿卡打开面板修改提示词后发送：走 create 新任务（携带 target_node_id 与新参数），不新建卡', async () => {
    await renderPage();

    await clickNode('f1');
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('原提示词'));
    await typePrompt('修改后的提示词');
    await act(async () => { sendButton().click(); });

    // 新任务路径：create（非 retry），输入先落盘（flushCanvasSave），携带新提示词与原卡身份
    expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1);
    expect(apiMocks.retryGenerationJob).not.toHaveBeenCalled();
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalled();
    const payload = apiMocks.createGenerationJob.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.target_node_id).toBe('f1');
    expect((payload.parameters as Record<string, unknown>).prompt).toBe('修改后的提示词');

    // 原卡原位承接（无新卡），成功结果回填
    await vi.waitFor(() => expect(nodeOf('f1').data.src).toBe('http://img/out.png'));
    expect(flowProps.current.mediaNodes).toHaveLength(2);
  });

  it('失败成品卡重新编辑发送：原卡承接，生成期间旧素材保留在节点上', async () => {
    let resolveCreate: (value: { generation_job_id: string; cursor: number }) => void = () => {};
    apiMocks.createGenerationJob.mockImplementationOnce(
      () => new Promise((resolve) => { resolveCreate = resolve; }),
    );
    await renderPage();

    await clickNode('g1');
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('成品提示词'));
    await typePrompt('成品改版');
    await act(async () => { sendButton().click(); });

    expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1);
    const payload = apiMocks.createGenerationJob.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.target_node_id).toBe('g1');
    expect((payload.parameters as Record<string, unknown>).prompt).toBe('成品改版');

    // 原位承接：同一张卡转生成中，旧素材 src 不被清除（IKDMQU Q5）
    await vi.waitFor(() => expect(nodeOf('g1').data.genStatus).toBe('generating'));
    const node = nodeOf('g1');
    expect(node.data.src).toBe('http://img/g1.png');
    expect(flowProps.current.mediaNodes).toHaveLength(2);

    await act(async () => { resolveCreate({ generation_job_id: 'j8', cursor: 1 }); });
    await vi.waitFor(() => expect(nodeOf('g1').data.src).toBe('http://img/out.png'));
  });

  it('保存失败保护：落盘失败中止发送，不创建任务', async () => {
    apiMocks.saveCanvasDoc.mockRejectedValueOnce(new Error('save failed'));
    await renderPage();

    await clickNode('f1');
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('原提示词'));
    await typePrompt('再试一次');
    await act(async () => { sendButton().click(); });

    await vi.waitFor(() => expect(container.textContent).toContain('保存失败，请重试'));
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    // 卡片保留失败态与参数，不丢草稿
    expect(nodeOf('f1').data.genStatus).toBe('failed');
    expect(nodeOf('f1').data.prompt).toBe('再试一次');
    expect(flowProps.current.mediaNodes).toHaveLength(2);
  });
});
