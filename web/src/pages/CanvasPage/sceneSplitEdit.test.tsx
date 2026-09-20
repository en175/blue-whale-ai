// @vitest-environment jsdom
/* IKH8BR 场景切分编辑态与任务卡（画布链路）：点击「场景切分」进入第七工具会话——源卡
   锁定（splitEditing/soloToolbarHidden 渲染期注入，视频暂停与播放控制锁定由 MediaNode
   承担）、卡下方 24px 胶囊单条（X/标题「场景切分」/粒度三档分段控件 standard 默认/
   ⚡0 徽标/发送钮，对齐去字幕单条家族）；接入集中工具会话协调器——四路退出（X/Esc/
   点其他卡/点画布空白）未发送无痕迹（无卡无边无任务）、与既有六会话互斥、会话期
   Dock 面板准入与工具条隐藏走协调器口径。发送闭环：先退会话再建任务占位卡
   （target_node_id 取占位卡、粒度标注展示名、生成中骨架、sceneSplit 身份）、
   client_token 每次发送/重试新生成、job_id 回写后轮询、飞行期发送钮防重复提交；
   任务失败占位卡转失败态，重试按钮按冻结参数原粒度重发。completed 分支的段卡扇出
   归 IKH8C1（本文件不对 completed 行为断言）。渲染模式沿用 audioVideoSplitEdit.test.tsx
   （FlowCanvas 打桩透出 props）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { SCENE_SPLIT_EDGE_ORIGIN } from './sceneSplit';
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
  createVideoSubtitleErase: apiMocks.createVideoSubtitleErase,
  createVideoSceneSplit: apiMocks.createVideoSceneSplit,
  newIdempotencyKey: apiMocks.newIdempotencyKey,
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

/** 画布：就绪视频卡 v1（1920×1080 mp4，assetId 满足置灰门槛；场景切分/去字幕/分离源卡）+
 *  就绪图片卡 i1（1600×900 png，擦除/抠图/裁切/扩图源卡）；无连线。 */
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

/** 进入场景切分编辑态（视频卡工具条「场景切分」按钮派发的回调，IKH8BJ 挂点） */
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

/** 编辑态内选粒度（分段控件按钮） */
async function selectGranularity(granularity: string) {
  await click(`scene-split-granularity-${granularity}`);
}

/** 编辑态内点发送（startSceneSplitJob 含 await 创建，等 50ms 让建卡与轮询首 tick 发起） */
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
    // 粒度三档分段控件：三档齐全、默认 standard 激活（不跨会话记忆口径）
    expect(bodyBtn('scene-split-granularity-fine')).toBeTruthy();
    expect(bodyBtn('scene-split-granularity-standard').getAttribute('aria-checked')).toBe('true');
    expect(bodyBtn('scene-split-granularity-coarse')).toBeTruthy();
    expect(bodyBtn('scene-split-free-badge').textContent).toBe('0');
    expect(bodyBtn('scene-split-send-btn')).toBeTruthy();
    // 控件次序自左至右：X → 标题 → 粒度 → ⚡0 → 发送（对齐去字幕单条家族）
    const bar = sendBar()!;
    const el = (testId: string) => bar.querySelector(`[data-testid="${testId}"]`)!;
    const before = (a: Element, b: Element) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(el('scene-split-close'), el('scene-split-title'))).toBe(true);
    expect(before(el('scene-split-title'), el('scene-split-granularity-standard'))).toBe(true);
    expect(before(el('scene-split-granularity-standard'), el('scene-split-free-badge'))).toBe(true);
    expect(before(el('scene-split-free-badge'), el('scene-split-send-btn'))).toBe(true);
    // 源视频卡注入 splitEditing（视频暂停+锁定层）与 soloToolbarHidden（会话模态口径）
    expect(v1Data().splitEditing).toBe(true);
    expect(v1Data().soloToolbarHidden).toBe(true);
    // 进入即编辑态：不创建任务、不建占位卡、不连边
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
    // 退出重进：粒度不跨会话记忆，复位 standard
    await click('scene-split-close');
    await enterSceneSplit();
    expect(bodyBtn('scene-split-granularity-standard').getAttribute('aria-checked')).toBe('true');
    expect(bodyBtn('scene-split-granularity-fine').getAttribute('aria-checked')).toBe('false');
  });
});

describe('IKH8BR 四路退出：未发送退出画布无痕迹', () => {
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

  it('Esc 退出：同口径无痕迹', async () => {
    await renderPage();
    await enterSceneSplit();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(sendBar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    expect(flowProps.current.edges).toEqual([]);
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

  it('点画布空白退出（PaneClick）', async () => {
    await renderPage();
    await enterSceneSplit();
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(sendBar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    expect(flowProps.current.edges).toEqual([]);
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
    audioVideoSplit: 'audio-video-split-toolbar',
  };
  const KINDS: Kind[] = ['erase', 'cutout', 'crop', 'outpaint', 'subtitleErase', 'audioVideoSplit'];

  /** 进入既有会话（图片工具经图片卡 handler，视频工具经视频卡 handler） */
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
    // 音视频分离接管时同样向 v1 注入 splitEditing（同款源卡锁定标记），不作 undefined 断言
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
    // 建任务：契约四键（source_asset_id/target_node_id/granularity/client_token——token 每次新生成）
    expect(apiMocks.createVideoSceneSplit).toHaveBeenCalledTimes(1);
    const [projectId, payload] = apiMocks.createVideoSceneSplit.mock.calls[0]!;
    expect(projectId).toBe('p1');
    expect(payload.source_asset_id).toBe('6');
    expect(payload.granularity).toBe('standard');
    expect(typeof payload.client_token).toBe('string');
    expect((payload.client_token as string).length).toBeGreaterThan(0);
    const targetNodeId = payload.target_node_id as string;
    expect(targetNodeId).toContain('scene-split');
    // 先退会话再建卡：单条卸载、splitEditing 移除、占位卡已上画布
    expect(sendBar()).toBeNull();
    expect(v1Data().splitEditing).toBeUndefined();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(3);
    const placeholder = placeholderNode()!;
    expect(placeholder.id).toBe(targetNodeId);
    expect(placeholder.data.genStatus).toBe('generating');
    expect(placeholder.data.mediaType).toBe('video');
    expect(placeholder.data.fileName).toBe('场景切分 · 标准');
    // 占位卡带身份（lastInput 冻结源素材+绑定+粒度，失败重试原参数原粒度重发）
    expect(placeholder.data.sceneSplit).toEqual({
      sourceAssetId: '6',
      lastInput: {
        source_asset_id: '6',
        target_node_id: targetNodeId,
        granularity: 'standard',
      },
    });
    // job_id 已回写占位卡并进入轮询
    expect(placeholder.data.jobId).toBe('j1');
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j1');
    // 来源边 origin=scene-split（参考推导跳过口径）
    const edge = (flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>)
      .find((e) => e.target === targetNodeId)!;
    expect(edge.source).toBe('v1');
    expect(edge.data).toEqual({ origin: SCENE_SPLIT_EDGE_ORIGIN });
    // 发送即落盘（best-effort flush，防刚建任务就关页丢卡）
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalled();
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
      // 同步双击（React 尚未重渲染、发送钮未被 disabled 前的第二击）
      bodyBtn('scene-split-send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      bodyBtn('scene-split-send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
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
    // 非 ApiError 的网络异常走家族兜底文案（口径同音视频分离创建失败 toast/卡态）
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
    // W 票错误码面：1046 →「场景切分失败，请重试」（msg 缺失走本地兜底）
    expect(failed.data.errorText).toBe('场景切分失败，请重试');

    // 重试：lastInput（源素材+绑定+粒度）原样重发创建接口（新 job、新 client_token）
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
    // 原参数原粒度（业务键冻结），client_token 新生成（同 token 只会重放旧任务）
    expect(retryPayload.source_asset_id).toBe(firstPayload.source_asset_id);
    expect(retryPayload.target_node_id).toBe(firstPayload.target_node_id);
    expect(retryPayload.granularity).toBe(firstPayload.granularity);
    expect(retryPayload.client_token).not.toBe(firstPayload.client_token);
    // 重试后占位卡原地承接新任务（jobId 更新、回到生成中、轮询重启）
    const retried = placeholderNode()!;
    expect(retried.id).toBe(failed.id);
    expect(retried.data.jobId).toBe('j2');
    expect(retried.data.genStatus).toBe('generating');
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j2');
    // completed 分支的行为断言（段卡扇出）归 IKH8C1，本文件不对 succeeded 终态断言
  });
});
