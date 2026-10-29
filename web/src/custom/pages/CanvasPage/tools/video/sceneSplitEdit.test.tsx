// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../../index';
import { SCENE_SPLIT_EDGE_ORIGIN } from './sceneSplit';
import type { GenerationModel } from '@/custom/api/generation';

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
vi.mock('../../components/AgentPanel/index', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('../../components/Canvas/index', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

vi.mock('../../components/CanvasToolbar/index', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));

vi.mock('../../components/CanvasHeader/index', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));

vi.mock('../../components/ProjectSelector/index', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

vi.mock('@/custom/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/custom/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

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
      id: 11, project_id: 1, version: 5, viewport: '{}', nodes: '[]',
    }),
  ),
  createGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createVideoSubtitleErase: vi.fn(),
  createVideoSceneSplit: vi.fn(),
  newIdempotencyKey: vi.fn(() => `token-${(++idempotencySeq).toString().padStart(2, '0')}`),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
  uploadAssetFile: vi.fn(),
}));

let idempotencySeq = 0;

vi.mock('@/custom/api/projects', () => ({
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
}));
vi.mock('@/custom/api/auth', () => ({
  fetchMe: apiMocks.fetchMe,
  fetchCredits: apiMocks.fetchCredits,
  toSessionUser: apiMocks.toSessionUser,
}));
vi.mock('@/custom/api/assets', () => ({
  UPLOAD_SIZE_LIMIT: 100 * 1024 * 1024,
  fetchUploadPresign: vi.fn(),
  putToPresignedUrl: vi.fn(),
  completeUpload: vi.fn(),
  fetchAllAssets: vi.fn(async () => []),
  fetchAssetDetail: vi.fn(),
  linkAssetToProject: vi.fn(),
}));

vi.mock('@/custom/api/canvas', () => ({
  applyPromptPreview: apiMocks.applyPromptPreview,
  createConversationQuote: vi.fn(),
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn((edges: Array<{ id: string; source: string; target: string }>) =>
    JSON.stringify(edges.map((e) => JSON.parse(JSON.stringify(e)))),
  ),
}));
vi.mock('@/custom/api/jobs', () => ({
  createGenerationJob: apiMocks.createGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createVideoEnhancement: apiMocks.createVideoEnhancement,
  createMediaExtraction: apiMocks.createMediaExtraction,
  createVideoSubtitleErase: apiMocks.createVideoSubtitleErase,
  createVideoSceneSplit: apiMocks.createVideoSceneSplit,
  readJobFailText: apiMocks.readJobFailText,
}));
vi.mock('@/shared/api/idempotencyKey', () => ({ newIdempotencyKey: apiMocks.newIdempotencyKey }));
vi.mock('@/custom/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/custom/api/generation', () => ({ fetchGenerationModels: apiMocks.fetchGenerationModels }));
vi.mock('@/custom/utils/upload', () => ({ uploadAssetFile: apiMocks.uploadAssetFile }));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('../../hooks/document/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'i1',
          type: 'mediaNode',
          position: { x: 0, y: 0 },
          data: {
            src: 'http://img/i1.png',
            mediaType: 'image',
            fileName: '素材图',
            assetId: '5',
            width: 1600,
            height: 900,
            mime: 'image/png',
          },
        },
        {
          id: 'v1',
          type: 'mediaNode',
          position: { x: 400, y: 0 },
          data: {
            src: 'http://vid/v1.mp4',
            mediaType: 'video',
            fileName: '素材视频',
            assetId: '6',
            width: 1920,
            height: 1080,
            duration: 30,
            mime: 'video/mp4',
          },
        },
      ],
      edges: [],
    },
    assets: {
      5: { asset_id: 5, type: 'image', access_url: 'http://img/i1.png', width: 1600, height: 900 },
      6: { asset_id: 6, type: 'video', access_url: 'http://vid/v1.mp4', width: 1920, height: 1080 },
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

function fullNode(id: string): Node {
  const found = (flowProps.current.mediaNodes as Node[]).find((n) => n.id === id);
  if (!found) throw new Error(`节点不存在: ${id}`);
  return found;
}

async function enterSceneSplit() {
  const video = fullNode('v1').data as Record<string, (nodeId: string) => void>;
  await act(async () => {
    video.onSceneSplit('v1');
  });
}

function v1Data(): Record<string, unknown> {
  return fullNode('v1').data as Record<string, unknown>;
}

function bodyBtn(testId: string): HTMLButtonElement {
  return document.body.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;
}

async function click(testId: string) {
  await act(async () => {
    bodyBtn(testId).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function sendBar(): HTMLElement | null {
  return document.body.querySelector('[data-testid="scene-split-send-bar"]');
}

async function selectGranularity(granularity: string) {
  await click(`scene-split-granularity-${granularity}`);
}

async function sendSceneSplit() {
  await click('scene-split-send-btn');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

function placeholderNode(): Node | undefined {
  return (flowProps.current.mediaNodes as Node[]).find((n) => n.id.startsWith('scene-split-'));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  idempotencySeq = 0;
  seedDoc();
  apiMocks.createVideoSceneSplit.mockReset();
  apiMocks.createVideoSubtitleErase.mockReset();
  apiMocks.createMediaExtraction.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKH8BR 编辑态呈现（进入不建任务）', () => {
  it('进入编辑态：单条五元素（X/标题「场景切分」/三档分段默认标准/⚡0/发送）+ 源卡锁定注入；不建任务不建卡', async () => {
    await renderPage();
    await enterSceneSplit();
    expect(sendBar()).toBeTruthy();
    expect(bodyBtn('scene-split-close')).toBeTruthy();
    expect(bodyBtn('scene-split-title').textContent).toBe('场景切分');
    expect(bodyBtn('scene-split-granularity-fine')).toBeTruthy();
    expect(bodyBtn('scene-split-granularity-standard').getAttribute('aria-checked')).toBe('true');
    expect(bodyBtn('scene-split-granularity-coarse')).toBeTruthy();
    expect(bodyBtn('scene-split-send-btn')).toBeTruthy();
    const bar = sendBar()!;
    const el = (testId: string) => bar.querySelector(`[data-testid="${testId}"]`)!;
    const before = (a: Element, b: Element) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(el('scene-split-close'), el('scene-split-title'))).toBe(true);
    expect(before(el('scene-split-title'), el('scene-split-granularity-standard'))).toBe(true);
    expect(v1Data().splitEditing).toBe(true);
    expect(v1Data().soloToolbarHidden).toBe(true);
    expect(apiMocks.createVideoSceneSplit).not.toHaveBeenCalled();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('粒度可切换、不跨会话记忆：选细后退出重进复位标准', async () => {
    await renderPage();
    await enterSceneSplit();
    await selectGranularity('fine');
    expect(bodyBtn('scene-split-granularity-fine').getAttribute('aria-checked')).toBe('true');
    expect(bodyBtn('scene-split-granularity-standard').getAttribute('aria-checked')).toBe('false');
    await click('scene-split-close');
    await enterSceneSplit();
    expect(bodyBtn('scene-split-granularity-standard').getAttribute('aria-checked')).toBe('true');
    expect(bodyBtn('scene-split-granularity-fine').getAttribute('aria-checked')).toBe('false');
  });
});

describe('IKH8BR 退出的页面事件与播放标记接线', () => {
  it('X 退出：无卡、无边、无任务、编辑标记移除（播放控制恢复）', async () => {
    await renderPage();
    await enterSceneSplit();
    await click('scene-split-close');
    expect(sendBar()).toBeNull();
    expect(v1Data().splitEditing).toBeUndefined();
    expect(v1Data().soloToolbarHidden).toBeUndefined();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    expect(flowProps.current.edges).toEqual([]);
    expect(apiMocks.createVideoSceneSplit).not.toHaveBeenCalled();
  });

  it('点其他卡退出（单选非目标）：退出且同次通知不自动开该卡面板（旧会话活跃门）', async () => {
    await renderPage();
    await enterSceneSplit();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [{ id: 'i1' }] });
    });
    expect(sendBar()).toBeNull();
    expect(v1Data().splitEditing).toBeUndefined();
  });

});

describe('IKH8BR 与既有六会话互斥（集中协调器口径）', () => {
  type Kind = 'erase' | 'cutout' | 'crop' | 'outpaint' | 'subtitleErase' | 'audioVideoSplit';
  const SESSION_UI_TESTID: Record<Kind, string> = {
    erase: 'erase-send-bar',
    cutout: 'cutout-toolbar',
    crop: 'crop-confirm',
    outpaint: 'outpaint-dialog',
    subtitleErase: 'subtitle-erase-send-bar',
    audioVideoSplit: 'audio-video-split-send-bar',
  };
  const KINDS: Kind[] = ['erase', 'cutout', 'crop', 'outpaint', 'subtitleErase', 'audioVideoSplit'];

  async function enterSession(kind: Kind) {
    const image = fullNode('i1').data as Record<string, (nodeId: string) => void>;
    const video = fullNode('v1').data as Record<string, (nodeId: string, mode?: string) => void>;
    await act(async () => {
      if (kind === 'erase') image.onEraseImage('i1');
      else if (kind === 'cutout') image.onCutoutImage('i1');
      else if (kind === 'crop') image.onCropImage('i1');
      else if (kind === 'outpaint') image.onOutpaintImage('i1');
      else if (kind === 'subtitleErase') video.onVideoSubtitleErase('v1', 'smart');
      else video.onAudioVideoSplit('v1');
    });
  }

  const sessionUi = (kind: Kind) =>
    document.body.querySelector(`[data-testid="${SESSION_UI_TESTID[kind]}"]`);

  it.each(KINDS)('%s 会话中进入场景切分：旧会话退出、场景切分接管、未发送无痕迹', async (kind) => {
    await renderPage();
    await enterSession(kind);
    expect(sessionUi(kind)).toBeTruthy();
    await enterSceneSplit();
    expect(sessionUi(kind)).toBeNull();
    expect(sendBar()).toBeTruthy();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    expect(flowProps.current.edges).toEqual([]);
    expect(apiMocks.createVideoSceneSplit).not.toHaveBeenCalled();
  });

  it.each(KINDS)('场景切分会话中进入 %s：场景切分退出、新会话接管（反向互斥）', async (kind) => {
    await renderPage();
    await enterSceneSplit();
    expect(sendBar()).toBeTruthy();
    await enterSession(kind);
    expect(sendBar()).toBeNull();
    if (kind !== 'audioVideoSplit') expect(v1Data().splitEditing).toBeUndefined();
    expect(sessionUi(kind)).toBeTruthy();
  });
});

describe('IKH8BR 发送闭环（先退会话 → 占位卡 → job_id → 轮询）', () => {
  it('发送（默认标准档）：按契约四键建任务、先退会话再建占位卡（粒度标注/骨架/身份/jobId）、来源边 origin、落盘', async () => {
    apiMocks.createVideoSceneSplit.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterSceneSplit();
    await sendSceneSplit();
    expect(apiMocks.createVideoSceneSplit).toHaveBeenCalledTimes(1);
    const [projectId, payload] = apiMocks.createVideoSceneSplit.mock.calls[0]!;
    expect(projectId).toBe('p1');
    expect(payload.source_asset_id).toBe('6');
    expect(payload.granularity).toBe('standard');
    expect(typeof payload.client_token).toBe('string');
    expect((payload.client_token as string).length).toBeGreaterThan(0);
    const targetNodeId = payload.target_node_id as string;
    expect(targetNodeId).toContain('scene-split');
    expect(sendBar()).toBeNull();
    expect(v1Data().splitEditing).toBeUndefined();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(3);
    const placeholder = placeholderNode()!;
    expect(placeholder.id).toBe(targetNodeId);
    expect(placeholder.data.genStatus).toBe('generating');
    expect(placeholder.data.mediaType).toBe('video');
    expect(placeholder.data.fileName).toBe('场景切分 · 标准');
    expect(placeholder.data.sceneSplit).toEqual({
      sourceAssetId: '6',
      lastInput: {
        source_asset_id: '6',
        target_node_id: targetNodeId,
        granularity: 'standard',
      },
    });
    expect(placeholder.data.jobId).toBe('j1');
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j1');
    const edge = (flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>)
      .find((e) => e.target === targetNodeId)!;
    expect(edge.source).toBe('v1');
    expect(edge.data).toEqual({ origin: SCENE_SPLIT_EDGE_ORIGIN });
    expect(apiMocks.saveCanvasDoc).not.toHaveBeenCalled();
  });

  it('选粗档后发送：任务参数与占位卡标注跟随所选粒度（所见即所得）', async () => {
    apiMocks.createVideoSceneSplit.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterSceneSplit();
    await selectGranularity('coarse');
    await sendSceneSplit();
    const payload = apiMocks.createVideoSceneSplit.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.granularity).toBe('coarse');
    expect(placeholderNode()!.data.fileName).toBe('场景切分 · 粗');
    expect((placeholderNode()!.data.sceneSplit as Record<string, unknown>).lastInput).toMatchObject({ granularity: 'coarse' });
  });

  it('飞行期防重复提交：同一事件循环连点发送只发一次请求、只建一张占位卡', async () => {
    let resolveCreate!: (value: { job_id: string; status: string }) => void;
    apiMocks.createVideoSceneSplit.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    await renderPage();
    await enterSceneSplit();
    await act(async () => {
      bodyBtn('scene-split-send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      bodyBtn('scene-split-send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(sendBar()).toBeNull();
    const pendingPayload = apiMocks.createVideoSceneSplit.mock.calls[0]![1];
    expect(placeholderNode()!.id).toBe(pendingPayload.target_node_id);
    expect(placeholderNode()!.data.genStatus).toBe('generating');
    expect(placeholderNode()!.data.jobId).toBeUndefined();
    expect((flowProps.current.edges as Array<{ source: string; target: string }>)).toContainEqual(expect.objectContaining({ source: 'v1', target: pendingPayload.target_node_id }));
    resolveCreate({ job_id: 'j1', status: 'queued' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(apiMocks.createVideoSceneSplit).toHaveBeenCalledTimes(1);
    expect((flowProps.current.mediaNodes as Node[]).filter((n) => n.id.startsWith('scene-split-'))).toHaveLength(1);
  });

  it('创建失败（网络）：会话已按 BO 顺序先退，占位卡转失败态可读文案（卡上重试按原参数重发）', async () => {
    apiMocks.createVideoSceneSplit.mockRejectedValue(new Error('network down'));
    await renderPage();
    await enterSceneSplit();
    await sendSceneSplit();
    expect(apiMocks.createVideoSceneSplit).toHaveBeenCalledTimes(1);
    expect(sendBar()).toBeNull();
    const placeholder = placeholderNode()!;
    expect(placeholder.data.genStatus).toBe('failed');
    expect(placeholder.data.errorText).toBe('场景切分任务创建失败，请重试');
  });
});

describe('IKH8BR 轮询终态与失败重试', () => {
  it('轮询终态 failed：占位卡转失败态（1046 兜底文案），重试按冻结参数原粒度重发 + 新 client_token', async () => {
    apiMocks.createVideoSceneSplit.mockResolvedValueOnce({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j1', status: 'failed', progress: 1,
      error: { code: 1046 },
    });
    await renderPage();
    await enterSceneSplit();
    await sendSceneSplit();
    const failed = placeholderNode()!;
    expect(failed.data.genStatus).toBe('failed');
    expect(failed.data.errorText).toBe('场景切分失败，请重试');

    apiMocks.createVideoSceneSplit.mockResolvedValueOnce({ job_id: 'j2', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j2', status: 'processing', progress: 10, asset: null,
    });
    await act(async () => {
      (failed.data.onRetryJob as (id: string) => void)(failed.id);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(apiMocks.createVideoSceneSplit).toHaveBeenCalledTimes(2);
    const [, firstPayload] = apiMocks.createVideoSceneSplit.mock.calls[0]! as [string, Record<string, unknown>];
    const [, retryPayload] = apiMocks.createVideoSceneSplit.mock.calls[1]! as [string, Record<string, unknown>];
    expect(retryPayload.source_asset_id).toBe(firstPayload.source_asset_id);
    expect(retryPayload.target_node_id).toBe(firstPayload.target_node_id);
    expect(retryPayload.granularity).toBe(firstPayload.granularity);
    expect(retryPayload.client_token).not.toBe(firstPayload.client_token);
    const retried = placeholderNode()!;
    expect(retried.id).toBe(failed.id);
    expect(retried.data.jobId).toBe('j2');
    expect(retried.data.genStatus).toBe('generating');
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j2');
  });
});


function segmentNodes(): Node[] {
  return ((flowProps.current.mediaNodes as Node[]) ?? []).filter((n) =>
    n.id.startsWith('scene-segment-'),
  );
}

function sceneSplitSuccessDetail() {
  return {
    job_id: 'j1',
    status: 'succeeded',
    progress: 100,
    asset: null,
    output_assets: [
      { id: '101', url: 'http://tos/seg1.mp4', type: 'video', width: 1920, height: 1080 },
      { id: '102', url: 'http://tos/seg2.mp4', type: 'video', width: 1920, height: 1080 },
      { id: '103', url: 'http://tos/seg3.mp4', type: 'video', width: 1920, height: 1080 },
    ],
    result: {
      duration: 60,
      segments: [
        { segment_index: 1, start_time: 0, end_time: 15, segment_asset_id: '101' },
        { segment_index: 2, start_time: 15, end_time: 46, segment_asset_id: '102' },
        { segment_index: 3, start_time: 46, end_time: 60, segment_asset_id: '103' },
      ],
    },
  };
}

async function sendThenSucceed(detail: Record<string, unknown>) {
  apiMocks.createVideoSceneSplit.mockResolvedValue({ job_id: 'j1', status: 'queued' });
  apiMocks.fetchJobStatus.mockResolvedValue(detail);
  await renderPage();
  await enterSceneSplit();
  await sendSceneSplit();
}

describe('IKH8C1 完成扇出（succeeded → 移除占位卡 + N 张段卡 + 来源连线）', () => {
  it('3 段：占位卡移除、按返回顺序建 3 张普通视频段卡（标注/src/assetId/无生成态）、逐卡拉来源连线、扇出即落盘', async () => {
    await sendThenSucceed(sceneSplitSuccessDetail());
    const nodes = flowProps.current.mediaNodes as Node[];
    const segments = segmentNodes();
    expect(segments).toHaveLength(3);
    expect(nodes.find((n) => n.id.startsWith('scene-split-'))).toBeUndefined();
    expect(segments.map((n) => (n.data as Record<string, unknown>).fileName)).toEqual([
      '第 1 段 00:00-00:15',
      '第 2 段 00:15-00:46',
      '第 3 段 00:46-01:00',
    ]);
    segments.forEach((n, i) => {
      const d = n.data as Record<string, unknown>;
      expect(d.mediaType).toBe('video');
      expect(d.src).toBe(`http://tos/seg${i + 1}.mp4`);
      expect(d.assetId).toBe(String(101 + i));
      expect(d.genStatus).toBeUndefined();
      expect(d.jobId).toBe('j1');
      expect(d.width).toBe(1920);
      expect(d.height).toBe(1080);
    });
    const edges = flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>;
    segments.forEach((n) => {
      const edge = edges.find((e) => e.target === n.id);
      expect(edge?.source).toBe('v1');
      expect(edge?.data).toEqual({ origin: SCENE_SPLIT_EDGE_ORIGIN });
    });
    const boxes = segments.map((n) => ({
      x: n.position.x,
      y: n.position.y,
      width: 498,
      height: 324,
    }));
    boxes.forEach((b) => {
      expect(b.x).toBeGreaterThanOrEqual(400 + 498);
      const i1 = { x: 0, y: 0, width: 320, height: 340 };
      const noOverlap =
        b.x >= i1.x + i1.width + 8 || i1.x >= b.x + b.width + 8 || b.y >= i1.y + i1.height + 8 || i1.y >= b.y + b.height + 8;
      expect(noOverlap).toBe(true);
    });
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const separated =
          a.x >= b.x + b.width + 8 || b.x >= a.x + a.width + 8 || a.y >= b.y + b.height + 8 || b.y >= a.y + a.height + 8;
        expect(separated).toBe(true);
      }
    }
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalled();
  });

  it('整片仅 1 段不特判：第 1 段、全程时间轴，照常出 1 张段卡并拉连线', async () => {
    const detail = sceneSplitSuccessDetail();
    (detail.result as { segments: unknown[] }).segments = [
      { segment_index: 1, start_time: 0, end_time: 60, segment_asset_id: '101' },
    ];
    detail.output_assets = [detail.output_assets![0]!];
    await sendThenSucceed(detail);
    const segments = segmentNodes();
    expect(segments).toHaveLength(1);
    expect((segments[0]!.data as Record<string, unknown>).fileName).toBe('第 1 段 00:00-01:00');
    const edges = flowProps.current.edges as Array<{ source: string; target: string }>;
    expect(edges.find((e) => e.target === segments[0]!.id)?.source).toBe('v1');
  });

  it('超 1 小时段走 h:mm:ss 分支（时不补零）', async () => {
    const detail = sceneSplitSuccessDetail();
    detail.output_assets = [
      { id: '201', url: 'http://tos/long.mp4', type: 'video', width: 3840, height: 2160 },
    ];
    detail.result = {
      duration: 3675,
      segments: [{ segment_index: 1, start_time: 3605, end_time: 3675, segment_asset_id: '201' }],
    };
    await sendThenSucceed(detail);
    const segments = segmentNodes();
    expect(segments).toHaveLength(1);
    expect((segments[0]!.data as Record<string, unknown>).fileName).toBe('第 1 段 1:00:05-1:01:15');
  });
});

describe('IKH8C1 跨会话恢复一致性（水合 → 恢复轮询 → 终态收敛）', () => {
  function seedDocWithGeneratingPlaceholder() {
    seedDoc();
    const doc = canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> };
    doc.nodes.push({
      id: 'scene-split-kept',
      type: 'mediaNode',
      position: { x: 958, y: 0 },
      data: {
        src: '',
        fileName: '场景切分 · 标准',
        mediaType: 'video',
        genStatus: 'generating',
        progress: 60,
        jobId: 'j9',
        sceneSplit: {
          sourceAssetId: '6',
          lastInput: { source_asset_id: '6', target_node_id: 'scene-split-kept', granularity: 'standard' },
        },
      },
    });
  }

  it('刷新回来任务进行中：恢复轮询仍生成中；已完成时照常扇出（段卡 + 连线 + 占位卡移除）', async () => {
    seedDocWithGeneratingPlaceholder();
    apiMocks.fetchJobStatus
      .mockResolvedValueOnce({ job_id: 'j9', status: 'processing', progress: 80, asset: null })
      .mockResolvedValue({ ...sceneSplitSuccessDetail(), job_id: 'j9' });
    await renderPage();
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j9');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const kept = (flowProps.current.mediaNodes as Node[]).find((n) => n.id === 'scene-split-kept');
    expect(kept?.data.genStatus).toBe('generating');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2600));
    });
    const nodes = flowProps.current.mediaNodes as Node[];
    expect(nodes.find((n) => n.id === 'scene-split-kept')).toBeUndefined();
    expect(segmentNodes()).toHaveLength(3);
    const edges = flowProps.current.edges as Array<{ source: string; target: string }>;
    segmentNodes().forEach((n) => {
      expect(edges.find((e) => e.target === n.id)?.source).toBe('v1');
    });
  }, 10000);

  it('已扇出的画布（段卡为普通卡无生成态）水合不重开轮询——天然幂等', async () => {
    seedDoc();
    const doc = canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> };
    doc.nodes.push({
      id: 'scene-segment-done',
      type: 'mediaNode',
      position: { x: 958, y: 0 },
      data: {
        src: 'http://tos/seg1.mp4',
        fileName: '第 1 段 00:00-01:00',
        mediaType: 'video',
        assetId: '101',
        width: 1920,
        height: 1080,
      },
    });
    await renderPage();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(apiMocks.fetchJobStatus).not.toHaveBeenCalled();
    expect((flowProps.current.mediaNodes as Node[]).find((n) => n.id === 'scene-segment-done')).toBeTruthy();
  });
});
