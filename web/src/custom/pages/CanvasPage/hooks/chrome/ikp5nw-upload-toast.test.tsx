// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileRejectedError, checkFileBeforeUpload } from '@/custom/utils/fileSignature';
import {
  useCanvasUploadDrop,
  type CanvasUploadDropHandles,
  type CanvasUploadDropHost,
} from './useCanvasUploadDrop';

const uploadMock = vi.hoisted(() => ({ uploadAssetFile: vi.fn() }));
const clipboardMock = vi.hoisted(() => ({ readCanvasClipboard: vi.fn() }));

vi.mock('@/custom/utils/upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/custom/utils/upload')>()),
  uploadAssetFile: uploadMock.uploadAssetFile,
}));

vi.mock('./clipboardPaste', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./clipboardPaste')>()),
  readCanvasClipboard: clipboardMock.readCanvasClipboard,
}));

const EMPTY_NAME = '空.png';
const EMPTY_MESSAGE = `${EMPTY_NAME} 是一个空文件，请重新选择。`;
const PNGS = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' });

function emptyPng() {
  return new File([], EMPTY_NAME, { type: 'image/png' });
}

function setup() {
  const showToast = vi.fn();
  const setMediaNodes = vi.fn();
  const host = {
    currentId: 'p1',
    toolMode: 'select',
    spawnPosition: () => ({ x: 0, y: 0 }),
    handleMediaDims: vi.fn(),
    dockToolCallbacks: {},
    actionsRef: { current: {} },
    setMediaNodes,
    pendingNodeIdsRef: { current: new Set<string>() },
    historyRef: { current: { pushAddNodes: vi.fn() } },
    upsertAssets: vi.fn(),
    mediaNodesRef: { current: [] },
    handleAddTextNode: vi.fn(() => 'text-1'),
    showToast,
  } as unknown as CanvasUploadDropHost;

  let handles: CanvasUploadDropHandles | null = null;
  function Probe() {
    handles = useCanvasUploadDrop(host);
    return null;
  }
  const container = document.createElement('div');
  const root: Root = createRoot(container);
  act(() => {
    root.render(createElement(Probe));
  });
  return {
    handles: handles as unknown as CanvasUploadDropHandles,
    showToast,
    setMediaNodes,
    root,
  };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} });
  uploadMock.uploadAssetFile.mockReset();
  uploadMock.uploadAssetFile.mockImplementation(async (file: File) => {
    if (file.size === 0) {
      throw new FileRejectedError((await checkFileBeforeUpload(file, 'image')) ?? '');
    }
    throw new Error('network down');
  });
  clipboardMock.readCanvasClipboard.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('IKP5NW 上传失败只提示一次', () => {
  it('工具栏「本地上传」选空文件：只弹一条空文件提示', async () => {
    const kit = setup();

    await act(async () => {
      kit.handles.handleUploadFile([emptyPng()]);
    });

    expect(kit.showToast.mock.calls).toEqual([['error', EMPTY_MESSAGE]]);
    act(() => kit.root.unmount());
  });

  it('工具栏「本地上传」网络失败：只弹一条重试提示', async () => {
    const kit = setup();

    await act(async () => {
      kit.handles.handleUploadFile([PNGS()]);
    });

    expect(kit.showToast.mock.calls).toEqual([['error', '「a.png」添加失败，请重试']]);
    act(() => kit.root.unmount());
  });

  it('画布空白处上传空文件：只弹一条空文件提示', async () => {
    const kit = setup();

    await act(async () => {
      await kit.handles.placeFileOnCanvas(emptyPng()).catch(() => undefined);
    });

    expect(kit.showToast.mock.calls).toEqual([['error', EMPTY_MESSAGE]]);
    act(() => kit.root.unmount());
  });

  it('空壳卡替换上传空文件：只弹一条提示，节点回退为空壳', async () => {
    const kit = setup();

    await act(async () => {
      kit.handles.handleFillEmptyShell('media-1', emptyPng());
    });

    expect(kit.showToast.mock.calls).toEqual([['error', EMPTY_MESSAGE]]);
    expect(kit.setMediaNodes).toHaveBeenCalled();
    act(() => kit.root.unmount());
  });

  it('画布上粘贴空文件图片：只弹一条空文件提示', async () => {
    clipboardMock.readCanvasClipboard.mockResolvedValue({ kind: 'image', file: emptyPng() });
    const kit = setup();

    await act(async () => {
      await kit.handles.applyClipboardAtFlow({ x: 0, y: 0 });
    });

    expect(kit.showToast.mock.calls).toEqual([['error', EMPTY_MESSAGE]]);
    act(() => kit.root.unmount());
  });

  it('上传成功：不弹错误提示', async () => {
    uploadMock.uploadAssetFile.mockResolvedValue({
      asset_id: 'a-1',
      url: 'http://img/a.png',
      mime: 'image/png',
      width: 4,
      height: 4,
      size: 4,
    });
    const kit = setup();

    await act(async () => {
      kit.handles.handleUploadFile([PNGS()]);
    });

    expect(kit.showToast).not.toHaveBeenCalled();
    act(() => kit.root.unmount());
  });
});
