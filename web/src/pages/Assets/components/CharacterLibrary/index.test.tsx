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

/* IKGC0K 平铺视图分页拉全：AigcFlatView.loadAssets 原两处 PageSize 100 硬编码
   超出即静默截断（分组丢组、素材丢新条目）。修法：分组与素材均按返回
   TotalCount 分页拉全；素材聚合时 GroupIds 分批防止 Filter 数组过长。 */
describe('AigcFlatView 分页拉全（IKGC0K）', () => {
  function pageOf<T>(items: T[], totalCount: number): { TotalCount: number; Items: T[] } {
    return { TotalCount: totalCount, Items: items };
  }

  it('素材 TotalCount > PageSize 时按页拉全，第 2 页素材完整渲染', async () => {
    listAssetGroups.mockResolvedValue(
      pageOf([{ Id: 'group-1', Name: '虚拟人像', GroupType: 'AIGC' }], 1),
    );
    listAssets.mockImplementation(({ PageNumber }: { PageNumber: number }) =>
      PageNumber === 1
        ? pageOf([
            { Id: 'image-1', Name: '人像图片', URL: 'https://example.test/image.jpg', GroupId: 'group-1', AssetType: 'Image', Status: 'Active' },
            { Id: 'video-1', Name: '人像视频', URL: 'https://example.test/video.mp4', GroupId: 'group-1', AssetType: 'Video', Status: 'Active' },
          ], 150)
        : pageOf([
            { Id: 'image-101', Name: '第二页图片', URL: 'https://example.test/page2.jpg', GroupId: 'group-1', AssetType: 'Image', Status: 'Active' },
          ], 150),
    );

    await renderLibrary();

    expect(listAssets).toHaveBeenCalledTimes(2);
    expect(listAssets).toHaveBeenNthCalledWith(2, {
      Filter: { GroupIds: ['group-1'], GroupType: 'AIGC' },
      PageNumber: 2,
      PageSize: 100,
    });
    expect(mountNode.querySelector('img[alt="第二页图片"]')).not.toBeNull();
  });

  it('分组 TotalCount > PageSize 时拉全第 2 页分组，素材聚合不丢组', async () => {
    listAssetGroups.mockImplementation(({ PageNumber }: { PageNumber: number }) =>
      PageNumber === 1
        ? pageOf([{ Id: 'group-1', Name: '第一页组', GroupType: 'AIGC' }], 150)
        : pageOf([{ Id: 'group-101', Name: '第二页组', GroupType: 'AIGC' }], 150),
    );
    listAssets.mockImplementation(({ Filter }: { Filter: { GroupIds: string[] } }) =>
      pageOf(
        [
          { Id: 'image-1', Name: '第一页组图片', URL: 'https://example.test/a1.jpg', GroupId: 'group-1', AssetType: 'Image', Status: 'Active' },
          { Id: 'image-101', Name: '第二页组图片', URL: 'https://example.test/a101.jpg', GroupId: 'group-101', AssetType: 'Image', Status: 'Active' },
        ].filter((a) => Filter.GroupIds.includes(a.GroupId)),
        2,
      ),
    );

    await renderLibrary();

    expect(listAssetGroups).toHaveBeenCalledTimes(2);
    expect(listAssetGroups).toHaveBeenNthCalledWith(2, {
      Filter: { GroupType: 'AIGC' },
      PageNumber: 2,
      PageSize: 100,
    });
    // 第 2 页拉到的组参与素材聚合（不丢组）
    expect(listAssets).toHaveBeenCalledWith({
      Filter: { GroupIds: ['group-1', 'group-101'], GroupType: 'AIGC' },
      PageNumber: 1,
      PageSize: 100,
    });
    expect(mountNode.querySelector('img[alt="第二页组图片"]')).not.toBeNull();
  });

  it('分组超过单批上限时 GroupIds 分批拉取素材', async () => {
    const groupIds = Array.from({ length: 101 }, (_, i) => `group-${i + 1}`);
    listAssetGroups.mockImplementation(({ PageNumber }: { PageNumber: number }) =>
      pageOf(
        (PageNumber === 1 ? groupIds.slice(0, 100) : groupIds.slice(100))
          .map((Id) => ({ Id, Name: Id, GroupType: 'AIGC' as const })),
        101,
      ),
    );
    listAssets.mockResolvedValue(pageOf([], 0));

    await renderLibrary();

    expect(listAssets).toHaveBeenCalledTimes(3);
    const calls = listAssets.mock.calls.map(([p]) => p as { Filter: { GroupIds: string[] } });
    expect(calls[0].Filter.GroupIds).toHaveLength(50);
    expect(calls[1].Filter.GroupIds).toHaveLength(50);
    expect(calls[2].Filter.GroupIds).toEqual(['group-101']);
  });

  it('Processing 素材存在时 5s 轮询继续按页拉全（行为不变锁定）', async () => {
    vi.useFakeTimers();
    try {
      listAssetGroups.mockResolvedValue(
        pageOf([{ Id: 'group-1', Name: '虚拟人像', GroupType: 'AIGC' }], 1),
      );
      const pages: Record<number, ReturnType<typeof pageOf>> = {
        1: pageOf([
          { Id: 'image-1', Name: '处理中图片', URL: 'https://example.test/p1.jpg', GroupId: 'group-1', AssetType: 'Image', Status: 'Processing' },
          { Id: 'image-2', Name: '第一页图片', URL: 'https://example.test/p2.jpg', GroupId: 'group-1', AssetType: 'Image', Status: 'Active' },
        ], 150),
        2: pageOf([
          { Id: 'image-101', Name: '第二页图片', URL: 'https://example.test/p3.jpg', GroupId: 'group-1', AssetType: 'Image', Status: 'Active' },
        ], 150),
      };
      listAssets.mockImplementation(({ PageNumber }: { PageNumber: number }) => pages[PageNumber]);

      await renderLibrary();
      expect(listAssets).toHaveBeenCalledTimes(2);

      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      // 5s 后轮询触发新一轮完整拉取（两页都拉）
      expect(listAssets).toHaveBeenCalledTimes(4);
      expect(mountNode.querySelector('img[alt="第二页图片"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
