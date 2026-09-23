// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Assets from './index';

const uploadMocks = vi.hoisted(() => ({
  fetchUploadPresign: vi.fn(async () => ({ storage_key: 'uploads/voice.mp3' })),
  putToPresignedUrl: vi.fn(async () => undefined),
  completeUpload: vi.fn(async () => ({ asset_id: 'a1' })),
}));

vi.mock('@/api/assets', () => ({
  assetKeys: { all: ['assets'] },
  assetPageQueryOptions: () => ({
    queryKey: ['assets', 'all'],
    queryFn: async () => ({ records: [], total: 0 }),
    initialPageParam: 1,
    getNextPageParam: () => undefined,
  }),
  removeCachedAssetPages: vi.fn(),
  UPLOAD_SIZE_LIMIT: { image: 100_000_000, video: 100_000_000, audio: 100_000_000 },
  fetchUploadPresign: uploadMocks.fetchUploadPresign,
  putToPresignedUrl: uploadMocks.putToPresignedUrl,
  completeUpload: uploadMocks.completeUpload,
}));
vi.mock('@/utils/upload', () => ({
  fileToAssetType: () => 'audio',
  probeMediaMeta: async () => ({ duration: 1 }),
}));
vi.mock('./components/AssetMasonry', () => ({ default: () => null }));
vi.mock('./components/AssetDetailModal', () => ({ default: () => null }));
vi.mock('./components/CharacterLibrary', () => ({ default: () => null }));
vi.mock('./previewAsset', () => ({ usePreviewAsset: () => null }));
vi.mock('@/components/ConfirmModal', () => ({ default: () => null }));

let root: Root;
let mountNode: HTMLDivElement;

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  uploadMocks.completeUpload.mockClear();
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><Assets /></MemoryRouter>
      </QueryClientProvider>,
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  mountNode.remove();
});

it('资产库音频上传把文件名交给完成接口', async () => {
  const input = mountNode.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['audio'], '人声.mp3', { type: 'audio/mpeg' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });

  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  expect(uploadMocks.completeUpload).toHaveBeenCalledWith(expect.objectContaining({
    type: 'audio',
    name: '人声.mp3',
  }));
});
