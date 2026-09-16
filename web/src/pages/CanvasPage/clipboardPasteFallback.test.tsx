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
} from './testing/canvasPageTestHarness';

/* IKGBPB 画布粘贴的系统剪贴板兜底（页面级）：内部剪贴板为空时 Ctrl/Cmd+V 读系统剪贴板——
   图片贴成图片卡（placeFileOnCanvas 文件落卡链路）、纯文本贴成文本卡（新建文本卡路径）；
   视口中心落位 + 连续粘贴阶梯 + 新卡自动选中复用 IKGBPA 基座机制；内部剪贴板有内容时
   优先贴内部快照且不触发系统剪贴板读取 API；双空（含读取失败）静默无新卡。
   共享夹具见 canvasPageTestHarness（FlowCanvas 打桩透出 props），本文件特有：
   系统剪贴板打桩 navigator.clipboard（clipboardPaste.ts 的可测接缝）、上传打桩 uploadAssetFile。 */

const uploadMock = vi.hoisted(() => ({ uploadAssetFile: vi.fn() }));
/* 只替换 uploadAssetFile（图片落卡链路的上传封装），其余导出透传真实实现，
   避免破坏经 CanvasPage 一并加载的其他消费方 */
vi.mock('@/utils/upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/upload')>()),
  uploadAssetFile: uploadMock.uploadAssetFile,
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

beforeEach(() => {
  enableReactActEnvironment();
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

/* 卡片右键菜单「粘贴」「创建副本」入口回归（父单故事 32）：本分支新增的画布内部
   剪贴板与 V 快捷键不得改变菜单入口的原有行为——粘贴项仍走 applyClipboardAtFlow
   （读系统剪贴板、落原卡右下、双空 toast 提示），复制项仍走既有 handleDuplicateNode。
   经文本卡 data 回调驱动（菜单 onSelect → onPaste/onDuplicate 同一入口）。 */
describe('卡片右键菜单入口保持原行为（父单故事 32）', () => {
  function t1Callbacks(): Record<string, any> {
    return textNodes().find((n) => n.id === 't1')!.data as Record<string, any>;
  }

  it('「粘贴」仍走 applyClipboardAtFlow：读系统剪贴板贴原卡右下，不吃内部剪贴板快照', async () => {
    const { read } = stubSystemClipboard({ items: [], text: '菜单粘贴文本' });
    await renderPage();
    // 内部剪贴板先放一份快照：粘贴项若被切到内部剪贴板，会贴出「标题A」且不读系统剪贴板
    await copySelected(['t1']);

    await act(async () => {
      t1Callbacks().onPaste('t1');
    });
    await act(async () => {});

    // 贴出系统剪贴板文本卡，落位在 t1 (0,0) 右下 +40/+40（菜单粘贴原有落位）
    const pasted = textCopies().find((n) => n.data?.text === '菜单粘贴文本')!;
    expect(pasted, '贴出系统剪贴板内容').toBeTruthy();
    expect(pasted.position).toEqual({ x: 40, y: 40 });
    expect(read).toHaveBeenCalled();

    // 内部剪贴板快照未被消费：再按 V 仍贴内部快照（视口中心）
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

    // 副本未进内部剪贴板：V 粘贴双空静默不贴新卡；右键「粘贴」双空保持原有 toast 提示
    await pasteClipboard();
    expect(textCopies()).toHaveLength(1);

    await act(async () => {
      t1Callbacks().onPaste('t1');
    });
    await act(async () => {});
    expect(document.body.textContent).toContain('剪贴板无可粘贴内容');
    expect(textCopies()).toHaveLength(1);
  });
});
