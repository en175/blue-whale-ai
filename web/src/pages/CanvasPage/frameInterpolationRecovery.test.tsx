// @vitest-environment jsdom
/* IKHSFF 插帧提交保存与关页恢复闭环（PR !820 合入前审查整改）：
   发送前保存失败/项目切换不发起创建请求（不吞失败当成功、面板保留可重发）；
   创建响应前关页、响应后自动保存前关页——重进画布以「实际提交产生的持久化数据」
   （发送前冲刷落盘的草稿卡 + 来源边 payload）水合，经服务端权威关联恢复契约
   （GET /video-frame-interpolations/current?target_node_id=，IKHSFE）恢复原卡与任务：
   处理中继续展示生成状态并恢复轮询；succeeded/failed 终态按现有口径收敛（不闪生成中）；
   cancelled 不复活；无关联保持草稿。渲染沿用 testing/canvasPageTestHarness。 */
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

/** 画布：一个就绪视频节点 v1（assetId '5'）——首轮进入后经入口建插帧草稿卡并真实发送，
 *  卸载前的最后一次保存请求 payload 即「服务端实际持久化的画布」，重进时原样水合。 */
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

/** 以「实际提交产生的持久化数据」重进水合：取卸载前最后一次保存请求的 nodes/edges
 *  （经 JSON 往返剥掉内存态回调函数，还原服务端持久化形态）。 */
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

/** 走视频节点工具条「高清 ▾」下拉第二项「插帧」建草稿卡 */
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

/** 点面板发送（含创建往返的微任务冲刷；创建挂起场景下仅完成发送前冲刷） */
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

    // 保存失败不被吞掉当成功：创建请求一次都不发
    expect(apiMocks.createFrameInterpolation).not.toHaveBeenCalled();
    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();
    // 面板保留、发送钮复位（可重发），卡留在可恢复的配置草稿态
    expect(panelOpen()).toBe(true);
    expect(panelSend()!.disabled).toBe(false);
    expect(dataOf(draftId).genStatus).toBe('draft');
    expect(dataOf(draftId).jobId).toBeUndefined();
    // 失败对用户可见（toast 文案），不静默
    expect(document.body.textContent).toContain('画布保存失败');
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

    // 保存链路恢复（默认桩成功）后原参数重发：创建受理、面板关闭、卡转生成中
    await sendPanel();
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(1);
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledWith('p1', {
      source_asset_id: '5',
      target_node_id: draftId,
      fps: 120,
    });
    expect(panelOpen()).toBe(false);
    expect(dataOf(draftId).genStatus).toBe('generating');
    expect(dataOf(draftId).jobId).toBe('j2');
  });

  it('等待保存期间项目切换：保存成功返回后也不发起创建请求，面板保留', async () => {
    seedDoc();
    // 保存请求挂起：构造「往返在途」窗口，等项目切换完成后再放行
    const saved = { id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' };
    let resolveSave!: (value: typeof saved) => void;
    apiMocks.saveCanvasDoc.mockImplementation(() => new Promise<typeof saved>((r) => { resolveSave = r; }));
    apiMocks.createFrameInterpolation.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    await renderPage();
    await frameInterpolation();
    const draftId = draftNodes()[0]!.id;
    await click(panelFps(60));
    // 点发送：发送前冲刷挂起（保存请求已发出未返回）
    await act(async () => {
      panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // 等待期间项目切换（地址栏 query → currentId/activeProjectRef 迁移到 p2）
    await act(async () => {
      navigateRef!('/canvas?project=p2');
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    // 保存随后成功返回：起始检查已过，收尾双检必须中止创建
    await act(async () => {
      resolveSave(saved);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(apiMocks.createFrameInterpolation).not.toHaveBeenCalled();
    expect(panelOpen()).toBe(true);
    expect(dataOf(draftId).genStatus).toBe('draft');
    expect(dataOf(draftId).jobId).toBeUndefined();
  });
});

describe('IKHSFF 关页后重进：服务端权威关联恢复', () => {
  /** 首轮进入并真实发送：建卡 → 冲刷落盘 → create 挂起（响应未达即关页）。
   *  返回草稿卡 id 与实际持久化的 payload（发送前那次保存请求的 nodes/edges）。 */
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
    await sendPanel(); // 发送前冲刷已落盘（草稿卡 + 来源边），create 挂起
    return { draftId, resolveCreate };
  }

  it('创建响应前关页：以实际持久化数据重进，恢复查询命中处理中任务——原卡转生成中并恢复轮询，不重复建卡不改源卡', async () => {
    seedDoc();
    const { draftId } = await sendAndCloseBeforeCreateResponse();
    await unmountPage(); // create 响应未达即关页
    const persisted = reseedFromPersisted();

    // 持久化形态核验：草稿卡与来源边已落盘，且未承接任务（无 jobId、非生成中）
    const persistedDraft = persisted.nodes.find((n) => n.id === draftId)!;
    expect((persistedDraft.data as Record<string, unknown>).jobId).toBeUndefined();
    expect((persistedDraft.data as Record<string, unknown>).genStatus).toBe('draft');
    expect(persisted.edges.find((e) => e.target === draftId)?.source).toBe('v1');

    // 重进：水合后按草稿卡节点 id 查服务端权威关联（IKHSFE 契约）
    apiMocks.fetchFrameInterpolationCurrent.mockResolvedValue({
      job_id: 'j1', status: 'processing', progress: 40, created_at: '2026-09-22T05:00:00.000Z',
    });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 40, asset: null });
    await renderPage();
    await flush();

    expect(apiMocks.fetchFrameInterpolationCurrent).toHaveBeenCalledWith('p1', draftId);
    // 原卡原地恢复生成状态 + jobId 回挂 + 轮询续接（冻结参数与来源边不动、不重复建卡）
    expect(dataOf(draftId).genStatus).toBe('generating');
    expect(dataOf(draftId).jobId).toBe('j1');
    expect(dataOf(draftId).progress).toBe(40);
    expect(identityOf(draftId)).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 } });
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j1');
    expect(mediaNodes().length).toBe(2);
    expect(edges().find((e) => e.target === draftId)?.source).toBe('v1');
    expect(dataOf('v1').src).toBe('http://vid/v1.mp4');
  });

  it('创建响应后、自动保存前关页：持久化仍是无 jobId 的草稿卡，重进经恢复契约续接任务', async () => {
    seedDoc();
    const { draftId, resolveCreate } = await sendAndCloseBeforeCreateResponse();
    // 创建响应到达：内存卡转生成中（jobId 登记）……
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 5, asset: null });
    await act(async () => { resolveCreate({ job_id: 'j1', status: 'queued' }); });
    await flush();
    expect(dataOf(draftId).genStatus).toBe('generating');
    // ……但 800ms 防抖自动保存未跑即关页：卸载清掉防抖定时器，无新增保存请求
    const saveCallsBeforeClose = apiMocks.saveCanvasDoc.mock.calls.length;
    await unmountPage();
    expect(apiMocks.saveCanvasDoc.mock.calls.length).toBe(saveCallsBeforeClose);
    const persisted = reseedFromPersisted();
    const persistedDraft = persisted.nodes.find((n) => n.id === draftId)!;
    expect((persistedDraft.data as Record<string, unknown>).jobId).toBeUndefined();
    expect((persistedDraft.data as Record<string, unknown>).genStatus).toBe('draft');

    // 重进：恢复查询命中仍在跑的任务，续接生成状态与轮询
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
    // 终态直接收敛：不经过「生成中」占位态（恢复查询已给终态，详情到达即回填）
    expect(data.genStatus).toBeUndefined();
    expect(data.src).toBe('http://tos/recovered.mp4');
    expect(data.assetId).toBe('a77');
    expect(data.width).toBe(1280);
    expect(data.height).toBe(720);
    expect(data.duration).toBe(11);
    expect(data.draft).toBeUndefined();
    expect(identityOf(draftId)).toBeUndefined();
    // jobId 保留在成品卡上（来源连线 target Handle 渲染依据，家族口径）
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
    expect(identityOf(draftId)).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 } });
    expect(mediaNodes().length).toBe(2);
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

    // 默认桩 data=null：草稿卡水合后查询无关联（如发送前保存失败即关页），保持草稿
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
