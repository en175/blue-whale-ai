// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canvasDocMock,
  enableReactActEnvironment,
  flowProps,
  mediaCopies,
  pasteClipboard,
  copySelected,
  pressUndo,
  renderPage,
  textCopies,
  textNodes,
  unmountPage,
} from '../../testing/canvasPageTestHarness';


const uploadMock = vi.hoisted(() => ({ uploadAssetFile: vi.fn() }));
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
vi.mock('@/custom/utils/upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/custom/utils/upload')>()),
  uploadAssetFile: uploadMock.uploadAssetFile,
}));

const upsertAssets = vi.fn();

function seedFallbackDoc() {
  upsertAssets.mockReset();
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
  Object.assign(canvasDocMock.current, { upsertAssets });
}

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

function pngClipboardItem() {
  return {
    types: ['text/plain', 'image/png'],
    getType: async (type: string) =>
      type === 'image/png'
        ? new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })
        : new Blob([''], { type }),
  };
}

beforeEach(() => {
  enableReactActEnvironment();
  localStorage.clear();
  sessionStorage.clear();
  seedFallbackDoc();
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} });
  uploadMock.uploadAssetFile.mockReset();
  uploadMock.uploadAssetFile.mockResolvedValue({
    asset_id: 'a-clip', url: 'http://img/clip.png', mime: 'image/png', width: 8, height: 8, size: 4,
  });
});

afterEach(async () => {
  await unmountPage();
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

  it('上传返回 material_status Active：节点标 Seedance 校验通过并回写快照', async () => {
    uploadMock.uploadAssetFile.mockResolvedValue({
      asset_id: '526',
      url: 'http://img/clip.png',
      mime: 'image/png',
      width: 8,
      height: 8,
      size: 4,
      material_id: 'asset-20260820153209-6c9z8',
      material_status: 'Active',
    });
    stubSystemClipboard({ items: [pngClipboardItem()] });
    await renderPage();

    await pasteClipboard();

    const card = mediaCopies()[0];
    const data = card.data as Record<string, unknown>;
    expect(data.compliancePassed).toBe(true);
    expect(data.complianceFailed).toBe(false);
    expect(data.materialId).toBe('asset-20260820153209-6c9z8');
    expect(upsertAssets).toHaveBeenCalledWith([
      expect.objectContaining({
        asset_id: 526,
        material_id: 'asset-20260820153209-6c9z8',
        material_status: 'Active',
      }),
    ]);
  });

  it('上传返回 material_status null：不标合规通过', async () => {
    uploadMock.uploadAssetFile.mockResolvedValue({
      asset_id: '526',
      url: 'http://img/clip.png',
      mime: 'image/png',
      width: 8,
      height: 8,
      size: 4,
      material_id: null,
      material_status: null,
    });
    stubSystemClipboard({ items: [pngClipboardItem()] });
    await renderPage();

    await pasteClipboard();

    const data = mediaCopies()[0].data as Record<string, unknown>;
    expect(data.compliancePassed).toBeUndefined();
    expect(data.materialId).toBeUndefined();
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

    expect(flowProps.current.selectManyRequest).toEqual({
      ids: [card.id],
      ts: expect.any(Number),
    });

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

    const copy = textCopies()[0];
    expect(copy.data?.title).toBe('标题A');
    expect(mediaCopies()).toHaveLength(0);
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

describe('卡片右键菜单入口保持原行为（父单故事 32）', () => {
  function t1Callbacks(): Record<string, any> {
    return textNodes().find((n) => n.id === 't1')!.data as Record<string, any>;
  }

  it('「粘贴」仍走 applyClipboardAtFlow：读系统剪贴板贴原卡右下，不吃内部剪贴板快照', async () => {
    const { read } = stubSystemClipboard({ items: [], text: '菜单粘贴文本' });
    await renderPage();
    await copySelected(['t1']);

    await act(async () => {
      t1Callbacks().onPaste('t1');
    });
    await act(async () => {});

    const pasted = textCopies().find((n) => n.data?.text === '菜单粘贴文本')!;
    expect(pasted, '贴出系统剪贴板内容').toBeTruthy();
    expect(pasted.position).toEqual({ x: 40, y: 40 });
    expect(read).toHaveBeenCalled();

    await pasteClipboard();
    const snapshotCopy = textCopies().find((n) => n.data?.text === '正文A')!;
    expect(snapshotCopy.position).toEqual({ x: 300, y: 200 });
  });

  it('「创建副本」仍走既有复制入口：副本贴原卡右下，不进画布内部剪贴板', async () => {
    stubSystemClipboard({ items: [], text: '' });
    await renderPage();

    await act(async () => {
      t1Callbacks().onDuplicate('t1');
    });
    const dup = textCopies()[0];
    expect(dup.data?.title).toBe('标题A');
    expect(dup.position).toEqual({ x: 40, y: 40 });

    await pasteClipboard();
    expect(textCopies()).toHaveLength(1);

    await act(async () => {
      t1Callbacks().onPaste('t1');
    });
    await act(async () => {});
    await vi.waitFor(() => expect(document.body.textContent).toContain('剪贴板无可粘贴内容'), { timeout: 3000 });
    expect(textCopies()).toHaveLength(1);
  });
});
