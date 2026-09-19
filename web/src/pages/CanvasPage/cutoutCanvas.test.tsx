// @vitest-environment jsdom
/* IKGXMT 抠图工具栏与发送闭环（画布链路）：进入（关五面板/不动视角/参数默认 general）、
   场景上拉切换与增强控件显隐、人像/商品场景档精校（发送置灰 + title 原因）、
   四退出（X/Esc/点其他卡/点画布空白）未发送无痕迹且参数丢弃、发送（恰三键/七键请求体，
   无 output_format）→ 退工具栏 + 建结果卡（generating + imageCutout 身份）+ 纯视觉来源线
   （origin=image-cutout，参考推导跳过）+ 源卡不动、终态回填后结果卡棋盘格底纹、
   失败态 lastInput 原样重试、创建失败留在工具栏不建卡（擦除口径）。
   渲染模式沿用 eraseEdit.test.tsx（FlowCanvas 打桩透出 props，MediaNode 真实渲染）。 */
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

/** PromptRefEditor 打桩（TextGenDialog 打开所需，genPanelDismiss 同款） */
vi.mock('./components/PromptRefEditor', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    default: forwardRef(function StubPromptRefEditor(_props: unknown, ref: React.Ref<unknown>) {
      useImperativeHandle(ref, () => ({
        insertRefAtMention: () => {},
        consumeMentionForPendingInsert: () => {},
        insertRefAtPending: () => {},
        dismissMention: () => {},
        replaceRefAt: () => {},
        clear: () => {},
      }));
      return createElement('textarea', { 'data-testid': 'chip-editor' });
    }),
  };
});

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
      id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]',
    }),
  ),
  createGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createImageErase: vi.fn(),
  createImageCutout: vi.fn(),
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
  createImageErase: apiMocks.createImageErase,
  createImageCutout: apiMocks.createImageCutout,
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

/** 画布：就绪图片节点 i1（1600×900 png，assetId 数字串满足抠图契约）+ 文生文卡 tg1（面板开合断言用）。
 *  bigSubject=true 模拟 8000×4500 图：通用档（10240/6000/40MP）可进，人像/商品档（7680/4320）精校拦。 */
function seedDoc(bigSubject = false) {
  const dims = bigSubject ? { width: 8000, height: 4500 } : { width: 1600, height: 900 };
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
            ...dims,
            mime: 'image/png',
          },
        },
        {
          id: 'tg1',
          type: 'textNode',
          position: { x: 800, y: 0 },
          data: { title: '文生文卡', text: '初始文案', textGen: true, prompt: '' },
        },
      ],
      edges: [],
    },
    assets: {
      5: { asset_id: 5, type: 'image', access_url: 'http://img/i1.png', ...dims },
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

/** 进入抠图会话（「高清 ▾」下拉「抠图」项派发的回调） */
async function cutoutImage() {
  const image = flowProps.current.mediaNodes.find((n: Node) => n.id === 'i1')!;
  await act(async () => {
    image.data.onCutoutImage('i1');
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
  return document.body.querySelector('[data-testid="cutout-toolbar"]');
}

/** 切换场景（场景上拉） */
async function pickScene(scene: 'general' | 'human' | 'product') {
  await click('cutout-scene-trigger');
  await click(`cutout-scene-${scene}`);
}

/** 拖描边宽度滑杆到指定值 */
async function dragContourSize(value: number) {
  const range = document.body.querySelector<HTMLInputElement>('[data-testid="cutout-contour-size"]')!;
  await act(async () => {
    range.value = String(value);
    const tracker = (range as unknown as { _valueTracker?: { setValue(v: string): void } })._valueTracker;
    tracker?.setValue('');
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiMocks.createImageCutout.mockReset();
  apiMocks.fetchJobStatus.mockReset();
  apiMocks.createImageCutout.mockResolvedValue({ job_id: 'j88', status: 'queued' });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKGXMT 进入抠图会话', () => {
  it('点「抠图」后工具栏出现：场景默认通用、本期免费、圆形发送；通用场景无增强控件；源卡不动', async () => {
    await renderPage();
    expect(toolbar()).toBeNull();
    await cutoutImage();
    expect(toolbar()).toBeTruthy();
    expect(bodyBtn('cutout-scene-trigger').textContent).toContain('通用');
    expect(bodyBtn('cutout-send-btn')).toBeTruthy();
    expect(toolbar()!.textContent).toContain('本期免费');
    // 通用场景：描边与透明裁剪不渲染（隐藏而非置灰，规格故事 9）
    expect(document.body.querySelector('[data-testid="cutout-contour-trigger"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="cutout-crop-toggle"]')).toBeNull();
    // 进入不建卡不连线（源卡不动，规格故事 13/20）；文本卡 tg1 属 textNodes 不计 mediaNodes
    expect((flowProps.current.mediaNodes as Node[]).filter((n) => n.type === 'mediaNode').length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('进入时关闭打开中的生成面板（面板与抠图会话互斥）', async () => {
    await renderPage();
    // 先经文生文卡打开文本生成面板（handleCanvasNodeClick 的 textGen 分支需 data.textGen）
    await act(async () => {
      flowProps.current.onNodeClick({ id: 'tg1', type: 'textNode', data: { textGen: true, prompt: '' } });
    });
    await vi.waitFor(() => expect(container.textContent).toContain('文本生成'));
    await cutoutImage();
    expect(container.textContent).not.toContain('文本生成');
    expect(toolbar()).toBeTruthy();
  });

  it('切人像：描边上拉与透明裁剪出现，滑杆默认 10、未开启时不可拖；切回通用重新隐藏', async () => {
    await renderPage();
    await cutoutImage();
    await pickScene('human');
    expect(bodyBtn('cutout-scene-trigger').textContent).toContain('人像');
    expect(bodyBtn('cutout-contour-trigger')).toBeTruthy();
    expect(bodyBtn('cutout-crop-toggle')).toBeTruthy();
    await click('cutout-contour-trigger');
    const range = document.body.querySelector<HTMLInputElement>('[data-testid="cutout-contour-size"]')!;
    expect(range.value).toBe('10');
    expect(range.disabled).toBe(true); // 描边未开启
    await click('cutout-contour-toggle'); // 开启描边
    expect(range.disabled).toBe(false);
    await pickScene('general');
    expect(document.body.querySelector('[data-testid="cutout-contour-trigger"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="cutout-crop-toggle"]')).toBeNull();
  });

  it('人像/商品档精校：8000×4500 图通用可发，切人像发送置灰并 title 原因，不发起请求', async () => {
    seedDoc(true);
    await renderPage();
    await cutoutImage();
    expect(bodyBtn('cutout-send-btn').disabled).toBe(false);
    await pickScene('human');
    const send = bodyBtn('cutout-send-btn');
    expect(send.disabled).toBe(true);
    expect(send.getAttribute('title')).toContain('7680');
    await act(async () => {
      send.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(apiMocks.createImageCutout).not.toHaveBeenCalled();
  });
});

describe('IKGXMT 四退出：未发送退出画布无痕迹、参数丢弃', () => {
  it('X 退出：无卡、无边、无任务；重进后场景回默认通用', async () => {
    await renderPage();
    await cutoutImage();
    await pickScene('human');
    await click('cutout-close');
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).filter((n) => n.type === 'mediaNode').length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
    expect(apiMocks.createImageCutout).not.toHaveBeenCalled();
    // 参数已丢弃：重进后触发钮回「通用」
    await cutoutImage();
    expect(bodyBtn('cutout-scene-trigger').textContent).toContain('通用');
  });

  it('Esc 退出：同口径无痕迹', async () => {
    await renderPage();
    await cutoutImage();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).filter((n) => n.type === 'mediaNode').length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('点其他卡退出并选中那张卡；点源卡本身保持会话', async () => {
    await renderPage();
    await cutoutImage();
    await act(async () => {
      flowProps.current.onNodeClick({ id: 'tg1', type: 'textNode', data: {} });
    });
    expect(toolbar()).toBeNull();
    await cutoutImage();
    // 点源卡本身：保持会话
    await act(async () => {
      flowProps.current.onNodeClick({ id: 'i1', type: 'mediaNode', data: {} });
    });
    expect(toolbar()).toBeTruthy();
  });

  it('点画布空白退出（PaneClick）', async () => {
    await renderPage();
    await cutoutImage();
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).filter((n) => n.type === 'mediaNode').length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('源图卡被删除时会话自动清理（工具栏不悬挂）', async () => {
    await renderPage();
    await cutoutImage();
    expect(toolbar()).toBeTruthy();
    const image = flowProps.current.mediaNodes.find((n: Node) => n.id === 'i1')!;
    await act(async () => {
      image.data.onDelete('i1');
    });
    expect(toolbar()).toBeNull();
  });
});

describe('IKGXMT 发送与结果闭环', () => {
  it('通用场景直发：恰三键请求体（无 output_format 与增强参数），发送即退工具栏并建卡连线', async () => {
    await renderPage();
    await cutoutImage();
    await click('cutout-send-btn');
    expect(apiMocks.createImageCutout).toHaveBeenCalledTimes(1);
    const [projectId, payload] = apiMocks.createImageCutout.mock.calls[0]! as [string, Record<string, string>];
    expect(projectId).toBe('p1');
    expect(payload).toMatchObject({ cutout_scene: 'general', source_asset_id: '5' });
    expect(Object.keys(payload).sort()).toEqual(['cutout_scene', 'source_asset_id', 'target_node_id']);
    expect(payload.target_node_id).toBeTruthy();
    // 发送即退出工具栏
    expect(toolbar()).toBeNull();
    // 发送时才建卡：结果卡在源卡右侧、generating、带抠图身份（lastInput 供重试）
    const nodes = (flowProps.current.mediaNodes as Node[]).filter((n) => n.type === 'mediaNode');
    expect(nodes.length).toBe(2);
    const result = nodes.find((n) => n.id !== 'i1')!;
    expect(result.id).toBe(payload.target_node_id);
    const data = result.data as Record<string, unknown>;
    expect(data.genStatus).toBe('generating');
    expect(data.fileName).toBe('抠图');
    expect((data.imageCutout as Record<string, unknown>).sourceAssetId).toBe('5');
    expect(result.position.x).toBeGreaterThan(400);
    // 纯视觉来源线：origin=image-cutout
    const edges = flowProps.current.edges as Array<{ source: string; target: string; data?: { origin?: string } }>;
    expect(edges.length).toBe(1);
    expect(edges[0]).toMatchObject({ source: 'i1', target: result.id });
    expect(edges[0]!.data?.origin).toBe('image-cutout');
    // 参考推导跳过该连线：源图不占参考位（规格故事 19）
    expect(imageMediaRefsOf(result.id, flowProps.current.edges, flowProps.current.mediaNodes)).toEqual([]);
    // 源卡不动（规格故事 20）
    const source = nodes.find((n) => n.id === 'i1')!;
    expect((source.data as Record<string, unknown>).src).toBe('http://img/i1.png');
  });

  it('人像场景带增强参数：开描边拖滑杆 33 + 点亮透明裁剪 → 恰七键请求体', async () => {
    await renderPage();
    await cutoutImage();
    await pickScene('human');
    await click('cutout-contour-trigger');
    await click('cutout-contour-toggle'); // 开启描边
    await dragContourSize(33);
    await click('cutout-crop-toggle'); // 点亮透明裁剪
    await click('cutout-contour-trigger'); // 收起描边面板（再点关闭）
    await click('cutout-send-btn');
    expect(apiMocks.createImageCutout).toHaveBeenCalledTimes(1);
    const [, payload] = apiMocks.createImageCutout.mock.calls[0]! as [string, Record<string, unknown>];
    expect(payload).toMatchObject({
      cutout_scene: 'human',
      source_asset_id: '5',
      need_contour: true,
      contour_color: '#FFFFFF',
      contour_size: 33,
      need_crop_background: true,
    });
    expect(Object.keys(payload).sort()).toEqual([
      'contour_color',
      'contour_size',
      'cutout_scene',
      'need_contour',
      'need_crop_background',
      'source_asset_id',
      'target_node_id',
    ]);
  });

  it('创建请求失败（门槛拒/网络）：不建卡、留在工具栏（擦除口径，参数可调后重发）', async () => {
    apiMocks.createImageCutout.mockRejectedValue(Object.assign(new Error('图片长边超过 7680 或短边超过 4320 像素上限'), { status: 400 }));
    await renderPage();
    await cutoutImage();
    await click('cutout-send-btn');
    expect(toolbar()).not.toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).filter((n) => n.type === 'mediaNode').length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('失败可重试：重试 = lastInput 原样重发创建接口（同参数），重试链路回填成品', async () => {
    // 首个任务 failed；重试创建的新任务 succeeded（fetchJobStatus 按调用次序返回）
    apiMocks.fetchJobStatus
      .mockResolvedValueOnce({
        job_id: 'j88',
        status: 'failed',
        progress: 0,
        asset: null,
        error: { code: 1041, msg: '图片抠图失败，请重试' },
      })
      .mockResolvedValue({
        job_id: 'j89',
        status: 'succeeded',
        progress: 100,
        asset: { id: 'a9', url: 'http://img/cut.png', type: 'image', width: 1600, height: 900 },
      });
    await renderPage();
    await cutoutImage();
    await click('cutout-send-btn');
    await act(async () => {}); // 轮询首拍回填失败态
    const nodes = (flowProps.current.mediaNodes as Node[]).filter((n) => n.type === 'mediaNode');
    const result = nodes.find((n) => n.id !== 'i1')!;
    expect((result.data as Record<string, unknown>).genStatus).toBe('failed');
    // 结果卡重试按钮（MediaNode onRetryJob）→ handleRetryJob 抠图分流
    await act(async () => {
      ((result.data as Record<string, unknown>).onRetryJob as (id: string) => void)(result.id);
    });
    expect(apiMocks.createImageCutout).toHaveBeenCalledTimes(2);
    const first = (apiMocks.createImageCutout.mock.calls[0] as [string, Record<string, string>])[1];
    const second = (apiMocks.createImageCutout.mock.calls[1] as [string, Record<string, string>])[1];
    expect(second).toEqual(first); // 同参数（含 target_node_id=同一张结果卡）
    // 重试任务轮询回填成品
    const settled = (flowProps.current.mediaNodes as Node[]).find((n) => n.id === result.id)!;
    const data = settled.data as Record<string, unknown>;
    expect(data.genStatus).toBeUndefined();
    expect(data.src).toBe('http://img/cut.png');
  });

  it('回填成品后结果卡保留抠图身份标记（棋盘格底纹渲染由 MediaNode 组件测试覆盖）', async () => {
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j88',
      status: 'succeeded',
      progress: 100,
      asset: { id: 'a9', url: 'http://img/cut.png', type: 'image', width: 1600, height: 900 },
    });
    await renderPage();
    await cutoutImage();
    await click('cutout-send-btn');
    await act(async () => {}); // 轮询首拍回填终态
    const result = ((flowProps.current.mediaNodes as Node[]).filter((n) => n.type === 'mediaNode')).find((n) => n.id !== 'i1')!;
    const data = result.data as Record<string, unknown>;
    expect(data.genStatus).toBeUndefined();
    expect(data.src).toBe('http://img/cut.png');
    // 身份标记随卡持久化（成品态棋盘格渲染的判定源；DOM 渲染断言在 MediaNode/index.test.tsx）
    expect(data.imageCutout).toBeTruthy();
    expect((data.imageCutout as Record<string, unknown>).sourceAssetId).toBe('5');
  });
});
