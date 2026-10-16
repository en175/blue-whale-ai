// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../index';
import { clickSelectOption } from './radixSelect';
import { ATTACHMENT_ACTION_PICK_CANVAS_TITLE } from '../components/AttachmentActionBar';
import { readPromptRefText, typePromptRefRaw, typePromptRefText } from './promptRefEditor';
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
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => [
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
      features: {
        reference_image: true, image_reference_max: 9, watermark: false, quantity_max: 1,
        sequential_image_generation: false, stream: false, tools: false,
        first_frame: false, last_frame: false, first_last_frame: false, audio: false,
      },
      is_default: true,
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
        { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { title: '故事文案', text: '一只蓝鲸在海里' } },
        { id: 'm1', type: 'mediaNode', position: { x: 200, y: 0 }, data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '素材图一', assetId: 'a1' } },
        { id: 'v1', type: 'mediaNode', position: { x: 400, y: 0 }, data: { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '素材视频', assetId: 'a9' } },
        { id: 'd1', type: 'mediaNode', position: { x: 420, y: 160 }, data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '' } },
      ],
      edges: [],
    },
    assets: {
      a1: { asset_id: 1, type: 'image', access_url: 'http://img/m1.png', width: 100, height: 100 },
      a9: { asset_id: 9, type: 'video', access_url: 'http://vid/v1.mp4', width: 100, height: 100 },
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
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === '发送',
  )!;
}

async function typePrompt(text: string) {
  await typePromptRefText(container, text);
}

async function createDraft(): Promise<string> {
  const draft = flowProps.current.mediaNodes.find((n: Node) => n.id === 'd1')!;
  await act(async () => {
    flowProps.current.onNodeClick(draft);
  });
  return 'd1';
}

const edgePairs = () =>
  flowProps.current.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`);

function dockRefImages(): string[] {
  return [...container.querySelectorAll<HTMLImageElement>('[data-testid="dock-media-ref"] img')].map(
    (img) => img.alt,
  );
}

const enterPickMode = async () => {
  const entry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === ATTACHMENT_ACTION_PICK_CANVAS_TITLE,
  )!;
  await act(async () => {
    entry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

function pushImageNode(id: string, assetId: string, name: string) {
  (canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> }).nodes.push({
    id, type: 'mediaNode', position: { x: 240, y: 0 },
    data: { src: `http://img/${id}.png`, mediaType: 'image', fileName: name, assetId },
  });
  (canvasDocMock.current.assets as Record<string, unknown>)[assetId] = {
    asset_id: assetId, type: 'image', access_url: `http://img/${id}.png`,
  };
}

function pushDraftNode(id: string) {
  (canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> }).nodes.push({
    id, type: 'mediaNode', position: { x: 440, y: 160 },
    data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '' },
  });
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

describe('IKFDFT 图片参考即时保存与编辑恢复', () => {
  async function closePanel() {
    const btn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('title') === '关闭',
    )!;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  async function clickNode(id: string) {
    const node = flowProps.current.mediaNodes.find((n: Node) => n.id === id)!;
    await act(async () => {
      flowProps.current.onNodeClick(node);
    });
  }

  async function pickFromCanvas(sourceId: string) {
    await enterPickMode();
    await clickNode(sourceId);
  }

  async function finishPick() {
    const btn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === '完成选取',
    )!;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  function panelVisible(): boolean {
    return container.querySelector('[contenteditable="true"]') !== null;
  }

  async function switchModel(currentLabel: string, targetLabel: string) {
    let selectBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === currentLabel,
    );
    if (!selectBtn) {
      const configBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => (b.textContent ?? '').includes(currentLabel) && (b.textContent ?? '').includes(':'),
      )!;
      await act(async () => { configBtn.click(); });
      selectBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent === currentLabel,
      )!;
    }
    await act(async () => { selectBtn.click(); });
    await clickSelectOption(targetLabel);
    const toggle = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => (b.textContent ?? '').includes(targetLabel) && (b.textContent ?? '').includes(':'),
    )!;
    await act(async () => { toggle.click(); });
  }

  function modelVariant(
    modelId: string,
    label: string,
    features: Partial<ModelFeatures>,
    sizes: Array<{ id: string; label: string }> = [{ id: '2k', label: '2K' }],
  ): GenerationModel {
    return {
      model_id: modelId,
      provider_id: 'prov',
      model_label: label,
      icon: null,
      supported_sizes: sizes,
      default_size: sizes[0]?.id,
      supported_aspect_ratios: [{ id: '1:1', label: '1:1' }],
      supported_formats: [],
      supported_durations: null,
      default_format: null,
      default_aspect_ratio: '1:1',
      default_duration: null,
      features: {
        reference_image: false, image_reference_max: 9, watermark: false, quantity_max: 1,
        sequential_image_generation: false, stream: false, tools: false,
        first_frame: false, last_frame: false, first_last_frame: false, audio: false,
        ...features,
      },
      is_default: false,
      version: 1,
      digest: '',
    };
  }

  it('连续选取多项参考：立即逐条建立连线，身份、数量、顺序随自动保存完整上送', async () => {
    pushImageNode('m2', 'a2', '素材图二');
    pushImageNode('m3', 'a3', '素材图三');
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    expect(edgePairs()).toEqual([`m1->${draftId}`]);
    await clickNode('m2');
    expect(edgePairs()).toEqual([`m1->${draftId}`, `m2->${draftId}`]);
    await clickNode('m3');
    expect(edgePairs()).toEqual([`m1->${draftId}`, `m2->${draftId}`, `m3->${draftId}`]);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一', '素材图二', '素材图三']));

    await vi.waitFor(() => {
      const saved = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
      expect(saved.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`))
        .toEqual([`m1->${draftId}`, `m2->${draftId}`, `m3->${draftId}`]);
    }, { timeout: 3000 });
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });

  it('关闭按钮结束面板后重开：参考、提示词与配置完整恢复', async () => {
    apiMocks.fetchGenerationModels.mockImplementation(async () => [
      modelVariant('m-test', '测试生图模型', { reference_image: true, image_reference_max: 9 }),
      modelVariant('m-hd', '高清模型', { reference_image: true, image_reference_max: 9 }, [{ id: '4k', label: '4K' }]),
    ]);
    pushImageNode('m2', 'a2', '素材图二');
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    await clickNode('m2');
    await finishPick();
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一', '素材图二']));
    await typePrompt('保留我的编辑');
    await switchModel('测试生图模型', '高清模型');
    await vi.waitFor(() => expect(container.textContent).toContain('高清模型'));

    await closePanel();
    expect(panelVisible()).toBe(false);
    expect(edgePairs()).toEqual([`m1->${draftId}`, `m2->${draftId}`]);

    await clickNode(draftId);
    await vi.waitFor(() => expect(panelVisible()).toBe(true));
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一', '素材图二']));
    expect(readPromptRefText(container)).toBe('保留我的编辑');
    await vi.waitFor(() => expect(container.textContent).toContain('高清模型'));
    await vi.waitFor(() => expect(container.textContent).toContain('4K'), { timeout: 3000 });
  });

  it('点击空白隐藏面板后重开：参考与提示词保留，选取模式不恢复', async () => {
    pushImageNode('m2', 'a2', '素材图二');
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    await clickNode('m2');
    await finishPick();
    await typePrompt('空白隐藏保留');
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一', '素材图二']));

    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(panelVisible()).toBe(false);
    expect(edgePairs()).toEqual([`m1->${draftId}`, `m2->${draftId}`]);

    await clickNode(draftId);
    await vi.waitFor(() => expect(panelVisible()).toBe(true));
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一', '素材图二']));
    expect(readPromptRefText(container)).toBe('空白隐藏保留');
    expect([...container.querySelectorAll('button')].some((b) => b.textContent === '完成选取')).toBe(false);
  });

  it('A→B→A 切换编辑目标：A 的参考与提示词完整恢复，B 不串入', async () => {
    pushImageNode('m2', 'a2', '素材图二');
    pushDraftNode('d2');
    await renderPage();
    const aId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    await clickNode('m2');
    await finishPick();
    await typePrompt('A 的提示词');
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一', '素材图二']));

    await clickNode('d2');
    await vi.waitFor(() => expect(dockRefImages()).toEqual([]));
    expect(readPromptRefText(container)).toBe('');
    await typePrompt('B 的提示词');

    await clickNode(aId);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一', '素材图二']));
    expect(readPromptRefText(container)).toBe('A 的提示词');
  });

  it('保存失败：选择保留并显示未保存，阻止切换其他目标与发送，重试成功恢复', async () => {
    pushDraftNode('d2');
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await typePrompt('保存前编辑');

    apiMocks.saveCanvasDoc.mockImplementation(() => Promise.reject(new Error('boom')));
    await enterPickMode();
    await clickNode('m1');
    await vi.waitFor(() => expect(container.textContent).toContain('保存失败，请重试'), { timeout: 3000 });
    expect(flowProps.current.refPickActive).toBe(true);
    await finishPick();
    expect(edgePairs()).toEqual([`m1->${draftId}`]);

    await vi.waitFor(() => expect(container.textContent).toContain('保存失败，请重试'), { timeout: 3000 });
    expect(edgePairs()).toEqual([`m1->${draftId}`]);
    expect(dockRefImages()).toEqual(['素材图一']);

    await clickNode('d2');
    expect(dockRefImages()).toEqual(['素材图一']);
    expect(readPromptRefText(container)).toBe('保存前编辑');
    expect(sendButton().disabled).toBe(true);

    await closePanel();
    expect(panelVisible()).toBe(false);
    await clickNode(draftId);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));

    apiMocks.saveCanvasDoc.mockImplementation(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' }));
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === '重试保存')!;
    await act(async () => { retry.click(); });
    await vi.waitFor(() => expect(container.textContent).toContain('已保存'));
    const saved = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
    expect(saved.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`)).toEqual([`m1->${draftId}`]);
    expect(sendButton().disabled).toBe(false);
    await clickNode('d2');
    await vi.waitFor(() => expect(dockRefImages()).toEqual([]));
  });

  it('切换不支持参考的模型：保留全部参考、说明原因并阻止发送，换回兼容模型恢复', async () => {
    apiMocks.fetchGenerationModels.mockImplementation(async () => [
      modelVariant('m-test', '测试生图模型', { reference_image: true, image_reference_max: 9 }),
      modelVariant('m-noref', '无参考模型', {}),
    ]);
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    await finishPick();
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));
    await typePrompt('参考绘制');
    expect(sendButton().disabled).toBe(false);

    await switchModel('测试生图模型', '无参考模型');
    await vi.waitFor(() => expect(container.textContent).toContain('当前模型不支持图片参考，请调整模型或参考'));
    expect(sendButton().disabled).toBe(true);
    expect(dockRefImages()).toEqual(['素材图一']);
    expect(edgePairs()).toEqual([`m1->${draftId}`]);

    await switchModel('无参考模型', '测试生图模型');
    await vi.waitFor(() => expect(container.textContent).not.toContain('当前模型不支持图片参考'));
    expect(sendButton().disabled).toBe(false);
  });

  it('切换参考数量上限不足的模型：保留全部参考并说明原因，用户删除超限项后恢复发送', async () => {
    apiMocks.fetchGenerationModels.mockImplementation(async () => [
      modelVariant('m-test', '测试生图模型', { reference_image: true, image_reference_max: 9 }),
      modelVariant('m-cap1', '单参考模型', { reference_image: true, image_reference_max: 1 }),
    ]);
    pushImageNode('m2', 'a2', '素材图二');
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    await clickNode('m2');
    await finishPick();
    expect(edgePairs()).toEqual([`m1->${draftId}`, `m2->${draftId}`]);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一', '素材图二']));
    await typePrompt('两张参考');
    expect(sendButton().disabled).toBe(false);

    await switchModel('测试生图模型', '单参考模型');
    await vi.waitFor(() => expect(container.textContent).toContain('参考图片数量超过模型支持上限，请调整参考'));
    expect(sendButton().disabled).toBe(true);
    expect(dockRefImages()).toEqual(['素材图一', '素材图二']);

    const removeBtn = container.querySelector<HTMLButtonElement>('[data-testid="dock-media-ref"] button[title="移除"]')!;
    await act(async () => {
      removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图二']));
    await vi.waitFor(() => expect(container.textContent).not.toContain('参考图片数量超过模型支持上限'));
    expect(sendButton().disabled).toBe(false);
  });

  it('面板移除引用后关闭重开不复活', async () => {
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await pickFromCanvas('m1');
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));

    const removeBtn = container.querySelector<HTMLButtonElement>('[data-testid="dock-media-ref"] button[title="移除"]')!;
    await act(async () => {
      removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(dockRefImages()).toEqual([]));
    expect(edgePairs()).toEqual([]);

    await closePanel();
    await clickNode(draftId);
    await vi.waitFor(() => expect(panelVisible()).toBe(true));
    expect(dockRefImages()).toEqual([]);
  });

  it('@ 菜单选择画布图片：立即建立连线并在正文插入素材标签', async () => {
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await typePromptRefRaw(container, '参考@素');
    await vi.waitFor(() => expect(document.body.querySelector('[data-testid="mention-menu"] button')).toBeTruthy());
    const item = [...document.body.querySelectorAll<HTMLButtonElement>('[data-testid="mention-menu"] button')].find(
      (b) => b.textContent?.includes('素材图一'),
    )!;
    await act(async () => { item.click(); });

    expect(edgePairs()).toEqual([`m1->${draftId}`]);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));
    await vi.waitFor(() => expect(readPromptRefText(container)).toBe('参考图片1'));
  });
});

describe('IKFR4X 图片参考持续选取与完整退出闭环', () => {
  async function clickNode(id: string) {
    const node = flowProps.current.mediaNodes.find((n: Node) => n.id === id)!;
    await act(async () => {
      flowProps.current.onNodeClick(node);
    });
  }

  function pickLock(): boolean {
    return flowProps.current.refPickActive === true;
  }

  function pickMarks(): string[] {
    return (flowProps.current.refPickMarkedIds ?? []) as string[];
  }

  function panelOpen(): boolean {
    return [...container.querySelectorAll<HTMLButtonElement>('button')].some(
      (b) => b.getAttribute('title') === '发送',
    );
  }

  async function pressEscape() {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
  }

  async function finishPick() {
    await act(async () => {
      finishButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  function finishButton(): HTMLButtonElement | undefined {
    return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === '完成选取',
    );
  }

  it('一次进入连续选取三张：三次即时建线，Dock 持续可见，勾选随连线同步', async () => {
    pushImageNode('m2', 'a2', '素材图二');
    pushImageNode('m3', 'a3', '素材图三');
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    expect(pickLock()).toBe(true);
    for (const id of ['m1', 'm2', 'm3']) {
      await clickNode(id);
      expect(panelOpen()).toBe(true);
      expect(finishButton()).toBeTruthy();
    }
    expect(edgePairs()).toEqual([`m1->${draftId}`, `m2->${draftId}`, `m3->${draftId}`]);
    expect([...pickMarks()].sort()).toEqual(['m1', 'm2', 'm3']);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一', '素材图二', '素材图三']));

    await vi.waitFor(() => {
      const saved = apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];
      expect(saved.edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`))
        .toEqual([`m1->${draftId}`, `m2->${draftId}`, `m3->${draftId}`]);
    }, { timeout: 3000 });
  });

  it('重复点击已选节点：不新增、不移除，提示已连入且模式持续', async () => {
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    await clickNode('m1');
    expect(edgePairs()).toEqual([`m1->${draftId}`]);
    expect(pickMarks()).toEqual(['m1']);
    await vi.waitFor(() => expect(container.textContent).toContain('该素材已连入当前草稿'), { timeout: 3000 });
    expect(pickLock()).toBe(true);
  });

  it('非法来源明确提示原因：不写入、不退出、不关闭 Dock，改选合法来源可继续', async () => {
    await renderPage();
    await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('v1');
    expect(edgePairs()).toEqual([]);
    expect(pickLock()).toBe(true);
    expect(panelOpen()).toBe(true);
    await vi.waitFor(() => expect(container.textContent).toContain('图片参考仅支持图片素材'), { timeout: 3000 });

    await clickNode('m1');
    expect(edgePairs()).toEqual(['m1->d1']);
    expect(pickMarks()).toEqual(['m1']);
  });

  it('Dock 移除：勾选同步消失，同模式可立即再次选择', async () => {
    await renderPage();
    await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    expect(pickMarks()).toEqual(['m1']);

    const removeBtn = container.querySelector<HTMLButtonElement>('[data-testid="dock-media-ref"] button[title="移除"]')!;
    expect(removeBtn.disabled).toBe(false);
    await act(async () => {
      removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(dockRefImages()).toEqual([]));
    expect(edgePairs()).toEqual([]);
    expect(pickMarks()).toEqual([]);
    expect(pickLock()).toBe(true);

    await clickNode('m1');
    expect(edgePairs()).toEqual(['m1->d1']);
    expect(pickMarks()).toEqual(['m1']);
  });

  it('模式内空白点击只退选取：面板保留；再点空白关面板（IKFYH6 拍板 4）', async () => {
    pushImageNode('m2', 'a2', '素材图二');
    await renderPage();
    await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
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

  it('完成按钮退出：保留参考与原目标 Dock，恢复普通编辑与普通切换', async () => {
    pushDraftNode('d2');
    await renderPage();
    await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [flowProps.current.mediaNodes.find((n: Node) => n.id === 'm1')!], edges: [] });
    });
    expect(panelOpen()).toBe(true);
    await finishPick();
    expect(pickLock()).toBe(false);
    expect(finishButton()).toBeUndefined();
    expect(panelOpen()).toBe(true);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));
    expect(edgePairs()).toEqual(['m1->d1']);
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();

    await clickNode('d2');
    await vi.waitFor(() => expect(dockRefImages()).toEqual([]));
  });

  it('Esc 退出：保留参考与面板，画布交互锁解除', async () => {
    await renderPage();
    await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    await pressEscape();
    expect(pickLock()).toBe(false);
    expect(panelOpen()).toBe(true);
    expect(edgePairs()).toEqual(['m1->d1']);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));
  });

  it('关闭 Dock 直接退出且保留参考：重开为普通模式', async () => {
    await renderPage();
    const draftId = await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    const closeBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('title') === '关闭',
    )!;
    await act(async () => {
      closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(panelOpen()).toBe(false);
    expect(pickLock()).toBe(false);
    expect(edgePairs()).toEqual([`m1->${draftId}`]);

    await clickNode(draftId);
    await vi.waitFor(() => expect(panelOpen()).toBe(true));
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));
    expect(finishButton()).toBeUndefined();
  });

  it('活动目标被删除：结束模式并关闭 Dock，后续点击不写入已删目标', async () => {
    await renderPage();
    await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
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

  it('会话中操作隔离：提示词只读、模型入口与发送禁用，Dock 移除可用', async () => {
    await renderPage();
    await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
    await typePrompt('会话前输入');

    await enterPickMode();
    await clickNode('m1');
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));
    const editor = container.querySelector('[contenteditable]')!;
    expect(editor.getAttribute('contenteditable')).toBe('false');
    const configBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => (b.textContent ?? '').includes('测试生图模型') && (b.textContent ?? '').includes(':'),
    )!;
    expect(configBtn.disabled).toBe(true);
    expect(sendButton().disabled).toBe(true);
    expect(finishButton()!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="dock-media-ref"] button[title="移除"]')).toBeTruthy();

    await finishPick();
    const restored = container.querySelector('[contenteditable]')!;
    expect(restored.getAttribute('contenteditable')).toBe('true');
    expect(sendButton().disabled).toBe(false);
  });

  it('会话中切换编辑目标被隔离：点击其他草稿卡不切换面板', async () => {
    pushDraftNode('d2');
    await renderPage();
    await createDraft();
    await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));

    await enterPickMode();
    await clickNode('m1');
    await clickNode('d2');
    expect(pickLock()).toBe(true);
    expect(edgePairs()).toEqual(['m1->d1']);
    await vi.waitFor(() => expect(dockRefImages()).toEqual(['素材图一']));
    expect(readPromptRefText(container)).toBe('');
  });
});
