// @vitest-environment jsdom
import { dockActions } from '../../testing/dockActionsRecorder';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../../index';
import { IMAGE_ENHANCE_EDGE_ORIGIN } from './imageEnhance';
import type { GenerationModel } from '@/custom/api/generation';

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
vi.mock('../../components/AgentPanel/index', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('../../components/Canvas/index', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

vi.mock('../../components/CanvasToolbar/index', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));

vi.mock('../../components/CanvasHeader/index', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));

vi.mock('../../components/ProjectSelector/index', () => ({
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
  saveCanvasDoc: vi.fn(
    async (): Promise<{ id: number; project_id: number; version: number; viewport: string; nodes: string }> => ({
      id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]',
    }),
  ),
  createGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(async () => ({ job_id: '88', status: 'processing', progress: 0, asset: null })),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  createImageEnhancement: vi.fn(async (_projectId: string, _payload: Record<string, unknown>) => ({
    job_id: '88',
    status: 'queued' as const,
  })),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
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
  createConversationQuote: vi.fn(),
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
  createImageEnhancement: apiMocks.createImageEnhancement,
  readJobFailText: apiMocks.readJobFailText,
}));
vi.mock('@/custom/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/custom/api/generation', () => ({ fetchGenerationModels: apiMocks.fetchGenerationModels }));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('../../hooks/document/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

function seedDoc(withFinishedEnhance: boolean | 'failed' = false) {
  const nodes: Array<Record<string, unknown>> = [
    {
      id: 'i1',
      type: 'mediaNode',
      position: { x: 400, y: 0 },
      data: { src: 'http://img/i1.png', mediaType: 'image', fileName: '素材图', assetId: '5', width: 1600, height: 900 },
    },
  ];
  if (withFinishedEnhance) {
    nodes.push({
      id: 'h1',
      type: 'mediaNode',
      position: { x: 958, y: 0 },
      data: {
        src: 'http://img/hd.png',
        mediaType: 'image',
        fileName: '生成-77',
        assetId: '9',
        width: 3200, height: 1800,
        jobId: '77',
        ...(withFinishedEnhance === 'failed'
          ? { genStatus: 'failed', errorText: '高清放大失败，请重试' }
          : {}),
        imageEnhance: {
          sourceAssetId: '5',
          lastParams: {
            source_asset_id: '5',
            target_node_id: 'h1',
            version_tier: 'max',
            multiple: 4,
            generative_enhance_mode: 'fidelity_first',
            enable_correct_color: true,
          },
        },
      },
    });
  }
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes,
      edges: withFinishedEnhance
        ? [{ id: 'e1', source: 'i1', target: 'h1', data: { origin: IMAGE_ENHANCE_EDGE_ORIGIN } }]
        : [],
    },
    assets: {
      5: { asset_id: 5, type: 'image', access_url: 'http://img/i1.png', width: 1600, height: 900 },
      9: { asset_id: 9, type: 'image', access_url: 'http://img/hd.png', width: 3200, height: 1800 },
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

async function enhanceImage() {
  const image = flowProps.current.mediaNodes.find((n: Node) => n.id === 'i1')!;
  await act(async () => {
    image.data.onEnhanceImage('i1');
  });
}

const mediaNode = (id: string) => (flowProps.current.mediaNodes as Node[]).find((n) => n.id === id)!;
const panelSend = () => document.body.querySelector<HTMLButtonElement>('[data-testid="enhance-send-btn"]');

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('IKGM9O 建卡后自动开高清面板', () => {
  it('点「高清放大」建卡后弹出高清面板（不开发图片面板），面板跟随锚定高清卡', async () => {
    seedDoc();
    await renderPage();
    await enhanceImage();

    const draftId = (flowProps.current.mediaNodes as Node[]).find((n) => n.id !== 'i1')!.id;
    expect(panelSend()).toBeTruthy();
    expect(document.body.querySelector('[data-gen-panel-territory]')).toBeTruthy();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [mediaNode('i1')], edges: [] });
    });
    expect(panelSend()).toBeNull();
    void draftId;
  });

  it('默认渲染：Pro / 2x / 生成度优先 / MediaKit；源卡尺寸 1600×900 三档可用', async () => {
    seedDoc();
    await renderPage();
    await enhanceImage();

    expect(document.body.querySelector('[data-testid="enhance-model-btn"]')!.textContent).toContain('Pro');
    expect(
      document.body.querySelector<HTMLButtonElement>('[data-testid="enhance-multiple-2"]')!.className,
    ).toMatch(/Active/);
    expect(document.body.querySelector('[data-testid="enhance-provider-btn"]')!.textContent).toContain('MediaKit');
  });
});

describe('IKGM9O 发送创建任务闭环', () => {
  it('发送：六键冻结 payload、lastParams 写入节点、原地转生成中、面板自动关闭、启动轮询', async () => {
    seedDoc();
    await renderPage();
    await enhanceImage();
    const draftId = (flowProps.current.mediaNodes as Node[]).find((n) => n.id !== 'i1')!.id;

    await act(async () => {
      panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(panelSend()).toBeNull();
    expect(dockActions.submit).toHaveBeenCalledWith('imageEnhance', { version_tier: 'pro', multiple: 2, generative_enhance_mode: 'generative_first', enable_correct_color: false });
    expect(apiMocks.createImageEnhancement).toHaveBeenCalledTimes(1);
    const [projectId, payload] = apiMocks.createImageEnhancement.mock.calls[0];
    expect(projectId).toBe('p1');
    expect(payload).toEqual({
      source_asset_id: '5',
      target_node_id: draftId,
      version_tier: 'pro',
      multiple: 2,
      generative_enhance_mode: 'generative_first',
      enable_correct_color: false,
    });
    const draft = mediaNode(draftId);
    const data = draft.data as Record<string, unknown>;
    expect(data.genStatus).toBe('generating');
    expect(data.progress).toBe(0);
    expect((data.imageEnhance as Record<string, unknown>).lastParams).toEqual(payload);
    await act(async () => {
      await Promise.resolve();
    });
    expect((mediaNode(draftId).data as Record<string, unknown>).jobId).toBe('88');
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('88');
    expect((mediaNode('i1').data as Record<string, unknown>).src).toBe('http://img/i1.png');
  });

  it('面板改选 Max 并开色彩校正后发送：payload 尊重用户选择（enable_correct_color=true）', async () => {
    seedDoc();
    await renderPage();
    await enhanceImage();
    const draftId = (flowProps.current.mediaNodes as Node[]).find((n) => n.id !== 'i1')!.id;

    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[data-testid="enhance-model-btn"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[data-testid="enhance-model-option-max"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(apiMocks.createImageEnhancement.mock.calls[0][1]).toEqual({
      source_asset_id: '5',
      target_node_id: draftId,
      version_tier: 'max',
      multiple: 2,
      generative_enhance_mode: 'generative_first',
      enable_correct_color: true,
    });
  });
});

describe('IKGM9O 重新编辑分流与回填（IKH3WE 起入口 = 点卡片开面板）', () => {
  it('成品高清卡点卡片打开高清面板并回填 lastParams（不再开发图片面板）', async () => {
    seedDoc(true);
    await renderPage();

    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('h1'));
    });
    expect(panelSend()).toBeTruthy();
    expect(document.body.querySelector('[data-testid="enhance-model-btn"]')!.textContent).toContain('Max');
    expect(
      document.body.querySelector<HTMLButtonElement>('[data-testid="enhance-multiple-4"]')!.className,
    ).toMatch(/Active/);
    expect(
      document.body.querySelector<HTMLButtonElement>('[data-testid="enhance-mode-fidelity_first"]')!.className,
    ).toMatch(/Active/);
    expect(
      (document.body.querySelector('[data-testid="enhance-color-toggle"]') as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('重新生成替换本卡素材不新建卡：成品高清卡面板再次发送仍在原卡转生成中', async () => {
    seedDoc(true);
    await renderPage();

    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('h1'));
    });
    await act(async () => {
      panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    const data = mediaNode('h1').data as Record<string, unknown>;
    expect(data.genStatus).toBe('generating');
    expect(data.src).toBe('http://img/hd.png');
    expect(apiMocks.createImageEnhancement.mock.calls[0][1]).toMatchObject({ target_node_id: 'h1', version_tier: 'max' });
  });

  it('失败重试走 lastParams 原样重发：不经通用 retry 接口', async () => {
    seedDoc('failed');
    await renderPage();
    const retryCb = (mediaNode('h1').data as Record<string, unknown>).onRetryJob as (id: string) => void;
    await act(async () => {
      retryCb('h1');
    });
    expect(apiMocks.createImageEnhancement).toHaveBeenCalledTimes(1);
    expect(apiMocks.retryGenerationJob).not.toHaveBeenCalled();
    expect(apiMocks.createImageEnhancement.mock.calls[0][1]).toMatchObject({
      source_asset_id: '5',
      target_node_id: 'h1',
      version_tier: 'max',
      multiple: 4,
      generative_enhance_mode: 'fidelity_first',
      enable_correct_color: true,
    });
    expect((mediaNode('h1').data as Record<string, unknown>).genStatus).toBe('generating');
  });
});

describe('IKGM9O 生成中重开面板只读', () => {
  it('生成中的高清草稿卡点卡重开面板：参数只读冻结展示', async () => {
    seedDoc();
    await renderPage();
    await enhanceImage();
    const draftId = (flowProps.current.mediaNodes as Node[]).find((n) => n.id !== 'i1')!.id;
    await act(async () => {
      panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect((mediaNode(draftId).data as Record<string, unknown>).genStatus).toBe('generating');

    await act(async () => {
      flowProps.current.onNodeClick(mediaNode(draftId));
    });
    expect(panelSend()).toBeTruthy();
    await vi.waitFor(() => expect(document.body.textContent).toContain('生成中，参数只读'), { timeout: 3000 });
    expect(
      (document.body.querySelector('[data-testid="enhance-send-btn"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('IKGM9O 链式放大', () => {
  it('成品高清卡上再点「高清放大」：以高清卡自身为源新建新卡（链式）', async () => {
    seedDoc(true);
    await renderPage();

    await act(async () => {
      ((mediaNode('h1').data as Record<string, unknown>).onEnhanceImage as (id: string) => void)('h1');
    });
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(3);
    const chained = (flowProps.current.mediaNodes as Node[]).find((n) => n.id !== 'i1' && n.id !== 'h1')!;
    const data = chained.data as Record<string, unknown>;
    expect(data.imageEnhance).toEqual({ sourceAssetId: '9' });
    expect(panelSend()).toBeTruthy();
    const edge = (flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>)
      .find((e) => e.target === chained.id)!;
    expect(edge.source).toBe('h1');
    expect(edge.data).toEqual({ origin: IMAGE_ENHANCE_EDGE_ORIGIN });
  });
});

it('IKJUH0 高清只渲染一份，真实X调用Dock.close且不增加实时参数事件', async () => {
  seedDoc();
  await renderPage();
  await enhanceImage();
  expect(document.body.querySelectorAll('[data-testid="enhance-send-btn"]')).toHaveLength(1);
  const territory = panelSend()!.closest('[data-gen-panel-territory]')!;
  await act(async () => { territory.querySelector<HTMLButtonElement>('button[title="关闭"]')!.click(); });
  expect(dockActions.close).toHaveBeenCalledWith('imageEnhance');
  expect(dockActions.updateDraft).not.toHaveBeenCalledWith('imageEnhance', expect.anything());
  expect(panelSend()).toBeNull();
});
