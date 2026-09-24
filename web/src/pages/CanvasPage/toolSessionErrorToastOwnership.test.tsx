// @vitest-environment jsdom
/* IKI8L4 错误提示归属回归（真实 API/HTTP 链）：工具会话的创建请求失败时，HTTP 层
   （http.ts doRequest 的 sonner toast）不得在会话纪元判断之前抢先提示——迟到失败
   （旧会话已关、新会话已开）必须全链路静默，当前有效会话的失败由持有发送身份的
   页面 catch 提示恰好一次（audioSpeed IKI4LX「silent 传输 + 页面单源」先例推广）。

   与 canvasPageTestHarness 的结构性差异（本文件存在的理由）：harness 的
   vi.mock('@/api/jobs') 整体替换后 http.ts 层根本不跑，现有隔离测试只断言页面
   toast 不弹，测不出「HTTP 层先弹」——这正是 IKI8L4 在 !838 测试中漏测的原因。
   本文件改用 importOriginal 部分真实：createAudioTrim / createVideoSceneSplit 走
   真实 jobs.ts → 真实 apiRequest/http.ts doRequest，替身只在外部边界
   （window.fetch 与 sonner）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import type { GenerationModel } from '@/api/generation';
import type { FetchJobsParams, FrameInterpolationCurrentData, JobListData } from '@/api/jobs';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth';
import { useAuthPromptStore } from '@/stores/authPrompt';

/* ---------- 打桩：组件（同 harness 口径，Canvas 透出 props） ---------- */

export const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/Canvas', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));
vi.mock('./components/AgentPanel', () => ({
  default: ({ initialCardLabel }: { initialCardLabel?: string }) =>
    createElement('div', { 'data-testid': 'agent-panel-stub' }, initialCardLabel),
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

/* ---------- 打桩：sonner（HTTP 层 toast 的观测点） ---------- */

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

/* ---------- 打桩：非受测 API 模块（同 harness 口径，全部纯 mock 不经 http 层） ---------- */

const projectMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  touchProjectLastOpened: vi.fn(async () => undefined),
}));
const authMocks = vi.hoisted(() => ({
  fetchMe: vi.fn(async () => null),
  fetchQuota: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
}));
const canvasMocks = vi.hoisted(() => ({
  applyPromptPreview: vi.fn(),
  saveCanvasDoc: vi.fn(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
}));

vi.mock('@/api/projects', () => ({
  fetchProjects: projectMocks.fetchProjects,
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  touchProjectLastOpened: projectMocks.touchProjectLastOpened,
  pinProject: vi.fn(),
}));
vi.mock('@/api/auth', () => ({
  fetchMe: authMocks.fetchMe,
  fetchQuota: authMocks.fetchQuota,
  toSessionUser: authMocks.toSessionUser,
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
  applyPromptPreview: canvasMocks.applyPromptPreview,
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => Promise.resolve({ items: [] }), retry: false }),
  saveCanvasDoc: canvasMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn((edges: Array<{ id: string; source: string; target: string; data?: unknown }>) =>
    JSON.stringify(edges.map((e) => ({ id: e.id, source: e.source, target: e.target, data: e.data }))),
  ),
}));
vi.mock('@/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/api/generation', () => ({
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
}));

/* ---------- 打桩：@/api/jobs 部分真实——受测创建函数走真实 http 层，其余键 mock。
   工厂惰性执行（页面动态 import 时才跑），此时 jobMocks 已由 vi.hoisted 初始化。 ---------- */

const jobMocks = vi.hoisted(() => ({
  fetchJobs: vi.fn(async (_params?: FetchJobsParams): Promise<JobListData> => ({ records: [], total: 0, size: 20, current: 1 })),
  fetchJobStatus: vi.fn(),
  newIdempotencyKey: vi.fn(() => 'iki8l4-token'),
  cancelGenerationJob: vi.fn(async () => null),
  createFrameInterpolation: vi.fn(),
  fetchFrameInterpolationCurrent: vi.fn(async (): Promise<FrameInterpolationCurrentData | null> => null),
}));
vi.mock('@/api/jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/jobs')>();
  return {
    ...actual,
    // 页面水合/轮询/幂等键走 mock，避免真实 fetch 干扰受控用例
    fetchJobs: jobMocks.fetchJobs,
    fetchJobStatus: jobMocks.fetchJobStatus,
    newIdempotencyKey: jobMocks.newIdempotencyKey,
    cancelGenerationJob: jobMocks.cancelGenerationJob,
    createGenerationJob: vi.fn(),
    retryGenerationJob: vi.fn(),
    retryAudioMix: vi.fn(),
    createVideoEnhancement: vi.fn(),
    createFrameInterpolation: jobMocks.createFrameInterpolation,
    fetchFrameInterpolationCurrent: jobMocks.fetchFrameInterpolationCurrent,
    // createAudioTrim / createVideoSceneSplit（及未列出的其余键）保持真实实现：
    // 真实 jobs.ts → 真实 http.ts doRequest → 受控 window.fetch
  };
});

/* ---------- 画布文档接缝（同 harness） ---------- */

const canvasDocMock = {
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
};
vi.mock('./hooks/useCanvasDoc', () => ({
  useCanvasDoc: () => canvasDocMock.current,
}));

/* ---------- 受控 fetch：真实 http 层的唯一外部边界 ---------- */

const fetchMock = vi.fn();
const jsonOk = (data: unknown) =>
  new Response(JSON.stringify({ code: 200, msg: 'ok', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
/** 业务失败信封：HTTP 500 + 产品包络 code!==200 + msg */
const jsonFail = (msg: string, status = 500) =>
  new Response(JSON.stringify({ code: 1, msg, data: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/* ---------- 渲染（动态 import 页面，保证打桩先于模块图） ---------- */

function enableReactActEnvironment() {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}
let root: Root | null = null;
let container: HTMLDivElement | null = null;
async function renderPage() {
  enableReactActEnvironment();
  const { default: CanvasPage } = await import('./index');
  container = document.createElement('div');
  document.body.appendChild(container);
  const createdRoot = createRoot(container);
  root = createdRoot;
  await act(async () => {
    createdRoot.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }) },
        createElement(MemoryRouter, { initialEntries: ['/canvas?project=p1'] }, createElement(CanvasPage)),
      ),
    );
  });
}
async function unmountPage() {
  const current = root;
  if (current) await act(async () => { current.unmount(); });
  container?.remove();
  root = null;
  container = null;
}

/* ---------- 画布 seed 与操作助手 ---------- */

/** 项目一画布：音频卡 a1/b1（截取用）+ 视频卡 v1（场景切分用） */
function seedProjectA() {
  return canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'a1',
          type: 'mediaNode',
          position: { x: 400, y: 0 },
          data: {
            src: 'http://aud/a1.mp3',
            mediaType: 'audio',
            fileName: '播客片头.mp3',
            assetId: '8',
            duration: 15,
            mime: 'audio/mpeg',
          },
        },
        {
          id: 'b1',
          type: 'mediaNode',
          position: { x: 400, y: 300 },
          data: {
            src: 'http://aud/b1.mp3',
            mediaType: 'audio',
            fileName: '插曲素材.mp3',
            assetId: '9',
            duration: 20,
            mime: 'audio/mpeg',
          },
        },
        {
          id: 'v1',
          type: 'mediaNode',
          position: { x: 0, y: 0 },
          data: {
            src: 'http://vid/v1.mp4',
            mediaType: 'video',
            fileName: '演示视频.mp4',
            assetId: '18',
            duration: 30,
            mime: 'video/mp4',
          },
        },
      ],
      edges: [],
    },
    assets: {
      8: { asset_id: 8, type: 'audio', access_url: 'http://aud/a1.mp3', duration: 15 },
      9: { asset_id: 9, type: 'audio', access_url: 'http://aud/b1.mp3', duration: 20 },
      18: { asset_id: 18, type: 'video', access_url: 'http://vid/v1.mp4', duration: 30 },
    },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

const mediaNodes = () => flowProps.current.mediaNodes as Node[];
const mediaNode = (id: string) => mediaNodes().find((n) => n.id === id)!;
const dataOf = (id: string) => (mediaNode(id).data ?? {}) as Record<string, unknown>;
const trimSendBar = () => document.body.querySelector('[data-testid="audio-trim-send-bar"]');
const trimSendBtn = () => document.body.querySelector<HTMLButtonElement>('[data-testid="audio-trim-send-btn"]');
const sceneSendBar = () => document.body.querySelector('[data-testid="scene-split-send-bar"]');
const sceneSendBtn = () => document.body.querySelector<HTMLButtonElement>('[data-testid="scene-split-send-btn"]');
const mixSendBar = () => document.body.querySelector('[data-testid="audio-mix-send-bar"]');
const mixSendBtn = () => document.body.querySelector<HTMLButtonElement>('[data-testid="audio-mix-send"]');
const mixCloseBtn = () => document.body.querySelector<HTMLButtonElement>('[data-testid="audio-mix-close"]');
const mixFormatTrigger = () => document.body.querySelector<HTMLButtonElement>('[data-testid="audio-mix-format-trigger"]');

/** 进入截取编辑态（音频卡工具条「截取」回调） */
async function enterTrim(id: string) {
  await act(async () => {
    (dataOf(id).onTrimAudio as (nodeId: string) => void)(id);
  });
}
/** 进入场景切分会话（视频卡工具条「场景切分」回调） */
async function enterSceneSplit(id: string) {
  await act(async () => {
    (dataOf(id).onSceneSplit as (nodeId: string) => void)(id);
  });
}
/** 进入音频混合会话并配好可发送的第二源（IKI8L8） */
async function armMix(sourceId: string, candidateId: string) {
  await act(async () => {
    (dataOf(sourceId).onMixAudio as (nodeId: string) => void)(sourceId);
  });
  await clickBtn(document.body.querySelector<HTMLButtonElement>('[data-testid="audio-mix-add"]'));
  await clickBtn(document.body.querySelector<HTMLButtonElement>(`[data-testid="audio-mix-candidate-${candidateId}"]`));
}
async function clickBtn(btn: HTMLButtonElement | null) {
  await act(async () => {
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}
/** 点发送钮（挂起场景下只完成发送动作本身，不等待创建往返） */
async function clickSend(btn: HTMLButtonElement | null) {
  await act(async () => {
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

beforeEach(() => {
  enableReactActEnvironment();
  localStorage.clear();
  sessionStorage.clear();
  seedProjectA();
  fetchMock.mockReset();
  // 默认实现：页面意外的真实 fetch 一律 200 空信封，不干扰受控用例
  fetchMock.mockImplementation(async () => jsonOk(null));
  vi.stubGlobal('fetch', fetchMock);
  jobMocks.fetchJobStatus.mockReset();
  jobMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
});

afterEach(async () => {
  await unmountPage();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  useAuthPromptStore.getState().reset();
  useAuthStore.setState({ user: null, isNewUser: false, quota: null });
});

describe('IKI8L4 截取（真实 API/HTTP 链）：错误提示归属发送时会话', () => {
  it('迟到业务失败：旧会话已关、新会话已开，HTTP 层不抢先提示（页面纪元挡板同守）', async () => {
    let settleA!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { settleA = resolve; }));
    await renderPage();
    await enterTrim('a1');
    await clickSend(trimSendBtn());
    // X 关旧会话 → 同项目另一张卡开新会话（不发送，只占住新会话身份）
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="audio-trim-close"]')!.click(); });
    await enterTrim('b1');
    // 旧请求以业务失败（HTTP 500 + msg）迟到返回
    await act(async () => { settleA(jsonFail('服务器开小差了')); });
    await flush();
    // HTTP 层（sonner）不得在会话判断之前抢先提示——修订前此处弹旧错误，即缺口本体
    expect(toast.error).not.toHaveBeenCalled();
    // 页面层旧错误同样静默（!838 已修，此处为全链路双守）
    expect(document.body.textContent).not.toContain('服务器开小差了');
    // 新会话不受旧失败打扰
    expect(trimSendBar()).not.toBeNull();
  });

  it('迟到网络失败：同场景注入网络错误，结果仍为旧错误静默、新会话状态不变', async () => {
    let rejectA!: (error: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { rejectA = reject; }));
    await renderPage();
    await enterTrim('a1');
    await clickSend(trimSendBtn());
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-testid="audio-trim-close"]')!.click(); });
    await enterTrim('b1');
    await act(async () => { rejectA(new TypeError('Failed to fetch')); });
    await flush();
    expect(toast.error).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('网络请求失败');
    expect(trimSendBar()).not.toBeNull();
  });

  it('当前有效会话业务失败：页面提示恰一次、HTTP 层不重复，停留编辑态可重试', async () => {
    fetchMock.mockImplementationOnce(async () => jsonFail('服务器开小差了'));
    await renderPage();
    await enterTrim('a1');
    await clickSend(trimSendBtn());
    await flush();
    // 单源提示：页面 showToast 弹 msg（持有发送身份的调用方）
    expect(document.body.textContent).toContain('服务器开小差了');
    // HTTP 层不再叠加第二条（修订前双弹：sonner + 页面）
    expect(toast.error).not.toHaveBeenCalled();
    // 提交状态可恢复：发送钮复位、停留编辑态
    expect(trimSendBar()).not.toBeNull();
    expect(trimSendBtn()!.disabled).toBe(false);
  });

  it('当前有效会话网络失败：页面以网络文案提示一次，可重试', async () => {
    fetchMock.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
    await renderPage();
    await enterTrim('a1');
    await clickSend(trimSendBtn());
    await flush();
    expect(document.body.textContent).toContain('网络请求失败');
    expect(toast.error).not.toHaveBeenCalled();
    expect(trimSendBtn()!.disabled).toBe(false);
  });

  it('401 保持既有行为：不 toast、已登录走登录续接门（对照，不因会话提示治理回退）', async () => {
    useAuthStore.setState({ user: { userId: 1, username: 'alice', email: '', phone: '', hasPassword: true, isAdmin: false } });
    fetchMock.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ code: 401, msg: '缺少登录凭证', data: null }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await renderPage();
    await enterTrim('a1');
    await clickSend(trimSendBtn());
    await flush();
    expect(toast.error).not.toHaveBeenCalled();
    expect(useAuthPromptStore.getState().open).toBe(true);
  });
});

describe('IKI8L8 音频混合（真实 API/HTTP 链）：错误提示归属发送时会话', () => {
  it('迟到业务失败：Esc 在途退出重开新会话后，旧失败全链路静默、新会话 WAV 参数不动', async () => {
    let settleA!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { settleA = resolve; }));
    await renderPage();
    await armMix('a1', 'b1');
    await clickSend(mixSendBtn());
    // 发送在途：X 按钮提交禁用（不可用其伪造退出），Esc 公共链是唯一在途退出入口
    expect(mixCloseBtn()!.disabled).toBe(true);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(mixSendBar()).toBeNull();
    // 重开新会话、改 WAV
    await armMix('a1', 'b1');
    await clickBtn(mixFormatTrigger());
    await clickBtn(document.body.querySelector<HTMLButtonElement>('[data-testid="audio-mix-format-wav"]'));
    expect(mixFormatTrigger()!.textContent).toContain('wav');
    // 旧请求以业务失败（HTTP 500 + msg）迟到返回——真实链：silent 传输下 HTTP 层不弹，
    // 唯一提示源是页面 catch，修订前它无纪元比对、把旧错误弹给新会话（即缺口本体）
    await act(async () => { settleA(jsonFail('混音服务开小差了')); });
    await flush();
    expect(toast.error).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('混音服务开小差了');
    // 新会话仍开、WAV 保留、可重试
    expect(mixSendBar()).not.toBeNull();
    expect(mixFormatTrigger()!.textContent).toContain('wav');
    expect(mixSendBtn()!.disabled).toBe(false);
  });

  it('当前有效会话业务失败：页面提示恰一次、HTTP 层不叠加，停留会话可重试', async () => {
    fetchMock.mockImplementationOnce(async () => jsonFail('混音服务开小差了'));
    await renderPage();
    await armMix('a1', 'b1');
    await clickSend(mixSendBtn());
    await flush();
    // 单源提示：页面 catch 弹 msg（silent 传输，HTTP 层不 toast）
    expect(document.body.textContent).toContain('混音服务开小差了');
    expect(toast.error).not.toHaveBeenCalled();
    // 会话保护不吞有效失败：停留会话、提交复位可重试
    expect(mixSendBar()).not.toBeNull();
    expect(mixSendBtn()!.disabled).toBe(false);
  });
});

describe('IKI8L4 发送即同步退出（场景切分真实链）：失败提示不吞、迟到不扰新会话', () => {
  it('仅发送退出且无后来会话：业务失败保留提示（页面单源一次），占位卡落失败态', async () => {
    fetchMock.mockImplementationOnce(async () => jsonFail('分段服务暂不可用'));
    await renderPage();
    await enterSceneSplit('v1');
    // 发送即同步退会话（发送条消失）并发起创建
    await clickSend(sceneSendBtn());
    expect(sceneSendBar()).toBeNull();
    await flush();
    // 有效失败不被纪元变化吞掉：页面提示恰一次
    expect(document.body.textContent).toContain('分段服务暂不可用');
    // HTTP 层不叠加第二条（修订前 sonner 与页面双弹）
    expect(toast.error).not.toHaveBeenCalled();
    // 任务卡失败状态保留（可读文案 + 卡上重试）
    const failed = mediaNodes().find((n) => ((n.data ?? {}) as Record<string, unknown>).genStatus === 'failed');
    expect(failed).toBeTruthy();
    expect(String((failed!.data as Record<string, unknown>).errorText)).toContain('分段服务暂不可用');
  });

  it('后来打开会话后：旧失败全链路静默，不打扰新会话', async () => {
    let settleA!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { settleA = resolve; }));
    await renderPage();
    await enterSceneSplit('v1');
    await clickSend(sceneSendBtn());
    // 发送即退后同卡重开新会话（此后旧请求才失败返回）
    await enterSceneSplit('v1');
    await act(async () => { settleA(jsonFail('分段服务暂不可用')); });
    await flush();
    // 旧失败：HTTP 层与页面全静默
    expect(toast.error).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('分段服务暂不可用');
    // 新会话存活
    expect(sceneSendBar()).not.toBeNull();
    // 旧任务占位卡仍照常收敛失败态（任务卡失败结果不因提示静默而丢失）
    const failed = mediaNodes().find((n) => ((n.data ?? {}) as Record<string, unknown>).genStatus === 'failed');
    expect(failed).toBeTruthy();
  });

  it('场景切分发送后打开截取：旧失败不向新工具会话提示，占位卡仍记录失败', async () => {
    let settleOld!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { settleOld = resolve; }));
    await renderPage();
    await enterSceneSplit('v1');
    await clickSend(sceneSendBtn());
    await enterTrim('a1');
    expect(trimSendBar()).not.toBeNull();

    await act(async () => { settleOld(jsonFail('旧场景切分失败')); });
    await flush();

    expect(toast.error).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('旧场景切分失败');
    expect(trimSendBar()).not.toBeNull();
    const failed = mediaNodes().find((node) => ((node.data ?? {}) as Record<string, unknown>).genStatus === 'failed');
    expect(String((failed?.data ?? {}).errorText)).toContain('旧场景切分失败');
  });
});
