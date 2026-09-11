// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CharacterLibraryModal from './index';
import styles from './index.module.css';

const { listAssetGroups, listAssets } = vi.hoisted(() => ({
  listAssetGroups: vi.fn(),
  listAssets: vi.fn(),
}));

vi.mock('@/api/material', () => ({
  createAsset: vi.fn(),
  createAssetGroup: vi.fn(),
  deleteAssetGroup: vi.fn(),
  listAssetGroups,
  listAssets,
  updateAssetGroup: vi.fn(),
}));

vi.mock('@/api/http', () => ({ isApiError: () => false }));

let root: Root;
let mountNode: HTMLDivElement;

async function renderLibrary() {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(CharacterLibraryModal, { onClose: vi.fn() }));
    await Promise.resolve();
  });
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
  });
});
