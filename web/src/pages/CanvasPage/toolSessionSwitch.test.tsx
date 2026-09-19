// @vitest-environment jsdom
/* IKH3ZH 六工具会话两两切换（画布链路）：擦除/抠图/裁切/扩图/去字幕/音视频分离六种
   编辑会话，任一会话进行中进入另一工具——旧会话按四路口径退出（未发送参数丢弃）、
   新会话正常进入，全程不新建卡、不新建连线、不发起任何创建请求（无新增任务）。
   互斥与进入顺序的知识集中在 toolSessionCoordinator（本测试为该 module 的页面级
   守护：删掉 module 后互斥清单散落回六入口，任一入口漏退即有向切换用例失败）。
   六工具 × 去自身 = 30 组有向切换全覆盖。渲染模式沿用 toolSessionModal.test.tsx
   （FlowCanvas 打桩透出 props，进入经 fullNode(id).data 的各工具 handler 派发——
   去字幕/音视频分离挂点参考 videoSubtitleEraseEdit / audioVideoSplitEdit）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';

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

/** PromptRefEditor 打桩（面板真实渲染所需，toolSessionModal 同款） */
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
  referencePromptPlan: vi.fn(),
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({
    queryKey: ['canvas', projectId, 'legacy-history'],
    queryFn: () => Promise.resolve({ items: [] }),
    retry: false,
  }),
  saveCanvasDoc: vi.fn(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  createGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createImageErase: vi.fn(),
  createImageCutout: vi.fn(),
  createVideoSubtitleErase: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(async () => []),
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
  referencePromptPlan: apiMocks.referencePromptPlan,
  listLegacyCardHistory: apiMocks.listLegacyCardHistory,
  createConversationQuote: apiMocks.createConversationQuote,
  legacyCardHistoryOptions: apiMocks.legacyCardHistoryOptions,
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

/** 画布：就绪图片卡 i1（1600×900 png，擦除/抠图/裁切/扩图四工具源卡）+
 *  就绪视频卡 v1（1920×1080 mp4，去字幕/音视频分离源卡）；无连线 */
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

/** 六工具身份（与 toolSessionCoordinator 的 ToolSessionKind 同集合） */
type Kind = 'erase' | 'cutout' | 'crop' | 'outpaint' | 'subtitleErase' | 'audioVideoSplit';

/** 进入编辑会话：四图片工具经图片卡 data handler，去字幕/音视频分离经视频卡 data handler
 *  （挂点分别参考 toolSessionModal / videoSubtitleEraseEdit / audioVideoSplitEdit） */
async function enterSession(kind: Kind) {
  const image = fullNode('i1').data as Record<string, (nodeId: string, mode?: string) => void>;
  const video = fullNode('v1').data as Record<string, (nodeId: string, mode?: string) => void>;
  await act(async () => {
    if (kind === 'erase') image.onEraseImage('i1');
    else if (kind === 'cutout') image.onCutoutImage('i1');
    else if (kind === 'crop') image.onCropImage('i1');
    else if (kind === 'outpaint') image.onOutpaintImage('i1');
    else if (kind === 'subtitleErase') video.onVideoSubtitleErase('v1', 'smart');
    else video.onAudioVideoSplit('v1');
  });
}

/** 各会话进行中的外部可见工具 UI（body portal 挂载，出现=会话活跃、消失=已退出） */
const SESSION_UI_TESTID: Record<Kind, string> = {
  erase: 'erase-send-bar',
  cutout: 'cutout-toolbar',
  crop: 'crop-confirm',
  outpaint: 'outpaint-dialog',
  subtitleErase: 'subtitle-erase-send-bar',
  audioVideoSplit: 'audio-video-split-toolbar',
};

const sessionUi = (kind: Kind) =>
  document.body.querySelector(`[data-testid="${SESSION_UI_TESTID[kind]}"]`);

/** 30 组有向切换对：六工具 × 其余五工具 */
const KINDS: Kind[] = ['erase', 'cutout', 'crop', 'outpaint', 'subtitleErase', 'audioVideoSplit'];
const PAIRS = KINDS.flatMap((from) =>
  KINDS.filter((to) => to !== from).map((to) => [from, to] as const),
);

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
  vi.clearAllMocks();
});

describe('IKH3ZH 六工具两两有向切换：旧会话退出、新会话进入、无新增卡/边/任务', () => {
  it.each(PAIRS)('%s → %s', async (from, to) => {
    await renderPage();
    await enterSession(from);
    expect(sessionUi(from), `进入 ${from} 后其工具 UI 应出现`).toBeTruthy();
    await enterSession(to);
    // 旧会话已退出（工具 UI 消失）、新会话已进入（工具 UI 出现）
    expect(sessionUi(from), `切到 ${to} 后 ${from} 的工具 UI 应消失`).toBeNull();
    expect(sessionUi(to), `切到 ${to} 后其工具 UI 应出现`).toBeTruthy();
    // 未发送切换不留痕迹：无新增卡、无新增连线
    expect(flowProps.current.mediaNodes as Node[]).toHaveLength(2);
    expect(flowProps.current.edges as unknown[]).toEqual([]);
    // 不发起任何创建请求（无新增任务）
    expect(apiMocks.createImageErase).not.toHaveBeenCalled();
    expect(apiMocks.createImageCutout).not.toHaveBeenCalled();
    expect(apiMocks.createVideoSubtitleErase).not.toHaveBeenCalled();
    expect(apiMocks.createMediaExtraction).not.toHaveBeenCalled();
    expect(apiMocks.createVideoEnhancement).not.toHaveBeenCalled();
    expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
  });
});
