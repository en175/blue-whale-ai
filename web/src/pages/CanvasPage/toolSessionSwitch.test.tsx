// @vitest-environment jsdom
/* IKH3ZH 七工具会话两两切换（画布链路）：擦除/抠图/裁切/扩图/去字幕/音视频分离/音频截取
   七种编辑会话，任一会话进行中进入另一工具——旧会话按四路口径退出（未发送参数丢弃）、
   新会话正常进入，全程不新建卡、不新建连线、不发起任何创建请求（无新增任务）。
   互斥与进入顺序的知识集中在 toolSessionCoordinator（本测试为该 module 的页面级
   守护：删掉 module 后互斥清单散落回各入口，任一入口漏退即有向切换用例失败）。
   七工具 × 去自身 = 42 组有向切换全覆盖。渲染模式沿用 toolSessionModal.test.tsx
   （FlowCanvas 打桩透出 props，进入经 fullNode(id).data 的各工具 handler 派发——
   去字幕/音视频分离/音频截取挂点参考 videoSubtitleEraseEdit / audioVideoSplitEdit /
   audioTrimEdit）。IKHB7A 补第七 kind（音频截取，音视频分离同档）。
   IKH3ZI 追加四路退出与画布事件消费规则的守护：node-click 拦截（退出+选中+同次点击
   不开普通面板）、程序化选中让位（冻结不误关）、选中规范化退出（单选其他卡/多选）、
   同一手势多次通知无重复副作用（旧「会话活跃」门）。 */
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
  fetchCredits: vi.fn(async () => ({})),
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
  createAudioTrim: vi.fn(),
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
  createAudioTrim: apiMocks.createAudioTrim,
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
 *  就绪视频卡 v1（1920×1080 mp4，去字幕/音视频分离源卡）+
 *  就绪音频卡 a1（15 秒 mp3，音频截取源卡，IKHB7A）；无连线。
 *  withGenImage=true 追加成品图卡 i3（有生成记录——点卡本应开图片生成面板，
 *  供「同次点击不开普通面板 / 旧会话活跃门挡住自动开面板」断言）。 */
function seedDoc(withGenImage = false) {
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
        {
          id: 'a1',
          type: 'mediaNode',
          position: { x: 800, y: 0 },
          data: {
            src: 'http://aud/a1.mp3',
            mediaType: 'audio',
            fileName: '播客片头.mp3',
            assetId: '8',
            duration: 15,
            mime: 'audio/mpeg',
          },
        },
        ...(withGenImage
          ? [{
              id: 'i3',
              type: 'mediaNode',
              position: { x: 1200, y: 0 },
              data: {
                src: 'http://img/i3.png',
                mediaType: 'image',
                fileName: '成品图',
                assetId: '7',
                width: 1200,
                height: 800,
                mime: 'image/png',
                jobId: 'j9',
                genStatus: 'succeeded',
              },
            }]
          : []),
      ],
      edges: [],
    },
    assets: {
      5: { asset_id: 5, type: 'image', access_url: 'http://img/i1.png', width: 1600, height: 900 },
      6: { asset_id: 6, type: 'video', access_url: 'http://vid/v1.mp4', width: 1920, height: 1080 },
      8: { asset_id: 8, type: 'audio', access_url: 'http://aud/a1.mp3', duration: 15 },
      ...(withGenImage
        ? { 7: { asset_id: 7, type: 'image', access_url: 'http://img/i3.png', width: 1200, height: 800 } }
        : {}),
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

/** 七工具身份（与 toolSessionCoordinator 的 ToolSessionKind 同集合） */
type Kind = 'erase' | 'cutout' | 'crop' | 'outpaint' | 'subtitleErase' | 'audioVideoSplit' | 'audioTrim';

/** 进入编辑会话：四图片工具经图片卡 data handler，去字幕/音视频分离/音频截取经
 *  视频卡/音频卡 data handler（挂点分别参考 toolSessionModal / videoSubtitleEraseEdit /
 *  audioVideoSplitEdit / audioTrimEdit） */
async function enterSession(kind: Kind) {
  const image = fullNode('i1').data as Record<string, (nodeId: string, mode?: string) => void>;
  const video = fullNode('v1').data as Record<string, (nodeId: string, mode?: string) => void>;
  const audio = fullNode('a1').data as Record<string, (nodeId: string, mode?: string) => void>;
  await act(async () => {
    if (kind === 'erase') image.onEraseImage('i1');
    else if (kind === 'cutout') image.onCutoutImage('i1');
    else if (kind === 'crop') image.onCropImage('i1');
    else if (kind === 'outpaint') image.onOutpaintImage('i1');
    else if (kind === 'subtitleErase') video.onVideoSubtitleErase('v1', 'smart');
    else if (kind === 'audioVideoSplit') video.onAudioVideoSplit('v1');
    else audio.onTrimAudio('a1');
  });
}

/** 各会话进行中的外部可见工具 UI（body portal 挂载，出现=会话活跃、消失=已退出） */
const SESSION_UI_TESTID: Record<Kind, string> = {
  erase: 'erase-send-bar',
  cutout: 'cutout-toolbar',
  crop: 'crop-confirm',
  outpaint: 'outpaint-dialog',
  subtitleErase: 'subtitle-erase-send-bar',
  audioVideoSplit: 'audio-video-split-send-bar',
  audioTrim: 'audio-trim-send-bar',
};

const sessionUi = (kind: Kind) =>
  document.body.querySelector(`[data-testid="${SESSION_UI_TESTID[kind]}"]`);

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

// 纯切换42组已由 canvasToolSessions.test.tsx 的真实13编辑工具156组矩阵替代。
// 下方继续守护真实页面通知顺序、事件消费与普通面板接线。
describe('IKH3ZI 四路退出与画布事件消费（规则集中在 toolSessionCoordinator）', () => {
  /** 图片生成面板打开的外部可见信号（PromptRefEditor 打桩元素，仅面板渲染时存在） */
  const genPanelOpen = () => container.querySelector('[data-testid="chip-editor"]') !== null;

  /** 真实手势时序：React Flow 的 selection 通知先于 click 到达 */
  async function selectionChange(nodeIds: string[]) {
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: nodeIds.map((id) => ({ id })) });
    });
  }

  it.each(['cutout', 'outpaint'] as const)(
    'B03 %s 会话点其他卡：退出+选中新卡，同次点击不开普通面板（selection 先到冻结、click 拦截处置）',
    async (kind) => {
      seedDoc(true);
      await renderPage();
      await enterSession(kind);
      // selection 通知先到：会话活跃冻结面板联动（程序化选中让位，会话不退出不误关）
      await selectionChange(['i3']);
      expect(sessionUi(kind), 'selection 先到时会话应保持（冻结让位）').toBeTruthy();
      // click 后到：node-click 拦截——退出会话并程序化选中新卡，消费本次点击
      await act(async () => {
        flowProps.current.onNodeClick({ id: 'i3', type: 'mediaNode', data: {} });
      });
      expect(sessionUi(kind)).toBeNull();
      expect(flowProps.current.selectRequest).toEqual(expect.objectContaining({ id: 'i3' }));
      // i3 是有生成记录的成品卡：拦截已消费，同次点击不落入普通开面板分支
      expect(genPanelOpen()).toBe(false);
    },
  );

  it.each(['cutout', 'outpaint'] as const)(
    'B03 %s 会话程序化选中让位：仅 selection 通知不退会话（不误关）',
    async (kind) => {
      await renderPage();
      await enterSession(kind);
      await selectionChange(['v1']);
      expect(sessionUi(kind), '程序化选中不应退出会话').toBeTruthy();
    },
  );

  it.each(['erase', 'crop', 'subtitleErase', 'audioVideoSplit', 'audioTrim'] as const)(
    'B04 %s 会话多选退出（candidates.length > 1）',
    async (kind) => {
      await renderPage();
      await enterSession(kind);
      await selectionChange(['i1', 'v1']);
      expect(sessionUi(kind)).toBeNull();
    },
  );

  it.each(['erase', 'crop', 'subtitleErase', 'audioVideoSplit', 'audioTrim'] as const)(
    'B04 %s 会话单选其他卡：退出且同次通知不自动开该卡面板（旧会话活跃门）',
    async (kind) => {
      seedDoc(true);
      await renderPage();
      await enterSession(kind);
      await selectionChange(['i3']);
      expect(sessionUi(kind)).toBeNull();
      // 退出后继续走面板联动，但本轮渲染的旧「会话活跃」门挡住 IKFOHK 自动开面板
      //（同一手势多次通知无重复副作用的既有机制；i3 有生成记录，门失效则会自动开面板）
      expect(genPanelOpen()).toBe(false);
    },
  );

  it.each(['erase', 'crop', 'subtitleErase', 'audioVideoSplit', 'audioTrim'] as const)(
    'B04 %s 会话完整手势点无生成记录卡：退出、无面板、无新增卡/边（原流程正常交还）',
    async (kind) => {
      seedDoc(true);
      await renderPage();
      await enterSession(kind);
      const otherId = kind === 'subtitleErase' || kind === 'audioVideoSplit' || kind === 'audioTrim' ? 'i1' : 'v1';
      await selectionChange([otherId]);
      await act(async () => {
        flowProps.current.onNodeClick({ id: otherId, type: 'mediaNode', data: {} });
      });
      expect(sessionUi(kind)).toBeNull();
      expect(genPanelOpen()).toBe(false);
      expect(flowProps.current.mediaNodes as Node[]).toHaveLength(4);
      expect(flowProps.current.edges as unknown[]).toEqual([]);
      expect(apiMocks.createGenerationJob).not.toHaveBeenCalled();
    },
  );
});

describe('IKH3ZI 无活动会话时三路事件交还原流程（module 返回 pass 不消费）', () => {
  /** 图片生成面板打开的外部可见信号（PromptRefEditor 打桩元素，仅面板渲染时存在） */
  const genPanelOpen = () => container.querySelector('[data-testid="chip-editor"]') !== null;

  /** 真实手势时序：React Flow 的 selection 通知先于 click 到达 */
  async function selectionChange(nodeIds: string[]) {
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: nodeIds.map((id) => ({ id })) });
    });
  }

  /** 无会话打开生成面板的既有路径：单选成品卡 i3（有生成记录）经 IKFOHK 面板联动自动开图片面板 */
  async function openPanelViaSoloSelect() {
    await selectionChange(['i3']);
    await vi.waitFor(() => expect(genPanelOpen()).toBe(true));
  }

  it('无会话点画布空白：paneClick 交还后落入选取/面板关闭链，面板关闭且不抛错', async () => {
    seedDoc(true);
    await renderPage();
    await openPanelViaSoloSelect();
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(genPanelOpen()).toBe(false);
  });

  it('无会话 selection 变化：单选成品卡联动开绑定面板、单选其他卡联动关闭（原流程不被提前 return）', async () => {
    seedDoc(true);
    await renderPage();
    // 单选成品卡：IKFOHK 面板联动自动开绑定面板（handleToolSessionSelectionChange 返回
    // false 后不 return，无会话时不冻结联动）
    await selectionChange(['i3']);
    await vi.waitFor(() => expect(genPanelOpen()).toBe(true));
    // 单选无生成记录的其他卡：绑定面板联动关闭
    await selectionChange(['v1']);
    expect(genPanelOpen()).toBe(false);
  });

  it('无会话按 Esc：公共链正常关面板（exitToolSessionOnEsc 交还后走 dismissAllGenPanels）', async () => {
    seedDoc(true);
    await renderPage();
    await openPanelViaSoloSelect();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(genPanelOpen()).toBe(false);
  });
});
