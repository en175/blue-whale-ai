// @vitest-environment jsdom
/* IKGC03 视频面板「从资产中选择」弹窗补虚拟人像库 tab：
   tab 顺序与资产页一致（…音频/虚拟人像库/真人人像库）、showCharacterTab 仅视频面板入口开启、
   虚拟 tab 复用 CharacterLibrary AigcFlatView 勾选（点卡=勾选、跨 tab 保留、确认后以
   character 来源与真人素材同身份提交）、仅图片入口视频素材置灰、上传卡保留。 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import AssetsPickerModal, { type AssetsPickerModalProps } from './index';
import pickerStyles from './index.module.css';
import libStyles from '@/pages/Assets/components/CharacterLibrary/index.module.css';

const { listAssetGroups, listAssets } = vi.hoisted(() => ({
  listAssetGroups: vi.fn(),
  listAssets: vi.fn(),
}));

vi.mock('@/api/assets', () => ({
  assetPageQueryOptions: vi.fn((type: string, size: number) => ({
    queryKey: ['asset-pages', type, size],
    initialPageParam: 1,
    queryFn: () => Promise.resolve({ records: [], total: 0, current: 1 }),
    getNextPageParam: () => undefined,
  })),
}));

vi.mock('@/api/material', () => ({
  createAsset: vi.fn(),
  createAssetGroup: vi.fn(),
  createVisualValidateSession: vi.fn(),
  deleteAsset: vi.fn(),
  deleteAssetGroup: vi.fn(),
  getVisualValidateResult: vi.fn(),
  listAssetGroups,
  listAssets,
}));

vi.mock('@/api/http', () => ({ isApiError: () => false }));
vi.mock('@/utils/upload', () => ({ uploadAssetFile: vi.fn() }));
vi.mock('@/utils/fileSignature', () => ({ isFileRejected: () => false }));

let root: Root;
let mountNode: HTMLDivElement;
let queryClient: QueryClient;

async function renderPicker(props: Partial<AssetsPickerModalProps> = {}) {
  mountNode = document.createElement('div');
  document.body.appendChild(mountNode);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(mountNode);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(AssetsPickerModal, { onClose: vi.fn(), onSelect: vi.fn(), ...props }),
      ),
    );
    await Promise.resolve();
  });
}

/* 弹窗整体 createPortal 到 document.body：所有查询以 body 为基准（mountNode 仅作挂载点） */
function tabLabels(): string[] {
  return [...document.body.querySelectorAll(`.${pickerStyles.tabs} button`)].map((b) => b.textContent);
}

async function clickTab(label: string) {
  const btn = [...document.body.querySelectorAll(`.${pickerStyles.tabs} button`)]
    .find((b) => b.textContent === label);
  if (!(btn instanceof HTMLButtonElement)) throw new Error(`tab not found: ${label}`);
  await act(async () => { btn.click(); });
}

function assetCardOf(selector: string): HTMLElement {
  const card = document.body.querySelector(selector)?.closest(`.${libStyles.assetCard}`);
  if (!(card instanceof HTMLElement)) throw new Error(`card not found: ${selector}`);
  return card;
}

function hintText(): string {
  return document.body.querySelector(`.${pickerStyles.selectHint}`)?.textContent ?? '';
}

beforeAll(() => {
  // jsdom 未实现 Element.scrollTo：弹窗切 tab 回顶 effect 需要它
  Element.prototype.scrollTo = () => {};
});

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  listAssetGroups.mockResolvedValue({
    Items: [{ Id: 'group-a1', Name: '虚拟人像', GroupType: 'AIGC' }],
  });
  listAssets.mockResolvedValue({
    Items: [
      { Id: 'Asset-image-1', Name: '人像图片', URL: 'https://example.test/image.jpg', GroupId: 'group-a1', AssetType: 'Image', Status: 'Active' },
      { Id: 'Asset-video-1', Name: '人像视频', URL: 'https://example.test/video.mp4', GroupId: 'group-a1', AssetType: 'Video', Status: 'Active' },
    ],
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mountNode?.remove();
  queryClient?.clear();
  vi.clearAllMocks();
});

describe('AssetsPickerModal 虚拟人像库 tab', () => {
  it('showCharacterTab 时虚拟人像库 tab 位于真人人像库之前（顺序与资产页一致）', async () => {
    await renderPicker({ showCharacterTab: true, showLivenessTab: true });

    expect(tabLabels()).toEqual(['全部', '图片', '视频', '音频', '虚拟人像库', '真人人像库']);
  });

  it('未开 showCharacterTab 时不出现虚拟人像库 tab（画布工具栏入口口径）', async () => {
    await renderPicker({ showLivenessTab: true });

    expect(tabLabels()).toEqual(['全部', '图片', '视频', '音频', '真人人像库']);
  });

  it('虚拟 tab 平铺 AIGC 素材且上传卡居首', async () => {
    await renderPicker({ showCharacterTab: true });
    await clickTab('虚拟人像库');

    expect(listAssetGroups).toHaveBeenCalledWith(expect.objectContaining({
      Filter: { GroupType: 'AIGC' },
    }));
    expect(document.body.querySelector('img[alt="人像图片"]')).not.toBeNull();
    const uploadCard = document.body.querySelector(`.${libStyles.uploadAssetCard}`);
    expect(uploadCard).not.toBeNull();
    expect(uploadCard?.parentElement?.firstElementChild).toBe(uploadCard);
  });

  it('点虚拟素材卡勾选，确认后以 character 来源提交', async () => {
    const onSelect = vi.fn();
    await renderPicker({ showCharacterTab: true, onSelect });
    await clickTab('虚拟人像库');

    await act(async () => { assetCardOf('img[alt="人像图片"]').click(); });
    expect(hintText()).toContain('已选 1 项');

    const confirmBtn = document.body.querySelector(`.${pickerStyles.confirmBtn}`);
    if (!(confirmBtn instanceof HTMLButtonElement)) throw new Error('confirm button not found');
    await act(async () => { confirmBtn.click(); });

    expect(onSelect).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'Asset-image-1', type: 'image', source: 'character' }),
    ]);
  });

  it('仅图片入口下虚拟 tab 视频素材置灰不可勾选', async () => {
    await renderPicker({ showCharacterTab: true, mediaTypes: ['image'] });
    await clickTab('虚拟人像库');

    const videoCard = assetCardOf('video[src="https://example.test/video.mp4"]');
    expect(videoCard.classList.contains(libStyles.assetCardDisabled)).toBe(true);
    await act(async () => { videoCard.click(); });
    expect(hintText()).not.toContain('已选');
  });

  it('虚拟 tab 勾选后切走 tab 勾选保留', async () => {
    await renderPicker({ showCharacterTab: true });
    await clickTab('虚拟人像库');
    await act(async () => { assetCardOf('img[alt="人像图片"]').click(); });

    await clickTab('图片');

    expect(hintText()).toContain('已选 1 项');
  });
});
