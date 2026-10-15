// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { clickSelectOption } from './testing/radixSelect';
import type { AudioDialogProps } from './components/AudioDialog';
import { typePromptRefText, readPromptRefText, promptRefReadOnly } from './testing/promptRefEditor';
import { Toaster, toast } from 'sonner';


const audioDialogProps = vi.hoisted(() => ({ current: null as AudioDialogProps | null }));
vi.mock('./components/AudioDialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components/AudioDialog')>();
  return { ...actual, default: (props: AudioDialogProps) => { audioDialogProps.current = props; return createElement(actual.default, props); } };
});

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

vi.mock('@/custom/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/custom/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

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
  fetchCredits: vi.fn(async () => ({})),
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

vi.mock('@/custom/api/projects', () => ({
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
  touchProjectLastOpened: apiMocks.touchProjectLastOpened,
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

vi.mock('./hooks/useCanvasDoc', () => ({
  useCanvasDoc: () => canvasDocMock.current,
}));

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
  return container.querySelector<HTMLButtonElement>('[data-testid="audio-send"]')!;
}

function promptTextarea(): HTMLTextAreaElement {
  return container.querySelector<HTMLTextAreaElement>('[data-testid="audio-input"]')!;
}

async function typePrompt(text: string) { await typePromptRefText(container, text); }

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

async function openDraftPanel(): Promise<string> {
  const draft = flowProps.current.mediaNodes.find((n: Node) => n.id === 'd1')!;
  await act(async () => {
    flowProps.current.onNodeClick(draft);
  });
  return 'd1';
}

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

    expect(flowProps.current.mediaNodes).toHaveLength(before + 1);
    expect(draftNodes()).toHaveLength(1);
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
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
    expect(typeof payload.target_node_id).toBe('string');
    expect(payload.parameters.prompt).toBe('自由模式音效');
    expect(payload.parameters.model_id).toBe('a-test');
    expect(flowProps.current.mediaNodes).toHaveLength(2);
    expect(container.querySelector('[data-testid="audio-input"]')).toBeNull();
  });

  it('连续点击侧栏入口：每次新建草稿卡，面板保持打开', async () => {
    await renderPage();

    await clickSidebarAudio();
    await clickSidebarAudio();

    expect(flowProps.current.mediaNodes).toHaveLength(3);
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
    expect(draft().data.draftModelId).toBe('a-test');

    await act(async () => {
      [...container.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.includes('测试音频模型'))!
        .click();
    });
    await clickSelectOption('测试音频模型二');
    expect(draft().data.draftModelId).toBe('a-test-2');

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

    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('恢复的描述'));
    await vi.waitFor(() => expect(container.textContent).toContain('测试音频模型'));
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
    expect(payload.input_asset_ids).toBeUndefined();
    expect(payload.reference_asset_ids).toBeUndefined();

    expect(apiMocks.saveCanvasDoc).toHaveBeenCalled();
    expect(apiMocks.saveCanvasDoc.mock.calls[1]?.[1].nodes.find(node => node.id === draftId)?.data).toMatchObject({ genStatus: 'draft', fileName: '音频草稿', promptDoc: null });
    expect(apiMocks.saveCanvasDoc.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      apiMocks.createGenerationJob.mock.invocationCallOrder[0]!,
    );

    expect(flowProps.current.mediaNodes).toHaveLength(2);

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

    expect(container.querySelector('[data-testid="audio-input"]')).toBeNull();

    await openDraftPanel();
    expect(promptRefReadOnly(container)).toBe(true);
    expect(sendButton().disabled).toBe(true);
    await vi.waitFor(() => expect(container.textContent).toContain('生成中，参数只读'), { timeout: 3000 });

    await act(async () => {
      flowProps.current.onConnect({ source: 'm1', target: draftId, sourceHandle: null, targetHandle: null });
    });
    expect(flowProps.current.edges.some((e: { source: string; target: string }) => e.source === 'm1' && e.target === draftId)).toBe(false);

    await act(async () => {
      flowProps.current.onEdgesChange([{ type: 'remove', id: draftEdgeId }]);
    });
    expect(flowProps.current.edges.some((e: { id: string }) => e.id === draftEdgeId)).toBe(true);
    await vi.waitFor(() => expect(container.textContent).toContain('生成中，输入连线只读'), { timeout: 3000 });
  });

  it('建任务 401：草稿回退待生成（标题恢复「音频草稿」），卡片与参数保留', async () => {
    const { ApiError } = await import('@/shared/api/http');
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
    const { ApiError } = await import('@/shared/api/http');
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
    expect(promptTextarea()).toBeTruthy();
  });
});

describe('IKFCXE 音频文本附件：到节点选择文本卡建连线', () => {
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
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('button')].find(b => b.title === '从节点添加素材')!.click());
    await act(async () => flowProps.current.onNodeClick(flowProps.current.mediaNodes.find((n: Node) => n.id === 'm1')));
    await vi.waitFor(() => expect(container.querySelector('[data-testid="audio-ref-thumb"]')).not.toBeNull());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="移除 雨声"]')!.click());
    expect(container.querySelector('[data-testid="audio-ref-thumb"]')).toBeNull();
    await openDraftPanel();
    expect(container.querySelector('[data-testid="audio-ref-thumb"]')).toBeNull();
  });
});


describe('IKJUGX 音频与音乐页面接线和入口边界', () => {
  it('音乐真实发送按钮只记录回调并清正文，关闭后卸载局部歌词', async () => {
    await renderPage();
    await clickSidebarAudio();
    await waitModelReady();
    await act(async () => { audioDialogProps.current!.onSwitchToMusic!(); });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await typePromptRefText(container, '海风旋律');
      const lyrics = container.querySelector<HTMLTextAreaElement>('textarea')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(lyrics, '局部歌词');
        lyrics.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => { container.querySelector<HTMLButtonElement>('button[title="发送"]')!.click(); });
      expect(log).toHaveBeenCalledWith('Music dialog send:', '海风旋律', expect.any(String), { instrumental: false, speed: 1, lyrics: '局部歌词' }, []);
      expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
      expect(readPromptRefText(container)).toBe('');
      expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('局部歌词');
      await act(async () => { container.querySelector<HTMLButtonElement>('button[title="关闭"]')!.click(); });
      expect(container.querySelector('textarea')).toBeNull();
      await act(async () => { audioDialogProps.current!.onSwitchToMusic!(); });
      expect(container.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
    } finally { log.mockRestore(); }
  });

  it('音频到音乐仅验证既有页面回调；真实音乐菜单可切回干净自由音频', async () => {
    seedEmptyDraftDoc();
    await renderPage();
    await openDraftPanel();
    await waitModelReady();
    await typePrompt('原草稿正文');
    expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent?.trim() === 'AI 音乐')).toBe(false);
    expect(audioDialogProps.current?.onSwitchToMusic).toBeTypeOf('function');
    await act(async () => { audioDialogProps.current!.onSwitchToMusic!(); });
    expect(container.querySelector('[data-testid="audio-input"]')).toBeNull();
    const musicMode = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'AI 音乐')!;
    await act(async () => { musicMode.click(); });
    await clickSelectOption('音频生成');
    await waitModelReady();
    expect(readPromptRefText(container)).toBe('');
    expect(audioDialogProps.current?.draftBinding).toBeUndefined();
    await typePrompt('切回自由输入');
    expect(flowProps.current.mediaNodes.find((node: Node) => node.id === 'd1').data.prompt).toBe('原草稿正文');
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });
});
