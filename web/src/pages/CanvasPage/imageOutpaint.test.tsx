// @vitest-environment jsdom
/* IKGOQX 扩图模式页面级测试：进入（会话建立、零扩展、refPickActive 禁框选禁拖动）、
   门槛拒绝、四种退出（面板 X / Esc / 点其他卡 / 点画布空白）均无残留（不建卡、不连线、
   不产生任务）、再次进入从零开始、预设联动驱动扩展框。渲染打桩同 imageEnhance.test.tsx。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';
import { ZERO_EXPANDS, type ExpandSides } from './imageOutpaint';
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
  createImageEnhancement: vi.fn(),
  createImageOutpaint: vi.fn(),
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
  createImageOutpaint: apiMocks.createImageOutpaint,
  readJobFailText: apiMocks.readJobFailText,
}));
vi.mock('@/api/image-enhancements', () => ({ createImageEnhancement: apiMocks.createImageEnhancement }));
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

/** 画布：图片 i1（1600×900，16:9 → 内容盒 497.78×280）与 i2（点其他卡退出用） */
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
          position: { x: 400, y: 0 },
          data: { src: 'http://img/i1.png', mediaType: 'image', fileName: '素材图', assetId: 'a5', width: 1600, height: 900, size: 1024 },
        },
        {
          id: 'i2',
          type: 'mediaNode',
          position: { x: 400, y: 600 },
          data: { src: 'http://img/i2.png', mediaType: 'image', fileName: '第二张图', assetId: 'a6', width: 800, height: 600, size: 2048 },
        },
      ],
      edges: [],
    },
    assets: {
      a5: { asset_id: 5, type: 'image', access_url: 'http://img/i1.png', width: 1600, height: 900 },
      a6: { asset_id: 6, type: 'image', access_url: 'http://img/i2.png', width: 800, height: 600 },
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

/** 走图片卡画质工具横排「扩图」按钮的入口（回调挂在节点 data 上，IKH3XZ） */
async function enterOutpaint(nodeId = 'i1') {
  const image = flowProps.current.mediaNodes.find((n: Node) => n.id === nodeId)!;
  await act(async () => {
    image.data.onOutpaintImage(nodeId);
  });
}

const frameProps = () => flowProps.current.outpaintFrame as
  | { rect: { x: number; y: number; width: number; height: number }; expands: ExpandSides; onExpandChange: (e: ExpandSides) => void }
  | null;

const nodeCount = () => (flowProps.current.mediaNodes as Node[]).length;

const noResidue = () => {
  expect(nodeCount()).toBe(2); // 不建卡
  expect(flowProps.current.edges).toEqual([]); // 不连线
  expect(apiMocks.createGenerationJob).not.toHaveBeenCalled(); // 不产生任务
  expect(apiMocks.createImageOutpaint).not.toHaveBeenCalled();
};

const dialogEl = () => document.body.querySelector('[data-testid="outpaint-dialog"]');

/** 打开比例上拉菜单（改版横条后预设项收在菜单内） */
async function openRatioMenu() {
  const trigger = document.body.querySelector<HTMLButtonElement>('[data-testid="outpaint-ratio-trigger"]')!;
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

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
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.clearAllMocks();
});

describe('IKGOQX 进入扩图模式', () => {
  it('点「扩图」建立会话：扩展框框住源图内容区、零扩展、面板浮现、refPickActive 隔离框选与他卡拖动', async () => {
    await renderPage();
    expect(frameProps()).toBeNull();
    await enterOutpaint();
    const frame = frameProps()!;
    expect(frame).toBeTruthy();
    // 内容区矩形：i1 位置 (400,0) + 标题偏移 22.5；1600×900 → 短边 280 → 内容盒 497.78×280
    expect(frame.rect.x).toBe(400);
    expect(frame.rect.y).toBeCloseTo(22.5, 6);
    expect(frame.rect.width).toBeCloseTo((280 * 16) / 9, 4);
    expect(frame.rect.height).toBeCloseTo(280, 6);
    // 进入默认零扩展（框与原图重合、默认原图比例）
    expect(frame.expands).toEqual(ZERO_EXPANDS);
    // 扩图工具栏浮现（比例菜单默认收起，展开后命中原图比例）
    expect(dialogEl()).toBeTruthy();
    await openRatioMenu();
    const original = document.body.querySelector<HTMLButtonElement>('[data-testid="outpaint-preset-original"]')!;
    expect(original.className).toMatch(/menuItemActive/);
    // 模式期间禁用框选与他卡拖动（refPickActive 同语义），平移缩放保留
    expect(flowProps.current.refPickActive).toBe(true);
    noResidue();
  });

  it('门槛预检拒绝（干净态）：长边超 4160 / 尺寸缺失均不进入', async () => {
    await renderPage();
    const over = flowProps.current.mediaNodes.find((n: Node) => n.id === 'i2')!;
    over.data.width = 5000;
    over.data.height = 3000;
    await act(async () => {
      over.data.onOutpaintImage('i2');
    });
    expect(frameProps()).toBeNull();
    expect(flowProps.current.refPickActive).toBe(false);
    noResidue();

    const noDims = flowProps.current.mediaNodes.find((n: Node) => n.id === 'i2')!;
    delete noDims.data.width;
    delete noDims.data.height;
    await act(async () => {
      noDims.data.onOutpaintImage('i2');
    });
    expect(frameProps()).toBeNull();
    noResidue();
  });
});

describe('IKGOQX 四种退出均无残留', () => {
  it('面板 X：退出且不建卡不连线不产生任务', async () => {
    await renderPage();
    await enterOutpaint();
    const close = document.body.querySelector<HTMLButtonElement>('[data-testid="outpaint-close"]')!;
    await act(async () => {
      close.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(frameProps()).toBeNull();
    expect(dialogEl()).toBeNull();
    expect(flowProps.current.refPickActive).toBe(false);
    noResidue();
  });

  it('Esc：退出且无残留', async () => {
    await renderPage();
    await enterOutpaint();
    await pressEscape();
    expect(frameProps()).toBeNull();
    expect(dialogEl()).toBeNull();
    noResidue();
  });

  it('点其他卡：退出并选中那张卡', async () => {
    await renderPage();
    await enterOutpaint();
    const i2 = flowProps.current.mediaNodes.find((n: Node) => n.id === 'i2')!;
    await act(async () => {
      flowProps.current.onNodeClick(i2);
    });
    expect(frameProps()).toBeNull();
    expect(flowProps.current.selectRequest).toEqual(expect.objectContaining({ id: 'i2' }));
    noResidue();
  });

  it('点画布空白：退出且无残留', async () => {
    await renderPage();
    await enterOutpaint();
    await act(async () => {
      flowProps.current.onPaneClick();
    });
    expect(frameProps()).toBeNull();
    expect(dialogEl()).toBeNull();
    noResidue();
  });

  it('点源图卡本身：保持模式不退出', async () => {
    await renderPage();
    await enterOutpaint();
    const i1 = flowProps.current.mediaNodes.find((n: Node) => n.id === 'i1')!;
    await act(async () => {
      flowProps.current.onNodeClick(i1);
    });
    expect(frameProps()).toBeTruthy();
    expect(dialogEl()).toBeTruthy();
  });
});

describe('IKGOQX 再次进入从零开始', () => {
  it('退出后扩展量清零；拖出的扩展不残留到下一次进入', async () => {
    await renderPage();
    await enterOutpaint();
    // 拖出扩展（模拟扩展框回调）
    await act(async () => {
      frameProps()!.onExpandChange({ top: 30, right: 60, bottom: 0, left: 0 });
    });
    expect(frameProps()!.expands).toEqual({ top: 30, right: 60, bottom: 0, left: 0 });
    await pressEscape();
    expect(frameProps()).toBeNull();
    // 再次进入：从零开始
    await enterOutpaint();
    expect(frameProps()!.expands).toEqual(ZERO_EXPANDS);
    await openRatioMenu();
    const original = document.body.querySelector<HTMLButtonElement>('[data-testid="outpaint-preset-original"]')!;
    expect(original.className).toMatch(/menuItemActive/);
  });
});

describe('IKGOQX 面板预设联动驱动扩展框', () => {
  it('点 16:9 预设：以原图中心为锚外扩到最小包含框（上下零扩展、左右各 (533.33-497.78)/2）', async () => {
    await renderPage();
    await enterOutpaint();
    await openRatioMenu();
    const btn = document.body.querySelector<HTMLButtonElement>('[data-testid="outpaint-preset-16-9"]')!;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const expands = frameProps()!.expands;
    const rect = frameProps()!.rect;
    const boxW = rect.width + expands.left + expands.right;
    // 16:9 高定宽：280×16/9 ≈ 497.78 == 内容盒宽（16:9 原图）→ 零扩展命中 16:9 也等于原图比例
    // 该图本身 16:9：16:9 预设最小包含框就是原图 → 零扩展（原比例命中优先级见纯函数测试）
    expect(boxW / (rect.height + expands.top + expands.bottom)).toBeCloseTo(16 / 9, 4);
    noResidue();
  });

  it('点 9:16 预设：宽定高 497.78×16/9 ≈ 884.96，上下各扩 (884.96-280)/2 = 302.48 超 40% 上限（112）→ 置灰', async () => {
    await renderPage();
    await enterOutpaint();
    await openRatioMenu();
    const btn = document.body.querySelector<HTMLButtonElement>('[data-testid="outpaint-preset-9-16"]')!;
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    expect(btn.getAttribute('title')).toContain('40%');
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // 置灰不触发：保持零扩展
    expect(frameProps()!.expands).toEqual(ZERO_EXPANDS);
  });

  it('点 1:1 预设（4:3 源图场景）：i2 800×600 内容盒 373.33×280，1:1 上下各扩 46.67', async () => {
    await renderPage();
    await enterOutpaint('i2');
    await openRatioMenu();
    const btn = document.body.querySelector<HTMLButtonElement>('[data-testid="outpaint-preset-1-1"]')!;
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const expands = frameProps()!.expands;
    expect(expands.left).toBeCloseTo(0, 6);
    expect(expands.right).toBeCloseTo(0, 6);
    expect(expands.top).toBeCloseTo(46.6667, 3);
    expect(expands.bottom).toBeCloseTo(46.6667, 3);
    // 1:1 预设命中高亮（重新展开菜单查看）
    await openRatioMenu();
    const active = document.body.querySelector<HTMLButtonElement>('[data-testid="outpaint-preset-1-1"]')!;
    expect(active.className).toMatch(/menuItemActive/);
  });
});
