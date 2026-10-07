// @vitest-environment jsdom
/* IKI8L7 擦除涂抹发送：会话身份与发送输入在遮罩首个异步编码步骤（canvas.toBlob）之前
   冻结。修订前 capture('erase')、目标卡 nodeId、源资产 assetId 全在编码完成后才读取——
   用户发送后编码在途时退出并重开同一卡片的擦除会话，旧编码回调拿到新会话纪元与目标卡，
   全链 isCurrent 恒真，旧任务以新会话名义创建并在成功后关闭新会话（新涂抹被清掉）。
   本文件用受控 toBlob（回调扣下、手动放行）构造「编码在途」窗口，复用真实 CanvasPage +
   真实 ImageEraseDialog 页面链路（夹具沿用 eraseEdit.test.tsx，不复制业务状态模型）。
   错误提示归属的真实 API/HTTP 链版本（真实 upload/assets/jobs/http，只替换 fetch）
   见 eraseMaskFreezeErrorChain.test.tsx。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { ApiError } from '@/api/http';
import type { GenerationModel } from '@/api/generation';

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
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createAudioTrim: vi.fn(),
  createImageErase: vi.fn(),
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
  createAudioTrim: apiMocks.createAudioTrim,
  createImageErase: apiMocks.createImageErase,
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

vi.mock('@/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    queryFn: async () => ({ credits: null }),
  })),
}));

vi.mock('@/api/canvasRecovery', async (importActual) => ({
  ...(await importActual<typeof import('@/api/canvasRecovery')>()),
  fetchGenerationRecoveryPage: vi.fn(async () => ({
    protocol_version: 1,
    canvas_version: null,
    records: [],
    next_cursor: null,
  })),
  generationRecoveryPageOptions: vi.fn(() => ({
    queryKey: ['generation-recovery', 'mock'],
    queryFn: async () => ({ records: [], next_cursor: null }),
  })),
}));
vi.mock('./hooks/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

/** 画布：一个就绪图片节点 i1（1600×900 png，assetId 数字串满足擦除契约） */
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

/** 进入擦除编辑态（画质工具横排「擦除」按钮派发的回调，IKH3XZ） */
async function eraseImage() {
  const image = flowProps.current.mediaNodes.find((n: Node) => n.id === 'i1')!;
  await act(async () => {
    image.data.onEraseImage('i1');
  });
}

/** 目标源图卡上注入的遮罩编辑回调（渲染期派生，不持久化） */
function eraseEditing() {
  const image = (flowProps.current.mediaNodes as Node[]).find((n) => n.id === 'i1')!;
  return (image.data as Record<string, unknown>).eraseEditing as {
    ops: Array<Record<string, unknown>>;
    onStrokeStart: (p: { x: number; y: number }) => void;
    onStrokeMove: (p: { x: number; y: number }) => void;
    onStrokeEnd: () => void;
  };
}

/** 经遮罩层回调涂抹一笔（画笔：两点折线） */
async function paintStroke() {
  const editing = eraseEditing();
  await act(async () => {
    editing.onStrokeStart({ x: 50, y: 60 });
    editing.onStrokeMove({ x: 120, y: 80 });
    editing.onStrokeEnd();
  });
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
  return document.body.querySelector('[data-testid="erase-toolbar"]');
}

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

/** 受控 canvas 编码：getContext 桩 2d；toBlob 把回调扣下不执行（编码在途），
 *  release(blob) 手动放行全部挂起回调——blob=null 即「编码完成但没有产物」。 */
function stubControlledToBlob() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '',
    strokeStyle: '',
    lineCap: '',
    lineJoin: '',
    lineWidth: 0,
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  let pending: Array<(blob: Blob | null) => void> = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    function (this: HTMLCanvasElement, callback: (blob: Blob | null) => void) {
      pending.push(callback);
    } as HTMLCanvasElement['toBlob'],
  );
  return {
    pendingCount: () => pending.length,
    release(blob: Blob | null) {
      const callbacks = pending;
      pending = [];
      for (const cb of callbacks) cb(blob);
    },
  };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiMocks.uploadAssetFile.mockReset();
  apiMocks.createImageErase.mockReset();
  apiMocks.fetchJobStatus.mockReset();
  apiMocks.uploadAssetFile.mockResolvedValue({
    asset_id: '901',
    status: 'ready',
    type: 'image',
    url: 'http://img/mask.png',
    width: 1600,
    height: 900,
    duration: null,
    mime: 'image/png',
    size: 100,
  });
  apiMocks.createImageErase.mockResolvedValue({ job_id: 'j77', status: 'queued' });
  // 轮询一次拍即终态：断言「轮询已启动」用，不在测试里挂续拍 timer
  apiMocks.fetchJobStatus.mockResolvedValue({
    job_id: 'j77',
    status: 'succeeded',
    progress: 100,
    asset: { id: 'a9', url: 'http://img/out.png', type: 'image', width: 1600, height: 900 },
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKI8L7 涂抹发送：遮罩编码前冻结会话身份', () => {
  it('同卡重开：旧编码完成后不关新会话、新涂抹不变；旧任务按原输入照常收尾（主回归）', async () => {
    const encode = stubControlledToBlob();
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn'); // 旧会话发送 → 编码挂起（窗口开启）
    expect(encode.pendingCount()).toBe(1);
    expect(apiMocks.uploadAssetFile).not.toHaveBeenCalled(); // 编码未完成不进上传
    await click('erase-close'); // X 关旧会话（编码仍在途）
    await eraseImage(); // 同卡重开新会话
    await paintStroke(); // 新会话新涂抹
    encode.release(new Blob(['old-mask'], { type: 'image/png' })); // 旧编码完成
    await flush();
    // 新会话保持打开，新涂抹不被旧回调清掉（修订前：旧回调以新会话身份 exitEraseEditing）
    expect(toolbar()).not.toBeNull();
    expect(eraseEditing().ops.length).toBe(1);
    // 旧编码结果不把新会话设为提交中：新会话可再次发送
    expect(bodyBtn('erase-send-btn').disabled).toBe(false);
    // 旧任务按原输入收尾：遮罩上传 → 创建（冻结的源资产身份）→ 建卡 → 连线 → 轮询
    expect(apiMocks.uploadAssetFile).toHaveBeenCalledTimes(1);
    const [file, opts] = apiMocks.uploadAssetFile.mock.calls[0]! as [File, { assetSource?: string }];
    expect(file).toBeInstanceOf(File);
    expect(file.type).toBe('image/png');
    expect(opts?.assetSource).toBe('mask_erase');
    expect(apiMocks.createImageErase).toHaveBeenCalledTimes(1);
    const [, payload] = apiMocks.createImageErase.mock.calls[0]! as [string, Record<string, string>];
    expect(payload).toMatchObject({
      erase_scene: 'selected_area_erase',
      source_asset_id: '5',
      mask_asset_id: '901',
    });
    const nodes = flowProps.current.mediaNodes as Node[];
    expect(nodes.length).toBe(2);
    const result = nodes.find((n) => n.id !== 'i1')!;
    expect(result.id).toBe(payload.target_node_id);
    const edges = flowProps.current.edges as Array<{ source: string; target: string; data?: { origin?: string } }>;
    expect(edges.length).toBe(1);
    expect(edges[0]).toMatchObject({ source: 'i1', target: result.id });
    expect(edges[0]!.data?.origin).toBe('image-erase');
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j77');
  });

  it('迟到回调继续上传时不把新会话设为提交中；旧上传成功后任务照常收尾', async () => {
    const encode = stubControlledToBlob();
    let resolveUpload!: (value: unknown) => void;
    apiMocks.uploadAssetFile.mockImplementationOnce(() => new Promise((resolve) => { resolveUpload = resolve; }));
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn');
    await click('erase-close');
    await eraseImage();
    await paintStroke();
    encode.release(new Blob(['old-mask'], { type: 'image/png' }));
    await flush();
    // 旧回调在上传中：新会话不被设为提交中（修订前：setEraseSubmitting(true) 锁死新会话控件）
    expect(apiMocks.uploadAssetFile).toHaveBeenCalledTimes(1);
    expect(bodyBtn('erase-send-btn').disabled).toBe(false);
    expect(bodyBtn('erase-clear-text').disabled).toBe(false);
    // 释放旧上传（成功）：任务收尾完成，新会话不动
    await act(async () => {
      resolveUpload({
        asset_id: '901', status: 'ready', type: 'image', url: 'http://img/mask.png',
        width: 1600, height: 900, duration: null, mime: 'image/png', size: 100,
      });
    });
    await flush();
    expect(toolbar()).not.toBeNull();
    expect(apiMocks.createImageErase).toHaveBeenCalledTimes(1);
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j77');
  });

  it('迟到上传失败：不向新会话提示、不建卡（未成功受理不伪造成功）', async () => {
    const encode = stubControlledToBlob();
    apiMocks.uploadAssetFile.mockRejectedValueOnce(new Error('upload down'));
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn');
    await click('erase-close');
    await eraseImage();
    await paintStroke();
    encode.release(new Blob(['old-mask'], { type: 'image/png' }));
    await flush();
    expect(toolbar()).not.toBeNull();
    expect(document.body.textContent).not.toContain('遮罩上传失败');
    expect(apiMocks.createImageErase).not.toHaveBeenCalled();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(bodyBtn('erase-send-btn').disabled).toBe(false);
  });

  it('迟到创建失败：不退新会话、不向它提示旧错误', async () => {
    const encode = stubControlledToBlob();
    apiMocks.createImageErase.mockRejectedValueOnce(new ApiError(500, '擦除服务繁忙'));
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn');
    await click('erase-close');
    await eraseImage();
    await paintStroke();
    encode.release(new Blob(['old-mask'], { type: 'image/png' }));
    await flush();
    expect(toolbar()).not.toBeNull();
    expect(document.body.textContent).not.toContain('擦除服务繁忙');
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1); // 失败不建卡
  });

  it('迟到编码无产物（toBlob 回调 null）：旧失败不向新会话提示、不进上传', async () => {
    const encode = stubControlledToBlob();
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn');
    await click('erase-close');
    await eraseImage();
    await paintStroke();
    encode.release(null);
    await flush();
    expect(toolbar()).not.toBeNull();
    expect(document.body.textContent).not.toContain('遮罩生成失败');
    expect(apiMocks.uploadAssetFile).not.toHaveBeenCalled();
    expect(apiMocks.createImageErase).not.toHaveBeenCalled();
  });

  it('迟到编码失败（2d 上下文不可用）：同口径静默', async () => {
    // context null：栅格化在离屏 canvas 创建即失败、同步 resolve(null)——回调在首个微任务
    // 返回（窗口比 toBlob 窄得多）。把退出+重开压进同一轮同步栈（微任务放行前），验证
    // 旧失败仍按编码前捕获的快照静默，不向新会话提示。
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await renderPage();
    await eraseImage();
    await paintStroke();
    await act(async () => {
      bodyBtn('erase-send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true })); // 捕获旧纪元 → 栅格化挂起（微任务后 resolve(null)）
      bodyBtn('erase-close').dispatchEvent(new MouseEvent('click', { bubbles: true })); // 退出：纪元 +1
      flowProps.current.mediaNodes.find((n: Node) => n.id === 'i1')!.data.onEraseImage('i1'); // 同卡重开：纪元再 +1
    });
    await flush();
    expect(toolbar()).not.toBeNull();
    expect(document.body.textContent).not.toContain('遮罩生成失败');
    expect(apiMocks.uploadAssetFile).not.toHaveBeenCalled();
    expect(apiMocks.createImageErase).not.toHaveBeenCalled();
  });
});

describe('IKI8L7 当前有效会话：发送/退出/重试行为不变', () => {
  it('当前会话编码无产物：提示可重试，重试成功后正常退出建卡', async () => {
    const encode = stubControlledToBlob();
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn');
    encode.release(null);
    await flush();
    expect(document.body.textContent).toContain('遮罩生成失败，请重试');
    expect(toolbar()).not.toBeNull(); // 停留编辑态
    expect(bodyBtn('erase-send-btn').disabled).toBe(false);
    await click('erase-send-btn'); // 可重试：同涂抹再次发送
    encode.release(new Blob(['mask2'], { type: 'image/png' }));
    await flush();
    expect(apiMocks.createImageErase).toHaveBeenCalledTimes(1);
    expect(toolbar()).toBeNull(); // 成功退出编辑态
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
  });

  it('当前会话上传失败：提示一次、停留编辑态，重试成功退出', async () => {
    const encode = stubControlledToBlob();
    apiMocks.uploadAssetFile.mockRejectedValueOnce(new Error('boom'));
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn');
    encode.release(new Blob(['mask'], { type: 'image/png' }));
    await flush();
    expect(document.body.textContent).toContain('遮罩上传失败，请重试');
    expect(toolbar()).not.toBeNull();
    expect(bodyBtn('erase-send-btn').disabled).toBe(false); // 提交锁复位可重试
    await click('erase-send-btn');
    encode.release(new Blob(['mask'], { type: 'image/png' }));
    await flush();
    expect(apiMocks.createImageErase).toHaveBeenCalledTimes(1);
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
  });

  it('当前会话创建失败：提示一次、停留编辑态可重试', async () => {
    const encode = stubControlledToBlob();
    apiMocks.createImageErase.mockRejectedValueOnce(
      new ApiError(400, '图片长边超过 2560 或短边超过 1440 像素上限'),
    );
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn');
    encode.release(new Blob(['mask'], { type: 'image/png' }));
    await flush();
    expect(document.body.textContent).toContain('图片长边超过 2560');
    expect(toolbar()).not.toBeNull();
    expect(bodyBtn('erase-send-btn').disabled).toBe(false);
    await click('erase-send-btn');
    encode.release(new Blob(['mask'], { type: 'image/png' }));
    await flush();
    expect(apiMocks.createImageErase).toHaveBeenCalledTimes(2);
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
  });
});

describe('IKI8L7 一键清除文字（无编码步骤路）：发送瞬间身份不受影响', () => {
  it('不经遮罩编码：toBlob 从未被调，直发建卡', async () => {
    const encode = stubControlledToBlob();
    await renderPage();
    await eraseImage();
    await click('erase-clear-text');
    await flush();
    expect(encode.pendingCount()).toBe(0);
    expect(apiMocks.uploadAssetFile).not.toHaveBeenCalled();
    expect(apiMocks.createImageErase).toHaveBeenCalledTimes(1);
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
  });

  it('同卡重开：一键路迟到成功不关新会话、旧任务照常收尾（发送瞬间 capture 已冻结）', async () => {
    stubControlledToBlob();
    let resolveCreate!: (value: { job_id: string; status: string }) => void;
    apiMocks.createImageErase.mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve; }));
    await renderPage();
    await eraseImage();
    await click('erase-clear-text'); // 一键发送，创建挂起
    expect(toolbar()).not.toBeNull(); // 创建在途，编辑态保持（成功 settle 才退出）
    await click('erase-close'); // X 关旧会话
    await eraseImage(); // 同卡重开新会话
    await paintStroke(); // 新会话涂抹
    await act(async () => { resolveCreate({ job_id: 'j77', status: 'queued' }); });
    await flush();
    expect(toolbar()).not.toBeNull(); // 新会话存活
    expect(eraseEditing().ops.length).toBe(1);
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2); // 旧任务建卡收尾
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j77');
  });
});

it('遮罩编码窗口同步防重：同帧双击只编码一次，输入未上传时界面已锁住', async () => {
  const encode = stubControlledToBlob();
  await renderPage(); await eraseImage(); await paintStroke();
  await act(async () => {
    bodyBtn('erase-send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    bodyBtn('erase-send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(encode.pendingCount()).toBe(1);
  expect(bodyBtn('erase-send-btn').disabled).toBe(true);
  expect(apiMocks.uploadAssetFile).not.toHaveBeenCalled();
  await act(async () => { encode.release(new Blob(['mask'], { type: 'image/png' })); });
  await flush();
  expect(apiMocks.createImageErase).toHaveBeenCalledTimes(1);
  expect(toolbar()).toBeNull();
});
