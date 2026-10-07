// @vitest-environment jsdom
/* IKH3VH 视频 HD 高清发送闭环与结果回填（画布链路）：发送 POST video-enhancements 携带冻结
   三键（source_asset_id / target_node_id / resolution）、创建成功面板自动关闭卡原地转生成中、
   创建失败面板保留可重发（卡保持草稿）、轮询 mock 终态收敛（succeeded 回填 URL/mediaType/
   宽高/时长、failed 走 1045 家族文案映射）、失败 onRetryJob 原 lastParams 重发（不经通用
   retry）、生成中取消回草稿与只读重开、链式联动（2K/4K 结果卡置灰不建卡、1080P 可再发起）、
   持久化恢复（生成中水合即恢复轮询并收敛成品、结果卡保持）、发送在途显式关闭重开可重发
   （新会话再次受理，区别于选中隐藏回看的在途只读）。渲染模式沿用
   videoEnhancePanel.test.tsx（FlowCanvas 打桩透出 props），轮询 mock 终态模式对齐
   audioVideoSplitEdit.test.tsx（IKH28X 先例）。 */
import { dockActions } from './testing/dockActionsRecorder';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactFlow, ReactFlowProvider, applyNodeChanges, type Node } from '@xyflow/react';
import CanvasPage from './index';
import MediaNode from './components/MediaNode';
import { VIDEO_ENHANCE_EDGE_ORIGIN } from './videoEnhance';
import { toast } from 'sonner';
import type { GenerationModel } from '@/api/generation';

/* sonner 替身：IKJPM7 真实链用例的 HTTP 层默认 toast 观测点（IKI8L4 先例）。
   页面本地 showToast 为独立 state 渲染，不受影响。 */
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
  Toaster: () => null,
}));

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
  cancelGenerationJob: vi.fn(async () => null),
  retryGenerationJob: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
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
  fetchCredits: apiMocks.fetchCredits,
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
/* importOriginal 部分真实（IKI8L4 先例）：列出键走 mock（既有用例接缝不变），
   其余键保持真实实现——IKJPM7 真实链用例把 createVideoEnhancement 动态转发回真实
   实现（真实 http.ts 默认 toast 逻辑保留），受控响应仅在 fetch 边界注入。 */
vi.mock('@/api/jobs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/jobs')>()),
  // 水合/轮询等旁路查询固定空结果，避免 importOriginal 后真实外呼（harness 同口径）
  fetchJobs: vi.fn(async (): Promise<{ records: never[]; total: number; size: number; current: number }> => ({ records: [], total: 0, size: 20, current: 1 })),
  createGenerationJob: apiMocks.createGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createMediaExtraction: apiMocks.createMediaExtraction,
  createAudioTrim: apiMocks.createAudioTrim,
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
 *  mode：'draft' 仅源卡；'failed' 带 4K 失败成品卡（重试链路）；'twoFailed' 带 h1 4K 与
 *  h2 2K 两张失败成品卡（IKJPXN 换目标链路）；'chain' 带 1080P 与 4K 成品结果卡（链式联动）；
 *  'generating' 带生成中 HD 卡（持久化恢复）；'done' 带已完成 1080P 结果卡（结果持久保持） */
function seedDoc(mode: 'draft' | 'failed' | 'twoFailed' | 'chain' | 'generating' | 'done' = 'draft') {
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
  if (mode === 'twoFailed') {
    // IKJPXN 换目标场景：h1（4K）与 h2（2K）两张失败 HD 卡，各自 lastParams 与来源边
    const first = finishedHdNode('h1', '9', 3840, 2160, '4k');
    ((first.data as Record<string, unknown>).genStatus) = 'failed';
    ((first.data as Record<string, unknown>).errorText) = '视频画质增强失败，请重试';
    const second = { ...finishedHdNode('h2', '10', 1920, 1080, '2k'), position: { x: 1516, y: 0 } };
    ((second.data as Record<string, unknown>).genStatus) = 'failed';
    ((second.data as Record<string, unknown>).errorText) = '视频画质增强失败，请重试';
    nodes.push(first, second);
    edges.push({ id: 'e1', source: 'v1', target: 'h1', data: { origin: VIDEO_ENHANCE_EDGE_ORIGIN } });
    edges.push({ id: 'e2', source: 'v1', target: 'h2', data: { origin: VIDEO_ENHANCE_EDGE_ORIGIN } });
    assets[9] = { asset_id: 9, type: 'video', access_url: 'http://vid/h1.mp4', width: 3840, height: 2160 };
    assets[10] = { asset_id: 10, type: 'video', access_url: 'http://vid/h2.mp4', width: 1920, height: 1080 };
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
/** 真实 MediaNode 挂载点（IKJP8Q：失败卡重试按钮真实渲染与点击，不以直接调回调为唯一证明） */
let cardRoot: Root | null = null;
let cardHost: HTMLDivElement | null = null;

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
const panelClose = () => document.body.querySelector<HTMLButtonElement>('[data-testid="video-enhance-close-btn"]');
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
  apiMocks.createVideoEnhancement.mockReset();
});

afterEach(async () => {
  if (cardRoot) await act(async () => cardRoot!.unmount());
  cardHost?.remove();
  cardRoot = null;
  cardHost = null;
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
    expect(dockActions.submit).toHaveBeenCalledWith('videoEnhance', '2k');

    // 创建请求携带冻结三键（source_asset_id 冻结自 HD 身份、target_node_id=HD 卡节点 id、面板所选档）
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledWith('p1', {
      source_asset_id: '5',
      target_node_id: draftId,
      resolution: '2k',
    }, { silent: true, canvasBinding: expect.anything(), idempotencyKey: expect.any(String) });
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

describe('HD 面板迟到请求与新会话', () => {
  it.each(['success', 'failure'] as const)('关闭同卡重开再提交后，旧%s不回写原卡或续链，新面板与锁保留', async (outcome) => {
    seedDoc();
    let resolveOld!: (value: { job_id: string; status: 'queued' }) => void;
    let rejectOld!: (error: unknown) => void;
    apiMocks.createVideoEnhancement
      .mockImplementationOnce(() => new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }))
      .mockImplementationOnce(() => new Promise(() => {}));
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j-old', status: 'processing', progress: 0, asset: null });
    await renderPage();
    await videoEnhance();
    const draftId = hdDraft()!.id;
    await clickPanelResolution('2k');
    await act(async () => { panelSend()!.click(); });
    await act(async () => { panelClose()!.click(); });
    await act(async () => { flowProps.current.onNodeClick(mediaNode(draftId)); });
    await clickPanelResolution('4k');
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', target_node_id: draftId, resolution: '4k',
    }, expect.objectContaining({ silent: true, canvasBinding: expect.anything(), idempotencyKey: expect.any(String) }));
    await act(async () => {
      if (outcome === 'success') resolveOld({ job_id: 'j-old', status: 'queued' });
      else rejectOld(new Error('old network'));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(panelSend()).not.toBeNull();
    expect(panelSend()!.disabled).toBe(true);
    expect(panelResolution('4k')!.className).toContain('resolutionBtnActive');
    expect(document.body.textContent).not.toContain('HD 高清任务创建失败，请重试');
    if (outcome === 'success') {
      expect(mediaNode(draftId).data.jobId).toBeUndefined();
      expect(mediaNode(draftId).data.genStatus).toBe('draft');
      expect(apiMocks.fetchJobStatus).not.toHaveBeenCalledWith('j-old');
    } else {
      expect(panelSend()!.title).toBe('正在保存并提交，参数只读');
      expect(mediaNode(draftId).data.genStatus).toBe('draft');
    }
    expect(flowProps.current.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'v1', target: draftId, data: { origin: VIDEO_ENHANCE_EDGE_ORIGIN } }),
    ]));
  });

  it('发送在途显式关闭（X）再重开：新会话可再次发送，创建接口再次受理', async () => {
    seedDoc();
    apiMocks.createVideoEnhancement.mockImplementation(() => new Promise(() => {}));
    await renderPage();
    await videoEnhance();
    const draftId = hdDraft()!.id;
    await clickPanelResolution('2k');
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

    // 显式关闭（X）：面板关、草稿卡保留（创建仍在途不落地）
    await act(async () => { panelClose()!.click(); });
    expect(panelSend()).toBeNull();

    // 重开（点 HD 草稿卡）：显式关闭即新会话，发送钮可点（对比选中隐藏回看的在途只读口径）
    await act(async () => { flowProps.current.onNodeClick(mediaNode(draftId)); });
    expect(panelSend()).toBeTruthy();
    expect(panelSend()!.disabled).toBe(false);
    await act(async () => { panelSend()!.click(); });

    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);
    expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', target_node_id: draftId, resolution: '2k',
    }, expect.objectContaining({ silent: true, canvasBinding: expect.anything(), idempotencyKey: expect.any(String) }));
  });

  it('发送在途选中其它卡再选回本卡：面板重现仍在途只读，同卡不重复受理', async () => {
    seedDoc();
    apiMocks.createVideoEnhancement.mockImplementation(() => new Promise(() => {}));
    await renderPage();
    await videoEnhance();
    const draftId = hdDraft()!.id;
    await clickPanelResolution('2k');
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    // IKJJR3：提交点即交接（面板关 + 卡转生成中）。选中其它卡后点回本卡：面板重现且
    // 生成中只读，submitting 窗口统一防重，不重复受理
    await act(async () => { flowProps.current.onSelectionChange({ nodes: [mediaNode('v1')] }); });
    await act(async () => { flowProps.current.onNodeClick(mediaNode(draftId)); });
    expect(panelSend()).toBeTruthy();
    expect(panelSend()!.disabled).toBe(true);
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
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
    // IKJJR3：重试走运行时（冻结输入 lastParams 原样重发；测试受理响应无 canvas_binding
    // 视图 → 历史兼容路径 binding=null，真实环境带视图时为新提交身份）
    expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5',
      target_node_id: draftId,
      resolution: '2k',
    }, expect.objectContaining({ silent: true }));
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

/* IKJP8Q：HD 失败卡重试与面板发送共用同卡同步提交准入。面板保持打开时两种顺序都只受理
   一次；重试登记在途后已打开面板立即提交中只读；显式关闭重开仍是新会话例外（可再受理一次）；
   合法多在途各自收尾，旧响应不关闭新面板、不解除新会话锁。重试经真实 MediaNode「重试」按钮
   点击触发（挂载页面注入的最新节点数据，onRetryJob 仍路由页面 handler），面板用页面真实按钮。 */
describe('IKJP8Q 失败卡重试与面板发送互斥', () => {
  /** 挂起的创建响应（在途窗口可控） */
  const pendingCreate = () => new Promise<{ job_id: string; status: 'queued' }>(() => {});

  /** 以页面当前节点数据真实渲染 MediaNode（ReactFlowProvider 上下文，同 cardHtml 先例）。
   *  宿主带 .react-flow 类：模拟卡片真实所在的画布区域，命中 IKFYH6「画布外点击关面板」豁免。 */
  async function mountCard(id: string) {
    if (cardRoot) { await act(async () => cardRoot!.unmount()); cardRoot = null; }
    cardHost?.remove();
    const node = mediaNode(id);
    cardHost = document.createElement('div');
    cardHost.className = 'react-flow';
    document.body.appendChild(cardHost);
    cardRoot = createRoot(cardHost);
    await act(async () => {
      cardRoot!.render(
        createElement(ReactFlowProvider, null, createElement(MediaNode, {
          ...node, selected: false, dragging: false, zIndex: 1, selectable: true, deletable: true,
          draggable: true, isConnectable: true, positionAbsoluteX: 0, positionAbsoluteY: 0,
        } as never)),
      );
    });
  }

  const retryButton = () =>
    [...(cardHost?.querySelectorAll('button') ?? [])].find((b) => b.textContent === '重试');

  /** 真实失败卡「重试」按钮点击（数据快照里的 onRetryJob 路由页面最新 handler） */
  async function clickCardRetry() {
    await act(async () => {
      retryButton()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  /** 打开失败卡 HD 面板（点卡重开，同「生成中点卡重开面板」路径） */
  async function openHdPanel(id = 'h1') {
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode(id));
    });
  }

  /** 真实创建客户端与 HTTP 链脚手架（IKJPM7/IKJPXN 共用）：createVideoEnhancement 转发真实
   *  实现（真实 http.ts 默认 toast 保留），受控响应仅在 fetch 边界注入；默认兜底成功空信封，
   *  页面意外真实 fetch 不外呼不干扰受控用例。hooks 随调用处 describe 注册，作用域不变。 */
  function setupRealCreateClient() {
    const fetchMock = vi.fn();
    const jsonEnvelope = (code: number, msg: string, status: number, data: unknown = null) =>
      new Response(JSON.stringify({ code, msg, data }), { status, headers: { 'Content-Type': 'application/json' } });
    const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

    beforeEach(async () => {
      const actual = await vi.importActual<typeof import('@/api/jobs')>('@/api/jobs');
      apiMocks.createVideoEnhancement.mockImplementation(actual.createVideoEnhancement);
      fetchMock.mockReset();
      fetchMock.mockImplementation(async () => jsonEnvelope(200, 'ok', 200));
      vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => { vi.unstubAllGlobals(); });
    return { fetchMock, jsonEnvelope, settle };
  }

  it('先重试再发送：重试登记后已打开面板立即只读，面板发送不再受理（创建仅一次）', async () => {
    seedDoc('failed');
    apiMocks.createVideoEnhancement.mockImplementation(pendingCreate);
    await renderPage();
    await openHdPanel();
    expect(panelSend()!.disabled).toBe(false);

    await mountCard('h1');
    expect(retryButton()).toBeTruthy();
    await clickCardRetry();
    // 重试已受理：lastParams（4k）原样重发创建接口（IKJPM7 静默传输，反馈走页面回调），不经通用 retry
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', target_node_id: 'h1', resolution: '4k',
    }, expect.objectContaining({ silent: true }));
    expect(apiMocks.retryGenerationJob).not.toHaveBeenCalled();

    // 重试登记在途 → 面板立即提交中只读（发送钮与分辨率参数均按既有只读规则禁用）；
    // 再点发送（含强制派发）不重复受理
    expect(panelSend()!.disabled).toBe(true);
    expect(panelResolution('4k')!.disabled).toBe(true);
    await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
  });

  it('先发送再重试：面板受理在途后同卡重试被拒（创建仅一次），卡与参数不变、无额外提示', async () => {
    seedDoc('failed');
    apiMocks.createVideoEnhancement.mockImplementation(pendingCreate);
    await renderPage();
    await openHdPanel();
    await clickPanelResolution('2k');
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', target_node_id: 'h1', resolution: '2k',
    }, expect.objectContaining({ silent: true }));

    await mountCard('h1');
    await clickCardRetry();
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    // 防重拒绝不发请求、不改卡片结果或既有参数（lastParams 保持面板编辑写回的 2k）
    const data = mediaNode('h1').data as Record<string, unknown>;
    expect(data.genStatus).toBe('failed');
    expect(identityOf(mediaNode('h1'))).toEqual({ sourceAssetId: '5', lastParams: { resolution: '2k' } });
    expect(document.body.textContent).not.toContain('HD 高清任务创建失败，请重试');
  });

  it('对照：面板内快速连点发送仍只受理一次（既有防重不削弱）', async () => {
    seedDoc('failed');
    apiMocks.createVideoEnhancement.mockImplementation(pendingCreate);
    await renderPage();
    await openHdPanel();
    await act(async () => {
      panelSend()!.click();
      panelSend()!.click();
    });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
  });

  it('对照：重试在途显式关闭面板重开属新会话，可主动再发送一次（创建共两次）', async () => {
    seedDoc('failed');
    apiMocks.createVideoEnhancement.mockImplementation(pendingCreate);
    await renderPage();
    await openHdPanel();
    await mountCard('h1');
    await clickCardRetry();
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

    // 显式关闭（X）→ 重开 = 新会话：发送钮可用，可再受理一次
    await act(async () => { panelClose()!.click(); });
    expect(panelSend()).toBeNull();
    await openHdPanel();
    expect(panelSend()!.disabled).toBe(false);
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);
  });

  it('重试在途点卡冒泡重入当前可见面板：参数与提交中只读保留，不产生新提交机会', async () => {
    seedDoc('failed');
    apiMocks.createVideoEnhancement.mockImplementation(pendingCreate);
    await renderPage();
    await openHdPanel();
    await clickPanelResolution('2k');
    await mountCard('h1');
    await clickCardRetry();
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

    // 重试按钮点击冒泡到节点 onClick：可见同卡重入保留面板内容与提交状态
    await openHdPanel();
    expect(panelSend()!.disabled).toBe(true);
    expect(panelResolution('2k')!.className).toContain('resolutionBtnActive');
    await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
  });

  it('重试创建失败后同卡限制解除：面板恢复可发送，再次操作正常受理', async () => {
    seedDoc('failed');
    apiMocks.createVideoEnhancement
      .mockRejectedValueOnce(new Error('network down'))
      .mockImplementation(pendingCreate);
    await renderPage();
    await openHdPanel();
    await mountCard('h1');
    await clickCardRetry();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

    // 创建失败 → 面板恢复可操作（发送钮可用），再次发送受理第二次
    expect(panelSend()!.disabled).toBe(false);
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);
    expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', target_node_id: 'h1', resolution: '4k',
    }, expect.objectContaining({ silent: true }));
  });

  it('不同卡互不锁定：h1 重试在途时，源卡新发起的 HD 面板可正常发送', async () => {
    seedDoc('failed');
    apiMocks.createVideoEnhancement.mockImplementation(pendingCreate);
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j2', status: 'processing', progress: 10, asset: null });
    await renderPage();
    await openHdPanel();
    await mountCard('h1');
    await clickCardRetry();
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

    // 对源卡 v1 发起 HD：新建草稿卡并把面板切到它（h1 在途不波及）
    await videoEnhance('v1');
    const draft = mediaNodes().find((n) => n.id !== 'v1' && n.id !== 'h1')!;
    expect(panelSend()!.disabled).toBe(false);
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);
    expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', target_node_id: draft.id, resolution: '1080p',
    }, expect.objectContaining({ silent: true }));
  });

  it('重试在途选中其它卡再选回本卡：面板重现仍在途只读，不重复受理', async () => {
    seedDoc('failed');
    apiMocks.createVideoEnhancement.mockImplementation(pendingCreate);
    await renderPage();
    await openHdPanel();
    await mountCard('h1');
    await clickCardRetry();
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

    await act(async () => { flowProps.current.onSelectionChange({ nodes: [mediaNode('v1')] }); });
    expect(panelSend()).toBeNull();
    await act(async () => { flowProps.current.onSelectionChange({ nodes: [mediaNode('h1')] }); });
    expect(panelSend()!.disabled).toBe(true);
    await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
  });

  it('合法多在途乱序收尾：旧重试失败返回不关闭新面板、不解除新会话锁，新请求仍可落卡', async () => {
    seedDoc('failed');
    let rejectOld!: (error: unknown) => void;
    let resolveNew!: (value: { job_id: string; status: 'queued' }) => void;
    apiMocks.createVideoEnhancement
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }));
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j2', status: 'processing', progress: 30, asset: null });
    await renderPage();
    await openHdPanel();
    await mountCard('h1');
    await clickCardRetry();

    // 显式关闭重开 = 新会话，旧重试在途仍可再发送一次（共两次受理）
    await act(async () => { panelClose()!.click(); });
    await openHdPanel();
    await clickPanelResolution('2k');
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);

    // 旧重试先返回（失败）：新面板不关闭、新会话提交锁不解除、卡不被旧请求改动
    await act(async () => {
      rejectOld(new Error('old network'));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(panelSend()).toBeTruthy();
    expect(panelSend()!.disabled).toBe(true);
    expect((mediaNode('h1').data as Record<string, unknown>).genStatus).toBe('failed');

    // 新会话自己的发送在途时，同卡失败重试同样被拒（US12 新会话互斥）
    await mountCard('h1');
    await clickCardRetry();
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);

    // 新会话请求随后成功：卡原地转生成中并轮询（各自收尾互不提前释放）
    await act(async () => {
      resolveNew({ job_id: 'j2', status: 'queued' });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const data = mediaNode('h1').data as Record<string, unknown>;
    expect(data.genStatus).toBe('generating');
    expect(data.jobId).toBe('j2');
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j2');
  });

  /* IKJPM3：合法多请求乱序收尾的提交锁校准——新会话发送（B）先失败而旧重试（A）仍
     等待时，B 的收尾只释放自己的占用，面板继续在途只读、不产生 C；旧重试（A）先返回
     而 B 仍等待时，A 的收尾不解除新会话自身的提交锁。全部创建请求收尾后按既有卡态恢复。 */
  it.each(['success', 'failure'] as const)('新会话发送先失败而旧重试仍等待：面板保持只读不产生 C（共 2 次），旧重试%s收尾后各自释放', async (outcome) => {
    seedDoc('failed');
    let settleOld!: (value: { job_id: string; status: 'queued' }) => void;
    let rejectOld!: (error: unknown) => void;
    let rejectNew!: (error: unknown) => void;
    apiMocks.createVideoEnhancement
      .mockImplementationOnce(() => new Promise((resolve, reject) => { settleOld = resolve; rejectOld = reject; }))
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectNew = reject; }))
      .mockImplementation(pendingCreate);
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j-old', status: 'processing', progress: 10, asset: null });
    await renderPage();
    await openHdPanel();
    await mountCard('h1');
    await clickCardRetry();
    // 显式关闭重开 = 新会话：旧重试在途仍可再发送一次（B，共 2 次受理）
    await act(async () => { panelClose()!.click(); });
    await openHdPanel();
    await clickPanelResolution('2k');
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);

    // B 先失败而 A 仍等待：当前有效失败保留原有提示，但面板继续只读（发送钮与分辨率
    // 参数），再点发送（含强制派发）不产生 C
    await act(async () => {
      rejectNew(new Error('new network'));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(document.body.textContent).toContain('HD 高清任务创建失败，请重试');
    expect(panelSend()!.disabled).toBe(true);
    expect(panelResolution('2k')!.disabled).toBe(true);
    await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);

    // A 已被新 B 接管：迟到成功与失败都不回写原卡，仅结算自己的在途资源。
    await act(async () => {
      if (outcome === 'success') settleOld({ job_id: 'j-old', status: 'queued' });
      else rejectOld(new Error('old network'));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const data = mediaNode('h1').data as Record<string, unknown>;
    expect(data.genStatus).toBe('failed');
    expect(data.jobId).toBe('88');
    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalledWith('j-old');
    expect(panelSend()!.disabled).toBe(false);
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(3);
  });

  it.each(['success', 'failure'] as const)('旧重试先%s返回而新会话发送仍等待：新会话锁不被旧收尾复位，再点不受理', async (outcome) => {
    seedDoc('failed');
    let settleOld!: (value: { job_id: string; status: 'queued' }) => void;
    let rejectOld!: (error: unknown) => void;
    apiMocks.createVideoEnhancement
      .mockImplementationOnce(() => new Promise((resolve, reject) => { settleOld = resolve; rejectOld = reject; }))
      .mockImplementation(pendingCreate);
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j-old', status: 'processing', progress: 10, asset: null });
    await renderPage();
    await openHdPanel();
    await mountCard('h1');
    await clickCardRetry();
    await act(async () => { panelClose()!.click(); });
    await openHdPanel();
    await clickPanelResolution('2k');
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);

    // 旧重试先返回（成功或失败）：新会话仍在途，锁与只读保持
    await act(async () => {
      if (outcome === 'success') settleOld({ job_id: 'j-old', status: 'queued' });
      else rejectOld(new Error('old network'));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(panelSend()!.disabled).toBe(true);
    expect(panelResolution('2k')!.disabled).toBe(true);
    await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);
    const data = mediaNode('h1').data as Record<string, unknown>;
    expect(data.genStatus).toBe('failed');
    expect(data.jobId).toBe('88');
    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalledWith('j-old');
  });

  /* IKJPM5：选择隐藏 ≠ 显式关闭——A 重试等待时点击其他卡隐藏面板，再真实点击原卡返回
     属恢复原会话：面板继续在途只读（发送钮与分辨率参数），不产生第二次创建。真实点击链
     保留 NodeWrapper 的节点点击与选择通知先后顺序（order 区分真实手势主路径与 useEffect
     早于/代替 onNodeClick 的窗口），空选中过渡不当显式关闭。对照：显式关闭重开仍为新
     会话可再发一次（上方 IKJP8Q 既有对照用例）。 */
  describe('IKJPM5 选择隐藏返回在途只读', () => {
    /** 真实点击 HD 卡返回：MediaNode 真实渲染于带 click 监听的宿主，父级监听模拟 React Flow
     *  NodeWrapper 的 onClick（onSelectNodeHandler），随后按真实顺序派发选择通知。
     *  order='node-first' 为真实手势主路径（onNodeClick 先到、选择通知随后）；
     *  'selection-first' 对应选中变化经 useEffect 早于或代替 onNodeClick 到达。 */
    async function clickCardBack(id: string, order: 'node-first' | 'selection-first' = 'node-first') {
      const nodeClick = () => flowProps.current.onNodeClick(mediaNode(id));
      const selection = () => flowProps.current.onSelectionChange({ nodes: [mediaNode(id)] });
      const chain = order === 'node-first' ? [nodeClick, selection] : [selection, nodeClick];
      await act(async () => {
        const listener = () => chain.forEach((call) => call());
        cardHost!.addEventListener('click', listener);
        try {
          // 点卡片主体（非重试按钮区域），冒泡到 NodeWrapper 层（cardHost 监听）
          const cardBody = cardHost!.querySelector('span') ?? cardHost!;
          cardBody.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        } finally {
          cardHost!.removeEventListener('click', listener);
        }
      });
    }

    /** A 重试受理并等待，面板随选择其他卡隐藏 */
    async function setupRetryHiddenPanel() {
      seedDoc('failed');
      apiMocks.createVideoEnhancement.mockImplementation(pendingCreate);
      await renderPage();
      await openHdPanel();
      await clickPanelResolution('2k');
      await mountCard('h1');
      await clickCardRetry();
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
      await act(async () => { flowProps.current.onSelectionChange({ nodes: [mediaNode('v1')] }); });
      expect(panelSend()).toBeNull();
    }

    it('A 重试等待→点其他卡→真实点原卡返回（节点点击先于选择通知）：仍只读、参数保留，创建总数 1', async () => {
      await setupRetryHiddenPanel();
      await clickCardBack('h1', 'node-first');
      expect(panelSend()!.disabled).toBe(true);
      expect(panelResolution('2k')!.disabled).toBe(true);
      expect(panelResolution('2k')!.className).toContain('resolutionBtnActive');
      await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    });

    it('先选择再显示路径同规则：选择通知先恢复（只读），真实点卡重入不洗锁、不重复受理', async () => {
      await setupRetryHiddenPanel();
      await clickCardBack('h1', 'selection-first');
      expect(panelSend()!.disabled).toBe(true);
      expect(panelResolution('2k')!.disabled).toBe(true);
      await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    });

    it('选择隐藏期间的空选中过渡不当显式关闭：点回原卡仍恢复只读会话，创建总数 1', async () => {
      await setupRetryHiddenPanel();
      await act(async () => { flowProps.current.onSelectionChange({ nodes: [] }); });
      await clickCardBack('h1');
      expect(panelSend()!.disabled).toBe(true);
      expect(panelResolution('2k')!.disabled).toBe(true);
      expect(panelResolution('2k')!.className).toContain('resolutionBtnActive');
      await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    });

    /* IKJPM7 修订（场景 i，违反 US19/IKJPM5 语义）：resume 恢复的是同一会话，A 是该
       会话当前有效请求——失败提示必须保留，不得因选择隐藏的纪元变化被吞。 */
    it('A 重试等待→点其他卡→真实点回原卡（resume 恢复同会话）：A 失败提示保留，创建总数 1', async () => {
      seedDoc('failed');
      let rejectA!: (error: unknown) => void;
      apiMocks.createVideoEnhancement.mockImplementationOnce(() => new Promise<never>((_, reject) => { rejectA = reject; }));
      await renderPage();
      await openHdPanel();
      await mountCard('h1');
      await clickCardRetry();
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
      await act(async () => { flowProps.current.onSelectionChange({ nodes: [mediaNode('v1')] }); });
      expect(panelSend()).toBeNull();
      await clickCardBack('h1', 'node-first');

      await act(async () => {
        rejectA(new Error('network down'));
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      // US19：A 是恢复会话的当前有效请求，失败保留原有页面提示
      expect(document.body.textContent).toContain('HD 高清任务创建失败，请重试');
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
      // 会话仍在途约束随 A 收尾解除：恢复的会话可继续操作
      expect(panelSend()!.disabled).toBe(false);
    });
  });

  it('新会话发送失败而旧重试仍等待时，再次显式关闭重开仍可按新会话例外主动发送', async () => {
    seedDoc('failed');
    apiMocks.createVideoEnhancement
      .mockImplementationOnce(pendingCreate)
      .mockImplementationOnce(() => Promise.reject(new Error('new network')))
      .mockImplementation(pendingCreate);
    await renderPage();
    await openHdPanel();
    await mountCard('h1');
    await clickCardRetry();
    await act(async () => { panelClose()!.click(); });
    await openHdPanel();
    await clickPanelResolution('2k');
    await act(async () => { panelSend()!.click(); });   // B 立即失败
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(2);
    expect(panelSend()!.disabled).toBe(true);           // 旧重试仍等待：面板继续只读

    // 再次显式关闭重开 = 又一新会话：例外保留，仍可主动发送一次
    await act(async () => { panelClose()!.click(); });
    await openHdPanel();
    expect(panelSend()!.disabled).toBe(false);
    await act(async () => { panelSend()!.click(); });
    expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(3);
    expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', target_node_id: 'h1', resolution: '2k',
    }, expect.objectContaining({ silent: true }));
  });

  /* IKJPM7 旧重试失败提示按有效会话归属：同卡显式关闭重开（即使未再发送）即新会话，
     旧重试 A 的失败（网络或 HTTP 422）不向其提示——页面与 HTTP 层默认 toast 都不弹，
     也不先于会话归属判断触发；当前有效请求失败保留原有提示与 401 静默。接缝对齐
     toolSessionErrorToastOwnership.test.tsx（IKI8L4）：createVideoEnhancement 转发真实
     实现（真实 http.ts 默认 toast 保留），受控响应仅在 fetch 边界注入。 */
  describe('IKJPM7 旧重试失败按有效会话归属（真实创建客户端与 HTTP 链）', () => {
    const { fetchMock, jsonEnvelope, settle } = setupRealCreateClient();

    it('A 重试后显式关闭重开（未再发送）：A 网络失败全链路无旧错误，新面板与参数保留', async () => {
      seedDoc('failed');
      let rejectA!: (error: unknown) => void;
      fetchMock.mockImplementationOnce(() => new Promise<Response>((_, reject) => { rejectA = reject; }));
      await renderPage();
      await openHdPanel();
      await mountCard('h1');
      await clickCardRetry();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // 显式关闭重开 = 新会话（未发送）：旧 A 的失败不属于它
      await act(async () => { panelClose()!.click(); });
      await openHdPanel();
      await act(async () => { rejectA(new TypeError('Failed to fetch')); });
      await settle();

      // 旧错误全链路静默：HTTP 层默认 toast（sonner）与页面 toast 都不出现
      expect(toast.error).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain('网络请求失败');
      expect(document.body.textContent).not.toContain('HD 高清任务创建失败，请重试');
      // 新面板保留且可用、原参数（lastParams 4k）保留，未被旧失败关闭或重置
      expect(panelSend()).toBeTruthy();
      expect(panelSend()!.disabled).toBe(false);
      expect(panelResolution('4k')!.className).toContain('resolutionBtnActive');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('新会话 B 等待中旧 A 的 HTTP 422：不触发 HTTP 默认提示，也不解 B 的锁，参数保留', async () => {
      seedDoc('failed');
      let resolveA!: (value: Response) => void;
      fetchMock
        .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveA = resolve; }))
        .mockImplementationOnce(() => new Promise<Response>(() => {}));   // B 永挂
      await renderPage();
      await openHdPanel();
      await mountCard('h1');
      await clickCardRetry();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await act(async () => { panelClose()!.click(); });
      await openHdPanel();
      await clickPanelResolution('2k');
      await act(async () => { panelSend()!.click(); });   // B 受理（fetch#2 挂起）
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(panelSend()!.disabled).toBe(true);           // B 在途只读

      // 旧 A 以 HTTP 422 迟到：默认 toast 不得先于会话归属判断触发
      await act(async () => { resolveA(jsonEnvelope(422, '分辨率档不可用', 422)); });
      await settle();

      expect(toast.error).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain('分辨率档不可用');
      expect(document.body.textContent).not.toContain('HD 高清任务创建失败，请重试');
      // B 的锁不被旧收尾解除：仍只读、再点不产生 C
      expect(panelSend()!.disabled).toBe(true);
      await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(panelResolution('2k')!.className).toContain('resolutionBtnActive');
    });

    it('对照：当前有效重试 HTTP 422 保留原有提示（sonner 一条 + 页面文案），无重复', async () => {
      seedDoc('failed');
      fetchMock.mockImplementationOnce(async () => jsonEnvelope(422, '分辨率档不可用', 422));
      await renderPage();
      await openHdPanel();
      await mountCard('h1');
      await clickCardRetry();
      await settle();

      expect(toast.error).toHaveBeenCalledTimes(1);
      expect(toast.error).toHaveBeenCalledWith('分辨率档不可用');
      expect(document.body.textContent).toContain('分辨率档不可用');
      // 创建失败限制解除（IKJP8Q 既有），面板恢复可操作
      expect(panelSend()!.disabled).toBe(false);
    });

    it('对照：当前有效重试 401 保持原有静默，不新增提示', async () => {
      seedDoc('failed');
      fetchMock.mockImplementationOnce(async () => jsonEnvelope(401, '请重新登录', 401));
      await renderPage();
      await openHdPanel();
      await mountCard('h1');
      await clickCardRetry();
      await settle();

      expect(toast.error).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain('请重新登录');
      expect(document.body.textContent).not.toContain('HD 高清任务创建失败，请重试');
    });
  });

  /* IKJPM7 修订：会话归属探针语义补齐——探针失效只随同卡显式关闭重开（后来新会话）或
     项目切换；他卡另一工具面板的打开（场景 ii，违反决策 6/US18）与纯显式关闭未重开
     （父级裁定边界）都不得吞掉当前有效请求 A 的失败提示。 */
  describe('IKJPM7 修订：探针不过度失效（他工具打开与纯关闭）', () => {
    it('场景ii：A 重试等待时打开另一张卡的另一工具面板（插帧）：A 失败提示保留，创建总数 1', async () => {
      seedDoc('failed');
      let rejectA!: (error: unknown) => void;
      apiMocks.createVideoEnhancement.mockImplementationOnce(() => new Promise<never>((_, reject) => { rejectA = reject; }));
      await renderPage();
      await openHdPanel();
      await mountCard('h1');
      await clickCardRetry();
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

      // 另一张卡（源卡 v1）的另一工具（插帧）面板打开：HD 面板被排他关闭，同卡无后来会话
      await act(async () => {
        ((mediaNode('v1').data as Record<string, unknown>).onFrameInterpolation as (id: string) => void)('v1');
      });
      expect(panelSend()).toBeNull();

      await act(async () => {
        rejectA(new Error('network down'));
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(document.body.textContent).toContain('HD 高清任务创建失败，请重试');
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    });

    it('边界（父级裁定）：A 重试等待→纯显式关闭未重开：A 失败仍按当前有效请求保留提示', async () => {
      seedDoc('failed');
      let rejectA!: (error: unknown) => void;
      apiMocks.createVideoEnhancement.mockImplementationOnce(() => new Promise<never>((_, reject) => { rejectA = reject; }));
      await renderPage();
      await openHdPanel();
      await mountCard('h1');
      await clickCardRetry();
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

      // 纯显式关闭（X）、不重开：无后来会话，A 仍是当前有效请求
      await act(async () => { panelClose()!.click(); });
      expect(panelSend()).toBeNull();

      await act(async () => {
        rejectA(new Error('network down'));
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(document.body.textContent).toContain('HD 高清任务创建失败，请重试');
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    });
  });

  /* IKJPXN 换目标会话隔离（决策 5、Testing 4）：同种 HD 工具从 h1 直接切到 h2 即新会话
     归属——旧 h1 重试 A 的失败（网络错误 / HTTP 422）不向 h2 新 HD 会话提示，h2 面板、
     参数与自身提交锁保持，请求次数不增加。接缝同 IKJPM7：真实创建客户端与 HTTP 错误
     处理保留，受控外部响应仅在 fetch 边界注入。 */
  describe('IKJPXN 换目标会话隔离旧重试失败提示（真实创建客户端与 HTTP 链）', () => {
    const { fetchMock, jsonEnvelope, settle } = setupRealCreateClient();

    it('h1 重试 A 等待时直接打开 h2：A 网络失败不提示到新 HD 会话，h2 面板与参数保持', async () => {
      seedDoc('twoFailed');
      let rejectA!: (error: unknown) => void;
      fetchMock.mockImplementationOnce(() => new Promise<Response>((_, reject) => { rejectA = reject; }));
      await renderPage();
      await openHdPanel('h1');
      await mountCard('h1');
      await clickCardRetry();
      expect(fetchMock).toHaveBeenCalledTimes(1);   // A 受理：h1 lastParams（4k）原样重发

      // 同种 HD 工具直接换目标：h1 面板切到 h2 = 新会话（未发送）
      await openHdPanel('h2');
      expect(panelResolution('2k')!.className).toContain('resolutionBtnActive');
      expect(panelSend()!.disabled).toBe(false);

      await act(async () => { rejectA(new TypeError('Failed to fetch')); });
      await settle();

      // 旧 A 网络失败全链路静默：HTTP 层默认 toast（sonner）与页面 toast 都不出现
      expect(toast.error).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain('网络请求失败');
      expect(document.body.textContent).not.toContain('HD 高清任务创建失败，请重试');
      // h2 新会话面板与参数保持、未被旧失败关闭或重置；h1 卡与参数不被旧失败改动；不新增请求
      expect(panelSend()).toBeTruthy();
      expect(panelSend()!.disabled).toBe(false);
      expect(panelResolution('2k')!.className).toContain('resolutionBtnActive');
      expect((mediaNode('h1').data as Record<string, unknown>).genStatus).toBe('failed');
      expect(identityOf(mediaNode('h1'))).toEqual({ sourceAssetId: '5', lastParams: { resolution: '4k' } });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('h2 已发送 B 仍等待时旧 A 以 HTTP 422 返回：不触发 HTTP 默认提示，h2 锁与请求次数保持', async () => {
      seedDoc('twoFailed');
      let resolveA!: (value: Response) => void;
      fetchMock
        .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveA = resolve; }))
        .mockImplementationOnce(() => new Promise<Response>(() => {}));   // B 永挂
      await renderPage();
      await openHdPanel('h1');
      await mountCard('h1');
      await clickCardRetry();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // 换目标打开 h2 并发送 B（fetch#2 挂起）：h2 自身提交锁生效
      await openHdPanel('h2');
      await act(async () => { panelSend()!.click(); });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // B 的创建输入按 h2 冻结（源素材与目标卡、分辨率档 2k）
      expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
        source_asset_id: '5', target_node_id: 'h2', resolution: '2k',
        canvas_binding: expect.objectContaining({ protocol_version: 1, target_node_id: 'h2', submission_id: expect.any(String) }),
      });
      expect(panelSend()!.disabled).toBe(true);

      // 旧 A 以 HTTP 422 迟到：默认 toast 不得先于会话归属判断触发
      await act(async () => { resolveA(jsonEnvelope(422, '分辨率档不可用', 422)); });
      await settle();

      expect(toast.error).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain('分辨率档不可用');
      expect(document.body.textContent).not.toContain('HD 高清任务创建失败，请重试');
      // B 的锁不被旧收尾解除：仍只读、再点不产生第三次请求；h2 参数保持
      expect(panelSend()!.disabled).toBe(true);
      await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(panelResolution('2k')!.className).toContain('resolutionBtnActive');
    });
  });

  /* IKJPXM：可见同卡重入保留当前有效失败反馈（决策 3、Testing 2/3/6）。真实链：
     页面 FlowCanvas 仍为打桩透出，另挂真实 ReactFlow 实例——MediaNode 经真实
     NodeWrapper 渲染，点击与选择通知按 ReactFlow 自有顺序转发回页面回调，不以自造
     监听串联替代。jsdom 不起布局：节点测量用既定桩（textNodeCard.test.tsx 同款）。 */
  describe('IKJPXM 可见同卡重入保留失败反馈（真实 NodeWrapper 事件链）', () => {
    let realFlowRoot: Root | null = null;
    let realFlowHost: HTMLDivElement | null = null;
    let syncRealFlow: (() => void) | null = null;
    let measureSpies: Array<{ mockRestore(): void }> = [];
    const realFlowNodeTypes = { mediaNode: MediaNode };

    function RealFlowBridge() {
      const [nodes, setNodes] = useState<Node[]>(() => flowProps.current.mediaNodes);
      syncRealFlow = () => setNodes([...mediaNodes()]);
      return createElement(ReactFlow, {
        nodes,
        edges: [],
        nodeTypes: realFlowNodeTypes,
        onNodesChange: (changes: Parameters<typeof applyNodeChanges>[0]) =>
          setNodes((current) => applyNodeChanges(changes, current)),
        onNodeClick: (_event: unknown, node: Node) => {
          flowProps.current.onNodeClick(mediaNodes().find((n) => n.id === node.id) ?? node);
        },
        onSelectionChange: ({ nodes: selected }: { nodes: Node[] }) => {
          flowProps.current.onSelectionChange({
            nodes: selected.map((s) => mediaNodes().find((n) => n.id === s.id) ?? s),
          });
        },
      });
    }

    async function mountRealFlow() {
      realFlowHost = document.createElement('div');
      document.body.appendChild(realFlowHost);
      realFlowRoot = createRoot(realFlowHost);
      await act(async () => { realFlowRoot!.render(createElement(RealFlowBridge)); });
    }

    /** 真实 NodeWrapper 点击：先把页面最新节点数据同步进真实画布，再派发真实 click */
    async function realClickNode(id: string) {
      await act(async () => { syncRealFlow?.(); });
      const el = realFlowHost!.querySelector(`.react-flow__node[data-id="${id}"]`);
      expect(el).toBeTruthy();
      await act(async () => {
        el!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
    }

    beforeEach(() => {
      // jsdom 无这些浏览器测量 API；React Flow 真实实现靠它们初始化与测量节点
      vi.stubGlobal('ResizeObserver', class {
        callback: ResizeObserverCallback;
        constructor(cb: ResizeObserverCallback) { this.callback = cb; }
        observe(target: Element) {
          this.callback(
            [{ target, contentRect: { width: 1000, height: 800 } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
        }
        unobserve() {}
        disconnect() {}
      });
      vi.stubGlobal('DOMMatrixReadOnly', class {
        m22: number;
        constructor(transform?: string) {
          const scale = transform?.match(/scale\(([1-9.])\)/)?.[1];
          this.m22 = scale !== undefined ? +scale : 1;
        }
      });
      measureSpies = [
        vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1000),
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(800),
      ];
    });

    afterEach(async () => {
      if (realFlowRoot) await act(async () => realFlowRoot!.unmount());
      realFlowHost?.remove();
      realFlowRoot = null;
      realFlowHost = null;
      syncRealFlow = null;
      measureSpies.forEach((spy) => spy.mockRestore());
      measureSpies = [];
      vi.unstubAllGlobals();
    });

    it('初值 4K 改 2K 发送 B 等待，真实点击当前可见同卡：B 失败仍显示原有原因，参数保留、创建仅一次、失败后恢复操作', async () => {
      seedDoc('failed');
      let rejectB!: (error: unknown) => void;
      apiMocks.createVideoEnhancement.mockImplementationOnce(
        () => new Promise<{ job_id: string; status: 'queued' }>((_, reject) => { rejectB = reject; }),
      );
      await renderPage();
      await openHdPanel();
      expect(panelResolution('4k')!.className).toContain('resolutionBtnActive');
      await clickPanelResolution('2k');
      await act(async () => { panelSend()!.click(); });
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
      expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
        source_asset_id: '5', target_node_id: 'h1', resolution: '2k',
      }, expect.objectContaining({ silent: true }));

      // B 等待期间真实 NodeWrapper 点击当前可见同卡：面板保留、2K 参数保留、在途只读、不新增创建
      await mountRealFlow();
      await realClickNode('h1');
      expect(panelSend()).toBeTruthy();
      expect(panelSend()!.disabled).toBe(true);
      expect(panelResolution('2k')!.className).toContain('resolutionBtnActive');
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

      // B 失败：原有失败原因仍显示；随后恢复可操作
      await act(async () => {
        rejectB(new Error('network down'));
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(document.body.textContent).toContain('HD 高清任务创建失败，请重试');
      expect(panelSend()!.disabled).toBe(false);
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    });

    it('对照：未改参数时可见同卡多次真实重入，当前有效失败提示同样保留', async () => {
      seedDoc('failed');
      let rejectB!: (error: unknown) => void;
      apiMocks.createVideoEnhancement.mockImplementationOnce(
        () => new Promise<{ job_id: string; status: 'queued' }>((_, reject) => { rejectB = reject; }),
      );
      await renderPage();
      await openHdPanel();
      await act(async () => { panelSend()!.click(); });   // 按初值 4K 直接发送
      expect(apiMocks.createVideoEnhancement).toHaveBeenLastCalledWith('p1', {
        source_asset_id: '5', target_node_id: 'h1', resolution: '4k',
      }, expect.objectContaining({ silent: true }));

      await mountRealFlow();
      await realClickNode('h1');
      await realClickNode('h1');
      expect(panelSend()!.disabled).toBe(true);
      expect(panelResolution('4k')!.className).toContain('resolutionBtnActive');

      await act(async () => {
        rejectB(new Error('network down'));
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(document.body.textContent).toContain('HD 高清任务创建失败，请重试');
      expect(panelSend()!.disabled).toBe(false);
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    });

    /* IKJPXF 评审修订（Testing 决策 6）：点其他卡与点回原卡都走真实 NodeWrapper——
       真实桥挂载含 v1 的全部节点，点击经 ReactFlow 自有事件顺序转发回页面回调，
       不以直接调 onSelectionChange 替代真实手势。 */
    it('选择隐藏（含空选中过渡）：真实点击其他卡隐藏面板、真实点回原卡恢复——参数与在途只读保留、无额外创建，A 失败反馈仍保留', async () => {
      seedDoc('failed');
      let rejectA!: (error: unknown) => void;
      apiMocks.createVideoEnhancement.mockImplementationOnce(
        () => new Promise<{ job_id: string; status: 'queued' }>((_, reject) => { rejectA = reject; }),
      );
      await renderPage();
      await openHdPanel();
      await clickPanelResolution('2k');
      await mountCard('h1');
      await clickCardRetry();
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

      // 真实 NodeWrapper 点击其他卡（v1）：真实画布确含 v1 卡，选择切换经真实桥隐藏面板
      await mountRealFlow();
      expect(realFlowHost!.textContent).toContain('素材视频');
      await realClickNode('v1');
      expect(panelSend()).toBeNull();
      // 空选中过渡不当显式关闭
      await act(async () => { flowProps.current.onSelectionChange({ nodes: [] }); });

      // 真实 NodeWrapper 点回原卡：恢复同一会话，最新参数与按宿主在途只读保留
      await realClickNode('h1');
      expect(panelSend()).toBeTruthy();
      expect(panelSend()!.disabled).toBe(true);
      expect(panelResolution('2k')!.disabled).toBe(true);
      expect(panelResolution('2k')!.className).toContain('resolutionBtnActive');
      await act(async () => { panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);

      // A 是恢复会话的当前有效请求（US19）：其失败反馈保留，创建总数不变
      await act(async () => {
        rejectA(new Error('network down'));
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(document.body.textContent).toContain('HD 高清任务创建失败，请重试');
      expect(apiMocks.createVideoEnhancement).toHaveBeenCalledTimes(1);
    });
  });
});
