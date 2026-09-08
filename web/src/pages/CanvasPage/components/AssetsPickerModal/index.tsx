/* ============================================
 * AssetsPickerModal 画布「资产库选择」弹窗
 * 工具栏加号 → 资产库选择入口：GET /api/assets 分页拉取 + tab 筛选（不含虚拟人像库）
 * 多选 + 确认：卡片点击勾选/取消，确认后批量回调落画布
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

/** 媒体类型（与资产库 type 字段对齐） */
export type PickerMediaType = 'image' | 'video' | 'audio';

/** 全量 tab：全部 / 图片 / 视频 / 音频（不含虚拟人像库） */
const pickerTabs: { key: 'all' | PickerMediaType; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
];

const PICKER_PAGE_SIZE = 30;

export interface AssetsPickerModalProps {
  onClose: () => void;
  /** 确认选择（多选）：回调后由父组件批量落画布并决定是否关闭弹窗 */
  onSelect: (assets: AssetRecord[]) => void;
  /**
   * 按打开入口可接受的媒体类型过滤（PRD 模块C R3）：
   * - 不传：全类型 + 默认「全部」tab（画布工具栏现状）
   * - 单类型：隐藏 tab 栏，直接按该类型拉取
   * - 多类型：仅展示允许的类型 tab（含「全部」），默认「全部」
   */
  mediaTypes?: PickerMediaType[];
  /** 确认按钮文案（默认「插入画布」，首页/dock 参考入口可传「确定」等） */
  confirmText?: string;
}

export default function AssetsPickerModal({
  onClose,
  onSelect,
  mediaTypes,
  confirmText = '插入画布',
}: AssetsPickerModalProps) {
  /** 可展示的 tab：按入口可接受类型过滤；单类型时只剩一个 tab（渲染层隐藏 tab 栏） */
  const visibleTabs = useMemo(() => {
    if (!mediaTypes || mediaTypes.length === 0) return pickerTabs;
    const allowed = mediaTypes.length === 1
      ? pickerTabs.filter((tab) => tab.key !== 'all')
      : pickerTabs;
    return allowed.filter(
      (tab) => tab.key === 'all' || mediaTypes.includes(tab.key),
    );
  }, [mediaTypes]);
  const singleType = mediaTypes?.length === 1 ? mediaTypes[0] : null;

  const [activeTab, setActiveTab] = useState<'all' | PickerMediaType>(singleType ?? 'all');
  /** 已勾选资产记录（id → record，跨 tab 保留：tab 仅是筛选视图，确认时统一提交） */
  const [selectedMap, setSelectedMap] = useState<ReadonlyMap<string, AssetRecord>>(() => new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  const assetType = activeTab === 'all' ? '' : activeTab;
  const {
    data: assetData,
    fetchNextPage,
    hasNextPage,
    isError,
    isFetchingNextPage,
    isPending,
  } = useInfiniteQuery({
    ...assetPageQueryOptions(assetType, PICKER_PAGE_SIZE),
    // 弹窗与资产页共用查询缓存（key 含 size=30）：覆盖全局 staleTime，
    // 保证每次打开弹窗都重新请求当前 tab 的素材列表（默认 tab 为全部）
    staleTime: 0,
  });

  const assetPages = assetData?.pages;
  const assets = useMemo(
    () => appendUniqueAssets([], assetPages?.flatMap((page) => page.records) ?? []),
    [assetPages],
  );
  /** 「全部」tab 会拉取全类型：按入口允许类型过滤（如仅图片入口不出现音频/视频卡片，避免勾选后被静默丢弃） */
  const visibleAssets = useMemo(
    () =>
      mediaTypes && mediaTypes.length > 0
        ? assets.filter((a): a is (typeof assets)[number] =>
            (mediaTypes as string[]).includes(a.type))
        : assets,
    [assets, mediaTypes],
  );
  const assetTotal = assetPages?.at(-1)?.total ?? 0;
  const loading = isPending || (!assetPages && isError);

  const loadNextPage = useCallback(async () => {
    if (!hasNextPage || isFetchingNextPage) return;
    await fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const gridItems = useMemo(
    () => visibleAssets.map((asset) => ({ kind: 'asset' as const, asset })),
    [visibleAssets],
  );

  /** 已勾选的完整资产记录（保持勾选顺序） */
  const selectedAssets = useMemo(
    () => Array.from(selectedMap.values()),
    [selectedMap],
  );
  /** 当前 tab 已加载资产的勾选 ID 集合（传给瀑布流渲染角标态） */
  const selectedIds = useMemo(
    () => new Set(selectedMap.keys()),
    [selectedMap],
  );

  /** 卡片点击切换勾选（保存完整记录，跨 tab 提交时不丢） */
  const handleToggleSelect = useCallback((asset: AssetRecord) => {
    const id = String(asset.id);
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, asset);
      return next;
    });
  }, []);

  /** Esc 关闭 */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  /** 切换 tab 时回到顶部（勾选保留） */
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [activeTab]);

  return createPortal(
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.panel} role="dialog" aria-label="从资产库选择素材">
        <div className={styles.header}>
          <h2 className={styles.title}>资产库</h2>
          {visibleTabs.length > 1 && (
            <div className={styles.tabs}>
              {visibleTabs.map((tab) => (
                <button
                  key={tab.key}
                  className={`${assetStyles.filterBtn} ${activeTab === tab.key ? assetStyles.filterBtnActive : ''}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
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
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                columnCount={4}
                pageSize={PICKER_PAGE_SIZE}
                libraryMode
              />
              {isFetchingNextPage && (
                <div className={assetStyles.loadState} role="status">加载中…</div>
              )}
              {!hasNextPage && visibleAssets.length > 0 && (
                <div className={assetStyles.loadState}>已加载全部素材</div>
              )}
            </>
          )}
        </div>

        {/* 底部操作栏：取消 + 确认（展示已选数量，未勾选时禁用） */}
        <div className={styles.footer}>
          <span className={styles.selectHint}>
            {selectedAssets.length > 0 ? `已选 ${selectedAssets.length} 项` : '点击素材进行选择，可多选'}
          </span>
          <div className={styles.footerActions}>
            <button className={styles.cancelBtn} onClick={onClose}>取消</button>
            <button
              className={styles.confirmBtn}
              disabled={selectedAssets.length === 0}
              onClick={() => onSelect(selectedAssets)}
            >
              {confirmText}{selectedAssets.length > 0 ? `（${selectedAssets.length}）` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
