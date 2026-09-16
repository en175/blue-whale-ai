// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Node } from '@xyflow/react';
import CanvasPage from './index';

/* IKGBPB 画布粘贴的系统剪贴板兜底（页面级）：内部剪贴板为空时 Ctrl/Cmd+V 读系统剪贴板——
   图片贴成图片卡（placeFileOnCanvas 文件落卡链路）、纯文本贴成文本卡（新建文本卡路径）；
   视口中心落位 + 连续粘贴阶梯 + 新卡自动选中复用 IKGBPA 基座机制；内部剪贴板有内容时
   优先贴内部快照且不触发系统剪贴板读取 API；双空（含读取失败）静默无新卡。
   夹具同 keyboardClipboardPage.test.tsx（FlowCanvas 打桩透出 props），系统剪贴板
   打桩 navigator.clipboard（clipboardPaste.ts 的可测接缝），上传打桩 uploadAssetFile。 */

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

const uploadMock = vi.hoisted(() => ({ uploadAssetFile: vi.fn() }));
/* 只替换 uploadAssetFile（图片落卡链路的上传封装），其余导出透传真实实现，
   避免破坏经 CanvasPage 一并加载的其他消费方 */
vi.mock('@/utils/upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/upload')>()),
  uploadAssetFile: uploadMock.uploadAssetFile,
}));

const apiMocks = vi.hoisted(() => ({
  fetchProjects: vi.fn(async () => [{ id: 'p1', name: '项目一' }]),
  fetchMe: vi.fn(async () => null),
  fetchQuota: vi.fn(async () => ({})),
  toSessionUser: vi.fn(() => null),
  saveCanvasDoc: vi.fn(async () => ({ id: 11, project_id: 1, version: 4, viewport: '{}', nodes: '[]' })),
  fetchGenerationModels: vi.fn(async () => []),
}));

vi.mock('@/api/projects', () => ({
  fetchProjects: apiMocks.fetchProjects,
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
  applyPromptPreview: vi.fn(),
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

/** 验收画布：t1 文本卡一张（供 C 快照优先级用例），无连线 */
function seedFallbackDoc() {
  canvasDocMock.current = {
    doc: {
      id: 11,
      version: 3,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 't1', type: 'textNode', position: { x: 0, y: 0 },
          data: { text: '正文A', title: '标题A' },
        },
      ],
      edges: [],
    },
    assets: {},
    refetch: () => Promise.resolve([]),
    acceptDoc: vi.fn(),
  };
}

/** 打桩系统剪贴板（clipboardPaste.ts 读取接缝）：图片 items 与纯文本可分别控制，读取亦可抛错 */
function stubSystemClipboard(opts: {
  items?: Array<{ types: string[]; getType: (type: string) => Promise<Blob> }>;
  text?: string;
  readError?: boolean;
  textError?: boolean;
}) {
  const read = vi.fn(async () => {
    if (opts.readError) throw new Error('clipboard read denied');
    return opts.items ?? [];
  });
  const readText = vi.fn(async () => {
    if (opts.textError) throw new Error('clipboard readText denied');
    return opts.text ?? '';
  });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read, readText } });
  return { read, readText };
}

/** 系统剪贴板里的一张 PNG（与 readCanvasClipboard 的 item 形状对齐） */
function pngClipboardItem() {
  return {
    types: ['text/plain', 'image/png'],
    getType: async (type: string) =>
      type === 'image/png'
        ? new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
        : new Blob([''], { type }),
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
        createElement(MemoryRouter, { initialEntries: ['/canvas?project=p1'] }, createElement(CanvasPage)),
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

/** 粘贴产物（newNodeId 生成 text-/media- 前缀；seed 节点 t1 无该前缀，天然区分原卡） */
function textCopies(): Node[] {
  return textNodes().filter((n) => n.id.startsWith('text-'));
}

function mediaCopies(): Node[] {
  return mediaNodes().filter((n) => n.id.startsWith('media-'));
}

/** C 快照上抛（往内部剪贴板放内容用） */
async function copySelected(ids: string[]) {
  await act(async () => {
    flowProps.current.onCopySelected(ids);
  });
}

/** V 粘贴上抛（内部为空时走系统剪贴板兜底异步链，补一轮微任务冲刷） */
async function pasteClipboard() {
  await act(async () => {
    flowProps.current.onPasteClipboard();
  });
  await act(async () => {});
}

/** 页面级撤销监听收真实 Ctrl+Z */
async function pressUndo() {
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z', bubbles: true, cancelable: true, ctrlKey: true,
    }));
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  seedFallbackDoc();
  // jsdom 无 URL.createObjectURL（图片落卡链路的本地预览需要；cardRename.test.tsx 先例）
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} });
  uploadMock.uploadAssetFile.mockReset();
  uploadMock.uploadAssetFile.mockResolvedValue({
    asset_id: 'a-clip', url: 'http://img/clip.png', mime: 'image/png', width: 8, height: 8, size: 4,
  });
});

afterEach(async () => {
  if (root) await act(async () => { root.unmount(); });
  container?.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('IKGBPB 系统剪贴板含图片', () => {
  it('内部剪贴板为空：贴成图片卡（placeFileOnCanvas 落卡链路、视口中心落位、上传登记、新卡自动选中）', async () => {
    stubSystemClipboard({ items: [pngClipboardItem()] });
    await renderPage();

    await pasteClipboard();

    const card = mediaCopies()[0];
    expect(card, '贴出图片卡').toBeTruthy();
    expect(card.type).toBe('mediaNode');
    expect((card.data as Record<string, unknown>).mediaType).toBe('image');
    expect((card.data as Record<string, unknown>).fileName).toBe('粘贴.png');
    expect(card.position).toEqual({ x: 300, y: 200 });
    expect((card.data as Record<string, unknown>).assetId).toBe('a-clip');
    expect(uploadMock.uploadAssetFile).toHaveBeenCalledTimes(1);

    expect(flowProps.current.selectManyRequest).toEqual({
      ids: [card.id],
      ts: expect.any(Number),
    });
  });
});

describe('IKGBPB 系统剪贴板仅纯文本', () => {
  it('内部剪贴板为空：贴成文本卡（正文为剪贴板文本、视口中心落位、可撤销）', async () => {
    stubSystemClipboard({ items: [], text: '外部文本' });
    await renderPage();

    await pasteClipboard();

    const card = textCopies()[0];
    expect(card, '贴出文本卡').toBeTruthy();
    expect(card.type).toBe('textNode');
    expect(card.data?.text).toBe('外部文本');
    expect(card.position).toEqual({ x: 300, y: 200 });

    // 新卡自动选中
    expect(flowProps.current.selectManyRequest).toEqual({
      ids: [card.id],
      ts: expect.any(Number),
    });

    // 「新增节点」登记撤销：一次 Ctrl+Z 移除兜底贴出的卡
    await pressUndo();
    expect(textCopies()).toHaveLength(0);
  });
});

describe('IKGBPB 优先级：内部剪贴板优先', () => {
  it('内部剪贴板有内容：贴内部快照，系统剪贴板读取 API 完全不被调用', async () => {
    const { read, readText } = stubSystemClipboard({ items: [pngClipboardItem()], text: '外部文本' });
    await renderPage();
    await copySelected(['t1']);

    await pasteClipboard();

    // 贴出的是内部快照副本（标题A），非系统剪贴板内容
    const copy = textCopies()[0];
    expect(copy.data?.title).toBe('标题A');
    expect(mediaCopies()).toHaveLength(0);
    // 优先级可测：连读取 API 都不触发
    expect(read).not.toHaveBeenCalled();
    expect(readText).not.toHaveBeenCalled();
  });
});

describe('IKGBPB 双空静默', () => {
  it('内部与系统剪贴板均无内容：V 静默无新卡、无选中请求、不触发落卡', async () => {
    stubSystemClipboard({ items: [], text: '' });
    await renderPage();

    await pasteClipboard();

    expect(textCopies()).toHaveLength(0);
    expect(mediaCopies()).toHaveLength(0);
    expect(flowProps.current.selectManyRequest).toBeNull();
    expect(uploadMock.uploadAssetFile).not.toHaveBeenCalled();
  });

  it('系统剪贴板读取抛错（权限拒绝等）：同样静默无新卡', async () => {
    stubSystemClipboard({ readError: true, textError: true });
    await renderPage();

    await pasteClipboard();

    expect(textCopies()).toHaveLength(0);
    expect(mediaCopies()).toHaveLength(0);
    expect(flowProps.current.selectManyRequest).toBeNull();
  });
});

describe('IKGBPB 连续异步粘贴', () => {
  it('读取返回前连按两次 V：两张卡按基座阶梯右下错开不重叠', async () => {
    stubSystemClipboard({ items: [], text: '外部文本' });
    await renderPage();

    // 并发两次（模拟读取异步期间快速再按 V），落位在各自发起链路内同步结算
    await act(async () => {
      flowProps.current.onPasteClipboard();
      flowProps.current.onPasteClipboard();
    });
    await act(async () => {});

    const copies = textCopies();
    expect(copies).toHaveLength(2);
    const sorted = [...copies].sort((a, b) => a.position.x - b.position.x);
    expect(sorted[0].position).toEqual({ x: 300, y: 200 });
    expect(sorted[1].position).toEqual({ x: 340, y: 240 });
  });
});
