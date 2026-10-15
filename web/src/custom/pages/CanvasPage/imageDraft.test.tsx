// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { promptRefReadOnly, readPromptRefText, typePromptRefText } from './testing/promptRefEditor';


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
  fetchMe: vi.fn(async () => null),
  fetchCredits: vi.fn(async () => ({})),
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
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => Promise.resolve({ items: [] }), retry: false }),
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
      edges: [{ id: 'e1', source: 't1', target: 'm1' }],
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
            mediaType: 'image',
            fileName: '图片草稿',
            genStatus: 'draft',
            draft: true,
            prompt: '恢复的提示词',
            draftModelId: 'm-test',
            draftSize: '2k',
            draftRatio: '1:1',
            targetRatio: '1:1',
          },
        },
      ],
      edges: [{ id: 'e2', source: 't1', target: 'd1' }],
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
          data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '' },
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
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === '发送',
  )!;
}

function promptTextarea(): HTMLElement {
  const el = container.querySelector('[contenteditable]');
  if (!el) throw new Error('PromptRefEditor 未挂载');
  return el as HTMLElement;
}

async function typePrompt(text: string) {
  await typePromptRefText(container, text);
}

function draftNodes(): Node[] {
  return flowProps.current.mediaNodes.filter((n: Node) => n.data?.draft === true);
}

async function clickSidebarImage() {
  await act(async () => {
    toolbarProps.current.onToggleImageDialog();
  });
}

async function openDraftPanel(): Promise<string> {
  const draft = flowProps.current.mediaNodes.find((n: Node) => n.id === 'd1')!;
  await act(async () => {
    flowProps.current.onNodeClick(draft);
  });
  return 'd1';
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

describe('IKDMQQ 图片草稿创建与编辑', () => {
  it('侧栏图片入口先建草稿卡再开绑定面板：不创建任务（1f2f498d 起入口统一建卡）', async () => {
    await renderPage();
    const before = flowProps.current.mediaNodes.length;

    await clickSidebarImage();

    expect(flowProps.current.mediaNodes).toHaveLength(before + 1);
    expect(draftNodes()).toHaveLength(1);
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    expect(promptTextarea()).toBeTruthy();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    expect(sendButton().disabled).toBe(true);
  });

  it('侧栏入口发送：绑定新建草稿卡生成（带 target_node_id），不另落生成卡', async () => {
    await renderPage();
    await clickSidebarImage();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await typePrompt('自由模式画图');

    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.type).toBe('image');
    expect(typeof payload.target_node_id).toBe('string');
    expect(payload.parameters.prompt).toBe('自由模式画图');
    expect(payload.parameters.model_id).toBe('m-test');
    expect(flowProps.current.mediaNodes).toHaveLength(2);
    expect(container.querySelector('[contenteditable]')).toBeNull();
  });

  it('连续点击侧栏入口：每次新建草稿卡，面板保持打开', async () => {
    await renderPage();

    await clickSidebarImage();
    await clickSidebarImage();

    expect(flowProps.current.mediaNodes).toHaveLength(3);
    expect(draftNodes()).toHaveLength(2);
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    expect(promptTextarea()).toBeTruthy();
  });

  it('面板编辑实时写回草稿节点（提示词与模型/分辨率/比例参数）', async () => {
    seedEmptyDraftDoc();
    await renderPage();
    const draftId = await openDraftPanel();

    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await typePrompt('画一只蓝鲸');

    const draft = () => flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!;
    await vi.waitFor(() => expect(draft().data.prompt).toBe('画一只蓝鲸'));
    expect(draft().data.draftModelId).toBe('m-test');
    expect(draft().data.draftSize).toBe('2k');
    expect(draft().data.draftRatio).toBe('1:1');
    expect(draft().data.targetRatio).toBe('1:1');

    await vi.waitFor(
      () => {
        const last = apiMocks.saveCanvasDoc.mock.calls.at(-1);
        expect(last).toBeTruthy();
        const saved = last![1].nodes.find((n) => n.id === draftId)!;
        expect(saved.data.prompt).toBe('画一只蓝鲸');
        expect(saved.data.draftModelId).toBe('m-test');
      },
      { timeout: 3000 },
    );
  });

  it('水合恢复草稿：不标素材缺失；点击草稿卡重开面板恢复参数与文本附件', async () => {
    seedDraftDoc();
    await renderPage();

    const draft = flowProps.current.mediaNodes.find((n: Node) => n.id === 'd1')!;
    expect(draft.data.genStatus).toBe('draft');
    expect(draft.data.assetMissing).toBeUndefined();

    await act(async () => {
      flowProps.current.onNodeClick(draft);
    });

    expect(readPromptRefText(container)).toBe('恢复的提示词');
    await vi.waitFor(() => expect(container.querySelectorAll('[data-testid="dock-text-ref"]')).toHaveLength(1));
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    expect(container.textContent).toContain('1:1');
    expect(container.textContent).toContain('2K');
  });
});

describe('IKDMQQ 原位提交与首次生成', () => {
  it('点击生成才提交：先落盘后建任务、节点数不变、成功回填同一张卡', async () => {
    seedEmptyDraftDoc();
    await renderPage();
    const draftId = await openDraftPanel();
    const positionBefore = { ...flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!.position };

    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await typePrompt('画一只蓝鲸');
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    const [projectId, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(projectId).toBe('p1');
    expect(payload.type).toBe('image');
    expect(payload.target_node_id).toBe(draftId);
    expect(payload.parameters.prompt).toBe('画一只蓝鲸');
    expect(payload.parameters.model_id).toBe('m-test');

    expect(apiMocks.saveCanvasDoc).toHaveBeenCalled();
    expect(apiMocks.saveCanvasDoc.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      apiMocks.createGenerationJob.mock.invocationCallOrder[0]!,
    );

    expect(flowProps.current.mediaNodes).toHaveLength(2);

    await vi.waitFor(() => {
      const node = flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!;
      expect(node.data.genStatus).toBeUndefined();
    });
    const done = flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!;
    expect(done.position).toEqual(positionBefore);
    expect(done.data.src).toBe('http://img/out.png');
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
    await renderPage();
    await openDraftPanel();
    const draftId = 'd1';

    await act(async () => {
      flowProps.current.onConnect({ source: 't1', target: draftId, sourceHandle: null, targetHandle: null });
    });
    expect(flowProps.current.edges.some((e: { source: string; target: string }) => e.source === 't1' && e.target === draftId)).toBe(true);
    const draftEdgeId = flowProps.current.edges.find((e: { source: string; target: string }) => e.target === draftId)!.id;

    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await typePrompt('画一只蓝鲸');
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => {
      const node = flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!;
      expect(node.data.genStatus).toBe('generating');
    });

    expect(container.querySelector('[contenteditable]')).toBeNull();

    await openDraftPanel();
    expect(promptRefReadOnly(container)).toBe(true);
    expect(sendButton().disabled).toBe(true);

    await act(async () => {
      flowProps.current.onConnect({ source: 'm1', target: draftId, sourceHandle: null, targetHandle: null });
    });
    expect(flowProps.current.edges.some((e: { source: string; target: string }) => e.source === 'm1' && e.target === draftId)).toBe(false);

    await act(async () => {
      flowProps.current.onEdgesChange([{ type: 'remove', id: draftEdgeId }]);
    });
    expect(flowProps.current.edges.some((e: { id: string }) => e.id === draftEdgeId)).toBe(true);
    expect(container.textContent).toContain('生成中，输入连线只读');
  });

  it('建任务 401：草稿回退待生成（标题恢复「图片草稿」），卡片与参数保留', async () => {
    const { ApiError } = await import('@/shared/api/http');
    apiMocks.createGenerationJob.mockRejectedValueOnce(new ApiError(401, '未登录'));
    seedEmptyDraftDoc();
    await renderPage();
    const draftId = await openDraftPanel();

    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await typePrompt('画一只蓝鲸');
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    await vi.waitFor(() => {
      const node = flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!;
      expect(node.data.genStatus).toBe('draft');
    });
    const back = flowProps.current.mediaNodes.find((n: Node) => n.id === draftId)!;
    expect(back.data.fileName).toBe('图片草稿');
    expect(back.data.draft).toBe(true);
    expect(back.data.prompt).toBe('画一只蓝鲸');
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

    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await typePrompt('画一只蓝鲸');
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
    expect(failed.data.prompt).toBe('画一只蓝鲸');
    expect(flowProps.current.mediaNodes).toHaveLength(2);

    await act(async () => {
      flowProps.current.onNodeClick(failed);
    });
    expect(promptRefReadOnly(container)).toBe(false);
  });
});

describe('IKDMQQ 保存失败暂停生成与项目切换', () => {
  it('落盘失败中止提交并保留草稿；项目切换被阻断，保存恢复后放行', async () => {
    seedEmptyDraftDoc();
    await renderPage();
    const draftId = await openDraftPanel();

    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await typePrompt('画一只蓝鲸');

    apiMocks.saveCanvasDoc.mockImplementation(() => Promise.reject(new Error('boom')));
    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(container.textContent).toContain('保存失败，请重试'));
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    expect(flowProps.current.mediaNodes.some((n: Node) => n.id === draftId)).toBe(true);
    expect(promptTextarea()).toBeTruthy();

    await act(async () => {
      await headerProps.current.onSelectProject('p2');
    });
    expect(headerProps.current.currentProjectId).toBe('p1');

    apiMocks.saveCanvasDoc.mockImplementation(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' }));
    await act(async () => {
      const retry = [...container.querySelectorAll('button')].find(button => button.textContent === '重试保存');
      retry!.click();
    });
    await vi.waitFor(() => expect(container.textContent).toContain('已保存'));
    await act(async () => {
      await headerProps.current.onSelectProject('p2');
    });
    expect(headerProps.current.currentProjectId).toBe('p2');
  });
});
