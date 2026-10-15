// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import type { GenerationModel } from '@/app/api/generation';
import { imageMediaRefsOf } from './mediaRefs';

vi.mock('@/app/api/generationQuote', async (importActual) => ({
  ...(await importActual<typeof import('@/app/api/generationQuote')>()),
  generationQuoteOptions: vi.fn(() => ({
    queryKey: ['generation-quote', 'mock'],
    staleTime: Infinity,
    queryFn: async () => ({ credits: null, quote_revision: null }),
  })),
}));

vi.mock('@/app/api/canvasRecovery', async (importActual) => ({
  ...(await importActual<typeof import('@/app/api/canvasRecovery')>()),
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
vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

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

vi.mock('@/app/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/app/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

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

vi.mock('@/app/api/projects', () => ({
  touchProjectLastOpened: vi.fn(async () => undefined),
  pinProject: vi.fn(async () => undefined),
  fetchProjects: apiMocks.fetchProjects,
  createProject: apiMocks.createProject,
  renameProject: apiMocks.renameProject,
  deleteProject: apiMocks.deleteProject,
}));
vi.mock('@/app/api/auth', () => ({
  fetchMe: apiMocks.fetchMe,
  fetchCredits: apiMocks.fetchCredits,
  toSessionUser: apiMocks.toSessionUser,
}));
vi.mock('@/app/api/assets', () => ({
  UPLOAD_SIZE_LIMIT: 100 * 1024 * 1024,
  fetchUploadPresign: vi.fn(),
  putToPresignedUrl: vi.fn(),
  completeUpload: vi.fn(),
  fetchAllAssets: vi.fn(async () => []),
  fetchAssetDetail: vi.fn(),
  linkAssetToProject: vi.fn(),
}));

vi.mock('@/app/api/canvas', () => ({
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
vi.mock('@/app/api/jobs', () => ({
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
vi.mock('@/app/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/app/api/generation', () => ({ fetchGenerationModels: apiMocks.fetchGenerationModels }));
vi.mock('@/app/utils/upload', () => ({ uploadAssetFile: apiMocks.uploadAssetFile }));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('./hooks/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

function seedDoc(withDims = true) {
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
            ...(withDims ? { width: 1600, height: 900 } : {}),
            mime: 'image/png',
          },
        },
      ],
      edges: [],
    },
    assets: withDims
      ? { 5: { asset_id: 5, type: 'image', access_url: 'http://img/i1.png', width: 1600, height: 900 } }
      : { 5: { asset_id: 5, type: 'image', access_url: 'http://img/i1.png' } },
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

function stubCanvas() {
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
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    function (this: HTMLCanvasElement, callback: (blob: Blob | null) => void) {
      callback(new Blob(['mask'], { type: 'image/png' }));
    } as HTMLCanvasElement['toBlob'],
  );
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  stubCanvas();
  apiMocks.uploadAssetFile.mockReset();
  apiMocks.createImageErase.mockReset();
  apiMocks.fetchJobStatus.mockReset();
  apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j77', status: 'processing', progress: 0, asset: null });
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
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKGOTB 编辑态工具与遮罩编辑', () => {
  it('工具条完整呈现：清除文字/画笔/框选/橡皮擦/笔刷大小/撤销重做；发送条含本期免费与发送', async () => {
    await renderPage();
    await eraseImage();
    for (const id of ['erase-clear-text', 'erase-tool-brush', 'erase-tool-rect', 'erase-tool-eraser', 'erase-brush-size', 'erase-undo', 'erase-redo', 'erase-close']) {
      expect(bodyBtn(id), id).toBeTruthy();
    }
    expect(document.body.querySelector('[data-testid="erase-send-bar"]')!.textContent).toContain('本期免费');
    expect(bodyBtn('erase-send-btn')).toBeTruthy();
  });

  it('画笔/框选/橡皮三选一互斥：当前工具唯一激活', async () => {
    await renderPage();
    await eraseImage();
    expect(bodyBtn('erase-tool-brush').getAttribute('aria-pressed')).toBe('true');
    expect(bodyBtn('erase-tool-rect').getAttribute('aria-pressed')).toBe('false');
    await click('erase-tool-rect');
    expect(bodyBtn('erase-tool-rect').getAttribute('aria-pressed')).toBe('true');
    expect(bodyBtn('erase-tool-brush').getAttribute('aria-pressed')).toBe('false');
    await click('erase-tool-eraser');
    expect(bodyBtn('erase-tool-eraser').getAttribute('aria-pressed')).toBe('true');
    expect(bodyBtn('erase-tool-rect').getAttribute('aria-pressed')).toBe('false');
  });

  it('涂抹落笔进遮罩栈；撤销弹栈、重做复栈', async () => {
    await renderPage();
    await eraseImage();
    expect(bodyBtn('erase-undo').disabled).toBe(true);
    await paintStroke();
    expect(eraseEditing().ops.length).toBe(1);
    expect(bodyBtn('erase-undo').disabled).toBe(false);
    await click('erase-undo');
    expect(eraseEditing().ops.length).toBe(0);
    expect(bodyBtn('erase-redo').disabled).toBe(false);
    await click('erase-redo');
    expect(eraseEditing().ops.length).toBe(1);
  });

  it('橡皮图元 erase=true 进栈（从并集减去）；笔刷大小滑杆可调', async () => {
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-tool-eraser');
    const editing = eraseEditing();
    await act(async () => {
      editing.onStrokeStart({ x: 60, y: 60 });
      editing.onStrokeEnd();
    });
    const ops = eraseEditing().ops;
    expect(ops.length).toBe(2);
    expect(ops[1]).toMatchObject({ kind: 'stroke', erase: true, radius: 20 });
    const range = document.body.querySelector<HTMLInputElement>('[data-testid="erase-brush-size"]')!;
    await act(async () => {
      range.value = '40';
      const tracker = (range as unknown as { _valueTracker?: { setValue(v: string): void } })._valueTracker;
      tracker?.setValue('');
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const editing2 = eraseEditing();
    await act(async () => {
      editing2.onStrokeStart({ x: 10, y: 10 });
      editing2.onStrokeEnd();
    });
    expect(eraseEditing().ops[2]).toMatchObject({ erase: true, radius: 40 });
  });

  it('框选拉矩形落笔即固化（rect 图元，无活框态）', async () => {
    await renderPage();
    await eraseImage();
    await click('erase-tool-rect');
    const editing = eraseEditing();
    await act(async () => {
      editing.onStrokeStart({ x: 10, y: 20 });
      editing.onStrokeMove({ x: 200, y: 160 });
      editing.onStrokeEnd();
    });
    expect(eraseEditing().ops[0]).toMatchObject({ kind: 'rect', erase: false, from: { x: 10, y: 20 }, to: { x: 200, y: 160 } });
  });

  it('无涂区发送置灰；全被橡皮擦掉同样不可发', async () => {
    await renderPage();
    await eraseImage();
    expect(bodyBtn('erase-send-btn').disabled).toBe(true);
    await paintStroke();
    expect(bodyBtn('erase-send-btn').disabled).toBe(false);
    await click('erase-tool-eraser');
    const editing = eraseEditing();
    await act(async () => {
      editing.onStrokeStart({ x: 50, y: 60 });
      editing.onStrokeMove({ x: 120, y: 80 });
      editing.onStrokeEnd();
    });
    expect(bodyBtn('erase-send-btn').disabled).toBe(true);
  });

  it('源图分辨率缺失（存量图）：涂抹发送置灰并说明原因', async () => {
    seedDoc(false);
    await renderPage();
    await eraseImage();
    await paintStroke();
    const send = bodyBtn('erase-send-btn');
    expect(send.disabled).toBe(true);
    expect(send.getAttribute('title')).toContain('分辨率未知');
  });
});

describe('IKGOTB 四退出：未发送退出画布无痕迹', () => {
  it('X 退出：无卡、无边、无任务、遮罩丢弃', async () => {
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-close');
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
    expect(apiMocks.createImageErase).not.toHaveBeenCalled();
    expect(apiMocks.uploadAssetFile).not.toHaveBeenCalled();
    await eraseImage();
    expect(bodyBtn('erase-undo').disabled).toBe(true);
  });

  it('Esc 退出：同口径无痕迹', async () => {
    await renderPage();
    await eraseImage();
    await paintStroke();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('点其他卡退出（单选非目标或多选）', async () => {
    await renderPage();
    await eraseImage();
    await paintStroke();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [{ id: 'other' }] });
    });
    expect(toolbar()).toBeNull();
    await eraseImage();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [] });
    });
    expect(toolbar()).not.toBeNull();
  });

  it('点画布空白退出（PaneClick）', async () => {
    await renderPage();
    await eraseImage();
    await paintStroke();
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });
});

describe('IKGOTB 发送与结果闭环', () => {
  it('清除文字一键直发：full_screen_text_erase 三键、无遮罩上传，发送即退出并建卡连线', async () => {
    await renderPage();
    await eraseImage();
    await click('erase-clear-text');
    expect(apiMocks.uploadAssetFile).not.toHaveBeenCalled();
    expect(apiMocks.createImageErase).toHaveBeenCalledTimes(1);
    const [, payload] = apiMocks.createImageErase.mock.calls[0]! as [string, Record<string, string>];
    expect(payload.erase_scene).toBe('full_screen_text_erase');
    expect(payload.source_asset_id).toBe('5');
    expect(payload.target_node_id).toBeTruthy();
    expect(Object.keys(payload).sort()).toEqual(['erase_scene', 'source_asset_id', 'target_node_id']);
    expect(toolbar()).toBeNull();
    const nodes = flowProps.current.mediaNodes as Node[];
    expect(nodes.length).toBe(2);
    const result = nodes.find((n) => n.id !== 'i1')!;
    expect(result.id).toBe(payload.target_node_id);
    const data = result.data as Record<string, unknown>;
    expect(data.genStatus).toBe('generating');
    expect(data.fileName).toBe('擦除');
    expect((data.imageErase as Record<string, unknown>).sourceAssetId).toBe('5');
    expect(result.position.x).toBeGreaterThan(400);
    const edges = flowProps.current.edges as Array<{ source: string; target: string; data?: { origin?: string } }>;
    expect(edges.length).toBe(1);
    expect(edges[0]).toMatchObject({ source: 'i1', target: result.id });
    expect(edges[0]!.data?.origin).toBe('image-erase');
    expect(imageMediaRefsOf(result.id, flowProps.current.edges, flowProps.current.mediaNodes)).toEqual([]);
  });

  it('涂抹发送：遮罩上传 source=mask_erase + selected_area_erase 四键（mask_asset_id 为上传资产）', async () => {
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn');
    expect(apiMocks.uploadAssetFile).toHaveBeenCalledTimes(1);
    const [file, opts] = apiMocks.uploadAssetFile.mock.calls[0]! as [File, { assetSource?: string }];
    expect(file).toBeInstanceOf(File);
    expect(opts?.assetSource).toBe('mask_erase');
    expect(apiMocks.createImageErase).toHaveBeenCalledTimes(1);
    const [, payload] = apiMocks.createImageErase.mock.calls[0]! as [string, Record<string, string>];
    expect(payload).toMatchObject({
      erase_scene: 'selected_area_erase',
      source_asset_id: '5',
      mask_asset_id: '901',
    });
    expect(Object.keys(payload).sort()).toEqual(['erase_scene', 'mask_asset_id', 'source_asset_id', 'target_node_id']);
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
  });

  it('发送前不建卡：未发送退出无卡；遮罩上传失败留在编辑态不建卡', async () => {
    apiMocks.uploadAssetFile.mockRejectedValue(new Error('boom'));
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn');
    expect(toolbar()).not.toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(apiMocks.createImageErase).not.toHaveBeenCalled();
  });

  it('生成中→succeeded 回填：成品卡带源图同分辨率产物、草稿身份结束', async () => {
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j77',
      status: 'succeeded',
      progress: 100,
      asset: { id: 'a9', url: 'http://img/out.png', type: 'image', width: 1600, height: 900 },
    });
    await renderPage();
    await eraseImage();
    await click('erase-clear-text');
    await act(async () => {});
    const nodes = flowProps.current.mediaNodes as Node[];
    const result = nodes.find((n) => n.id !== 'i1')!;
    const data = result.data as Record<string, unknown>;
    expect(data.genStatus).toBeUndefined();
    expect(data.src).toBe('http://img/out.png');
    expect(data.assetId).toBe('a9');
    expect(data.width).toBe(1600);
    expect(data.height).toBe(900);
    expect(data.draft).toBeUndefined();
    const source = nodes.find((n) => n.id === 'i1')!;
    expect((source.data as Record<string, unknown>).src).toBe('http://img/i1.png');
  });

  it('失败可重试：重试=冻结 input 原样重发创建接口（同参数），重试链路回填成品', async () => {
    apiMocks.fetchJobStatus
      .mockResolvedValueOnce({
        job_id: 'j77',
        status: 'failed',
        progress: 0,
        asset: null,
        error: { code: 1040, msg: '图片擦除失败，请重试' },
      })
      .mockResolvedValue({
        job_id: 'j78',
        status: 'succeeded',
        progress: 100,
        asset: { id: 'a9', url: 'http://img/out2.png', type: 'image', width: 1600, height: 900 },
      });
    await renderPage();
    await eraseImage();
    await paintStroke();
    await click('erase-send-btn');
    await act(async () => {});
    const nodes = flowProps.current.mediaNodes as Node[];
    const result = nodes.find((n) => n.id !== 'i1')!;
    expect((result.data as Record<string, unknown>).genStatus).toBe('failed');
    await act(async () => {
      ((result.data as Record<string, unknown>).onRetryJob as (id: string) => void)(result.id);
    });
    expect(apiMocks.createImageErase).toHaveBeenCalledTimes(2);
    const first = (apiMocks.createImageErase.mock.calls[0] as [string, Record<string, string>])[1];
    const second = (apiMocks.createImageErase.mock.calls[1] as [string, Record<string, string>])[1];
    expect(second).toEqual(first);
    const settled = (flowProps.current.mediaNodes as Node[]).find((n) => n.id === result.id)!;
    const data = settled.data as Record<string, unknown>;
    expect(data.genStatus).toBeUndefined();
    expect(data.src).toBe('http://img/out2.png');
    expect(data.width).toBe(1600);
  });

  it('创建请求失败（门槛拒/网络）：不建卡、留在编辑态', async () => {
    apiMocks.createImageErase.mockRejectedValue(Object.assign(new Error('图片长边超过 2560 或短边超过 1440 像素上限'), { status: 400 }));
    await renderPage();
    await eraseImage();
    await click('erase-clear-text');
    expect(toolbar()).not.toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });
});


function stubWrapperSize(width: number, height: number) {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(height);
}

describe('IKH1WI 擦除发送条中心点跟随锚', () => {
  it('发送条 left = 源卡中心 x（649）、top = 源卡下方 + 16（340）：不再偏左估宽一半', async () => {
    stubWrapperSize(1600, 900);
    await renderPage();
    await eraseImage();
    const sendBar = document.body.querySelector('[data-testid="erase-send-bar"]') as HTMLElement;
    expect(sendBar.style.left).toBe('649px');
    expect(sendBar.style.top).toBe('340px');
  });

  it('上方工具条位置防回归：left 同为中心 x（649）、top = 卡顶上方抬升（8）', async () => {
    stubWrapperSize(1600, 900);
    await renderPage();
    await eraseImage();
    const bar = toolbar() as HTMLElement;
    expect(bar.style.left).toBe('649px');
    expect(bar.style.top).toBe('8px');
  });

  it('贴边钳制：容器 700 宽时中心 x（649）被钳到右界 568，发送条不出视口', async () => {
    stubWrapperSize(700, 900);
    await renderPage();
    await eraseImage();
    const sendBar = document.body.querySelector('[data-testid="erase-send-bar"]') as HTMLElement;
    expect(sendBar.style.left).toBe('568px');
  });
});
