// @vitest-environment jsdom
/* IKGW1H 图片卡「高清 ▾」下拉「裁切」入口与模式进出骨架：点「裁切」把目标图片卡置为裁切
   编辑态（CanvasPage cropTargetNodeId state + 源卡渲染期注入 cropEditing 标记）、进入时关闭
   生成面板、单目标、与擦除互斥；Esc / 点画布空白 / 点其他卡三路退出丢弃不留痕（面板取消路由
   面板 UI 由 IKGW1N 接 exitCropMode）。渲染模式沿用 genPanelDismiss.test.tsx（可真实开面板）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import type { GenerationModel } from '@/api/generation';

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

/** PromptRefEditor 打桩：textarea 输入透传结构化 onChange（与 genPanelDismiss 同款） */
vi.mock('./components/PromptRefEditor', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return {
    default: forwardRef(function StubPromptRefEditor(
      { onChange }: { onChange?: (doc: { version: number; segments: Array<{ kind: 'text'; text: string }> }) => void },
      ref: React.Ref<unknown>,
    ) {
      useImperativeHandle(ref, () => ({
        insertRefAtMention: () => {},
        consumeMentionForPendingInsert: () => {},
        insertRefAtPending: () => {},
        dismissMention: () => {},
        replaceRefAt: () => {},
        clear: () => {},
      }));
      return createElement('textarea', {
        'data-testid': 'chip-editor',
        onChange: (e: Event) => {
          const value = (e.target as HTMLTextAreaElement).value;
          onChange?.({ version: 1, segments: value ? [{ kind: 'text', text: value }] : [] });
        },
      });
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
  features: {
    reference_image: true,
    max_reference_images: 10,
    watermark: false,
    quantity_max: 1,
    sequential_image_generation: false,
    stream: false,
    tools: false,
    first_frame: false,
    last_frame: false,
    first_last_frame: false,
    audio: false,
  },
  is_default: true,
  version: 1,
  digest: '',
};
const videoModel = {
  model_id: 'seedance-2',
  provider_id: 'prov',
  model_label: '测试视频模型',
  icon: null,
  supported_sizes: [{ id: '720p', label: '720p', api_value: '720p' }],
  supported_aspect_ratios: ['16:9'],
  supported_formats: [],
  supported_durations: { min: 4, max: 12, step: 1 },
  default_size: '720p',
  default_format: null,
  default_aspect_ratio: '16:9',
  default_duration: 5,
  features: {
    reference_image: true,
    max_reference_images: 10,
    watermark: false,
    quantity_max: 1,
    sequential_image_generation: false,
    stream: false,
    tools: false,
    first_frame: true,
    last_frame: true,
    first_last_frame: true,
    audio: false,
  },
  is_default: false,
  version: 1,
  digest: '',
};

const audioModel = {  model_id: 'audio-test',
  provider_id: 'prov',
  model_label: '测试音频模型',
  icon: null,
  supported_sizes: [],
  supported_aspect_ratios: [],
  supported_formats: [],
  supported_durations: null,
  default_size: null,
  default_format: null,
  default_aspect_ratio: null,
  default_duration: null,
  features: {
    reference_image: false,
    max_reference_images: 0,
    watermark: false,
    quantity_max: 1,
    sequential_image_generation: false,
    stream: false,
    tools: false,
    first_frame: false,
    last_frame: false,
    first_last_frame: false,
    audio: false,
  },
  is_default: false,
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
  assetPageQueryOptions: vi.fn(() => ({
    queryKey: ['assets'],
    initialPageParam: 1,
    queryFn: () => Promise.resolve({ records: [], total: 0, current: 1 }),
    getNextPageParam: () => undefined,
  })),
  assetDetailQueryOptions: vi.fn((id: unknown) => ({
    queryKey: ['asset-detail', id],
    queryFn: () => Promise.resolve(null),
    enabled: id != null,
  })),
  deleteAsset: vi.fn(),
  fetchAssetReferences: vi.fn(),
}));

vi.mock('@/api/canvas', () => ({
  applyPromptPreview: apiMocks.applyPromptPreview,
  referencePromptPlan: vi.fn(),
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
  serializeEdges: vi.fn(
    (edges: Array<{ id: string; source: string; target: string; data?: unknown }>) =>
      JSON.stringify(edges.map((e) => ({ id: e.id, source: e.source, target: e.target, data: e.data }))),
  ),
}));

vi.mock('@/api/jobs', () => ({
  createGenerationJob: apiMocks.createGenerationJob,
  cancelGenerationJob: apiMocks.cancelGenerationJob,
  retryGenerationJob: apiMocks.retryGenerationJob,
  fetchJobStatus: apiMocks.fetchJobStatus,
  createMediaExtraction: apiMocks.createMediaExtraction,
  readJobFailText: apiMocks.readJobFailText,
}));

vi.mock('@/api/sharedAssets', () => ({ saveSharedAsset: vi.fn() }));

vi.mock('@/api/generation', () => ({
  fetchGenerationModels: apiMocks.fetchGenerationModels,
}));

const canvasDocMock = vi.hoisted(() => ({
  current: {
    doc: null as unknown,
    assets: {} as Record<string, unknown>,
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  },
}));
vi.mock('./hooks/useCanvasDoc', () => ({ useCanvasDoc: () => canvasDocMock.current }));

/** 组合夹具：普通素材 m1（门槛内正常图 1600×900 / png，可擦除可裁切）/ 第二素材 m2 /
 *  图片草稿 d1 / 视频草稿 v1 / 音频草稿 au1 / 文生文卡 tg1 */
function seedDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'm1',
          type: 'mediaNode',
          position: { x: 0, y: 0 },
          data: {
            src: 'http://img/m1.png',
            mediaType: 'image',
            fileName: '素材图一',
            assetId: 'a1',
            width: 1600,
            height: 900,
            mime: 'image/png',
          },
        },
        {
          id: 'm2',
          type: 'mediaNode',
          position: { x: 200, y: 0 },
          data: {
            src: 'http://img/m2.png',
            mediaType: 'image',
            fileName: '素材图二',
            assetId: 'a3',
            width: 800,
            height: 600,
            mime: 'image/png',
          },
        },
        {
          id: 'd1',
          type: 'mediaNode',
          position: { x: 400, y: 0 },
          data: { src: '', mediaType: 'image', fileName: '图片草稿', genStatus: 'draft', draft: true, prompt: '' },
        },
        {
          id: 'v1',
          type: 'mediaNode',
          position: { x: 600, y: 0 },
          data: { src: '', mediaType: 'video', fileName: '视频草稿', genStatus: 'draft', draft: true, prompt: '' },
        },
        {
          id: 'au1',
          type: 'mediaNode',
          position: { x: 800, y: 0 },
          data: { src: '', mediaType: 'audio', fileName: '音频草稿', genStatus: 'draft', draft: true, prompt: '' },
        },
        {
          id: 'tg1',
          type: 'textNode',
          position: { x: 1000, y: 0 },
          data: { title: '文生文卡', text: '初始文案', textGen: true, prompt: '' },
        },
      ],
      edges: [],
    },
    assets: {
      a1: { asset_id: 1, type: 'image', access_url: 'http://img/m1.png', width: 1600, height: 900 },
      a3: { asset_id: 3, type: 'image', access_url: 'http://img/m2.png', width: 800, height: 600 },
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
  const node = fullNode(id);
  await act(async () => {
    flowProps.current.onNodeClick(node);
  });
}

/** 走图片节点「高清 ▾」下拉「裁切」项的入口（回调挂在节点 data 上） */
async function cropImage(id: string) {
  const node = fullNode(id);
  await act(async () => {
    (node.data as Record<string, (nodeId: string) => void>).onCropImage(id);
  });
}

/** 裁切编辑态标记（渲染期注入，不持久化）：目标源图卡 data.cropEditing === true */
function cropEditing(id: string): boolean {
  const node = (flowProps.current.mediaNodes as Node[] | undefined)?.find((n) => n.id === id);
  return (node?.data as Record<string, unknown> | undefined)?.cropEditing === true;
}

/** 退出后丢弃不留痕 + 源卡保留：无新卡、无连线、媒体节点数不变（tg1 为文本节点在 textNodes） */
function expectDiscardClean() {
  expect(cropEditing('m1')).toBe(false);
  expect((flowProps.current.mediaNodes as Node[]).length).toBe(5);
  expect(flowProps.current.edges).toEqual([]);
}

/** 面板开关标记（各面板模型选择器/标题文案仅在该面板打开时渲染） */
const imageOpen = () => container.textContent!.includes('测试生图模型');
const videoOpen = () => container.textContent!.includes('测试视频模型');
const audioOpen = () => container.textContent!.includes('测试音频模型');
const textGenOpen = () => container.textContent!.includes('文本生成 · 文生文');

/** 擦除编辑态工具条（IKGOTB）：出现即擦除编辑态在 */
const eraseToolbar = () => document.body.querySelector('[data-testid="erase-toolbar"]');

async function pressEscape() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  // jsdom 无 scrollTo 实现：面板切换时调用，补空实现
  Element.prototype.scrollTo = () => {};
  seedDoc();
  apiMocks.fetchGenerationModels.mockImplementation(async (type?: string) => {
    if (type === 'audio') return [audioModel];
    if (type === 'video') return [videoModel];
    return [imageModel];
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove());
  vi.clearAllMocks();
});

describe('IKGW1H 点「裁切」进入裁切编辑态（模式进出骨架）', () => {
  it('点「裁切」把目标图片卡置为裁切编辑态：源卡注入裁切标记，无建卡无连线', async () => {
    await renderPage();
    expect(cropEditing('m1')).toBe(false);

    await cropImage('m1');
    expect(cropEditing('m1')).toBe(true);
    // 源卡保留（无建卡、无连线）
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(5);
    expect(flowProps.current.edges).toEqual([]);
  });

  it('进入裁切关闭生成面板：图片/视频/音频/文本逐一打开后被进入裁切关闭', async () => {
    await renderPage();

    // 图片面板
    await clickNode('d1');
    await vi.waitFor(() => expect(imageOpen()).toBe(true));
    await cropImage('m1');
    expect(imageOpen()).toBe(false);
    expect(cropEditing('m1')).toBe(true);
    await pressEscape();

    // 视频面板
    await clickNode('v1');
    await vi.waitFor(() => expect(videoOpen()).toBe(true), { timeout: 3000 });
    await cropImage('m1');
    expect(videoOpen()).toBe(false);
    expect(cropEditing('m1')).toBe(true);
    await pressEscape();

    // 音频面板
    await clickNode('au1');
    await vi.waitFor(() => expect(audioOpen()).toBe(true), { timeout: 3000 });
    await cropImage('m1');
    expect(audioOpen()).toBe(false);
    expect(cropEditing('m1')).toBe(true);
    await pressEscape();

    // 文本生成面板
    await clickNode('tg1');
    await vi.waitFor(() => expect(textGenOpen()).toBe(true));
    await cropImage('m1');
    expect(textGenOpen()).toBe(false);
    expect(cropEditing('m1')).toBe(true);
  });

  it('单目标：第二张卡进入裁切后第一张的裁切标记消失（同一时刻仅一卡处于裁切模式）', async () => {
    await renderPage();
    await cropImage('m1');
    expect(cropEditing('m1')).toBe(true);

    await cropImage('m2');
    expect(cropEditing('m2')).toBe(true);
    expect(cropEditing('m1')).toBe(false);
  });

  it('与擦除互斥：进入裁切退出擦除编辑态', async () => {
    await renderPage();
    await act(async () => {
      (fullNode('m1').data as Record<string, (id: string) => void>).onEraseImage('m1');
    });
    expect(eraseToolbar()).toBeTruthy();

    await cropImage('m1');
    expect(eraseToolbar()).toBeNull();
    expect(cropEditing('m1')).toBe(true);
  });

  it('与擦除互斥（反向）：进入擦除退出裁切模式', async () => {
    await renderPage();
    await cropImage('m1');
    expect(cropEditing('m1')).toBe(true);

    await act(async () => {
      (fullNode('m1').data as Record<string, (id: string) => void>).onEraseImage('m1');
    });
    expect(cropEditing('m1')).toBe(false);
    expect(eraseToolbar()).toBeTruthy();
  });
});

describe('IKGW1H 退出裁切：丢弃不留痕，源卡保留', () => {
  it('Esc 退出：裁切标记消失，无卡无边无状态残留', async () => {
    await renderPage();
    await cropImage('m1');
    expect(cropEditing('m1')).toBe(true);

    await pressEscape();
    expectDiscardClean();
  });

  it('点画布空白退出（PaneClick，含框外暗区口径）：同口径无痕迹', async () => {
    await renderPage();
    await cropImage('m1');

    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expectDiscardClean();
  });

  it('点其他卡退出（单选非目标或多选）；空选中不退出（归 PaneClick）', async () => {
    await renderPage();
    await cropImage('m1');

    // 空选中：不退出
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [] });
    });
    expect(cropEditing('m1')).toBe(true);

    // 单选其他卡：退出并丢弃
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [fullNode('m2')] });
    });
    expectDiscardClean();
  });

  it('目标源图卡被删除时裁切态自动清理（标记不悬挂）', async () => {
    await renderPage();
    await cropImage('m1');
    expect(cropEditing('m1')).toBe(true);

    await act(async () => {
      (fullNode('m1').data as Record<string, (id: string) => void>).onDelete('m1');
    });
    expect(cropEditing('m1')).toBe(false);
  });
});

/* ============ IKGW1N 裁切框与比例面板接线（状态提升在 CanvasPage） ============ */

/** m1：1600×900 源图 → 内容盒 280×(280*16/9)，bounds 顶偏移 22.5（独立手算期望，不对拍组件侧函数） */
const M1_DISPLAY_W = 280 * (16 / 9);
const M1_BOUNDS = { x: 0, y: 22.5, width: M1_DISPLAY_W, height: 280 };

/** 当前传给 FlowCanvas 的裁切框覆盖层 props 形态（Canvas 打桩透出） */
interface CropFramePropShape {
  bounds: { x: number; y: number; width: number; height: number };
  rect: { x: number; y: number; width: number; height: number };
  preset: string;
  minSide: number;
  onRectChange: (rect: { x: number; y: number; width: number; height: number }) => void;
  onDarkAreaClick: () => void;
}

function cropFrameProp(): CropFramePropShape | null {
  return (flowProps.current.cropFrame ?? null) as CropFramePropShape | null;
}

async function clickBody(testId: string) {
  const btn = document.body.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
  if (!btn) throw new Error(`元素不存在: ${testId}`);
  await act(async () => { btn.click(); });
}

describe('IKGW1N 裁切框挂载与默认态', () => {
  it('未进入时无覆盖层；进入后默认自由比例、框为内容区全幅，minSide 为 64 自然像素显示换算', async () => {
    await renderPage();
    expect(cropFrameProp()).toBeNull();

    await cropImage('m1');
    const frame = cropFrameProp()!;
    expect(frame.preset).toBe('free');
    expect(frame.bounds.x).toBeCloseTo(M1_BOUNDS.x, 6);
    expect(frame.bounds.y).toBeCloseTo(M1_BOUNDS.y, 6);
    expect(frame.bounds.width).toBeCloseTo(M1_BOUNDS.width, 6);
    expect(frame.bounds.height).toBeCloseTo(M1_BOUNDS.height, 6);
    expect(frame.rect).toEqual(frame.bounds);
    // 64 × (显示宽 497.78 / 自然宽 1600) ≈ 19.91 显示像素
    expect(frame.minSide).toBeCloseTo(64 * (M1_DISPLAY_W / 1600), 6);
  });

  it('拖拽回写经状态提升生效：onRectChange 后覆盖层拿到新框', async () => {
    await renderPage();
    await cropImage('m1');
    const next = { x: 50, y: 60, width: 200, height: 150 };
    await act(async () => { cropFrameProp()!.onRectChange(next); });
    expect(cropFrameProp()!.rect).toEqual(next);
  });

  it('点框外暗区（onDarkAreaClick）退出并丢弃不留痕', async () => {
    await renderPage();
    await cropImage('m1');
    await act(async () => { cropFrameProp()!.onDarkAreaClick(); });
    expectDiscardClean();
    expect(cropFrameProp()).toBeNull();
  });
});

describe('IKGW1N 比例面板接线（面板真实渲染）', () => {
  it('进入裁切渲染面板：六比例选项 + 取消/确认齐备', async () => {
    await renderPage();
    await cropImage('m1');
    for (const key of ['free', '1-1', '4-3', '3-4', '16-9', '9-16']) {
      expect(document.body.querySelector(`[data-testid="crop-preset-${key}"]`), key).toBeTruthy();
    }
    expect(document.body.querySelector('[data-testid="crop-cancel"]')).toBeTruthy();
    expect(document.body.querySelector('[data-testid="crop-confirm"]')).toBeTruthy();
  });

  it('选预设 4:3：框同步为内容区内最大内接该比例矩形并居中，比例锁定', async () => {
    await renderPage();
    await cropImage('m1');
    await clickBody('crop-preset-4-3');

    const frame = cropFrameProp()!;
    expect(frame.preset).toBe('4:3');
    // 最大内接：高取满 280，宽 = 280×4/3，水平居中
    expect(frame.rect.width).toBeCloseTo(280 * (4 / 3), 6);
    expect(frame.rect.height).toBeCloseTo(280, 6);
    expect(frame.rect.x).toBeCloseTo((M1_DISPLAY_W - 280 * (4 / 3)) / 2, 6);
    expect(frame.rect.y).toBeCloseTo(22.5, 6);
  });

  it('切回自由：比例解除锁定，框保持当前不变', async () => {
    await renderPage();
    await cropImage('m1');
    await clickBody('crop-preset-1-1');
    const locked = cropFrameProp()!.rect;
    await clickBody('crop-preset-free');
    const frame = cropFrameProp()!;
    expect(frame.preset).toBe('free');
    expect(frame.rect).toEqual(locked);
  });

  it('面板取消：退出裁切并丢弃不留痕（onClose → exitCropMode）', async () => {
    await renderPage();
    await cropImage('m1');
    await clickBody('crop-cancel');
    expectDiscardClean();
  });

  /* 面板确认（IKGW1N 占位用例随 IKGW1S 实装退役）：确认按钮的执行链路断言
     （裁切→上传→建卡→连线→退出、不抢选中、失败留模式）由 cropEdit.test.tsx 完整接管。 */

  it('退出后重进：框回到全幅、比例回到自由（不记忆上次状态）', async () => {
    await renderPage();
    await cropImage('m1');
    await clickBody('crop-preset-4-3');
    expect(cropFrameProp()!.preset).toBe('4:3');
    await pressEscape();
    await cropImage('m1');
    const frame = cropFrameProp()!;
    expect(frame.preset).toBe('free');
    expect(frame.rect).toEqual(frame.bounds);
  });
});
