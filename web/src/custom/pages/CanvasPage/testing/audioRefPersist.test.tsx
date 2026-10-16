// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../index';
import { typePromptRefText } from './promptRefEditor';
import {
  ATTACHMENT_ACTION_PICK_ASSETS_TITLE,
  ATTACHMENT_ACTION_PICK_CANVAS_TITLE,
} from '../components/AttachmentActionBar';
import barStyles from '../components/AttachmentActionBar/index.module.css';
import dialogStyles from '../components/AudioDialog/index.module.css';
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
    _payload: { viewport: unknown; nodes: Node[]; edges: Array<{ id: string; source: string; target: string; data?: unknown }> },
    _version: number | null,
  ) => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]', edges: '[]' })),
  createGenerationJob: vi.fn(async (_projectId: string, _payload: Record<string, any>) => ({ generation_job_id: 'j1', cursor: 1 })),
  fetchJobStatus: vi.fn(async () => ({
    job_id: 'j1',
    status: 'succeeded',
    progress: 100,
    asset: { id: 'a9', url: 'http://audio/out.mp3', type: 'audio', duration: 30 },
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
      is_default: true,
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

vi.mock('@/custom/api/generation', () => ({
  fetchGenerationModels: apiMocks.fetchGenerationModels,
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

vi.mock('../hooks/document/useCanvasDoc', () => ({
  useCanvasDoc: () => canvasDocMock.current,
}));

function seedDoc(extra?: {
  secondDraft?: boolean;
  edges?: Array<{ id: string; source: string; target: string }>;
  legacyAudioRefs?: unknown[];
  brokenSource?: boolean;
}) {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: 't1', type: 'textNode', position: { x: 0, y: 0 }, data: { title: '故事文案', text: '一只蓝鲸在海里' } },
        { id: 'm1', type: 'mediaNode', position: { x: 0, y: 120 }, data: { src: 'http://img/m1.png', mediaType: 'image', fileName: '成品图', assetId: 'a-img' } },
        { id: 'v1', type: 'mediaNode', position: { x: 0, y: 240 }, data: { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '成品视频', assetId: 'a-vid' } },
        { id: 'u1', type: 'mediaNode', position: { x: 300, y: 0 }, data: { src: 'http://aud/u1.mp3', mediaType: 'audio', fileName: '海浪声', assetId: 'a1' } },
        { id: 'u2', type: 'mediaNode', position: { x: 600, y: 0 }, data: { src: 'http://aud/u2.mp3', mediaType: 'audio', fileName: '风声', assetId: 'a2' } },
        { id: 'u3', type: 'mediaNode', position: { x: 900, y: 0 }, data: { src: 'http://aud/u3.mp3', mediaType: 'audio', fileName: '雨声', assetId: 'a3' } },
        {
          id: 'u0',
          type: 'mediaNode',
          position: { x: 1200, y: 0 },
          data: extra?.brokenSource
            ? { src: 'http://aud/u0.mp3', mediaType: 'audio', fileName: '坏来源', assetId: 'a0', genStatus: 'generating' }
            : { src: 'http://aud/u0.mp3', mediaType: 'audio', fileName: '备用', assetId: 'a8' },
        },
        {
          id: 'd1',
          type: 'mediaNode',
          position: { x: 420, y: 300 },
          data: {
            src: '', mediaType: 'audio', fileName: '音频草稿', genStatus: 'draft', draft: true, prompt: '',
            ...(extra?.legacyAudioRefs ? { audioRefs: extra.legacyAudioRefs } : {}),
          },
        },
        ...(extra?.secondDraft
          ? [{
              id: 'd2', type: 'mediaNode', position: { x: 640, y: 300 },
              data: { src: '', mediaType: 'audio', fileName: '音频草稿二', genStatus: 'draft', draft: true, prompt: '' },
            }]
          : []),
      ],
      edges: extra?.edges ?? [],
    },
    assets: {
      'a-img': { asset_id: 101, type: 'image', access_url: 'http://img/m1.png', width: 100, height: 100 },
      a1: { asset_id: 1, type: 'audio', access_url: 'http://aud/u1.mp3', duration: 12 },
      a2: { asset_id: 2, type: 'audio', access_url: 'http://aud/u2.mp3', duration: 8 },
      a3: { asset_id: 3, type: 'audio', access_url: 'http://aud/u3.mp3', duration: 15 },
      a8: { asset_id: 8, type: 'audio', access_url: 'http://aud/u0.mp3', duration: 20 },
      a0: { asset_id: 10, type: 'audio', access_url: 'http://aud/u0.mp3', duration: 20 },
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

function refNames(): string[] {
  return [...container.querySelectorAll<HTMLElement>('[data-testid="audio-ref-thumb"]')].map((el) => el.title);
}

function pickReferenceButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === ATTACHMENT_ACTION_PICK_CANVAS_TITLE,
  );
}

function assetsLibraryButton(): HTMLButtonElement | undefined {
  return [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === ATTACHMENT_ACTION_PICK_ASSETS_TITLE,
  );
}

function attachmentStrip(): Element | null {
  return container.querySelector(`.${dialogStyles.topRow}`);
}

async function startCanvasPick() {
  await vi.waitFor(() => {
    expect(pickReferenceButton()).toBeTruthy();
  });
  await act(async () => {
    pickReferenceButton()!.click();
  });
}

async function pressEscape() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
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

async function waitModelReady() {
  await vi.waitFor(() => expect(container.textContent).toContain('测试音频模型'), { timeout: 3000 });
}

async function closePanel() {
  const btn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.getAttribute('title') === '关闭',
  )!;
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

const lastSavedPayload = () => apiMocks.saveCanvasDoc.mock.calls.at(-1)![1];

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

describe('IKFDFZ 音频参考即时建线与持久化', () => {
  it('画布连续选取多项参考：校验通过立即逐条建线，身份、数量、顺序随自动保存完整上送（不等待发送）', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await startCanvasPick();
    await clickNode('u1');
    expect(edgePairs()).toEqual(['u1->d1']);
    await clickNode('u2');
    expect(edgePairs()).toEqual(['u1->d1', 'u2->d1']);
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });

    await vi.waitFor(() => {
      expect(lastSavedPayload().edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`))
        .toEqual(['u1->d1', 'u2->d1']);
    }, { timeout: 3000 });
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });

  it('关闭重开：参考按连线完整恢复（提示词与配置同路径），不因未发送丢失', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await typePrompt('环境音');

    await startCanvasPick();
    await clickNode('u1');
    await clickNode('u2');
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });

    await closePanel();
    expect(refNames()).toEqual([]);

    await clickNode('d1');
    await waitModelReady();
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });
    expect(container.querySelector('[data-testid="audio-input"]')?.textContent).toContain('环境音');
    expect(finishButton()).toBeUndefined();
  });

  it('空白隐藏重开：点击画布空白隐藏面板，参考与提示词保留，重开原目标恢复', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await typePrompt('空白隐藏描述');

    await startCanvasPick();
    await clickNode('u1');
    await clickNode('u2');
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });

    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(refNames()).toEqual(['海浪声', '风声']);
    expect(finishButton()).toBeUndefined();
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(refNames()).toEqual([]);

    await clickNode('d1');
    await waitModelReady();
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });
    expect(container.querySelector('[data-testid="audio-input"]')?.textContent).toContain('空白隐藏描述');
    expect(finishButton()).toBeUndefined();
  });

  it('保存失败：选择保留并显示未保存，阻止切换其他目标与发送，允许关闭重开原目标，重试成功恢复', async () => {
    seedDoc({ secondDraft: true });
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await typePrompt('保存前编辑');

    apiMocks.saveCanvasDoc.mockImplementation(() => Promise.reject(new Error('boom')));
    await startCanvasPick();
    await clickNode('u1');
    expect(edgePairs()).toEqual(['u1->d1']);

    await vi.waitFor(() => expect(container.textContent).toContain('保存失败，请重试'), { timeout: 3000 });
    expect(edgePairs()).toEqual(['u1->d1']);
    expect(refNames()).toEqual(['海浪声']);

    await clickNode('d2');
    expect(refNames()).toEqual(['海浪声']);
    expect(container.querySelector('[data-testid="audio-input"]')?.textContent).toContain('保存前编辑');
    expect(sendButton().disabled).toBe(true);

    await closePanel();
    expect(container.querySelector('[data-testid="audio-send"]')).toBeNull();
    await clickNode('d1');
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声']), { timeout: 3000 });

    apiMocks.saveCanvasDoc.mockImplementation(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]', edges: '[]' }));
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === '重试保存')!;
    await act(async () => { retry.click(); });
    await vi.waitFor(() => expect(container.textContent).toContain('已保存'));
    expect(lastSavedPayload().edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`)).toEqual(['u1->d1']);
    expect(sendButton().disabled).toBe(false);
    await clickNode('d2');
    await vi.waitFor(() => expect(refNames()).toEqual([]));
  });

  it('A→B→A 目标隔离：A 的参考与提示词保留，B 不串入 A；B 独立积累自己的参考', async () => {
    seedDoc({ secondDraft: true });
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await typePrompt('A 目标描述');

    await startCanvasPick();
    await clickNode('u1');
    await clickNode('u2');
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });
    await pressEscape();

    await clickNode('d2');
    await waitModelReady();
    expect(refNames()).toEqual([]);
    expect(container.querySelector('[data-testid="audio-input"]')?.textContent).not.toContain('A 目标描述');

    await startCanvasPick();
    await clickNode('u3');
    await pressEscape();
    expect(edgePairs()).toEqual(['u1->d1', 'u2->d1', 'u3->d2']);

    await clickNode('d1');
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });
    expect(container.querySelector('[data-testid="audio-input"]')?.textContent).toContain('A 目标描述');
  });

  it('存量 data.audioRefs 画布项首次打开迁移为连线，旧字段清空随保存落盘', async () => {
    seedDoc({
      legacyAudioRefs: [
        { id: 'u1', kind: 'audio', name: '海浪声', src: 'http://aud/u1.mp3', source: 'canvas', assetId: 'a1' },
        { id: 'u2', kind: 'audio', name: '风声', src: 'http://aud/u2.mp3', source: 'canvas', assetId: 'a2' },
        { id: 'gone', kind: 'audio', name: '已不在画布', src: 'http://aud/gone.mp3', source: 'canvas', assetId: 'a7' },
      ],
    });
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    expect(edgePairs()).toEqual(['u1->d1', 'u2->d1']);
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });
    await vi.waitFor(() => {
      const d1 = lastSavedPayload().nodes.find((n: Node) => n.id === 'd1')!;
      expect((d1.data as Record<string, unknown>).audioRefs).toEqual([]);
    }, { timeout: 3000 });
  });

  it('重复素材与超上限明确拒绝：重复提示「重复的素材已跳过」不建第二条线；满 3 段后入口显示已达上限', async () => {
    seedDoc({
      edges: [
        { id: 'e-u1-d1', source: 'u1', target: 'd1' },
        { id: 'e-u2-d1', source: 'u2', target: 'd1' },
      ],
    });
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });

    await startCanvasPick();
    await clickNode('u1');
    expect(edgePairs()).toEqual(['u1->d1', 'u2->d1']);
    await vi.waitFor(() => expect(container.textContent).toContain('重复的素材已跳过'));

    await act(async () => {
      flowProps.current.onConnect({ source: 'u3', target: 'd1' });
    });
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声', '雨声']), { timeout: 3000 });
    await vi.waitFor(() => expect(container.textContent).toContain('已达上限'));
    const fullPills = [...container.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => b.textContent === '参考' || b.textContent === '资产库',
    );
    expect(fullPills).toHaveLength(2);
    for (const btn of fullPills) {
      expect(btn.getAttribute('aria-disabled')).toBe('true');
      expect(btn.getAttribute('title')).toBe('参考音频最多 3 段，已达上限');
    }
  });

  it('失效来源（生成中）保留连线并提示原因阻止发送；移除后恢复发送', async () => {
    seedDoc({
      brokenSource: true,
      edges: [{ id: 'e-u0-d1', source: 'u0', target: 'd1' }],
    });
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await typePrompt('描述');

    await vi.waitFor(() => expect(refNames()).toEqual([]), { timeout: 3000 });
    await vi.waitFor(() => expect(container.querySelector('[data-testid="audio-ref-invalid"]')?.textContent).toContain('生成中的卡片不能作为参考'));
    expect(sendButton().disabled).toBe(true);

    await act(async () => {
      flowProps.current.onEdgesChange([{ id: 'e-u0-d1', type: 'remove' }]);
    });
    await vi.waitFor(() => expect(container.querySelector('[data-testid="audio-ref-invalid"]')).toBeNull());
    expect(sendButton().disabled).toBe(false);
  });

  it('面板移除参考：断开对应连线并随保存落盘，来源素材与其他目标引用保持完整，重开不复活', async () => {
    seedDoc({ secondDraft: true });
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await startCanvasPick();
    await clickNode('u1');
    await clickNode('u2');
    await act(async () => {
      flowProps.current.onConnect({ source: 'u1', target: 'd2' });
    });
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });

    const removeButtons = () => [...container.querySelectorAll<HTMLButtonElement>('[data-testid="audio-ref-thumb"] button[title="移除"]')];
    await act(async () => { removeButtons().at(-1)!.click(); });
    expect(edgePairs()).toEqual(['u1->d1', 'u1->d2']);
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声']));
    await clickNode('u0');
    expect(edgePairs()).toEqual(['u1->d1', 'u1->d2', 'u0->d1']);
    await vi.waitFor(() => {
      expect(lastSavedPayload().edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`))
        .toEqual(['u1->d1', 'u1->d2', 'u0->d1']);
    }, { timeout: 3000 });

    await pressEscape();
    await closePanel();
    await clickNode('d1');
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '备用']), { timeout: 3000 });
  });

  it('画布拖线：音频→音频草稿建线持久化；已有音频时图片不可混入', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await act(async () => {
      flowProps.current.onConnect({ source: 'u1', target: 'd1' });
    });
    expect(edgePairs()).toEqual(['u1->d1']);

    await act(async () => {
      flowProps.current.onConnect({ source: 'm1', target: 'd1' });
    });
    expect(edgePairs()).toEqual(['u1->d1']);
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声']), { timeout: 3000 });
    await vi.waitFor(() => expect(container.textContent).toContain('音频与图片参考不可混用'));
  });

  it('发送：画布参考按连线顺序进入创建任务 references（role/type/asset_id），携带 target_node_id', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await typePrompt('生成一段海边的环境音');

    await startCanvasPick();
    await clickNode('u1');
    await clickNode('u2');
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });
    expect(sendButton().disabled).toBe(true);
    await pressEscape();
    expect(sendButton().disabled).toBe(false);

    await act(async () => {
      sendButton().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(apiMocks.createGenerationJob).toHaveBeenCalledTimes(1));

    const [, payload] = apiMocks.createGenerationJob.mock.calls[0]!;
    expect(payload.type).toBe('audio');
    expect(payload.target_node_id).toBe('d1');
    expect(payload.references).toEqual([
      { role: 'reference', type: 'audio', asset_id: 'a1' },
      { role: 'reference', type: 'audio', asset_id: 'a2' },
    ]);
    expect(payload.input_asset_ids).toBeUndefined();
    expect(payload.reference_asset_ids).toBeUndefined();
    expect(container.querySelector('[data-testid="audio-send"]')).toBeNull();
  });
});

describe('IKFR4Z 音频参考持续选取与保存恢复闭环', () => {
  function pickLock(): boolean {
    return flowProps.current.refPickActive === true;
  }

  function pickMarks(): string[] {
    return (flowProps.current.refPickMarkedIds ?? []) as string[];
  }

  function panelOpen(): boolean {
    return container.querySelector('[data-testid="audio-send"]') !== null;
  }

  it('一次进入连续选取两段：逐条建线保持模式，Dock 与勾选同步，自动保存上送', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await startCanvasPick();
    expect(pickLock()).toBe(true);
    expect(finishButton()).toBeTruthy();
    await clickNode('u1');
    expect(edgePairs()).toEqual(['u1->d1']);
    expect(pickLock()).toBe(true);
    await clickNode('u2');
    expect(edgePairs()).toEqual(['u1->d1', 'u2->d1']);
    expect([...pickMarks()].sort()).toEqual(['u1', 'u2']);
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声', '风声']), { timeout: 3000 });

    await vi.waitFor(() => {
      expect(lastSavedPayload().edges.map((e: { source: string; target: string }) => `${e.source}->${e.target}`))
        .toEqual(['u1->d1', 'u2->d1']);
    }, { timeout: 3000 });
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });

  it('重复点击已选节点：不新增、不移除，提示已跳过且模式持续', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await startCanvasPick();
    await clickNode('u1');
    await clickNode('u1');
    expect(edgePairs()).toEqual(['u1->d1']);
    expect(pickMarks()).toEqual(['u1']);
    await vi.waitFor(() => expect(container.textContent).toContain('重复的素材已跳过'));
    expect(pickLock()).toBe(true);
  });

  it('数量上限明确提示：满 3 段后不写入不退出，腾出容量后同模式可继续', async () => {
    seedDoc({ edges: [
      { id: 'e-u1-d1', source: 'u1', target: 'd1' },
      { id: 'e-u2-d1', source: 'u2', target: 'd1' },
    ] });
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await startCanvasPick();
    await clickNode('u3');
    expect(edgePairs()).toEqual(['u1->d1', 'u2->d1', 'u3->d1']);
    await clickNode('u0');
    await vi.waitFor(() => expect(container.textContent).toContain('参考音频最多 3 段'));
    expect(edgePairs()).toEqual(['u1->d1', 'u2->d1', 'u3->d1']);
    expect(pickLock()).toBe(true);
    const removeButtons = () => [...container.querySelectorAll<HTMLButtonElement>('[data-testid="audio-ref-thumb"] button[title="移除"]')];
    await act(async () => { removeButtons().at(-1)!.click(); });
    await clickNode('u0');
    expect(edgePairs()).toEqual(['u1->d1', 'u2->d1', 'u0->d1']);
    expect(pickLock()).toBe(true);
  });

  it('非法来源明确提示原因：不写入、不退出、不关闭面板，改选合法来源可继续', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await startCanvasPick();
    await clickNode('v1');
    expect(edgePairs()).toEqual([]);
    expect(pickLock()).toBe(true);
    expect(panelOpen()).toBe(true);
    await vi.waitFor(() => expect(container.textContent).toContain('音频参考仅支持图片或音频素材'));

    await clickNode('u1');
    expect(edgePairs()).toEqual(['u1->d1']);
    expect(pickMarks()).toEqual(['u1']);
  });

  it('会话选文本卡：建附件边并保持模式，文本来源不计入勾选，可继续选媒体', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await startCanvasPick();
    await clickNode('t1');
    expect(edgePairs()).toEqual(['t1->d1']);
    expect(pickLock()).toBe(true);
    expect(pickMarks()).toEqual([]);
    await clickNode('u1');
    expect(edgePairs()).toEqual(['t1->d1', 'u1->d1']);
    expect(pickMarks()).toEqual(['u1']);
  });

  it('Dock 移除：勾选同步消失，同模式可立即再次选择', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await startCanvasPick();
    await clickNode('u1');
    expect(pickMarks()).toEqual(['u1']);

    const removeBtn = container.querySelector<HTMLButtonElement>('[data-testid="audio-ref-thumb"] button[title="移除"]')!;
    expect(removeBtn.disabled).toBe(false);
    await act(async () => {
      removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(refNames()).toEqual([]));
    expect(edgePairs()).toEqual([]);
    expect(pickMarks()).toEqual([]);
    expect(pickLock()).toBe(true);

    await clickNode('u1');
    expect(edgePairs()).toEqual(['u1->d1']);
    expect(pickMarks()).toEqual(['u1']);
  });

  it('模式内空白点击只退选取：面板保留；再点空白关面板（IKFYH6 拍板 4）', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await startCanvasPick();
    await clickNode('u1');
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(pickLock()).toBe(false);
    expect(panelOpen()).toBe(true);
    expect(edgePairs()).toEqual(['u1->d1']);

    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(panelOpen()).toBe(false);
    expect(edgePairs()).toEqual(['u1->d1']);
  });

  it('完成按钮退出：保留参考与原目标 Dock，恢复普通编辑与普通切换', async () => {
    seedDoc({ secondDraft: true });
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await startCanvasPick();
    await clickNode('u1');
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [flowProps.current.mediaNodes.find((n: Node) => n.id === 'u1')!], edges: [] });
    });
    expect(panelOpen()).toBe(true);
    await finishPick();
    expect(pickLock()).toBe(false);
    expect(finishButton()).toBeUndefined();
    expect(panelOpen()).toBe(true);
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声']), { timeout: 3000 });
    expect(edgePairs()).toEqual(['u1->d1']);
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();

    await clickNode('d2');
    await vi.waitFor(() => expect(refNames()).toEqual([]));
  });

  it('Esc 退出：保留参考与面板，画布交互锁解除', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await startCanvasPick();
    await clickNode('u1');
    await pressEscape();
    expect(pickLock()).toBe(false);
    expect(panelOpen()).toBe(true);
    expect(edgePairs()).toEqual(['u1->d1']);
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声']), { timeout: 3000 });
  });

  it('关闭面板直接退出且保留参考：重开为普通模式', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await startCanvasPick();
    await clickNode('u1');
    await closePanel();
    expect(panelOpen()).toBe(false);
    expect(pickLock()).toBe(false);
    expect(edgePairs()).toEqual(['u1->d1']);

    await clickNode('d1');
    await waitModelReady();
    await vi.waitFor(() => expect(panelOpen()).toBe(true));
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声']), { timeout: 3000 });
    expect(finishButton()).toBeUndefined();
  });

  it('活动目标被删除：结束模式并关闭面板，后续点击不写入已删目标', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await startCanvasPick();
    await clickNode('u1');
    expect(pickLock()).toBe(true);

    await act(async () => {
      flowProps.current.onDeleteNode(['d1']);
    });
    await vi.waitFor(() => expect(panelOpen()).toBe(false));
    expect(pickLock()).toBe(false);
    expect(finishButton()).toBeUndefined();

    await clickNode('u1');
    expect(edgePairs().some((p: string) => p.endsWith('->d1'))).toBe(false);
  });

  it('会话中操作隔离：提示词只读、模型入口与发送禁用，Dock 移除可用', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    await typePrompt('会话前输入');

    await startCanvasPick();
    await clickNode('u1');
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声']), { timeout: 3000 });
    const editor = container.querySelector('[contenteditable]')!;
    expect(editor.getAttribute('contenteditable')).toBe('false');
    const modelBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => (b.textContent ?? '').includes('测试音频模型'),
    )!;
    expect(modelBtn.disabled).toBe(true);
    expect(sendButton().disabled).toBe(true);
    expect(finishButton()!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('[data-testid="audio-ref-thumb"] button[title="移除"]')).toBeTruthy();

    await finishPick();
    const restored = container.querySelector('[contenteditable]')!;
    expect(restored.getAttribute('contenteditable')).toBe('true');
    expect(sendButton().disabled).toBe(false);
  });

  it('会话中切换编辑目标被隔离：点击其他草稿卡不切换面板', async () => {
    seedDoc({ secondDraft: true });
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    await startCanvasPick();
    await clickNode('u1');
    await clickNode('d2');
    expect(pickLock()).toBe(true);
    expect(edgePairs()).toEqual(['u1->d1']);
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声']), { timeout: 3000 });
    await vi.waitFor(() => expect(container.textContent).toContain('待生成的草稿不能作为参考'));
  });
});

describe('IKGB82 音频面板附件操作条', () => {
  it('操作条「+ 参考」「资产库」常显，栏尾旧「+」菜单入口退役；展开/关闭并入操作条右侧', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();

    expect(pickReferenceButton()).toBeTruthy();
    expect(assetsLibraryButton()).toBeTruthy();
    expect(
      [...container.querySelectorAll<HTMLButtonElement>('button')].some(
        (b) => b.getAttribute('title') === '从资产中选择 / 从节点添加素材',
      ),
    ).toBe(false);
    const bar = pickReferenceButton()!.closest(`.${barStyles.actionBar}`)!;
    expect(bar.querySelector(`button[title="${ATTACHMENT_ACTION_PICK_ASSETS_TITLE}"]`)).toBeTruthy();
    expect(bar.querySelector('button[title="展开"]')).toBeTruthy();
    expect(bar.querySelector('button[title="关闭"]')).toBeTruthy();
  });

  it('空态：无附件时附件栏不渲染；点「+ 参考」进选取且按钮高亮；点选节点后附件栏出现在操作条与输入框之间', async () => {
    await renderPage();
    await clickNode('d1');
    await waitModelReady();
    expect(attachmentStrip()).toBeNull();

    await startCanvasPick();
    expect(pickReferenceButton()!.classList.contains(barStyles.picking)).toBe(true);
    expect(assetsLibraryButton()!.classList.contains(barStyles.picking)).toBe(false);

    await clickNode('u1');
    await vi.waitFor(() => expect(refNames()).toEqual(['海浪声']), { timeout: 3000 });
    const bar = pickReferenceButton()!.closest(`.${barStyles.actionBar}`)!;
    const strip = attachmentStrip()!;
    const editor = container.querySelector('[contenteditable]')!;
    expect(bar.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
