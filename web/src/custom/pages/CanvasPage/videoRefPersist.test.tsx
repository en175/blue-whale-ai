// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { clickSelectOption } from './testing/radixSelect';
import { readPromptRefText, typePromptRefRaw, typePromptRefText } from './testing/promptRefEditor';
import type { GenerationModel, ModelFeatures } from '@/custom/api/generation';
import { Toaster, toast } from 'sonner';

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

vi.mock('./components/CanvasToolbar', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));

vi.mock('./components/CanvasHeader', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));

vi.mock('./components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

vi.mock('@/custom/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/custom/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchMe: vi.fn(async () => null),
  fetchCredits: vi.fn(async () => ({})),
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
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
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
  createVideoEnhancement: apiMocks.createVideoEnhancement,
  createMediaExtraction: apiMocks.createMediaExtraction,
  createAudioTrim: apiMocks.createAudioTrim,
  readJobFailText: apiMocks.readJobFailText,
}));

vi.mock('@/custom/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));

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
      video_reference: modelId === 'seedance-2',
      video_reference_max: 3,
      audio_reference: modelId === 'seedance-2',
      audio_reference_max: 3,
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

vi.mock('@/custom/api/generation', () => ({
  fetchGenerationModels: apiGenerationMocks.fetchGenerationModels,
}));

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
  await typePromptRefText(container, text);
}

async function clickNode(id: string) {
  const node = flowProps.current.mediaNodes.find((n: Node) => n.id === id)
    ?? flowProps.current.textNodes.find((n: Node) => n.id === id)!;
  await act(async () => {
    flowProps.current.onNodeClick(node);
  });
}

const edgePairs = () =>
  flowProps.current.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`);

const edgeRoles = () =>
  flowProps.current.edges.map((e: { data?: { refRole?: string } }) => e.data?.refRole ?? 'reference');

function dockRefNames(): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-testid="dock-video-ref"]')].map(
    (el) => el.title,
  );
}

function frameBadges(): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-testid="ref-thumb-badge"]')].map((el) => el.textContent ?? '');
}

async function clickActionBarPickReference() {
  await vi.waitFor(() => {
    const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === '参考');
    expect(btn).toBeTruthy();
  });
  await act(async () => {
    [...container.querySelectorAll('button')].find((b) => b.textContent === '参考')!.click();
  });
}

async function pickRefNode(slotTitle: string, nodeId: string) {
  if (slotTitle === '从资产中选择 / 从节点添加素材') {
    await clickActionBarPickReference();
    await clickNode(nodeId);
    return;
  }
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

async function enterPick(slotTitle: string) {
  if (slotTitle === '从资产中选择 / 从节点添加素材') {
    await clickActionBarPickReference();
    return;
  }
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
}

async function pressEscape() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
}

async function waitModelReady() {
  await vi.waitFor(() => expect(container.textContent).toContain('测试视频模型'), { timeout: 3000 });
}

function panelVisible(): boolean {
  return container.querySelector('[contenteditable="true"]') !== null;
}

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

async function switchModel(currentLabel: string, targetLabel: string) {
  const summaryOf = (label: string) =>
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => (b.textContent ?? '').includes(label) && (b.textContent ?? '').includes('|'),
    )!;
  await act(async () => { summaryOf(currentLabel).click(); });
  await act(async () => {
    [...container.querySelectorAll('button')].find((b) => b.textContent === currentLabel)!.click();
  });
  await clickSelectOption(targetLabel);
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

describe('IKFDFW 视频参考即时保存与角色恢复', () => {
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

    await enterPick('从资产中选择 / 从节点添加素材');
    await clickNode('m1');
    expect(edgePairs()).toEqual(['m1->d1']);
    expect(edgeRoles()).toEqual(['reference']);
    await clickNode('v1');
    expect(edgePairs()).toEqual(['m1->d1', 'v1->d1']);
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图', '参考视频']), { timeout: 3000 });

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

    const removeButtons = () => [...container.querySelectorAll<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title="移除"]')];
    await act(async () => { removeButtons().at(-1)!.click(); });
    expect(edgePairs()).toEqual(['m1->d1']);
    expect(edgeRoles()).toEqual(['first']);
    await vi.waitFor(() => expect(container.textContent).toContain('请补充尾帧'));

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
    expect(container.querySelector('[data-testid="video-send"]')).toBeNull();
  });

  it('普通参考生成请求角色校验：references 按连线顺序提交 reference 角色', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await enterPick('从资产中选择 / 从节点添加素材');
    await clickNode('m1');
    await clickNode('v1');
    await pressEscape();
    await typePrompt('多媒体参考');
    await act(async () => { sendButton().click(); });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.target_node_id).toBe('d1');
    expect(payload.references).toEqual([
      { asset_id: 'a1', type: 'image', role: 'reference' },
      { asset_id: 'a3', type: 'video', role: 'reference' },
    ]);
    expect(container.querySelector('[data-testid="video-send"]')).toBeNull();
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

    await closePanel();
    expect(panelVisible()).toBe(false);
    expect(edgePairs()).toEqual(['m1->d1', 'm2->d1']);
    expect(edgeRoles()).toEqual(['first', 'last']);

    await clickNode('d1');
    await vi.waitFor(() => expect(panelVisible()).toBe(true));
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图', '次图']));
    await vi.waitFor(() => expect(frameBadges()).toEqual(['首帧', '尾帧']));
    expect(readPromptRefText(container)).toBe('保留我的编辑');
    await vi.waitFor(() => expect(container.textContent).toContain('测试视频模型'));
    await vi.waitFor(() => expect(container.textContent).toContain('720p'), { timeout: 3000 });
  });

  it('点击画布空白：视频面板统一关闭（IKFYH6 推翻旧「不关」设计），参考与提示词保留，重开恢复', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await pickRefNode('从资产中选择 / 从节点添加素材', 'm1');
    await pressEscape();
    await typePrompt('空白点击保留');
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图']));

    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(panelVisible()).toBe(false);
    expect(edgePairs()).toEqual(['m1->d1']);

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

    await enterPick('从资产中选择 / 从节点添加素材');
    await clickNode('m1');
    await clickNode('v1');
    await pressEscape();
    await typePrompt('A 的提示词');
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图', '参考视频']));

    await clickNode('d2');
    await vi.waitFor(() => expect(dockRefNames()).toEqual([]));
    expect(readPromptRefText(container)).toBe('');
    await typePrompt('B 的提示词');

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

    apiMocks.saveCanvasDoc.mockImplementation(() => Promise.reject(new Error('boom')));
    await pickRefNode('从资产中选择 / 从节点添加素材', 'm1');
    expect(edgePairs()).toEqual(['m1->d1']);
    await pressEscape();

    await vi.waitFor(() => expect(container.textContent).toContain('保存失败，请重试'), { timeout: 3000 });
    expect(edgePairs()).toEqual(['m1->d1']);
    expect(dockRefNames()).toEqual(['首图']);

    await clickNode('d2');
    expect(dockRefNames()).toEqual(['首图']);
    expect(readPromptRefText(container)).toBe('保存前编辑');
    expect(sendButton().disabled).toBe(true);

    await closePanel();
    expect(panelVisible()).toBe(false);
    await clickNode('d1');
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图']));

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
    await pressEscape();
    await typePrompt('参考绘制');
    expect(sendButton().disabled).toBe(false);

    await switchModel('测试视频模型', '普通视频模型');
    await vi.waitFor(() => expect(container.textContent).toContain('当前模型不支持视频素材参考'));
    expect(sendButton().disabled).toBe(true);
    expect(dockRefNames()).toEqual(['参考视频']);
    expect(edgePairs()).toEqual(['v1->d1']);

    await switchModel('普通视频模型', '测试视频模型');
    await vi.waitFor(() => expect(container.textContent).not.toContain('当前模型不支持视频素材参考'));
    expect(sendButton().disabled).toBe(false);
  });

  it('面板移除普通引用后关闭重开不复活，其他目标的引用保持完整', async () => {
    pushDraftNode('d2');
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await pickRefNode('从资产中选择 / 从节点添加素材', 'm1');
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图']));
    await act(async () => {
      flowProps.current.onConnect({ source: 'm2', target: 'd2' });
    });
    expect(edgePairs()).toEqual(['m1->d1', 'm2->d2']);

    const removeBtn = container.querySelector<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title="移除"]')!;
    await act(async () => {
      removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(dockRefNames()).toEqual([]));
    expect(edgePairs()).toEqual(['m2->d2']);

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
      videoModel('cap1-video', '单参考视频模型', { image_reference_max: 1, video_reference_max: 0, audio_reference_max: 0 }),
    ]);
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await enterPick('从资产中选择 / 从节点添加素材');
    await clickNode('m1');
    await clickNode('m2');
    expect(edgePairs()).toEqual(['m1->d1', 'm2->d1']);
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图', '次图']));
    await pressEscape();
    await typePrompt('两张参考');
    expect(sendButton().disabled).toBe(false);

    await switchModel('测试视频模型', '单参考视频模型');
    await vi.waitFor(() => expect(container.textContent).toContain('参考图最多 1 张'));
    expect(sendButton().disabled).toBe(true);
    expect(dockRefNames()).toEqual(['首图', '次图']);
    expect(edgePairs()).toEqual(['m1->d1', 'm2->d1']);

    const removeButtons = () => [...container.querySelectorAll<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title="移除"]')];
    await act(async () => { removeButtons()[0]!.click(); });
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['次图']));
    await vi.waitFor(() => expect(container.textContent).not.toContain('参考图最多 1 张'));
    expect(sendButton().disabled).toBe(false);
  });

  it('@ 菜单选择画布图片：立即建立连线并在正文插入素材标签', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await typePromptRefRaw(container, '参考@首');
    await vi.waitFor(() => expect(document.body.querySelector('[data-testid="mention-menu"] button')).toBeTruthy());
    const item = [...document.body.querySelectorAll<HTMLButtonElement>('[data-testid="mention-menu"] button')].find(
      (b) => b.textContent?.includes('首图'),
    )!;
    await act(async () => { item.click(); });

    expect(edgePairs()).toEqual(['m1->d1']);
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图']));
  });
});

describe('IKFR4Y 视频参考持续选取与首尾帧连续替换', () => {
  function pickLock(): boolean {
    return flowProps.current.refPickActive === true;
  }

  function pickMarks(): string[] {
    return (flowProps.current.refPickMarkedIds ?? []) as string[];
  }

  function finishButton(): HTMLButtonElement | undefined {
    return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === '完成选取',
    );
  }

  async function finishPick() {
    await act(async () => {
      finishButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  function panelOpen(): boolean {
    return container.querySelector('[data-testid="video-send"]') !== null;
  }

  async function closePanel() {
    const btn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('title') === '关闭',
    )!;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  function pushMediaNode(id: string, assetId: string, name: string, mediaType: 'image' | 'video' = 'image') {
    const doc = canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> };
    doc.nodes.push({
      id, type: 'mediaNode', position: { x: 0, y: 700 },
      data: { src: `http://img/${id}.png`, mediaType, fileName: name, assetId },
    });
    (canvasDocMock.current.assets as Record<string, unknown>)[assetId] =
      { asset_id: Number(assetId.slice(1)), type: mediaType, access_url: `http://img/${id}.png`, width: 100, height: 100 };
  }

  function pushTextNode(id: string, text: string) {
    (canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> }).nodes.push({
      id, type: 'textNode', position: { x: 0, y: 900 }, data: { text },
    });
  }

  function seedKeyframeSlots() {
    seedDoc('keyframe');
    const doc = canvasDocMock.current.doc as { edges: unknown[] };
    doc.edges = [
      { id: 'e-m1-d1', source: 'm1', target: 'd1' },
      { id: 'e-m2-d1', source: 'm2', target: 'd1' },
    ];
  }

  const dockRemoveButtons = () =>
    [...container.querySelectorAll<HTMLButtonElement>('[data-testid="dock-video-ref"] button[title="移除"]')];

  it('一次进入连续选取图片+视频：逐条建线保持模式，Dock 与勾选同步，自动保存上送', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await enterPick('从资产中选择 / 从节点添加素材');
    expect(pickLock()).toBe(true);
    expect(finishButton()).toBeTruthy();
    await clickNode('m1');
    expect(edgePairs()).toEqual(['m1->d1']);
    expect(pickLock()).toBe(true);
    await clickNode('v1');
    expect(edgePairs()).toEqual(['m1->d1', 'v1->d1']);
    expect([...pickMarks()].sort()).toEqual(['m1', 'v1']);
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图', '参考视频']));

    await vi.waitFor(() => {
      const saved = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
      expect(saved.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`))
        .toEqual(['m1->d1', 'v1->d1']);
    }, { timeout: 3000 });
  });

  it('重复选择不重复：提示已跳过且模式持续；视频满额明确提示不写入不退出', async () => {
    pushMediaNode('v2', 'a6', '参考视频二', 'video');
    pushMediaNode('v3', 'a7', '参考视频三', 'video');
    pushMediaNode('v4', 'a8', '参考视频四', 'video');
    const doc = canvasDocMock.current.doc as { edges: unknown[] };
    doc.edges = [
      { id: 'e-v1-d1', source: 'v1', target: 'd1' },
      { id: 'e-v2-d1', source: 'v2', target: 'd1' },
      { id: 'e-v3-d1', source: 'v3', target: 'd1' },
    ];
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await enterPick('从资产中选择 / 从节点添加素材');
    await clickNode('m1');
    await clickNode('m1');
    expect(edgePairs()).toHaveLength(4);
    expect(pickLock()).toBe(true);

    await clickNode('v4');
    await vi.waitFor(() => expect(container.textContent).toContain('参考视频最多 3 个'), { timeout: 3000 });
    expect(edgePairs()).toHaveLength(4);
    expect(pickLock()).toBe(true);
    await clickNode('m2');
    expect(edgePairs()).toHaveLength(5);
  });

  it('普通参考会话选文本卡：建附件边并保持模式，非法来源提示后继续选取', async () => {
    pushTextNode('t1', '普通文本上下文');
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await enterPick('从资产中选择 / 从节点添加素材');
    await clickNode('t1');
    expect(edgePairs()).toEqual(['t1->d1']);
    expect(pickLock()).toBe(true);
    expect(pickMarks()).toEqual([]);
    await clickNode('m1');
    expect(edgePairs()).toEqual(['t1->d1', 'm1->d1']);
  });

  it('首帧槽位连续替换 A→B→再选 B：最终仅 B 占用，其他参考不动，保存与重开恢复', async () => {
    seedKeyframeSlots();
    pushMediaNode('m3', 'a5', '替换图一');
    pushMediaNode('m4', 'a6', '替换图二');
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await vi.waitFor(() => expect(frameBadges()).toEqual([]));

    await enterPick('添加首帧（从资产中选择 / 从节点添加素材）');
    expect(pickLock()).toBe(true);
    await clickNode('m3');
    expect(edgePairs().sort()).toEqual(['m1->d1', 'm2->d1', 'm3->d1']);
    expect(edgeRoles().sort()).toEqual(['first', 'reference', 'reference']);
    expect(pickMarks()).toEqual(['m3']);
    await clickNode('m4');
    expect(edgePairs().sort()).toEqual(['m1->d1', 'm2->d1', 'm4->d1']);
    expect(edgeRoles().sort()).toEqual(['first', 'reference', 'reference']);
    expect(pickMarks()).toEqual(['m4']);
    await clickNode('m4');
    expect(edgePairs().sort()).toEqual(['m1->d1', 'm2->d1', 'm4->d1']);

    await vi.waitFor(() => expect(dockRefNames()).toEqual(['替换图二']));
    expect(frameBadges()).toEqual(['首帧']);
    await vi.waitFor(() => {
      const saved = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
      expect(saved.edges.map((e: { source: string; data?: { refRole?: string } }) => `${e.source}:${e.data?.refRole ?? 'reference'}`).sort())
        .toEqual(['m1:reference', 'm2:reference', 'm4:first']);
    }, { timeout: 3000 });

    await pressEscape();
    await closePanel();
    await clickNode('d1');
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['替换图二']));
    expect(frameBadges()).toEqual(['首帧']);
    expect(finishButton()).toBeUndefined();
  });

  it('尾帧槽位连续替换：同款语义，首帧与普通参考不动', async () => {
    seedKeyframeSlots();
    pushMediaNode('m3', 'a5', '替换图一');
    pushMediaNode('m4', 'a6', '替换图二');
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await enterPick('添加尾帧（从资产中选择 / 从节点添加素材）');
    await clickNode('m3');
    expect(edgeRoles().sort()).toEqual(['last', 'reference', 'reference']);
    expect(pickMarks()).toEqual(['m3']);
    await clickNode('m4');
    expect(edgePairs().sort()).toEqual(['m1->d1', 'm2->d1', 'm4->d1']);
    expect(edgeRoles().sort()).toEqual(['last', 'reference', 'reference']);
    expect(pickMarks()).toEqual(['m4']);
    expect(frameBadges()).toEqual(['尾帧']);
  });

  it('首尾帧会话拒绝视频素材与文本：不写入保持模式，不绕过仅图片限制', async () => {
    seedKeyframeSlots();
    pushTextNode('t1', '文本上下文');
    pushMediaNode('m3', 'a5', '替换图一');
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await enterPick('添加首帧（从资产中选择 / 从节点添加素材）');
    await clickNode('v1');
    await vi.waitFor(() => expect(container.textContent).toContain('首尾帧仅支持图片素材'), { timeout: 3000 });
    expect(edgePairs().sort()).toEqual(['m1->d1', 'm2->d1']);
    expect(pickLock()).toBe(true);
    await clickNode('t1');
    await vi.waitFor(() => expect(container.textContent).toContain('首尾帧仅支持图片素材'), { timeout: 3000 });
    expect(flowProps.current.edges.some((e: { source: string }) => e.source === 't1')).toBe(false);
    expect(pickLock()).toBe(true);
    await clickNode('m3');
    expect(edgeRoles().sort()).toEqual(['first', 'reference', 'reference']);
  });

  it('会话中 Dock 移除：勾选同步消失，同模式可立即再次选择', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await enterPick('从资产中选择 / 从节点添加素材');
    await clickNode('m1');
    expect(pickMarks()).toEqual(['m1']);

    await act(async () => { dockRemoveButtons()[0]!.click(); });
    expect(edgePairs()).toEqual([]);
    expect(pickMarks()).toEqual([]);
    expect(pickLock()).toBe(true);

    await clickNode('m1');
    expect(edgePairs()).toEqual(['m1->d1']);
    expect(pickMarks()).toEqual(['m1']);
  });

  it('模式内空白点击只退选取：面板保留；再点空白关面板（IKFYH6 拍板 4）', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await enterPick('从资产中选择 / 从节点添加素材');
    await clickNode('m1');
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(pickLock()).toBe(false);
    expect(panelOpen()).toBe(true);
    expect(edgePairs()).toEqual(['m1->d1']);

    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(panelOpen()).toBe(false);
    expect(edgePairs()).toEqual(['m1->d1']);
  });

  it('完成按钮退出：保留参考与原目标 Dock，恢复编辑与普通切换；迟到选中事件不串目标', async () => {
    pushDraftNode('d2');
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await enterPick('从资产中选择 / 从节点添加素材');
    await clickNode('m1');
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [flowProps.current.mediaNodes.find((n: Node) => n.id === 'm2')!], edges: [] });
    });
    expect(panelOpen()).toBe(true);

    await finishPick();
    expect(pickLock()).toBe(false);
    expect(finishButton()).toBeUndefined();
    expect(panelOpen()).toBe(true);
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图']));
    expect(edgePairs()).toEqual(['m1->d1']);
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();

    await clickNode('d2');
    await vi.waitFor(() => expect(dockRefNames()).toEqual([]));
  });

  it('Esc 退出与关闭面板退出：保留参考，重开为普通模式（不恢复会话）', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await enterPick('从资产中选择 / 从节点添加素材');
    await clickNode('m1');
    await pressEscape();
    expect(pickLock()).toBe(false);
    expect(panelOpen()).toBe(true);
    expect(edgePairs()).toEqual(['m1->d1']);

    await closePanel();
    expect(pickLock()).toBe(false);
    await clickNode('d1');
    await vi.waitFor(() => expect(panelOpen()).toBe(true));
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['首图']));
    expect(finishButton()).toBeUndefined();
    expect(container.textContent).not.toContain('点击画布中的');
  });

  it('会话中操作隔离：提示词只读、模式与模型入口禁用、发送禁用，Dock 移除可用', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await typePrompt('会话前的编辑');

    await enterPick('从资产中选择 / 从节点添加素材');
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
    const modeBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => (b.textContent ?? '').includes('文生视频') && !(b.textContent ?? '').includes('|'),
    )!;
    expect(modeBtn.disabled).toBe(true);
    const configBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => (b.textContent ?? '').includes('|'),
    )!;
    expect(configBtn.disabled).toBe(true);
    expect(sendButton().disabled).toBe(true);

    await clickNode('m1');
    expect(dockRemoveButtons()[0]!.disabled).toBe(false);

    await finishPick();
    expect(container.querySelector('[contenteditable="true"]')).not.toBeNull();
    expect(sendButton().disabled).toBe(false);
  });

  it('会话中保存失败：参考与模式保持并显示未保存，完成选取后参考保留', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await typePrompt('保存前编辑');

    apiMocks.saveCanvasDoc.mockImplementation(() => Promise.reject(new Error('boom')));
    await enterPick('从资产中选择 / 从节点添加素材');
    await clickNode('m1');
    expect(edgePairs()).toEqual(['m1->d1']);
    await vi.waitFor(() => expect(container.textContent).toContain('保存失败，请重试'), { timeout: 3000 });
    expect(pickLock()).toBe(true);
    expect(dockRefNames()).toEqual(['首图']);

    await finishPick();
    expect(edgePairs()).toEqual(['m1->d1']);
    expect(dockRefNames()).toEqual(['首图']);
  });

  it('活动目标被删除：结束会话并关闭面板，后续点击不写入已删目标', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await enterPick('从资产中选择 / 从节点添加素材');
    await clickNode('m1');
    expect(pickLock()).toBe(true);

    await act(async () => {
      flowProps.current.onDeleteNode(['d1']);
    });
    await vi.waitFor(() => expect(panelOpen()).toBe(false));
    expect(pickLock()).toBe(false);
    expect(finishButton()).toBeUndefined();

    await clickNode('m1');
    expect(edgePairs().some((p: string) => p.endsWith('->d1'))).toBe(false);
  });
});

describe('IKHBO 视频/音频参考门控读能力行（不按模型名前缀）', () => {
  beforeEach(() => {
    apiMocks.saveCanvasDoc.mockImplementation(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' }));
  });

  function bindDraftModel(modelId: string) {
    const doc = canvasDocMock.current.doc as { nodes: Array<{ id: string; data: Record<string, unknown> }> };
    doc.nodes.find((n) => n.id === 'd1')!.data.draftModelId = modelId;
  }

  it('Seedance 2.5（video_reference=true）携带视频参考可提交，references 按连线提交', async () => {
    const model25 = videoModel('doubao-seedance-2-5-260628', 'Seedance 2.5', {
      video_reference: true,
      audio_reference: true,
      video_reference_max: 3,
      audio_reference_max: 3,
    });
    apiGenerationMocks.fetchGenerationModels.mockImplementation(async (): Promise<GenerationModel[]> => [model25]);
    bindDraftModel('doubao-seedance-2-5-260628');
    await renderPage();
    await clickNode('d1');
    await vi.waitFor(() => expect(container.textContent).toContain('Seedance 2.5'));

    await pickRefNode('从资产中选择 / 从节点添加素材', 'v1');
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['参考视频']));
    await pressEscape();
    await typePrompt('参考视频再生成');
    await vi.waitFor(() => expect(sendButton().disabled).toBe(false));
    await act(async () => { sendButton().click(); });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.parameters.model_id).toBe('doubao-seedance-2-5-260628');
    expect(payload.references).toEqual([{ asset_id: 'a3', type: 'video', role: 'reference' }]);
  });

  it('Seedance 2.0（video_reference=false）携带视频参考被拒绝且不发起任务', async () => {
    const model20 = videoModel('doubao-seedance-2-0-260128', 'Seedance 2.0', {
      video_reference: false,
      audio_reference: false,
      video_reference_max: 3,
      audio_reference_max: 3,
    });
    apiGenerationMocks.fetchGenerationModels.mockImplementation(async (): Promise<GenerationModel[]> => [model20]);
    bindDraftModel('doubao-seedance-2-0-260128');
    await renderPage();
    await clickNode('d1');
    await vi.waitFor(() => expect(container.textContent).toContain('Seedance 2.0'));

    await pickRefNode('从资产中选择 / 从节点添加素材', 'v1');
    await vi.waitFor(() => expect(dockRefNames()).toEqual(['参考视频']));
    await pressEscape();
    await typePrompt('参考视频再生成');

    await vi.waitFor(() => expect(container.textContent).toContain('当前模型不支持视频素材参考'));
    expect(sendButton().disabled).toBe(true);
    await act(async () => { sendButton().click(); });
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });
});
