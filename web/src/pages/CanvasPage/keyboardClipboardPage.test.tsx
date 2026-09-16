// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';

/* IKGBPA 画布内部剪贴板（页面级）：C 快照定格（删/改名/编辑原卡不影响副本）、
   V 视口中心落位 + 多卡原相对位置 + 连续粘贴阶梯、新卡自动选中、@ 派生索引线重建、
   手拉连线不复制、粘贴可撤销（真实 Ctrl+Z）、切项目清空、与 Ctrl/Cmd+D 立即复制并存。
   FlowCanvas 打桩透出 props（cardRename 先例）；撤销监听在页面级 document，派发真实 KeyboardEvent。 */

vi.mock('./components/AgentPanel', () => ({
  default: ({ initialCardLabel }: { initialCardLabel?: string }) =>
    createElement('div', { 'data-testid': 'agent-panel-stub' }, initialCardLabel),
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
  default: (props: Record<string, any>) => createElement('div', { 'data-testid': 'canvas-toolbar' }),
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
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }, { id: 'p2', name: '项目二' }]),
  createProject: vi.fn(),
  renameProject: vi.fn(),
  deleteProject: vi.fn(),
  fetchMe: vi.fn(async () => null),
  fetchQuota: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  applyPromptPreview: vi.fn(),
  saveCanvasDoc: vi.fn(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  fetchGenerationModels: vi.fn(async () => []),
}));

vi.mock('@/api/projects', () => ({
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
  listLegacyCardHistory: vi.fn(async () => ({ items: [] })),
  createConversationQuote: vi.fn(),
  legacyCardHistoryOptions: (projectId: string) => ({ queryKey: ['canvas', projectId, 'legacy-history'], queryFn: () => Promise.resolve({ items: [] }), retry: false }),
  saveCanvasDoc: apiMocks.saveCanvasDoc,
  serializeNodes: vi.fn((nodes: Node[]) =>
    JSON.stringify(nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }))),
  ),
  serializeEdges: vi.fn((edges: Array<{ id: string; source: string; target: string }>) =>
    JSON.stringify(edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))),
  ),
}));
vi.mock('@/api/jobs', () => ({
  createGenerationJob: vi.fn(),
  cancelGenerationJob: vi.fn(),
  retryGenerationJob: vi.fn(),
  fetchJobStatus: vi.fn(),
  createMediaExtraction: vi.fn(),
  readJobFailText: vi.fn(() => ''),
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

vi.mock('./hooks/useCanvasDoc', () => ({
  useCanvasDoc: () => canvasDocMock.current,
}));

/**
 * 验收画布文档：
 * - t1：文本卡（title/正文/正文 @ 引用 m1 的派生索引 + 会话性 prompt 字段）
 * - m1：图片媒体卡
 * - e-hand：t1 → m1 手拉连线（验证不随粘贴复制）
 */
function seedClipboardDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 't1', type: 'textNode', position: { x: 0, y: 0 },
          data: {
            text: '正文A',
            title: '标题A',
            mediaMentions: [{ start: 1, end: 2, nodeId: 'm1', assetId: '1' }],
            promptSource: { promptId: 'sess-1' },
          },
        },
        {
          id: 'm1', type: 'mediaNode', position: { x: 400, y: 100 },
          data: { src: 'http://img/a.png', mediaType: 'image', fileName: '图A.png', assetId: 'a1' },
        },
      ],
      edges: [{ id: 'e-hand', source: 't1', target: 'm1' }],
    },
    assets: {
      a1: { asset_id: 1, type: 'image', access_url: 'http://img/a.png', width: 100, height: 100 },
    },
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

let root: Root;
let container: HTMLDivElement;
/** 暴露 navigate 供切项目用例改 URL query（currentId 随 location.search 迁移） */
let navigateRef: ((to: string) => void) | null = null;
function NavProbe() {
  navigateRef = useNavigate();
  return null;
}

async function renderPage() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(MemoryRouter, { initialEntries: ['/canvas?project=p1'] }, createElement(NavProbe), createElement(CanvasPage)),
      ),
    );
  });
}

function textNodes(): Node[] {
  return flowProps.current.textNodes as Node[];
}

function mediaNodes(): Node[] {
  return flowProps.current.mediaNodes as Node[];
}

/** 粘贴副本（newNodeId 生成 text- 前缀；seed 节点 t1 无该前缀，天然区分原卡） */
function textCopies(): Node[] {
  return textNodes().filter((n) => n.id.startsWith('text-'));
}

function mediaCopies(): Node[] {
  return mediaNodes().filter((n) => n.id.startsWith('media-'));
}

/** C 快照上抛（Canvas 入口已过滤 text/media，页面收到的即最终名单） */
async function copySelected(ids: string[]) {
  await act(async () => {
    flowProps.current.onCopySelected(ids);
  });
}

/** V 粘贴上抛 */
async function pasteClipboard() {
  await act(async () => {
    flowProps.current.onPasteClipboard();
  });
}

/** 页面级撤销监听（document 捕获级）收真实 Ctrl+Z */
async function pressUndo(modifier: 'ctrl' | 'meta' = 'ctrl') {
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z', bubbles: true, cancelable: true,
      ctrlKey: modifier === 'ctrl', metaKey: modifier === 'meta',
    }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedClipboardDoc();
});

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  container?.remove();
  navigateRef = null;
  vi.clearAllMocks();
});

describe('IKGBPA 快照定格', () => {
  it('复制后原卡被删除/改名/编辑：粘贴出的副本仍是复制时刻的样子', async () => {
    await renderPage();
    await copySelected(['t1']);

    // 复制后原卡改名 + 改正文（页面真实回调）
    await act(async () => {
      (textNodes().find((n) => n.id === 't1')!.data as Record<string, any>).onTitleChange('t1', '改名后');
    });
    await act(async () => {
      (textNodes().find((n) => n.id === 't1')!.data as Record<string, any>).onTextChange('t1', '新正文');
    });
    // 删除原卡
    await act(async () => {
      flowProps.current.onDeleteNode(['t1']);
    });
    expect(textNodes().some((n) => n.id === 't1')).toBe(false);

    await pasteClipboard();
    const copy = textNodes().find((n) => n.data?.title === '标题A')!;
    expect(copy, '粘贴出复制时刻的副本').toBeTruthy();
    expect(copy.data.text).toBe('正文A');
    expect(copy.type).toBe('textNode');
    expect(copy.id).not.toBe('t1');
  });

  it('副本剥离会话性提示词来源字段（对齐 Ctrl/Cmd+D 立即复制清理）', async () => {
    await renderPage();
    await copySelected(['t1']);
    await pasteClipboard();
    const copy = textCopies()[0];
    expect(copy.data?.title).toBe('标题A');
    expect((copy.data as Record<string, unknown>).promptSource).toBeUndefined();
  });
});

describe('IKGBPA 视口中心落位与连续粘贴阶梯', () => {
  it('单卡贴在视口中心（页面 spawnPos 注册前的回退中心 300,200）', async () => {
    await renderPage();
    await copySelected(['t1']);
    await pasteClipboard();
    expect(textCopies()[0].position).toEqual({ x: 300, y: 200 });
  });

  it('多卡快照按原相对位置整体落位', async () => {
    await renderPage();
    await copySelected(['t1', 'm1']);
    await pasteClipboard();

    // 原相对位置 (400,100) - (0,0) 保持
    expect(textCopies()[0].position).toEqual({ x: 300, y: 200 });
    expect(mediaCopies()[0].position).toEqual({ x: 700, y: 300 });
  });

  it('连续粘贴逐张往右下错开（每次成功粘贴整组 +40/+40）', async () => {
    await renderPage();
    await copySelected(['t1']);
    await pasteClipboard();
    await pasteClipboard();
    const copies = textCopies();
    expect(copies).toHaveLength(2);
    const sorted = [...copies].sort((a, b) => a.position.x - b.position.x);
    expect(sorted[0].position).toEqual({ x: 300, y: 200 });
    expect(sorted[1].position).toEqual({ x: 340, y: 240 });
  });

  it('每次成功复制重置连续粘贴偏移', async () => {
    await renderPage();
    await copySelected(['t1']);
    await pasteClipboard();
    await copySelected(['t1']); // 重新复制：偏移归零
    await pasteClipboard();
    const copies = textCopies();
    expect(copies).toHaveLength(2);
    expect(copies.every((n) => n.position.x === 300 && n.position.y === 200)).toBe(true);
  });
});

describe('IKGBPA 新卡自动选中', () => {
  it('粘贴出的全部副本成为选中请求目标', async () => {
    await renderPage();
    await copySelected(['t1', 'm1']);
    await pasteClipboard();

    const copyT = textCopies()[0];
    const copyM = mediaCopies()[0];
    expect(flowProps.current.selectManyRequest).toEqual({
      ids: expect.arrayContaining([copyT.id, copyM.id]),
      ts: expect.any(Number),
    });
  });
});

describe('IKGBPA 连线语义', () => {
  it('文本卡副本重建正文 @ 引用派生索引线；手拉连线不随粘贴', async () => {
    await renderPage();
    await copySelected(['t1', 'm1']);
    await pasteClipboard();

    const copyT = textCopies()[0];
    const copyM = mediaCopies()[0];
    const edges = flowProps.current.edges as Array<{ id: string; source: string; target: string; data?: Record<string, unknown> }>;

    // 派生索引线：来源媒体卡 m1（仍在画布）→ 副本文本卡
    const derived = edges.find((e) => e.source === 'm1' && e.target === copyT.id);
    expect(derived, '副本获得有效 media 索引（IKFM3Q 契约 §4）').toBeTruthy();
    expect(derived!.data?.textIndex).toBe(true);

    // 手拉连线不复制：副本之间、原卡与副本之间均无手拉线；原线保留
    expect(edges.some((e) => e.source === copyT.id)).toBe(false);
    expect(edges.some((e) => e.source === 't1' && e.target === copyM.id)).toBe(false);
    expect(edges.some((e) => e.id === 'e-hand')).toBe(true);
  });
});

describe('IKGBPA 粘贴可撤销', () => {
  it.each(['ctrl', 'meta'])('真实 %s+Z 撤销后副本消失（派生线与节点按既有两条目顺序撤回）', async (modifier) => {
    await renderPage();
    await copySelected(['t1', 'm1']);
    await pasteClipboard();
    expect(textCopies()).toHaveLength(1);
    expect(mediaCopies()).toHaveLength(1);

    // 第一次 Z：撤派生索引线（对齐立即复制 addNodes + addEdges 两条既有登记形态）
    await pressUndo(modifier as 'ctrl' | 'meta');
    expect(textCopies(), '先撤线不撤卡').toHaveLength(1);
    const edgesAfterLineUndo = flowProps.current.edges as Array<{ source: string; target: string }>;
    expect(edgesAfterLineUndo.every((e) => !e.target.startsWith('text-'))).toBe(true);

    // 第二次 Z：撤整组副本
    await pressUndo(modifier as 'ctrl' | 'meta');
    expect(textCopies()).toHaveLength(0);
    expect(mediaCopies()).toHaveLength(0);
    const edges = flowProps.current.edges as Array<{ source: string; target: string }>;
    expect(edges.every((e) => !e.target.startsWith('text-'))).toBe(true);
  });
});

describe('IKGBPA 切换项目清空画布剪贴板', () => {
  it('复制后切到项目二：粘贴静默无新卡', async () => {
    await renderPage();
    await copySelected(['t1']);
    expect(navigateRef).toBeTruthy();

    await act(async () => {
      navigateRef!('/canvas?project=p2');
    });
    await pasteClipboard();

    // 粘贴副本 id 由 newNodeId 生成（text- 前缀）；seed 节点无该前缀
    expect(textNodes().some((n) => n.id.startsWith('text-'))).toBe(false);
  });
});

describe('IKGBPA 与 Ctrl/Cmd+D 立即复制并存', () => {
  it('D 立即复制落旁边 (+40/+40)，C/V 快照贴视口中心，两路副本共存互不干扰', async () => {
    await renderPage();

    // Ctrl/Cmd+D 既有路径：副本出现在原卡右下 40,40
    await act(async () => {
      flowProps.current.onDuplicateSelected(['t1']);
    });
    const dup = textNodes().find((n) => n.id !== 't1')!;
    expect(dup.data?.title).toBe('标题A');
    expect(dup.position).toEqual({ x: 40, y: 40 });

    // C/V 快照路径：贴视口中心
    await copySelected(['t1']);
    await pasteClipboard();
    const pasted = textNodes().filter((n) => n.data?.title === '标题A' && n.id !== 't1' && n.id !== dup.id);
    expect(pasted).toHaveLength(1);
    expect(pasted[0].position).toEqual({ x: 300, y: 200 });
    expect(dup.position).toEqual({ x: 40, y: 40 });
  });
});
