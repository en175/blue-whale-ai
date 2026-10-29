// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import type { FetchJobsParams, FrameInterpolationCurrentData, JobListData } from '@/custom/api/jobs';
import type { GenerationModel } from '@/custom/api/generation';
import { toast, Toaster } from 'sonner';
import { useAuthStore } from '@/shared/stores/auth';
import { useAuthPromptStore } from '@/shared/stores/authPrompt';
import { silenceApiConsoleInfo } from '../../testing/silenceApiLogs';
import { installFetchGuard } from '../../testing/fetchGuard';

const fetchGuard = installFetchGuard();


export const flowProps: { current: Record<string, any> } = { current: {} };
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
vi.mock('../../components/Canvas', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));
vi.mock('../../components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));
vi.mock('../../components/CanvasToolbar', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));
vi.mock('../../components/CanvasHeader', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));
vi.mock('../../components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));
vi.mock('@/custom/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/custom/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));


vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sonner')>();
  return { ...actual, toast: { ...actual.toast, error: vi.fn() } };
});


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

vi.mock('@/custom/api/projects', () => ({
  fetchProjects: projectMocks.fetchProjects,
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  touchProjectLastOpened: projectMocks.touchProjectLastOpened,
  pinProject: vi.fn(),
}));
vi.mock('@/custom/api/auth', () => ({
  fetchMe: authMocks.fetchMe,
  fetchCredits: authMocks.fetchCredits,
  toSessionUser: authMocks.toSessionUser,
}));
vi.mock('@/custom/api/canvas', () => ({
  applyPromptPreview: canvasMocks.applyPromptPreview,
  createConversationQuote: vi.fn(),
  saveCanvasDoc: canvasMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn((edges: Array<{ id: string; source: string; target: string; data?: unknown }>) =>
    JSON.stringify(edges.map((e) => JSON.parse(JSON.stringify(e)))),
  ),
}));
vi.mock('@/custom/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/custom/api/generation', () => ({
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
}));



const jobMocks = vi.hoisted(() => ({
  fetchJobs: vi.fn(async (_params?: FetchJobsParams): Promise<JobListData> => ({ records: [], total: 0, size: 20, current: 1 })),
  fetchJobStatus: vi.fn(),
  newIdempotencyKey: vi.fn(() => 'iki8l7-token'),
  cancelGenerationJob: vi.fn(async () => null),
  fetchFrameInterpolationCurrent: vi.fn(async (): Promise<FrameInterpolationCurrentData | null> => null),
}));
vi.mock('@/shared/api/idempotencyKey', () => ({
  newIdempotencyKey: jobMocks.newIdempotencyKey,
}));
vi.mock('@/custom/api/jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/custom/api/jobs')>();
  return {
    ...actual,
    fetchJobs: jobMocks.fetchJobs,
    fetchJobStatus: jobMocks.fetchJobStatus,
    cancelGenerationJob: jobMocks.cancelGenerationJob,
    createGenerationJob: vi.fn(),
    retryGenerationJob: vi.fn(),
    retryAudioMix: vi.fn(),
    createVideoEnhancement: vi.fn(),
    createFrameInterpolation: vi.fn(),
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
vi.mock('../../hooks/document/useCanvasDoc', () => ({
  useCanvasDoc: () => canvasDocMock.current,
}));


const fetchMock = vi.fn();
const jsonOk = (data: unknown) =>
  new Response(JSON.stringify({ code: 200, msg: 'ok', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
const jsonFail = (msg: string, status = 200) =>
  new Response(JSON.stringify({ code: 1, msg, data: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const MASK_ASSET = {
  asset_id: '901',
  status: 'ready',
  type: 'image',
  url: 'http://img/mask.png',
  width: 1600,
  height: 900,
  duration: null,
  mime: 'image/png',
  size: 32,
};

function routeFetch(routes: Array<{ method: string; match: string; respond: () => Response | Promise<Response> }>) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const route of routes) {
      if (url.includes(route.match)) return route.respond();
    }
    throw new Error(`未匹配 fetch 响应：${url}`);
  });
  fetchGuard.stub(fetchMock, routes.map(({ method, match }) => [method, match]));
}

function defaultRoutes(extra: Array<{ method: string; match: string; respond: () => Response | Promise<Response> }> = []) {
  routeFetch([
    ...extra,
    { method: 'POST', match: '/api/agent/assets/uploads/dedup', respond: () => jsonOk({ dedup: true, asset: MASK_ASSET }) },
    { method: 'POST', match: '/api/agent/assets/uploads/presign', respond: () => jsonFail('上传服务繁忙，请稍后重试') },
    { method: 'POST', match: '/api/projects/p1/image-erasures', respond: () => jsonOk({ job_id: 'j77', status: 'queued' }) },
    { method: 'GET', match: '/api/agent/assets', respond: () => jsonOk({ records: [], total: 0, size: 20, current: 1 }) },
  ]);
}


function enableReactActEnvironment() {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}
let root: Root | null = null;
let container: HTMLDivElement | null = null;
async function renderPage() {
  enableReactActEnvironment();
  const { default: CanvasPage } = await import('../../index');
  container = document.createElement('div');
  document.body.appendChild(container);
  const createdRoot = createRoot(container);
  root = createdRoot;
  toast.dismiss();

  await act(async () => {
    createdRoot.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }) },
        createElement(MemoryRouter, { initialEntries: ['/canvas?project=p1'] }, createElement(CanvasPage), createElement(Toaster, { duration: Infinity })),
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
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'i1',
          type: 'mediaNode',
          position: { x: 400, y: 0 },
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
      ],
      edges: [],
    },
    assets: { 5: { asset_id: 5, type: 'image', access_url: 'http://img/i1.png', width: 1600, height: 900 } },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

const mediaNodes = () => flowProps.current.mediaNodes as Node[];
const toolbar = () => document.body.querySelector('[data-testid="erase-toolbar"]');
const bodyBtn = (testId: string) => document.body.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;

async function eraseImage() {
  const image = mediaNodes().find((n) => n.id === 'i1')!;
  await act(async () => {
    ((image.data as Record<string, unknown>).onEraseImage as (nodeId: string) => void)('i1');
  });
}

function eraseEditing() {
  const image = mediaNodes().find((n) => n.id === 'i1')!;
  return (image.data as Record<string, unknown>).eraseEditing as {
    ops: Array<Record<string, unknown>>;
    onStrokeStart: (p: { x: number; y: number }) => void;
    onStrokeMove: (p: { x: number; y: number }) => void;
    onStrokeEnd: () => void;
  };
}

async function paintStroke() {
  const editing = eraseEditing();
  await act(async () => {
    editing.onStrokeStart({ x: 50, y: 60 });
    editing.onStrokeMove({ x: 120, y: 80 });
    editing.onStrokeEnd();
  });
}

async function click(testId: string) {
  await act(async () => {
    bodyBtn(testId).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

const pngBytes = () => {
  const head = new Uint8Array(32);
  head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return head.slice().buffer as ArrayBuffer;
};

function stubControlledToBlob() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '', strokeStyle: '', lineCap: '', lineJoin: '', lineWidth: 0,
    fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  let pending: Array<(blob: Blob | null) => void> = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    function (this: HTMLCanvasElement, callback: (blob: Blob | null) => void) {
      pending.push(callback);
    } as HTMLCanvasElement['toBlob'],
  );
  return {
    release(blob: Blob | null) {
      const callbacks = pending;
      pending = [];
      for (const cb of callbacks) cb(blob);
    },
  };
}

beforeEach(() => {
  silenceApiConsoleInfo();
  enableReactActEnvironment();
  localStorage.clear();
  sessionStorage.clear();
  seedProjectA();
  fetchMock.mockReset();
  defaultRoutes();
  jobMocks.fetchJobStatus.mockReset();
  jobMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j77', status: 'processing', progress: 1, asset: null });
});

afterEach(async () => {
  await unmountPage();
  fetchGuard.unstubGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  useAuthPromptStore.getState().reset();
  useAuthStore.setState({ user: null, isNewUser: false, credits: null });
});

describe('IKI8L7 擦除（真实 API/HTTP 链）：迟到失败全链路静默', () => {
  it('迟到上传失败（presign 业务失败）：HTTP 层与页面都不弹，新会话存活', async () => {
    defaultRoutes([{ method: 'POST', match: '/api/agent/assets/uploads/dedup', respond: () => jsonOk({ dedup: false }) }]);
    const encode = stubControlledToBlob();
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn');
    await click('erase-close');
    await eraseImage();
    await paintStroke();
    encode.release(new Blob([pngBytes()], { type: 'image/png' }));
    await flush();
    expect(toast.error).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('上传服务繁忙');
    expect(toolbar()).not.toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/image-erasures'))).toBe(false);
    expect(mediaNodes().length).toBe(1);
    expect(bodyBtn('erase-send-btn').disabled).toBe(false);
  });

  it('迟到创建失败（业务失败信封）：HTTP 层与页面都不弹，新会话存活', async () => {
    let settleCreate!: (value: Response) => void;
    defaultRoutes([
      { method: 'POST', match: '/api/projects/p1/image-erasures', respond: () => new Promise<Response>((resolve) => { settleCreate = resolve; }) },
    ]);
    const encode = stubControlledToBlob();
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn');
    await click('erase-close');
    await eraseImage();
    await paintStroke();
    encode.release(new Blob([pngBytes()], { type: 'image/png' }));
    await flush();
    expect(toolbar()).not.toBeNull();
    await act(async () => { settleCreate(jsonFail('擦除服务维护中')); });
    await flush();
    expect(toast.error).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('擦除服务维护中');
    expect(toolbar()).not.toBeNull();
    expect(mediaNodes().length).toBe(1);
  });

  it('迟到创建成功：旧任务按原输入建卡/连线收尾，新会话不动（真实链全链验证）', async () => {
    let settleCreate!: (value: Response) => void;
    defaultRoutes([
      { method: 'POST', match: '/api/projects/p1/image-erasures', respond: () => new Promise<Response>((resolve) => { settleCreate = resolve; }) },
    ]);
    const encode = stubControlledToBlob();
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn');
    await click('erase-close');
    await eraseImage();
    await paintStroke();
    encode.release(new Blob([pngBytes()], { type: 'image/png' }));
    await flush();
    await act(async () => { settleCreate(jsonOk({ job_id: 'j77', status: 'queued' })); });
    await flush();
    expect(toolbar()).not.toBeNull();
    expect(eraseEditing().ops.length).toBe(1);
    expect(mediaNodes().length).toBe(2);
    const edges = flowProps.current.edges as Array<{ source: string; target: string; data?: { origin?: string } }>;
    expect(edges.length).toBe(1);
    expect(edges[0]).toMatchObject({ source: 'i1' });
    expect(edges[0]!.data?.origin).toBe('image-erase');
    expect(jobMocks.fetchJobStatus).toHaveBeenCalledWith('j77');
    const dedupCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/uploads/dedup'));
    expect(dedupCall).toBeTruthy();
  });
});

describe('IKI8L7 擦除（真实 API/HTTP 链）：当前有效会话失败单源提示可重试', () => {
  it('当前会话上传失败：页面提示恰一次、HTTP 层不叠加，停留编辑态可重试', async () => {
    defaultRoutes([{ method: 'POST', match: '/api/agent/assets/uploads/dedup', respond: () => jsonOk({ dedup: false }) }]);
    const encode = stubControlledToBlob();
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn');
    encode.release(new Blob([pngBytes()], { type: 'image/png' }));
    await flush();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('上传服务繁忙，请稍后重试');
    expect(toolbar()).not.toBeNull();
    expect(bodyBtn('erase-send-btn').disabled).toBe(false);
    defaultRoutes();
    await click('erase-send-btn');
    encode.release(new Blob([pngBytes()], { type: 'image/png' }));
    await flush();
    expect(mediaNodes().length).toBe(2);
    expect(toolbar()).toBeNull();
  });

  it('当前会话创建失败：页面提示恰一次、HTTP 层不叠加，停留编辑态可重试', async () => {
    defaultRoutes([{ method: 'POST', match: '/api/projects/p1/image-erasures', respond: () => jsonFail('擦除服务维护中') }]);
    const encode = stubControlledToBlob();
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn');
    encode.release(new Blob([pngBytes()], { type: 'image/png' }));
    await flush();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('擦除服务维护中');
    expect(toolbar()).not.toBeNull();
    expect(bodyBtn('erase-send-btn').disabled).toBe(false);
    expect(mediaNodes().length).toBe(1);
    defaultRoutes();
    await click('erase-send-btn');
    encode.release(new Blob([pngBytes()], { type: 'image/png' }));
    await flush();
    expect(mediaNodes().length).toBe(2);
    expect(toolbar()).toBeNull();
  });
});
