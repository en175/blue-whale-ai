// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CharacterLibrary from './index';
import styles from './index.module.css';

const { listAssetGroups, listAssets } = vi.hoisted(() => ({
  listAssetGroups: vi.fn(),
  listAssets: vi.fn(),
}));

vi.mock('@/api/material', () => ({
  createAssetGroup: vi.fn(),
  createVisualValidateSession: vi.fn(),
  deleteAsset: vi.fn(),
  deleteAssetGroup: vi.fn(),
  getVisualValidateResult: vi.fn(),
  listAssetGroups,
  listAssets,
}));

vi.mock('@/api/http', () => ({ isApiError: () => false }));

let root: Root;
let mountNode: HTMLDivElement;

async function renderLibrary(props?: { groupType?: 'AIGC' | 'LivenessFace' }) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(CharacterLibrary, props));
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

describe('CharacterLibrary', () => {
  it('loads assets only after opening a group', async () => {
    await renderLibrary();

    expect(listAssetGroups).toHaveBeenCalledTimes(1);
    expect(listAssets).not.toHaveBeenCalled();

    const groupCard = [...mountNode.querySelectorAll('span')]
      .find((element) => element.textContent === '虚拟人像')
      ?.closest(`.${styles.groupCard}`) as HTMLDivElement | null;
    expect(groupCard).not.toBeNull();

    await act(async () => {
      groupCard?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(listAssets).toHaveBeenCalledWith({
      Filter: { GroupIds: ['group-1'], GroupType: 'AIGC' },
      PageNumber: 1,
      PageSize: 100,
    });
    expect(mountNode.querySelector('img[alt="人像图片"]')).not.toBeNull();
    expect(mountNode.querySelector('video[src="https://example.test/video.mp4"]')).not.toBeNull();
    expect(mountNode.textContent).toContain('图片');
    expect(mountNode.textContent).toContain('视频');
  });

  it('renders LivenessFace groups with 新建真人 entry and empty-state guidance', async () => {
    listAssetGroups.mockResolvedValue({ Items: [] });
    await renderLibrary({ groupType: 'LivenessFace' });

    expect(listAssetGroups).toHaveBeenCalledWith({
      Filter: { GroupType: 'LivenessFace' },
      PageNumber: 1,
      PageSize: 100,
    });
    expect(mountNode.textContent).toContain('新建真人');
    expect(mountNode.textContent).toContain('点击「新建真人」发起真人认证');
    expect(mountNode.textContent).not.toContain('新建分组');
  });
});
