// @vitest-environment jsdom
/* IKI8L7 擦除涂抹发送错误提示归属（真实 API/HTTP 链）：会话身份在遮罩编码前冻结后，
   迟到的上传/创建失败必须全链路静默（HTTP 层 sonner 不弹 + 页面 showToast 不弹），
   当前有效会话的失败由持有发送身份的页面 catch 提示恰一次（IKI8L4「silent 传输 +
   页面单源」在擦除编码冻结场景的延续）。

   与 eraseMaskFreezeSession.test.tsx 的结构性差异（本文件存在的理由）：那边的
   vi.mock('@/utils/upload') / vi.mock('@/api/jobs') 整体替换后 http.ts 层不跑，
   只能断言页面 toast——本文件沿用 IKI8L4 toolSessionErrorToastOwnership 的
   importOriginal 部分真实：uploadAssetFile / createImageErase 走真实
   utils/upload.ts → api/assets.ts / api/jobs.ts → api/http.ts doRequest，
   替身只在外部边界（window.fetch 与 sonner）；遮罩编码用受控 toBlob。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import type { FetchJobsParams, FrameInterpolationCurrentData, JobListData } from '@/api/jobs';
import type { GenerationModel } from '@/api/generation';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth';
import { useAuthPromptStore } from '@/stores/authPrompt';

/* ---------- 打桩：组件（同 harness 口径，Canvas 透出 props） ---------- */

export const flowProps: { current: Record<string, any> } = { current: {} };
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
}));
vi.mock('./components/Canvas', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));
vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
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

/* ---------- 打桩：非受测 API 模块（真实链只留 upload/assets/jobs/http） ---------- */

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
    JSON.stringify(edges.map((e) => JSON.parse(JSON.stringify(e)))),
  ),
}));
vi.mock('@/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/api/generation', () => ({
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
}));

/* 注意：@/api/assets 与 @/utils/upload 不 mock——上传链保持真实
   （uploadAssetFile → dedup/presign/PUT/complete → http.ts doRequest → 受控 fetch）。 */

/* ---------- 打桩：@/api/jobs 部分真实——createImageErase 走真实 http 层 ---------- */

const jobMocks = vi.hoisted(() => ({
  fetchJobs: vi.fn(async (_params?: FetchJobsParams): Promise<JobListData> => ({ records: [], total: 0, size: 20, current: 1 })),
  fetchJobStatus: vi.fn(),
  newIdempotencyKey: vi.fn(() => 'iki8l7-token'),
  cancelGenerationJob: vi.fn(async () => null),
  fetchFrameInterpolationCurrent: vi.fn(async (): Promise<FrameInterpolationCurrentData | null> => null),
}));
vi.mock('@/api/idempotencyKey', () => ({
  newIdempotencyKey: jobMocks.newIdempotencyKey,
}));
vi.mock('@/api/jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/jobs')>();
  return {
    ...actual,
    // 页面水合/轮询/幂等键走 mock，避免真实 fetch 干扰受控用例
    fetchJobs: jobMocks.fetchJobs,
    fetchJobStatus: jobMocks.fetchJobStatus,
    cancelGenerationJob: jobMocks.cancelGenerationJob,
    createGenerationJob: vi.fn(),
    retryGenerationJob: vi.fn(),
    retryAudioMix: vi.fn(),
    createVideoEnhancement: vi.fn(),
    createFrameInterpolation: vi.fn(),
    fetchFrameInterpolationCurrent: jobMocks.fetchFrameInterpolationCurrent,
    // createImageErase（及未列出的其余键）保持真实实现：
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
/** 业务失败信封：产品包络 code!==200 + msg（HTTP 200 或 5xx 皆可触发 doRequest 业务错误支） */
const jsonFail = (msg: string, status = 200) =>
  new Response(JSON.stringify({ code: 1, msg, data: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** 上传链 dedup 命中即可一步完成上传（跳过 presign→PUT→complete 与 jsdom 无法加载的
 *  probeMediaMeta）；上传失败注入走 dedup:false → presign 业务失败。 */
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

/** 按端点路由的受控 fetch：routes 顺序匹配（首个命中生效），其余默认空信封兜底 */
function routeFetch(routes: Array<{ match: string; respond: () => Response | Promise<Response> }>) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const route of routes) {
      if (url.includes(route.match)) return route.respond();
    }
    return jsonOk(null);
  });
}

/** 默认路由：上传链 dedup 命中（一步成功）+ 创建成功；资产列表端点回空页 */
function defaultRoutes(extra: Array<{ match: string; respond: () => Response | Promise<Response> }> = []) {
  routeFetch([
    ...extra,
    { match: '/uploads/dedup', respond: () => jsonOk({ dedup: true, asset: MASK_ASSET }) },
    { match: '/uploads/presign', respond: () => jsonFail('上传服务繁忙，请稍后重试') },
    { match: '/image-erasures', respond: () => jsonOk({ job_id: 'j77', status: 'queued' }) },
    { match: '/api/agent/assets', respond: () => jsonOk({ records: [], total: 0, size: 20, current: 1 }) },
  ]);
}

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

/* ---------- 画布 seed 与擦除操作助手 ---------- */

/** 项目一画布：图片卡 i1（1600×900 png，assetId='5'） */
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

/** 一份最小的真 PNG 头（uploadAssetFile 发请求前会读文件开头认容器，'abcd' 过不去） */
const pngBytes = () => {
  const head = new Uint8Array(32);
  head.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return head.slice().buffer as ArrayBuffer;
};

/** 受控 canvas 编码：toBlob 扣下回调手动放行（编码在途窗口） */
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
  enableReactActEnvironment();
  localStorage.clear();
  sessionStorage.clear();
  seedProjectA();
  fetchMock.mockReset();
  defaultRoutes();
  vi.stubGlobal('fetch', fetchMock);
  jobMocks.fetchJobStatus.mockReset();
  jobMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j77', status: 'processing', progress: 1, asset: null });
});

afterEach(async () => {
  await unmountPage();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  useAuthPromptStore.getState().reset();
  useAuthStore.setState({ user: null, isNewUser: false, credits: null });
});

describe('IKI8L7 擦除（真实 API/HTTP 链）：迟到失败全链路静默', () => {
  it('迟到上传失败（presign 业务失败）：HTTP 层与页面都不弹，新会话存活', async () => {
    defaultRoutes([{ match: '/uploads/dedup', respond: () => jsonOk({ dedup: false }) }]);
    const encode = stubControlledToBlob();
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn');
    await click('erase-close'); // X 关旧会话（编码仍在途）
    await eraseImage(); // 同卡重开新会话
    await paintStroke();
    encode.release(new Blob([pngBytes()], { type: 'image/png' }));
    await flush();
    // HTTP 层（sonner）不弹：silent 传输（IKI8L4）+ 迟到静默双守
    expect(toast.error).not.toHaveBeenCalled();
    // 页面层旧错误同样静默：不向新会话弹「上传服务繁忙」（修订前：编码后 capture 新纪元 → 提示弹出）
    expect(document.body.textContent).not.toContain('上传服务繁忙');
    expect(toolbar()).not.toBeNull();
    // 未成功受理不伪造成功：无创建请求、不建卡
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/image-erasures'))).toBe(false);
    expect(mediaNodes().length).toBe(1);
    // 新会话不被旧回调设为提交中
    expect(bodyBtn('erase-send-btn').disabled).toBe(false);
  });

  it('迟到创建失败（业务失败信封）：HTTP 层与页面都不弹，新会话存活', async () => {
    let settleCreate!: (value: Response) => void;
    defaultRoutes([
      { match: '/image-erasures', respond: () => new Promise<Response>((resolve) => { settleCreate = resolve; }) },
    ]);
    const encode = stubControlledToBlob();
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn'); // 编码挂起（退出重开发生在编码期间才是缺陷窗口）
    await click('erase-close'); // 关旧会话（编码仍在途）
    await eraseImage(); // 同卡重开新会话
    await paintStroke();
    encode.release(new Blob([pngBytes()], { type: 'image/png' })); // 编码完成 → 上传（dedup 命中）→ 创建挂起
    await flush();
    expect(toolbar()).not.toBeNull(); // 创建在途：新会话保持打开
    await act(async () => { settleCreate(jsonFail('擦除服务维护中')); });
    await flush();
    expect(toast.error).not.toHaveBeenCalled();
    // 修订前：编码后 capture 拿到新会话纪元 → 旧失败以新会话名义弹出
    expect(document.body.textContent).not.toContain('擦除服务维护中');
    expect(toolbar()).not.toBeNull();
    expect(mediaNodes().length).toBe(1); // 创建失败不建卡
  });

  it('迟到创建成功：旧任务按原输入建卡/连线收尾，新会话不动（真实链全链验证）', async () => {
    let settleCreate!: (value: Response) => void;
    defaultRoutes([
      { match: '/image-erasures', respond: () => new Promise<Response>((resolve) => { settleCreate = resolve; }) },
    ]);
    const encode = stubControlledToBlob();
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn'); // 编码挂起
    await click('erase-close'); // 关旧会话（编码仍在途）
    await eraseImage(); // 同卡重开新会话
    await paintStroke();
    encode.release(new Blob([pngBytes()], { type: 'image/png' })); // 编码完成 → 上传 → 创建挂起
    await flush();
    await act(async () => { settleCreate(jsonOk({ job_id: 'j77', status: 'queued' })); });
    await flush();
    // 新会话存活、新涂抹不变
    expect(toolbar()).not.toBeNull();
    expect(eraseEditing().ops.length).toBe(1);
    // 旧任务收尾：结果卡 + image-erase 来源线 + 轮询启动
    expect(mediaNodes().length).toBe(2);
    const edges = flowProps.current.edges as Array<{ source: string; target: string; data?: { origin?: string } }>;
    expect(edges.length).toBe(1);
    expect(edges[0]).toMatchObject({ source: 'i1' });
    expect(edges[0]!.data?.origin).toBe('image-erase');
    expect(jobMocks.fetchJobStatus).toHaveBeenCalledWith('j77');
    // 上传走的是真实链：dedup 端点收到带 md5 的预检（mask 上传确实发出）
    const dedupCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/uploads/dedup'));
    expect(dedupCall).toBeTruthy();
  });
});

describe('IKI8L7 擦除（真实 API/HTTP 链）：当前有效会话失败单源提示可重试', () => {
  it('当前会话上传失败：页面提示恰一次、HTTP 层不叠加，停留编辑态可重试', async () => {
    defaultRoutes([{ match: '/uploads/dedup', respond: () => jsonOk({ dedup: false }) }]);
    const encode = stubControlledToBlob();
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn');
    encode.release(new Blob([pngBytes()], { type: 'image/png' }));
    await flush();
    // 页面单源：持有发送身份的 catch 提示一次（silent 传输下 HTTP 层不弹）
    expect(document.body.textContent).toContain('上传服务繁忙，请稍后重试');
    expect(toast.error).not.toHaveBeenCalled();
    expect(toolbar()).not.toBeNull();
    expect(bodyBtn('erase-send-btn').disabled).toBe(false); // 提交锁复位可重试
    // 可重试：恢复 dedup 命中后再次发送成功退出
    defaultRoutes();
    await click('erase-send-btn');
    encode.release(new Blob([pngBytes()], { type: 'image/png' }));
    await flush();
    expect(mediaNodes().length).toBe(2);
    expect(toolbar()).toBeNull();
  });

  it('当前会话创建失败：页面提示恰一次、HTTP 层不叠加，停留编辑态可重试', async () => {
    defaultRoutes([{ match: '/image-erasures', respond: () => jsonFail('擦除服务维护中') }]);
    const encode = stubControlledToBlob();
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn');
    encode.release(new Blob([pngBytes()], { type: 'image/png' }));
    await flush();
    expect(document.body.textContent).toContain('擦除服务维护中');
    expect(toast.error).not.toHaveBeenCalled();
    expect(toolbar()).not.toBeNull();
    expect(bodyBtn('erase-send-btn').disabled).toBe(false);
    expect(mediaNodes().length).toBe(1); // 失败不建卡
    // 可重试：恢复创建成功后再次发送退出
    defaultRoutes();
    await click('erase-send-btn');
    encode.release(new Blob([pngBytes()], { type: 'image/png' }));
    await flush();
    expect(mediaNodes().length).toBe(2);
    expect(toolbar()).toBeNull();
  });
});
