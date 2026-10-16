// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../../index';
import { ApiError } from '@/shared/api/http';
import type { GenerationModel } from '@/custom/api/generation';
import { Toaster, toast } from 'sonner';

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
vi.mock('../../components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('../../components/Canvas', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
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
vi.mock('@/custom/api/jobs', () => ({
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
  toast.dismiss();

  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(MemoryRouter, null, createElement(CanvasPage), createElement(Toaster, { duration: Infinity })),
      ),
    );
  });
}

async function eraseImage() {
  const image = flowProps.current.mediaNodes.find((n: Node) => n.id === 'i1')!;
  await act(async () => {
    image.data.onEraseImage('i1');
  });
}

function eraseEditing() {
  const image = (flowProps.current.mediaNodes as Node[]).find((n) => n.id === 'i1')!;
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
    await click('erase-send-btn');
    expect(encode.pendingCount()).toBe(1);
    expect(apiMocks.uploadAssetFile).not.toHaveBeenCalled();
    await click('erase-close');
    await eraseImage();
    await paintStroke();
    encode.release(new Blob(['old-mask'], { type: 'image/png' }));
    await flush();
    expect(toolbar()).not.toBeNull();
    expect(eraseEditing().ops.length).toBe(1);
    expect(bodyBtn('erase-send-btn').disabled).toBe(false);
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
    expect(apiMocks.uploadAssetFile).toHaveBeenCalledTimes(1);
    expect(bodyBtn('erase-send-btn').disabled).toBe(false);
    expect(bodyBtn('erase-clear-text').disabled).toBe(false);
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
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
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
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    await renderPage();
    await eraseImage();
    await paintStroke();
    await act(async () => {
      bodyBtn('erase-send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      bodyBtn('erase-close').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      flowProps.current.mediaNodes.find((n: Node) => n.id === 'i1')!.data.onEraseImage('i1');
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
    await vi.waitFor(() => expect(document.body.textContent).toContain('遮罩生成失败，请重试'), { timeout: 3000 });
    expect(toolbar()).not.toBeNull();
    expect(bodyBtn('erase-send-btn').disabled).toBe(false);
    await click('erase-send-btn');
    encode.release(new Blob(['mask2'], { type: 'image/png' }));
    await flush();
    expect(apiMocks.createImageErase).toHaveBeenCalledTimes(1);
    expect(toolbar()).toBeNull();
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
    await vi.waitFor(() => expect(document.body.textContent).toContain('遮罩上传失败，请重试'), { timeout: 3000 });
    expect(toolbar()).not.toBeNull();
    expect(bodyBtn('erase-send-btn').disabled).toBe(false);
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
    await vi.waitFor(() => expect(document.body.textContent).toContain('图片长边超过 2560'), { timeout: 3000 });
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
    await click('erase-clear-text');
    expect(toolbar()).not.toBeNull();
    await click('erase-close');
    await eraseImage();
    await paintStroke();
    await act(async () => { resolveCreate({ job_id: 'j77', status: 'queued' }); });
    await flush();
    expect(toolbar()).not.toBeNull();
    expect(eraseEditing().ops.length).toBe(1);
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
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
