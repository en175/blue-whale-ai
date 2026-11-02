// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../index';

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
vi.mock('../components/AgentPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'agent-panel-stub' }),
}));

const flowProps: { current: Record<string, any> } = { current: {} };
vi.mock('../components/Canvas', () => ({
  default: (props: Record<string, any>) => {
    flowProps.current = props;
    return createElement('div', { 'data-testid': 'flow-canvas' });
  },
}));

vi.mock('../components/CanvasToolbar', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-toolbar' }),
}));

vi.mock('../components/CanvasHeader', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));

vi.mock('../components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

vi.mock('@/custom/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/custom/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

vi.mock('../components/PromptRefEditor', async () => {
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
  createConversationQuote: vi.fn(),
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
  referencePromptPlan: apiMocks.referencePromptPlan,
  createConversationQuote: apiMocks.createConversationQuote,
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
  createImageErase: apiMocks.createImageErase,
  createImageCutout: apiMocks.createImageCutout,
  createVideoSubtitleErase: apiMocks.createVideoSubtitleErase,
  createAudioTrim: apiMocks.createAudioTrim,
  readJobFailText: apiMocks.readJobFailText,
}));
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
vi.mock('../hooks/document/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

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

type Kind = 'erase' | 'cutout' | 'crop' | 'outpaint' | 'subtitleErase' | 'audioVideoSplit' | 'audioTrim';

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

describe('IKH3ZI 四路退出与画布事件消费（规则集中在 toolSessionCoordinator）', () => {
  const genPanelOpen = () => container.querySelector('[data-testid="chip-editor"]') !== null;

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
      await selectionChange(['i3']);
      expect(sessionUi(kind), 'selection 先到时会话应保持（冻结让位）').toBeTruthy();
      await act(async () => {
        flowProps.current.onNodeClick({ id: 'i3', type: 'mediaNode', data: {} });
      });
      expect(sessionUi(kind)).toBeNull();
      expect(flowProps.current.selectRequest).toEqual(expect.objectContaining({ id: 'i3' }));
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
  const genPanelOpen = () => container.querySelector('[data-testid="chip-editor"]') !== null;

  async function selectionChange(nodeIds: string[]) {
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: nodeIds.map((id) => ({ id })) });
    });
  }

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
    await selectionChange(['i3']);
    await vi.waitFor(() => expect(genPanelOpen()).toBe(true));
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
