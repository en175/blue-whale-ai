// @vitest-environment jsdom
/* IKH28X 音视频分离：画布落盘串行化回归（IKFS5W 旧直发入口退役后以编辑态发送形态重建）。
   修复前 flushCanvasSave 只“等”在途保存、不登记自己，800ms 防抖自动保存会在 flush 在途时
   再发一个 PUT——两个请求共用同一个 If-Match（后到的 412，且先到的可能带旧节点数组把刚插入的
   占位节点抹掉）。本用例锁死：flush 在途期间自动保存必须跳过，且节点+连线由同一次 PUT 落库。
   入口 = 音视频分离编辑态发送（进入会话不建任务，点发送条发送钮才建卡）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { MEDIA_EXTRACT_EDGE_ORIGIN } from './mediaExtract';
import type { GenerationModel } from '@/api/generation';

vi.mock('./components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

/** FlowCanvas 打桩：透出 props 供测试读取节点/连线与触发画布回调 */
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

type SaveResult = { id: number; project_id: number; version: number; viewport: string; nodes: string };
type SavePayload = {
  viewport: unknown;
  nodes: Node[];
  edges: Array<{ id: string; source: string; target: string; data?: Record<string, unknown> }>;
};

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
    async (_projectId: string, _payload: SavePayload, _version: number | null): Promise<SaveResult> => ({
      id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]',
    }),
  ),
  createGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(async () => ({
    job_id: 'j1', status: 'processing', progress: 10, asset: null,
  })),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(async () => ({ job_id: 'j1', status: 'queued' })),
  createAudioTrim: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async (): Promise<GenerationModel[]> => []),
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

/* 序列化保持与真实实现同构（JSON 可序列化字段参与签名），否则签名断言失真 */
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
    JSON.stringify(edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))),
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
  readJobFailText: apiMocks.readJobFailText,
}));
vi.mock('@/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));
vi.mock('@/api/generation', () => ({ fetchGenerationModels: apiMocks.fetchGenerationModels }));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('./hooks/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

/** 画布：一个就绪视频节点 v1（assetId a9），无连线 */
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
          data: { src: 'http://vid/v1.mp4', mediaType: 'video', fileName: '素材视频', assetId: 'a9', width: 1920, height: 1080 },
        },
      ],
      edges: [],
    },
    assets: {
      a9: { asset_id: 9, type: 'video', access_url: 'http://vid/v1.mp4', width: 1920, height: 1080 },
    },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

/** 追加一个就绪视频节点（含资产快照） */
function pushVideoNode(id: string, assetId: string) {
  (canvasDocMock.current.doc as { nodes: Array<Record<string, unknown>> }).nodes.push({
    id,
    type: 'mediaNode',
    position: { x: 400, y: 300 },
    data: { src: `http://vid/${id}.mp4`, mediaType: 'video', fileName: id, assetId, width: 1920, height: 1080 },
  });
  (canvasDocMock.current.assets as Record<string, unknown>)[assetId] = {
    asset_id: assetId, type: 'video', access_url: `http://vid/${id}.mp4`, width: 1920, height: 1080,
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

/** 进入音视频分离编辑态（源视频卡工具条回调挂点，IKH28U） */
async function enterSplit() {
  const video = flowProps.current.mediaNodes.find((n: Node) => n.id === 'v1')!;
  await act(async () => {
    video.data.onAudioVideoSplit('v1');
  });
}

/** 编辑态内点发送条发送钮（IKH28X 闭环入口；startAudioVideoSplitJob 含 await 创建，
 *  等 50ms 让建卡与 flush 发起但不等 flush 收尾——flush 挂在在途 PUT 上时 handler 不会 resolve） */
async function sendSplit() {
  await act(async () => {
    document.body.querySelector<HTMLButtonElement>('[data-testid="audio-video-split-send-btn"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

const savedNodeIds = (call: number): string[] =>
  apiMocks.saveCanvasDoc.mock.calls[call][1].nodes.map((n) => n.id);
const savedEdgePairs = (call: number): string[] =>
  apiMocks.saveCanvasDoc.mock.calls[call][1].edges.map((e) => `${e.source}->${e.target}`);

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('IKH28X 音视频分离发送落盘', () => {
  it('发送后节点与连线由同一次 PUT 落库，源视频在右侧按内容宽让开、展示名跟随格式', async () => {
    await renderPage();
    await enterSplit();
    await sendSplit();

    // flush 立即落库一次（不等 800ms 防抖）
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expect(savedNodeIds(0)).toContain('media-extract-j1');
    expect(savedEdgePairs(0)).toContain('v1->media-extract-j1');
    // 来源边必须带标记：否则音频卡重新编辑时该视频会被判成非法参考、卡住发送
    const edge = apiMocks.saveCanvasDoc.mock.calls[0][1].edges.find((e) => e.target === 'media-extract-j1')!;
    expect(edge.data).toEqual({ origin: MEDIA_EXTRACT_EDGE_ORIGIN });
    // 16:9 源视频内容宽 280×16/9≈497.78 → x = 400 + 498 + 60；展示名后缀跟随所选格式（默认 m4a）
    const audio = apiMocks.saveCanvasDoc.mock.calls[0][1].nodes.find((n) => n.id === 'media-extract-j1')!;
    expect(audio.position).toEqual({ x: 958, y: 0 });
    expect((audio.data as Record<string, unknown>).fileName).toBe('素材视频(audio).m4a');
    // 建任务带所选格式（默认 m4a）
    expect(apiMocks.createMediaExtraction).toHaveBeenCalledWith('p1', { source_asset_id: 'a9', output_format: 'm4a' }, { silent: true });
  });

  it('flush 在途时 800ms 防抖自动保存跳过，不并发第二个 PUT', async () => {
    let releaseSave: ((value: SaveResult) => void) | null = null;
    apiMocks.saveCanvasDoc.mockImplementationOnce(() => new Promise<SaveResult>((resolve) => {
      releaseSave = resolve;
    }));

    await renderPage();
    await enterSplit();
    await sendSplit();
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);

    // 越过 800ms 防抖窗口，此时首个 PUT 仍在途 → 自动保存必须跳过
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);

    // 放行在途请求：版本推进到 4，签名一致 → 不产生补偿性二次保存
    await act(async () => {
      releaseSave?.({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' });
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    expect(apiMocks.saveCanvasDoc).toHaveBeenCalledTimes(1);
    expect(apiMocks.saveCanvasDoc.mock.calls[0][2]).toBe(3);
  }, 20000);

  it('并发发送两个视频：两次落盘串行、版本递增，两个节点与两条来源边都在', async () => {
    let version = 3;
    let job = 0;
    apiMocks.saveCanvasDoc.mockImplementation(async (_projectId, _payload, _v) => {
      version += 1;
      return { id: 11, project_id: 1, version, viewport: '{}', nodes: '[]' };
    });
    apiMocks.createMediaExtraction.mockImplementation(async () => ({ job_id: `j${++job}`, status: 'queued' }));
    pushVideoNode('v2', 'a10');

    await renderPage();
    // 两个视频先后进入编辑态并发送（编辑态互斥：第二次进入自动退出第一次的会话）
    const enterAndSend = async (id: string) => {
      await act(async () => {
        flowProps.current.mediaNodes.find((n: Node) => n.id === id).data.onAudioVideoSplit(id);
      });
      await act(async () => {
        document.body.querySelector<HTMLButtonElement>('[data-testid="audio-video-split-send-btn"]')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
    };
    await enterAndSend('v1');
    await enterAndSend('v2');

    const calls = apiMocks.saveCanvasDoc.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    // 串行落盘：每次 If-Match 都是上一次返回的版本，不会两次共用同一个（否则后者 412）
    const versions = calls.map((c) => c[2]);
    expect(new Set(versions).size).toBe(versions.length);
    const last = calls[calls.length - 1][1];
    expect(last.nodes.map((n) => n.id)).toEqual(
      expect.arrayContaining(['media-extract-j1', 'media-extract-j2']),
    );
    expect(last.edges.map((e) => e.target)).toEqual(
      expect.arrayContaining(['media-extract-j1', 'media-extract-j2']),
    );
  }, 20000);
});
