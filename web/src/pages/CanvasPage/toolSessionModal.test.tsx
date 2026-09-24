// @vitest-environment jsdom
/* IKGZ5O 工具会话期模态（画布链路）：进入抠图/扩图/裁切/擦除会话后界面进入「工具状态」——
   生成 Dock 六面板不可见不可开（进入时维持现状全量 dismiss），源图卡悬浮工具条隐藏
   （MediaNode 渲染期注入 soloToolbarHidden，组件渲染门断言在 MediaNode/index.test.tsx）；
   会话期请求打开生成面板（左工具栏/点草稿卡等）先按四路退出口径退出会话（参数丢弃）再放行；
   选中联动不回弹面板；未发送草稿在隐藏期间保留、退出后原样回来；高清/HD 参数面板
   打开不再藏上方操作条（IKHFUF，对齐普通生成面板）；四方互斥无回归。渲染模式沿用 genPanelDismiss.test.tsx
   （FlowCanvas/CanvasToolbar 打桩透出 props，面板真实渲染）。
   IKH3ZJ 生成面板准入经 toolSessionCoordinator（exitAllToolSessions）后补齐守护：
   面板准入矩阵扩到 erase/crop/outpaint/去字幕（此前仅 cutout×工具栏、crop×点草稿卡），
   草稿往返补参考连线保持维度。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import NodeFollowToolbar from './components/NodeFollowToolbar';

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

const toolbarProps: { current: Record<string, any> } = { current: {} };
vi.mock('./components/CanvasToolbar', () => ({
  default: (props: Record<string, any>) => {
    toolbarProps.current = props;
    return createElement('div', { 'data-testid': 'canvas-toolbar' });
  },
}));

vi.mock('./components/CanvasHeader', () => ({
  default: () => createElement('div', { 'data-testid': 'canvas-header' }),
}));

vi.mock('./components/ProjectSelector', () => ({
  default: () => createElement('div', { 'data-testid': 'project-selector' }),
}));

vi.mock('@/components/UserDropdown/RechargeModal', () => ({ default: () => null }));
vi.mock('@/pages/Assets/components/AssetDetailModal', () => ({ default: () => null }));

/** PromptRefEditor 打桩（面板真实渲染所需，genPanelDismiss 同款） */
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

const imageModel = {
  model_id: 'm-test',
  provider_id: 'prov',
  model_label: '测试生图模型',
  icon: null,
  supported_sizes: [{ id: '2k', label: '2K' }],
  supported_aspect_ratios: ['1:1'],
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
  createAudioTrim: vi.fn(),
  createImageErase: vi.fn(),
  createImageCutout: vi.fn(),
  readJobFailText: vi.fn((error: { msg?: string } | null | undefined) => error?.msg ?? ''),
  fetchGenerationModels: vi.fn(),
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
  createAudioTrim: apiMocks.createAudioTrim,
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

/** 画布：就绪图片卡 i1（1600×900 png，四会话源卡）+ 图片草稿 d1（prompt 预置，草稿保留断言用）
 *  + 文生文卡 tg1（面板开合断言用） */
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

/** 进入编辑会话（画质工具横排对应按钮派发的回调，四会话同构，IKH3XZ） */
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

/** 源卡悬浮工具条隐藏标记（CanvasPage 渲染期注入 MediaNode data 的模态条件） */
function soloToolbarHidden(id: string): boolean {
  return (fullNode(id).data as Record<string, unknown>).soloToolbarHidden === true;
}

/** 钉屏幕媒体卡工具条容器 show 门（IKGZ5O×IKGYYD 缝合后的真实显隐控制点）：工具条迁出
 *  MediaNode 后模态显隐由 followToolbarLayer 的 show 表达式承担（!editSessionActive）；
 *  FlowCanvas 打桩不渲染钉屏幕层，从捕获的 JSX 结构读
 *  NodeFollowToolbar.show 锁定「会话态传进了容器门」这一环。须先模拟唯一选中
 *  （onSelectionChange）使 soloMediaToolbarNode 非空，否则容器不挂载、返回 undefined */
function mediaFollowToolbarShow(): boolean | undefined {
  const frag = flowProps.current.followToolbarLayer as { props?: { children?: unknown } } | undefined;
  const children = frag?.props?.children;
  const arr = Array.isArray(children) ? children : [children];
  const el = arr.find((c) => (c as { type?: unknown } | null)?.type === NodeFollowToolbar) as
    { props?: { show?: boolean } } | undefined;
  return el?.props?.show;
}

/** 模拟 React Flow 唯一选中（打桩透出 onSelectionChange，soloId 回写使钉屏幕容器挂载） */
async function selectSolo(id: string) {
  await act(async () => {
    flowProps.current.onSelectionChange?.({ nodes: [fullNode(id)] });
  });
}

/** 面板开关标记（模型选择器文案仅在该面板打开时渲染，genPanelDismiss 同款） */
const imageOpen = () => container.textContent!.includes('测试生图模型');
const textGenOpen = () => container.textContent!.includes('文本生成 · 文生文');

const cutoutToolbar = () => document.body.querySelector('[data-testid="cutout-toolbar"]');
const eraseSendBar = () => document.body.querySelector('[data-testid="erase-send-bar"]');
const cropConfirm = () => document.body.querySelector('[data-testid="crop-confirm"]');
const enhanceSend = () => document.body.querySelector('[data-testid="enhance-send-btn"]');

/** 各会话进行中的外部可见工具 UI（出现=会话活跃、消失=已退出），testid 对齐
 *  toolSessionSwitch 的 SESSION_UI_TESTID。 */
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
    // 人像场景 → 打开描边上拉 → 启用描边（滑杆转可用）
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
    // 草稿静默保留：面板隐藏不触碰草稿卡输入（重新打开面板即回填）
    expect((fullNode('d1').data as Record<string, unknown>).prompt).toBe('未发送草稿');
  });

  it('退出会话后 Dock 可正常打开、草稿面板带回原提示词（未发送草稿不丢）', async () => {
    await renderPage();
    await enterSession('erase');
    expect(eraseSendBar()).toBeTruthy();
    await pressEscape();
    // 退出后 Dock 恢复：点草稿卡重新打开图片面板，提示词原样回来
    await clickNode('d1');
    await vi.waitFor(() => expect(imageOpen()).toBe(true));
    expect((fullNode('d1').data as Record<string, unknown>).prompt).toBe('未发送草稿');
  });

  it('IKH3ZJ 草稿往返参考维度：进入会话→退出→重开草稿，参考连线原样保持', async () => {
    // d1 预置一条参考连线（i1→d1）：会话进入/退出均不触碰 edges，往返后参考关系仍在
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
    // 参考关系保持：往返后画布连线原样（无删除、无重复建线）
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
    // 先经草稿卡 d1 打开图片面板（imageDraftId 绑定 d1），再以 d1 为源卡进入擦除会话
    // （进入时全量 dismiss 关面板），随后程序化单选 d1（源卡本身，不触发退出路径）
    await clickNode('d1');
    await vi.waitFor(() => expect(imageOpen()).toBe(true));
    await enterSession('erase', 'd1');
    expect(imageOpen()).toBe(false);
    expect(eraseSendBar()).toBeTruthy();
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [fullNode('d1')], edges: [] });
    });
    // 会话仍在（源卡本身选中不退出），面板不得回弹
    expect(eraseSendBar()).toBeTruthy();
    expect(imageOpen()).toBe(false);
  });

  /* IKH3ZJ 准入矩阵补齐：exitEditSessionForGenPanel 收口经 exitAllToolSessions 后，
   * 每个会话的 target 快照都能正确驱动退出（cutout×工具栏已有上方用例，此处补
   * erase/crop/outpaint 三图片工具 + 去字幕视频工具，共五工具 × 左工具栏入口）。 */
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
    // 用例内局部追加视频源卡（去字幕工具的源卡），不扰动其他组的媒体卡数断言
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
