// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../index';
import { readPromptRefText, typePromptRefText } from './promptRefEditor';


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

vi.mock('../components/CanvasToolbar', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));

vi.mock('../components/CanvasHeader', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));

vi.mock('../components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

vi.mock('@/custom/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/custom/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  fetchMe: vi.fn(async () => null),
  fetchCredits: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  saveCanvasDoc: vi.fn(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  createGenerationJob: vi.fn(async (_projectId: string, _body: Record<string, unknown>, _key: string) => ({ generation_job_id: 'j8', cursor: 1 })),
  fetchJobStatus: vi.fn(async () => ({
    job_id: 'j9',
    status: 'succeeded',
    progress: 100,
    asset: { id: 'a9', url: 'http://img/out.png', type: 'image' },
  })),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(async (_projectId: string, _jobId: number | string, _key: string) => ({ generation_job_id: 'j9', cursor: 2 })),
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
      features: {},
      version: 1,
      digest: '',
    },
  ]),
}));

vi.mock('@/custom/api/projects', () => ({
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchProjects: apiMocks.fetchProjects,
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
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
  linkAssetToProject: vi.fn(),
}));

vi.mock('@/custom/api/canvas', () => ({
  applyPromptPreview: vi.fn(),
  createConversationQuote: vi.fn(),
  readCanvasConflictVersion: () => undefined,
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

vi.mock('../hooks/document/useCanvasDoc', () => ({
  useCanvasDoc: () => canvasDocMock.current,
}));

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

    expect(apiMocks.retryGenerationJob).toHaveBeenCalledTimes(1);
    expect(apiMocks.retryGenerationJob).toHaveBeenCalledWith('p1', 'j1', expect.any(String));
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();

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

    await clickRetry('f1');
    expect(apiMocks.retryGenerationJob).toHaveBeenCalledTimes(1);

    await act(async () => { resolveRetry({ generation_job_id: 'j9', cursor: 2 }); });
    await vi.waitFor(() => expect(nodeOf('f1').data.src).toBe('http://img/out.png'));
  });

  it('失败成品卡点重试同样原位承接，旧素材被新结果替换', async () => {
    await renderPage();

    await clickRetry('g1');

    expect(apiMocks.retryGenerationJob).toHaveBeenCalledWith('p1', 'j1', expect.any(String));
    await vi.waitFor(() => expect(nodeOf('g1').data.src).toBe('http://img/out.png'));
    expect(nodeOf('g1').data.jobId).toBe('j9');
    expect(flowProps.current.mediaNodes).toHaveLength(2);
  });

  it('重试失败后再点重试复用同一把幂等键：响应丢了不会变成两个新任务两笔钱', async () => {
    apiMocks.retryGenerationJob.mockRejectedValueOnce(new Error('网络中断'));
    await renderPage();

    await clickRetry('f1');
    await vi.waitFor(() => expect(apiMocks.retryGenerationJob).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(nodeOf('f1').data.genStatus).toBe('failed'));

    await clickRetry('f1');
    await vi.waitFor(() => expect(apiMocks.retryGenerationJob).toHaveBeenCalledTimes(2));

    const keyOf = (index: number) => apiMocks.retryGenerationJob.mock.calls[index]![2];
    expect(keyOf(1)).toBe(keyOf(0));
  });

  it('签名随被重试的任务走：卡换到新任务后再重试拿的是新钥匙', async () => {
    await renderPage();

    await clickRetry('f1');
    await vi.waitFor(() => expect(apiMocks.retryGenerationJob).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(nodeOf('f1').data.jobId).toBe('j9'));

    apiMocks.retryGenerationJob.mockResolvedValueOnce({ generation_job_id: 'j10', cursor: 3 });
    await clickRetry('f1');
    await vi.waitFor(() => expect(apiMocks.retryGenerationJob).toHaveBeenCalledTimes(2));
    expect(apiMocks.retryGenerationJob).toHaveBeenLastCalledWith('p1', 'j9', expect.any(String));

    const keyOf = (index: number) => apiMocks.retryGenerationJob.mock.calls[index]![2];
    expect(keyOf(1)).not.toBe(keyOf(0));
  });
});

describe('IKDMQV 修改后新生成：新任务新快照，原失败卡承接', () => {
  it('失败草稿卡打开面板修改提示词后发送：走 create 新任务（携带 target_node_id 与新参数），不新建卡', async () => {
    await renderPage();

    await clickNode('f1');
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('原提示词'));
    await typePrompt('修改后的提示词');
    await act(async () => { sendButton().click(); });

    expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1);
    expect(apiMocks.retryGenerationJob).not.toHaveBeenCalled();
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalled();
    const payload = apiMocks.createGenerationJob.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.target_node_id).toBe('f1');
    expect((payload.parameters as Record<string, unknown>).prompt).toBe('修改后的提示词');

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

    await vi.waitFor(() => expect(nodeOf('g1').data.genStatus).toBe('generating'));
    const node = nodeOf('g1');
    expect(node.data.src).toBe('http://img/g1.png');
    expect(flowProps.current.mediaNodes).toHaveLength(2);

    await act(async () => { resolveCreate({ generation_job_id: 'j8', cursor: 1 }); });
    await vi.waitFor(() => expect(nodeOf('g1').data.src).toBe('http://img/out.png'));
  });

  it('同参数再次发送复用同一把幂等键：响应丢了原样重发不会建出第二个任务第二笔钱', async () => {
    apiMocks.createGenerationJob.mockRejectedValueOnce(new Error('网络中断'));
    await renderPage();

    await clickNode('f1');
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('原提示词'));
    await typePrompt('同一句提示词');
    await act(async () => { sendButton().click(); });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(nodeOf('f1').data.genStatus).toBe('failed'));

    await clickNode('f1');
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('同一句提示词'));
    await act(async () => { sendButton().click(); });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(2));

    const keyOf = (index: number) => apiMocks.createGenerationJob.mock.calls[index]![2];
    expect(keyOf(1)).toBe(keyOf(0));
  });

  it('改了提示词再发送换新钥匙：那是新意图，沿用旧键会撞服务端「同键异载荷」判 409', async () => {
    apiMocks.createGenerationJob.mockRejectedValueOnce(new Error('网络中断'));
    await renderPage();

    await clickNode('f1');
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('原提示词'));
    await typePrompt('第一版提示词');
    await act(async () => { sendButton().click(); });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(nodeOf('f1').data.genStatus).toBe('failed'));

    await clickNode('f1');
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('第一版提示词'));
    await typePrompt('第二版提示词');
    await act(async () => { sendButton().click(); });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(2));

    const keyOf = (index: number) => apiMocks.createGenerationJob.mock.calls[index]![2];
    expect(keyOf(1)).not.toBe(keyOf(0));
  });

  it('保存失败保护：落盘失败中止发送，不创建任务', async () => {    apiMocks.saveCanvasDoc.mockRejectedValueOnce(new Error('save failed'));
    await renderPage();

    await clickNode('f1');
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('原提示词'));
    await typePrompt('再试一次');
    await act(async () => { sendButton().click(); });

    await vi.waitFor(() => expect(container.textContent).toContain('保存失败，请重试'));
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    expect(nodeOf('f1').data.genStatus).toBe('failed');
    expect(nodeOf('f1').data.prompt).toBe('再试一次');
    expect(flowProps.current.mediaNodes).toHaveLength(2);
  });
});
