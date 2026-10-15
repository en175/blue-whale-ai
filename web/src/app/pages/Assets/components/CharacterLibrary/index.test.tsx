// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CharacterLibrary from './index';
import styles from './index.module.css';

const { listAssetGroups, listAssets, deleteMaterialAsset } = vi.hoisted(() => ({
  listAssetGroups: vi.fn(),
  listAssets: vi.fn(),
  deleteMaterialAsset: vi.fn(),
}));

vi.mock('@/app/api/material', () => ({
  createAssetGroup: vi.fn(),
  createVisualValidateSession: vi.fn(),
  deleteAsset: deleteMaterialAsset,
  deleteAssetGroup: vi.fn(),
  getVisualValidateResult: vi.fn(),
  listAssetGroups,
  listAssets,
}));

vi.mock('@/shared/api/http', () => ({ isApiError: () => false }));

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
      { Id: 'audio-1', Name: '人像音频', URL: 'https://example.test/audio.mp3', GroupId: 'group-1', AssetType: 'Audio', Status: 'Active' },
    ],
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  vi.clearAllMocks();
});

describe('CharacterLibrary', () => {
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

describe('CharacterLibrary AIGC picker mode', () => {
  it('picker 模式点卡片触发勾选回调而非打开预览，且渲染删除与放大预览按钮（IKGHZ3）', async () => {
    const onPickerToggleAsset = vi.fn();
    await renderLibrary({ onPickerToggleAsset, onUpload: vi.fn() });

    const card = assetCardOf('img[alt="人像图片"]');
    expect(card.querySelector('button[title="删除素材"]')).not.toBeNull();
    expect(card.querySelector('button[title="放大预览"]')).not.toBeNull();

    const audioCard = [...mountNode.querySelectorAll(`.${styles.assetCard}`)]
      .find((c) => c.textContent?.includes('人像音频'));
    expect(audioCard?.querySelector('button[title="删除素材"]')).not.toBeNull();
    expect(audioCard?.querySelector('button[title="放大预览"]')).not.toBeNull();

    await act(async () => { card.click(); });

    expect(onPickerToggleAsset).toHaveBeenCalledTimes(1);
    expect(onPickerToggleAsset).toHaveBeenCalledWith(expect.objectContaining({ Id: 'image-1' }));
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

  it('无 picker props 时点卡片打开预览，渲染删除按钮但不渲染放大按钮（非 picker 现状锁定）', async () => {
    await renderLibrary();

    await act(async () => { assetCardOf('img[alt="人像图片"]').click(); });

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    const card = assetCardOf('img[alt="人像图片"]');
    expect(card.querySelector(`.${styles.assetDeleteBtn}`)).not.toBeNull();
    expect(card.querySelector('button[title="放大预览"]')).toBeNull();
  });
});

describe('CharacterLibrary picker 悬浮操作（IKGHZ3）', () => {
  it('picker 模式点删除按钮弹出不可撤销确认弹窗，不触发勾选', async () => {
    const onPickerToggleAsset = vi.fn();
    await renderLibrary({ onPickerToggleAsset });

    await act(async () => {
      assetCardOf('img[alt="人像图片"]').querySelector<HTMLButtonElement>('button[title="删除素材"]')!.click();
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('确定要删除素材「人像图片」吗？此操作不可撤销。');
    expect(onPickerToggleAsset).not.toHaveBeenCalled();
  });

  it('确认删除后素材就地消失并回调 onPickerAssetRemoved', async () => {
    const onPickerAssetRemoved = vi.fn();
    deleteMaterialAsset.mockResolvedValue(undefined);
    await renderLibrary({ onPickerToggleAsset: vi.fn(), onPickerAssetRemoved });

    await act(async () => {
      assetCardOf('img[alt="人像图片"]').querySelector<HTMLButtonElement>('button[title="删除素材"]')!.click();
    });
    const confirmBtn = [...document.body.querySelectorAll('button')]
      .find((b) => b.textContent === '确认删除');
    if (!(confirmBtn instanceof HTMLButtonElement)) throw new Error('confirm button not found');
    await act(async () => { confirmBtn.click(); });

    expect(deleteMaterialAsset).toHaveBeenCalledWith('image-1');
    expect(onPickerAssetRemoved).toHaveBeenCalledWith('image-1');
    expect(mountNode.querySelector('img[alt="人像图片"]')).toBeNull();
    expect(mountNode.querySelector('video[src="https://example.test/video.mp4"]')).not.toBeNull();
  });

  it('picker 模式点放大按钮打开详情弹窗且不触发勾选', async () => {
    const onPickerToggleAsset = vi.fn();
    await renderLibrary({ onPickerToggleAsset });

    await act(async () => {
      assetCardOf('img[alt="人像图片"]').querySelector<HTMLButtonElement>('button[title="放大预览"]')!.click();
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('人像图片');
    expect(onPickerToggleAsset).not.toHaveBeenCalled();
  });

  it('Processing 置灰卡仍渲染删除与放大按钮，状态标并入底部名称条', async () => {
    listAssets.mockResolvedValue({
      Items: [
        { Id: 'image-p', Name: '处理中图片', URL: 'https://example.test/p.jpg', GroupId: 'group-1', AssetType: 'Image', Status: 'Processing' },
      ],
    });
    await renderLibrary({ onPickerToggleAsset: vi.fn() });

    const card = assetCardOf('img[alt="处理中图片"]');
    expect(card.classList.contains(styles.assetCardDisabled)).toBe(true);
    expect(card.querySelector('button[title="删除素材"]')).not.toBeNull();
    expect(card.querySelector('button[title="放大预览"]')).not.toBeNull();
    expect(card.querySelector(`.${styles.statusBadge}`)).toBeNull();
    expect(card.querySelector(`.${styles.assetNameOverlay}`)?.textContent).toContain('处理中');
  });

  it('预览弹窗开关通过 onPickerPreviewChange 上抛', async () => {
    const onPickerPreviewChange = vi.fn();
    await renderLibrary({ onPickerToggleAsset: vi.fn(), onPickerPreviewChange });

    await act(async () => {
      assetCardOf('img[alt="人像图片"]').querySelector<HTMLButtonElement>('button[title="放大预览"]')!.click();
    });
    expect(onPickerPreviewChange).toHaveBeenLastCalledWith(true);

    const closeBtn = document.body.querySelector('button[aria-label="关闭"]');
    if (!(closeBtn instanceof HTMLButtonElement)) throw new Error('close button not found');
    await act(async () => { closeBtn.click(); });
    expect(onPickerPreviewChange).toHaveBeenLastCalledWith(false);
  });

  it('真人库分组详情 picker 模式同样渲染两枚按钮，删除成功回调联动', async () => {
    listAssetGroups.mockResolvedValue({
      Items: [{ Id: 'lg-1', Name: '真人A', GroupType: 'LivenessFace' }],
    });
    listAssets.mockResolvedValue({
      Items: [
        { Id: 'live-1', Name: '真人图片', URL: 'https://example.test/live.jpg', GroupId: 'lg-1', AssetType: 'Image', Status: 'Active' },
      ],
    });
    const onPickerAssetRemoved = vi.fn();
    deleteMaterialAsset.mockResolvedValue(undefined);
    await renderLibrary({
      groupType: 'LivenessFace',
      onPickerToggleAsset: vi.fn(),
      onPickerAssetRemoved,
    });

    await act(async () => { mountNode.querySelector<HTMLElement>(`.${styles.groupCard}`)!.click(); });

    const card = assetCardOf('img[alt="真人图片"]');
    expect(card.querySelector('button[title="删除素材"]')).not.toBeNull();
    expect(card.querySelector('button[title="放大预览"]')).not.toBeNull();

    await act(async () => { card.querySelector<HTMLButtonElement>('button[title="删除素材"]')!.click(); });
    const confirmBtn = [...document.body.querySelectorAll('button')]
      .find((b) => b.textContent === '确认删除');
    if (!(confirmBtn instanceof HTMLButtonElement)) throw new Error('confirm button not found');
    await act(async () => { confirmBtn.click(); });

    expect(onPickerAssetRemoved).toHaveBeenCalledWith('live-1');
    expect(mountNode.querySelector('img[alt="真人图片"]')).toBeNull();
  });
});

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
      expect(listAssets).toHaveBeenCalledTimes(4);
      expect(mountNode.querySelector('img[alt="第二页图片"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

function expectImgWithoutCrossOrigin(img: Element | null | undefined): asserts img is HTMLImageElement {
  if (!(img instanceof HTMLImageElement)) throw new Error('preview img missing');
  expect(img.getAttribute('crossorigin')).toBeNull();
}

describe('人像库图片预览不加 crossOrigin', () => {
  it('虚拟人像库缩略图与详情大图都不带 crossorigin', async () => {
    await renderLibrary();

    expectImgWithoutCrossOrigin(mountNode.querySelector('img[alt="人像图片"]'));

    await act(async () => { assetCardOf('img[alt="人像图片"]').click(); });

    const dialog = document.body.querySelector('[role="dialog"]');
    expectImgWithoutCrossOrigin(dialog?.querySelector('img'));
  });

  it('真人人像库分组内缩略图与详情大图都不带 crossorigin', async () => {
    listAssetGroups.mockResolvedValue({
      Items: [{ Id: 'lg-1', Name: '真人A', GroupType: 'LivenessFace' }],
    });
    listAssets.mockResolvedValue({
      Items: [
        { Id: 'live-1', Name: '真人图片', URL: 'https://example.test/live.jpg', GroupId: 'lg-1', AssetType: 'Image', Status: 'Active' },
      ],
    });
    await renderLibrary({ groupType: 'LivenessFace' });

    await act(async () => { mountNode.querySelector<HTMLElement>(`.${styles.groupCard}`)!.click(); });

    expectImgWithoutCrossOrigin(mountNode.querySelector('img[alt="真人图片"]'));

    await act(async () => { assetCardOf('img[alt="真人图片"]').click(); });

    const dialog = document.body.querySelector('[role="dialog"]');
    expectImgWithoutCrossOrigin(dialog?.querySelector('img'));
  });
});
