// @vitest-environment jsdom
import { dockActions } from './testing/dockActionsRecorder';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import NodeFollowToolbar from './components/NodeFollowToolbar';
import { FRAME_INTERPOLATION_EDGE_ORIGIN, frameInterpolationDisplayName } from './frameInterpolation';
import {
  apiMocks,
  canvasDocMock,
  enableReactActEnvironment,
  flowProps,
  mediaNodes,
  renderPage,
  unmountPage,
} from './testing/canvasPageTestHarness';

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

function seedDoc(opts?: { withDraftCard?: boolean; unlinked?: boolean }) {
  const nodes: Array<Record<string, unknown>> = [
    {
      id: 'v1',
      type: 'mediaNode',
      position: { x: 400, y: 0 },
      data: {
        src: 'http://vid/v1.mp4',
        mediaType: 'video',
        fileName: '素材视频',
        ...(opts?.unlinked ? {} : { assetId: '5' }),
        width: 1280,
        height: 720,
      },
    },
  ];
  const edges: Array<Record<string, unknown>> = [];
  if (opts?.withDraftCard) {
    nodes.push({
      id: 'i1',
      type: 'mediaNode',
      position: { x: 1038, y: 0 },
      data: {
        src: '',
        mediaType: 'video',
        fileName: frameInterpolationDisplayName(120),
        genStatus: 'draft',
        draft: true,
        frameInterpolation: { sourceAssetId: '5', lastParams: { fps: 120 } },
      },
    });
    edges.push({ id: 'e1', source: 'v1', target: 'i1', data: { origin: FRAME_INTERPOLATION_EDGE_ORIGIN } });
  }
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes,
      edges,
    },
    assets: {
      5: { asset_id: 5, type: 'video', access_url: 'http://vid/v1.mp4', width: 1280, height: 720 },
    },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

async function frameInterpolation(id = 'v1') {
  const video = mediaNodes().find((n) => n.id === id)!;
  const dispatch = (video.data as Record<string, unknown>).onFrameInterpolation as ((nodeId: string) => void) | undefined;
  await act(async () => {
    dispatch?.(id);
  });
}

async function videoEnhance(id = 'v1') {
  const video = mediaNodes().find((n) => n.id === id)!;
  const dispatch = (video.data as Record<string, unknown>).onVideoEnhance as ((nodeId: string) => void) | undefined;
  await act(async () => {
    dispatch?.(id);
  });
}

const mediaNode = (id: string) => mediaNodes().find((n) => n.id === id)!;
const draftNode = () => mediaNodes().find((n) => n.id !== 'v1' && n.id !== 'i1');
const identityOf = (node: Node | undefined) =>
  ((node?.data ?? {}) as Record<string, unknown>).frameInterpolation as Record<string, unknown> | undefined;
const fileNameOf = (node: Node | undefined) => (node?.data as Record<string, unknown> | undefined)?.fileName;
const panelSend = () => document.body.querySelector<HTMLButtonElement>('[data-testid="frame-interpolation-send-btn"]');
const panelFps = (value: number) =>
  document.body.querySelector<HTMLButtonElement>(`[data-testid="frame-interpolation-fps-${value}"]`);
const panelClose = () => document.body.querySelector<HTMLButtonElement>('[data-testid="frame-interpolation-close-btn"]');
const edges = () =>
  flowProps.current.edges as Array<{ id: string; source: string; target: string; data?: Record<string, unknown> }>;

async function click(node: Element | null) {
  await act(async () => {
    node!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function closeViaX() {
  await click(panelClose());
}

async function clickCard(id: string) {
  await act(async () => {
    flowProps.current.onNodeClick(mediaNode(id));
  });
}

function mediaFollowToolbarShow(): boolean | undefined {
  const frag = flowProps.current.followToolbarLayer as { props?: { children?: unknown } } | undefined;
  const children = frag?.props?.children;
  const arr = Array.isArray(children) ? children : [children];
  const el = arr.find((c) => (c as { type?: unknown } | null)?.type === NodeFollowToolbar) as
    { props?: { show?: boolean } } | undefined;
  return el?.props?.show;
}

beforeEach(() => {
  enableReactActEnvironment();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(async () => {
  await unmountPage();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKHLKR 点插帧建草稿卡与面板跟随', () => {
  it('点插帧：源卡右侧建插帧草稿卡（卡名/身份/草稿态）+ 来源边 + 弹出插帧面板（默认 60fps）', async () => {
    seedDoc();
    await renderPage();
    await frameInterpolation();

    const draft = draftNode()!;
    expect(draft).toBeTruthy();
    const data = draft.data as Record<string, unknown>;
    expect(data.mediaType).toBe('video');
    expect(data.draft).toBe(true);
    expect(data.genStatus).toBe('draft');
    expect(data.fileName).toBe('插帧 · 60fps');
    expect(identityOf(draft)).toEqual({ sourceAssetId: '5', lastParams: { fps: 60 } });
    expect((draft.position as { x: number }).x).toBeGreaterThan(400);
    expect((draft.position as { y: number }).y).toBe(0);

    const edge = edges().find((e) => e.target === draft.id)!;
    expect(edge.source).toBe('v1');
    expect(edge.data).toEqual({ origin: FRAME_INTERPOLATION_EDGE_ORIGIN });

    expect(panelSend()).toBeTruthy();
    expect(document.body.querySelector('[data-testid="frame-interpolation-dialog"]')).toBeTruthy();
    expect(document.body.querySelector('[data-gen-panel-territory]')).toBeTruthy();
    expect(panelFps(60)!.className).toMatch(/Active/);
    expect(panelFps(30)).toBeTruthy();
    expect(panelFps(120)).toBeTruthy();
    expect(document.body.textContent).toContain('视频插帧');
    expect(document.body.textContent).toContain('目标帧率');
    expect(document.body.textContent).toContain('本期免费');
    expect(panelSend()!.getAttribute('title')).toBe('智能补帧，最高可至 120fps');
    expect(fileNameOf(mediaNode('v1'))).toBe('素材视频');
    expect(identityOf(mediaNode('v1'))).toBeUndefined();
  });

  it('每次点击独立建卡：连续两次点插帧得到两张插帧草稿卡（各自连来源边）', async () => {
    seedDoc();
    await renderPage();
    await frameInterpolation();
    const first = draftNode()!.id;
    await closeViaX();
    await frameInterpolation();
    const drafts = mediaNodes().filter((n) => n.id !== 'v1' && n.id !== 'i1');
    expect(drafts).toHaveLength(2);
    expect(drafts.map((n) => n.id)).toContain(first);
    for (const d of drafts) {
      expect(edges().some((e) => e.source === 'v1' && e.target === d.id)).toBe(true);
    }
  });

  it('源卡未关联资产：兜底门槛拦住，不建卡不开面板（菜单项置灰层已在 Toolbar 覆盖）', async () => {
    seedDoc({ unlinked: true });
    await renderPage();
    await frameInterpolation();
    expect(draftNode()).toBeUndefined();
    expect(panelSend()).toBeNull();
    expect(edges()).toHaveLength(0);
  });

  it('HD 原链路回归：点触发钮直启首项仍在源卡右侧建「HD」草稿卡并弹 HD 面板', async () => {
    seedDoc();
    await renderPage();
    await videoEnhance();
    const hd = mediaNodes().find((n) => n.id !== 'v1' && n.id !== 'i1')!;
    expect(fileNameOf(hd)).toBe('HD');
    expect((hd.data as Record<string, unknown>).videoEnhance).toEqual({ sourceAssetId: '5' });
    expect(document.body.querySelector('[data-testid="video-enhance-send-btn"]')).toBeTruthy();
    expect(document.body.querySelector('[data-testid="frame-interpolation-dialog"]')).toBeNull();
  });
});

describe('IKHLKR 切档即时改名与持久化', () => {
  it('切 120fps：草稿卡名与 lastParams 同步更新（无创建 API 调用——发送归 IKHLKX）', async () => {
    seedDoc();
    await renderPage();
    await frameInterpolation();
    const draftId = draftNode()!.id;

    await click(panelFps(120));
    expect(panelFps(120)!.className).toMatch(/Active/);
    expect(panelFps(60)!.className).not.toMatch(/Active/);
    expect(fileNameOf(mediaNode(draftId))).toBe('插帧 · 120fps');
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 } });
    expect(dockActions.updateDraft).toHaveBeenCalledWith('frameInterpolation', { nodeId: draftId, value: 120 });

    await click(panelFps(30));
    expect(fileNameOf(mediaNode(draftId))).toBe('插帧 · 30fps');
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { fps: 30 } });
    expect((mediaNode(draftId).data as Record<string, unknown>).genStatus).toBe('draft');
    expect((mediaNode(draftId).data as Record<string, unknown>).jobId).toBeUndefined();
  });

  it('用户改过名（customName）：切档只更新 lastParams，不覆盖自定义卡名', async () => {
    seedDoc();
    await renderPage();
    await frameInterpolation();
    const draftId = draftNode()!.id;

    await act(async () => {
      ((mediaNode(draftId).data as Record<string, unknown>).onTitleChange as (id: string, name: string) => void)(
        draftId,
        '我的插帧卡',
      );
    });
    await click(panelFps(120));
    expect(fileNameOf(mediaNode(draftId))).toBe('我的插帧卡');
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 } });
  });

  it('发送钮点击（IKJJR3 提交点即交接）：创建失败草稿回配置态不写 jobId——不制造受理假象', async () => {
    seedDoc();
    apiMocks.createFrameInterpolation.mockRejectedValueOnce(new Error('network down'));
    await renderPage();
    await frameInterpolation();
    const draftId = draftNode()!.id;
    await click(panelSend());
    expect(dockActions.submit).toHaveBeenCalledWith('frameInterpolation', 60);
    await act(async () => {});
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(1);
    expect(panelSend()).toBeNull();
    expect((mediaNode(draftId).data as Record<string, unknown>).genStatus).toBe('draft');
    expect((mediaNode(draftId).data as Record<string, unknown>).jobId).toBeUndefined();
    await clickCard(draftId);
    expect(panelSend()).toBeTruthy();
  });
});

describe('IKHLKR 关闭重开与刷新恢复', () => {
  it('关闭（X）后再点插帧草稿卡：面板重开且档位恢复（lastParams 120fps）', async () => {
    seedDoc();
    await renderPage();
    await frameInterpolation();
    const draftId = draftNode()!.id;
    await click(panelFps(120));
    await closeViaX();
    expect(panelSend()).toBeNull();

    await clickCard(draftId);
    expect(panelSend()).toBeTruthy();
    expect(panelFps(120)!.className).toMatch(/Active/);
    expect(panelFps(60)!.className).not.toMatch(/Active/);
  });

  it('刷新（水合）后档位与来源边恢复：点带插帧身份的草稿卡开面板即 120fps，来源边仍在', async () => {
    seedDoc({ withDraftCard: true });
    await renderPage();
    const restoredEdge = edges().find((e) => e.target === 'i1')!;
    expect(restoredEdge.source).toBe('v1');
    expect(restoredEdge.data).toEqual({ origin: FRAME_INTERPOLATION_EDGE_ORIGIN });

    await clickCard('i1');
    expect(panelSend()).toBeTruthy();
    expect(panelFps(120)!.className).toMatch(/Active/);
    expect(panelFps(60)!.className).not.toMatch(/Active/);
    expect(fileNameOf(mediaNode('i1'))).toBe('插帧 · 120fps');
    expect(identityOf(mediaNode('i1'))).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 } });
  });

  it('面板打开期间点其他卡：面板关闭、草稿卡与参数保留（不建任务）', async () => {
    seedDoc();
    await renderPage();
    await frameInterpolation();
    const draftId = draftNode()!.id;
    await click(panelFps(30));

    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [mediaNode('v1')], edges: [] });
    });
    expect(panelSend()).toBeNull();
    expect(mediaNode(draftId)).toBeTruthy();
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { fps: 30 } });

    await clickCard(draftId);
    expect(panelSend()).toBeTruthy();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(panelSend()).toBeNull();
    await clickCard(draftId);
    expect(panelSend()).toBeTruthy();
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(panelSend()).toBeNull();
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { fps: 30 } });
  });
});

describe('IKHLKR 会话模态与跟随锚定', () => {
  it('插帧面板打开期间：全部媒体卡注入 soloToolbarHidden，钉屏幕工具条容器 show 关闭；关闭后恢复', async () => {
    seedDoc();
    await renderPage();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [mediaNode('v1')], edges: [] });
    });
    await frameInterpolation();

    for (const node of mediaNodes()) {
      expect((node.data as Record<string, unknown>).soloToolbarHidden).toBe(true);
    }
    expect(mediaFollowToolbarShow()).toBe(false);

    await closeViaX();
    for (const node of mediaNodes()) {
      expect((node.data as Record<string, unknown>).soloToolbarHidden).toBeUndefined();
    }
    expect(mediaFollowToolbarShow()).toBe(true);
  });

  it('跟随锚定接通：容器有尺寸时面板按插帧卡锚定定位（left/top 由锚计算注入）', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
    seedDoc();
    await renderPage();
    await frameInterpolation();

    const panel = document.body.querySelector<HTMLElement>('[data-testid="frame-interpolation-dialog"]')!;
    expect(panel.style.left).not.toBe('');
    expect(panel.style.top).not.toBe('');
    expect(Number.parseInt(panel.style.left, 10)).toBeGreaterThan(0);
    expect(Number.parseInt(panel.style.top, 10)).toBeGreaterThanOrEqual(0);
  });

  it('与 HD 面板同门互斥：插帧面板打开时进入去字幕编辑态，插帧面板关闭（草稿卡保留）', async () => {
    seedDoc();
    await renderPage();
    await frameInterpolation();
    expect(panelSend()).toBeTruthy();

    await act(async () => {
      const enterSubtitleErase = (mediaNode('v1').data as Record<string, unknown>)
        .onVideoSubtitleErase as ((id: string, mode?: string) => void) | undefined;
      enterSubtitleErase?.('v1', 'smart');
    });
    expect(panelSend()).toBeNull();
    expect(draftNode()).toBeTruthy();
  });
});


it('IKJUH0 插帧只渲染一份，真实X调用Dock.close', async () => {
  seedDoc(); await renderPage(); await frameInterpolation();
  expect(document.body.querySelectorAll('[data-testid="frame-interpolation-send-btn"]')).toHaveLength(1);
  await closeViaX();
  expect(dockActions.close).toHaveBeenCalledWith('frameInterpolation');
  expect(panelSend()).toBeNull();
});
