// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { RefObject } from 'react';
import type { Node } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uploadMocks = vi.hoisted(() => ({ uploadAssetFile: vi.fn(), probeMediaMeta: vi.fn(async () => ({})) }));

vi.mock('@/custom/utils/upload', async (importActual) => ({
  ...(await importActual<typeof import('@/custom/utils/upload')>()),
  uploadAssetFile: uploadMocks.uploadAssetFile,
  probeMediaMeta: uploadMocks.probeMediaMeta,
}));

import {
  useCanvasUploadDrop,
  type CanvasUploadDropHandles,
  type CanvasUploadDropHost,
} from './useCanvasUploadDrop';

function ref<T>(current: T): RefObject<T> {
  return { current } as RefObject<T>;
}

function fileOf(name: string, mime: string, size: number): File {
  const file = new File([new Uint8Array([1])], name, { type: mime });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

let latest: CanvasUploadDropHandles;
let showToast: ReturnType<typeof vi.fn>;

function host(over: Partial<CanvasUploadDropHost> = {}): CanvasUploadDropHost {
  return {
    currentId: 'p1',
    toolMode: 'select',
    spawnPosition: () => ({ x: 0, y: 0 }),
    spawnBatch: (items) => items.map((_, index) => ({ x: index * 328, y: 0 })),
    handleMediaDims: () => {},
    dockToolCallbacks: {},
    actionsRef: ref({}) as unknown as CanvasUploadDropHost['actionsRef'],
    setMediaNodes: () => {},
    pendingNodeIdsRef: ref(new Set<string>()),
    historyRef: ref({ pushAddNodes: () => {} }),
    upsertAssets: () => {},
    mediaNodesRef: ref<Node[]>([]),
    handleAddTextNode: () => 'text-1',
    showToast: showToast as unknown as CanvasUploadDropHost['showToast'],
    ...over,
  };
}

function Probe({ input }: { input: CanvasUploadDropHost }) {
  latest = useCanvasUploadDrop(input);
  return null;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  showToast = vi.fn();
  uploadMocks.uploadAssetFile.mockReset();
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => 'blob:stub',
    revokeObjectURL: () => {},
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(input: CanvasUploadDropHost) {
  await act(async () => {
    root.render(createElement(Probe, { input }));
  });
}

async function run(fn: () => void) {
  await act(async () => {
    fn();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('placeFileOnCanvas 体积超限提示', () => {
  it.each([
    ['oversize-image-21MB.jpg', 'image/jpeg', 21 * 1024 * 1024, '「oversize-image-21MB.jpg」超过20MB上限，请压缩或更换文件后上传。'],
    ['oversize-video-201MB.mp4', 'video/mp4', 201 * 1024 * 1024, '「oversize-video-201MB.mp4」超过200MB上限，请压缩或更换文件后上传。'],
    ['oversize-audio-26MB.mp3', 'audio/mpeg', 26 * 1024 * 1024, '「oversize-audio-26MB.mp3」超过25MB上限，请压缩或更换文件后上传。'],
  ])('%s 经本地上传提示具体上限', async (name, mime, size, message) => {
    await render(host());
    await run(() => latest.handleUploadFile([fileOf(name, mime, size)]));

    expect(showToast.mock.calls).toEqual([['error', message]]);
    expect(uploadMocks.uploadAssetFile).not.toHaveBeenCalled();
  });

  it('空白处上传与空壳卡替换拿到同一个超限文案', async () => {
    await render(host());
    const file = fileOf('oversize.png', 'image/png', 21 * 1024 * 1024);
    const message = '「oversize.png」超过20MB上限，请压缩或更换文件后上传。';

    await run(() => latest.handleFillEmptyShell('m1', file));
    expect(showToast.mock.calls).toEqual([['error', message]]);

    showToast.mockClear();
    await run(() => {
      void latest.placeFileOnCanvas(file, {
        position: { x: 0, y: 0 },
      }).catch(() => undefined);
    });
    expect(showToast.mock.calls).toEqual([['error', message]]);
  });

  it('非体积类上传失败仍显示通用提示', async () => {
    uploadMocks.uploadAssetFile.mockRejectedValue(new Error('network'));
    await render(host());

    await run(() => latest.handleUploadFile([fileOf('ok.png', 'image/png', 1024)]));

    expect(showToast.mock.calls).toEqual([['error', '「ok.png」添加失败，请重试']]);
  });

  it('不支持的格式沿用通用提示', async () => {
    await render(host());

    await run(() => latest.handleUploadFile([fileOf('notes.pdf', 'application/pdf', 1024)]));

    expect(showToast.mock.calls).toEqual([['error', '「notes.pdf」添加失败，请重试']]);
  });
});
