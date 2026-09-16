// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
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

async function renderLibrary(props?: Partial<ComponentProps<typeof CharacterLibrary>>) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  root = createRoot(mountNode);
  await act(async () => {
    root.render(createElement(CharacterLibrary, props));
    await Promise.resolve();
  });
}

/** 取指定素材（按缩略图 alt / video src）所在的卡片节点 */
function assetCardOf(selector: string): HTMLElement {
  const card = mountNode.querySelector(selector)?.closest(`.${styles.assetCard}`);
  if (!(card instanceof HTMLElement)) throw new Error(`card not found: ${selector}`);
  return card;
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
  // 5ec28c5d「虚拟人像库去分组」：不再有分组卡可点，组件渲染后自动选中首个分组
  // 并加载其资产（原「点开分组才加载」的前提已废，用例改为钉新行为）。
  it('loads assets for the auto-selected group without opening a group card', async () => {
    await renderLibrary();

    expect(listAssetGroups).toHaveBeenCalledTimes(1);
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

/* IKGC03 虚拟人像库 picker 模式：资产选择弹窗复用 AigcFlatView 勾选素材，
   与真人分组详情同款三 props（pickerSelectedIds / onPickerToggleAsset / pickerMediaTypes）。
   口径：picker 模式点卡=勾选、隐藏预览与删除、保留上传卡；类型不符卡置灰。 */
describe('CharacterLibrary AIGC picker mode', () => {
  it('picker 模式点卡片触发勾选回调而非打开预览，且不渲染删除按钮', async () => {
    const onPickerToggleAsset = vi.fn();
    await renderLibrary({ onPickerToggleAsset, onUpload: vi.fn() });

    await act(async () => { assetCardOf('img[alt="人像图片"]').click(); });

    expect(onPickerToggleAsset).toHaveBeenCalledTimes(1);
    expect(onPickerToggleAsset).toHaveBeenCalledWith(expect.objectContaining({ Id: 'image-1' }));
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(mountNode.querySelector(`.${styles.assetDeleteBtn}`)).toBeNull();
  });

  it('picker 模式保留上传卡', async () => {
    await renderLibrary({ onPickerToggleAsset: vi.fn(), onUpload: vi.fn() });

    const uploadCard = mountNode.querySelector(`.${styles.uploadAssetCard}`);
    expect(uploadCard).not.toBeNull();
    expect(uploadCard?.textContent).toContain('上传素材');
  });

  it('pickerMediaTypes 仅图片时视频卡置灰不可勾选，图片卡可勾选', async () => {
    const onPickerToggleAsset = vi.fn();
    await renderLibrary({ onPickerToggleAsset, pickerMediaTypes: ['image'] });

    const videoCard = assetCardOf('video[src="https://example.test/video.mp4"]');
    expect(videoCard.classList.contains(styles.assetCardDisabled)).toBe(true);
    await act(async () => { videoCard.click(); });
    expect(onPickerToggleAsset).not.toHaveBeenCalled();

    const imageCard = assetCardOf('img[alt="人像图片"]');
    expect(imageCard.classList.contains(styles.assetCardDisabled)).toBe(false);
    await act(async () => { imageCard.click(); });
    expect(onPickerToggleAsset).toHaveBeenCalledTimes(1);
  });

  it('pickerSelectedIds 命中的卡片渲染选中态角标', async () => {
    await renderLibrary({
      onPickerToggleAsset: vi.fn(),
      pickerSelectedIds: new Set(['image-1']),
    });

    const imageCard = assetCardOf('img[alt="人像图片"]');
    expect(imageCard.classList.contains(styles.assetCardSelected)).toBe(true);
    expect(imageCard.querySelector(`.${styles.checkToggleOn}`)).not.toBeNull();
  });

  it('无 picker props 时点卡片打开预览（非 picker 现状锁定）', async () => {
    await renderLibrary();

    await act(async () => { assetCardOf('img[alt="人像图片"]').click(); });

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(mountNode.querySelector(`.${styles.assetDeleteBtn}`)).not.toBeNull();
  });
});
