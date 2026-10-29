// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from '../index';
import NodeFollowToolbar from '../components/NodeFollowToolbar';

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

const toolbarProps: { current: Record<string, any> } = { current: {} };
vi.mock('../components/CanvasToolbar', () => ({
  default: (props: Record<string, any>) => {
    toolbarProps.current = props;
    return createElement('div', { 'data-testid': 'canvas-toolbar' });
  },
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

const imageModel = {
  model_id: 'm-test',
  provider_id: 'prov',
  model_label: '测试生图模型',
  icon: null,
  supported_sizes: [{ id: '2k', label: '2K' }],
  supported_aspect_ratios: [{ id: '1:1', label: '1:1' }],
  supported_formats: [],
  supported_durations: null,
  default_size: '2k',
  default_format: null,
  default_aspect_ratio: '1:1',
  default_duration: null,
  features: {},
  version: 1,
  digest: '',
};

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
  createAudioTrim: vi.fn(),
  createImageErase: vi.fn(),
  createImageCutout: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(),
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
  createAudioTrim: apiMocks.createAudioTrim,
  createImageErase: apiMocks.createImageErase,
  createImageCutout: apiMocks.createImageCutout,
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
          id: 'd1',
          type: 'mediaNode',
          position: { x: 200, y: 0 },
          data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '未发送草稿' },
        },
        {
          id: 'tg1',
          type: 'textNode',
          position: { x: 400, y: 0 },
          data: { title: '文生文卡', text: '初始文案', textGen: true, prompt: '' },
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
      ],
      edges: [],
    },
    assets: {
      5: { asset_id: 5, type: 'image', access_url: 'http://img/i1.png', width: 1600, height: 900 },
      8: { asset_id: 8, type: 'audio', access_url: 'http://aud/a1.mp3', duration: 15 },
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
  const pools: Node[][] = [
    flowProps.current.mediaNodes ?? [],
    flowProps.current.textNodes ?? [],
    flowProps.current.assetNodes ?? [],
    flowProps.current.productNodes ?? [],
  ];
  const found = pools.flat().find((n) => n.id === id);
  if (!found) throw new Error(`节点不存在: ${id}`);
  return found;
}

async function clickNode(id: string) {
  await act(async () => {
    flowProps.current.onNodeClick(fullNode(id));
  });
}

async function enterSession(kind: 'cutout' | 'erase' | 'crop' | 'outpaint', id = 'i1') {
  const data = fullNode(id).data as Record<string, (nodeId: string) => void>;
  const handler = {
    cutout: data.onCutoutImage,
    erase: data.onEraseImage,
    crop: data.onCropImage,
    outpaint: data.onOutpaintImage,
  }[kind]!;
  await act(async () => {
    handler(id);
  });
}

function soloToolbarHidden(id: string): boolean {
  return (fullNode(id).data as Record<string, unknown>).soloToolbarHidden === true;
}

function mediaFollowToolbarShow(): boolean | undefined {
  const frag = flowProps.current.followToolbarLayer as { props?: { children?: unknown } } | undefined;
  const children = frag?.props?.children;
  const arr = Array.isArray(children) ? children : [children];
  const el = arr.find((c) => (c as { type?: unknown } | null)?.type === NodeFollowToolbar) as
    { props?: { show?: boolean } } | undefined;
  return el?.props?.show;
}

async function selectSolo(id: string) {
  await act(async () => {
    flowProps.current.onSelectionChange?.({ nodes: [fullNode(id)] });
  });
}

const imageOpen = () => container.textContent!.includes('测试生图模型');
const textGenOpen = () => container.textContent!.includes('文本生成 · 文生文');

const cutoutToolbar = () => document.body.querySelector('[data-testid="cutout-toolbar"]');
const eraseSendBar = () => document.body.querySelector('[data-testid="erase-send-bar"]');
const cropConfirm = () => document.body.querySelector('[data-testid="crop-confirm"]');
const enhanceSend = () => document.body.querySelector('[data-testid="enhance-send-btn"]');

const SESSION_UI_TESTID: Record<string, string> = {
  erase: 'erase-send-bar',
  cutout: 'cutout-toolbar',
  crop: 'crop-confirm',
  outpaint: 'outpaint-dialog',
  subtitleErase: 'subtitle-erase-send-bar',
  audioVideoSplit: 'audio-video-split-send-bar',
  audioTrim: 'audio-trim-send-bar',
};
const sessionToolUi = (kind: keyof typeof SESSION_UI_TESTID) =>
  document.body.querySelector(`[data-testid="${SESSION_UI_TESTID[kind]}"]`);

async function pressEscape() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedDoc();
  apiMocks.fetchGenerationModels.mockResolvedValue([imageModel]);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
  vi.clearAllMocks();
});

describe('IKGZ5O 进入会话：Dock 关闭 + 源卡悬浮工具条隐藏', () => {
  it('进入抠图会话：源卡悬浮工具条隐藏，Esc 退出后恢复', async () => {
    await renderPage();
    expect(soloToolbarHidden('i1')).toBe(false);
    await enterSession('cutout');
    expect(cutoutToolbar()).toBeTruthy();
    expect(soloToolbarHidden('i1')).toBe(true);
    await pressEscape();
    expect(cutoutToolbar()).toBeNull();
    expect(soloToolbarHidden('i1')).toBe(false);
  });

  it('描边宽度滑杆（原生 range）聚焦按 Esc 退出抠图会话（IKI61N：组件内自闭环，不被 INPUT 豁免吞键）', async () => {
    await renderPage();
    await enterSession('cutout');
    expect(cutoutToolbar()).toBeTruthy();
    const toolbarClick = async (testId: string) => {
      await act(async () => {
        (document.body.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).click();
      });
    };
    await toolbarClick('cutout-scene-trigger');
    await toolbarClick('cutout-scene-human');
    await toolbarClick('cutout-contour-trigger');
    await toolbarClick('cutout-contour-toggle');
    const slider = document.body.querySelector<HTMLInputElement>('[data-testid="cutout-contour-size"]')!;
    expect(slider.disabled).toBe(false);

    await act(async () => {
      slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });

    expect(cutoutToolbar()).toBeNull();
    expect(soloToolbarHidden('i1')).toBe(false);
  });

  it('进入音频截取会话（第七 kind，IKHB7A）：源卡工具条隐藏、发送条浮出，Esc 退出恢复', async () => {
    await renderPage();
    expect(soloToolbarHidden('a1')).toBe(false);
    await act(async () => {
      (fullNode('a1').data as Record<string, (id: string) => void>).onTrimAudio!('a1');
    });
    expect(sessionToolUi('audioTrim')).toBeTruthy();
    expect(soloToolbarHidden('a1')).toBe(true);
    await pressEscape();
    expect(sessionToolUi('audioTrim')).toBeNull();
    expect(soloToolbarHidden('a1')).toBe(false);
  });

  it('会话模态门控钉屏幕工具条容器：唯一选中卡进入会话 show 关闭，退出恢复（IKGZ5O×IKGYYD 缝合）', async () => {
    await renderPage();
    await selectSolo('i1');
    expect(mediaFollowToolbarShow()).toBe(true);
    await enterSession('cutout');
    expect(cutoutToolbar()).toBeTruthy();
    expect(mediaFollowToolbarShow()).toBe(false);
    await pressEscape();
    expect(cutoutToolbar()).toBeNull();
    expect(mediaFollowToolbarShow()).toBe(true);
  });

  it('进入会话关闭打开中的面板（维持现状全量 dismiss），未发送草稿原样保留', async () => {
    await renderPage();
    await clickNode('tg1');
    await vi.waitFor(() => expect(textGenOpen()).toBe(true));
    await enterSession('cutout');
    expect(textGenOpen()).toBe(false);
    expect((fullNode('d1').data as Record<string, unknown>).prompt).toBe('未发送草稿');
  });

  it('退出会话后 Dock 可正常打开、草稿面板带回原提示词（未发送草稿不丢）', async () => {
    await renderPage();
    await enterSession('erase');
    expect(eraseSendBar()).toBeTruthy();
    await pressEscape();
    await clickNode('d1');
    await vi.waitFor(() => expect(imageOpen()).toBe(true));
    expect((fullNode('d1').data as Record<string, unknown>).prompt).toBe('未发送草稿');
  });

  it('IKH3ZJ 草稿往返参考维度：进入会话→退出→重开草稿，参考连线原样保持', async () => {
    (canvasDocMock.current.doc as { edges: unknown[] }).edges = [
      { id: 'e1', source: 'i1', target: 'd1' },
    ];
    await renderPage();
    expect(flowProps.current.edges as unknown[]).toHaveLength(1);
    await enterSession('erase');
    expect(eraseSendBar()).toBeTruthy();
    await pressEscape();
    expect(eraseSendBar()).toBeNull();
    await clickNode('d1');
    await vi.waitFor(() => expect(imageOpen()).toBe(true));
    expect((fullNode('d1').data as Record<string, unknown>).prompt).toBe('未发送草稿');
    expect(flowProps.current.edges as unknown[]).toHaveLength(1);
    expect((flowProps.current.edges as Array<{ id: string }>)[0]!.id).toBe('e1');
  });
});

describe('IKGZ5O 会话期打开生成面板：先退会话（参数丢弃）再放行', () => {
  it('左工具栏开图片面板：抠图会话退出后面板才出现', async () => {
    await renderPage();
    await enterSession('cutout');
    expect(cutoutToolbar()).toBeTruthy();
    await act(async () => {
      toolbarProps.current.onToggleImageDialog();
    });
    expect(cutoutToolbar()).toBeNull();
    expect(soloToolbarHidden('i1')).toBe(false);
    await vi.waitFor(() => expect(imageOpen()).toBe(true));
  });

  it('点草稿卡开图片面板：裁切会话退出后面板才出现', async () => {
    await renderPage();
    await enterSession('crop');
    expect(cropConfirm()).toBeTruthy();
    await clickNode('d1');
    expect(cropConfirm()).toBeNull();
    expect(soloToolbarHidden('i1')).toBe(false);
    await vi.waitFor(() => expect(imageOpen()).toBe(true));
  });

  it('会话期选中联动不回弹面板（擦除会话源卡即面板绑定卡）', async () => {
    await renderPage();
    await clickNode('d1');
    await vi.waitFor(() => expect(imageOpen()).toBe(true));
    await enterSession('erase', 'd1');
    expect(imageOpen()).toBe(false);
    expect(eraseSendBar()).toBeTruthy();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [fullNode('d1')], edges: [] });
    });
    expect(eraseSendBar()).toBeTruthy();
    expect(imageOpen()).toBe(false);
  });

  it.each(['erase', 'crop', 'outpaint'] as const)(
    '左工具栏开图片面板（%s 会话）：会话退出后面板才出现',
    async (kind) => {
      await renderPage();
      await enterSession(kind);
      expect(sessionToolUi(kind)).toBeTruthy();
      await act(async () => {
        toolbarProps.current.onToggleImageDialog();
      });
      expect(sessionToolUi(kind)).toBeNull();
      expect(soloToolbarHidden('i1')).toBe(false);
      await vi.waitFor(() => expect(imageOpen()).toBe(true));
    },
  );

  it('左工具栏开图片面板（去字幕会话）：会话退出后面板才出现', async () => {
    (canvasDocMock.current.doc as { nodes: unknown[] }).nodes.push({
      id: 'v1',
      type: 'mediaNode',
      position: { x: 600, y: 0 },
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
    });
    (canvasDocMock.current.assets as Record<string, unknown>)[6] = {
      asset_id: 6,
      type: 'video',
      access_url: 'http://vid/v1.mp4',
      width: 1920,
      height: 1080,
    };
    await renderPage();
    await act(async () => {
      (fullNode('v1').data as Record<string, (id: string, mode?: string) => void>).onVideoSubtitleErase('v1', 'smart');
    });
    expect(sessionToolUi('subtitleErase')).toBeTruthy();
    await act(async () => {
      toolbarProps.current.onToggleImageDialog();
    });
    expect(sessionToolUi('subtitleErase')).toBeNull();
    await vi.waitFor(() => expect(imageOpen()).toBe(true));
  });
});

describe('IKHFUF 高清面板打开期间上方操作条仍在', () => {
  it('高清参数面板打开不注入 soloToolbarHidden，钉屏幕工具条 show 保持（对齐普通生成面板）', async () => {
    await renderPage();
    await selectSolo('i1');
    expect(mediaFollowToolbarShow()).toBe(true);
    await act(async () => {
      (fullNode('i1').data as Record<string, (id: string) => void>).onEnhanceImage('i1');
    });
    await vi.waitFor(() => expect(enhanceSend()).toBeTruthy());
    expect(mediaFollowToolbarShow()).toBe(true);
    const nodes = () => (flowProps.current.mediaNodes as Node[]).filter((n) => n.type === 'mediaNode');
    expect(nodes().length).toBe(4);
    for (const n of nodes()) {
      expect((n.data as Record<string, unknown>).soloToolbarHidden).toBeUndefined();
    }
    const closeBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.title === '关闭')!;
    await act(async () => {
      closeBtn.click();
    });
    expect(enhanceSend()).toBeNull();
    expect(mediaFollowToolbarShow()).toBe(true);
  });
});

describe('IKGZ5O 四方互斥回归', () => {
  it('抠图会话中进入擦除：会话切换无间隙，源卡悬浮工具条保持隐藏', async () => {
    await renderPage();
    await enterSession('cutout');
    expect(cutoutToolbar()).toBeTruthy();
    await enterSession('erase');
    expect(cutoutToolbar()).toBeNull();
    expect(eraseSendBar()).toBeTruthy();
    expect(soloToolbarHidden('i1')).toBe(true);
  });
});
