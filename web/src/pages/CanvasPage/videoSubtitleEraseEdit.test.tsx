// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import MediaNodeToolbar from './components/MediaNode/Toolbar';
import type { GenerationModel } from '@/api/generation';
import type { VideoSubtitleEraseMode } from './videoSubtitleErase';
import { imageMediaRefsOf } from './mediaRefs';

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

function nodeData(id: string): Record<string, unknown> {
  const node = (flowProps.current.mediaNodes as Node[]).find((n) => n.id === id)!;
  return node.data as Record<string, unknown>;
}

async function enterErase(mode: VideoSubtitleEraseMode) {
  const video = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!;
  await act(async () => {
    video.data.onVideoSubtitleErase('v1', mode);
  });
}

function editing() {
  return nodeData('v1').subtitleEraseEditing as {
    boxes: Array<Record<string, unknown>>;
    onBoxStart: (p: { x: number; y: number }) => void;
    onBoxMove: (p: { x: number; y: number }) => void;
    onBoxEnd: () => void;
  };
}

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

function hasBody(testId: string): boolean {
  return document.body.querySelector(`[data-testid="${testId}"]`) != null;
}

async function click(testId: string) {
  await act(async () => {
    bodyBtn(testId).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function sendBar(): HTMLElement | null {
  return document.body.querySelector('[data-testid="subtitle-erase-send-bar"]');
}

function title(): string {
  return bodyBtn('subtitle-erase-title').textContent ?? '';
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiMocks.createVideoSubtitleErase.mockReset();
  apiMocks.fetchJobStatus.mockReset();
  apiMocks.createVideoSubtitleErase.mockResolvedValue({ job_id: 'j88', status: 'queued' });
  apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j88', status: 'processing', progress: 10 });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKH3OU 两模式入会话与单条形态', () => {
  it('智能模式：单条仅 X/智能擦除/⚡0/发送四元素，零框选工具，无框层浮层但视频仍锁定', async () => {
    await renderPage();
    await enterErase('smart');
    expect(title()).toBe('智能擦除');
    expect(bodyBtn('subtitle-erase-close')).toBeTruthy();
    expect(bodyBtn('subtitle-erase-free-badge')).toBeTruthy();
    expect(bodyBtn('subtitle-erase-send-btn')).toBeTruthy();
    for (const id of ['subtitle-erase-help', 'subtitle-erase-tool-box', 'subtitle-erase-undo', 'subtitle-erase-redo', 'subtitle-erase-reset']) {
      expect(hasBody(id), id).toBe(false);
    }
    expect(nodeData('v1').subtitleEraseEditing).toBeUndefined();
    expect(nodeData('v1').subtitleErasePaused).toBe(true);
    expect(nodeData('v1').soloToolbarHidden).toBe(true);
  });

  it('框选模式：单条含 X/框选擦除/？帮助/框选·撤销·重做·重置/⚡0/发送，框层与停帧标记同时注入', async () => {
    await renderPage();
    await enterErase('box');
    expect(title()).toBe('框选擦除');
    for (const id of ['subtitle-erase-close', 'subtitle-erase-help', 'subtitle-erase-tool-box', 'subtitle-erase-undo', 'subtitle-erase-redo', 'subtitle-erase-reset', 'subtitle-erase-free-badge', 'subtitle-erase-send-btn']) {
      expect(bodyBtn(id), id).toBeTruthy();
    }
    expect(editing()).toBeTruthy();
    expect(nodeData('v1').subtitleErasePaused).toBe(true);
    expect(nodeData('v1').soloToolbarHidden).toBe(true);
  });

  it('只渲染一条：旧上方工具条与「全画面文字」开关退役', async () => {
    await renderPage();
    await enterErase('box');
    expect(hasBody('subtitle-erase-toolbar')).toBe(false);
    expect(hasBody('subtitle-erase-full-text-toggle')).toBe(false);
    expect(document.body.textContent).not.toContain('全画面文字');
    expect(document.body.textContent).not.toContain('本期免费');
  });

  it('会话内不提供模式切换：换模式只能退出后重选，重进即换态并重置编辑状态', async () => {
    await renderPage();
    await enterErase('box');
    await dragBox(49.8, 196, 448.2, 266);
    expect(editing().boxes.length).toBe(1);
    expect(document.body.querySelectorAll('[role="switch"]').length).toBe(0);
    await enterErase('smart');
    expect(title()).toBe('智能擦除');
    expect(nodeData('v1').subtitleEraseEditing).toBeUndefined();
    await enterErase('box');
    expect(editing().boxes.length).toBe(0);
    expect(bodyBtn('subtitle-erase-undo').disabled).toBe(true);
  });

  it('拉框落笔即固化（无活框选中态）；撤销弹栈、重做复栈', async () => {
    await renderPage();
    await enterErase('box');
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
    await enterErase('box');
    for (let i = 0; i < 20; i += 1) {
      await dragBox(i * 5, 10, i * 5 + 4, 20);
    }
    expect(editing().boxes.length).toBe(20);
    await dragBox(100, 100, 150, 150);
    expect(editing().boxes.length).toBe(20);
    await click('subtitle-erase-undo');
    await dragBox(100, 100, 150, 150);
    expect(editing().boxes.length).toBe(20);
  });

  it('重置清空全部框且一步可撤销：撤销整批恢复，重做再次清空', async () => {
    await renderPage();
    await enterErase('box');
    expect(bodyBtn('subtitle-erase-reset').disabled).toBe(true);
    await dragBox(49.8, 196, 448.2, 266);
    await dragBox(10, 10, 60, 40);
    expect(editing().boxes.length).toBe(2);
    expect(bodyBtn('subtitle-erase-reset').disabled).toBe(false);
    await click('subtitle-erase-reset');
    expect(editing().boxes.length).toBe(0);
    expect(bodyBtn('subtitle-erase-undo').disabled).toBe(false);
    expect(bodyBtn('subtitle-erase-reset').disabled).toBe(true);
    await click('subtitle-erase-undo');
    expect(editing().boxes.length).toBe(2);
    await click('subtitle-erase-redo');
    expect(editing().boxes.length).toBe(0);
  });
});

describe('IKH3OU 四退出：未发送退出画布无痕迹', () => {
  it('X 退出：无卡、无边、无任务、框状态丢弃', async () => {
    await renderPage();
    await enterErase('box');
    await dragBox(49.8, 196, 448.2, 266);
    await click('subtitle-erase-close');
    expect(sendBar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
    expect(apiMocks.createVideoSubtitleErase).not.toHaveBeenCalled();
    await enterErase('box');
    expect(bodyBtn('subtitle-erase-undo').disabled).toBe(true);
  });

  it('Esc 退出：同口径无痕迹', async () => {
    await renderPage();
    await enterErase('box');
    await dragBox(49.8, 196, 448.2, 266);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(sendBar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('点其他卡退出（单选非目标或多选）；空选中不退出', async () => {
    await renderPage();
    await enterErase('smart');
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [{ id: 'other' }] });
    });
    expect(sendBar()).toBeNull();
    await enterErase('smart');
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [] });
    });
    expect(sendBar()).not.toBeNull();
  });

  it('点画布空白退出（PaneClick），智能模式同样丢弃不建卡', async () => {
    await renderPage();
    await enterErase('smart');
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(sendBar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
    expect(nodeData('v1').subtitleErasePaused).toBeUndefined();
  });
});

describe('IKH3OU 发送与结果闭环', () => {
  it('框选模式必框：无框发送钮置灰并提示先拉框，点击不提交不建卡不残留', async () => {
    await renderPage();
    await enterErase('box');
    expect(bodyBtn('subtitle-erase-send-btn').disabled).toBe(true);
    expect(bodyBtn('subtitle-erase-send-btn').getAttribute('title')).toContain('请先拉框');
    await click('subtitle-erase-send-btn');
    expect(apiMocks.createVideoSubtitleErase).not.toHaveBeenCalled();
    expect(sendBar()).not.toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(1);
    expect(flowProps.current.edges).toEqual([]);
    await dragBox(49.8, 196, 448.2, 266);
    expect(bodyBtn('subtitle-erase-send-btn').disabled).toBe(false);
    expect(bodyBtn('subtitle-erase-send-btn').getAttribute('title')).toContain('输出最高 1080P');
    await click('subtitle-erase-reset');
    expect(bodyBtn('subtitle-erase-send-btn').disabled).toBe(true);
    expect(bodyBtn('subtitle-erase-send-btn').getAttribute('title')).toContain('请先拉框');
  });

  it('智能模式无框直发：subtitle_smart + 空 erase_boxes，发送即退出并建视频结果卡连线', async () => {
    await renderPage();
    await enterErase('smart');
    await click('subtitle-erase-send-btn');
    expect(apiMocks.createVideoSubtitleErase).toHaveBeenCalledTimes(1);
    const [, payload] = apiMocks.createVideoSubtitleErase.mock.calls[0]! as [string, Record<string, unknown>];
    expect(payload).toEqual({
      source_asset_id: '5',
      target_node_id: expect.any(String),
      detect_mode: 'subtitle_smart',
      erase_boxes: [],
    });
    expect(sendBar()).toBeNull();
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
    const edges = flowProps.current.edges as Array<{ source: string; target: string; data?: { origin?: string } }>;
    expect(edges.length).toBe(1);
    expect(edges[0]).toMatchObject({ source: 'v1', target: result.id });
    expect(edges[0]!.data?.origin).toBe('video-subtitle-erase');
    expect(imageMediaRefsOf(result.id, flowProps.current.edges, flowProps.current.mediaNodes)).toEqual([]);
  });

  it('框选模式有框发送：detect_mode 仍是 subtitle_smart（模式只改框集合）+ 显示坐标换算的归一化框', async () => {
    await renderPage();
    await enterErase('box');
    await dragBox(49.8, 196, 448.2, 266);
    await click('subtitle-erase-send-btn');
    const [, payload] = apiMocks.createVideoSubtitleErase.mock.calls[0]! as [string, {
      target_node_id: string;
      detect_mode: string;
      erase_boxes: Array<Record<string, number>>;
    }];
    expect(payload.detect_mode).toBe('subtitle_smart');
    expect(payload.erase_boxes.length).toBe(1);
    const box = payload.erase_boxes[0]!;
    expect(box.top_left_x).toBeCloseTo(0.1, 3);
    expect(box.top_left_y).toBeCloseTo(0.7, 3);
    expect(box.bottom_right_x).toBeCloseTo(0.9, 3);
    expect(box.bottom_right_y).toBeCloseTo(0.95, 3);
    expect(sendBar()).toBeNull();
    const nodes = flowProps.current.mediaNodes as Node[];
    expect(nodes.length).toBe(2);
    const result = nodes.find((n) => n.id !== 'v1')!;
    expect(result.id).toBe(payload.target_node_id);
    expect((result.data as Record<string, unknown>).genStatus).toBe('generating');
    expect((flowProps.current.edges as Array<{ data?: { origin?: string } }>)[0]!.data?.origin)
      .toBe('video-subtitle-erase');
  });

  it('两模式推导出的 detect_mode 一致：去字幕任务检测范围不随入口选择变化', async () => {
    await renderPage();
    await enterErase('smart');
    await click('subtitle-erase-send-btn');
    const smart = (apiMocks.createVideoSubtitleErase.mock.calls[0] as [string, Record<string, unknown>])[1];
    apiMocks.createVideoSubtitleErase.mockClear();
    await enterErase('box');
    await dragBox(49.8, 196, 448.2, 266);
    await click('subtitle-erase-send-btn');
    const box = (apiMocks.createVideoSubtitleErase.mock.calls[0] as [string, Record<string, unknown>])[1];
    expect(smart.detect_mode).toBe('subtitle_smart');
    expect(box.detect_mode).toBe(smart.detect_mode);
  });

  it('发送前不建卡：未发送退出无卡；创建请求失败落失败卡可重试（提交点即交接运行时）', async () => {
    apiMocks.createVideoSubtitleErase.mockRejectedValue(Object.assign(new Error('视频长边超过 2560 或短边超过 1440 像素上限（2K），无法去字幕'), { status: 400 }));
    await renderPage();
    await enterErase('smart');
    await click('subtitle-erase-send-btn');
    await act(async () => {});
    expect(sendBar()).toBeNull();
    const nodes = flowProps.current.mediaNodes as Node[];
    expect(nodes.length).toBe(2);
    const result = nodes.find((n) => n.id !== 'v1')!;
    expect((result.data as Record<string, unknown>).genStatus).toBe('failed');
    expect(typeof (result.data as Record<string, unknown>).errorText).toBe('string');
    expect((flowProps.current.edges as unknown[]).length).toBe(1);
  });

  it('生成中→succeeded 回填：成品是普通视频素材卡（可再次去字幕），源卡不动', async () => {
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j88',
      status: 'succeeded',
      progress: 100,
      asset: { id: 'a9', url: 'http://vid/out.mp4', type: 'video', width: 1920, height: 1080, duration: 30 },
    });
    await renderPage();
    await enterErase('smart');
    await click('subtitle-erase-send-btn');
    await act(async () => {});
    const nodes = flowProps.current.mediaNodes as Node[];
    const result = nodes.find((n) => n.id !== 'v1')!;
    const data = result.data as Record<string, unknown>;
    expect(data.genStatus).toBeUndefined();
    expect(data.src).toBe('http://vid/out.mp4');
    expect(data.assetId).toBe('a9');
    expect(data.mediaType).toBe('video');
    expect(data.draft).toBeUndefined();
    expect(typeof data.onVideoSubtitleErase).toBe('function');
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
    await enterErase('box');
    await dragBox(49.8, 196, 448.2, 266);
    await click('subtitle-erase-send-btn');
    await act(async () => {});
    const nodes = flowProps.current.mediaNodes as Node[];
    const result = nodes.find((n) => n.id !== 'v1')!;
    expect((result.data as Record<string, unknown>).genStatus).toBe('failed');
    await act(async () => {
      ((result.data as Record<string, unknown>).onRetryJob as (id: string) => void)(result.id);
    });
    expect(apiMocks.createVideoSubtitleErase).toHaveBeenCalledTimes(2);
    const first = (apiMocks.createVideoSubtitleErase.mock.calls[0] as [string, Record<string, unknown>])[1];
    const second = (apiMocks.createVideoSubtitleErase.mock.calls[1] as [string, Record<string, unknown>])[1];
    expect(second).toEqual(first);
    const settled = (flowProps.current.mediaNodes as Node[]).find((n) => n.id === result.id)!;
    const data = settled.data as Record<string, unknown>;
    expect(data.genStatus).toBeUndefined();
    expect(data.src).toBe('http://vid/out2.mp4');
  });
});

describe('IKH3OU 经入口下拉进会话（画布级全链路）', () => {
  it('点菜单项「框选去字幕」进入框选模式会话：单条形态与框层同步落地', async () => {
    await renderPage();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const toolbarRoot = createRoot(host);
    await act(async () => {
      toolbarRoot.render(createElement(MediaNodeToolbar, { id: 'v1', data: nodeData('v1') as never }));
    });
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="subtitle-erase-menu-trigger"]')!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="subtitle-erase-menu-item-box"]')!.click();
    });
    expect(title()).toBe('框选擦除');
    expect(bodyBtn('subtitle-erase-tool-box')).toBeTruthy();
    expect(nodeData('v1').subtitleEraseEditing).toBeTruthy();
    expect(nodeData('v1').subtitleErasePaused).toBe(true);
    await act(async () => toolbarRoot.unmount());
    host.remove();
  });

  it('点菜单项「智能去字幕」进入智能模式会话：单条无框选工具、无框层', async () => {
    await renderPage();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const toolbarRoot = createRoot(host);
    await act(async () => {
      toolbarRoot.render(createElement(MediaNodeToolbar, { id: 'v1', data: nodeData('v1') as never }));
    });
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="subtitle-erase-menu-trigger"]')!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="subtitle-erase-menu-item-smart"]')!.click();
    });
    expect(title()).toBe('智能擦除');
    expect(hasBody('subtitle-erase-tool-box')).toBe(false);
    expect(nodeData('v1').subtitleEraseEditing).toBeUndefined();
    await act(async () => toolbarRoot.unmount());
    host.remove();
  });
});


function stubWrapperSize(width: number, height: number) {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(height);
}

describe('IKH25A 去字幕单条中心点跟随锚', () => {
  it('单条 left = 源卡中心 x（649）、top = 源卡下方 + 16（340）：不再偏左估宽一半', async () => {
    stubWrapperSize(1600, 900);
    await renderPage();
    await enterErase('smart');
    const bar = sendBar() as HTMLElement;
    expect(bar.style.left).toBe('649px');
    expect(bar.style.top).toBe('340px');
  });

  it('贴边钳制：容器 700 宽时中心 x（649）被钳到右界 558，单条不出视口', async () => {
    stubWrapperSize(700, 900);
    await renderPage();
    await enterErase('box');
    const bar = sendBar() as HTMLElement;
    expect(bar.style.left).toBe('558px');
  });
});
