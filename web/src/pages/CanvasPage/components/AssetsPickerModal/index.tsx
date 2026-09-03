/* ============================================
 * AssetsPickerModal 画布「资产库选择」弹窗
 * 工具栏加号 → 资产库选择入口：GET /api/assets 分页拉取 + tab 筛选（不含虚拟人像库）
 * 卡片点击即选中回调（落画布），列表展示与资产页瀑布流保持一致
 * ============================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import {
  assetPageQueryOptions,
  type AssetRecord,
} from '@/api/assets';
import AssetMasonry from '@/pages/Assets/components/AssetMasonry';
import { appendUniqueAssets } from '@/pages/Assets/assetGrid';
import assetStyles from '@/pages/Assets/index.module.css';
import Skeleton from '@/components/Skeleton';
import styles from './index.module.css';

/** 弹窗 tab：全部 / 图片 / 视频 / 音频（不含虚拟人像库） */
const pickerTabs: { key: 'all' | 'image' | 'video' | 'audio'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
];

const PICKER_PAGE_SIZE = 30;

export interface AssetsPickerModalProps {
  onClose: () => void;
  /** 选中资产（卡片点击）：回调后由父组件决定是否关闭弹窗 */
  onSelect: (asset: AssetRecord) => void;
}

export default function AssetsPickerModal({ onClose, onSelect }: AssetsPickerModalProps) {
  const [activeTab, setActiveTab] = useState<'all' | 'image' | 'video' | 'audio'>('all');
  const scrollRef = useRef<HTMLDivElement>(null);

  const assetType = activeTab === 'all' ? '' : activeTab;
  const {
    data: assetData,
    fetchNextPage,
    hasNextPage,
    isError,
    isFetchingNextPage,
    isPending,
  } = useInfiniteQuery(assetPageQueryOptions(assetType, PICKER_PAGE_SIZE));

  const assetPages = assetData?.pages;
  const assets = useMemo(
    () => appendUniqueAssets([], assetPages?.flatMap((page) => page.records) ?? []),
    [assetPages],
  );
  const assetTotal = assetPages?.at(-1)?.total ?? 0;
  const loading = isPending || (!assetPages && isError);

  const loadNextPage = useCallback(async () => {
    if (!hasNextPage || isFetchingNextPage) return;
    await fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const gridItems = useMemo(
    () => assets.map((asset) => ({ kind: 'asset' as const, asset })),
    [assets],
  );

  /** Esc 关闭 */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  /** 切换 tab 时回到顶部 */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [activeTab]);

  return createPortal(
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.panel} role="dialog" aria-label="从资产库选择素材">
        <div className={styles.header}>
          <h2 className={styles.title}>资产库</h2>
          <div className={styles.tabs}>
            {pickerTabs.map((tab) => (
              <button
                key={tab.key}
                className={`${assetStyles.filterBtn} ${activeTab === tab.key ? assetStyles.filterBtnActive : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="关闭">
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div ref={scrollRef} className={styles.body}>
          {loading && (
            <div className={assetStyles.skeletonGrid}>
              {Array.from({ length: 10 }, (_, index) => (
                <Skeleton key={index} className={assetStyles.cardSkeleton} />
              ))}
            </div>
          )}
          {!loading && isError && gridItems.length === 0 && (
            <div className={assetStyles.empty}>资产加载失败，请稍后重试</div>
          )}
          {!loading && !isError && gridItems.length === 0 && (
            <div className={assetStyles.empty}>暂无素材</div>
          )}
          {!loading && gridItems.length > 0 && (
            <>
              <AssetMasonry
                key={activeTab}
                items={gridItems}
                totalItems={hasNextPage ? assetTotal : gridItems.length}
                onLoadMore={loadNextPage}
                scrollContainerRef={scrollRef}
                onPreview={onSelect}
                columnCount={4}
                pageSize={PICKER_PAGE_SIZE}
              />
              {isFetchingNextPage && (
                <div className={assetStyles.loadState} role="status">加载中…</div>
              )}
              {!hasNextPage && assets.length > 0 && (
                <div className={assetStyles.loadState}>已加载全部素材</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
