// @vitest-environment jsdom
/* IKHA2W 人声背景分离编辑态与占位卡（画布链路）：「音视频分离 ▾」下拉第二项派发
   onVocalBackgroundSplit 进入第七工具编辑会话；splitEditing/soloToolbarHidden 渲染期
   注入（视频暂停与播放控制锁定由 MediaNode 承担）；上条仅 X + 下条发送条（场景下拉/
   格式下拉/本期免费/发送钮）；与既有六会话互斥（去字幕/音视频分离先例口径）；四退出
   （X/Esc/点其他卡/点画布空白）未发送无痕迹。发送闭环：按所选场景与格式建任务、
   先退编辑态再建占位卡（vocal-split-{job_id}）、来源边 origin=vocal-split、立即落盘
   （刷新不丢）、轮询终态收敛（failed 可读文案/成功停生成中，扇出归 IKHA30）、失败带
   身份卡按 lastInput 三键原样重试、参数不跨会话记忆、同一视频可连续多次发送。
   渲染模式沿用 audioVideoSplitEdit.test.tsx（FlowCanvas 打桩透出 props）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { VOCAL_SPLIT_EDGE_ORIGIN } from './vocalSplit';
import type { GenerationModel } from '@/api/generation';

vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

/** FlowCanvas 打桩：透出 props 供测试读取节点与触发画布回调 */
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
    async (
      _projectId: string,
      _payload: { nodes: Array<{ id: string }>; edges: Array<{ source: string; target: string; data?: unknown }> },
      _version: number | null,
    ): Promise<{ id: number; project_id: number; version: number; viewport: string; nodes: string }> => ({
      id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]',
    }),
  ),
  createGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createVocalSplit: vi.fn(),
  createVideoSubtitleErase: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
  uploadAssetFile: vi.fn(),
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
    JSON.stringify(edges.map((e) => JSON.parse(JSON.stringify(e)))),
  ),
}));
vi.mock('@/api/jobs', () => ({
  createGenerationJob: apiMocks.createGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createVideoEnhancement: apiMocks.createVideoEnhancement,
  createMediaExtraction: apiMocks.createMediaExtraction,
  createVocalSplit: apiMocks.createVocalSplit,
  createVideoSubtitleErase: apiMocks.createVideoSubtitleErase,
  readJobFailText: apiMocks.readJobFailText,
}));
vi.mock('@/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/api/generation', () => ({ fetchGenerationModels: apiMocks.fetchGenerationModels }));
vi.mock('@/utils/upload', () => ({ uploadAssetFile: apiMocks.uploadAssetFile }));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('./hooks/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

/** 画布：一个就绪视频节点 v1（1920×1080 mp4，assetId 满足置灰门槛；无连线） */
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
            width: 1920,
            height: 1080,
            duration: 30,
            mime: 'video/mp4',
          },
        },
      ],
      edges: [],
    },
    assets: { 5: { asset_id: 5, type: 'video', access_url: 'http://vid/v1.mp4', width: 1920, height: 1080 } },
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

/** 进入人声背景分离编辑态（「音视频分离 ▾」下拉第二项派发的回调，IKHA2E 挂点/IKHA2W 接线） */
async function enterVocal() {
  const video = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!;
  await act(async () => {
    video.data.onVocalBackgroundSplit('v1');
  });
}

function v1Data(): Record<string, unknown> {
  const video = (flowProps.current.mediaNodes as Node[]).find((n) => n.id === 'v1')!;
  return video.data as Record<string, unknown>;
}

function bodyBtn(testId: string): HTMLButtonElement {
  return document.body.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;
}

async function click(testId: string) {
  await act(async () => {
    bodyBtn(testId).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 编辑态单条探针（单条化后上方工具条退役；X 关闭随单条卸载——出现=会话活跃、消失=已退出） */
function toolbar(): HTMLElement | null {
  return document.body.querySelector('[data-testid="vocal-split-close"]');
}

function sendBar(): HTMLElement | null {
  return document.body.querySelector('[data-testid="vocal-split-send-bar"]');
}

/** 编辑态内选场景/选格式（展开下拉点选项） */
async function selectScene(scene: string) {
  await click('vocal-split-scene-trigger');
  await click(`vocal-split-scene-item-${scene}`);
}

async function selectFormat(format: string) {
  await click('vocal-split-format-trigger');
  await click(`vocal-split-format-item-${format}`);
}

/** 编辑态内点发送（startVocalSplitJob 含 await 创建，等 50ms 让建卡与轮询首 tick 发起） */
async function sendVocal() {
  await click('vocal-split-send-btn');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

function nodeById(id: string): Node | undefined {
  return (flowProps.current.mediaNodes as Node[]).find((n) => n.id === id);
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiMocks.createVocalSplit.mockReset();
  apiMocks.createMediaExtraction.mockReset();
  apiMocks.createVideoSubtitleErase.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKHA2W 编辑态呈现（进入不建任务）', () => {
  it('进入编辑态：单条（X 关闭在最左）+ 发送条要素（场景默认通用/格式默认 AAC/本期免费/发送钮）；splitEditing 与 soloToolbarHidden 注入源卡；不建任务不建卡', async () => {
    await renderPage();
    await enterVocal();
    const close = bodyBtn('vocal-split-close');
    const bar = sendBar()!;
    // 单条化后 X 在 sendBar 内且是第一个元素（对齐抠图/音视频分离单条先例）
    expect(bar.contains(close)).toBe(true);
    expect(bar.querySelector('button')).toBe(close);
    expect(bodyBtn('vocal-split-scene-trigger').textContent).toBe('通用');
    expect(bodyBtn('vocal-split-format-trigger').textContent).toBe('AAC');
    expect(bar.textContent).toContain('本期免费');
    expect(bodyBtn('vocal-split-send-btn')).toBeTruthy();
    // 源视频卡注入 splitEditing（视频暂停+锁定层）与 soloToolbarHidden（会话模态口径）
    expect(v1Data().splitEditing).toBe(true);
    expect(v1Data().soloToolbarHidden).toBe(true);
    // 进入即编辑态：不创建任务、不建占位卡、不连边
    expect(apiMocks.createVocalSplit).not.toHaveBeenCalled();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('与音视频分离会话互斥（下拉第一项↔第二项互为替代会话）：分离态中点人声分离，分离浮条退出、人声浮条接管；反向亦然', async () => {
    await renderPage();
    const video = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!;
    await act(async () => {
      video.data.onAudioVideoSplit('v1');
    });
    expect(document.body.querySelector('[data-testid="audio-video-split-send-bar"]')).toBeTruthy();
    await enterVocal();
    expect(document.body.querySelector('[data-testid="audio-video-split-send-bar"]')).toBeNull();
    expect(sendBar()).toBeTruthy();
    expect(v1Data().splitEditing).toBe(true);
    // 反向互斥：人声态中点音视频分离，人声浮条退出、分离浮条接管
    await act(async () => {
      video.data.onAudioVideoSplit('v1');
    });
    expect(toolbar()).toBeNull();
    expect(sendBar()).toBeNull();
    expect(v1Data().splitEditing).toBe(true);
    expect(document.body.querySelector('[data-testid="audio-video-split-send-bar"]')).toBeTruthy();
  });

  it('与去字幕会话互斥：去字幕单条先退出、人声浮条接管', async () => {
    await renderPage();
    const video = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!;
    await act(async () => {
      video.data.onVideoSubtitleErase('v1', 'smart');
    });
    expect(document.body.querySelector('[data-testid="subtitle-erase-send-bar"]')).toBeTruthy();
    await enterVocal();
    expect(document.body.querySelector('[data-testid="subtitle-erase-send-bar"]')).toBeNull();
    expect(sendBar()).toBeTruthy();
  });
});

describe('IKHA2W 四退出：未发送退出画布无痕迹', () => {
  it('X 退出：无卡、无边、无任务、编辑标记移除（播放控制恢复）', async () => {
    await renderPage();
    await enterVocal();
    await click('vocal-split-close');
    expect(toolbar()).toBeNull();
    expect(v1Data().splitEditing).toBeUndefined();
    expect(v1Data().soloToolbarHidden).toBeUndefined();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
    expect(apiMocks.createVocalSplit).not.toHaveBeenCalled();
  });

  it('Esc 退出：同口径无痕迹', async () => {
    await renderPage();
    await enterVocal();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('点其他卡退出（单选非目标）', async () => {
    await renderPage();
    await enterVocal();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [{ id: 'other' }] });
    });
    expect(toolbar()).toBeNull();
    expect(v1Data().splitEditing).toBeUndefined();
  });

  it('点画布空白退出（PaneClick）', async () => {
    await renderPage();
    await enterVocal();
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });
});

describe('IKHA2W 发送闭环（建任务→占位卡→来源边→落盘）', () => {
  it('发送（默认通用/aac）：三键参数建任务、先退编辑态再建占位卡、来源边 origin=vocal-split、立即落盘（刷新不丢）', async () => {
    apiMocks.createVocalSplit.mockResolvedValue({ job_id: 'j701', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j701', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterVocal();
    await sendVocal();
    // 建任务带三键（缺省档显式携带：通用/aac）
    expect(apiMocks.createVocalSplit).toHaveBeenCalledWith('p1', {
      source_asset_id: '5', scene: 'audio', output_format: 'aac',
    });
    // 先退编辑态再建卡：浮条卸载、splitEditing 移除、占位卡已上画布
    expect(toolbar()).toBeNull();
    expect(v1Data().splitEditing).toBeUndefined();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    const audio = nodeById('vocal-split-j701')!;
    expect(audio.data.fileName).toBe('素材视频(人声背景分离)');
    expect(audio.data.mediaType).toBe('audio');
    expect(audio.data.genStatus).toBe('generating');
    // 占位卡带身份（lastInput 三键冻结源素材+场景+格式，失败重试原样重发）
    expect(audio.data.vocalSplit).toEqual({
      sourceAssetId: '5',
      lastInput: { source_asset_id: '5', scene: 'audio', output_format: 'aac' },
    });
    // 来源边：参考推导跳过口径（origin 标记）
    const edge = (flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>)
      .find((e) => e.target === 'vocal-split-j701')!;
    expect(edge.source).toBe('v1');
    expect(edge.data).toEqual({ origin: VOCAL_SPLIT_EDGE_ORIGIN });
    // 立刻落盘（best-effort，不等 800ms 防抖）：占位卡与来源边在同一次 PUT 里，刷新不丢
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    const savedNodes = apiMocks.saveCanvasDoc.mock.calls[0][1].nodes as Array<{ id: string }>;
    expect(savedNodes.map((n) => n.id)).toContain('vocal-split-j701');
    const savedEdges = apiMocks.saveCanvasDoc.mock.calls[0][1].edges as Array<{ target: string }>;
    expect(savedEdges.map((e) => e.target)).toContain('vocal-split-j701');
  });

  it('切换场景与格式后发送：任务参数与请求体跟随所选（所见即所得）；未发送退出重进参数复位默认', async () => {
    apiMocks.createVocalSplit.mockResolvedValue({ job_id: 'j702', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j702', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterVocal();
    await selectScene('drama');
    expect(bodyBtn('vocal-split-scene-trigger').textContent).toBe('短剧');
    await selectFormat('flac');
    expect(bodyBtn('vocal-split-format-trigger').textContent).toBe('FLAC');
    // 未发送退出重进：参数不跨会话记忆，复位 通用/aac
    await click('vocal-split-close');
    await enterVocal();
    expect(bodyBtn('vocal-split-scene-trigger').textContent).toBe('通用');
    expect(bodyBtn('vocal-split-format-trigger').textContent).toBe('AAC');
    // 重选 drama/flac 后发送：任务参数所见即所得
    await selectScene('drama');
    await selectFormat('flac');
    await sendVocal();
    expect(apiMocks.createVocalSplit).toHaveBeenCalledTimes(1);
    expect(apiMocks.createVocalSplit).toHaveBeenCalledWith('p1', {
      source_asset_id: '5', scene: 'drama', output_format: 'flac',
    });
    expect(nodeById('vocal-split-j702')!.data.vocalSplit).toEqual({
      sourceAssetId: '5',
      lastInput: { source_asset_id: '5', scene: 'drama', output_format: 'flac' },
    });
  });

  it('创建失败（网络）：不建卡不退编辑态，发送钮复位可重发', async () => {
    apiMocks.createVocalSplit.mockRejectedValue(new Error('network down'));
    await renderPage();
    await enterVocal();
    await sendVocal();
    expect(apiMocks.createVocalSplit).toHaveBeenCalledTimes(1);
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
    // 编辑态保留（浮条仍在），submitting 已复位（发送钮可再点）
    expect(toolbar()).not.toBeNull();
    expect(bodyBtn('vocal-split-send-btn').disabled).toBe(false);
  });

  it('同一视频连续多次发送（不同场景/格式）：各建各的任务与占位卡', async () => {
    apiMocks.createVocalSplit
      .mockResolvedValueOnce({ job_id: 'j710', status: 'queued' })
      .mockResolvedValueOnce({ job_id: 'j711', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterVocal();
    await selectFormat('mp3');
    await sendVocal();
    await enterVocal();
    await selectScene('music');
    await selectFormat('wav');
    await sendVocal();
    expect(apiMocks.createVocalSplit).toHaveBeenNthCalledWith(1, 'p1', {
      source_asset_id: '5', scene: 'audio', output_format: 'mp3',
    });
    expect(apiMocks.createVocalSplit).toHaveBeenNthCalledWith(2, 'p1', {
      source_asset_id: '5', scene: 'music', output_format: 'wav',
    });
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(3);
    expect(nodeById('vocal-split-j710')).toBeTruthy();
    expect(nodeById('vocal-split-j711')!.data.vocalSplit).toEqual({
      sourceAssetId: '5',
      lastInput: { source_asset_id: '5', scene: 'music', output_format: 'wav' },
    });
    // 两张占位卡各自一条来源边
    const targets = (flowProps.current.edges as Array<{ source: string; target: string }>)
      .filter((e) => e.source === 'v1').map((e) => e.target);
    expect(targets).toEqual(expect.arrayContaining(['vocal-split-j710', 'vocal-split-j711']));
  });
});

describe('IKHA2W 轮询终态与失败重试', () => {
  it('轮询终态 failed：错误码映射可读文案 + 重试钮；重试按 lastInput 三键原样重发建新任务', async () => {
    apiMocks.createVocalSplit.mockResolvedValueOnce({ job_id: 'j720', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j720', status: 'failed', progress: 1,
      error: { code: 'vocal_split_failed', msg: '' },
    });
    await renderPage();
    await enterVocal();
    await selectScene('narrate');
    await sendVocal();
    const failed = nodeById('vocal-split-j720')!;
    expect(failed.data.genStatus).toBe('failed');
    // W 票错误码面：vocal_split_failed（1047）→「人声背景分离失败，请重试」
    expect(failed.data.errorText).toBe('人声背景分离失败，请重试');

    // 重试：lastInput（源素材+场景+格式）原样重发创建接口（新 job），回到生成中并续轮询
    apiMocks.createVocalSplit.mockResolvedValueOnce({ job_id: 'j721', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({ job_id: 'j721', status: 'processing', progress: 2, asset: null });
    await act(async () => {
      (failed.data.onRetryJob as (id: string) => void)('vocal-split-j720');
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(apiMocks.createVocalSplit).toHaveBeenLastCalledWith('p1', {
      source_asset_id: '5', scene: 'narrate', output_format: 'aac',
    });
    const retried = nodeById('vocal-split-j720')!;
    expect(retried.data.jobId).toBe('j721');
    expect(retried.data.genStatus).toBe('generating');
    expect(retried.data.errorText).toBe('');
  });

  it('入队失败经轮询呈现：enqueue_failed 映射「任务入队失败，请重试」', async () => {
    apiMocks.createVocalSplit.mockResolvedValueOnce({ job_id: 'j730', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j730', status: 'failed', progress: 0,
      error: { code: 'enqueue_failed', msg: '' },
    });
    await renderPage();
    await enterVocal();
    await sendVocal();
    const failed = nodeById('vocal-split-j730')!;
    expect(failed.data.genStatus).toBe('failed');
    expect(failed.data.errorText).toBe('任务入队失败，请重试');
  });

  it('轮询终态 succeeded：本票最小处理 = 占位卡停生成中（progress 100、genStatus 清除），不回填成品不做扇出（归 IKHA30）', async () => {
    apiMocks.createVocalSplit.mockResolvedValueOnce({ job_id: 'j740', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j740', status: 'succeeded', progress: 100,
      asset: { id: 'a1', url: 'http://tos/voice.aac', type: 'audio' },
    });
    await renderPage();
    await enterVocal();
    await sendVocal();
    const settled = nodeById('vocal-split-j740')!;
    expect(settled.data.genStatus).toBeUndefined();
    expect(settled.data.progress).toBe(100);
    // 不提前实现扇出：占位卡保留原地，src/assetId 不回填
    expect(settled.data.src).toBe('');
    expect(settled.data.assetId).toBeUndefined();
  });
});
