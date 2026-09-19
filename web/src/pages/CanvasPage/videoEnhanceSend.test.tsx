// @vitest-environment jsdom
/* IKH3VH 视频 HD 高清发送闭环与结果回填（画布链路）：发送 POST video-enhancements 携带冻结
   三键（source_asset_id / target_node_id / resolution）、创建成功面板自动关闭卡原地转生成中、
   创建失败面板保留可重发（卡保持草稿）、轮询 mock 终态收敛（succeeded 回填 URL/mediaType/
   宽高/时长、failed 走 1045 家族文案映射）、失败 onRetryJob 原 lastParams 重发（不经通用
   retry）、生成中取消回草稿与只读重开、链式联动（2K/4K 结果卡置灰不建卡、1080P 可再发起）、
   持久化恢复（生成中水合即恢复轮询并收敛成品、结果卡保持）。渲染模式沿用
   videoEnhancePanel.test.tsx（FlowCanvas 打桩透出 props），轮询 mock 终态模式对齐
   audioVideoSplitEdit.test.tsx（IKH28X 先例）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { VIDEO_ENHANCE_EDGE_ORIGIN } from './videoEnhance';
import type { GenerationModel } from '@/api/generation';

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
  cancelGenerationJob: vi.fn(async () => null),
  retryGenerationJob: vi.fn(),
  createMediaExtraction: vi.fn(),
  createImageEnhancement: vi.fn(),
  createVideoEnhancement: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
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
  createVideoEnhancement: apiMocks.createVideoEnhancement,
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

/** 成品 HD 卡身份（与 VG 面板测试 seedDoc(true) 同构，分辨率可变） */
function finishedHdNode(id: string, assetId: string, width: number, height: number, resolution: string) {
  return {
    id,
    type: 'mediaNode',
    position: { x: 958, y: 0 },
    data: {
      src: `http://vid/${id}.mp4`,
      mediaType: 'video',
      fileName: `生成-88`,
      assetId,
      width,
      height,
      jobId: '88',
      videoEnhance: {
        sourceAssetId: '5',
        lastParams: { resolution },
      },
    },
  };
}

/** 画布：一个就绪视频节点 v1（assetId '5'，1280×720 达标）+ 可选附加节点。
 *  mode：'draft' 仅源卡；'failed' 带 4K 失败成品卡（重试链路）；'chain' 带 1080P 与 4K
 *  成品结果卡（链式联动）；'generating' 带生成中 HD 卡（持久化恢复）；'done' 带已完成
 *  1080P 结果卡（结果持久保持） */
function seedDoc(mode: 'draft' | 'failed' | 'chain' | 'generating' | 'done' = 'draft') {
  const nodes: Array<Record<string, unknown>> = [
    {
      id: 'v1',
      type: 'mediaNode',
      position: { x: 400, y: 0 },
      data: { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '素材视频', assetId: '5', width: 1280, height: 720 },
    },
  ];
  const edges: Array<Record<string, unknown>> = [];
  const assets: Record<string, unknown> = {
    5: { asset_id: 5, type: 'video', access_url: 'http://vid/v1.mp4', width: 1280, height: 720 },
  };
  if (mode === 'failed') {
    const card = finishedHdNode('h1', '9', 3840, 2160, '4k');
    ((card.data as Record<string, unknown>).genStatus) = 'failed';
    ((card.data as Record<string, unknown>).errorText) = '视频画质增强失败，请重试';
    nodes.push(card);
    edges.push({ id: 'e1', source: 'v1', target: 'h1', data: { origin: VIDEO_ENHANCE_EDGE_ORIGIN } });
    assets[9] = { asset_id: 9, type: 'video', access_url: 'http://vid/h1.mp4', width: 3840, height: 2160 };
  }
  if (mode === 'chain') {
    nodes.push(finishedHdNode('r1080', '9', 1920, 1080, '1080p'));
    nodes.push({ ...finishedHdNode('r4k', '11', 3840, 2160, '4k'), position: { x: 1516, y: 0 } });
    edges.push({ id: 'e1', source: 'v1', target: 'r1080', data: { origin: VIDEO_ENHANCE_EDGE_ORIGIN } });
    edges.push({ id: 'e2', source: 'v1', target: 'r4k', data: { origin: VIDEO_ENHANCE_EDGE_ORIGIN } });
    assets[9] = { asset_id: 9, type: 'video', access_url: 'http://vid/r1080.mp4', width: 1920, height: 1080 };
    assets[11] = { asset_id: 11, type: 'video', access_url: 'http://vid/r4k.mp4', width: 3840, height: 2160 };
  }
  if (mode === 'generating') {
    nodes.push({
      id: 'h1',
      type: 'mediaNode',
      position: { x: 958, y: 0 },
      data: {
        src: '',
        mediaType: 'video',
        fileName: 'HD',
        genStatus: 'generating',
        progress: 0,
        draft: true,
        jobId: 'j9',
        videoEnhance: { sourceAssetId: '5', lastParams: { resolution: '2k' } },
      },
    });
    edges.push({ id: 'e1', source: 'v1', target: 'h1', data: { origin: VIDEO_ENHANCE_EDGE_ORIGIN } });
  }
  if (mode === 'done') {
    nodes.push(finishedHdNode('h1', '9', 1920, 1080, '1080p'));
    edges.push({ id: 'e1', source: 'v1', target: 'h1', data: { origin: VIDEO_ENHANCE_EDGE_ORIGIN } });
    assets[9] = { asset_id: 9, type: 'video', access_url: 'http://vid/h1.mp4', width: 1920, height: 1080 };
  }
  canvasDocMock.current = {
    doc: { id: 11, version: 3, viewport: { x: 0, y: 0, zoom: 1 }, nodes, edges },
    assets,
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
const hdDraft = () => mediaNodes().find((n: Node) => n.id !== 'v1' && n.id !== 'r1080' && n.id !== 'r4k');
const panelSend = () => document.body.querySelector<HTMLButtonElement>('[data-testid="video-enhance-send-btn"]');
const panelResolution = (value: string) =>
  document.body.querySelector<HTMLButtonElement>(`[data-testid="video-enhance-resolution-${value}"]`);
const identityOf = (node: Node | undefined) =>
  ((node?.data ?? {}) as Record<string, unknown>).videoEnhance as Record<string, unknown> | undefined;

async function clickPanelResolution(value: string) {
  await act(async () => {
    panelResolution(value)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** HD 面板点发送（startVideoEnhanceJob 含 await 创建，等 50ms 让创建往返与轮询首 tick 完成） */
async function sendHd() {
  await act(async () => {
    panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
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

describe('IKH3VH 发送创建任务闭环', () => {
  it('发送：三键冻结 payload、面板自动关闭、卡原地转生成中、lastParams 写入、jobId 登记并启动轮询、源卡不动', async () => {
    seedDoc();
    apiMocks.createVideoEnhancement.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 20, asset: null });
    await renderPage();
    await videoEnhance();
    const draftId = hdDraft()!.id;

    await clickPanelResolution('2k');
    await sendHd();

    // 创建请求携带冻结三键（source_asset_id 冻结自 HD 身份、target_node_id=HD 卡节点 id、面板所选档）
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledWith('p1', {
      source_asset_id: '5',
      target_node_id: draftId,
      resolution: '2k',
    });
    // 创建成功面板自动关闭（发送钮不在文档）
    expect(panelSend()).toBeNull();
    // 原地转生成中：lastParams 随提交写卡、jobId 登记并启动轮询（首 tick 已发起）
    const data = mediaNode(draftId).data as Record<string, unknown>;
    expect(data.genStatus).toBe('generating');
    // 轮询推进：首 tick 已取回 processing 进度
    expect(data.progress).toBe(20);
    expect(data.jobId).toBe('j1');
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { resolution: '2k' } });
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j1');
    // 卡数量不变（不新建占位卡）、来源边保持、源卡不动
    expect(mediaNodes().length).toBe(2);
    expect((mediaNode('v1').data as Record<string, unknown>).src).toBe('http://vid/v1.mp4');
  });

  it('创建失败（网络）：面板保留可重发、卡保持草稿不写 jobId、submitting 复位后发送钮可再点', async () => {
    seedDoc();
    apiMocks.createVideoEnhancement.mockRejectedValue(new Error('network down'));
    await renderPage();
    await videoEnhance();
    const draftId = hdDraft()!.id;

    await sendHd();

    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    // 面板保留（发送钮仍在）且提交中已复位（可再点）；卡保持草稿原状（未转生成中、无 jobId）
    expect(panelSend()).toBeTruthy();
    expect(panelSend()!.disabled).toBe(false);
    const data = mediaNode(draftId).data as Record<string, unknown>;
    expect(data.genStatus).toBe('draft');
    expect(data.jobId).toBeUndefined();
    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();
  });

  it('生成中点卡重开面板：参数只读冻结（发送钮禁用）', async () => {
    seedDoc();
    apiMocks.createVideoEnhancement.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 20, asset: null });
    await renderPage();
    await videoEnhance();
    const draftId = hdDraft()!.id;
    await sendHd();
    expect(panelSend()).toBeNull();

    await act(async () => {
      flowProps.current.onNodeClick(mediaNode(draftId));
    });
    expect(panelSend()).toBeTruthy();
    expect(document.body.textContent).toContain('生成中，参数只读');
    expect(panelSend()!.disabled).toBe(true);
  });
});

describe('IKH3VH 轮询终态回填', () => {
  it('succeeded：结果视频回填 HD 卡（src/mediaType/宽高/时长/assetId）、草稿身份结束、源卡不动', async () => {
    seedDoc();
    apiMocks.createVideoEnhancement.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j1', status: 'succeeded', progress: 100,
      asset: { id: 'a88', url: 'http://tos/hd.mp4', type: 'video', width: 2560, height: 1440, duration: 32.5 },
    });
    await renderPage();
    await videoEnhance();
    const draftId = hdDraft()!.id;
    await sendHd();

    const data = mediaNode(draftId).data as Record<string, unknown>;
    expect(data.genStatus).toBeUndefined();
    expect(data.progress).toBe(100);
    expect(data.src).toBe('http://tos/hd.mp4');
    expect(data.mediaType).toBe('video');
    expect(data.assetId).toBe('a88');
    expect(data.width).toBe(2560);
    expect(data.height).toBe(1440);
    expect(data.duration).toBe(32.5);
    // 草稿身份结束（成品卡可再发起链式 HD）
    expect(data.draft).toBeUndefined();
    // 源卡不动
    expect((mediaNode('v1').data as Record<string, unknown>).src).toBe('http://vid/v1.mp4');
  });

  it('failed：空 msg 走 1045 家族文案映射展示可读原因；onRetryJob 按 lastParams 原样重发（不经通用 retry）并收敛成品', async () => {
    seedDoc();
    apiMocks.createVideoEnhancement
      .mockResolvedValueOnce({ job_id: 'j1', status: 'queued' })
      .mockResolvedValueOnce({ job_id: 'j2', status: 'queued' });
    apiMocks.fetchJobStatus
      .mockResolvedValueOnce({
        job_id: 'j1', status: 'failed', progress: 1,
        error: { code: 'video_enhance_failed', msg: '' },
      })
      .mockResolvedValueOnce({
        job_id: 'j2', status: 'succeeded', progress: 100,
        asset: { id: 'a89', url: 'http://tos/hd2.mp4', type: 'video', width: 2560, height: 1440, duration: 30 },
      });
    await renderPage();
    await videoEnhance();
    await clickPanelResolution('2k');
    await sendHd();
    const draftId = hdDraft()!.id;

    // 失败态：msg 为空 → 1045 家族兜底文案「视频画质增强失败，请重试」
    const failed = mediaNode(draftId).data as Record<string, unknown>;
    expect(failed.genStatus).toBe('failed');
    expect(failed.errorText).toBe('视频画质增强失败，请重试');

    // 原参数重试：lastParams（2k）原样重发创建接口（新 job），轮询 succeeded 收敛成品
    await act(async () => {
      (failed.onRetryJob as (id: string) => void)(draftId);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);
    expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5',
      target_node_id: draftId,
      resolution: '2k',
    });
    expect(apiMocks.retryGenerationJob).not.toHaveBeenCalled();
    const retried = mediaNode(draftId).data as Record<string, unknown>;
    expect(retried.jobId).toBe('j2');
    expect(retried.genStatus).toBeUndefined();
    expect(retried.src).toBe('http://tos/hd2.mp4');
    expect(retried.width).toBe(2560);
  });
});

describe('IKH3VH 生成中取消', () => {
  it('取消：cancel 接口携带 jobId，权威 cancelled 终态后卡回草稿保留（身份与来源边不丢）', async () => {
    seedDoc();
    apiMocks.createVideoEnhancement.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus
      .mockResolvedValueOnce({ job_id: 'j1', status: 'processing', progress: 20, asset: null })
      .mockResolvedValueOnce({ job_id: 'j1', status: 'cancelled', progress: 0, asset: null });
    await renderPage();
    await videoEnhance();
    const draftId = hdDraft()!.id;
    await sendHd();
    expect((mediaNode(draftId).data as Record<string, unknown>).genStatus).toBe('generating');

    await act(async () => {
      ((mediaNode(draftId).data as Record<string, unknown>).onCancelJob as (id: string) => void)(draftId);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(apiMocks.cancelGenerationJob).toHaveBeenCalledWith('p1', 'j1');
    // 卡回待生成（保留卡与连线，可重开面板原参数重发），不被移除
    expect(mediaNodes().length).toBe(2);
    const data = mediaNode(draftId).data as Record<string, unknown>;
    expect(data.genStatus).toBe('draft');
    expect(identityOf(mediaNode(draftId))).toEqual({ sourceAssetId: '5', lastParams: { resolution: '1080p' } });
    const edge = (flowProps.current.edges as Array<{ source: string; target: string }>).find((e) => e.target === draftId);
    expect(edge?.source).toBe('v1');
  });
});

describe('IKH3VH 链式联动', () => {
  it('4K 结果卡再点 HD：源输入超上限置灰兜底，不建卡不弹面板', async () => {
    seedDoc('chain');
    await renderPage();
    await act(async () => {
      ((mediaNode('r4k').data as Record<string, unknown>).onVideoEnhance as (id: string) => void)('r4k');
    });
    expect(mediaNodes().length).toBe(3);
    expect(panelSend()).toBeNull();
    expect(apiMocks.createVideoEnhancement).not.toHaveBeenCalled();
  });

  it('1080P 结果卡可再次发起 HD：以结果卡自身为源新建 HD 卡并弹面板（链式）', async () => {
    seedDoc('chain');
    await renderPage();
    await act(async () => {
      ((mediaNode('r1080').data as Record<string, unknown>).onVideoEnhance as (id: string) => void)('r1080');
    });
    expect(mediaNodes().length).toBe(4);
    const chained = mediaNodes().find((n) => n.id !== 'v1' && n.id !== 'r1080' && n.id !== 'r4k')!;
    expect(identityOf(chained)).toEqual({ sourceAssetId: '9' });
    expect(panelSend()).toBeTruthy();
    const edge = (flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>)
      .find((e) => e.target === chained.id)!;
    expect(edge.source).toBe('r1080');
    expect(edge.data).toEqual({ origin: VIDEO_ENHANCE_EDGE_ORIGIN });
  });
});

describe('IKH3VH 持久化恢复', () => {
  it('刷新后生成中 HD 卡水合即恢复轮询，succeeded 收敛成品（宽高/时长/URL 回填）', async () => {
    seedDoc('generating');
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j9', status: 'succeeded', progress: 100,
      asset: { id: 'a90', url: 'http://tos/restored.mp4', type: 'video', width: 2560, height: 1440, duration: 18 },
    });
    await renderPage();

    // 水合恢复轮询：以持久化的 jobId 查询任务
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j9');
    const data = mediaNode('h1').data as Record<string, unknown>;
    expect(data.genStatus).toBeUndefined();
    expect(data.src).toBe('http://tos/restored.mp4');
    expect(data.width).toBe(2560);
    expect(data.height).toBe(1440);
    expect(data.duration).toBe(18);
    expect(data.draft).toBeUndefined();
  });

  it('刷新后已完成结果卡保持展示且不再轮询', async () => {
    seedDoc('done');
    await renderPage();

    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();
    const data = mediaNode('h1').data as Record<string, unknown>;
    expect(data.src).toBe('http://vid/h1.mp4');
    expect(data.width).toBe(1920);
    expect(data.height).toBe(1080);
    expect(data.jobId).toBe('88');
  });
});
