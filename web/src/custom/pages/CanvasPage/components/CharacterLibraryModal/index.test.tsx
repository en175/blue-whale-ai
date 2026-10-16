// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CharacterLibraryModal from './index';
import styles from './index.module.css';

const { listAssetGroups, listAssets, uploadMaterialLibraryFiles } = vi.hoisted(() => ({
  listAssetGroups: vi.fn(),
  listAssets: vi.fn(),
  uploadMaterialLibraryFiles: vi.fn(),
}));

vi.mock('@/custom/api/material', () => ({
  createAsset: vi.fn(),
  createAssetGroup: vi.fn(),
  deleteAssetGroup: vi.fn(),
  listAssetGroups,
  listAssets,
  updateAssetGroup: vi.fn(),
}));

vi.mock('../../assets/characterLibraryUpload', () => ({ uploadMaterialLibraryFiles }));

vi.mock('@/shared/api/http', () => ({ isApiError: () => false }));

let root: Root;
let mountNode: HTMLDivElement;

async function renderLibrary(props?: Partial<ComponentProps<typeof CharacterLibraryModal>>) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(CharacterLibraryModal, { onClose: vi.fn(), ...props }));
    await Promise.resolve();
  });
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function expectImgWithoutCrossOrigin(img: Element | null): asserts img is HTMLImageElement {
  if (!(img instanceof HTMLImageElement)) throw new Error('preview img missing');
  expect(img.getAttribute('crossorigin')).toBeNull();
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  listAssetGroups.mockResolvedValue({
    Items: [{ Id: 'group-1', Name: '虚拟人像', GroupType: 'AIGC' }],
  });
  listAssets.mockResolvedValue({
    Items: [
      { Id: 'image-1', Name: '人像图片', URL: 'https://example.test/image.jpg', GroupId: 'group-1', AssetType: 'Image', Status: 'Active' },
      { Id: 'video-1', Name: '人像视频', URL: 'https://example.test/video.mp4', GroupId: 'group-1', AssetType: 'Video', Status: 'Active' },
    ],
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  vi.clearAllMocks();
});

describe('CharacterLibraryModal', () => {
  it('loads virtual portrait assets as a flat list without groups', async () => {
    await renderLibrary();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listAssetGroups).toHaveBeenCalledWith({
      Filter: { GroupType: 'AIGC' },
      PageNumber: 1,
      PageSize: 100,
    });
    expect(listAssets).toHaveBeenCalledWith({
      Filter: { GroupIds: ['group-1'], GroupType: 'AIGC' },
      PageNumber: 1,
      PageSize: 100,
    });
    expect(document.body.querySelector(`.${styles.groupCard}`)).toBeNull();
    expect(document.body.textContent).not.toContain('点击查看素材');
    expect(document.body.querySelector('img[alt="人像图片"]')).not.toBeNull();
    expect(document.body.querySelector('video[src="https://example.test/video.mp4"]')).not.toBeNull();
    expect(document.body.textContent).toContain('图片');
    expect(document.body.textContent).toContain('视频');
    expect(document.body.querySelector('[aria-label="上传素材"]')).not.toBeNull();
  });

  it('弹窗内本地上传失败时 toast 提示请重试', async () => {
    const { toast } = await import('sonner');
    const toastError = vi.spyOn(toast, 'error').mockImplementation(() => 0 as never);
    uploadMaterialLibraryFiles.mockResolvedValue({
      errors: ['素材服务异常，请重试'],
      createdIds: [],
    });
    await renderLibrary();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const input = document.body.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('file input missing');
    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
    await act(async () => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(uploadMaterialLibraryFiles).toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('素材服务异常，请重试');
    toastError.mockRestore();
  });

  it('虚拟人像库缩略图不带 crossorigin', async () => {
    await renderLibrary();
    await flushEffects();

    expectImgWithoutCrossOrigin(document.body.querySelector('img[alt="人像图片"]'));
  });

  it('真人人像库分组内缩略图不带 crossorigin', async () => {
    listAssetGroups.mockImplementation(({ Filter }: { Filter: { GroupType: string } }) =>
      Promise.resolve({
        Items: Filter.GroupType === 'LivenessFace'
          ? [{ Id: 'lg-1', Name: '真人A', GroupType: 'LivenessFace' }]
          : [{ Id: 'group-1', Name: '虚拟人像', GroupType: 'AIGC' }],
      }),
    );
    listAssets.mockImplementation(({ Filter }: { Filter: { GroupType: string } }) =>
      Promise.resolve({
        Items: Filter.GroupType === 'LivenessFace'
          ? [{ Id: 'live-1', Name: '真人图片', URL: 'https://example.test/live.jpg', GroupId: 'lg-1', AssetType: 'Image', Status: 'Active' }]
          : [{ Id: 'image-1', Name: '人像图片', URL: 'https://example.test/image.jpg', GroupId: 'group-1', AssetType: 'Image', Status: 'Active' }],
      }),
    );

    await renderLibrary({ enableRealPersonTab: true });
    await flushEffects();

    const realTab = [...document.body.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('真人人像库'));
    if (!(realTab instanceof HTMLButtonElement)) throw new Error('real tab missing');
    await act(async () => { realTab.click(); });
    await flushEffects();

    const groupCard = document.body.querySelector<HTMLElement>(`.${styles.groupCard}`);
    if (!groupCard) throw new Error('group card missing');
    await act(async () => { groupCard.click(); });
    await flushEffects();

    expectImgWithoutCrossOrigin(document.body.querySelector('img[alt="真人图片"]'));
  });
});
