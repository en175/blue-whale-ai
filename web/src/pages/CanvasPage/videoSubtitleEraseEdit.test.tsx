// @vitest-environment jsdom
/* IKGZ83 去字幕编辑态闭环（画布链路）：编辑态进出与四退出（X/Esc/点其他卡/点空白）未发送
   无痕迹、框交互经 subtitleEraseBoxes 纯逻辑落栈与撤销重做、20 上限提示、「全画面文字」开关
   默认关、发送四组合参数推导（无框+关=subtitle_smart / 无框+开=text_full / 有框组合带归一化框）、
   发送时才建视频结果卡+纯视觉来源线（origin=video-subtitle-erase，参考推导跳过）、
   发送即退出编辑态、创建失败停留编辑态、终态回填与失败重试（冻结 input 原样重发）。
   渲染模式沿用 eraseEdit.test.tsx（FlowCanvas 打桩透出 props，框层指针经注入的
   data.subtitleEraseEditing 回调驱动；DOM 指针换算由 SubtitleEraseBoxesLayer 组件测试覆盖）。 */
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
  createMediaExtraction: vi.fn(),
  createImageErase: vi.fn(),
  createVideoSubtitleErase: vi.fn(),
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
  createMediaExtraction: apiMocks.createMediaExtraction,
  createImageErase: apiMocks.createImageErase,
  createVideoSubtitleErase: apiMocks.createVideoSubtitleErase,
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

/** 画布：一个就绪视频节点 v1（1920×1080 mp4，assetId 数字串满足契约；显示区 498×280） */
function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'v1',
          type: 'mediaNode',
          position: { x: 400, y: 0 },
          data: {
            src: 'http://vid/v1.mp4',
            mediaType: 'video',
            fileName: '素材视频',
            assetId: '5',
            width: 1920,
            height: 1080,
            duration: 30,
            mime: 'video/mp4',
          },
        },
      ],
      edges: [],
    },
    assets: { 5: { asset_id: 5, type: 'video', access_url: 'http://vid/v1.mp4', width: 1920, height: 1080 } },
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

/** 进入去字幕编辑态（视频卡工具条「智能去字幕」按钮派发的回调，IKGZ82 挂点） */
async function enterErase() {
  const video = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!;
  await act(async () => {
    video.data.onVideoSubtitleErase('v1');
  });
}

/** 目标源视频卡上注入的框编辑回调（渲染期派生，不持久化） */
function editing() {
  const video = (flowProps.current.mediaNodes as Node[]).find((n) => n.id === 'v1')!;
  return (video.data as Record<string, unknown>).subtitleEraseEditing as {
    boxes: Array<Record<string, unknown>>;
    onBoxStart: (p: { x: number; y: number }) => void;
    onBoxMove: (p: { x: number; y: number }) => void;
    onBoxEnd: () => void;
  };
}

/** 经框层回调拉一个框 */
async function dragBox(x1: number, y1: number, x2: number, y2: number) {
  const layer = editing();
  await act(async () => {
    layer.onBoxStart({ x: x1, y: y1 });
    layer.onBoxMove({ x: x2, y: y2 });
    layer.onBoxEnd();
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
  return document.body.querySelector('[data-testid="subtitle-erase-toolbar"]');
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiMocks.createVideoSubtitleErase.mockReset();
  apiMocks.fetchJobStatus.mockReset();
  apiMocks.createVideoSubtitleErase.mockResolvedValue({ job_id: 'j88', status: 'queued' });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKGZ83 编辑态呈现与框交互', () => {
  it('工具条完整呈现：框选/全画面文字开关/撤销/重做/X；发送条含本期免费与输出最高 1080P 与发送', async () => {
    await renderPage();
    await enterErase();
    for (const id of ['subtitle-erase-tool-box', 'subtitle-erase-full-text-toggle', 'subtitle-erase-undo', 'subtitle-erase-redo', 'subtitle-erase-close']) {
      expect(bodyBtn(id), id).toBeTruthy();
    }
    const sendBar = document.body.querySelector('[data-testid="subtitle-erase-send-bar"]')!;
    expect(sendBar.textContent).toContain('本期免费');
    expect(sendBar.textContent).toContain('输出最高 1080P');
    expect(bodyBtn('subtitle-erase-send-btn')).toBeTruthy();
    // 源视频卡注入框层与 soloToolbarHidden（会话模态口径）
    expect(editing()).toBeTruthy();
    const v1 = (flowProps.current.mediaNodes as Node[]).find((n) => n.id === 'v1')!;
    expect((v1.data as Record<string, unknown>).soloToolbarHidden).toBe(true);
  });

  it('「全画面文字」开关默认关，点击可开合', async () => {
    await renderPage();
    await enterErase();
    expect(bodyBtn('subtitle-erase-full-text-toggle').getAttribute('aria-checked')).toBe('false');
    await click('subtitle-erase-full-text-toggle');
    expect(bodyBtn('subtitle-erase-full-text-toggle').getAttribute('aria-checked')).toBe('true');
    await click('subtitle-erase-full-text-toggle');
    expect(bodyBtn('subtitle-erase-full-text-toggle').getAttribute('aria-checked')).toBe('false');
  });

  it('拉框落笔即固化（无活框选中态）；撤销弹栈、重做复栈', async () => {
    await renderPage();
    await enterErase();
    expect(bodyBtn('subtitle-erase-undo').disabled).toBe(true);
    await dragBox(49.8, 196, 448.2, 266);
    expect(editing().boxes.length).toBe(1);
    expect(bodyBtn('subtitle-erase-undo').disabled).toBe(false);
    await click('subtitle-erase-undo');
    expect(editing().boxes.length).toBe(0);
    expect(bodyBtn('subtitle-erase-redo').disabled).toBe(false);
    await click('subtitle-erase-redo');
    expect(editing().boxes.length).toBe(1);
  });

  it('拉满 20 个框后不可再拉（apply 内置上限守卫）', async () => {
    await renderPage();
    await enterErase();
    for (let i = 0; i < 20; i += 1) {
      await dragBox(i * 5, 10, i * 5 + 4, 20);
    }
    expect(editing().boxes.length).toBe(20);
    await dragBox(100, 100, 150, 150);
    expect(editing().boxes.length).toBe(20);
    // 撤销后可再拉
    await click('subtitle-erase-undo');
    await dragBox(100, 100, 150, 150);
    expect(editing().boxes.length).toBe(20);
  });
});

describe('IKGZ83 四退出：未发送退出画布无痕迹', () => {
  it('X 退出：无卡、无边、无任务、框与开关状态丢弃', async () => {
    await renderPage();
    await enterErase();
    await dragBox(49.8, 196, 448.2, 266);
    await click('subtitle-erase-full-text-toggle');
    await click('subtitle-erase-close');
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
    expect(apiMocks.createVideoSubtitleErase).not.toHaveBeenCalled();
    // 框与开关已丢弃：重进编辑态撤销不可用、开关回默认关
    await enterErase();
    expect(bodyBtn('subtitle-erase-undo').disabled).toBe(true);
    expect(bodyBtn('subtitle-erase-full-text-toggle').getAttribute('aria-checked')).toBe('false');
  });

  it('Esc 退出：同口径无痕迹', async () => {
    await renderPage();
    await enterErase();
    await dragBox(49.8, 196, 448.2, 266);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('点其他卡退出（单选非目标或多选）；空选中不退出', async () => {
    await renderPage();
    await enterErase();
    await dragBox(49.8, 196, 448.2, 266);
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [{ id: 'other' }] });
    });
    expect(toolbar()).toBeNull();
    // 空选中不退出（真空白由 PaneClick 承担）
    await enterErase();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [] });
    });
    expect(toolbar()).not.toBeNull();
  });

  it('点画布空白退出（PaneClick）', async () => {
    await renderPage();
    await enterErase();
    await dragBox(49.8, 196, 448.2, 266);
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(toolbar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });
});

describe('IKGZ83 发送与结果闭环', () => {
  it('无框+开关关发送：subtitle_smart 四键、erase_boxes 空数组，发送即退出并建视频结果卡连线', async () => {
    await renderPage();
    await enterErase();
    await click('subtitle-erase-send-btn');
    expect(apiMocks.createVideoSubtitleErase).toHaveBeenCalledTimes(1);
    const [, payload] = apiMocks.createVideoSubtitleErase.mock.calls[0]! as [string, Record<string, unknown>];
    expect(payload).toEqual({
      source_asset_id: '5',
      target_node_id: expect.any(String),
      detect_mode: 'subtitle_smart',
      erase_boxes: [],
    });
    // 发送即退出编辑态
    expect(toolbar()).toBeNull();
    // 发送时才建卡：结果卡在源卡右侧、视频占位（mediaType=video、带源分辨率）、generating、
    // 带去字幕身份（lastInput 供重试）
    const nodes = flowProps.current.mediaNodes as Node[];
    expect(nodes.length).toBe(2);
    const result = nodes.find((n) => n.id !== 'v1')!;
    expect(result.id).toBe(payload.target_node_id);
    const data = result.data as Record<string, unknown>;
    expect(data.genStatus).toBe('generating');
    expect(data.mediaType).toBe('video');
    expect(data.fileName).toBe('去字幕');
    expect(data.width).toBe(1920);
    expect(data.height).toBe(1080);
    expect((data.videoSubtitleErase as Record<string, unknown>).sourceAssetId).toBe('5');
    expect(result.position.x).toBeGreaterThan(400);
    // 纯视觉来源线：origin=video-subtitle-erase
    const edges = flowProps.current.edges as Array<{ source: string; target: string; data?: { origin?: string } }>;
    expect(edges.length).toBe(1);
    expect(edges[0]).toMatchObject({ source: 'v1', target: result.id });
    expect(edges[0]!.data?.origin).toBe('video-subtitle-erase');
    // 参考推导跳过该连线：源视频不占参考位、不参与 @ 编号
    expect(imageMediaRefsOf(result.id, flowProps.current.edges, flowProps.current.mediaNodes)).toEqual([]);
  });

  it('无框+开关开发送：detect_mode=text_full（全画面文字，顶部字幕途径）', async () => {
    await renderPage();
    await enterErase();
    await click('subtitle-erase-full-text-toggle');
    await click('subtitle-erase-send-btn');
    const [, payload] = apiMocks.createVideoSubtitleErase.mock.calls[0]! as [string, Record<string, unknown>];
    expect(payload).toMatchObject({ detect_mode: 'text_full', erase_boxes: [] });
  });

  it('有框+开关关发送：subtitle_smart + 显示坐标换算的归一化框', async () => {
    await renderPage();
    await enterErase();
    // 视频显示区约 498×280（1920×1080 按短边 280 换算）：拉下半字幕典型框
    await dragBox(49.8, 196, 448.2, 266);
    await click('subtitle-erase-send-btn');
    const [, payload] = apiMocks.createVideoSubtitleErase.mock.calls[0]! as [string, {
      detect_mode: string;
      erase_boxes: Array<Record<string, number>>;
    }];
    expect(payload.detect_mode).toBe('subtitle_smart');
    expect(payload.erase_boxes.length).toBe(1);
    const box = payload.erase_boxes[0]!;
    // 视频显示区宽含循环小数（1920/1080×280），换算结果按 3 位小数断言
    expect(box.top_left_x).toBeCloseTo(0.1, 3);
    expect(box.top_left_y).toBeCloseTo(0.7, 3);
    expect(box.bottom_right_x).toBeCloseTo(0.9, 3);
    expect(box.bottom_right_y).toBeCloseTo(0.95, 3);
  });

  it('有框+开关开发送：text_full + 框（仅框内执行擦除）', async () => {
    await renderPage();
    await enterErase();
    await dragBox(49.8, 196, 448.2, 266);
    await click('subtitle-erase-full-text-toggle');
    await click('subtitle-erase-send-btn');
    const [, payload] = apiMocks.createVideoSubtitleErase.mock.calls[0]! as [string, {
      detect_mode: string;
      erase_boxes: unknown[];
    }];
    expect(payload.detect_mode).toBe('text_full');
    expect(payload.erase_boxes.length).toBe(1);
  });

  it('发送前不建卡：未发送退出无卡；创建请求失败留在编辑态不建卡', async () => {
    apiMocks.createVideoSubtitleErase.mockRejectedValue(Object.assign(new Error('视频长边超过 2560 或短边超过 1440 像素上限（2K），无法去字幕'), { status: 400 }));
    await renderPage();
    await enterErase();
    await click('subtitle-erase-send-btn');
    expect(toolbar()).not.toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('生成中→succeeded 回填：成品是普通视频素材卡（可再次去字幕），源卡不动', async () => {
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j88',
      status: 'succeeded',
      progress: 100,
      asset: { id: 'a9', url: 'http://vid/out.mp4', type: 'video', width: 1920, height: 1080, duration: 30 },
    });
    await renderPage();
    await enterErase();
    await click('subtitle-erase-send-btn');
    await act(async () => {}); // 轮询首拍（tick 立即执行）回填终态
    const nodes = flowProps.current.mediaNodes as Node[];
    const result = nodes.find((n) => n.id !== 'v1')!;
    const data = result.data as Record<string, unknown>;
    expect(data.genStatus).toBeUndefined();
    expect(data.src).toBe('http://vid/out.mp4');
    expect(data.assetId).toBe('a9');
    expect(data.mediaType).toBe('video');
    expect(data.draft).toBeUndefined();
    // 成品卡是普通视频卡：去字幕入口回调可用（可再次去字幕）
    expect(typeof data.onVideoSubtitleErase).toBe('function');
    // 源卡不动
    const source = nodes.find((n) => n.id === 'v1')!;
    expect((source.data as Record<string, unknown>).src).toBe('http://vid/v1.mp4');
  });

  it('失败可重试：重试=冻结 input 原样重发创建接口（同参数），重试链路回填成品', async () => {
    apiMocks.fetchJobStatus
      .mockResolvedValueOnce({
        job_id: 'j88',
        status: 'failed',
        progress: 0,
        asset: null,
        error: { code: 1043, msg: '视频去字幕失败，请重试' },
      })
      .mockResolvedValue({
        job_id: 'j89',
        status: 'succeeded',
        progress: 100,
        asset: { id: 'a9', url: 'http://vid/out2.mp4', type: 'video', width: 1920, height: 1080, duration: 30 },
      });
    await renderPage();
    await enterErase();
    await dragBox(49.8, 196, 448.2, 266);
    await click('subtitle-erase-send-btn');
    await act(async () => {});
    const nodes = flowProps.current.mediaNodes as Node[];
    const result = nodes.find((n) => n.id !== 'v1')!;
    expect((result.data as Record<string, unknown>).genStatus).toBe('failed');
    // 结果卡重试按钮（MediaNode onRetryJob）→ handleRetryJob 去字幕分流
    await act(async () => {
      ((result.data as Record<string, unknown>).onRetryJob as (id: string) => void)(result.id);
    });
    expect(apiMocks.createVideoSubtitleErase).toHaveBeenCalledTimes(2);
    const first = (apiMocks.createVideoSubtitleErase.mock.calls[0] as [string, Record<string, unknown>])[1];
    const second = (apiMocks.createVideoSubtitleErase.mock.calls[1] as [string, Record<string, unknown>])[1];
    expect(second).toEqual(first); // 同参数（含 target_node_id=同一张结果卡）
    // 重试任务轮询回填成品
    const settled = (flowProps.current.mediaNodes as Node[]).find((n) => n.id === result.id)!;
    const data = settled.data as Record<string, unknown>;
    expect(data.genStatus).toBeUndefined();
    expect(data.src).toBe('http://vid/out2.mp4');
  });
});

/* ===== IKH25A 去字幕发送条中心点跟随锚：left = 源卡中心 x（发送条自身 translateX(-50%) 真居中，
   口径同 cutoutToolbarAnchor）。旧缺陷（估宽左上角语义）left = round(400 + 248.89 − 130) = 519，
   恒偏左 130px；top 口径不变（节点下方 + 16）。上方工具条（走中心点锚的既有实现）位置防回归。 ===== */

/** jsdom 无布局：stub 视口尺寸让 wrapperSize 生效（跟随锚计算依赖 containerWidth） */
function stubWrapperSize(width: number, height: number) {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(height);
}

describe('IKH25A 去字幕发送条中心点跟随锚', () => {
  it('发送条 left = 源卡中心 x（649）、top = 源卡下方 + 16（340）：不再偏左估宽一半', async () => {
    stubWrapperSize(1600, 900);
    await renderPage();
    await enterErase();
    const sendBar = document.body.querySelector('[data-testid="subtitle-erase-send-bar"]') as HTMLElement;
    // 独立手算：screenLeft 400 + 内容宽 497.78/2 = 648.89 → round 649（旧缺陷值 519）
    expect(sendBar.style.left).toBe('649px');
    // 垂直行为不变：nodeBoxOf 高 280+44 → 下方 top = 324 + 16 = 340
    expect(sendBar.style.top).toBe('340px');
  });

  it('贴边钳制：容器 700 宽时中心 x（649）被钳到右界 558，发送条不出视口', async () => {
    stubWrapperSize(700, 900);
    await renderPage();
    await enterErase();
    const sendBar = document.body.querySelector('[data-testid="subtitle-erase-send-bar"]') as HTMLElement;
    // 独立手算：右界 = 700 − 钳制半宽 130 − FOLLOW_PAD 12 = 558；center 649 > 558 → 钳 558
    expect(sendBar.style.left).toBe('558px');
  });

  it('上方工具条位置防回归：left 同为中心 x（649）、top = 卡顶上方抬升（8）', async () => {
    stubWrapperSize(1600, 900);
    await renderPage();
    await enterErase();
    const bar = toolbar() as HTMLElement;
    expect(bar.style.left).toBe('649px');
    expect(bar.style.top).toBe('8px');
  });
});

describe('IKGZ83 会话口径（!743 体系接入）', () => {
  it('进入编辑态注入 soloToolbarHidden（会话模态可观测标记）；重复进入重置编辑状态（干净起点）', async () => {
    await renderPage();
    const video = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!;
    await act(async () => {
      video.data.onVideoSubtitleErase('v1');
    });
    await dragBox(49.8, 196, 448.2, 266);
    await click('subtitle-erase-full-text-toggle');
    // 再次进入 = 重置编辑状态（不残留上次框与开关）
    await act(async () => {
      video.data.onVideoSubtitleErase('v1');
    });
    expect(editing().boxes.length).toBe(0);
    expect(bodyBtn('subtitle-erase-full-text-toggle').getAttribute('aria-checked')).toBe('false');
  });
});
