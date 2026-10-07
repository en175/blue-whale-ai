// @vitest-environment jsdom
/* IKHLKX 视频插帧发送闭环与成品回填（画布链路）：发送 POST video-frame-interpolations 携带冻结
   三键（source_asset_id / target_node_id / fps 整型）、提交期间面板保留参数只读发送置灰、
   创建成功才关面板并原地转生成中（创建失败保留配置可重发）、succeeded 回填本草稿卡并清除插帧
   身份（选中进入普通视频面板、成品可再次插帧）、failed 走 1049 / enqueue_failed 家族文案、
   失败重试按身份冻结的源素材与 fps 原样重发（不经通用 retry、每次全新创建请求）、生成中取消与
   取消后迟到轮询不回填、同源不同帧率并发各卡各 job 完成顺序颠倒不串卡、持久化水合恢复轮询。
   IKHSFH 整改追加：编辑参数与受理冻结输入分离（frozenParams）、保存→创建返回窗口的同步防重
   （慢网连点只建一个任务）、失败解锁再试、A 在途回调不关闭/不重置/不冻结 B 面板（提交会话隔离）。
   渲染沿用 testing/canvasPageTestHarness（页面级共享夹具）；轮询终态模式对齐 videoEnhanceSend
   .test.tsx（IKH3VH 先例）。 */
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

/** 画布：一个就绪视频节点 v1（默认 assetId '5'，1280×720 达标）+ 可选既有插帧卡 i1。
 *  mode：'draft' 仅源卡；'generating' 带生成中的插帧卡（持久化恢复链路）；'failed' 带失败插帧卡
 *  且源卡已被改配新素材（assetId '7'——验证重试不读后来修改的配置）。 */
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
        // 失败链路：源卡此时已关联新素材，重试仍须用插帧身份里冻结的 '5'
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
/** 本链路建的插帧卡（v1 是源卡、i1 是 seed 既有插帧卡） */
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

/** 走视频节点工具条「高清 ▾」下拉第二项「插帧」（回调挂在节点 data 上） */
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

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

/** 点面板发送（含创建往返与轮询首 tick 的微任务冲刷） */
async function sendPanel() {
  await act(async () => {
    panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

/** 按 jobId 分派的 fetchJobStatus 打桩：每个 job 一个手动 resolver（构造乱序响应） */
function deferredJobStatus() {
  const resolvers = new Map<string, (detail: Record<string, unknown>) => void>();
  apiMocks.fetchJobStatus.mockImplementation(
    (jobId: string) => new Promise((resolve) => { resolvers.set(String(jobId), resolve); }),
  );
  return resolvers;
}

/** 按调用次序登记 resolver 的 fetchJobStatus 打桩（同一 job 的轮询响应与取消权威核对分列） */
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

    // 创建请求携带冻结三键（source_asset_id 冻结自插帧身份、target_node_id=插帧卡节点 id、fps 面板所选档整型）
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(1);
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledWith('p1', {
      source_asset_id: '5',
      target_node_id: draftId,
      fps: 120,
    }, expect.objectContaining({ silent: true }));
    // 创建成功才关面板（发送钮不在文档）
    expect(panelOpen()).toBe(false);
    expect(panelSend()).toBeNull();
    // 原地转生成中：frozenParams 随受理写卡（= 最后受理任务的冻结输入，失败重试权威来源；
    // lastParams 保持面板编辑值）、jobId 登记并启动轮询（首 tick 已取回进度）
    const data = dataOf(draftId);
    expect(data.genStatus).toBe('generating');
    expect(data.jobId).toBe('j1');
    expect(data.progress).toBe(20);
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 }, frozenParams: { fps: 120 } });
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j1');
    // 卡数量不变（不新建额外结果卡）、来源边保持、源卡不动
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

    // 发送前已发生落盘：请求体含新建的插帧草稿卡与带 origin 的来源边（受理即已持久化）
    // （harness 的 saveCanvasDoc 桩未声明形参，取参处显式断言成 (projectId, payload, version) 形态）
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalled();
    const saved = (apiMocks.saveCanvasDoc.mock.calls as unknown as Array<[string, {
      nodes: Array<{ id: string }>;
      edges: Array<{ id: string; source: string; target: string }>;
    }]>).at(-1)![1];
    expect(saved.nodes.map((n) => n.id)).toContain(draftId);
    expect(saved.edges.find((e) => e.target === draftId)?.source).toBe('v1');
    // 顺序即口径：保存请求先于创建请求
    expect(apiMocks.saveCanvasDoc.mock.invocationCallOrder.at(-1)!)
      .toBeLessThan(apiMocks.createFrameInterpolation.mock.invocationCallOrder[0]!);

    // 失败重试走同一发送核心（startFrameInterpolationJob），故重试亦先冲刷；
    // 画布无变化时冲刷按既有「签名未变不发 PUT」口径幂等跳过，不产生多余保存请求
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

    // IKJJR3：提交点即交接运行时——面板关闭（保存+受理窗口由 submitting 统一防重，
    // 用户故事 5）、卡原地转生成中
    expect(panelOpen()).toBe(false);
    expect(dataOf(draftNodes()[0]!.id).genStatus).toBe('generating');
    // 在途重开面板：生成中只读（发送置灰），不产生第二次创建请求
    await act(async () => { flowProps.current.onNodeClick(mediaNode(draftNodes()[0]!.id)); });
    expect(panelOpen()).toBe(true);
    expect(panelSend()!.disabled).toBe(true);
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(1);

    // 创建返回成功：jobId 登记续轮询
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

    // IKJJR3：提交点即交接（面板关）；受理失败草稿回配置态（120fps 保留在 lastParams）、
    // 无 jobId、未启动轮询（不制造受理假象）
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(1);
    expect(panelOpen()).toBe(false);
    expect(dataOf(draftId).genStatus).toBe('draft');
    expect(dataOf(draftId).jobId).toBeUndefined();
    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();

    // 点卡重开面板：原配置（120fps）保留、发送钮复位可重发
    await act(async () => { flowProps.current.onNodeClick(mediaNode(draftId)); });
    expect(panelOpen()).toBe(true);
    expect(panelSend()!.disabled).toBe(false);
    expect(panelFps(120)!.className).toMatch(/Active/);
    // 原配置直接重发：受理成功转生成中，payload 仍是保留的 120fps
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
    // 草稿身份结束 + 插帧身份清除（选中进入普通视频面板，成品卡不再带插帧身份）
    expect(data.draft).toBeUndefined();
    expect(identityOf(mediaNode(draftId))).toBeUndefined();
    // 源卡不动、不新增额外结果卡
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

    // 数值码 1049 同款兜底（执行面统一归并：门槛拒绝/转存失败同一句）
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
    // 失败态保留插帧身份（可重试）与来源边
    expect(identityOf(mediaNode('i1'))).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 }, frozenParams: { fps: 120 } });
    expect(edges().find((e) => e.target === 'i1')?.source).toBe('v1');
  });

  it('failed：入队失败（数值码 1028 + 后端半句 msg）仍显示逐字「任务入队失败，请重试」', async () => {
    seedDoc('generating');
    // 真实链路形态：后端落 enqueue_failed（数值 1028）且 msg 是码表半句「任务入队失败」
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
      // 第一次重试再失败（继续保留失败态与身份）
      .mockResolvedValueOnce({ job_id: 'j2', status: 'failed', progress: 1, error: { code: 1049, msg: '' } })
      // 第二次重试成功收敛成品
      .mockResolvedValueOnce({
        job_id: 'j3', status: 'succeeded', progress: 100,
        asset: { id: 'a91', url: 'http://tos/fi2.mp4', type: 'video', width: 1280, height: 720, duration: 9 },
      });
    await renderPage();

    await act(async () => {
      (dataOf('i1').onRetryJob as (nodeId: string) => void)('i1');
    });
    await flush();

    // 源素材取冻结值 '5'（源卡当前已改配 '7'）；fps 取 lastParams 冻结值 30（非面板默认档 60）
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(1);
    expect(apiMocks.createFrameInterpolation).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5',
      target_node_id: 'i1',
      fps: 30,
    }, expect.objectContaining({ silent: true }));
    // 契约无 retry 端点：重试不走通用 retry 接口
    expect(apiMocks.retryGenerationJob).not.toHaveBeenCalled();
    // 第一次重试失败：仍可再次重试
    expect(dataOf('i1').genStatus).toBe('failed');
    expect(dataOf('i1').errorText).toBe('视频插帧失败，请重试');

    await act(async () => {
      (dataOf('i1').onRetryJob as (nodeId: string) => void)('i1');
    });
    await flush();

    // 每次重试都是全新创建请求（免费口径：无幂等头 / 无 client_token，不复用旧 token 重放旧任务）
    expect(apiMocks.createFrameInterpolation).toHaveBeenCalledTimes(2);
    expect(apiMocks.createFrameInterpolation).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5',
      target_node_id: 'i1',
      fps: 30,
    }, expect.objectContaining({ silent: true }));
    // 收敛成品并清插帧身份
    expect(dataOf('i1').genStatus).toBeUndefined();
    expect(dataOf('i1').src).toBe('http://tos/fi2.mp4');
    expect(dataOf('i1').assetId).toBe('a91');
    expect(identityOf(mediaNode('i1'))).toBeUndefined();
    // 源卡保持不动
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
    expect(resolvers.length).toBe(1); // 轮询首 tick 在途（保持 pending 构造迟到成功响应）

    await act(async () => {
      (dataOf(draftId).onCancelJob as (nodeId: string) => void)(draftId);
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledWith('p1', 'j1');
    expect(resolvers.length).toBe(2); // resolvers[1] = 取消流程的权威核对
    await act(async () => {
      resolvers[1]!({ job_id: 'j1', status: 'cancelled', progress: 0, asset: null });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // 权威 cancelled：卡回待生成（保留卡、来源边与插帧身份，可重开面板原参数重发），不被移除
    expect(mediaNodes().length).toBe(2);
    expect(dataOf(draftId).genStatus).toBe('draft');
    expect(dataOf(draftId).jobId).toBe('j1');
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 }, frozenParams: { fps: 120 } });
    expect(edges().find((e) => e.target === draftId)?.source).toBe('v1');

    // 取消确认后才回来的那次迟到轮询（载荷 succeeded）：不得回填成品
    await act(async () => {
      resolvers[0]!({
        job_id: 'j1', status: 'succeeded', progress: 100,
        asset: { id: 'a99', url: 'http://tos/late.mp4', type: 'video', width: 1280, height: 720, duration: 5 },
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
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

    // 同一源视频连续发起两个不同帧率任务（每次点击独立建卡）
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
    expect(mediaNodes().length).toBe(3); // 源卡 + 两张插帧卡

    // 完成顺序颠倒：B（后发）先失败、A（先发）后成功，各自只回自己卡
    await act(async () => {
      resolvers.get('jB')!({ job_id: 'jB', status: 'failed', progress: 1, error: { code: 1049, msg: '' } });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await act(async () => {
      resolvers.get('jA')!({
        job_id: 'jA', status: 'succeeded', progress: 100,
        asset: { id: 'aA', url: 'http://tos/a30.mp4', type: 'video', width: 1280, height: 720, duration: 7 },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(dataOf(cardB).genStatus).toBe('failed');
    expect(dataOf(cardB).errorText).toBe('视频插帧失败，请重试');
    expect(identityOf(mediaNode(cardB))).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 }, frozenParams: { fps: 120 } });
    expect(dataOf(cardA).src).toBe('http://tos/a30.mp4');
    expect(dataOf(cardA).assetId).toBe('aA');
    expect(dataOf(cardA).duration).toBe(7);
    expect(identityOf(mediaNode(cardA))).toBeUndefined();
    // 源卡不动、两卡各自连回源卡
    expect(dataOf('v1').src).toBe('http://vid/v1.mp4');
    expect(edges().find((e) => e.target === cardA)?.source).toBe('v1');
    expect(edges().find((e) => e.target === cardB)?.source).toBe('v1');

    // 失败卡（B，120fps）重试：沿用自己冻结的 fps 与源素材，不受另一张卡（30fps）影响
    await act(async () => {
      (dataOf(cardB).onRetryJob as (nodeId: string) => void)(cardB);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(apiMocks.createFrameInterpolation).toHaveBeenNthCalledWith(3, 'p1', {
      source_asset_id: '5', target_node_id: cardB, fps: 120,
    }, expect.objectContaining({ silent: true }));
    await act(async () => {
      resolvers.get('jC')!({
        job_id: 'jC', status: 'succeeded', progress: 100,
        asset: { id: 'aB', url: 'http://tos/b120.mp4', type: 'video', width: 1280, height: 720, duration: 7 },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(dataOf(cardB).src).toBe('http://tos/b120.mp4');
    expect(dataOf(cardA).src).toBe('http://tos/a30.mp4'); // 已完成卡不被重试结果覆盖
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

    // 水合即恢复轮询：以持久化 jobId 查询任务
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
    // 不重复建卡（仍是源卡 + 原插帧卡两张）、来源边保持
    expect(mediaNodes().length).toBe(2);
    expect(edges().find((e) => e.target === 'i1')?.source).toBe('v1');

    // 点选成品卡：进入普通视频面板（不再弹插帧面板）
    await clickCard('i1');
    expect(panelOpen()).toBe(false);
    expect(videoDockOpen()).toBe(true);

    // 成品卡可再次插帧：以成品自身 assetId 为源独立建卡（新卡 + 新来源边，成品卡不动）
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

    // 4K 成品卡再点 HD：源输入超上限，不建卡不弹 HD 面板
    await videoEnhance('i1');
    expect(mediaNodes().length).toBe(2);
    expect(document.body.querySelector('[data-testid="video-enhance-send-btn"]')).toBeNull();

    // 同一张 4K 成品卡仍可再次插帧（插帧无分辨率前置）
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
      // 首任务（60fps）轮询失败
      .mockResolvedValueOnce({ job_id: 'j1', status: 'failed', progress: 1, error: { code: 1049, msg: '' } })
      // 重试受理后保持 processing
      .mockResolvedValueOnce({ job_id: 'j2', status: 'processing', progress: 5, asset: null });
    await renderPage();
    await frameInterpolation();
    const draftId = draftNodes()[0]!.id;

    // 默认档 60fps 直接发送 → 受理（frozenParams 冻结 60）→ 轮询至失败
    await sendPanel();
    await flush();
    expect(apiMocks.createFrameInterpolation).toHaveBeenNthCalledWith(1, 'p1', {
      source_asset_id: '5',
      target_node_id: draftId,
      fps: 60,
    }, expect.objectContaining({ silent: true }));
    expect(dataOf(draftId).genStatus).toBe('failed');
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { fps: 60 }, frozenParams: { fps: 60 } });

    // 失败后重开面板改 120：lastParams 跟随面板编辑（档位恢复与卡名同源），冻结输入不动
    await clickCard(draftId);
    expect(panelOpen()).toBe(true);
    await click(panelFps(120));
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { fps: 120 }, frozenParams: { fps: 60 } });

    // 点失败卡重试：按受理冻结的 60fps 原样重发（不读面板当前编辑值 120）
    await act(async () => {
      (dataOf(draftId).onRetryJob as (nodeId: string) => void)(draftId);
    });
    await flush();
    expect(apiMocks.createFrameInterpolation).toHaveBeenNthCalledWith(2, 'p1', {
      source_asset_id: '5',
      target_node_id: draftId,
      fps: 60,
    }, expect.objectContaining({ silent: true }));

    // 重试受理成功：frozenParams 保持 60（原样重发未改输入），lastParams 保持面板编辑值 120（不随受理回写）
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

    // 60fps 受理 → 轮询失败
    await sendPanel();
    await flush();
    expect(dataOf(draftId).genStatus).toBe('failed');

    // 重开面板改 120 后用面板发送（非失败卡重试）：新配置可发 120，成功受理后冻结输入更新
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
    // 旧卡 identity 无 frozenParams：回落 lastParams.fps=30 原样重发（既有用例口径回归）
    expect(apiMocks.createFrameInterpolation).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5',
      target_node_id: 'i1',
      fps: 30,
    }, expect.objectContaining({ silent: true }));
    // 受理后写入 frozenParams（后续重试有权威冻结来源）
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
    // IKJJR3/IKDMQV：重试走运行时且不前置保存（不读画布不落盘）——即发创建请求；
    // 已经打开的面板随卡转生成中同步派生只读（submitting 在途窗口）。
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

    // 同一同步段连点两次发送（不间隔渲染，模拟慢网快速连击）
    await act(async () => {
      panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // 保存仍在途：只有一次保存排队、创建请求尚未发出（第二次点击未产生第二个保存）
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expect(apiMocks.createFrameInterpolation).not.toHaveBeenCalled();

    // 保存返回 → 唯一一个创建请求发出
    await act(async () => { resolveSave(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
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

    // 同一同步段连点两次失败卡重试
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
    // 失败保持失败态：未转生成中、jobId 未被覆盖（不制造受理假象）
    expect(dataOf('i1').genStatus).toBe('failed');
    expect(dataOf('i1').jobId).toBe('j1');
    // IKJJR3：重试失败由运行时收敛到卡上（可读失败态），不再弹会话层 toast

    // 解锁后允许再试：第二次重试成功受理
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
    // IKJJR3：提交点即交接（面板关、卡转生成中）；多选/单选切换后点卡重开面板只读
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
    // IKJJR3：B 提交点即交接（面板关、卡转生成中）；A 受理只回写 A 卡，不串 B
    expect(panelOpen()).toBe(false);
    expect(dataOf(cardB).genStatus).toBe('generating');
    await act(async () => { resolveA({ job_id: 'jA', status: 'queued' }); });
    await flush();
    expect(dataOf('i1').jobId).toBe('jA');
    expect(dataOf(cardB).genStatus).toBe('generating'); // A 受理不干扰 B 在途
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
    // A 在途（提交点即交接，面板已关）：从源卡再建 B 并打开其面板
    await frameInterpolation();
    const cardB = draftNodes().find((n) => n.id !== cardA)!.id;
    expect(panelOpen()).toBe(true);

    // A 的成功回调返回：A 卡转生成中；B 面板不被 A 的回调关闭、不被冻结
    await act(async () => { resolveA({ job_id: 'jA', status: 'queued' }); });
    await flush();
    expect(dataOf(cardA).genStatus).toBe('generating');
    expect(dataOf(cardA).jobId).toBe('jA');
    expect(panelOpen()).toBe(true);
    expect(panelFps(120)!.disabled).toBe(false);
    expect(panelSend()!.disabled).toBe(false);

    // B 各自提交成功：按 B 自己的会话受理并关闭面板
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
    // A 在途（提交点即交接，面板已关）：从源卡再建 B 并打开其面板
    await frameInterpolation();
    const cardB = draftNodes().find((n) => n.id !== cardA)!.id;

    // A 在途：B 面板完全可用（提交钮/切档未冻结）
    expect(panelOpen()).toBe(true);
    expect(panelSend()!.disabled).toBe(false);
    expect(panelFps(120)!.disabled).toBe(false);

    // IKJJR3：A 旧失败收敛到 A 卡（回配置态、无受理假象）；错误提示在提交时单源提示一次
    //（不再按会话纪元压制——失败反馈已收敛到卡，重开面板可重发）。B 保持可编辑。
    await act(async () => { rejectA(new Error('network down')); });
    await flush();
    expect(dataOf(cardA).genStatus).toBe('draft');
    expect(dataOf(cardA).jobId).toBeUndefined();
    expect(panelOpen()).toBe(true);
    expect(panelSend()!.disabled).toBe(false);
    expect(panelFps(120)!.disabled).toBe(false);

    // B 提交照常受理（面板按 B 自己的会话关闭）
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
    // IKJJR3：提交点即交接（面板已关、卡转生成中）；重开本卡面板为生成中只读
    //（受理在途由 submitting 防重保护，重开不重复受理）
    await clickCard(draftId);
    expect(panelOpen()).toBe(true);
    expect(document.body.textContent).toContain('参数只读');
    expect(panelFps(120)!.disabled).toBe(true);
    expect(panelSend()!.disabled).toBe(true);

    // 同卡重开也是新会话；旧受理继续转原卡生成中，保留新面板。
    await act(async () => { resolveCreate({ job_id: 'j1', status: 'queued' }); });
    await flush();
    expect(panelOpen()).toBe(true);
    expect(dataOf(draftId).genStatus).toBe('generating');
  });
});
