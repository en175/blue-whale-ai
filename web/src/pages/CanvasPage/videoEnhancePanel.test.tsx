// @vitest-environment jsdom
/* IKH3VG 视频 HD 高清面板闭环链路测试：点 HD 建草稿卡（标题/身份/来源连线）与面板跟随弹出、
   分辨率切换即时写卡（lastParams 持久化）、面板打开全局工具条门（soloToolbarHidden 注入 +
   钉屏幕容器 show 门）、关闭再点 HD 草稿卡重开参数恢复、「重新编辑」分流回 HD 面板、
   四路退出（X/Esc/点外/点其他卡）不建任务不丢参数草稿保留、与去字幕会话互斥。
   渲染模式沿用 imageEnhancePanel.test.tsx（FlowCanvas 打桩透出 props）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import NodeFollowToolbar from './components/NodeFollowToolbar';
import { VIDEO_ENHANCE_EDGE_ORIGIN } from './videoEnhance';

vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

/** FlowCanvas 打桩：透出 props 供测试读取节点/连线与触发画布回调 */
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

vi.mock('@/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchMe: vi.fn(async () => null),
  fetchQuota: vi.fn(async () => ({})),
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
  createMediaExtraction: vi.fn(),
  createImageEnhancement: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async () => []),
}));

vi.mock('@/api/projects', () => ({
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
}));
vi.mock('@/api/auth', () => ({
  fetchMe: apiMocks.fetchMe,
  fetchQuota: apiMocks.fetchQuota,
  toSessionUser: apiMocks.toSessionUser,
}));
vi.mock('@/api/assets', () => ({
  UPLOAD_SIZE_LIMIT: 100 * 1024 * 1024,
  fetchUploadPresign: vi.fn(),
  putToPresignedUrl: vi.fn(),
  completeUpload: vi.fn(),
  fetchAllAssets: vi.fn(async () => []),
  fetchAssetDetail: vi.fn(),
  linkAssetToProject: vi.fn(),
}));

/* 序列化保持与真实实现同构（JSON 可序列化字段参与签名），否则签名断言失真 */
vi.mock('@/api/canvas', () => ({
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
vi.mock('@/api/jobs', () => ({
  createGenerationJob: apiMocks.createGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createMediaExtraction: apiMocks.createMediaExtraction,
  createImageEnhancement: apiMocks.createImageEnhancement,
  readJobFailText: apiMocks.readJobFailText,
}));
vi.mock('@/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/api/generation', () => ({ fetchGenerationModels: apiMocks.fetchGenerationModels }));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('./hooks/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

/** 画布：一个就绪视频节点 v1（assetId '5'，1280×720 达标）+ 可选成品 HD 卡 h1。
 *  withFinishedHd：true 正常成品卡（lastParams 4k） */
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

/** 走视频节点工具条的「HD」入口（回调挂在节点 data 上） */
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

/** 四路退出工具：X / Esc / 点外 / 点其他卡 */
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
    // 出生位在源卡右侧（x 大于源卡，y 同高）
    expect((draft.position as { x: number }).x).toBeGreaterThan(400);

    // 纯视觉来源连线（origin 标记）
    const edge = (flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>)
      .find((e) => e.target === draft.id)!;
    expect(edge.source).toBe('v1');
    expect(edge.data).toEqual({ origin: VIDEO_ENHANCE_EDGE_ORIGIN });

    // 面板已渲染（发送钮存在）且面板领土标记在（点外关闭豁免链），默认档 1080P
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
    // patchMediaNode 产出新节点对象：重新读取（点击前引用已过期）
    expect(identityOf(hdDraft())).toEqual({ sourceAssetId: '5', lastParams: { resolution: '4k' } });
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    expect(apiMocks.createImageEnhancement).not.toHaveBeenCalled();
  });
});

describe('IKH3VG 会话模态：全局工具条门与互斥', () => {
  it('HD 面板打开期间：全部媒体卡注入 soloToolbarHidden，钉屏幕工具条容器 show 关闭；关闭后恢复', async () => {
    seedDoc();
    await renderPage();
    // 模拟唯一选中源卡（soloMediaToolbarNode 非空，容器挂载）
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [mediaNode('v1')], edges: [] });
    });
    await videoEnhance();

    // 渲染期注入：全部媒体卡（含源卡与新 HD 卡）工具条隐藏标记
    for (const node of mediaNodes()) {
      expect((node.data as Record<string, unknown>).soloToolbarHidden).toBe(true);
    }
    // 钉屏幕容器 show 门关闭（真实显隐控制点）
    expect(mediaFollowToolbarShow()).toBe(false);

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
      (mediaNode('v1').data as Record<string, unknown>).onVideoSubtitleErase?.('v1');
    });
    expect(panelSend()).toBeNull();
    expect(hdDraft()).toBeTruthy(); // 草稿卡保留
  });
});

/** 钉屏幕媒体卡工具条容器 show 门（toolSessionModal.test.tsx 同款读取） */
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

    // 点 HD 草稿卡重开（onNodeClick 分流，不落视频生成面板）
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
      // 面板关闭、草稿卡保留、参数保留、无创建调用
      expect(panelSend()).toBeNull();
      expect(hdDraft()).toBeTruthy();
      expect(identityOf(hdDraft())).toEqual({ sourceAssetId: '5', lastParams: { resolution: '4k' } });
      expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
      // 重开面板继续（下一路退出的起点）
      await act(async () => {
        flowProps.current.onNodeClick(hdDraft()!);
      });
    }
  });
});

describe('IKH3VG 重新编辑分流与参数恢复', () => {
  it('成品 HD 卡「重新编辑」打开 HD 面板并回填 lastParams（不进视频生成面板）', async () => {
    seedDoc(true);
    await renderPage();

    await act(async () => {
      ((mediaNode('h1').data as Record<string, unknown>).onReEdit as (id: string) => void)('h1');
    });
    // HD 面板特征（若进了视频生成面板则不会有 HD 发送钮）
    expect(panelSend()).toBeTruthy();
    // lastParams 回填：4K 选中
    expect(panelResolution('4k')!.className).toMatch(/Active/);
    expect(panelResolution('1080p')!.className).not.toMatch(/Active/);
  });

  it('成品 HD 卡点卡也回 HD 面板（hasGenerationRecord 成品卡路径同分流）', async () => {
    seedDoc(true);
    await renderPage();
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('h1'));
    });
    expect(panelSend()).toBeTruthy();
    expect(panelResolution('4k')!.className).toMatch(/Active/);
  });
});
