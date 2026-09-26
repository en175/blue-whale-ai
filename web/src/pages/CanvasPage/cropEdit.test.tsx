// @vitest-environment jsdom
/* IKGW1S 确认裁切建成品卡闭环（画布链路，IKGV2J 整包末票）：确认→离屏 canvas 按源图
   自然分辨率裁出框内画面（cropRectToNatural）→ toBlob 重编码（格式跟随源图 cropOutputFormat）
   → 既有资产上传（普通上传，不带 assetSource）→ 源卡右侧紧邻新建「裁切」成品卡（无草稿、
   无生成中过渡）+ 纯视觉来源线（origin=image-crop，参考推导跳过）→ 确认即退出且新卡不抢
   选中、源卡保留；失败（分辨率缺失/图加载/编码/上传）留在裁切模式不产生半成品；四退出
   丢弃不留痕复锁；裁切结果卡可再次进入裁切（家族闭环）。夹具沿用 eraseEdit.test.tsx
   （FlowCanvas 打桩透 props）+ cropEntry.test.tsx 驱动；jsdom 无 canvas 编码与图加载，
   getContext/toBlob/Image 打桩（真实编码由人工回归覆盖，规格 Testing Decisions）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import type { GenerationModel } from '@/api/generation';
import { imageMediaRefsOf } from './mediaRefs';

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
vi.mock('./hooks/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

/** 画布：素材图 i1（1600×900 png）+ 第二图 i2（点其他卡退出用例）。
 *  withDims=false 模拟存量老图宽高缺失（裁切确认门：不执行不退出）；
 *  jpeg=true 模拟 JPEG 源（产出格式跟随源图用例）。 */
function seedDoc(withDims = true, jpeg = false) {
  const src = jpeg ? 'http://img/i1.jpg' : 'http://img/i1.png';
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
            src,
            mediaType: 'image',
            fileName: '素材图',
            assetId: '5',
            ...(withDims ? { width: 1600, height: 900 } : {}),
            mime: jpeg ? 'image/jpeg' : 'image/png',
          },
        },
        {
          id: 'i2',
          type: 'mediaNode',
          position: { x: 1200, y: 0 },
          data: {
            src: 'http://img/i2.png',
            mediaType: 'image',
            fileName: '第二图',
            assetId: '6',
            width: 800,
            height: 600,
            mime: 'image/png',
          },
        },
      ],
      edges: [],
    },
    assets: {
      // withDims=false 时资产字典同样无尺寸，防水合回填把分辨率补回（存量老图口径，同 eraseEdit）
      5: { asset_id: 5, type: 'image', access_url: src, ...(withDims ? { width: 1600, height: 900 } : {}) },
      6: { asset_id: 6, type: 'image', access_url: 'http://img/i2.png', width: 800, height: 600 },
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

function mediaNodes(): Node[] {
  return flowProps.current.mediaNodes as Node[];
}

function fullNode(id: string): Node {
  const found = mediaNodes().find((n) => n.id === id);
  if (!found) throw new Error(`节点不存在: ${id}`);
  return found;
}

/** 走图片节点画质工具横排「裁切」按钮的入口（回调挂在节点 data 上，IKH3XZ） */
async function cropImage(id: string) {
  const node = fullNode(id);
  await act(async () => {
    (node.data as Record<string, (nodeId: string) => void>).onCropImage(id);
  });
}

/** 裁切编辑态标记（渲染期注入，不持久化）：目标源图卡 data.cropEditing === true */
function cropEditing(id: string): boolean {
  return (fullNode(id).data as Record<string, unknown>)?.cropEditing === true;
}

/** 裁切框覆盖层 props 形态（Canvas 打桩透出） */
interface CropFramePropShape {
  bounds: { x: number; y: number; width: number; height: number };
  rect: { x: number; y: number; width: number; height: number };
  preset: string;
  onDarkAreaClick: () => void;
}

function cropFrameProp(): CropFramePropShape | null {
  return (flowProps.current.cropFrame ?? null) as CropFramePropShape | null;
}

async function clickBody(testId: string) {
  const btn = document.body.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
  if (!btn) throw new Error(`元素不存在: ${testId}`);
  await act(async () => { btn.click(); });
}

/** 退出丢弃不留痕：无新卡、无连线、无上传调用、覆盖层与面板消失 */
function expectDiscardClean() {
  expect(cropEditing('i1')).toBe(false);
  expect(mediaNodes().length).toBe(2);
  expect(flowProps.current.edges).toEqual([]);
  expect(cropFrameProp()).toBeNull();
  expect(apiMocks.uploadAssetFile).not.toHaveBeenCalled();
}

/* ============ jsdom 打桩：canvas 编码与源图加载（真实编码人工回归覆盖） ============ */

/** 单次离屏 canvas 调用记录（canvas 尺寸在 getContext 时已就位） */
interface CanvasCall {
  canvas: HTMLCanvasElement;
  drawImage: unknown[][];
  toBlob: Array<{ mime: string; quality?: number }>;
}
const canvasCalls: CanvasCall[] = [];

function stubCanvas() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const call: CanvasCall = { canvas: this, drawImage: [], toBlob: [] };
    canvasCalls.push(call);
    return {
      drawImage: (...args: unknown[]) => { call.drawImage.push(args); },
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    function (this: HTMLCanvasElement, callback: (blob: Blob | null) => void, mime?: string, quality?: number) {
      canvasCalls.find((c) => c.canvas === this)?.toBlob.push({ mime: mime ?? '', quality });
      callback(new Blob(['crop'], { type: mime || 'image/png' }));
    } as HTMLCanvasElement['toBlob'],
  );
}

/** jsdom 不加载图片资源：stub Image 让 src 赋值后异步触发 onload（真实解码人工回归覆盖） */
function stubImageLoad() {
  vi.stubGlobal('Image', class StubImage {
    crossOrigin: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private _src = '';
    get src() { return this._src; }
    set src(value: string) {
      this._src = value;
      queueMicrotask(() => this.onload?.());
    }
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  stubCanvas();
  stubImageLoad();
  canvasCalls.length = 0;
  apiMocks.uploadAssetFile.mockReset();
  apiMocks.uploadAssetFile.mockResolvedValue({
    asset_id: '901',
    status: 'ready',
    type: 'image',
    url: 'http://img/crop.png',
    width: 1600,
    height: 900,
    duration: null,
    mime: 'image/png',
    size: 100,
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* i1 期望常量（独立手算，不对拍实现侧函数）：内容盒 = 短边 280 等比缩放（16:9 → 497.78×280），
   bounds 顶偏移 22.5；全幅确认 → 自然分辨率矩形 (0,0,1600,900)；新卡落位 = 源卡 x + 内容宽 + 60 */
const M1_DISPLAY_W = 280 * (16 / 9);
const CROP_CARD_X = Math.round(400 + M1_DISPLAY_W + 60);

/** jsdom 无布局：stub 视口尺寸让 wrapperSize 生效（跟随锚计算依赖 containerWidth） */
function stubWrapperSize(width: number, height: number) {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(height);
}

describe('IKGW1S 确认裁切：执行链路（离屏 canvas → 普通上传）', () => {
  it('默认全幅确认：canvas 按源图自然分辨率全幅裁切，产出 crop.png 普通上传（不带 assetSource）', async () => {
    await renderPage();
    await cropImage('i1');
    await clickBody('crop-confirm');

    expect(apiMocks.uploadAssetFile).toHaveBeenCalledTimes(1);
    const [file, opts] = apiMocks.uploadAssetFile.mock.calls[0]! as [File, { assetSource?: string }];
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('crop.png');
    expect(file.type).toBe('image/png');
    expect(opts?.assetSource).toBeUndefined();

    expect(canvasCalls).toHaveLength(1);
    expect(canvasCalls[0]!.canvas.width).toBe(1600);
    expect(canvasCalls[0]!.canvas.height).toBe(900);
    // drawImage 源矩形 = 显示框换算的自然分辨率矩形（全幅：整图）
    expect(canvasCalls[0]!.drawImage[0]).toHaveLength(9);
    expect(canvasCalls[0]!.drawImage[0]!.slice(1)).toEqual([0, 0, 1600, 900, 0, 0, 1600, 900]);
    expect(canvasCalls[0]!.toBlob[0]).toMatchObject({ mime: 'image/png' });
  });

  it('选 4:3 预设确认：drawImage 源矩形为换算后的自然分辨率矩形，canvas 尺寸随裁切结果', async () => {
    await renderPage();
    await cropImage('i1');
    await clickBody('crop-preset-4-3');
    await clickBody('crop-confirm');

    // 4:3 最大内接（高取满 280、水平居中）→ 自然分辨率 (200, 0, 1200, 900)
    expect(canvasCalls[0]!.canvas.width).toBe(1200);
    expect(canvasCalls[0]!.canvas.height).toBe(900);
    expect(canvasCalls[0]!.drawImage[0]!.slice(1)).toEqual([200, 0, 1200, 900, 0, 0, 1200, 900]);
  });

  it('JPEG 源：产出跟随源图，toBlob 收到 image/jpeg + 0.92 质量，File 名 crop.jpg', async () => {
    seedDoc(true, true);
    await renderPage();
    await cropImage('i1');
    await clickBody('crop-confirm');

    expect(canvasCalls[0]!.toBlob[0]).toEqual({ mime: 'image/jpeg', quality: 0.92 });
    const [file] = apiMocks.uploadAssetFile.mock.calls[0]! as [File];
    expect(file.name).toBe('crop.jpg');
    expect(file.type).toBe('image/jpeg');
  });
});

describe('IKGW1S 确认裁切：建成品卡闭环', () => {
  it('确认后：源卡右侧紧邻出现「裁切」成品卡直接显示结果（无草稿、无生成中过渡）+ 纯视觉来源线', async () => {
    await renderPage();
    await cropImage('i1');
    await clickBody('crop-confirm');

    // 源卡右侧紧邻新建成品卡：fileName/素材字段来自上传返回，无 genStatus/draft 过渡
    const nodes = mediaNodes();
    expect(nodes.length).toBe(3);
    const result = nodes.find((n) => n.id !== 'i1' && n.id !== 'i2')!;
    const data = result.data as Record<string, unknown>;
    expect(data.fileName).toBe('裁切');
    expect(data.src).toBe('http://img/crop.png');
    expect(data.assetId).toBe('901');
    expect(data.width).toBe(1600);
    expect(data.height).toBe(900);
    expect(data.mime).toBe('image/png');
    expect(data.size).toBe(100);
    expect(data.genStatus).toBeUndefined();
    expect(data.draft).toBeUndefined();
    expect(result.position).toEqual({ x: CROP_CARD_X, y: 0 });

    // 纯视觉来源线：origin=image-crop，参考推导跳过（源图不占参考位）
    const edges = flowProps.current.edges as Array<{ source: string; target: string; data?: { origin?: string } }>;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: 'i1', target: result.id });
    expect(edges[0]!.data?.origin).toBe('image-crop');
    expect(imageMediaRefsOf(result.id, flowProps.current.edges, flowProps.current.mediaNodes)).toEqual([]);

    // 确认即退出：编辑标记消失、覆盖层与面板撤下
    expect(cropEditing('i1')).toBe(false);
    expect(cropFrameProp()).toBeNull();
    expect(document.body.querySelector('[data-testid="crop-dialog"]')).toBeNull();
  });

  it('新卡不抢选中、源卡保留原样', async () => {
    await renderPage();
    await cropImage('i1');
    await clickBody('crop-confirm');

    const result = mediaNodes().find((n) => n.id !== 'i1' && n.id !== 'i2')!;
    expect(result.selected).not.toBe(true);
    // 未发起程序化选中请求（selectRequest 保持初始 null，不指向新卡）
    expect(flowProps.current.selectRequest).toBeNull();

    const source = fullNode('i1');
    const data = source.data as Record<string, unknown>;
    expect(data.src).toBe('http://img/i1.png');
    expect(data.fileName).toBe('素材图');
    expect(data.width).toBe(1600);
    expect(data.height).toBe(900);
    expect(data.assetId).toBe('5');
  });

  it('裁切结果卡可再次进入裁切（家族闭环）：自由全幅起点，连环确认再建结果卡', async () => {
    await renderPage();
    await cropImage('i1');
    await clickBody('crop-confirm');
    const first = mediaNodes().find((n) => n.id !== 'i1' && n.id !== 'i2')!;

    await cropImage(first.id);
    expect(cropEditing(first.id)).toBe(true);
    const frame = cropFrameProp()!;
    expect(frame.preset).toBe('free');
    expect(frame.rect).toEqual(frame.bounds);

    await clickBody('crop-confirm');
    expect(mediaNodes().length).toBe(4);
    const edges = flowProps.current.edges as Array<{ source: string; target: string }>;
    expect(edges).toHaveLength(2);
    expect(edges[1]).toMatchObject({ source: first.id });
  });
});

describe('IKGW1S 失败路径：留在裁切模式，不产生半成品', () => {
  it('源图分辨率缺失（存量图）：确认不执行不退出，toast 提示', async () => {
    seedDoc(false);
    await renderPage();
    await cropImage('i1');
    await clickBody('crop-confirm');

    expect(cropEditing('i1')).toBe(true);
    expect(mediaNodes().length).toBe(2);
    expect(flowProps.current.edges).toEqual([]);
    expect(apiMocks.uploadAssetFile).not.toHaveBeenCalled();
    expect(container.textContent).toContain('分辨率');
  });

  it('上传失败：留在裁切模式、无卡无边，toast 报错', async () => {
    apiMocks.uploadAssetFile.mockRejectedValue(new Error('boom'));
    await renderPage();
    await cropImage('i1');
    await clickBody('crop-confirm');

    expect(cropEditing('i1')).toBe(true);
    expect(mediaNodes().length).toBe(2);
    expect(flowProps.current.edges).toEqual([]);
    expect(cropFrameProp()).not.toBeNull();
    expect(container.textContent).toContain('裁切上传失败');
  });

  it('提交期间重复点确认只发起一次（防双卡）', async () => {
    apiMocks.uploadAssetFile.mockReturnValue(new Promise(() => {}));
    await renderPage();
    await cropImage('i1');
    await clickBody('crop-confirm');
    await clickBody('crop-confirm');

    expect(apiMocks.uploadAssetFile).toHaveBeenCalledTimes(1);
    expect(cropEditing('i1')).toBe(true);
  });
});

describe('IKGW1S 四退出丢弃复锁：无卡、无边、无状态残留', () => {
  it('面板取消：退出并丢弃', async () => {
    await renderPage();
    await cropImage('i1');
    await clickBody('crop-cancel');
    expectDiscardClean();
  });

  it('Esc：退出并丢弃', async () => {
    await renderPage();
    await cropImage('i1');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expectDiscardClean();
  });

  it('点画布空白（PaneClick）与点框外暗区：同口径退出丢弃', async () => {
    await renderPage();
    await cropImage('i1');
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expectDiscardClean();

    await cropImage('i1');
    await act(async () => {
      (flowProps.current.cropFrame as { onDarkAreaClick: () => void }).onDarkAreaClick();
    });
    expectDiscardClean();
  });

  it('编辑期间点其他卡触发退出；空选中不退出（归 PaneClick）', async () => {
    await renderPage();
    await cropImage('i1');
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [] });
    });
    expect(cropEditing('i1')).toBe(true);

    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [fullNode('i2')] });
    });
    expectDiscardClean();
  });
});

/* ===== IKH1WI 裁切面板中心点跟随锚：left = 源卡中心 x（面板自身 translateX(-50%) 真居中，
   口径同 cutoutToolbarAnchor）。旧缺陷（估宽左上角语义）left = round(400 + 248.89 − 190) = 459，
   恒偏左 190px；中心点锚 top 口径不变（节点下方 + 16）。 ===== */
describe('IKH1WI 裁切面板中心点跟随锚', () => {
  it('跟随锚 left = 源卡中心 x（649）、top = 源卡下方 + 16（340）：不再偏左估宽一半', async () => {
    stubWrapperSize(1600, 900);
    await renderPage();
    await cropImage('i1');
    const panel = document.body.querySelector('[data-testid="crop-dialog"]') as HTMLElement;
    // 独立手算：screenLeft 400 + 内容宽 497.78/2 = 648.89 → round 649（旧缺陷值 459）
    expect(panel.style.left).toBe('649px');
    // 垂直行为不变：nodeBoxOf 高 280+44 → 下方 top = 324 + 16 = 340
    expect(panel.style.top).toBe('340px');
  });

  it('贴边钳制：容器 700 宽时中心 x（649）被钳到右界 498，面板不出视口', async () => {
    stubWrapperSize(700, 900);
    await renderPage();
    await cropImage('i1');
    const panel = document.body.querySelector('[data-testid="crop-dialog"]') as HTMLElement;
    // 独立手算：右界 = 700 − 钳制半宽 190 − FOLLOW_PAD 12 = 498；center 649 > 498 → 钳 498
    expect(panel.style.left).toBe('498px');
  });
});
