// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import AssetsPickerModal, { type AssetsPickerModalProps } from './index';
import pickerStyles from './index.module.css';
import libStyles from '@/app/pages/Assets/components/CharacterLibrary/index.module.css';

const { listAssetGroups, listAssets, assetPageFetch, deleteAssetApi, fetchAssetReferencesApi } = vi.hoisted(() => ({
  listAssetGroups: vi.fn(),
  listAssets: vi.fn(),
  assetPageFetch: vi.fn(),
  deleteAssetApi: vi.fn(),
  fetchAssetReferencesApi: vi.fn(),
}));

vi.mock('@/app/api/assets', () => ({
  assetKeys: { all: ['assets'] as const },
  assetPageQueryOptions: (type: string, size: number) => ({
    queryKey: ['asset-pages', type, size],
    initialPageParam: 1,
    queryFn: () => assetPageFetch(type),
    getNextPageParam: () => undefined,
  }),
  deleteAsset: deleteAssetApi,
  fetchAssetReferences: fetchAssetReferencesApi,
  assetDetailQueryOptions: (id: unknown) => ({
    queryKey: ['asset-detail', id],
    queryFn: () => Promise.resolve(null),
    enabled: id != null,
  }),
}));

vi.mock('@/app/pages/Assets/components/AssetMasonry', async () => {
  const { createElement: h } = await import('react');
  return {
    default: (props: {
      items: Array<{ kind: string; asset: { id: string | number } }>;
      onDelete?: (asset: unknown) => void;
      onPreview?: (asset: unknown) => void;
      onToggleSelect?: (asset: unknown) => void;
    }) => h('div', { 'data-testid': 'masonry-stub' },
      props.items.map(({ asset }) => h(
        'div',
        { key: String(asset.id), 'data-asset-id': String(asset.id) },
        props.onToggleSelect
          ? h('button', { 'data-action': 'toggle', onClick: () => props.onToggleSelect!(asset) }, 'toggle')
          : null,
        props.onDelete
          ? h('button', { 'data-action': 'delete', onClick: () => props.onDelete!(asset) }, 'delete')
          : null,
        props.onPreview
          ? h('button', { 'data-action': 'preview', onClick: () => props.onPreview!(asset) }, 'preview')
          : null,
      )),
    ),
  };
});

vi.mock('@/app/pages/Assets/components/AssetDetailModal', async () => {
  const { createElement: h } = await import('react');
  return {
    default: ({ asset }: { asset: { id: string | number } | null }) => (
      asset
        ? h('div', { 'data-testid': 'asset-detail-stub', 'data-asset-id': String(asset.id) })
        : null
    ),
  };
});

vi.mock('@/app/api/material', () => ({
  createAsset: vi.fn(),
  createAssetGroup: vi.fn(),
  createVisualValidateSession: vi.fn(),
  deleteAsset: vi.fn(),
  deleteAssetGroup: vi.fn(),
  getVisualValidateResult: vi.fn(),
  listAssetGroups,
  listAssets,
}));

vi.mock('@/shared/api/http', () => ({ isApiError: () => false }));
vi.mock('@/app/utils/upload', () => ({ uploadAssetFile: vi.fn() }));
vi.mock('@/app/utils/fileSignature', () => ({ isFileRejected: () => false }));

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
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

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
  Element.prototype.scrollTo = () => {};
});

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  notifyManager.setScheduler((callback) => callback());
  assetPageFetch.mockResolvedValue({ records: [], total: 0, current: 1 });
  fetchAssetReferencesApi.mockResolvedValue({ projectCount: 0 });
  deleteAssetApi.mockResolvedValue(undefined);
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
  notifyManager.setScheduler((callback) => { setTimeout(callback, 0); });
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

describe('AssetsPickerModal 悬浮操作（IKGHZ3）', () => {
  const imageAsset = {
    id: 101,
    type: 'image',
    url: 'https://example.test/lib-a.jpg',
    width: 100,
    height: 80,
    duration: null,
    source: null,
    model: null,
    created_at: null,
  };
  const audioAsset = {
    id: 102,
    type: 'audio',
    url: 'https://example.test/lib-b.mp3',
    width: null,
    height: null,
    duration: 30,
    source: null,
    model: null,
    created_at: null,
  };

  function stubCardOf(assetId: string): HTMLElement {
    const card = document.body.querySelector(`[data-asset-id="${assetId}"]`);
    if (!(card instanceof HTMLElement)) throw new Error(`stub card not found: ${assetId}`);
    return card;
  }

  async function confirmDeletion() {
    const confirmBtn = [...document.body.querySelectorAll('button')]
      .find((b) => b.textContent === '确认删除');
    if (!(confirmBtn instanceof HTMLButtonElement)) throw new Error('confirm button not found');
    await act(async () => { confirmBtn.click(); });
  }

  it('删除主瀑布流素材：确认弹窗展示引用计数，确认后就地移除且已选计数联动', async () => {
    assetPageFetch.mockResolvedValue({ records: [imageAsset, audioAsset], total: 2, current: 1 });
    fetchAssetReferencesApi.mockResolvedValue({ projectCount: 2 });
    await renderPicker();

    await act(async () => { stubCardOf('101').querySelector<HTMLButtonElement>('[data-action="toggle"]')!.click(); });
    expect(hintText()).toContain('已选 1 项');

    await act(async () => { stubCardOf('101').querySelector<HTMLButtonElement>('[data-action="delete"]')!.click(); });

    const dialog = [...document.body.querySelectorAll('[role="dialog"]')]
      .find((d) => d.textContent?.includes('此操作不可撤销'));
    expect(dialog?.textContent).toContain('正被 2 个项目引用');

    await confirmDeletion();

    expect(deleteAssetApi).toHaveBeenCalledWith(101);
    expect(document.body.querySelector('[data-asset-id="101"]')).toBeNull();
    expect(document.body.querySelector('[data-asset-id="102"]')).not.toBeNull();
    expect(hintText()).not.toContain('已选');
  });

  it('引用数查询失败时确认弹窗降级为普通不可撤销文案', async () => {
    assetPageFetch.mockResolvedValue({ records: [imageAsset], total: 1, current: 1 });
    fetchAssetReferencesApi.mockRejectedValue(new Error('network'));
    await renderPicker();

    await act(async () => { stubCardOf('101').querySelector<HTMLButtonElement>('[data-action="delete"]')!.click(); });

    const dialog = [...document.body.querySelectorAll('[role="dialog"]')]
      .find((d) => d.textContent?.includes('此操作不可撤销'));
    expect(dialog?.textContent).toContain('确定要删除该图片资产吗？此操作不可撤销。');
    expect(dialog?.textContent).not.toContain('个项目引用');
  });

  it('放大预览打开资产详情弹窗，勾选状态不变，预览期间 Esc 不关闭选择弹窗', async () => {
    const onClose = vi.fn();
    assetPageFetch.mockResolvedValue({ records: [imageAsset], total: 1, current: 1 });
    await renderPicker({ onClose });

    await act(async () => { stubCardOf('101').querySelector<HTMLButtonElement>('[data-action="toggle"]')!.click(); });
    await act(async () => { stubCardOf('101').querySelector<HTMLButtonElement>('[data-action="preview"]')!.click(); });

    const detail = document.body.querySelector('[data-testid="asset-detail-stub"]');
    expect(detail?.getAttribute('data-asset-id')).toBe('101');
    expect(hintText()).toContain('已选 1 项');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('未打开预览时 Esc 关闭选择弹窗（既有行为锁定）', async () => {
    const onClose = vi.fn();
    await renderPicker({ onClose });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('删除已勾选的虚拟人像库素材后底部已选计数同步减一（故事8 集成链）', async () => {
    await renderPicker({ showCharacterTab: true });
    await clickTab('虚拟人像库');

    await act(async () => { assetCardOf('img[alt="人像图片"]').click(); });
    expect(hintText()).toContain('已选 1 项');

    await act(async () => {
      assetCardOf('img[alt="人像图片"]').querySelector<HTMLButtonElement>('button[title="删除素材"]')!.click();
    });
    await confirmDeletion();

    expect(hintText()).not.toContain('已选');
    expect(assetCardOf('video[src="https://example.test/video.mp4"]')).toBeInstanceOf(HTMLElement);
  });
});
