// @vitest-environment jsdom
/* IKGM9O 高清放大面板闭环链路测试：建卡后自动开高清面板、发送创建任务（六键冻结 + lastParams
   写入 + 原地转生成中 + 面板自动关闭）、「重新编辑」分流回填 lastParams、失败重试走 lastParams
   原样重发（不走通用 retry 接口）、生成中重开面板只读、成品高清卡链式放大。
   渲染模式沿用 imageEnhance.test.tsx（FlowCanvas 打桩透出 props）。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { IMAGE_ENHANCE_EDGE_ORIGIN } from './imageEnhance';
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
  createVideoEnhancement: vi.fn(),
  createMediaExtraction: vi.fn(),
  createImageEnhancement: vi.fn(async (_projectId: string, _payload: Record<string, unknown>) => ({
    job_id: '88',
    status: 'queued' as const,
  })),
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
  createImageEnhancement: apiMocks.createImageEnhancement,
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

/** 画布：一个就绪图片节点 i1（assetId '5'，契约形态数字字符串）+ 可选成品高清卡 h1。
 *  withFinishedEnhance：true 正常成品卡；'failed' 失败态成品卡（重试链路） */
function seedDoc(withFinishedEnhance: boolean | 'failed' = false) {
  const nodes: Array<Record<string, unknown>> = [
    {
      id: 'i1',
      type: 'mediaNode',
      position: { x: 400, y: 0 },
      data: { src: 'http://img/i1.png', mediaType: 'image', fileName: '素材图', assetId: '5', width: 1600, height: 900 },
    },
  ];
  if (withFinishedEnhance) {
    nodes.push({
      id: 'h1',
      type: 'mediaNode',
      position: { x: 958, y: 0 },
      data: {
        src: 'http://img/hd.png',
        mediaType: 'image',
        fileName: '生成-77',
        assetId: '9',
        width: 3200, height: 1800,
        jobId: '77',
        ...(withFinishedEnhance === 'failed'
          ? { genStatus: 'failed', errorText: '高清放大失败，请重试' }
          : {}),
        imageEnhance: {
          sourceAssetId: '5',
          lastParams: {
            source_asset_id: '5',
            target_node_id: 'h1',
            version_tier: 'max',
            multiple: 4,
            generative_enhance_mode: 'fidelity_first',
            enable_correct_color: true,
          },
        },
      },
    });
  }
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes,
      edges: withFinishedEnhance
        ? [{ id: 'e1', source: 'i1', target: 'h1', data: { origin: IMAGE_ENHANCE_EDGE_ORIGIN } }]
        : [],
    },
    assets: {
      5: { asset_id: 5, type: 'image', access_url: 'http://img/i1.png', width: 1600, height: 900 },
      9: { asset_id: 9, type: 'image', access_url: 'http://img/hd.png', width: 3200, height: 1800 },
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

/** 走图片节点工具栏的「高清放大」入口（回调挂在节点 data 上） */
async function enhanceImage() {
  const image = flowProps.current.mediaNodes.find((n: Node) => n.id === 'i1')!;
  await act(async () => {
    image.data.onEnhanceImage('i1');
  });
}

const mediaNode = (id: string) => (flowProps.current.mediaNodes as Node[]).find((n) => n.id === id)!;
const panelSend = () => document.body.querySelector<HTMLButtonElement>('[data-testid="enhance-send-btn"]');

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('IKGM9O 建卡后自动开高清面板', () => {
  it('点「高清放大」建卡后弹出高清面板（不开发图片面板），面板跟随锚定高清卡', async () => {
    seedDoc();
    await renderPage();
    await enhanceImage();

    const draftId = (flowProps.current.mediaNodes as Node[]).find((n) => n.id !== 'i1')!.id;
    // 面板已渲染（发送按钮存在）且面板领土标记在（点外关闭豁免链）
    expect(panelSend()).toBeTruthy();
    expect(document.body.querySelector('[data-gen-panel-territory]')).toBeTruthy();
    // 面板绑定新卡：选中切到源卡（onSelectionChange）时面板隐藏（绑定目标失配）
    await act(async () => {
      flowProps.current.onSelectionChange({ nodes: [mediaNode('i1')], edges: [] });
    });
    expect(panelSend()).toBeNull();
    void draftId;
  });

  it('默认渲染：Pro / 2x / 生成度优先 / MediaKit；源卡尺寸 1600×900 三档可用', async () => {
    seedDoc();
    await renderPage();
    await enhanceImage();

    expect(document.body.querySelector('[data-testid="enhance-model-btn"]')!.textContent).toContain('Pro');
    expect(
      document.body.querySelector<HTMLButtonElement>('[data-testid="enhance-multiple-2"]')!.className,
    ).toMatch(/Active/);
    expect(document.body.querySelector('[data-testid="enhance-provider-btn"]')!.textContent).toContain('MediaKit');
  });
});

describe('IKGM9O 发送创建任务闭环', () => {
  it('发送：六键冻结 payload、lastParams 写入节点、原地转生成中、面板自动关闭、启动轮询', async () => {
    seedDoc();
    await renderPage();
    await enhanceImage();
    const draftId = (flowProps.current.mediaNodes as Node[]).find((n) => n.id !== 'i1')!.id;

    await act(async () => {
      panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // 创建请求已发出 → 面板自动关闭
    expect(panelSend()).toBeNull();
    expect(apiMocks.createImageEnhancement).toHaveBeenCalledTimes(1);
    const [projectId, payload] = apiMocks.createImageEnhancement.mock.calls[0];
    expect(projectId).toBe('p1');
    // 六键冻结（默认档 Pro：色彩校正冻结 false）
    expect(payload).toEqual({
      source_asset_id: '5',
      target_node_id: draftId,
      version_tier: 'pro',
      multiple: 2,
      generative_enhance_mode: 'generative_first',
      enable_correct_color: false,
    });
    // 原地转生成中 + lastParams 随提交写入
    const draft = mediaNode(draftId);
    const data = draft.data as Record<string, unknown>;
    expect(data.genStatus).toBe('generating');
    expect(data.progress).toBe(0);
    expect((data.imageEnhance as Record<string, unknown>).lastParams).toEqual(payload);
    // 创建成功后 jobId 回填并启动轮询
    await act(async () => {
      await Promise.resolve();
    });
    expect((mediaNode(draftId).data as Record<string, unknown>).jobId).toBe('88');
    expect(apiMocks.fetchJobStatus).toHaveBeenCalledWith('88');
    // 源卡全程不变
    expect((mediaNode('i1').data as Record<string, unknown>).src).toBe('http://img/i1.png');
  });

  it('面板改选 Max 并开色彩校正后发送：payload 尊重用户选择（enable_correct_color=true）', async () => {
    seedDoc();
    await renderPage();
    await enhanceImage();
    const draftId = (flowProps.current.mediaNodes as Node[]).find((n) => n.id !== 'i1')!.id;

    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[data-testid="enhance-model-btn"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[data-testid="enhance-model-option-max"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(apiMocks.createImageEnhancement.mock.calls[0][1]).toEqual({
      source_asset_id: '5',
      target_node_id: draftId,
      version_tier: 'max',
      multiple: 2,
      generative_enhance_mode: 'generative_first',
      enable_correct_color: true,
    });
  });
});

describe('IKGM9O 重新编辑分流与回填（IKH3WE 起入口 = 点卡片开面板）', () => {
  it('成品高清卡点卡片打开高清面板并回填 lastParams（不再开发图片面板）', async () => {
    seedDoc(true);
    await renderPage();

    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('h1'));
    });
    expect(panelSend()).toBeTruthy();
    // lastParams 回填：Max / 4x / 保真度优先 / 色彩校正开
    expect(document.body.querySelector('[data-testid="enhance-model-btn"]')!.textContent).toContain('Max');
    expect(
      document.body.querySelector<HTMLButtonElement>('[data-testid="enhance-multiple-4"]')!.className,
    ).toMatch(/Active/);
    expect(
      document.body.querySelector<HTMLButtonElement>('[data-testid="enhance-mode-fidelity_first"]')!.className,
    ).toMatch(/Active/);
    expect(
      (document.body.querySelector('[data-testid="enhance-color-toggle"]') as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('重新生成替换本卡素材不新建卡：成品高清卡面板再次发送仍在原卡转生成中', async () => {
    seedDoc(true);
    await renderPage();

    await act(async () => {
      flowProps.current.onNodeClick(mediaNode('h1'));
    });
    await act(async () => {
      panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // 卡片数量不变（无新建占位卡）
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(2);
    const data = mediaNode('h1').data as Record<string, unknown>;
    expect(data.genStatus).toBe('generating');
    expect(data.src).toBe('http://img/hd.png'); // 旧素材保留显示（重新生成中叠加状态角标）
    expect(apiMocks.createImageEnhancement.mock.calls[0][1]).toMatchObject({ target_node_id: 'h1', version_tier: 'max' });
  });

  it('失败重试走 lastParams 原样重发：不经通用 retry 接口', async () => {
    seedDoc('failed');
    await renderPage();
    // 经真实 state 链路走 onRetryJob 回调：直接用当前节点 data 上的回调
    const retryCb = (mediaNode('h1').data as Record<string, unknown>).onRetryJob as (id: string) => void;
    await act(async () => {
      retryCb('h1');
    });
    expect(apiMocks.createImageEnhancement).toHaveBeenCalledTimes(1);
    expect(apiMocks.retryGenerationJob).not.toHaveBeenCalled();
    // lastParams 原样重发（含 max/4/fidelity_first/true 冻结值）
    expect(apiMocks.createImageEnhancement.mock.calls[0][1]).toMatchObject({
      source_asset_id: '5',
      target_node_id: 'h1',
      version_tier: 'max',
      multiple: 4,
      generative_enhance_mode: 'fidelity_first',
      enable_correct_color: true,
    });
    expect((mediaNode('h1').data as Record<string, unknown>).genStatus).toBe('generating');
  });
});

describe('IKGM9O 生成中重开面板只读', () => {
  it('生成中的高清草稿卡点卡重开面板：参数只读冻结展示', async () => {
    seedDoc();
    await renderPage();
    await enhanceImage();
    const draftId = (flowProps.current.mediaNodes as Node[]).find((n) => n.id !== 'i1')!.id;
    await act(async () => {
      panelSend()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect((mediaNode(draftId).data as Record<string, unknown>).genStatus).toBe('generating');

    // 点生成中的高清卡重开面板
    await act(async () => {
      flowProps.current.onNodeClick(mediaNode(draftId));
    });
    expect(panelSend()).toBeTruthy();
    expect(document.body.textContent).toContain('生成中，参数只读');
    expect(
      (document.body.querySelector('[data-testid="enhance-send-btn"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('IKGM9O 链式放大', () => {
  it('成品高清卡上再点「高清放大」：以高清卡自身为源新建新卡（链式）', async () => {
    seedDoc(true);
    await renderPage();

    await act(async () => {
      ((mediaNode('h1').data as Record<string, unknown>).onEnhanceImage as (id: string) => void)('h1');
    });
    expect((flowProps.current.mediaNodes as Node[]).length).toBe(3);
    const chained = (flowProps.current.mediaNodes as Node[]).find((n) => n.id !== 'i1' && n.id !== 'h1')!;
    const data = chained.data as Record<string, unknown>;
    // 链式新卡的源素材身份 = 高清卡自身 assetId（a9）
    expect(data.imageEnhance).toEqual({ sourceAssetId: '9' });
    // 建卡即弹面板
    expect(panelSend()).toBeTruthy();
    // 源边从高清卡连到新卡
    const edge = (flowProps.current.edges as Array<{ source: string; target: string; data?: Record<string, unknown> }>)
      .find((e) => e.target === chained.id)!;
    expect(edge.source).toBe('h1');
    expect(edge.data).toEqual({ origin: IMAGE_ENHANCE_EDGE_ORIGIN });
  });
});
