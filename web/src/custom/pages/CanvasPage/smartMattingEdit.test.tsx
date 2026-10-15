// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { SMART_MATTING_EDGE_ORIGIN } from './smartMatting';
import type { GenerationModel } from '@/custom/api/generation';

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
      id: 11, project_id: 1, version: 5, viewport: '{}', nodes: '[]',
    }),
  ),
  createGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createVideoSubtitleErase: vi.fn(),
  createVideoSceneSplit: vi.fn(),
  createVideoMatting: vi.fn(),
  newIdempotencyKey: vi.fn(() => `token-${(++idempotencySeq).toString().padStart(2, '0')}`),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
  uploadAssetFile: vi.fn(),
}));

let idempotencySeq = 0;

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
  createVideoSubtitleErase: apiMocks.createVideoSubtitleErase,
  createVideoSceneSplit: apiMocks.createVideoSceneSplit,
  createVideoMatting: apiMocks.createVideoMatting,
  readJobFailText: apiMocks.readJobFailText,
}));
vi.mock('@/shared/api/idempotencyKey', () => ({ newIdempotencyKey: apiMocks.newIdempotencyKey }));
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
vi.mock('./hooks/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

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
          position: { x: 0, y: 0 },
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
        {
          id: 'v1',
          type: 'mediaNode',
          position: { x: 400, y: 0 },
          data: {
            src: 'http://vid/v1.mp4',
            mediaType: 'video',
            fileName: '素材视频',
            assetId: '6',
            width: 1920,
            height: 1080,
            duration: 30,
            mime: 'video/mp4',
          },
        },
      ],
      edges: [],
    },
    assets: {
      5: { asset_id: 5, type: 'image', access_url: 'http://img/i1.png', width: 1600, height: 900 },
      6: { asset_id: 6, type: 'video', access_url: 'http://vid/v1.mp4', width: 1920, height: 1080 },
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

function fullNode(id: string): Node {
  const found = (flowProps.current.mediaNodes as Node[]).find((n) => n.id === id);
  if (!found) throw new Error(`节点不存在: ${id}`);
  return found;
}

async function enterSmartMatting(mode: 'portrait' | 'greenscreen' = 'portrait') {
  const video = fullNode('v1').data as Record<string, (nodeId: string, mode?: string) => void>;
  await act(async () => {
    video.onSmartMatting('v1', mode);
  });
}

function v1Data(): Record<string, unknown> {
  return fullNode('v1').data as Record<string, unknown>;
}

function bodyBtn(testId: string): HTMLButtonElement {
  return document.body.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!;
}

async function click(testId: string) {
  await act(async () => {
    bodyBtn(testId).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function sendBar(): HTMLElement | null {
  return document.body.querySelector('[data-testid="smart-matting-send-bar"]');
}

async function selectFormat(format: 'WEBM' | 'MP4') {
  await click('smart-matting-format-trigger');
  await click(`smart-matting-format-item-${format}`);
}

async function sendSmartMatting() {
  await click('smart-matting-send-btn');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

function placeholderNode(): Node | undefined {
  return (flowProps.current.mediaNodes as Node[]).find((n) => n.id.startsWith('smart-matting-'));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  idempotencySeq = 0;
  seedDoc();
  apiMocks.createVideoMatting.mockReset();
  apiMocks.createVideoSceneSplit.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('IKHK9N 编辑态呈现（进入不建任务）', () => {
  it('进入编辑态：单条六元素（X/模式标题/格式下拉/⚡0/发送）+ 源卡锁定注入；不建任务不建卡', async () => {
    await renderPage();
    await enterSmartMatting('portrait');
    expect(sendBar()).toBeTruthy();
    expect(bodyBtn('smart-matting-close')).toBeTruthy();
    expect(bodyBtn('smart-matting-title').textContent).toBe('人像抠像');
    expect(bodyBtn('smart-matting-format-trigger').textContent).toContain('WEBM 透明');
    expect(bodyBtn('smart-matting-free-badge').textContent).toBe('0');
    expect(bodyBtn('smart-matting-send-btn')).toBeTruthy();
    expect(document.body.querySelector('[data-testid="smart-matting-background"]')).toBeNull();
    const bar = sendBar()!;
    const el = (testId: string) => bar.querySelector(`[data-testid="${testId}"]`)!;
    const before = (a: Element, b: Element) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(el('smart-matting-close'), el('smart-matting-title'))).toBe(true);
    expect(before(el('smart-matting-title'), el('smart-matting-format-trigger'))).toBe(true);
    expect(before(el('smart-matting-format-trigger'), el('smart-matting-free-badge'))).toBe(true);
    expect(before(el('smart-matting-free-badge'), el('smart-matting-send-btn'))).toBe(true);
    expect(v1Data().splitEditing).toBe(true);
    expect(v1Data().soloToolbarHidden).toBe(true);
    expect(apiMocks.createVideoMatting).not.toHaveBeenCalled();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('模式跟随入口下拉：绿幕抠像进入时标题为「绿幕抠像」', async () => {
    await renderPage();
    await enterSmartMatting('greenscreen');
    expect(bodyBtn('smart-matting-title').textContent).toBe('绿幕抠像');
  });

  it('选 MP4 后背景色分段控件出现（白默认/黑/绿）；切回 WEBM 消失', async () => {
    await renderPage();
    await enterSmartMatting('portrait');
    await selectFormat('MP4');
    expect(bodyBtn('smart-matting-background-white').getAttribute('aria-checked')).toBe('true');
    expect(bodyBtn('smart-matting-background-black')).toBeTruthy();
    expect(bodyBtn('smart-matting-background-green')).toBeTruthy();
    await selectFormat('WEBM');
    expect(document.body.querySelector('[data-testid="smart-matting-background"]')).toBeNull();
  });

  it('参数不跨会话记忆：选 MP4+绿后退出重进复位 WEBM 与白色', async () => {
    await renderPage();
    await enterSmartMatting('portrait');
    await selectFormat('MP4');
    await click('smart-matting-background-green');
    expect(bodyBtn('smart-matting-background-green').getAttribute('aria-checked')).toBe('true');
    await click('smart-matting-close');
    await enterSmartMatting('portrait');
    expect(bodyBtn('smart-matting-format-trigger').textContent).toContain('WEBM 透明');
    expect(document.body.querySelector('[data-testid="smart-matting-background"]')).toBeNull();
  });
});

describe('IKHK9N 四路退出：未发送退出画布无痕迹', () => {
  it('X 退出：无卡、无边、无任务、编辑标记移除（播放控制恢复）', async () => {
    await renderPage();
    await enterSmartMatting('portrait');
    await click('smart-matting-close');
    expect(sendBar()).toBeNull();
    expect(v1Data().splitEditing).toBeUndefined();
    expect(v1Data().soloToolbarHidden).toBeUndefined();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    expect(flowProps.current.edges).toEqual([]);
    expect(apiMocks.createVideoMatting).not.toHaveBeenCalled();
  });

  it('Esc 退出：同口径无痕迹', async () => {
    await renderPage();
    await enterSmartMatting('portrait');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(sendBar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('点其他卡退出（单选非目标）：退出且同次通知不自动开该卡面板（旧会话活跃门）', async () => {
    await renderPage();
    await enterSmartMatting('portrait');
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [{ id: 'i1' }] });
    });
    expect(sendBar()).toBeNull();
    expect(v1Data().splitEditing).toBeUndefined();
  });

  it('点画布空白退出（PaneClick）', async () => {
    await renderPage();
    await enterSmartMatting('portrait');
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(sendBar()).toBeNull();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    expect(flowProps.current.edges).toEqual([]);
  });
});

describe('IKHK9N 与既有会话互斥（集中协调器口径）', () => {
  type Kind = 'erase' | 'cutout' | 'crop' | 'outpaint' | 'subtitleErase' | 'audioVideoSplit' | 'sceneSplit' | 'vocalSplit';
  const SESSION_UI_TESTID: Record<Kind, string> = {
    erase: 'erase-send-bar',
    cutout: 'cutout-toolbar',
    crop: 'crop-confirm',
    outpaint: 'outpaint-dialog',
    subtitleErase: 'subtitle-erase-send-bar',
    audioVideoSplit: 'audio-video-split-send-bar',
    sceneSplit: 'scene-split-send-bar',
    vocalSplit: 'vocal-split-send-bar',
  };
  const KINDS: Kind[] = [
    'erase', 'cutout', 'crop', 'outpaint', 'subtitleErase', 'audioVideoSplit', 'sceneSplit', 'vocalSplit',
  ];

  async function enterSession(kind: Kind) {
    const image = fullNode('i1').data as Record<string, (nodeId: string) => void>;
    const video = fullNode('v1').data as Record<string, (nodeId: string, mode?: string) => void>;
    await act(async () => {
      if (kind === 'erase') image.onEraseImage('i1');
      else if (kind === 'cutout') image.onCutoutImage('i1');
      else if (kind === 'crop') image.onCropImage('i1');
      else if (kind === 'outpaint') image.onOutpaintImage('i1');
      else if (kind === 'subtitleErase') video.onVideoSubtitleErase('v1', 'smart');
      else if (kind === 'audioVideoSplit') video.onAudioVideoSplit('v1');
      else if (kind === 'sceneSplit') video.onSceneSplit('v1');
      else video.onVocalBackgroundSplit('v1');
    });
  }

  const sessionUi = (kind: Kind) =>
    document.body.querySelector(`[data-testid="${SESSION_UI_TESTID[kind]}"]`);

  it.each(KINDS)('%s 会话中进入智能抠像：旧会话退出、抠像接管、未发送无痕迹', async (kind) => {
    await renderPage();
    await enterSession(kind);
    expect(sessionUi(kind)).toBeTruthy();
    await enterSmartMatting('portrait');
    expect(sessionUi(kind)).toBeNull();
    expect(sendBar()).toBeTruthy();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    expect(flowProps.current.edges).toEqual([]);
    expect(apiMocks.createVideoMatting).not.toHaveBeenCalled();
  });

  it.each(KINDS)('智能抠像会话中进入 %s：抠像退出、新会话接管（反向互斥）', async (kind) => {
    await renderPage();
    await enterSmartMatting('portrait');
    expect(sendBar()).toBeTruthy();
    await enterSession(kind);
    expect(sendBar()).toBeNull();
    if (kind !== 'audioVideoSplit' && kind !== 'sceneSplit' && kind !== 'vocalSplit') {
      expect(v1Data().splitEditing).toBeUndefined();
    }
    expect(sessionUi(kind)).toBeTruthy();
  });

  it('音频卡会话（截取）与智能抠像互斥：源卡为音频节点，补 seed 单例覆盖', async () => {
    const doc = canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> };
    doc.nodes.push({
      id: 'a1',
      type: 'mediaNode',
      position: { x: 400, y: 400 },
      data: {
        src: 'http://aud/a1.mp3',
        mediaType: 'audio',
        fileName: '播客片头.mp3',
        assetId: '8',
        duration: 15,
        mime: 'audio/mpeg',
      },
    });
    await renderPage();
    const audio = fullNode('a1').data as Record<string, (nodeId: string) => void>;
    await act(async () => {
      audio.onTrimAudio('a1');
    });
    expect(document.body.querySelector('[data-testid="audio-trim-send-bar"]')).toBeTruthy();
    await enterSmartMatting('greenscreen');
    expect(document.body.querySelector('[data-testid="audio-trim-send-bar"]')).toBeNull();
    expect(sendBar()).toBeTruthy();
    await act(async () => {
      audio.onTrimAudio('a1');
    });
    expect(sendBar()).toBeNull();
    expect(document.body.querySelector('[data-testid="audio-trim-send-bar"]')).toBeTruthy();
  });
});

describe('IKHK9N 发送闭环（先退会话 → 占位卡 → job_id → 轮询）', () => {
  it('发送（默认 WEBM）：契约四键无 background_color、先退会话再建占位卡（模式标题/骨架/身份/jobId）、来源边 origin、落盘', async () => {
    apiMocks.createVideoMatting.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterSmartMatting('portrait');
    await sendSmartMatting();
    expect(apiMocks.createVideoMatting).toHaveBeenCalledTimes(1);
    const [projectId, payload] = apiMocks.createVideoMatting.mock.calls[0]!;
    expect(projectId).toBe('p1');
    expect(payload.source_asset_id).toBe('6');
    expect(payload.mode).toBe('portrait');
    expect(payload.format).toBe('WEBM');
    expect('background_color' in payload).toBe(false);
    expect(typeof payload.client_token).toBe('string');
    expect((payload.client_token as string).length).toBeGreaterThan(0);
    const targetNodeId = payload.target_node_id as string;
    expect(targetNodeId).toContain('smart-matting');
    expect(sendBar()).toBeNull();
    expect(v1Data().splitEditing).toBeUndefined();
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(3);
    const placeholder = placeholderNode()!;
    expect(placeholder.id).toBe(targetNodeId);
    expect(placeholder.data.genStatus).toBe('generating');
    expect(placeholder.data.mediaType).toBe('video');
    expect(placeholder.data.fileName).toBe('人像抠像');
    expect(placeholder.data.smartMatting).toEqual({
      sourceAssetId: '6',
      lastInput: {
        source_asset_id: '6',
        target_node_id: targetNodeId,
        mode: 'portrait',
        format: 'WEBM',
      },
    });
    expect(placeholder.data.jobId).toBe('j1');
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j1');
    const edge = (flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>)
      .find((e) => e.target === targetNodeId)!;
    expect(edge.source).toBe('v1');
    expect(edge.data).toEqual({ origin: SMART_MATTING_EDGE_ORIGIN });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)); });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalled();
  });

  it('绿幕模式 + MP4 纯色发送：任务参数带 background_color（默认白）、占位卡标题跟随模式', async () => {
    apiMocks.createVideoMatting.mockResolvedValue({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({ job_id: 'j1', status: 'processing', progress: 1, asset: null });
    await renderPage();
    await enterSmartMatting('greenscreen');
    await selectFormat('MP4');
    await sendSmartMatting();
    const payload = apiMocks.createVideoMatting.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.mode).toBe('greenscreen');
    expect(payload.format).toBe('MP4');
    expect(payload.background_color).toBe('white');
    expect(placeholderNode()!.data.fileName).toBe('绿幕抠像');
    expect((placeholderNode()!.data.smartMatting as Record<string, unknown>).lastInput)
      .toMatchObject({ mode: 'greenscreen', format: 'MP4', background_color: 'white' });
  });

  it('飞行期防重复提交：同一事件循环连点发送只发一次请求、只建一张占位卡', async () => {
    let resolveCreate!: (value: { job_id: string; status: string }) => void;
    apiMocks.createVideoMatting.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    await renderPage();
    await enterSmartMatting('portrait');
    await act(async () => {
      bodyBtn('smart-matting-send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      bodyBtn('smart-matting-send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    resolveCreate({ job_id: 'j1', status: 'queued' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(apiMocks.createVideoMatting).toHaveBeenCalledTimes(1);
    expect((flowProps.current.mediaNodes as Node[]).filter((n) => n.id.startsWith('smart-matting-'))).toHaveLength(1);
  });

  it('创建失败（网络）：会话已按 BO 顺序先退，占位卡转失败态可读文案（卡上重试按原参数重发）', async () => {
    apiMocks.createVideoMatting.mockRejectedValue(new Error('network down'));
    await renderPage();
    await enterSmartMatting('portrait');
    await sendSmartMatting();
    expect(apiMocks.createVideoMatting).toHaveBeenCalledTimes(1);
    expect(sendBar()).toBeNull();
    const placeholder = placeholderNode()!;
    expect(placeholder.data.genStatus).toBe('failed');
    expect(document.body.querySelector('[data-testid="canvas-toast"]')).toBeNull();
  });
});

describe('IKHK9N 轮询终态与失败重试', () => {
  it('轮询终态 failed：占位卡转失败态（1050 兜底文案），重试按冻结参数原参数重发 + 新 client_token', async () => {
    apiMocks.createVideoMatting.mockResolvedValueOnce({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j1', status: 'failed', progress: 1,
      error: { code: 1050 },
    });
    await renderPage();
    await enterSmartMatting('portrait');
    await sendSmartMatting();
    const failed = placeholderNode()!;
    expect(failed.data.genStatus).toBe('failed');
    expect(failed.data.errorText).toBe('智能抠像失败，请重试');

    apiMocks.createVideoMatting.mockResolvedValueOnce({ job_id: 'j2', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValue({
      job_id: 'j2', status: 'processing', progress: 10, asset: null,
    });
    await act(async () => {
      (failed.data.onRetryJob as (id: string) => void)(failed.id);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(apiMocks.createVideoMatting).toHaveBeenCalledTimes(2);
    const [, firstPayload] = apiMocks.createVideoMatting.mock.calls[0]! as [string, Record<string, unknown>];
    const [, retryPayload] = apiMocks.createVideoMatting.mock.calls[1]! as [string, Record<string, unknown>];
    expect(retryPayload.source_asset_id).toBe(firstPayload.source_asset_id);
    expect(retryPayload.target_node_id).toBe(firstPayload.target_node_id);
    expect(retryPayload.mode).toBe(firstPayload.mode);
    expect(retryPayload.format).toBe(firstPayload.format);
    expect('background_color' in retryPayload).toBe(false);
    expect(retryPayload.client_token).not.toBe(firstPayload.client_token);
    const retried = placeholderNode()!;
    expect(retried.id).toBe(failed.id);
    expect(retried.data.jobId).toBe('j2');
    expect(retried.data.genStatus).toBe('generating');
  });

  it('轮询终态 succeeded：占位卡就地转普通成品视频卡（src/assetId/宽高时长取产物、标题保持模式展示名）', async () => {
    apiMocks.createVideoMatting.mockResolvedValueOnce({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j1', status: 'succeeded', progress: 100,
      asset: { id: 'a88', url: 'http://tos/m1.webm', type: 'video', width: 1920, height: 1080, duration: 30 },
    });
    await renderPage();
    await enterSmartMatting('greenscreen');
    await sendSmartMatting();
    const done = placeholderNode()!;
    expect(done.data.genStatus).toBeUndefined();
    expect(done.data.src).toBe('http://tos/m1.webm');
    expect(done.data.assetId).toBe('a88');
    expect(done.data.mediaType).toBe('video');
    expect(done.data.width).toBe(1920);
    expect(done.data.height).toBe(1080);
    expect(done.data.duration).toBe(30);
    expect(done.data.fileName).toBe('绿幕抠像');
    expect(done.data.progress).toBe(100);
  });
});

describe('IKHKAC 完成回填与结果卡（透明标记、不记身份、恢复一致性）', () => {
  it('WEBM 透明结果：完成回填冻结 transparentOutput 标记（视频区垫棋盘格）、清掉抠像身份', async () => {
    apiMocks.createVideoMatting.mockResolvedValueOnce({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j1', status: 'succeeded', progress: 100,
      asset: { id: 'a88', url: 'http://tos/m1.webm', type: 'video', width: 1920, height: 1080, duration: 30 },
    });
    await renderPage();
    await enterSmartMatting('portrait');
    await sendSmartMatting();
    const done = placeholderNode()!;
    expect(done.data.transparentOutput).toBe(true);
    expect(done.data.smartMatting).toBeUndefined();
  });

  it('MP4 纯色结果：完成回填不设透明标记（不垫棋盘格）', async () => {
    apiMocks.createVideoMatting.mockResolvedValueOnce({ job_id: 'j1', status: 'queued' });
    apiMocks.fetchJobStatus.mockResolvedValueOnce({
      job_id: 'j1', status: 'succeeded', progress: 100,
      asset: { id: 'a89', url: 'http://tos/m2.mp4', type: 'video', width: 1920, height: 1080, duration: 30 },
    });
    await renderPage();
    await enterSmartMatting('greenscreen');
    await selectFormat('MP4');
    await sendSmartMatting();
    const done = placeholderNode()!;
    expect(done.data.src).toBe('http://tos/m2.mp4');
    expect(done.data.transparentOutput).toBeUndefined();
    expect(done.data.smartMatting).toBeUndefined();
  });

  function seedDocWithGeneratingPlaceholder() {
    seedDoc();
    const doc = canvasDocMock.current.doc as {
      nodes: Array<Record<string, unknown>>;
      edges: Array<Record<string, unknown>>;
    };
    doc.nodes.push({
      id: 'smart-matting-kept',
      type: 'mediaNode',
      position: { x: 958, y: 0 },
      data: {
        src: '',
        fileName: '人像抠像',
        mediaType: 'video',
        genStatus: 'generating',
        progress: 60,
        jobId: 'j9',
        smartMatting: {
          sourceAssetId: '6',
          lastInput: {
            source_asset_id: '6',
            target_node_id: 'smart-matting-kept',
            mode: 'portrait',
            format: 'WEBM',
          },
        },
      },
    });
    doc.edges.push({
      id: 'e-matting-kept',
      source: 'v1',
      target: 'smart-matting-kept',
      data: { origin: SMART_MATTING_EDGE_ORIGIN },
    });
  }

  it('刷新回来任务进行中：恢复轮询仍生成中；完成后照常回填成品卡（透明标记 + 身份清除）', async () => {
    seedDocWithGeneratingPlaceholder();
    apiMocks.fetchJobStatus
      .mockResolvedValueOnce({ job_id: 'j9', status: 'processing', progress: 80, asset: null })
      .mockResolvedValue({
        job_id: 'j9', status: 'succeeded', progress: 100,
        asset: { id: 'a90', url: 'http://tos/m3.webm', type: 'video', width: 1080, height: 1920, duration: 12 },
      });
    await renderPage();
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('j9');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const kept = (flowProps.current.mediaNodes as Node[]).find((n) => n.id === 'smart-matting-kept');
    expect(kept?.data.genStatus).toBe('generating');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2600));
    });
    const nodes = flowProps.current.mediaNodes as Node[];
    const done = nodes.find((n) => n.id === 'smart-matting-kept')!;
    expect(done).toBeTruthy();
    expect(done.data.src).toBe('http://tos/m3.webm');
    expect(done.data.genStatus).toBeUndefined();
    expect(done.data.transparentOutput).toBe(true);
    expect(done.data.smartMatting).toBeUndefined();
    expect((flowProps.current.edges as Array<{ target: string }>).some((e) => e.target === 'smart-matting-kept')).toBe(true);
  }, 10000);
});
