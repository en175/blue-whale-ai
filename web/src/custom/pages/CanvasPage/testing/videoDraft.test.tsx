// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../index';
import { Toaster, toast } from 'sonner';
import { clickSelectOption, selectOptionByText } from './radixSelect';

vi.setConfig({ testTimeout: 20_000, hookTimeout: 60_000 });
const WAIT_TIMEOUT_MS = 10_000;
const waitFor = (callback: () => unknown) => vi.waitFor(callback, { timeout: WAIT_TIMEOUT_MS });



const quoteMock = vi.hoisted(() => ({
  current: null as { credits: number; quote_revision: string } | null,
}));

vi.mock('@/custom/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => {
      if (quoteMock.current == null) throw new Error('quote unavailable (mock)');
      return { ...quoteMock.current };
    },
  })),
}));

vi.mock('@/custom/api/canvasRecovery', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/api/canvasRecovery')>()),
  generationRecoveryPageOptions: vi.fn(() => ({
    queryKey: ['generation-recovery', 'mock'],
    staleTime: Infinity,
    queryFn: async () => { throw new Error('recovery unavailable (mock)'); },
  })),
  fetchGenerationRecoveryPage: vi.fn(async () => ({
    protocol_version: 1,
    canvas_version: null,
    records: [],
    next_cursor: null,
  })),
}));

vi.mock('../characterLibraryDeposit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../characterLibraryDeposit')>()),
  depositCanvasAssetToCharacterLibrary: vi.fn(async () => ({ materialId: 'asset-compliance-test' })),
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

const toolbarProps: { current: Record<string, any> } = { current: {} };
vi.mock('../components/CanvasToolbar', () => ({
  default: (props: Record<string, any>) => {
    toolbarProps.current = props;
    return createElement('div', { 'data-testid': 'canvas-toolbar' });
  },
}));

const headerProps: { current: Record<string, any> } = { current: {} };
vi.mock('../components/CanvasHeader', () => ({
  default: (props: Record<string, any>) => {
    headerProps.current = props;
    return createElement('div', { 'data-testid': 'canvas-header' });
  },
}));

vi.mock('../components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

vi.mock('@/custom/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/custom/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

vi.mock('../components/PromptRefEditor', async () => {
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
  fetchCredits: vi.fn(async () => ({})),
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
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async () => [
    {
      model_id: 'seedance-2',
      provider_id: 'prov',
      model_label: '测试视频模型',
      icon: null,
      supported_sizes: [{ id: '720p', label: '720p', api_value: '720p' }],
      supported_aspect_ratios: [{ id: '16:9', label: '16:9' }],
      supported_formats: [],
      supported_durations: { min: 4, max: 12, step: 1 },
      default_size: '720p',
      default_format: null,
      default_aspect_ratio: '16:9',
      default_duration: 5,
      features: {
        reference_image: true,
        image_reference_max: 10,
        watermark: false,
        quantity_max: 1,
        sequential_image_generation: false,
        stream: false,
        tools: false,
        first_frame: true,
        last_frame: true,
        first_last_frame: true,
        task_types: {
          text2video: {},
          omni: {},
          image_reference: {},
          first_frame: {},
          first_last_frame: {},
        },
        audio: false,
      },
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
  linkAssetToProject: vi.fn(),
}));

vi.mock('@/custom/api/canvas', () => ({
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

vi.mock('@/custom/api/jobs', () => ({
  createGenerationJob: apiMocks.createGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  quoteVideoFinalize: vi.fn(async () => ({ credits: null, quote_revision: null })),
  finalizeVideoJob: vi.fn(),
  quoteSampleRegenerate: vi.fn(async () => ({ credits: null, quote_revision: null })),
  regenerateSampleJob: vi.fn(),
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

vi.mock('../hooks/useCanvasDoc', () => ({
  useCanvasDoc: () => canvasDocMock.current,
}));

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
  toast.dismiss();

  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(MemoryRouter, null, createElement(CanvasPage), createElement(Toaster, { duration: Infinity })),
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
  const fullNode = flowProps.current.mediaNodes?.find((n: Node) => n.id === node.id);
  await act(async () => {
    flowProps.current.onNodeClick((fullNode ?? node) as Node);
  });
}

async function waitModelReady() {
  await waitFor(() => expect(container.textContent).toContain('测试视频模型'));
}

async function selectMode(label: string) {
  const modeLabels = ['文生视频', '全能参考', '图片参考', '图生视频', '首尾帧', '视频编辑', '视频延长'];
  await act(async () => {
    [...container.querySelectorAll('button')].find((b) => modeLabels.includes(b.textContent ?? ''))!.click();
  });
  await clickSelectOption(label);
}

async function selectKeyframeMode() {
  await selectMode('首尾帧');
}

async function pickRefNode(slotTitle: string, nodeId: string) {
  if (slotTitle === '从资产中选择 / 从节点添加素材') {
    await waitFor(() => {
      expect([...container.querySelectorAll('button')].some((b) => b.textContent === '参考')).toBe(true);
    });
    await act(async () => {
      [...container.querySelectorAll('button')].find((b) => b.textContent === '参考')!.click();
    });
    await clickNode(flowProps.current.mediaNodes.find((n: Node) => n.id === nodeId)!);
    return;
  }
  await waitFor(() => {
    const btn = [...container.querySelectorAll('button')].find((b) => b.title === slotTitle);
    expect(btn).toBeTruthy();
  });
  await act(async () => {
    [...container.querySelectorAll('button')].find((b) => b.title === slotTitle)!.click();
  });
  await waitFor(() => {
    const item = [...container.querySelectorAll('button')].find((b) => b.textContent === '从节点添加素材');
    expect(item).toBeTruthy();
  });
  await act(async () => {
    [...container.querySelectorAll('button')].find((b) => b.textContent === '从节点添加素材')!.click();
  });
  await clickNode(flowProps.current.mediaNodes.find((n: Node) => n.id === nodeId)!);
}

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
  quoteMock.current = null;
});

describe('IKDMQS 视频草稿创建与编辑', () => {
  it('侧栏视频入口先建草稿卡再开绑定面板：不创建任务（1f2f498d 起入口统一建卡）', async () => {
    await renderPage();
    const before = flowProps.current.mediaNodes.length;

    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });


    await waitFor(() => {
      expect(flowProps.current.mediaNodes).toHaveLength(before + 1);
      expect(videoDrafts()).toHaveLength(2);
    });

    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(container.textContent).toContain('文生视频'), { timeout: 3000 });
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === '参考')).toBe(true);
    expect(container.querySelector('button[title="从资产中选择 / 从节点添加素材"]')).toBeNull();
  });

  it('侧栏入口发送：绑定新建草稿卡生成（带 target_node_id），不另落生成卡', async () => {
    await renderPage();
    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });
    await waitModelReady();
    await typePrompt('自由模式输入');

    await act(async () => { sendButton().click(); });
    await waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.type).toBe('video');
    expect(payload.references).toBeUndefined();
    expect('references' in payload).toBe(false);
    expect(typeof payload.target_node_id).toBe('string');
    expect((payload.parameters as Record<string, unknown>).prompt).toBe('自由模式输入');
    expect(flowProps.current.mediaNodes).toHaveLength(5);
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('连续点击侧栏入口：每次新建草稿卡，面板保持打开', async () => {
    await renderPage();
    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });
    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });
    await waitFor(() => expect(videoDrafts()).toHaveLength(3));
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(container.textContent).toContain('文生视频'), { timeout: 3000 });
  });

  it('点击已保存的视频草稿卡重开绑定面板', async () => {
    await renderPage();
    await clickNode({
      id: 'd1',
      type: 'mediaNode',
      data: { draft: true, mediaType: 'video', genStatus: 'draft' },
    });
    await vi.waitFor(() => expect(container.textContent).toContain('文生视频'), { timeout: 3000 });
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === '参考')).toBe(true);
    expect(container.querySelector('button[title="从资产中选择 / 从节点添加素材"]')).toBeNull();
  });
});

describe('IKDMQS 视频参考连线与显式角色', () => {
  it('画布拖线默认普通参考角色；首帧/尾帧由 Dock 入口显式指定', async () => {
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });

    await connect('m1', 'd1');
    const edge = flowProps.current.edges.find((e: { source: string; target: string }) => e.source === 'm1' && e.target === 'd1');
    expect(edge).toBeTruthy();
    expect(edge.data?.refRole).toBeUndefined();
    expect(container.querySelector('[data-testid="dock-video-ref"]')).toBeTruthy();
  });

  it('无效来源被拒绝并提示：待生成草稿不能作为参考', async () => {
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

describe('IKFXZD 发送成功后面板自动隐藏', () => {
  it('画布落盘失败中止提交：提示保存失败、不创建任务，面板保持打开', async () => {
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await waitModelReady();
    await typePrompt('落盘失败场景');

    apiMocks.saveCanvasDoc.mockImplementation(() => Promise.reject(new Error('boom')));
    try {
      await act(async () => { sendButton().click(); });
      await waitFor(() => expect(container.textContent).toContain('保存失败，请重试'));
      expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
      expect(container.querySelector('textarea')).toBeTruthy();
    } finally {
      apiMocks.saveCanvasDoc.mockImplementation(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' }));
    }
  });

  it('发送成功后画布选中事件不回弹重开面板；手动点卡照常重开只读', async () => {
    apiMocks.fetchJobStatus.mockImplementation(async (): Promise<any> => ({
      job_id: 'j1', status: 'processing', progress: 10, asset: null,
    }));
    try {
      await renderPage();
      await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
      await waitModelReady();
      await typePrompt('选中回弹场景');

      await act(async () => { sendButton().click(); });
      await waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

      expect(container.querySelector('textarea')).toBeNull();

      const draft = () => flowProps.current.mediaNodes.find((n: Node) => n.id === 'd1')!;
      await act(async () => {
        flowProps.current.onSelectionChange({ nodes: [draft()] });
      });
      expect(container.querySelector('textarea')).toBeNull();

      await clickNode(draft());
      await waitFor(() => expect(container.querySelector('textarea')).toBeTruthy());
    } finally {
      apiMocks.fetchJobStatus.mockImplementation(async (): Promise<any> => ({
        job_id: 'j1', status: 'succeeded', progress: 100,
        asset: { id: 'a2', url: 'http://vid/out.mp4', type: 'video' },
      }));
    }
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
    await waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    expect(apiMocks.saveCanvasDoc).toHaveBeenCalled();
    const [projectId, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(projectId).toBe('p1');
    expect(payload.type).toBe('video');
    expect(payload.target_node_id).toBe('d1');
    expect(payload.references).toEqual([{ asset_id: 'a1', type: 'image', role: 'reference' }]);
    expect(payload.first_frame_asset_id).toBeUndefined();


    await waitFor(() => {
      const d1 = flowProps.current.mediaNodes.find((n: Node) => n.id === 'd1');
      const data = d1!.data as Record<string, unknown>;
      expect(data.src).toBe('http://vid/out.mp4');
      expect(data.assetId).toBe('a2');
      expect(data.draft).toBeUndefined();
      expect(data.genStatus).toBeUndefined();
    });
    expect(flowProps.current.mediaNodes).toHaveLength(4);
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('两张即时连线图片支持首尾帧模式，转换角色立即落边并按角色提交', async () => {
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await waitModelReady();
    await connect('m1', 'd1');
    await connect('m2', 'd1');
    expect(flowProps.current.edges).toHaveLength(2);
    await selectKeyframeMode();
    await waitFor(() => expect(flowProps.current.edges.map((edge: { data?: { refRole?: string } }) => edge.data?.refRole)).toEqual(['first', 'last']));
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    await typePrompt('首尾帧驱动');
    await act(async () => { sendButton().click(); });
    await waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.references).toEqual([
      { asset_id: 'a1', type: 'image', role: 'first_frame' },
      { asset_id: 'a2', type: 'image', role: 'last_frame' },
    ]);
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
    await vi.waitFor(() => expect(container.textContent).toContain('首尾帧与普通参考不能混用'), { timeout: 3000 });
    expect(sendButton().disabled).toBe(true);
    await act(async () => { sendButton().click(); });
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    expect(container.querySelector('textarea')).toBeTruthy();
  });

  it('已有 2 张普通参考图片时切换首尾帧模式：自动转为首帧/尾帧槽（IKFJJT）', async () => {
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await connect('m1', 'd1');
    await connect('m2', 'd1');
    await waitModelReady();
    await selectKeyframeMode();

    await waitFor(() => {
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
    await waitFor(() => {
      const edges = flowProps.current.edges as Array<{ source: string; data?: { refRole?: string } }>;
      expect(edges.find((e) => e.source === 'm1')?.data?.refRole).toBe('first');
    });
    await selectMode('全能参考');
    await waitFor(() => {
      const edges = flowProps.current.edges as Array<{ source: string; data?: { refRole?: string } }>;
      expect(edges.find((e) => e.source === 'm1')?.data?.refRole).toBeUndefined();
      expect(edges.find((e) => e.source === 'm2')?.data?.refRole).toBeUndefined();
    });
    expect(flowProps.current.edges).toHaveLength(2);
  });
});

describe('IKFQ5S 首尾帧 adaptive 按模型门控', () => {
  const videoModelWith = (ratioIds: string[]) => ({
    model_id: 'seedance-2',
    provider_id: 'prov',
    model_label: '测试视频模型',
    icon: null,
    supported_sizes: [{ id: '720p', label: '720p', api_value: '720p' }],
    supported_aspect_ratios: ratioIds.map((id) => ({ id, label: id })),
    supported_formats: [],
    supported_durations: { min: 4, max: 12, step: 1 },
    default_size: '720p',
    default_format: null,
    default_aspect_ratio: ratioIds[0],
    default_duration: 5,
    features: {
      reference_image: true,
      image_reference_max: 10,
      watermark: false,
      quantity_max: 1,
      sequential_image_generation: false,
      stream: false,
      tools: false,
      first_frame: true,
      last_frame: true,
      first_last_frame: true,
      task_types: {
        text2video: {},
        omni: {},
        image_reference: {},
        first_frame: {},
        first_last_frame: ratioIds.includes('adaptive') ? { allowed_ratios: ['adaptive'] } : {},
      },
      audio: false,
    },
    is_default: true,
    version: 1,
    digest: '',
  });

  async function openKeyframeWith(ratios: string[]) {
    apiMocks.fetchGenerationModels.mockImplementation(async () => [videoModelWith(ratios)]);
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await connect('m1', 'd1');
    await connect('m2', 'd1');
    await waitModelReady();
    await selectKeyframeMode();
  }

  it('模型不支持 adaptive（2.0）：首尾帧仍用固定比例（状态栏可见），不内置 adaptive', async () => {
    await openKeyframeWith(['16:9', '9:16', '1:1']);
    await vi.waitFor(() => expect(container.textContent).toContain('测试视频模型|16:9|720p'), { timeout: 3000 });
    expect(container.textContent).not.toContain('adaptive');
  });

  it('模型支持 adaptive（2.5）：首尾帧隐去比例项（内置 adaptive，用户不可见）', async () => {
    await openKeyframeWith(['16:9', 'adaptive']);
    await vi.waitFor(() => expect(container.textContent).toContain('测试视频模型|720p'), { timeout: 3000 });
  });
});

describe('IKG0LP 视频是否带音频开关', () => {
  const videoModelWith = (audio: boolean) => ({
    model_id: 'seedance-2',
    provider_id: 'prov',
    model_label: '测试视频模型',
    icon: null,
    supported_sizes: [{ id: '720p', label: '720p', api_value: '720p' }],
    supported_aspect_ratios: [{ id: '16:9', label: '16:9' }],
    supported_formats: [],
    supported_durations: { min: 4, max: 12, step: 1 },
    default_size: '720p',
    default_format: null,
    default_aspect_ratio: '16:9',
    default_duration: 5,
    features: {
      reference_image: true,
      image_reference_max: 10,
      watermark: false,
      quantity_max: 1,
      sequential_image_generation: false,
      stream: false,
      tools: false,
      first_frame: true,
      last_frame: true,
      first_last_frame: true,
      task_types: {
        text2video: {},
        omni: {},
        image_reference: {},
        first_frame: {},
        first_last_frame: {},
      },
      audio,
    },
    is_default: true,
    version: 1,
    digest: '',
  });

  async function openConfigPanel() {
    const btn = [...container.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('测试视频模型|'),
    )!;
    await act(async () => { btn.click(); });
  }

  const audioSwitch = () =>
    container.querySelector<HTMLButtonElement>('[aria-label="生成的视频带音频"]');

  async function openDraftWith(audio: boolean) {
    apiMocks.fetchGenerationModels.mockImplementation(async () => [videoModelWith(audio)]);
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await waitModelReady();
    await openConfigPanel();
  }

  it('能力位 features.audio=true → 渲染开关，默认开（与上游默认及改动前行为一致）', async () => {
    await openDraftWith(true);
    expect(audioSwitch()).toBeTruthy();
    expect(audioSwitch()!.getAttribute('aria-checked')).toBe('true');
  });

  it('能力位 features.audio=false → 不渲染开关（用户无权选择）', async () => {
    await openDraftWith(false);
    expect(audioSwitch()).toBeNull();
  });

  it('点击开关 → 状态翻转并写回草稿 draftGenerateAudio=false（重开面板可恢复）', async () => {
    await openDraftWith(true);
    await act(async () => { audioSwitch()!.click(); });
    expect(audioSwitch()!.getAttribute('aria-checked')).toBe('false');
    expect(draftDataOf('d1').draftGenerateAudio).toBe(false);
  });
});

describe('IKDMQS 生成中连线只读', () => {
  it('生成中的视频草稿：新建连线被拦截并提示', async () => {
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await connect('m1', 'd1');
    await waitModelReady();
    await typePrompt('转生成中');
    apiMocks.fetchJobStatus.mockImplementation(async () => ({ job_id: 'j1', status: 'running', progress: 10 }) as unknown as Awaited<ReturnType<typeof apiMocks.fetchJobStatus>>);
    await act(async () => { sendButton().click(); });
    await waitFor(() => {
      const d1 = flowProps.current.mediaNodes.find((n: Node) => n.id === 'd1');
      expect((d1!.data as Record<string, unknown>).genStatus).toBe('generating');
    });

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
    await vi.waitFor(() => expect(container.textContent).toContain('生成失败的卡片不能作为参考'), { timeout: 3000 });
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

const MODE_LABELS = ['文生视频', '全能参考', '图片参考', '图生视频', '首尾帧', '视频编辑', '视频延长'];

function modeButton(): HTMLButtonElement {
  return [...container.querySelectorAll('button')].find((b) => MODE_LABELS.includes(b.textContent ?? ''))!;
}

async function expectMode(label: string) {
  await waitFor(() => expect(modeButton().textContent).toBe(label));
}

async function openModeMenu() {
  const modeButtons = () => [...container.querySelectorAll('button')].filter((b) => MODE_LABELS.includes(b.textContent ?? ''));
  if (modeButtons().length > 1) return;
  await act(async () => { modeButtons()[0]!.click(); });
}

function modeOption(label: string): HTMLElement | undefined {
  return selectOptionByText(label);
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
    expect(container.querySelectorAll('[data-testid="dock-text-ref"]')).toHaveLength(1);
    await waitModelReady();
    expect(sendButton().disabled).toBe(false);
  });

  it('画布连线图片成为参考：按默认表自动切图片参考并保留输入（提示词与文本附件），提交携带完整引用', async () => {
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
    await connect('t1', 'd1');
    await expectMode('文生视频');

    await connect('m1', 'd1');

    await expectMode('图片参考');
    await vi.waitFor(() => expect(container.textContent).toContain('已根据当前素材切换生成模式'), { timeout: 3000 });
    expect(container.querySelectorAll('[data-testid="dock-text-ref"]')).toHaveLength(1);
    await waitFor(() => expect(draftDataOf('d1').draftMode).toBe('image_reference'));
    await waitFor(() => expect(draftDataOf('d1').prompt).toBe('海边日落'));

    await act(async () => { sendButton().click(); });
    await waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.references).toEqual([{ asset_id: 'a1', type: 'image', role: 'reference' }]);
  });

  it('角色库 material 参考成为参考（草稿 data，无连线）：打开面板即按默认表切图片参考', async () => {
    const doc = canvasDocMock.current.doc as { nodes: Node[] };
    doc.nodes.find(n => n.id === 'd1')!.data.draftMaterialRefs = [
      { materialId: 'asset-lib1', url: 'http://img/lib1.png', name: '角色立绘', mediaType: 'image', role: 'reference' },
    ];
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await expectMode('图片参考');
    expect(flowProps.current.edges).toHaveLength(0);
  });

  it('从节点添加素材参考：选取即落线成为当前参考（IKFDFW），按默认表切图片参考', async () => {
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await waitModelReady();
    await expectMode('文生视频');

    await pickRefNode('从资产中选择 / 从节点添加素材', 'm1');

    expect(flowProps.current.edges).toHaveLength(1);
    await expectMode('图片参考');
  });

  it('存在媒体参考时文生视频置灰；部分删除仍置灰；全部删除恢复可选并按默认表切回文生视频', async () => {
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await waitModelReady();
    await connect('m1', 'd1');
    await connect('m2', 'd1');
    await expectMode('图片参考');

    await openModeMenu();
    expect(modeOption('文生视频')!.hasAttribute('data-disabled')).toBe(true);

    const removeButtons = () => container.querySelectorAll<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title="移除"]');
    await act(async () => { removeButtons()[0]!.click(); });
    await openModeMenu();
    expect(modeOption('文生视频')!.hasAttribute('data-disabled')).toBe(true);

    await act(async () => { removeButtons()[0]!.click(); });
    await waitFor(() => expect(flowProps.current.edges).toHaveLength(0));
    await expectMode('文生视频');
    await openModeMenu();
    expect(modeOption('文生视频')!.hasAttribute('data-disabled')).toBe(false);
  });

  it('草稿恢复保持已保存模式：首尾帧草稿恢复首尾帧，文生视频草稿无媒体恢复文生视频', async () => {
    const doc = canvasDocMock.current.doc as { nodes: Node[]; edges: unknown[] };
    doc.nodes.find(n => n.id === 'd1')!.data.draftMode = 'first_last_frame';
    doc.edges = [
      { id: 'f1', source: 'm1', target: 'd1', data: { refRole: 'first' } },
      { id: 'f2', source: 'm2', target: 'd1', data: { refRole: 'last' } },
    ];
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await expectMode('首尾帧');

    doc.nodes.find(n => n.id === 'd1')!.data.draftMode = 'text2video';
    doc.edges = [{ id: 'r1', source: 'm1', target: 'd1' }];
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await expectMode('图片参考');

    doc.edges = [];
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await expectMode('文生视频');
  });
});

describe('IKK1T9 视频编辑/延长（ADR-0124 模式配置化）', () => {
  function editCapableModel() {
    return {
      model_id: 'seedance-2',
      provider_id: 'prov',
      model_label: '测试视频模型',
      icon: null,
      supported_sizes: [{ id: '720p', label: '720p', api_value: '720p' }],
      supported_aspect_ratios: [{ id: '16:9', label: '16:9' }, { id: 'adaptive', label: 'adaptive' }],
      supported_formats: [],
      supported_durations: { min: 4, max: 12, step: 1 },
      default_size: '720p',
      default_format: null,
      default_aspect_ratio: '16:9',
      default_duration: 5,
      features: {
        reference_image: true,
        image_reference_max: 10,
        watermark: false,
        quantity_max: 1,
        sequential_image_generation: false,
        stream: false,
        tools: false,
        first_frame: true,
        last_frame: true,
        first_last_frame: true,
        audio: false,
        video_reference: true,
        video_reference_max: 3,
        task_types: {
          text2video: {},
          omni: {},
          image_reference: {},
          first_frame: { allowed_ratios: ['adaptive'] },
          first_last_frame: { allowed_ratios: ['adaptive'] },
          edit: { allowed_ratios: ['adaptive'], allowed_durations: [-1] },
          extend: { allowed_ratios: ['adaptive'] },
        },
      },
      version: 1,
      digest: '',
    };
  }

  it('只有一段参考视频 → 默认表落视频编辑；比例/时长按能力行锁定；提交带 mode 与锁定值', async () => {
    apiMocks.fetchGenerationModels.mockResolvedValue([editCapableModel()]);
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await waitModelReady();
    await connect('v1', 'd1');

    await expectMode('视频编辑');
    await vi.waitFor(() => expect(container.textContent).toContain('跟随原视频'), { timeout: 3000 });

    await typePrompt('把背景换成夜晚');
    await act(async () => { sendButton().click(); });
    await waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.parameters).toMatchObject({
      mode: 'edit',
      aspect_ratio: 'adaptive',
      duration: -1,
    });
  });

  it('两张图片切图生视频：以图生视频的名义拒绝切换，不改模式也不索要尾帧', async () => {
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await waitModelReady();
    await connect('m1', 'd1');
    await connect('m2', 'd1');
    await expectMode('图片参考');

    await openModeMenu();
    await act(async () => { modeOption('图生视频')!.click(); });

    await expectMode('图片参考');
    await vi.waitFor(() => expect(container.textContent).toContain('图生视频模式最多 1 张图片'), { timeout: 3000 });
    expect(container.textContent).not.toContain('请补充尾帧');
    expect(container.textContent).not.toContain('首尾帧模式最多');
  });

  it('离开视频编辑切到其他模式：时长不再留在 -1，提交值回到正常时长', async () => {
    apiMocks.fetchGenerationModels.mockResolvedValue([editCapableModel()]);
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await waitModelReady();
    await connect('v1', 'd1');
    await expectMode('视频编辑');
    await vi.waitFor(() => expect(container.textContent).toContain('跟随原视频'), { timeout: 3000 });

    await openModeMenu();
    await act(async () => { modeOption('全能参考')!.click(); });
    await expectMode('全能参考');
    expect(container.textContent).not.toContain('跟随原视频');
    expect(container.textContent).not.toContain('-1s');

    await typePrompt('换成夜晚');
    await act(async () => { sendButton().click(); });
    await waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.parameters).toMatchObject({ mode: 'omni' });
    expect((payload.parameters as { duration: number }).duration).toBeGreaterThan(0);
  });

  it('模型切到 2.5：原先因不开放而落到全能参考的「只有视频」应回到视频编辑', async () => {
    const editModel = editCapableModel();
    const { edit: _edit, extend: _extend, ...modes20 } = editModel.features.task_types;
    apiMocks.fetchGenerationModels.mockResolvedValue([
      { ...editModel, model_id: 'seedance-2', model_label: '测试视频模型 20', features: { ...editModel.features, task_types: modes20 } },
      { ...editModel, model_id: 'seedance-2.5', model_label: '测试视频模型 25' },
    ]);
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await waitModelReady();
    await connect('v1', 'd1');
    await expectMode('全能参考');

    const configBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('测试视频模型 20'))!;
    await act(async () => { configBtn.click(); });
    const modelTrigger = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('测试视频模型 20'))!;
    await act(async () => { modelTrigger.click(); });
    await clickSelectOption('测试视频模型 25');
    await expectMode('视频编辑');
  });

  it('加入第二段参考视频：编辑收不下 → 自动切全能参考（不留提交冲突）', async () => {
    apiMocks.fetchGenerationModels.mockResolvedValue([editCapableModel()]);
    const doc = canvasDocMock.current.doc as { nodes: Node[] };
    doc.nodes.push({
      id: 'v2',
      type: 'mediaNode',
      position: { x: 1000, y: 0 },
      data: { src: 'http://vid/v2.mp4', mediaType: 'video', fileName: '参考视频二', assetId: 'a4' },
    });
    (canvasDocMock.current.assets as Record<string, unknown>).a4 = {
      asset_id: 4, type: 'video', access_url: 'http://vid/v2.mp4', width: 100, height: 100,
    };
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await waitModelReady();
    await connect('v1', 'd1');
    await expectMode('视频编辑');

    await connect('v2', 'd1');
    await expectMode('全能参考');
  });

  it('视频编辑时撤掉唯一参考视频：模式收不下 → 自动切走，不留冲突', async () => {
    apiMocks.fetchGenerationModels.mockResolvedValue([editCapableModel()]);
    await renderPage();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await waitModelReady();
    await connect('v1', 'd1');
    await expectMode('视频编辑');

    const removeButtons = () => container.querySelectorAll<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title="移除"]');
    await act(async () => { removeButtons()[0]!.click(); });
    await waitFor(() => expect(flowProps.current.edges).toHaveLength(0));
    await expectMode('文生视频');
  });
});

describe('IKFC26 方案绑定媒体同步视频模式', () => {
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
    doc.nodes.find(n => n.id === 'd1')!.data.draftMode = 'text2video';
    canvasDocMock.current.assets = {
      ...canvasDocMock.current.assets,
      101: { asset_id: 101, type: 'image', access_url: 'http://img/m9.png', width: 100, height: 100 },
    };
  }

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

  it('方案绑定媒体：画布连线走前端方案边，绑定随边携带且不再切换目标模式', async () => {
    seedPlanDoc(true);
    await renderPage();
    await connect('plan1', 'd1');


    await waitFor(() => expect(flowProps.current.edges).toHaveLength(1));
    const planEdge = flowProps.current.edges.find((e: { source: string; target: string; data?: { promptReference?: { bindings?: unknown } } }) => e.source === 'plan1' && e.target === 'd1');
    expect(planEdge?.data?.promptReference).toEqual({ bindings: [{ index: 1, assetId: '101' }] });

    expect(apiMocks.referencePromptPlan).not.toHaveBeenCalled();
    expect(draftDataOf('d1').draftMode).toBe('text2video');

    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await expectMode('文生视频');

    await typePrompt('绑定后再编辑');
    await waitFor(() => {
      const last = apiMocks.saveCanvasDoc.mock.calls.at(-1) as unknown as [string, { edges: { source: string; target: string }[] }] | undefined;
      expect(last).toBeTruthy();
      const saved = last![1].edges.find(e => e.source === 'plan1' && e.target === 'd1');
      expect(saved).toBeTruthy();
    });

  });

  it('方案仅文本：服务端不切换，本地保持文生视频，重开面板恢复文生视频', async () => {
    seedPlanDoc(false);
    mockReferenceSaved('prompt', false);
    await renderPage();
    await connect('plan1', 'd1');

    await waitFor(() => expect(flowProps.current.edges).toHaveLength(1));
    expect(draftDataOf('d1').draftMode).toBe('text2video');

    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await expectMode('文生视频');
  });
});

describe('IKJ4W6 画布视频比例显示 auto 并默认选中', () => {
  const adaptiveModel = {
    model_id: 'seedance-2-5',
    provider_id: 'prov',
    model_label: '测试视频模型',
    icon: null,
    supported_sizes: [{ id: '720p', label: '720p', api_value: '720p' }],
    supported_aspect_ratios: [{ id: '16:9', label: '16:9' }, { id: '9:16', label: '9:16' }, { id: 'adaptive', label: 'adaptive' }],
    supported_formats: [],
    supported_durations: { min: 4, max: 12, step: 1 },
    default_size: '720p',
    default_format: null,
    default_aspect_ratio: '16:9',
    default_duration: 5,
    features: {
      reference_image: true,
      image_reference_max: 10,
      watermark: false,
      quantity_max: 1,
      sequential_image_generation: false,
      stream: false,
      tools: false,
      first_frame: true,
      last_frame: true,
      first_last_frame: true,
      task_types: {
        text2video: {},
        omni: {},
        image_reference: {},
        first_frame: {},
        first_last_frame: {},
      },
      audio: false,
    },
    is_default: true,
    version: 1,
    digest: '',
  };

  it('模型支持 adaptive 时配置状态栏显示 auto（不出现英文 adaptive）', async () => {
    apiMocks.fetchGenerationModels.mockImplementation(async () => [adaptiveModel]);
    await renderPage();
    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });
    await waitModelReady();
    await vi.waitFor(() => expect(container.textContent).toContain('测试视频模型|auto|720p'), { timeout: 3000 });
    expect(container.textContent).not.toContain('adaptive');
  });

  it('默认选中档提交时 parameters.aspect_ratio 仍是内部键 adaptive', async () => {
    apiMocks.fetchGenerationModels.mockImplementation(async () => [adaptiveModel]);
    await renderPage();
    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });
    await waitModelReady();
    await typePrompt('默认跟随输入');

    await act(async () => { sendButton().click(); });
    await waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect((payload.parameters as Record<string, unknown>).aspect_ratio).toBe('adaptive');
  });

  it('未支持 adaptive 的模型：状态栏照常显示固定比例，不出现 auto', async () => {
    apiMocks.fetchGenerationModels.mockImplementation(async () => [
      {
        ...adaptiveModel,
        model_id: 'seedance-2',
        supported_aspect_ratios: [{ id: '16:9', label: '16:9' }, { id: '9:16', label: '9:16' }],
        default_aspect_ratio: '16:9',
      },
    ]);
    await renderPage();
    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });
    await waitModelReady();
    await vi.waitFor(() => expect(container.textContent).toContain('测试视频模型|16:9|720p'), { timeout: 3000 });
    expect(container.textContent).not.toContain('auto');
  });
});

describe('IKIPSX 视频草稿默认模式 draftMode 写入', () => {
  it('侧栏入口新建视频草稿：未碰模式选择器，data.draftMode 落盘为面板默认显示模式 prompt', async () => {
    await renderPage();
    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });


    await waitFor(() => expect(videoDrafts()).toHaveLength(2));
    const newDraft = videoDrafts().find((n) => n.id !== 'd1')!;
    expect((newDraft.data as Record<string, unknown>).draftMode).toBe('text2video');
    await vi.waitFor(() => expect(container.textContent).toContain('文生视频'), { timeout: 3000 });

    await typePrompt('新建草稿保存');
    await waitFor(() => {
      const last = apiMocks.saveCanvasDoc.mock.calls.at(-1) as unknown as
        [string, { nodes: Node[] }] | undefined;
      expect(last).toBeTruthy();
      const saved = last![1].nodes.find((n) => n.id === newDraft.id);
      expect((saved?.data as Record<string, unknown> | undefined)?.draftMode).toBe('text2video');
    });
  });

  it('存量无 draftMode 草稿经面板发送：提交时按当前面板选中模式兜底写入', async () => {
    await renderPage();
    expect(draftDataOf('d1').draftMode).toBeUndefined();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await waitModelReady();
    await expectMode('文生视频');
    await typePrompt('存量草稿提交');

    await act(async () => { sendButton().click(); });
    await waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));


    await waitFor(() => expect(draftDataOf('d1').draftMode).toBe('text2video'));
  });

  it('手动切过模式的存量草稿经面板发送：draftMode 保留为所选模式，不被兜底覆盖', async () => {
    await renderPage();
    expect(draftDataOf('d1').draftMode).toBeUndefined();
    await clickNode({ id: 'd1', type: 'mediaNode', data: { draft: true, mediaType: 'video' } });
    await waitModelReady();
    await connect('m1', 'd1');
    await expectMode('图片参考');
    await openModeMenu();
    await act(async () => { modeOption('全能参考')!.click(); });
    await expectMode('全能参考');
    await waitFor(() => expect(draftDataOf('d1').draftMode).toBe('omni'));
    await typePrompt('已切模式提交');

    await act(async () => { sendButton().click(); });
    await waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    expect(draftDataOf('d1').draftMode).toBe('omni');
  });

  it('存量草稿带参考经更新生成（不走面板）：draftMode 按提交时参考集合派生默认补写', async () => {
    await renderPage();
    expect(draftDataOf('d1').draftMode).toBeUndefined();
    await connect('m1', 'd1');

    await act(async () => {
      flowProps.current.onUpdateGenerate('d1');
    });
    await waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(draftDataOf('d1').draftMode).toBe('image_reference'));
  });
});


function sampleCapableModel() {
  return {
    model_id: 'seedance-2',
    provider_id: 'prov',
    model_label: '测试视频模型',
    icon: null,
    supported_sizes: [
      { id: '480p', label: '480p', api_value: '480p' },
      { id: '720p', label: '720p', api_value: '720p' },
      { id: '1080p', label: '1080p', api_value: '1080p' },
    ],
    supported_aspect_ratios: [{ id: '16:9', label: '16:9' }],
    supported_formats: [],
    supported_durations: { min: 4, max: 12, step: 1 },
    default_size: '1080p',
    default_format: null,
    default_aspect_ratio: '16:9',
    default_duration: 5,
    features: {
      reference_image: true,
      image_reference_max: 10,
      watermark: false,
      quantity_max: 1,
      sequential_image_generation: false,
      stream: false,
      tools: false,
      first_frame: true,
      last_frame: true,
      first_last_frame: true,
      task_types: {
        text2video: {},
        omni: {},
        image_reference: {},
        first_frame: {},
        first_last_frame: {},
      },
      audio: false,
      sample_mode: true,
    },
    version: 1,
    digest: '',
  };
}

describe('IKIZQB 样片模式提交与样片卡', () => {
  let defaultModelsImpl = apiMocks.fetchGenerationModels.getMockImplementation()!;
  beforeEach(() => {
    defaultModelsImpl = apiMocks.fetchGenerationModels.getMockImplementation()!;
  });
  afterEach(() => {
    apiMocks.fetchGenerationModels.mockImplementation(defaultModelsImpl);
    vi.unstubAllGlobals();
  });

  it('能力位未放行（默认 fixture 无 sample_mode）→ 配置面板无样片开关', async () => {
    await renderPage();
    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });
    await waitModelReady();
    const configBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('16:9'))!;
    await act(async () => { configBtn.click(); });
    await vi.waitFor(() => expect(container.textContent).toContain('模型与质量'), { timeout: 3000 });
    expect(container.querySelector('[data-testid="sample-mode-switch"]')).toBeNull();
  });

  it('开启样片发送：480p + sample_mode 参数与顶层报价确认两字段，生成中卡标样片', async () => {
    apiMocks.fetchGenerationModels.mockImplementation(async () => [sampleCapableModel()]);
    quoteMock.current = { credits: 60, quote_revision: 'rev-1' };
    await renderPage();
    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });
    await waitModelReady();
    await typePrompt('样片旅程');

    const configBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('16:9'))!;
    await act(async () => { configBtn.click(); });
    const sw = container.querySelector<HTMLButtonElement>('[data-testid="sample-mode-switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await act(async () => { sw.click(); });
    expect(sw.getAttribute('aria-checked')).toBe('true');
    await vi.waitFor(() => expect(container.textContent).toContain('成片另行计费'), { timeout: 3000 });


    await waitFor(() => expect(sendButton().disabled).toBe(false));
    await act(async () => { sendButton().click(); });
    await waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect((payload.parameters as Record<string, unknown>).sample_mode).toBe(true);
    expect((payload.parameters as Record<string, unknown>).resolution).toBe('480p');
    expect(payload.expected_credits).toBe(60);
    expect(payload.quote_revision).toBe('rev-1');
    const generating = flowProps.current.mediaNodes.find((n: Node) => n.data?.genStatus === 'generating')!;
    expect(generating.data.videoStage).toBe('sample');
    expect(generating.data.fileName).toBe('样片生成中');
  });

  it('样片成功：回填自有素材与实际截止时间（服务端阶段投影为准），重新编辑默认开启样片', async () => {
    apiMocks.fetchGenerationModels.mockImplementation(async () => [sampleCapableModel()]);
    quoteMock.current = { credits: 60, quote_revision: 'rev-1' };
    apiMocks.fetchJobStatus.mockImplementation(async () => ({
      job_id: 'j1',
      status: 'succeeded',
      progress: 100,
      asset: { id: 'a2', url: 'http://vid/sample.mp4', type: 'video' },
      video_stage: 'sample',
      finalize_deadline_at: '2026-10-06T04:30:00.000Z',
    }));
    await renderPage();
    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });
    await waitModelReady();
    await typePrompt('样片成功旅程');
    const configBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('16:9'))!;
    await act(async () => { configBtn.click(); });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="sample-mode-switch"]')!.click();
    });
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    await act(async () => { sendButton().click(); });
    await waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    const targetId = (apiMocks.createGenerationJob.mock.calls[0]![1] as Record<string, unknown>).target_node_id as string;
    await waitFor(() => {
      const done = flowProps.current.mediaNodes.find((n: Node) => n.id === targetId);
      expect(done?.data?.genStatus).toBeUndefined();
      expect(done?.data?.src).toBe('http://vid/sample.mp4');
    });
    const done = flowProps.current.mediaNodes.find((n: Node) => n.id === targetId)!;
    expect(done.data.videoStage).toBe('sample');
    expect(done.data.finalizeDeadlineAt).toBe('2026-10-06T04:30:00.000Z');

    await act(async () => { clickNode(done); });
    const reopenConfigBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('16:9'))!;
    await act(async () => { reopenConfigBtn.click(); });
    await vi.waitFor(() => expect(container.textContent).toContain('模型与质量'), { timeout: 3000 });
    await waitFor(() =>
      expect(container.querySelector('[data-testid="sample-mode-switch"]')?.getAttribute('aria-checked')).toBe('true'),
    );
    apiMocks.fetchJobStatus.mockImplementation(async () => ({
      job_id: 'j1',
      status: 'succeeded',
      progress: 100,
      asset: { id: 'a2', url: 'http://vid/out.mp4', type: 'video' },
    }));
  });

  it('普通视频成功（video_stage 缺省）→ 卡不残留样片标记', async () => {
    await renderPage();
    await act(async () => { toolbarProps.current.onToggleVideoDialog(); });
    await waitModelReady();
    await typePrompt('普通视频');
    await act(async () => { sendButton().click(); });
    await waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const targetId = (apiMocks.createGenerationJob.mock.calls[0]![1] as Record<string, unknown>).target_node_id as string;
    await waitFor(() => {
      const done = flowProps.current.mediaNodes.find((n: Node) => n.id === targetId);
      expect(done?.data?.genStatus).toBeUndefined();
    });
    const done = flowProps.current.mediaNodes.find((n: Node) => n.id === targetId)!;
    expect(done.data.videoStage).toBeUndefined();
    expect(done.data.finalizeDeadlineAt).toBeUndefined();
  });
});

describe('IKIZQG 两阶段卡重新编辑与新建结果卡', () => {
  const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  function seedTwoStageDoc() {
    canvasDocMock.current = {
      doc: {
        id: 11,
        version: 3,
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          {
            id: 's1',
            type: 'mediaNode',
            position: { x: 100, y: 100 },
            data: {
              src: 'http://vid/sample.mp4',
              mediaType: 'video',
              fileName: '样片',
              assetId: 'as1',
              jobId: '9001',
              videoStage: 'sample',
              finalizeDeadlineAt: future,
              draftModelId: 'seedance-2',
              draftRatio: '16:9',
              draftSize: '1080p',
              draftDuration: 5,
              width: 854,
              height: 480,
            },
          },
          {
            id: 'f1',
            type: 'mediaNode',
            position: { x: 1014, y: 100 },
            data: {
              src: 'http://vid/final.mp4',
              mediaType: 'video',
              fileName: '成片',
              assetId: 'af1',
              jobId: '9002',
              videoStage: 'final',
              sourceSampleJobId: '9001',
              draftModelId: 'seedance-2',
              draftRatio: '16:9',
              draftSize: '1080p',
              draftDuration: 5,
              width: 1920,
              height: 1080,
            },
          },
        ],
        edges: [],
      },
      assets: {
        as1: { asset_id: 1, type: 'video', access_url: 'http://vid/sample.mp4', width: 854, height: 480 },
        af1: { asset_id: 2, type: 'video', access_url: 'http://vid/final.mp4', width: 1920, height: 1080 },
      },
      refetch: () => Promise.resolve([]),
      acceptDoc: vi.fn(),
    };
  }

  async function openConfigPanel() {
    const configBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('16:9'))!;
    await act(async () => { configBtn.click(); });
  }

  it('样片卡重新编辑：默认开启样片；发送后新建样片结果卡，原卡身份/素材/截止保留', async () => {
    let finishStatus!: () => void;
    apiMocks.fetchJobStatus.mockImplementationOnce(() => new Promise(resolve => { finishStatus = () => resolve({ job_id: 'j1', status: 'succeeded', progress: 100, asset: { id: 'a2', url: 'http://vid/out.mp4', type: 'video' } }); }));
    apiMocks.fetchGenerationModels.mockImplementation(async () => [sampleCapableModel()]);
    quoteMock.current = { credits: 30, quote_revision: 'rev-1' };
    seedTwoStageDoc();
    await renderPage();
    await clickNode({ id: 's1', type: 'mediaNode' });
    await waitModelReady();
    await openConfigPanel();
    await waitFor(() =>
      expect(container.querySelector('[data-testid="sample-mode-switch"]')?.getAttribute('aria-checked')).toBe('true'),
    );
    await typePrompt('样片重编再生成');
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    await act(async () => { sendButton().click(); });
    await waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    const payload = apiMocks.createGenerationJob.mock.calls[0]![1] as Record<string, any>;
    expect(payload.target_node_id).toBe('s1');
    expect(payload.parameters.sample_mode).toBe(true);
    expect(payload.parameters.resolution).toBe('480p');
    expect(payload.expected_credits).toBe(30);
    expect(payload.quote_revision).toBe('rev-1');


    await waitFor(() => {
      expect(flowProps.current.mediaNodes.filter((n: Node) => n.data?.videoStage === 'sample')).toHaveLength(2);
    });
    const s1 = flowProps.current.mediaNodes.find((n: Node) => n.id === 's1')!;
    const regen = flowProps.current.mediaNodes.find(
      (n: Node) => n.data?.videoStage === 'sample' && n.id !== 's1',
    )!;
    expect(regen.data?.genStatus).toBe('generating');
    expect(regen.position.y).toBeGreaterThan(s1.position.y);
    expect(s1.data?.src).toBe('http://vid/sample.mp4');
    expect(s1.data?.jobId).toBe('9001');
    expect(s1.data?.finalizeDeadlineAt).toBe(future);
    expect(s1.data?.genStatus).toBeUndefined();
    await waitFor(() => expect(finishStatus).toBeTruthy());
    await act(async () => { finishStatus(); });
    await waitFor(() => expect(flowProps.current.mediaNodes.find((node: Node) => node.id === regen.id)?.data.src).toBe('http://vid/out.mp4'));
    vi.unstubAllGlobals();
  });

  it('成片卡重新编辑：默认关闭样片；发送后新建普通视频结果卡，成片卡不被覆盖', async () => {
    let finishStatus!: () => void;
    apiMocks.fetchJobStatus.mockImplementationOnce(() => new Promise(resolve => { finishStatus = () => resolve({ job_id: 'j1', status: 'succeeded', progress: 100, asset: { id: 'a2', url: 'http://vid/out.mp4', type: 'video' } }); }));
    apiMocks.fetchGenerationModels.mockImplementation(async () => [sampleCapableModel()]);
    quoteMock.current = { credits: 20, quote_revision: 'rev-2' };
    seedTwoStageDoc();
    await renderPage();
    await clickNode({ id: 'f1', type: 'mediaNode' });
    await waitModelReady();
    await openConfigPanel();
    await waitFor(() =>
      expect(container.querySelector('[data-testid="sample-mode-switch"]')?.getAttribute('aria-checked')).toBe('false'),
    );
    await typePrompt('成片重编为普通视频');
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    await act(async () => { sendButton().click(); });
    await waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    const payload = apiMocks.createGenerationJob.mock.calls[0]![1] as Record<string, any>;
    expect(payload.target_node_id).toBe('f1');
    expect(payload.parameters.sample_mode).toBeUndefined();
    expect(payload.expected_credits).toBeUndefined();
    expect(payload.quote_revision).toBeUndefined();


    await waitFor(() => {
      expect(flowProps.current.mediaNodes.some(
        (n: Node) => n.id !== 'f1' && n.data?.genStatus === 'generating',
      )).toBe(true);
    });
    const f1 = flowProps.current.mediaNodes.find((n: Node) => n.id === 'f1')!;
    const regen = flowProps.current.mediaNodes.find(
      (n: Node) => n.id !== 'f1' && n.data?.genStatus === 'generating',
    )!;
    expect(regen.data?.videoStage).toBeUndefined();
    expect(regen.position.y).toBeGreaterThan(f1.position.y);
    expect(f1.data?.src).toBe('http://vid/final.mp4');
    expect(f1.data?.jobId).toBe('9002');
    expect(f1.data?.videoStage).toBe('final');
    expect(f1.data?.sourceSampleJobId).toBe('9001');
    expect(f1.data?.genStatus).toBeUndefined();
    await waitFor(() => expect(finishStatus).toBeTruthy());
    await act(async () => { finishStatus(); });
    await waitFor(() => expect(flowProps.current.mediaNodes.find((node: Node) => node.id === regen.id)?.data.src).toBe('http://vid/out.mp4'));
    vi.unstubAllGlobals();
  });
});
