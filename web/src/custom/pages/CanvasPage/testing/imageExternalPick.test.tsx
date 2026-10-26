// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import type { AssetRecord } from '@/custom/api/assets';
import CanvasPage from '../index';
import { typePromptRefText } from './promptRefEditor';
import {
  ATTACHMENT_ACTION_PICK_ASSETS_TITLE,
  ATTACHMENT_ACTION_PICK_CANVAS_TITLE,
} from '../components/AttachmentActionBar';
import dialogStyles from '../components/ImageDialog/index.module.css';


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

const assetsPickerProps: { current: Record<string, any> } = { current: {} };
vi.mock('../components/AssetsPickerModal', () => ({
  default: (props: Record<string, any>) => {
    assetsPickerProps.current = props;
    return createElement('div', { 'data-testid': 'assets-picker-stub' });
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
  saveCanvasDoc: vi.fn(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
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
      features: { reference_image: true, image_reference_max: 9 },
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
  linkAssetToProject: vi.fn(async () => undefined),
}));

vi.mock('@/custom/api/canvas', () => ({
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

function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 'm1', type: 'mediaNode', position: { x: 200, y: 0 }, data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '素材图一', assetId: 'a1' } },
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

function refImages(): string[] {
  return [...container.querySelectorAll<HTMLImageElement>(`.${dialogStyles.previewRow} img`)].map(
    (img) => img.alt,
  );
}

function panelOpen(): boolean {
  return container.querySelector('[contenteditable]') !== null;
}

async function openFreePanel() {
  await act(async () => {
    toolbarProps.current.onToggleImageDialog();
  });
  await vi.waitFor(() => expect(container.textContent).toContain('测试生图模型'));
}

async function enterPickMode() {
  const entry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === ATTACHMENT_ACTION_PICK_CANVAS_TITLE,
  )!;
  await act(async () => {
    entry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function pickNodeM1() {
  const m1 = flowProps.current.mediaNodes.find((n: Node) => n.id === 'm1')!;
  await act(async () => {
    flowProps.current.onNodeClick(m1);
  });
}

async function pickFromAssets(assets: AssetRecord[]) {
  const entry = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === ATTACHMENT_ACTION_PICK_ASSETS_TITLE,
  )!;
  await act(async () => {
    entry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    assetsPickerProps.current.onSelect(assets);
  });
}

async function removeFirstRef() {
  const btn = container.querySelector<HTMLButtonElement>('button[title="移除"]')!;
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function closePanel() {
  const btn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === '关闭',
  )!;
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function finishPick() {
  const btn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === '完成选取',
  )!;
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function typePrompt(text: string) {
  await typePromptRefText(container, text);
}

async function clickSend() {
  const btn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === '发送',
  )!;
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  let now = 1_000;
  vi.spyOn(Date, 'now').mockImplementation(() => ++now);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.restoreAllMocks();
});

describe('IKF5KE 自由生图面板选取事件一次消费', () => {
  it('删除后关闭重开参考列表为空，连续重复不恢复旧附件', async () => {
    await renderPage();

    for (let round = 0; round < 2; round += 1) {
      await openFreePanel();
      await enterPickMode();
      await pickNodeM1();
      await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));

      await removeFirstRef();
      expect(refImages()).toEqual([]);

      await closePanel();
      expect(panelOpen()).toBe(false);

      await openFreePanel();
      expect(refImages()).toEqual([]);

      await closePanel();
    }
  });

  it('面板未关闭时工具栏直接重建空面板，不带入上一轮选取事件', async () => {
    await renderPage();
    await openFreePanel();
    await enterPickMode();
    await pickNodeM1();
    await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));
    await removeFirstRef();
    expect(refImages()).toEqual([]);

    await openFreePanel();
    expect(refImages()).toEqual([]);
  });

  it('未删除附件直接关闭，新建空面板同样不继承旧事件', async () => {
    await renderPage();
    await openFreePanel();
    await enterPickMode();
    await pickNodeM1();
    await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));

    await closePanel();
    await openFreePanel();
    expect(refImages()).toEqual([]);
  });

  it('同一面板删除后重新选择同一素材可加入一次；重复选择保持去重', async () => {
    await renderPage();
    await openFreePanel();
    await enterPickMode();
    await pickNodeM1();
    await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));

    await removeFirstRef();
    expect(refImages()).toEqual([]);

    await enterPickMode();
    await pickNodeM1();
    await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));

    await enterPickMode();
    await pickNodeM1();
    expect(refImages()).toEqual(['素材图一']);
  });

  it('从资产中选择加入草稿参考，删除后重开不重放', async () => {
    await renderPage();
    await openFreePanel();
    await pickFromAssets([
      { id: 7, type: 'image', url: 'http://img/asset7.png', width: 100, height: 100, duration: null, source: null, model: null, created_at: null },
    ]);
    expect(refImages()).toEqual(['asset7.png']);
    await removeFirstRef();
    expect(refImages()).toEqual([]);

    await closePanel();
    await openFreePanel();
    expect(refImages()).toEqual([]);
  });

  it('绑定图片草稿批量资产选择保持去重与模型 9 张上限', async () => {
    const asset = (id: number): AssetRecord => ({
      id, type: 'image', url: `http://img/asset${id}.png`, width: 100, height: 100, duration: null, source: null, model: null, created_at: null,
    });
    await renderPage();
    await openFreePanel();

    await pickFromAssets([asset(7), asset(8), asset(7)]);
    await vi.waitFor(() => expect(refImages()).toEqual(['asset7.png', 'asset8.png']));

    await pickFromAssets([asset(7)]);
    expect(refImages()).toEqual(['asset7.png', 'asset8.png']);

    await pickFromAssets([10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map(asset));
    await vi.waitFor(() => expect(refImages()).toHaveLength(9));
    await vi.waitFor(() => expect(container.textContent).toContain('图片最多 9 张'), { timeout: 3000 });
  });

  it('生成请求只包含本轮实际保留的参考：删除后不携带，保留时携带', async () => {
    await renderPage();

    await openFreePanel();
    await enterPickMode();
    await pickNodeM1();
    await finishPick();
    await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));
    await removeFirstRef();
    await typePrompt('画一只蓝鲸');
    await clickSend();
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));
    expect(apiMocks.createGenerationJob.mock.calls[0]![1].input_asset_ids).toBeUndefined();

    await openFreePanel();
    await enterPickMode();
    await pickNodeM1();
    await finishPick();
    await vi.waitFor(() => expect(refImages()).toEqual(['素材图一']));
    await typePrompt('参考这张图重绘');
    await clickSend();
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(2));
    expect(apiMocks.createGenerationJob.mock.calls[1]![1].input_asset_ids).toBeUndefined();
    expect(apiMocks.createGenerationJob.mock.calls[1]![1].references).toEqual([{ role: 'reference', type: 'image', asset_id: 'a1' }]);
  });
});
