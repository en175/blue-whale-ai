// @vitest-environment jsdom
/* IKH28U 骨架 / IKH28X 发送闭环（画布链路）：点击「音视频分离」（原提取音频一键直发入口
   退役）进入编辑态而非建任务；splitEditing/soloToolbarHidden 渲染期注入（视频暂停与播放
   控制锁定由 MediaNode 承担，见 MediaNode/index.test.tsx）；上条仅 X + 下条三要素发送条
   （格式下拉/本期免费/发送钮）；与其他工具编辑会话互斥（去字幕先例口径）；四退出
   （X/Esc/点其他卡/点画布空白）未发送无痕迹——无卡无边无任务。发送闭环（IKH28X）：
   按所选格式建任务、先退编辑态再建占位卡、来源边 origin=media-extract、轮询终态收敛
   （成功成卡/失败可读文案）、失败带身份卡原参数重试、格式不跨会话。渲染模式沿用
   videoSubtitleEraseEdit.test.tsx（FlowCanvas 打桩透出 props）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { MEDIA_EXTRACT_EDGE_ORIGIN } from './mediaExtract';
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
    async (): Promise<{ id: number; project_id: number; version: number; viewport: string; nodes: string }> => ({
      id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]',
    }),
  ),
  createGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createMediaExtraction: vi.fn(),
  createVideoSubtitleErase: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
  uploadAssetFile: vi.fn(),
}));

vi.mock('@/api/projects', () => ({
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
  createMediaExtraction: apiMocks.createMediaExtraction,
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

/** 进入音视频分离编辑态（视频卡工具条「音视频分离」按钮派发的回调，IKH28U 挂点） */
async function enterSplit() {
  const video = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!;
  await act(async () => {
    video.data.onAudioVideoSplit('v1');
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

function toolbar(): HTMLElement | null {
  return document.body.querySelector('[data-testid="audio-video-split-toolbar"]');
}

/** 编辑态内选格式（展开下拉点选项） */
async function selectFormat(format: string) {
  await click('audio-video-split-format-trigger');
  await click(`audio-video-split-format-item-${format}`);
}

/** 编辑态内点发送（startAudioVideoSplitJob 含 await 创建，等 50ms 让建卡与轮询首 tick 发起） */
async function sendSplit() {
  await click('audio-video-split-send-btn');
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
  apiMocks.createMediaExtraction.mockReset();
  apiMocks.createVideoSubtitleErase.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKH28U 编辑态呈现（进入不建任务）', () => {
  it('进入编辑态：上条仅 X、下条三要素发送条（格式 M4A/本期免费/发送钮）；splitEditing 与 soloToolbarHidden 注入源卡；不建任务不建卡', async () => {
    await renderPage();
    await enterSplit();
    expect(toolbar()).toBeTruthy();
    expect(bodyBtn('audio-video-split-close')).toBeTruthy();
    const sendBar = document.body.querySelector('[data-testid="audio-video-split-send-bar"]')!;
    // 三要素（IKH28X）：格式触发钮显当前格式（默认 M4A）+ 本期免费 + 发送钮
    expect(bodyBtn('audio-video-split-format-trigger').textContent).toBe('M4A');
    expect(sendBar.textContent).toContain('本期免费');
    expect(bodyBtn('audio-video-split-send-btn')).toBeTruthy();
    // 源视频卡注入 splitEditing（视频暂停+锁定层）与 soloToolbarHidden（会话模态口径）
    expect(v1Data().splitEditing).toBe(true);
    expect(v1Data().soloToolbarHidden).toBe(true);
    // 进入即编辑态：不创建任务、不建占位卡、不连边
    expect(apiMocks.createMediaExtraction).not.toHaveBeenCalled();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('与其他工具编辑会话互斥：去字幕编辑态中点音视频分离，去字幕浮条退出、分离浮条接管', async () => {
    await renderPage();
    const video = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!;
    await act(async () => {
      video.data.onVideoSubtitleErase('v1');
    });
    expect(document.body.querySelector('[data-testid="subtitle-erase-toolbar"]')).toBeTruthy();
    await enterSplit();
    expect(document.body.querySelector('[data-testid="subtitle-erase-toolbar"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="subtitle-erase-send-bar"]')).toBeNull();
    expect(toolbar()).toBeTruthy();
    expect(v1Data().splitEditing).toBe(true);
    // 去字幕未发送无痕迹：反向互斥——分离态中点去字幕，分离浮条退出
    await act(async () => {
      video.data.onVideoSubtitleErase('v1');
    });
    expect(toolbar()).toBeNull();
    expect(v1Data().splitEditing).toBeUndefined();
  });
});

describe('IKH28U 四退出：未发送退出画布无痕迹', () => {
  it('X 退出：无卡、无边、无任务、编辑标记移除（播放控制恢复）', async () => {
    await renderPage();
    await enterSplit();
    await click('audio-video-split-close');
    expect(toolbar()).toBeNull();
    expect(v1Data().splitEditing).toBeUndefined();
    expect(v1Data().soloToolbarHidden).toBeUndefined();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
    expect(apiMocks.createMediaExtraction).not.toHaveBeenCalled();
  });

  it('Esc 退出：同口径无痕迹', async () => {
    await renderPage();
    await enterSplit();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('点其他卡退出（单选非目标）；空选中不退出', async () => {
    await renderPage();
    await enterSplit();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [{ id: 'other' }] });
    });
    expect(toolbar()).toBeNull();
    // 空选中不退出（真空白由 PaneClick 承担）
    await enterSplit();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [] });
    });
    expect(toolbar()).not.toBeNull();
  });

  it('点画布空白退出（PaneClick）', async () => {
    await renderPage();
    await enterSplit();
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });
});

describe('IKH28U 会话口径（!743 体系接入）', () => {
  it('重复进入幂等：退出再进入标记干净（无残留编辑态）', async () => {
    await renderPage();
    await enterSplit();
    await click('audio-video-split-close');
    expect(v1Data().splitEditing).toBeUndefined();
    await enterSplit();
    expect(v1Data().splitEditing).toBe(true);
    expect(toolbar()).toBeTruthy();
  });
});

describe('IKH28X 发送闭环（建任务→占位卡→终态→重试）', () => {
  it('发送（默认 m4a）：按所选格式建任务、先退编辑态再建占位卡、来源边 origin=media-extract、展示名跟随格式', async () => {
    apiMocks.createMediaExtraction.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterSplit();
    await sendSplit();
    // 建任务带所选格式（默认 m4a）
    expect(apiMocks.createMediaExtraction).toHaveBeenCalledWith('p1', { source_asset_id: '5', output_format: 'm4a' });
    // 先退编辑态再建卡：浮条卸载、splitEditing 移除、占位卡已上画布
    expect(toolbar()).toBeNull();
    expect(v1Data().splitEditing).toBeUndefined();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    const audio = nodeById('media-extract-j1')!;
    expect(audio.data.fileName).toBe('素材视频(audio).m4a');
    // 占位卡带身份（lastInput 冻结源素材+格式，失败重试原样重发）
    expect(audio.data.mediaExtract).toEqual({
      sourceAssetId: '5',
      lastInput: { source_asset_id: '5', output_format: 'm4a' },
    });
    // 来源边：参考推导跳过口径（origin 标记）
    const edge = (flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>)
      .find((e) => e.target === 'media-extract-j1')!;
    expect(edge.source).toBe('v1');
    expect(edge.data).toEqual({ origin: MEDIA_EXTRACT_EDGE_ORIGIN });
  });

  it('切换格式后发送：任务参数与占位卡展示名跟随所选格式（所见即所得）；未发送退出重进格式复位 m4a', async () => {
    apiMocks.createMediaExtraction.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterSplit();
    await selectFormat('wav');
    expect(bodyBtn('audio-video-split-format-trigger').textContent).toBe('WAV');
    // 未发送退出重进：格式不跨会话记忆，复位 m4a
    await click('audio-video-split-close');
    await enterSplit();
    expect(bodyBtn('audio-video-split-format-trigger').textContent).toBe('M4A');
    // 重选 wav 后发送：任务参数与占位卡展示名所见即所得
    await selectFormat('wav');
    await sendSplit();
    expect(apiMocks.createMediaExtraction).toHaveBeenCalledTimes(1);
    expect(apiMocks.createMediaExtraction).toHaveBeenCalledWith('p1', { source_asset_id: '5', output_format: 'wav' });
    expect(nodeById('media-extract-j1')!.data.fileName).toBe('素材视频(audio).wav');
  });

  it('创建失败（网络）：不建卡不退编辑态，停留可调格式后重发', async () => {
    apiMocks.createMediaExtraction.mockRejectedValue(new Error('network down'));
    await renderPage();
    await enterSplit();
    await sendSplit();
    expect(apiMocks.createMediaExtraction).toHaveBeenCalledTimes(1);
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
    // 编辑态保留（浮条仍在），submitting 已复位（发送钮可再点）
    expect(toolbar()).not.toBeNull();
    expect(bodyBtn('audio-video-split-send-btn').disabled).toBe(false);
  });

  it('轮询终态 succeeded：占位卡收敛为成品音频卡（src/assetId 回填、进度 100、展示名保留）', async () => {
    apiMocks.createMediaExtraction.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j1', status: 'succeeded', progress: 100,
      asset: { id: 'a88', url: 'http://tos/x.m4a', type: 'audio', duration: 65.5 },
    });
    await renderPage();
    await enterSplit();
    await sendSplit();
    const audio = nodeById('media-extract-j1')!;
    expect(audio.data.genStatus).toBeUndefined();
    expect(audio.data.progress).toBe(100);
    expect(audio.data.src).toBe('http://tos/x.m4a');
    expect(audio.data.assetId).toBe('a88');
    // 时长取服务端权威值（story 15，火山返回 duration 经终态补丁落卡）
    expect(audio.data.duration).toBe(65.5);
    // 展示名保留建卡所选格式的后缀（不被「生成-{jobId}」自动命名覆盖）
    expect(audio.data.fileName).toBe('素材视频(audio).m4a');
  });

  it('轮询终态 failed：1044 火山兜底码映射可读文案；带身份卡原参数重试建新任务并收敛成品', async () => {
    apiMocks.createMediaExtraction.mockResolvedValueOnce({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j1', status: 'failed', progress: 1,
      error: { code: 'media_extract_provider_failed', msg: '' },
    });
    await renderPage();
    await enterSplit();
    await sendSplit();
    const failed = nodeById('media-extract-j1')!;
    expect(failed.data.genStatus).toBe('failed');
    // W 票错误码面：media_extract_provider_failed（1044）→「音频提取失败，请重试」
    expect(failed.data.errorText).toBe('音频提取失败，请重试');

    // 重试：lastInput（源素材+格式）原样重发创建接口（新 job），轮询 succeeded 收敛成品
    apiMocks.createMediaExtraction.mockResolvedValueOnce({ job_id: 'j2', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j2', status: 'succeeded', progress: 100,
      asset: { id: 'a89', url: 'http://tos/y.m4a', type: 'audio' },
    });
    await act(async () => {
      (failed.data.onRetryJob as (id: string) => void)('media-extract-j1');
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(apiMocks.createMediaExtraction).toHaveBeenLastCalledWith('p1', { source_asset_id: '5', output_format: 'm4a' });
    const retried = nodeById('media-extract-j1')!;
    expect(retried.data.jobId).toBe('j2');
    expect(retried.data.genStatus).toBeUndefined();
    expect(retried.data.src).toBe('http://tos/y.m4a');
  });
});
