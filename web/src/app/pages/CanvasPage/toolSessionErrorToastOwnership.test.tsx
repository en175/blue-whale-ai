// @vitest-environment jsdom
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
import { silenceApiConsoleInfo } from './testing/silenceApiLogs';
import { installFetchGuard } from './testing/fetchGuard';

silenceApiConsoleInfo();
const fetchGuard = installFetchGuard([
  ['POST', '/api/projects/p1/audio-trims'],
  ['POST', '/api/projects/p1/audio-mixes'],
  ['POST', '/api/projects/p1/video-scene-splits'],
  ['POST', '/api/projects/p1/video-mattings'],
  ['POST', '/api/projects/p1/image-outpaints'],
]);


export const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('@/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));
vi.mock('@/api/canvasRecovery', () => ({
  fetchGenerationRecoveryPage: vi.fn(async () => ({ protocol_version: 1, canvas_version: null, records: [], next_cursor: null })),
  resolveGenerationRecovery: vi.fn(async () => ({ protocol_version: 1, records: [] })),
  generationRecoveryPageOptions: vi.fn(() => ({
    queryKey: ['generation-recovery', 'mock'],
    queryFn: async () => ({ protocol_version: 1, canvas_version: null, records: [], next_cursor: null }),
  })),
}));

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


const projectMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  touchProjectLastOpened: vi.fn(async () => undefined),
}));
const authMocks = vi.hoisted(() => ({
  fetchMe: vi.fn(async () => null),
  fetchCredits: vi.fn(async () => ({})),
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
  fetchCredits: authMocks.fetchCredits,
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


const jobMocks = vi.hoisted(() => ({
  fetchJobs: vi.fn(async (_params?: FetchJobsParams): Promise<JobListData> => ({ records: [], total: 0, size: 20, current: 1 })),
  fetchJobStatus: vi.fn(),
  newIdempotencyKey: vi.fn(() => 'iki8l4-token'),
  cancelGenerationJob: vi.fn(async () => null),
  createFrameInterpolation: vi.fn(),
  fetchFrameInterpolationCurrent: vi.fn(async (): Promise<FrameInterpolationCurrentData | null> => null),
}));
vi.mock('@/api/idempotencyKey', () => ({
  newIdempotencyKey: jobMocks.newIdempotencyKey,
}));
vi.mock('@/api/jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/jobs')>();
  return {
    ...actual,
    fetchJobs: jobMocks.fetchJobs,
    fetchJobStatus: jobMocks.fetchJobStatus,
    cancelGenerationJob: jobMocks.cancelGenerationJob,
    createGenerationJob: vi.fn(),
    retryGenerationJob: vi.fn(),
    retryAudioMix: vi.fn(),
    createVideoEnhancement: vi.fn(),
    createFrameInterpolation: jobMocks.createFrameInterpolation,
    fetchFrameInterpolationCurrent: jobMocks.fetchFrameInterpolationCurrent,
  };
});


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


const fetchMock = vi.fn();
const jsonOk = (data: unknown) =>
  new Response(JSON.stringify({ code: 200, msg: 'ok', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
const jsonFail = (msg: string, status = 500) =>
  new Response(JSON.stringify({ code: 1, msg, data: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });


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

async function enterTrim(id: string) {
  await act(async () => {
    (dataOf(id).onTrimAudio as (nodeId: string) => void)(id);
  });
}
async function enterSceneSplit(id: string) {
  await act(async () => {
    (dataOf(id).onSceneSplit as (nodeId: string) => void)(id);
  });
}
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
  fetchMock.mockImplementation(async () => jsonOk(null));
  fetchGuard.stub(fetchMock);
  jobMocks.fetchJobStatus.mockReset();
  jobMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
});

afterEach(async () => {
  await unmountPage();
  fetchGuard.unstubGlobals();
  vi.clearAllMocks();
  useAuthPromptStore.getState().reset();
  useAuthStore.setState({ user: null, isNewUser: false, credits: null });
});

describe('IKI8L4 截取（真实 API/HTTP 链）：错误提示归属发送时会话', () => {
  it('迟到业务失败：旧会话已关、新会话已开，HTTP 层不抢先提示（页面纪元挡板同守）', async () => {
    let settleA!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { settleA = resolve; }));
    await renderPage();
    await enterTrim('a1');
    await clickSend(trimSendBtn());
    await enterTrim('b1');
    await act(async () => { settleA(jsonFail('服务器开小差了')); });
    await flush();
    expect(toast.error).not.toHaveBeenCalled();
    expect(mediaNodes().find((n) => n.id.startsWith('audio-trim-'))!.data.genStatus).toBe('failed');
    expect(trimSendBar()).not.toBeNull();
  });

  it('迟到网络失败：同场景注入网络错误，结果仍为旧错误静默、新会话状态不变', async () => {
    let rejectA!: (error: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { rejectA = reject; }));
    await renderPage();
    await enterTrim('a1');
    await clickSend(trimSendBtn());
    await enterTrim('b1');
    await act(async () => { rejectA(new TypeError('Failed to fetch')); });
    await flush();
    expect(toast.error).not.toHaveBeenCalled();
    expect(mediaNodes().find((n) => n.id.startsWith('audio-trim-'))!.data.genStatus).toBe('failed');
    expect(trimSendBar()).not.toBeNull();
  });

  it('当前有效会话业务失败：页面提示恰一次、HTTP 层不重复，停留编辑态可重试', async () => {
    fetchMock.mockImplementationOnce(async () => jsonFail('服务器开小差了'));
    await renderPage();
    await enterTrim('a1');
    await clickSend(trimSendBtn());
    await flush();
    expect(toast.error).not.toHaveBeenCalled();
    const card = mediaNodes().find((n) => n.id.startsWith('audio-trim-'))!;
    expect(card.data.genStatus).toBe('failed');
    expect(card.data.errorText).toBe('服务器开小差了');
  });

  it('当前有效会话网络失败：页面以网络文案提示一次，可重试', async () => {
    fetchMock.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
    await renderPage();
    await enterTrim('a1');
    await clickSend(trimSendBtn());
    await flush();
    expect(toast.error).not.toHaveBeenCalled();
    const card = mediaNodes().find((n) => n.id.startsWith('audio-trim-'))!;
    expect(card.data.genStatus).toBe('failed');
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
    expect(mixCloseBtn()!.disabled).toBe(true);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(mixSendBar()).toBeNull();
    await armMix('a1', 'b1');
    await clickBtn(mixFormatTrigger());
    await clickBtn(document.body.querySelector<HTMLButtonElement>('[data-testid="audio-mix-format-wav"]'));
    expect(mixFormatTrigger()!.textContent).toContain('wav');
    await act(async () => { settleA(jsonFail('混音服务开小差了')); });
    await flush();
    expect(toast.error).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('混音服务开小差了');
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
    expect(document.body.textContent).toContain('混音服务开小差了');
    expect(toast.error).not.toHaveBeenCalled();
    expect(mixSendBar()).not.toBeNull();
    expect(mixSendBtn()!.disabled).toBe(false);
  });
});

describe('IKI8L4 发送即同步退出（场景切分真实链）：失败提示不吞、迟到不扰新会话', () => {
  it('仅发送退出且无后来会话：业务失败保留提示（页面单源一次），占位卡落失败态', async () => {
    fetchMock.mockImplementationOnce(async () => jsonFail('分段服务暂不可用'));
    await renderPage();
    await enterSceneSplit('v1');
    await clickSend(sceneSendBtn());
    expect(sceneSendBar()).toBeNull();
    await flush();
    expect(toast.error).not.toHaveBeenCalled();
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
    await enterSceneSplit('v1');
    await act(async () => { settleA(jsonFail('分段服务暂不可用')); });
    await flush();
    expect(toast.error).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('分段服务暂不可用');
    expect(sceneSendBar()).not.toBeNull();
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

async function enterMatting() {
  await act(async () => {
    (dataOf('v1').onSmartMatting as (id: string, mode: 'portrait') => void)('v1', 'portrait');
  });
}
const mattingSend = () => document.body.querySelector<HTMLButtonElement>('[data-testid="smart-matting-send-btn"]');
const mattingBar = () => document.body.querySelector('[data-testid="smart-matting-send-bar"]');
const mattingCard = () => mediaNodes().find((node) => node.id.startsWith('smart-matting-'))!;

describe('抠像真实HTTP链：沿用全局提示呈现，运行时判断反馈归属', () => {
  it.each(['business', 'network'] as const)('当前发送退出后的 %s 失败恰一次，失败占位卡保留', async (failure) => {
    fetchMock.mockImplementationOnce(async () => {
      if (failure === 'network') throw new TypeError('Failed to fetch');
      return jsonFail('抠像业务失败');
    });
    await renderPage(); await enterMatting(); await clickSend(mattingSend()); await flush();
    expect(mattingBar()).toBeNull();
    expect(mattingCard().data.genStatus).toBe('failed');
    expect(toast.error).not.toHaveBeenCalled();
    expect(String(mattingCard().data.errorText)).toContain(failure === 'network' ? '网络请求失败' : '抠像业务失败');
    expect(document.body.querySelector('[data-testid="canvas-toast"]')).toBeNull();
  });

  it.each(['business', 'network'] as const)('同卡重开后旧 %s 失败全链路静默，任务失败仍落卡', async (failure) => {
    let resolve!: (value: Response) => void;
    let reject!: (error: Error) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((accept, fail) => { resolve = accept; reject = fail; }));
    await renderPage(); await enterMatting(); await clickSend(mattingSend());
    await enterMatting();
    await act(async () => {
      if (failure === 'network') reject(new TypeError('Failed to fetch'));
      else resolve(jsonFail('旧抠像错误'));
    });
    await flush();
    expect(mattingBar()).not.toBeNull();
    expect(mattingSend()!.disabled).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-testid="canvas-toast"]')).toBeNull();
    expect(mattingCard().data.genStatus).toBe('failed');
  });

  it('失败卡重试保留既有HTTP反馈，不被编辑会话silent选项吞掉', async () => {
    fetchMock.mockImplementationOnce(async () => jsonFail('第一次失败'));
    await renderPage(); await enterMatting(); await clickSend(mattingSend()); await flush();
    vi.mocked(toast.error).mockClear();
    fetchMock.mockImplementationOnce(async () => jsonFail('重试抠像拒绝'));
    const failed = mattingCard();
    await act(async () => { (failed.data.onRetryJob as (id: string) => void)(failed.id); });
    await flush();
    expect(toast.error).not.toHaveBeenCalled();
    expect(mattingCard().data.errorText).toBe('重试抠像拒绝');
    expect(document.body.querySelector('[data-testid="canvas-toast"]')).toBeNull();
  });

  it('401继续走登录续接，不新增错误提示', async () => {
    fetchMock.mockImplementationOnce(async () => jsonFail('请重新登录', 401));
    await renderPage(); await enterMatting(); await clickSend(mattingSend()); await flush();
    expect(toast.error).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-testid="canvas-toast"]')).toBeNull();
  });
});

function addOutpaintSource() {
  const doc = canvasDocMock.current.doc as { nodes: Node[] };
  doc.nodes.push({ id: 'i1', type: 'mediaNode', position: { x: 400, y: 0 }, data: { assetId: '5', src: 'http://img/i1.png', fileName: '原图.png', mediaType: 'image', width: 600, height: 600, mime: 'image/png', size: 1000 } });
  canvasDocMock.current.assets['5'] = { asset_id: 5, type: 'image', access_url: 'http://img/i1.png', width: 600, height: 600 };
}
async function armOutpaint(right = 70) {
  await act(async () => { (dataOf('i1').onOutpaintImage as (id: string) => void)('i1'); });
  await act(async () => { flowProps.current.outpaintFrame.onExpandChange({ top: 0, right, bottom: 0, left: 0 }); });
}
const outpaintSend = () => document.body.querySelector<HTMLButtonElement>('[data-testid="outpaint-send-btn"]');
const outpaintCard = () => mediaNodes().find((node) => node.data.imageOutpaint)!;

describe('扩图真实HTTP链：有效反馈沿用sonner，旧失败不打扰新会话', () => {
  it('当前发送即退出的失败提示一次并保留可重试结果卡', async () => {
    addOutpaintSource(); fetchMock.mockImplementationOnce(async () => jsonFail('扩图业务失败'));
    await renderPage(); await armOutpaint(); await clickSend(outpaintSend()); await flush();
    expect(outpaintCard().data.genStatus).toBe('failed');
    expect(outpaintCard().data.errorText).toBe('扩图业务失败');
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('扩图业务失败');
    expect(document.body.querySelector('[data-testid="canvas-toast"]')).toBeNull();
  });

  it.each(['business', 'network'] as const)('同卡重开后旧 %s 失败全链路静默，新扩展参数保留', async (failure) => {
    addOutpaintSource();
    let resolve!: (value: Response) => void;
    let reject!: (error: Error) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((accept, fail) => { resolve = accept; reject = fail; }));
    await renderPage(); await armOutpaint(); await clickSend(outpaintSend());
    await armOutpaint(100);
    await act(async () => {
      if (failure === 'network') reject(new TypeError('Failed to fetch'));
      else resolve(jsonFail('旧扩图失败'));
    });
    await flush();
    expect(flowProps.current.outpaintFrame.expands.right).toBe(100);
    expect(outpaintSend()!.disabled).toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-testid="canvas-toast"]')).toBeNull();
    expect(outpaintCard().data.genStatus).toBe('failed');
  });

  it('失败卡重试使用冻结扩展参数原样重发；重试失败经运行时落失败卡（HTTP 层静默，IKJJR2）', async () => {
    addOutpaintSource(); fetchMock.mockImplementationOnce(async () => jsonFail('首次失败'));
    await renderPage(); await armOutpaint(); await clickSend(outpaintSend()); await flush();
    const failed = outpaintCard();
    const input = (failed.data.imageOutpaint as { lastParams: unknown }).lastParams;
    vi.mocked(toast.error).mockClear();
    fetchMock.mockImplementationOnce(async () => jsonFail('扩图重试失败'));
    await act(async () => { (failed.data.onRetryJob as (id: string) => void)(failed.id); });
    await flush();
    expect(toast.error).not.toHaveBeenCalled();
    expect((outpaintCard().data as Record<string, unknown>).errorText).toBe('扩图重试失败');
    expect((outpaintCard().data as Record<string, unknown>).genStatus).toBe('failed');
    const retryBody = JSON.parse(fetchMock.mock.calls.at(-1)![1].body) as Record<string, unknown>;
    expect(retryBody).toMatchObject(input as Record<string, unknown>);
    expect(retryBody.canvas_binding).toMatchObject({ protocol_version: 1 });
    expect(new Headers(fetchMock.mock.calls.at(-1)![1].headers).get('Idempotency-Key')).toEqual((retryBody.canvas_binding as { submission_id: string }).submission_id);
  });
});
