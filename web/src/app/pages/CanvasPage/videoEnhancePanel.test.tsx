// @vitest-environment jsdom
import { dockActions } from './testing/dockActionsRecorder';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import NodeFollowToolbar from './components/NodeFollowToolbar';
import { VIDEO_ENHANCE_EDGE_ORIGIN } from './videoEnhance';

vi.mock('@/app/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/app/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));

vi.mock('@/app/api/canvasRecovery', async (importActual) => ({
  ...(await importActual<typeof import('@/app/api/canvasRecovery')>()),
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

vi.mock('./components/CanvasToolbar', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));

vi.mock('./components/CanvasHeader', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));

vi.mock('./components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

vi.mock('@/app/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/app/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

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
  fetchJobStatus: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  createImageEnhancement: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async () => []),
}));

vi.mock('@/app/api/projects', () => ({
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
}));
vi.mock('@/app/api/auth', () => ({
  fetchMe: apiMocks.fetchMe,
  fetchCredits: apiMocks.fetchCredits,
  toSessionUser: apiMocks.toSessionUser,
}));
vi.mock('@/app/api/assets', () => ({
  UPLOAD_SIZE_LIMIT: 100 * 1024 * 1024,
  fetchUploadPresign: vi.fn(),
  putToPresignedUrl: vi.fn(),
  completeUpload: vi.fn(),
  fetchAllAssets: vi.fn(async () => []),
  fetchAssetDetail: vi.fn(),
  linkAssetToProject: vi.fn(),
}));

vi.mock('@/app/api/canvas', () => ({
  applyPromptPreview: apiMocks.applyPromptPreview,
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({
    queryKey: ['canvas', projectId, 'legacy-history'],
    queryFn: () => Promise.resolve({ items: [] }),
    retry: false,
  }),
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn((edges: Array<{ id: string; source: string; target: string }>) =>
    JSON.stringify(edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))),
  ),
}));
vi.mock('@/app/api/jobs', () => ({
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
vi.mock('@/app/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/app/api/generation', () => ({ fetchGenerationModels: apiMocks.fetchGenerationModels }));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('./hooks/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

function seedDoc(withFinishedHd = false) {
  const nodes: Array<Record<string, unknown>> = [
    {
      id: 'v1',
      type: 'mediaNode',
      position: { x: 400, y: 0 },
      data: { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '素材视频', assetId: '5', width: 1280, height: 720 },
    },
  ];
  if (withFinishedHd) {
    nodes.push({
      id: 'h1',
      type: 'mediaNode',
      position: { x: 958, y: 0 },
      data: {
        src: 'http://vid/hd.mp4',
        mediaType: 'video',
        fileName: '生成-88',
        assetId: '9',
        width: 1920, height: 1080,
        jobId: '88',
        videoEnhance: {
          sourceAssetId: '5',
          lastParams: { resolution: '4k' },
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
      edges: withFinishedHd
        ? [{ id: 'e1', source: 'v1', target: 'h1', data: { origin: VIDEO_ENHANCE_EDGE_ORIGIN } }]
        : [],
    },
    assets: {
      5: { asset_id: 5, type: 'video', access_url: 'http://vid/v1.mp4', width: 1280, height: 720 },
      9: { asset_id: 9, type: 'video', access_url: 'http://vid/hd.mp4', width: 1920, height: 1080 },
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

async function videoEnhance(id = 'v1') {
  const video = flowProps.current.mediaNodes.find((n: Node) => n.id === id)!;
  await act(async () => {
    video.data.onVideoEnhance(id);
  });
}

const mediaNodes = () => flowProps.current.mediaNodes as Node[];
const mediaNode = (id: string) => mediaNodes().find((n) => n.id === id)!;
const hdDraft = () => mediaNodes().find((n: Node) => n.id !== 'v1' && n.id !== 'h1');
const panelSend = () => document.body.querySelector<HTMLButtonElement>('[data-testid="video-enhance-send-btn"]');
const panelResolution = (value: string) =>
  document.body.querySelector<HTMLButtonElement>(`[data-testid="video-enhance-resolution-${value}"]`);
const identityOf = (node: Node | undefined) =>
  ((node?.data ?? {}) as Record<string, unknown>).videoEnhance as Record<string, unknown> | undefined;

async function closeViaX() {
  await act(async () => {
    document.body.querySelector<HTMLButtonElement>('[data-testid="video-enhance-close-btn"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}
async function pressEscape() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
}
async function clickOutside() {
  await act(async () => {
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}
async function selectOther() {
  await act(async () => {
    flowProps.current.onSelectionChange({ nodes: [mediaNode('v1')], edges: [] });
  });
}

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

describe('IKH3VG 点 HD 建草稿卡与面板跟随', () => {
  it('点 HD：源卡右侧建 HD 草稿卡（标题/身份/草稿态）+ 来源连线 + 弹出 HD 面板', async () => {
    seedDoc();
    await renderPage();
    await videoEnhance();

    const draft = hdDraft()!;
    expect(draft).toBeTruthy();
    const data = draft.data as Record<string, unknown>;
    expect(data.mediaType).toBe('video');
    expect(data.draft).toBe(true);
    expect(data.fileName).toBe('HD');
    expect(data.genStatus).toBe('draft');
    expect(identityOf(draft)).toEqual({ sourceAssetId: '5' });
    expect((draft.position as { x: number }).x).toBeGreaterThan(400);

    const edge = (flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>)
      .find((e) => e.target === draft.id)!;
    expect(edge.source).toBe('v1');
    expect(edge.data).toEqual({ origin: VIDEO_ENHANCE_EDGE_ORIGIN });

    expect(panelSend()).toBeTruthy();
    expect(document.body.querySelector('[data-gen-panel-territory]')).toBeTruthy();
    expect(panelResolution('1080p')!.className).toMatch(/Active/);
  });

  it('分辨率切换即时写卡：lastParams 随切换持久化（创建 API 零调用——发送归下一票）', async () => {
    seedDoc();
    await renderPage();
    await videoEnhance();

    await act(async () => {
      panelResolution('4k')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(identityOf(hdDraft())).toEqual({ sourceAssetId: '5', lastParams: { resolution: '4k' } });
    expect(dockActions.updateDraft).toHaveBeenCalledWith('videoEnhance', { nodeId: hdDraft()!.id, value: '4k' });
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    expect(apiMocks.createImageEnhancement).not.toHaveBeenCalled();
  });
});

describe('IKH3VG 会话模态：全局工具条门与互斥', () => {
  it('HD 面板打开期间：不注入 soloToolbarHidden，钉屏幕工具条容器 show 保持（IKHFUF）', async () => {
    seedDoc();
    await renderPage();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [mediaNode('v1')], edges: [] });
    });
    await videoEnhance();

    for (const node of mediaNodes()) {
      expect((node.data as Record<string, unknown>).soloToolbarHidden).toBeUndefined();
    }
    expect(mediaFollowToolbarShow()).toBe(true);

    await closeViaX();
    for (const node of mediaNodes()) {
      expect((node.data as Record<string, unknown>).soloToolbarHidden).toBeUndefined();
    }
    expect(mediaFollowToolbarShow()).toBe(true);
  });

  it('与去字幕会话互斥：HD 面板打开时进入去字幕编辑态，HD 面板关闭（草稿卡保留）', async () => {
    seedDoc();
    await renderPage();
    await videoEnhance();
    expect(panelSend()).toBeTruthy();

    await act(async () => {
      const enterSubtitleErase = (mediaNode('v1').data as Record<string, unknown>)
        .onVideoSubtitleErase as ((id: string, mode?: string) => void) | undefined;
      enterSubtitleErase?.('v1', 'smart');
    });
    expect(panelSend()).toBeNull();
    expect(hdDraft()).toBeTruthy();
  });
});

function mediaFollowToolbarShow(): boolean | undefined {
  const frag = flowProps.current.followToolbarLayer as { props?: { children?: unknown } } | undefined;
  const children = frag?.props?.children;
  const arr = Array.isArray(children) ? children : [children];
  const el = arr.find((c) => (c as { type?: unknown } | null)?.type === NodeFollowToolbar) as
    { props?: { show?: boolean } } | undefined;
  return el?.props?.show;
}

describe('IKH3VG 关闭再开与四路退出', () => {
  it('关闭（X）后再点 HD 草稿卡：面板重开且参数恢复（lastParams 4k）', async () => {
    seedDoc();
    await renderPage();
    await videoEnhance();
    await act(async () => {
      panelResolution('2k')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await closeViaX();
    expect(panelSend()).toBeNull();

    await act(async () => {
      flowProps.current.onNodeClick(hdDraft()!);
    });
    expect(panelSend()).toBeTruthy();
    expect(panelResolution('2k')!.className).toMatch(/Active/);
    expect(panelResolution('1080p')!.className).not.toMatch(/Active/);
  });

  it('四路退出均不建任务不丢参数：X / Esc / 点外 / 点其他卡，草稿卡与 lastParams 保留', async () => {
    seedDoc();
    await renderPage();
    await videoEnhance();
    await act(async () => {
      panelResolution('4k')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const exits = [closeViaX, pressEscape, clickOutside, selectOther];
    for (const exit of exits) {
      expect(panelSend()).toBeTruthy();
      await exit();
      expect(panelSend()).toBeNull();
      expect(hdDraft()).toBeTruthy();
      expect(identityOf(hdDraft())).toEqual({ sourceAssetId: '5', lastParams: { resolution: '4k' } });
      expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
      await act(async () => {
        flowProps.current.onNodeClick(hdDraft()!);
      });
    }
  });
});

describe('IKH3VG 重新编辑分流与参数恢复', () => {
  it('成品 HD 卡点卡（重新编辑口径）打开 HD 面板并回填 lastParams（不进视频生成面板）', async () => {
    seedDoc(true);
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('h1'));
    });
    expect(panelSend()).toBeTruthy();
    expect(panelResolution('4k')!.className).toMatch(/Active/);
    expect(panelResolution('1080p')!.className).not.toMatch(/Active/);
  });
});


it('IKJUH0 HD只渲染一份，真实X调用Dock.close', async () => {
  seedDoc(); await renderPage(); await videoEnhance();
  expect(document.body.querySelectorAll('[data-testid="video-enhance-send-btn"]')).toHaveLength(1);
  await closeViaX();
  expect(dockActions.close).toHaveBeenCalledWith('videoEnhance');
  expect(panelSend()).toBeNull();
});
