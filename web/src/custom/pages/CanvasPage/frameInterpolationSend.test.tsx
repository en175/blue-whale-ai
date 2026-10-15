// @vitest-environment jsdom
import { dockActions } from './testing/dockActionsRecorder';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
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

vi.setConfig({ testTimeout: 20_000, hookTimeout: 60_000 });

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

function seedDoc(mode: 'draft' | 'generating' | 'failed' = 'draft') {
  const nodes: Array<Record<string, unknown>> = [
    {
      id: 'v1',
      type: 'mediaNode',
      position: { x: 400, y: 0 },
      data: {
        src: 'http://vid/v1.mp4',
        mediaType: 'video',
        fileName: '素材视频',
        assetId: mode === 'failed' ? '7' : '5',
        width: 1280,
        height: 720,
      },
    },
  ];
  const edges: Array<Record<string, unknown>> = [];
  const assets: Record<string, unknown> = {
    5: { asset_id: 5, type: 'video', access_url: 'http://vid/v1.mp4', width: 1280, height: 720 },
    7: { asset_id: 7, type: 'video', access_url: 'http://vid/v1.mp4', width: 1280, height: 720 },
  };
  if (mode === 'generating') {
    apiMocks.fetchFrameInterpolationCurrent.mockResolvedValue({ job_id: 'j9', status: 'processing', progress: 0, created_at: '2026-09-22T05:00:00.000Z' });
    apiMocks.fetchJobs.mockResolvedValue({ records: [{
      job_id: 'j9', type: 'video_frame_interpolation', status: 'processing', progress: 0,
      input: { source_asset_id: '5', target_node_id: 'i1', fps: 120 },
      created_at: '2026-09-22T05:00:00.000Z', output_assets: [],
    }], total: 1, size: 1, current: 1 });
    nodes.push({
      id: 'i1',
      type: 'mediaNode',
      position: { x: 1038, y: 0 },
      data: {
        src: '',
        mediaType: 'video',
        fileName: frameInterpolationDisplayName(120),
        genStatus: 'generating',
        progress: 0,
        draft: true,
        jobId: 'j9',
        frameInterpolation: { sourceAssetId: '5', lastParams: { fps: 120 } },
      },
    });
    edges.push({ id: 'e1', source: 'v1', target: 'i1', data: { origin: FRAME_INTERPOLATION_EDGE_ORIGIN } });
  }
  if (mode === 'failed') {
    nodes.push({
      id: 'i1',
      type: 'mediaNode',
      position: { x: 1038, y: 0 },
      data: {
        src: '',
        mediaType: 'video',
        fileName: frameInterpolationDisplayName(30),
        genStatus: 'failed',
        draft: true,
        jobId: 'j1',
        errorText: '视频插帧失败，请重试',
        frameInterpolation: { sourceAssetId: '5', lastParams: { fps: 30 } },
      },
    });
    edges.push({ id: 'e1', source: 'v1', target: 'i1', data: { origin: FRAME_INTERPOLATION_EDGE_ORIGIN } });
  }
  canvasDocMock.current = {
    doc: { id: 11, version: 3, viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges },
    assets,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

const mediaNode = (id: string) => mediaNodes().find((n) => n.id === id)!;
const dataOf = (id: string) => (mediaNode(id).data ?? {}) as Record<string, unknown>;
const draftNodes = () => mediaNodes().filter((n) => n.id !== 'v1' && n.id !== 'i1');
const identityOf = (node: Node | undefined) =>
  ((node?.data ?? {}) as Record<string, unknown>).frameInterpolation as Record<string, unknown> | undefined;
const edges = () =>
  flowProps.current.edges as Array<{ id: string; source: string; target: string; data?: Record<string, unknown> }>;
const panelSend = () => document.body.querySelector<HTMLButtonElement>('[data-testid="frame-interpolation-send-btn"]');
const panelClose = () => document.body.querySelector<HTMLButtonElement>('[data-testid="frame-interpolation-close-btn"]');
const panelFps = (value: number) =>
  document.body.querySelector<HTMLButtonElement>(`[data-testid="frame-interpolation-fps-${value}"]`);
const panelOpen = () => document.body.querySelector('[data-testid="frame-interpolation-dialog"]') !== null;
const videoDockOpen = () => document.body.querySelector('[data-testid="video-send"]') !== null;

async function frameInterpolation(id = 'v1') {
  await act(async () => {
    ((mediaNode(id).data as Record<string, unknown>).onFrameInterpolation as (nodeId: string) => void)(id);
  });
}

const videoEnhance = (id: string) =>
  act(async () => {
    ((mediaNode(id).data as Record<string, unknown>).onVideoEnhance as (nodeId: string) => void)(id);
  });

async function click(node: Element | null) {
  await act(async () => {
    node!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function clickCard(id: string) {
  await act(async () => {
    flowProps.current.onNodeClick(mediaNode(id));
  });
}

const flush = () => act(async () => {});

async function sendPanel() {
  await act(async () => {
    panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function deferredJobStatus() {
  const resolvers = new Map<string, (detail: Record<string, unknown>) => void>();
  apiMocks.fetchJobStatus.mockImplementation(
    (jobId: string) => new Promise((resolve) => { resolvers.set(String(jobId), resolve); }),
  );
  return resolvers;
}

function deferredJobStatusCalls() {
  const resolvers: Array<(detail: Record<string, unknown>) => void> = [];
  apiMocks.fetchJobStatus.mockImplementation(
    () => new Promise((resolve) => { resolvers.push(resolve); }),
  );
  return resolvers;
}

beforeEach(() => {
  enableReactActEnvironment();
  localStorage.clear();
  sessionStorage.clear();
  apiMocks.cancelGenerationJob.mockImplementation(async () => null);
});

afterEach(async () => {
  await unmountPage();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKHLKX 发送创建闭环', () => {
  it('发送：三键冻结（source_asset_id / target_node_id / fps 整型）、创建成功才关面板、卡原地转生成中、lastParams 写卡、jobId 登记并启动轮询、源卡不动不新增结果卡', async () => {
    seedDoc();
    apiMocks.createFrameInterpolation.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 20, asset: null });
    await renderPage();
    await frameInterpolation();
    const draftId = draftNodes()[0]!.id;

    await click(panelFps(120));
    await sendPanel();
    expect(dockActions.submit).toHaveBeenCalledWith('frameInterpolation', 120);

    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(1);
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledWith('p1', {
      source_asset_id: '5',
      target_node_id: draftId,
      fps: 120,
    }, expect.objectContaining({ silent: true }));
    expect(panelOpen()).toBe(false);
    expect(panelSend()).toBeNull();
    const data = dataOf(draftId);
    expect(data.genStatus).toBe('generating');
    expect(data.jobId).toBe('j1');
    expect(data.progress).toBe(20);
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 }, frozenParams: { fps: 120 } });
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j1');
    expect(mediaNodes().length).toBe(2);
    expect(dataOf('v1').src).toBe('http://vid/v1.mp4');
    expect(edges().find((e) => e.target === draftId)?.source).toBe('v1');
  });

  it('发送前先冲刷画布保存（票面 IKHLKX 验收 2）：草稿卡与来源边落盘请求早于创建请求，受理后立即关页也不丢卡', async () => {
    seedDoc();
    apiMocks.createFrameInterpolation.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 0, asset: null });
    await renderPage();
    await frameInterpolation();
    const draftId = draftNodes()[0]!.id;
    await sendPanel();

    expect(apiMocks.saveCanvasDoc).toHaveBeenCalled();
    const saved = (apiMocks.saveCanvasDoc.mock.calls as unknown as Array<[string, {
      nodes: Array<{ id: string }>;
      edges: Array<{ id: string; source: string; target: string }>;
    }]>).at(-1)![1];
    expect(saved.nodes.map((n) => n.id)).toContain(draftId);
    expect(saved.edges.find((e) => e.target === draftId)?.source).toBe('v1');
    expect(apiMocks.saveCanvasDoc.mock.invocationCallOrder.at(-1)!)
      .toBeLessThan(apiMocks.createFrameInterpolation.mock.invocationCallOrder[0]!);

    await unmountPage();
    seedDoc('failed');
    apiMocks.saveCanvasDoc.mockClear();
    apiMocks.createFrameInterpolation.mockClear();
    apiMocks.createFrameInterpolation.mockResolvedValue({ job_id: 'j2', status: 'queued' });
    await renderPage();
    await act(async () => {
      (dataOf('i1').onRetryJob as (nodeId: string) => void)('i1');
    });
    await flush();
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(1);
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
  });

  it('提交往返期间：提交点即交接（面板关闭、卡转生成中），submitting 窗口统一防重不重复受理', async () => {
    seedDoc();
    let resolveCreate: (value: { job_id: string; status: 'queued' }) => void = () => {};
    apiMocks.createFrameInterpolation.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve; }),
    );
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 0, asset: null });
    await renderPage();
    await frameInterpolation();

    await act(async () => {
      panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(panelOpen()).toBe(false);
    expect(dataOf(draftNodes()[0]!.id).genStatus).toBe('generating');
    await act(async () => { flowProps.current.onNodeClick(mediaNode(draftNodes()[0]!.id)); });
    expect(panelOpen()).toBe(true);
    expect(panelSend()!.disabled).toBe(true);
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(1);

    await act(async () => { resolveCreate({ job_id: 'j1', status: 'queued' }); });
    await flush();
    expect(dataOf(draftNodes()[0]!.id).jobId).toBe('j1');
  });

  it('创建失败（网络）：面板已交接关闭、卡回草稿保留档位不写 jobId；重开重发成功转生成中', async () => {
    seedDoc();
    apiMocks.createFrameInterpolation
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 10, asset: null });
    await renderPage();
    await frameInterpolation();
    const draftId = draftNodes()[0]!.id;

    await click(panelFps(120));
    await sendPanel();
    await flush();

    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(1);
    expect(panelOpen()).toBe(false);
    expect(dataOf(draftId).genStatus).toBe('draft');
    expect(dataOf(draftId).jobId).toBeUndefined();
    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();

    await act(async () => { flowProps.current.onNodeClick(mediaNode(draftId)); });
    expect(panelOpen()).toBe(true);
    expect(panelSend()!.disabled).toBe(false);
    expect(panelFps(120)!.className).toMatch(/Active/);
    await sendPanel();
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(2);
    expect(apiMocks.createFrameInterpolation).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5',
      target_node_id: draftId,
      fps: 120,
    }, expect.objectContaining({ silent: true }));
    expect(panelOpen()).toBe(false);
    expect(dataOf(draftId).genStatus).toBe('generating');
    expect(dataOf(draftId).jobId).toBe('j1');
  });
});

describe('IKHLKX 终态回填与插帧身份清除', () => {
  it('succeeded：结果视频回填插帧卡（src/mediaType/宽高/时长/assetId）、草稿与插帧身份清除、源卡不动且不新增结果卡', async () => {
    seedDoc();
    apiMocks.createFrameInterpolation.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j1', status: 'succeeded', progress: 100,
      asset: { id: 'a88', url: 'http://tos/fi.mp4', type: 'video', width: 1280, height: 720, duration: 12.5 },
    });
    await renderPage();
    await frameInterpolation();
    const draftId = draftNodes()[0]!.id;
    await sendPanel();

    const data = dataOf(draftId);
    expect(data.genStatus).toBeUndefined();
    expect(data.progress).toBe(100);
    expect(data.src).toBe('http://tos/fi.mp4');
    expect(data.mediaType).toBe('video');
    expect(data.assetId).toBe('a88');
    expect(data.width).toBe(1280);
    expect(data.height).toBe(720);
    expect(data.duration).toBe(12.5);
    expect(data.draft).toBeUndefined();
    expect(identityOf(mediaNode(draftId))).toBeUndefined();
    expect(mediaNodes().length).toBe(2);
    expect(dataOf('v1').src).toBe('http://vid/v1.mp4');
  });

  it('failed：空 msg 按 video_frame_interpolation_failed / 数值 1049 归并「视频插帧失败，请重试」', async () => {
    seedDoc('generating');
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j9', status: 'failed', progress: 1,
      error: { code: 'video_frame_interpolation_failed', msg: '' },
    });
    await renderPage();
    expect(dataOf('i1').genStatus).toBe('failed');
    expect(dataOf('i1').errorText).toBe('视频插帧失败，请重试');
    await unmountPage();

    seedDoc('generating');
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j9', status: 'failed', progress: 1, error: { code: 1049, msg: '' },
    });
    await renderPage();
    expect(dataOf('i1').errorText).toBe('视频插帧失败，请重试');
  });

  it('failed：入队失败（enqueue_failed）显示「任务入队失败，请重试」', async () => {
    seedDoc('generating');
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j9', status: 'failed', progress: 0, error: { code: 'enqueue_failed', msg: '' },
    });
    await renderPage();
    expect(dataOf('i1').genStatus).toBe('failed');
    expect(dataOf('i1').errorText).toBe('任务入队失败，请重试');
    expect(identityOf(mediaNode('i1'))).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 }, frozenParams: { fps: 120 } });
    expect(edges().find((e) => e.target === 'i1')?.source).toBe('v1');
  });

  it('failed：入队失败（数值码 1028 + 后端半句 msg）仍显示逐字「任务入队失败，请重试」', async () => {
    seedDoc('generating');
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j9', status: 'failed', progress: 0, error: { code: 1028, msg: '任务入队失败' },
    });
    await renderPage();
    expect(dataOf('i1').genStatus).toBe('failed');
    expect(dataOf('i1').errorText).toBe('任务入队失败，请重试');
  });
});

describe('IKHLKX 失败重试（冻结输入）', () => {
  it('重试：按身份冻结的 sourceAssetId 与 lastParams.fps 原样重发创建接口（不回读源卡后来修改的配置）、不经通用 retry、每次全新创建请求', async () => {
    seedDoc('failed');
    apiMocks.createFrameInterpolation
      .mockResolvedValueOnce({ job_id: 'j2', status: 'queued' })
      .mockResolvedValueOnce({ job_id: 'j3', status: 'queued' });
    apiMocks.fetchJobStatus
      .mockResolvedValueOnce({ job_id: 'j2', status: 'failed', progress: 1, error: { code: 1049, msg: '' } })
      .mockResolvedValueOnce({
        job_id: 'j3', status: 'succeeded', progress: 100,
        asset: { id: 'a91', url: 'http://tos/fi2.mp4', type: 'video', width: 1280, height: 720, duration: 9 },
      });
    await renderPage();

    await act(async () => {
      (dataOf('i1').onRetryJob as (nodeId: string) => void)('i1');
    });
    await flush();

    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(1);
    expect(apiMocks.createFrameInterpolation).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5',
      target_node_id: 'i1',
      fps: 30,
    }, expect.objectContaining({ silent: true }));
    expect(apiMocks.retryGenerationJob).not.toHaveBeenCalled();
    expect(dataOf('i1').genStatus).toBe('failed');
    expect(dataOf('i1').errorText).toBe('视频插帧失败，请重试');

    await act(async () => {
      (dataOf('i1').onRetryJob as (nodeId: string) => void)('i1');
    });
    await flush();

    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(2);
    expect(apiMocks.createFrameInterpolation).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5',
      target_node_id: 'i1',
      fps: 30,
    }, expect.objectContaining({ silent: true }));
    expect(dataOf('i1').genStatus).toBeUndefined();
    expect(dataOf('i1').src).toBe('http://tos/fi2.mp4');
    expect(dataOf('i1').assetId).toBe('a91');
    expect(identityOf(mediaNode('i1'))).toBeUndefined();
    expect(dataOf('v1').assetId).toBe('7');
  });
});

describe('IKHLKX 生成中取消与竞态', () => {
  it('取消：取消接口携带 jobId、权威 cancelled 后回草稿（身份与来源边保留），取消后迟到的轮询成功响应不回填成品', async () => {
    seedDoc();
    apiMocks.createFrameInterpolation.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    const resolvers = deferredJobStatusCalls();
    await renderPage();
    await frameInterpolation();
    const draftId = draftNodes()[0]!.id;
    await click(panelFps(120));
    await sendPanel();
    expect(dataOf(draftId).genStatus).toBe('generating');
    expect(resolvers.length).toBe(1);

    await act(async () => {
      (dataOf(draftId).onCancelJob as (nodeId: string) => void)(draftId);
    });
    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledWith('p1', 'j1');
    expect(resolvers.length).toBe(2);
    await act(async () => {
      resolvers[1]!({ job_id: 'j1', status: 'cancelled', progress: 0, asset: null });
    });

    expect(mediaNodes().length).toBe(2);
    expect(dataOf(draftId).genStatus).toBe('draft');
    expect(dataOf(draftId).jobId).toBe('j1');
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 }, frozenParams: { fps: 120 } });
    expect(edges().find((e) => e.target === draftId)?.source).toBe('v1');

    await act(async () => {
      resolvers[0]!({
        job_id: 'j1', status: 'succeeded', progress: 100,
        asset: { id: 'a99', url: 'http://tos/late.mp4', type: 'video', width: 1280, height: 720, duration: 5 },
      });
    });
    expect(dataOf(draftId).genStatus).toBe('draft');
    expect(dataOf(draftId).src).toBe('');
    expect(dataOf(draftId).assetId).toBeUndefined();
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 }, frozenParams: { fps: 120 } });
  });
});

describe('IKHLKX 并行任务隔离', () => {
  it('同源不同帧率并发：各卡各 job 互不串卡，完成顺序颠倒各自回填；失败卡重试沿用自己冻结的 fps', async () => {
    seedDoc();
    apiMocks.createFrameInterpolation
      .mockResolvedValueOnce({ job_id: 'jA', status: 'queued' })
      .mockResolvedValueOnce({ job_id: 'jB', status: 'queued' })
      .mockResolvedValueOnce({ job_id: 'jC', status: 'queued' });
    const resolvers = deferredJobStatus();
    await renderPage();

    await frameInterpolation();
    const cardA = draftNodes()[0]!.id;
    await click(panelFps(30));
    await sendPanel();
    await frameInterpolation();
    const cardB = draftNodes().find((n) => n.id !== cardA)!.id;
    await click(panelFps(120));
    await sendPanel();

    expect(apiMocks.createFrameInterpolation).toHaveBeenNthCalledWith(1, 'p1', {
      source_asset_id: '5', target_node_id: cardA, fps: 30,
    }, expect.objectContaining({ silent: true }));
    expect(apiMocks.createFrameInterpolation).toHaveBeenNthCalledWith(2, 'p1', {
      source_asset_id: '5', target_node_id: cardB, fps: 120,
    }, expect.objectContaining({ silent: true }));
    expect(dataOf(cardA).jobId).toBe('jA');
    expect(dataOf(cardB).jobId).toBe('jB');
    expect(mediaNodes().length).toBe(3);

    await act(async () => {
      resolvers.get('jB')!({ job_id: 'jB', status: 'failed', progress: 1, error: { code: 1049, msg: '' } });
    });
    await act(async () => {
      resolvers.get('jA')!({
        job_id: 'jA', status: 'succeeded', progress: 100,
        asset: { id: 'aA', url: 'http://tos/a30.mp4', type: 'video', width: 1280, height: 720, duration: 7 },
      });
    });
    expect(dataOf(cardB).genStatus).toBe('failed');
    expect(dataOf(cardB).errorText).toBe('视频插帧失败，请重试');
    expect(identityOf(mediaNode(cardB))).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 }, frozenParams: { fps: 120 } });
    expect(dataOf(cardA).src).toBe('http://tos/a30.mp4');
    expect(dataOf(cardA).assetId).toBe('aA');
    expect(dataOf(cardA).duration).toBe(7);
    expect(identityOf(mediaNode(cardA))).toBeUndefined();
    expect(dataOf('v1').src).toBe('http://vid/v1.mp4');
    expect(edges().find((e) => e.target === cardA)?.source).toBe('v1');
    expect(edges().find((e) => e.target === cardB)?.source).toBe('v1');

    await act(async () => {
      (dataOf(cardB).onRetryJob as (nodeId: string) => void)(cardB);
    });
    expect(apiMocks.createFrameInterpolation).toHaveBeenNthCalledWith(3, 'p1', {
      source_asset_id: '5', target_node_id: cardB, fps: 120,
    }, expect.objectContaining({ silent: true }));
    await act(async () => {
      resolvers.get('jC')!({
        job_id: 'jC', status: 'succeeded', progress: 100,
        asset: { id: 'aB', url: 'http://tos/b120.mp4', type: 'video', width: 1280, height: 720, duration: 7 },
      });
    });
    expect(dataOf(cardB).src).toBe('http://tos/b120.mp4');
    expect(dataOf(cardA).src).toBe('http://tos/a30.mp4');
  });
});

describe('IKHLKX 持久化恢复与成品再用', () => {
  it('受理后立即刷新/重进画布：以持久化 jobId 恢复轮询、succeeded 回填成品并清插帧身份（不丢任务/结果、不重复建卡）', async () => {
    seedDoc('generating');
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j9', status: 'succeeded', progress: 100,
      asset: { id: 'a90', url: 'http://tos/restored.mp4', type: 'video', width: 1920, height: 1080, duration: 18 },
    });
    await renderPage();

    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j9');
    const data = dataOf('i1');
    expect(data.genStatus).toBeUndefined();
    expect(data.src).toBe('http://tos/restored.mp4');
    expect(data.assetId).toBe('a90');
    expect(data.width).toBe(1920);
    expect(data.height).toBe(1080);
    expect(data.duration).toBe(18);
    expect(data.draft).toBeUndefined();
    expect(identityOf(mediaNode('i1'))).toBeUndefined();
    expect(mediaNodes().length).toBe(2);
    expect(edges().find((e) => e.target === 'i1')?.source).toBe('v1');

    await clickCard('i1');
    expect(panelOpen()).toBe(false);
    expect(videoDockOpen()).toBe(true);

    await frameInterpolation('i1');
    const chained = draftNodes().find((n) => n.id !== 'i1')!;
    expect(identityOf(chained)).toEqual({ sourceAssetId: 'a90', lastParams: { fps: 60 } });
    expect(edges().find((e) => e.target === chained.id)?.source).toBe('i1');
    expect(dataOf('i1').src).toBe('http://tos/restored.mp4');
  });

  it('超 HD 门槛的插帧成品卡：HD 入口沿用原门槛置灰兜底，不建卡不弹面板（链式成品仍可插帧）', async () => {
    seedDoc('generating');
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j9', status: 'succeeded', progress: 100,
      asset: { id: 'a4k', url: 'http://tos/4k.mp4', type: 'video', width: 3840, height: 2160, duration: 20 },
    });
    await renderPage();

    await videoEnhance('i1');
    expect(mediaNodes().length).toBe(2);
    expect(document.body.querySelector('[data-testid="video-enhance-send-btn"]')).toBeNull();

    await frameInterpolation('i1');
    expect(draftNodes().filter((n) => n.id !== 'i1')).toHaveLength(1);
    expect(panelOpen()).toBe(true);
  });
});

describe('IKHSFH 编辑参数与受理冻结输入分离', () => {
  it('60fps 受理失败后：面板改 120（lastParams 跟随编辑）点失败卡重试仍发 60（frozenParams 冻结）；重试受理后 lastParams 保持编辑值不被回写', async () => {
    seedDoc();
    apiMocks.createFrameInterpolation
      .mockResolvedValueOnce({ job_id: 'j1', status: 'queued' })
      .mockResolvedValueOnce({ job_id: 'j2', status: 'queued' });
    apiMocks.fetchJobStatus
      .mockResolvedValueOnce({ job_id: 'j1', status: 'failed', progress: 1, error: { code: 1049, msg: '' } })
      .mockResolvedValueOnce({ job_id: 'j2', status: 'processing', progress: 5, asset: null });
    await renderPage();
    await frameInterpolation();
    const draftId = draftNodes()[0]!.id;

    await sendPanel();
    await flush();
    expect(apiMocks.createFrameInterpolation).toHaveBeenNthCalledWith(1, 'p1', {
      source_asset_id: '5',
      target_node_id: draftId,
      fps: 60,
    }, expect.objectContaining({ silent: true }));
    expect(dataOf(draftId).genStatus).toBe('failed');
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { fps: 60 }, frozenParams: { fps: 60 } });

    await clickCard(draftId);
    expect(panelOpen()).toBe(true);
    await click(panelFps(120));
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 }, frozenParams: { fps: 60 } });

    await act(async () => {
      (dataOf(draftId).onRetryJob as (nodeId: string) => void)(draftId);
    });
    await flush();
    expect(apiMocks.createFrameInterpolation).toHaveBeenNthCalledWith(2, 'p1', {
      source_asset_id: '5',
      target_node_id: draftId,
      fps: 60,
    }, expect.objectContaining({ silent: true }));

    expect(dataOf(draftId).genStatus).toBe('generating');
    expect(dataOf(draftId).jobId).toBe('j2');
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 }, frozenParams: { fps: 60 } });
  });

  it('面板主动发送新配置：发当前编辑档 120，成功受理后冻结输入才更新为 120', async () => {
    seedDoc();
    apiMocks.createFrameInterpolation
      .mockResolvedValueOnce({ job_id: 'j1', status: 'queued' })
      .mockResolvedValueOnce({ job_id: 'j3', status: 'queued' });
    apiMocks.fetchJobStatus
      .mockResolvedValueOnce({ job_id: 'j1', status: 'failed', progress: 1, error: { code: 1049, msg: '' } })
      .mockResolvedValueOnce({ job_id: 'j3', status: 'processing', progress: 5, asset: null });
    await renderPage();
    await frameInterpolation();
    const draftId = draftNodes()[0]!.id;

    await sendPanel();
    await flush();
    expect(dataOf(draftId).genStatus).toBe('failed');

    await clickCard(draftId);
    await click(panelFps(120));
    await sendPanel();
    expect(apiMocks.createFrameInterpolation).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5',
      target_node_id: draftId,
      fps: 120,
    }, expect.objectContaining({ silent: true }));
    expect(dataOf(draftId).genStatus).toBe('generating');
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 }, frozenParams: { fps: 120 } });
  });

  it('旧持久化失败卡（无 frozenParams，IKHLKX 时期形态）：重试回落 lastParams 兼容', async () => {
    seedDoc('failed');
    apiMocks.createFrameInterpolation.mockResolvedValue({ job_id: 'j2', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j2', status: 'processing', progress: 0, asset: null });
    await renderPage();

    await act(async () => {
      (dataOf('i1').onRetryJob as (nodeId: string) => void)('i1');
    });
    await flush();
    expect(apiMocks.createFrameInterpolation).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5',
      target_node_id: 'i1',
      fps: 30,
    }, expect.objectContaining({ silent: true }));
    expect(identityOf(mediaNode('i1'))).toEqual({ sourceAssetId: '5', lastParams: { fps: 30 }, frozenParams: { fps: 30 } });
  });
});

describe('IKHSFH 同步防重（保存至创建返回窗口）与失败解锁', () => {
  it('失败卡面板已打开时重试：保存与创建期间立即只读，失败后恢复且可再次重试', async () => {
    seedDoc('failed');
    let rejectCreate!: (error: unknown) => void;
    apiMocks.createFrameInterpolation
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectCreate = reject; }))
      .mockResolvedValueOnce({ job_id: 'j2', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j2', status: 'processing', progress: 0, asset: null });
    await renderPage();
    await clickCard('i1');
    expect(panelFps(120)!.disabled).toBe(false);
    expect(panelSend()!.disabled).toBe(false);
    await click(panelFps(120));
    await act(async () => { (dataOf('i1').onRetryJob as (nodeId: string) => void)('i1'); });
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(1);
    expect(panelFps(30)!.disabled).toBe(true);
    expect(panelSend()!.disabled).toBe(true);
    await act(async () => { rejectCreate(new Error('network')); });
    await flush();
    expect(panelOpen()).toBe(true);
    expect(dataOf('i1').genStatus).toBe('failed');
    expect(panelFps(30)!.disabled).toBe(false);
    expect(panelSend()!.disabled).toBe(false);
    await act(async () => { (dataOf('i1').onRetryJob as (nodeId: string) => void)('i1'); });
    await flush();
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(2);
    expect(dataOf('i1').jobId).toBe('j2');
    expect(dataOf('i1').genStatus).toBe('generating');
  });

  it('慢网连点面板发送：保存与创建均在途时同卡只受理一次（同一渲染帧连点，React state 守卫失效由在途集合同步兜底）', async () => {
    seedDoc();
    let resolveSave: () => void = () => {};
    let resolveCreate: (value: { job_id: string; status: 'queued' }) => void = () => {};
    apiMocks.saveCanvasDoc.mockImplementation(() => new Promise((resolve) => {
      resolveSave = () => resolve({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' });
    }));
    apiMocks.createFrameInterpolation.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve; }),
    );
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 0, asset: null });
    await renderPage();
    await frameInterpolation();
    const draftId = draftNodes()[0]!.id;
    apiMocks.saveCanvasDoc.mockClear();

    await act(async () => {
      panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expect(apiMocks.createFrameInterpolation).not.toHaveBeenCalled();

    await act(async () => { resolveSave(); });
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(1);

    await act(async () => { resolveCreate({ job_id: 'j1', status: 'queued' }); });
    await flush();
    expect(dataOf(draftId).genStatus).toBe('generating');
    expect(dataOf(draftId).jobId).toBe('j1');
  });

  it('慢网连点失败重试：同一失败卡只创建一个任务（重试路径与面板发送共用同一在途门）', async () => {
    seedDoc('failed');
    let resolveCreate: (value: { job_id: string; status: 'queued' }) => void = () => {};
    apiMocks.createFrameInterpolation.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve; }),
    );
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j2', status: 'processing', progress: 0, asset: null });
    await renderPage();

    await act(async () => {
      (dataOf('i1').onRetryJob as (nodeId: string) => void)('i1');
      (dataOf('i1').onRetryJob as (nodeId: string) => void)('i1');
    });
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(1);

    await act(async () => { resolveCreate({ job_id: 'j2', status: 'queued' }); });
    await flush();
    expect(dataOf('i1').genStatus).toBe('generating');
    expect(dataOf('i1').jobId).toBe('j2');
  });

  it('重试创建失败：失败态保持（无受理假象）且解锁允许再试，第二次重试成功受理转生成中', async () => {
    seedDoc('failed');
    apiMocks.createFrameInterpolation
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ job_id: 'j2', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j2', status: 'processing', progress: 0, asset: null });
    await renderPage();

    await act(async () => {
      (dataOf('i1').onRetryJob as (nodeId: string) => void)('i1');
    });
    await flush();
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(1);
    expect(dataOf('i1').genStatus).toBe('failed');
    expect(dataOf('i1').jobId).toBe('j1');

    await act(async () => {
      (dataOf('i1').onRetryJob as (nodeId: string) => void)('i1');
    });
    await flush();
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(2);
    expect(dataOf('i1').genStatus).toBe('generating');
    expect(dataOf('i1').jobId).toBe('j2');
  });
});

describe('IKHSFH 提交会话隔离（切卡旧响应与并行）', () => {
  it('插帧发送在途经多选隐藏再由选中恢复：同卡仍只读，不丢按卡在途状态', async () => {
    seedDoc();
    apiMocks.createFrameInterpolation.mockImplementation(() => new Promise(() => {}));
    await renderPage();
    await frameInterpolation();
    const target = draftNodes()[0]!;
    await act(async () => { panelSend()!.click(); });
    await flush();
    expect(panelOpen()).toBe(false);
    await act(async () => { flowProps.current.onSelectionChange({ nodes: [mediaNode('v1'), mediaNode(target.id)] }); });
    await act(async () => { flowProps.current.onNodeClick(mediaNode(target.id)); });
    expect(panelOpen()).toBe(true);
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(1);
    expect(panelFps(120)!.disabled).toBe(true);
    expect(panelSend()!.disabled).toBe(true);
  });

  it('失败卡 A 重试在途后开 B：B 可编辑；A 受理及 finally 不关闭 B 或解 B 自己的提交锁', async () => {
    seedDoc('failed');
    let resolveA!: (value: { job_id: string; status: 'queued' }) => void;
    let resolveB!: (value: { job_id: string; status: 'queued' }) => void;
    apiMocks.createFrameInterpolation
      .mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }));
    apiMocks.fetchJobStatus.mockImplementation(async (jobId: string) => ({ job_id: jobId, status: 'processing', progress: 0, asset: null }));
    await renderPage();
    await clickCard('i1');
    await act(async () => { (dataOf('i1').onRetryJob as (nodeId: string) => void)('i1'); });
    await flush();
    expect(panelSend()!.disabled).toBe(true);
    await click(panelClose());
    await frameInterpolation();
    const cardB = draftNodes()[0]!.id;
    expect(panelFps(120)!.disabled).toBe(false);
    expect(panelSend()!.disabled).toBe(false);
    await click(panelFps(120));
    await act(async () => { panelSend()!.click(); });
    await flush();
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(2);
    expect(panelOpen()).toBe(false);
    expect(dataOf(cardB).genStatus).toBe('generating');
    await act(async () => { resolveA({ job_id: 'jA', status: 'queued' }); });
    await flush();
    expect(dataOf('i1').jobId).toBe('jA');
    expect(dataOf(cardB).genStatus).toBe('generating');
    await act(async () => { resolveB({ job_id: 'jB', status: 'queued' }); });
    await flush();
    expect(panelOpen()).toBe(false);
    expect(dataOf(cardB).jobId).toBe('jB');
    expect(dataOf('i1').jobId).toBe('jA');
  });

  it('A 提交未返回时关闭 A 打开 B：A 成功回调只转 A 卡生成中，不关闭 B 面板；B 随后各自提交成功不串卡', async () => {
    seedDoc();
    let resolveA: (value: { job_id: string; status: 'queued' }) => void = () => {};
    apiMocks.createFrameInterpolation
      .mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }))
      .mockResolvedValueOnce({ job_id: 'jB', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'jB', status: 'processing', progress: 0, asset: null });
    await renderPage();

    await frameInterpolation();
    const cardA = draftNodes()[0]!.id;
    await act(async () => {
      panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await frameInterpolation();
    const cardB = draftNodes().find((n) => n.id !== cardA)!.id;
    expect(panelOpen()).toBe(true);

    await act(async () => { resolveA({ job_id: 'jA', status: 'queued' }); });
    await flush();
    expect(dataOf(cardA).genStatus).toBe('generating');
    expect(dataOf(cardA).jobId).toBe('jA');
    expect(panelOpen()).toBe(true);
    expect(panelFps(120)!.disabled).toBe(false);
    expect(panelSend()!.disabled).toBe(false);

    await click(panelFps(120));
    await sendPanel();
    expect(apiMocks.createFrameInterpolation).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5',
      target_node_id: cardB,
      fps: 120,
    }, expect.objectContaining({ silent: true }));
    expect(dataOf(cardB).genStatus).toBe('generating');
    expect(dataOf(cardB).jobId).toBe('jB');
    expect(dataOf(cardA).jobId).toBe('jA');
  });

  it('A 在途时打开 B：B 面板可编辑可发送；A 旧失败不提示、不关闭或错误冻结 B', async () => {
    seedDoc();
    let rejectA: (reason?: unknown) => void = () => {};
    apiMocks.createFrameInterpolation
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectA = reject; }))
      .mockResolvedValueOnce({ job_id: 'jB', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'jB', status: 'processing', progress: 0, asset: null });
    await renderPage();

    await frameInterpolation();
    const cardA = draftNodes()[0]!.id;
    await act(async () => {
      panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await frameInterpolation();
    const cardB = draftNodes().find((n) => n.id !== cardA)!.id;

    expect(panelOpen()).toBe(true);
    expect(panelSend()!.disabled).toBe(false);
    expect(panelFps(120)!.disabled).toBe(false);

    await act(async () => { rejectA(new Error('network down')); });
    await flush();
    expect(dataOf(cardA).genStatus).toBe('draft');
    expect(dataOf(cardA).jobId).toBeUndefined();
    expect(panelOpen()).toBe(true);
    expect(panelSend()!.disabled).toBe(false);
    expect(panelFps(120)!.disabled).toBe(false);

    await click(panelFps(120));
    await sendPanel();
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(2);
    expect(dataOf(cardB).genStatus).toBe('generating');
    expect(panelOpen()).toBe(false);
  });

  it('提交在途期间重开本卡面板：显示提交中只读；旧成功保留新面板并转原卡生成中', async () => {
    seedDoc();
    let resolveCreate: (value: { job_id: string; status: 'queued' }) => void = () => {};
    apiMocks.createFrameInterpolation.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve; }),
    );
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 0, asset: null });
    await renderPage();
    await frameInterpolation();
    const draftId = draftNodes()[0]!.id;

    await act(async () => {
      panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await clickCard(draftId);
    expect(panelOpen()).toBe(true);
    expect(document.body.textContent).toContain('参数只读');
    expect(panelFps(120)!.disabled).toBe(true);
    expect(panelSend()!.disabled).toBe(true);

    await act(async () => { resolveCreate({ job_id: 'j1', status: 'queued' }); });
    await flush();
    expect(panelOpen()).toBe(true);
    expect(dataOf(draftId).genStatus).toBe('generating');
  });
});
