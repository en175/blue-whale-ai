// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apiMocks,
  canvasDocMock,
  enableReactActEnvironment,
  flowProps,
  mediaNodes,
  navigateRef,
  renderPage,
  unmountPage,
} from './testing/canvasPageTestHarness';

vi.mock('@/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));

vi.mock('@/api/canvasRecovery', async (importActual) => ({
  ...(await importActual<typeof import('@/api/canvasRecovery')>()),
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

function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'v1',
          type: 'mediaNode',
          position: { x: 400, y: 0 },
          data: {
            src: 'http://vid/v1.mp4',
            mediaType: 'video',
            fileName: '素材视频',
            assetId: '5',
            width: 1280,
            height: 720,
          },
        },
      ],
      edges: [],
    },
    assets: { 5: { asset_id: 5, type: 'video', access_url: 'http://vid/v1.mp4', width: 1280, height: 720 } },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

function reseedFromPersisted() {
  const call = apiMocks.saveCanvasDoc.mock.calls.at(-1) as unknown as [
    string,
    { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> },
  ];
  const persisted = JSON.parse(JSON.stringify(call[1])) as {
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  };
  canvasDocMock.current = {
    doc: { id: 11, version: 4, viewport: { x: 0, y: 0, zoom: 1 }, nodes: persisted.nodes, edges: persisted.edges },
    assets: { 5: { asset_id: 5, type: 'video', access_url: 'http://vid/v1.mp4', width: 1280, height: 720 } },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
  const acceptedInput = structuredClone(apiMocks.createFrameInterpolation.mock.calls.at(-1)![1]);
  apiMocks.fetchJobs.mockImplementation(async (params) => ({ records: [{
    job_id: String(params!.ids![0]), type: 'video_frame_interpolation', status: 'processing', progress: 0,
    input: acceptedInput, created_at: '2026-09-22T05:00:00.000Z', output_assets: [],
  }], total: 1, size: 1, current: 1 }));
  return persisted;
}

const mediaNode = (id: string) => mediaNodes().find((n) => n.id === id)!;
const dataOf = (id: string) => (mediaNode(id).data ?? {}) as Record<string, unknown>;
const draftNodes = () => mediaNodes().filter((n) => n.id !== 'v1');
const identityOf = (id: string) =>
  (dataOf(id).frameInterpolation ?? undefined) as Record<string, unknown> | undefined;
const edges = () =>
  flowProps.current.edges as Array<{ id: string; source: string; target: string; data?: Record<string, unknown> }>;
const panelSend = () => document.body.querySelector<HTMLButtonElement>('[data-testid="frame-interpolation-send-btn"]');
const panelFps = (value: number) =>
  document.body.querySelector<HTMLButtonElement>(`[data-testid="frame-interpolation-fps-${value}"]`);
const panelOpen = () => document.body.querySelector('[data-testid="frame-interpolation-dialog"]') !== null;

async function frameInterpolation(id = 'v1') {
  await act(async () => {
    ((mediaNode(id).data as Record<string, unknown>).onFrameInterpolation as (nodeId: string) => void)(id);
  });
}

async function click(node: Element | null) {
  await act(async () => {
    node!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
const clickCard = (id: string) => act(async () => { flowProps.current.onNodeClick(mediaNode(id)); });

async function sendPanel() {
  await act(async () => {
    panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
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

describe('IKHSFF 发送前保存失败拦截', () => {
  it('保存抛错：不发起插帧创建请求、面板与配置保留可重发、卡保持草稿（不吞失败当成功）', async () => {
    seedDoc();
    apiMocks.saveCanvasDoc.mockRejectedValueOnce(new Error('save down'));
    apiMocks.createFrameInterpolation.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    await renderPage();
    await frameInterpolation();
    const draftId = draftNodes()[0]!.id;
    await click(panelFps(120));
    await sendPanel();

    expect(apiMocks.createFrameInterpolation).not.toHaveBeenCalled();
    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();
    expect(panelOpen()).toBe(false);
    expect(dataOf(draftId).genStatus).toBe('draft');
    expect(dataOf(draftId).jobId).toBeUndefined();
    expect(document.body.textContent).toContain('画布保存失败');
    await clickCard(draftId);
    expect(panelOpen()).toBe(true);
    expect(panelSend()!.disabled).toBe(false);
  });

  it('保存失败后重试：保存恢复成功即按原配置发出创建请求并转生成中（闭环可恢复）', async () => {
    seedDoc();
    apiMocks.saveCanvasDoc.mockRejectedValueOnce(new Error('save down'));
    apiMocks.createFrameInterpolation.mockResolvedValue({ job_id: 'j2', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j2', status: 'processing', progress: 15, asset: null });
    await renderPage();
    await frameInterpolation();
    const draftId = draftNodes()[0]!.id;
    await click(panelFps(120));
    await sendPanel();
    expect(apiMocks.createFrameInterpolation).not.toHaveBeenCalled();

    await clickCard(draftId);
    await sendPanel();
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(1);
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledWith('p1', {
      source_asset_id: '5',
      target_node_id: draftId,
      fps: 120,
    }, expect.objectContaining({ silent: true }));
    expect(panelOpen()).toBe(false);
    expect(dataOf(draftId).genStatus).toBe('generating');
    expect(dataOf(draftId).jobId).toBe('j2');
  });

  it('等待保存期间项目切换：旧面板退出，保存成功返回后仍不发起创建请求', async () => {
    seedDoc();
    const saved = { id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' };
    let resolveSave!: (value: typeof saved) => void;
    apiMocks.saveCanvasDoc.mockImplementation(() => new Promise<typeof saved>((r) => { resolveSave = r; }));
    apiMocks.createFrameInterpolation.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    await renderPage();
    await frameInterpolation();
    const draftId = draftNodes()[0]!.id;
    await click(panelFps(60));
    await act(async () => {
      panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      navigateRef!('/canvas?project=p2');
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await act(async () => {
      resolveSave(saved);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(apiMocks.createFrameInterpolation).not.toHaveBeenCalled();
    expect(panelOpen()).toBe(false);
    expect(dataOf(draftId).jobId).toBeUndefined();
  });
});

describe('IKHSFF 关页后重进：服务端权威关联恢复', () => {
  it('失败任务重发后响应前关页：持久化仍带旧 jobId，重进恢复新任务', async () => {
    seedDoc();
    apiMocks.createFrameInterpolation.mockResolvedValueOnce({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'failed', progress: 0, asset: null, error: { code: 1049 } });
    await renderPage();
    await frameInterpolation();
    const draftId = draftNodes()[0]!.id;
    await sendPanel();
    await flush();
    expect(dataOf(draftId).genStatus).toBe('failed');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });

    apiMocks.createFrameInterpolation.mockImplementation(() => new Promise(() => {}));
    await act(async () => { (dataOf(draftId).onRetryJob as (id: string) => void)(draftId); });
    await flush();
    await unmountPage();
    const persisted = reseedFromPersisted();
    expect((persisted.nodes.find((n) => n.id === draftId)!.data as Record<string, unknown>).jobId).toBe('j1');

    apiMocks.fetchFrameInterpolationCurrent.mockResolvedValue({ job_id: 'j2', status: 'processing', progress: 35, created_at: '2026-09-22T05:00:00.000Z' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j2', status: 'processing', progress: 35, asset: null });
    await renderPage();
    await flush();
    expect(dataOf(draftId).jobId).toBe('j2');
    expect(dataOf(draftId).genStatus).toBe('generating');
    expect(mediaNodes()).toHaveLength(2);
  });

  async function sendAndCloseBeforeCreateResponse(): Promise<{
    draftId: string;
    resolveCreate: (value: { job_id: string; status: string }) => void;
  }> {
    let resolveCreate!: (value: { job_id: string; status: string }) => void;
    apiMocks.createFrameInterpolation.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve; }),
    );
    await renderPage();
    await frameInterpolation();
    const draftId = draftNodes()[0]!.id;
    await click(panelFps(120));
    await sendPanel();
    return { draftId, resolveCreate };
  }

  it('创建响应前关页：以实际持久化数据重进，恢复查询命中处理中任务——原卡转生成中并恢复轮询，不重复建卡不改源卡', async () => {
    seedDoc();
    const { draftId } = await sendAndCloseBeforeCreateResponse();
    await unmountPage();
    const persisted = reseedFromPersisted();

    const persistedDraft = persisted.nodes.find((n) => n.id === draftId)!;
    expect((persistedDraft.data as Record<string, unknown>).jobId).toBeUndefined();
    expect((persistedDraft.data as Record<string, unknown>).genStatus).toBe('draft');
    expect(persisted.edges.find((e) => e.target === draftId)?.source).toBe('v1');

    apiMocks.fetchFrameInterpolationCurrent.mockResolvedValue({
      job_id: 'j1', status: 'processing', progress: 40, created_at: '2026-09-22T05:00:00.000Z',
    });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 40, asset: null });
    await renderPage();
    await flush();

    expect(apiMocks.fetchFrameInterpolationCurrent).toHaveBeenCalledWith('p1', draftId);
    expect(dataOf(draftId).genStatus).toBe('generating');
    expect(dataOf(draftId).jobId).toBe('j1');
    expect(dataOf(draftId).progress).toBe(40);
    expect(identityOf(draftId)).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 }, frozenParams: { fps: 120 } });
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j1');
    expect(mediaNodes().length).toBe(2);
    expect(edges().find((e) => e.target === draftId)?.source).toBe('v1');
    expect(dataOf('v1').src).toBe('http://vid/v1.mp4');
  });

  it('创建响应后、自动保存前关页：持久化仍是无 jobId 的草稿卡，重进经恢复契约续接任务', async () => {
    seedDoc();
    const { draftId, resolveCreate } = await sendAndCloseBeforeCreateResponse();
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 5, asset: null });
    await act(async () => { resolveCreate({ job_id: 'j1', status: 'queued' }); });
    await flush();
    expect(dataOf(draftId).genStatus).toBe('generating');
    const saveCallsBeforeClose = apiMocks.saveCanvasDoc.mock.calls.length;
    await unmountPage();
    expect(apiMocks.saveCanvasDoc.mock.calls.length).toBe(saveCallsBeforeClose);
    const persisted = reseedFromPersisted();
    const persistedDraft = persisted.nodes.find((n) => n.id === draftId)!;
    expect((persistedDraft.data as Record<string, unknown>).jobId).toBeUndefined();
    expect((persistedDraft.data as Record<string, unknown>).genStatus).toBe('draft');

    apiMocks.fetchFrameInterpolationCurrent.mockResolvedValue({
      job_id: 'j1', status: 'queued', progress: 0, created_at: '2026-09-22T05:00:00.000Z',
    });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 10, asset: null });
    await renderPage();
    await flush();

    expect(apiMocks.fetchFrameInterpolationCurrent).toHaveBeenCalledWith('p1', draftId);
    expect(dataOf(draftId).genStatus).toBe('generating');
    expect(dataOf(draftId).jobId).toBe('j1');
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j1');
    expect(mediaNodes().length).toBe(2);
  });

  it('关页期间任务已成功：重进按现有终态口径回填成品（不闪生成中、清插帧身份、保留 jobId、不改源卡）', async () => {
    seedDoc();
    const { draftId } = await sendAndCloseBeforeCreateResponse();
    await unmountPage();
    reseedFromPersisted();

    apiMocks.fetchFrameInterpolationCurrent.mockResolvedValue({
      job_id: 'j1', status: 'succeeded', progress: 100, created_at: '2026-09-22T05:00:00.000Z',
    });
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j1', status: 'succeeded', progress: 100,
      asset: { id: 'a77', url: 'http://tos/recovered.mp4', type: 'video', width: 1280, height: 720, duration: 11 },
    });
    await renderPage();
    await flush();

    const data = dataOf(draftId);
    expect(data.genStatus).toBeUndefined();
    expect(data.src).toBe('http://tos/recovered.mp4');
    expect(data.assetId).toBe('a77');
    expect(data.width).toBe(1280);
    expect(data.height).toBe(720);
    expect(data.duration).toBe(11);
    expect(data.draft).toBeUndefined();
    expect(identityOf(draftId)).toBeUndefined();
    expect(data.jobId).toBe('j1');
    expect(mediaNodes().length).toBe(2);
    expect(dataOf('v1').src).toBe('http://vid/v1.mp4');
    expect(edges().find((e) => e.target === draftId)?.source).toBe('v1');
  });

  it('关页期间任务已失败：重进走插帧失败文案家族映射，身份保留可重试', async () => {
    seedDoc();
    const { draftId } = await sendAndCloseBeforeCreateResponse();
    await unmountPage();
    reseedFromPersisted();

    apiMocks.fetchFrameInterpolationCurrent.mockResolvedValue({
      job_id: 'j1', status: 'failed', progress: 0, created_at: '2026-09-22T05:00:00.000Z',
    });
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j1', status: 'failed', progress: 0, error: { code: 1049, msg: '' },
    });
    await renderPage();
    await flush();

    expect(dataOf(draftId).genStatus).toBe('failed');
    expect(dataOf(draftId).errorText).toBe('视频插帧失败，请重试');
    expect(identityOf(draftId)).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 }, frozenParams: { fps: 120 } });
    expect(mediaNodes().length).toBe(2);
  });

  it('关页恢复失败任务后编辑为60fps：失败重试仍提交受理时的120fps', async () => {
    seedDoc();
    const { draftId } = await sendAndCloseBeforeCreateResponse();
    await unmountPage();
    reseedFromPersisted();
    apiMocks.fetchFrameInterpolationCurrent.mockResolvedValue({ job_id: 'j1', status: 'failed', progress: 0, created_at: '2026-09-22T05:00:00.000Z' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'failed', progress: 0, asset: null, error: { code: 1049 } });
    await renderPage();
    await flush();
    await act(async () => { flowProps.current.onNodeClick(mediaNode(draftId)); });
    await click(panelFps(60));
    apiMocks.createFrameInterpolation.mockResolvedValue({ job_id: 'j2', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j2', status: 'processing', progress: 1, asset: null });
    await act(async () => { (dataOf(draftId).onRetryJob as (id: string) => void)(draftId); });
    await flush();
    expect(apiMocks.createFrameInterpolation).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', target_node_id: draftId, fps: 120,
    }, expect.objectContaining({ silent: true }));
    expect(identityOf(draftId)?.lastParams).toEqual({ fps: 60 });
  });

  it('冻结输入读取失败：不按面板值重试，不创建新任务', async () => {
    seedDoc();
    const { draftId } = await sendAndCloseBeforeCreateResponse();
    await unmountPage();
    reseedFromPersisted();
    apiMocks.fetchFrameInterpolationCurrent.mockResolvedValue({ job_id: 'j1', status: 'failed', progress: 0, created_at: '2026-09-22T05:00:00.000Z' });
    apiMocks.fetchJobs.mockRejectedValue(new Error('network down'));
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'failed', progress: 0, asset: null, error: { code: 1049 } });
    apiMocks.createFrameInterpolation.mockClear();
    await renderPage();
    await flush();
    await act(async () => { flowProps.current.onNodeClick(mediaNode(draftId)); });
    await click(panelFps(60));
    await act(async () => { (dataOf(draftId).onRetryJob as (id: string) => void)(draftId); });
    await flush();
    expect(apiMocks.createFrameInterpolation).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('原任务输入已不可信');
    expect(identityOf(draftId)?.frozenParams).toBeUndefined();
  });

  it('恢复查询迟到：不能覆盖同卡新受理任务及冻结参数', async () => {
    seedDoc();
    const { draftId } = await sendAndCloseBeforeCreateResponse();
    await unmountPage();
    reseedFromPersisted();
    let resolveCurrent!: (value: { job_id: string; status: 'failed'; progress: number; created_at: string }) => void;
    apiMocks.fetchFrameInterpolationCurrent.mockImplementation(() => new Promise((resolve) => { resolveCurrent = resolve; }));
    await renderPage();
    await act(async () => { flowProps.current.onNodeClick(mediaNode(draftId)); });
    await click(panelFps(30));
    apiMocks.createFrameInterpolation.mockResolvedValue({ job_id: 'j2', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j2', status: 'processing', progress: 15, asset: null });
    await sendPanel();
    await act(async () => { resolveCurrent({ job_id: 'j1', status: 'failed', progress: 0, created_at: '2026-09-22T05:00:00.000Z' }); });
    await flush();
    expect(dataOf(draftId).jobId).toBe('j2');
    expect(dataOf(draftId).genStatus).toBe('generating');
    expect(identityOf(draftId)?.frozenParams).toEqual({ fps: 30 });
  });

  it('重复水合恢复到取消的新任务：旧任务迟到成功不得回填草稿', async () => {
    seedDoc();
    apiMocks.createFrameInterpolation.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    let resolveOldPoll!: (value: Record<string, unknown>) => void;
    apiMocks.fetchJobStatus.mockImplementation(() => new Promise((resolve) => { resolveOldPoll = resolve; }));
    await renderPage();
    await frameInterpolation();
    const draftId = draftNodes()[0]!.id;
    await sendPanel();
    expect(dataOf(draftId).genStatus).toBe('generating');

    canvasDocMock.current.doc = {
      id: 11, version: 5, viewport: { x: 0, y: 0, zoom: 1 },
      nodes: JSON.parse(JSON.stringify(mediaNodes())), edges: JSON.parse(JSON.stringify(edges())),
    };
    apiMocks.fetchFrameInterpolationCurrent.mockResolvedValue({ job_id: 'j2', status: 'cancelled', progress: 0, created_at: '2026-09-22T05:00:00.000Z' });
    await act(async () => { flowProps.current.onNodeClick(mediaNode(draftId)); });
    await flush();
    expect(dataOf(draftId).genStatus).toBe('draft');
    await act(async () => { resolveOldPoll({ job_id: 'j1', status: 'succeeded', progress: 100, asset: { id: '77', type: 'video', url: 'https://old/result.mp4' } }); });
    await flush();
    expect(dataOf(draftId).genStatus).toBe('draft');
    expect(dataOf(draftId).src).not.toBe('https://old/result.mp4');
    expect(identityOf(draftId)).toBeDefined();
  });

  it('关页期间任务已取消：不复活——保持草稿态、不写 jobId、不启动轮询', async () => {
    seedDoc();
    const { draftId } = await sendAndCloseBeforeCreateResponse();
    await unmountPage();
    reseedFromPersisted();

    apiMocks.fetchFrameInterpolationCurrent.mockResolvedValue({
      job_id: 'j1', status: 'cancelled', progress: 0, created_at: '2026-09-22T05:00:00.000Z',
    });
    await renderPage();
    await flush();

    expect(apiMocks.fetchFrameInterpolationCurrent).toHaveBeenCalledWith('p1', draftId);
    expect(dataOf(draftId).genStatus).toBe('draft');
    expect(dataOf(draftId).jobId).toBeUndefined();
    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();
    expect(mediaNodes().length).toBe(2);
  });

  it('无服务端关联（从未受理成功）：保持草稿态可正常配置，不误转生成中', async () => {
    seedDoc();
    const { draftId } = await sendAndCloseBeforeCreateResponse();
    await unmountPage();
    reseedFromPersisted();

    await renderPage();
    await flush();

    expect(apiMocks.fetchFrameInterpolationCurrent).toHaveBeenCalledWith('p1', draftId);
    expect(dataOf(draftId).genStatus).toBe('draft');
    expect(dataOf(draftId).jobId).toBeUndefined();
    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();
    expect(mediaNodes().length).toBe(2);
    expect(identityOf(draftId)).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 } });
  });
});
