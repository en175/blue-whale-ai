import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { toast } from '@/custom/components/Toast';
import { assetKeys, assetPageQueryOptions, deleteAsset, fetchAssetReferences, type AssetRecord } from '@/custom/api/assets';
import { isApiError } from '@/shared/api/http';
import {
  type MaterialAsset,
  type MaterialAssetType,
} from '@/custom/api/material';
import { uploadMaterialLibraryFiles } from '../../characterLibraryUpload';
import { VIDEO_REFERENCE_NOT_APPROVED_MESSAGE, isUnapprovedVideoMaterialStatus } from '@/custom/utils/video-reference-compliance';
import AssetMasonry from '@/custom/pages/Assets/components/AssetMasonry';
import CharacterLibrary from '@/custom/pages/Assets/components/CharacterLibrary';
import AssetDetailModal from '@/custom/pages/Assets/components/AssetDetailModal';
import { appendUniqueAssets, typeLabel } from '@/custom/pages/Assets/assetGrid';
import { usePreviewAsset } from '@/custom/pages/Assets/previewAsset';
import assetStyles from '@/custom/pages/Assets/index.module.css';
import Skeleton from '@/custom/components/Skeleton';
import ConfirmModal from '@/custom/components/ConfirmModal';
import styles from './index.module.css';
import { type PickerMediaType, type AssetType } from '@/custom/enums';

type MaterialSource = 'liveness' | 'character';

type PickerTabKey = 'all' | PickerMediaType | 'character' | 'liveness';

const pickerTabs: { key: 'all' | PickerMediaType; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
];

const PICKER_PAGE_SIZE = 30;

export interface AssetsPickerModalProps {
  onClose: () => void;
  onSelect: (assets: AssetRecord[]) => void;
  mediaTypes?: PickerMediaType[];
  confirmText?: string;
  showLivenessTab?: boolean;
  showCharacterTab?: boolean;
  rejectUnapprovedForVideo?: boolean;
}

function materialTypeToAssetType(assetType: MaterialAssetType): AssetType {
  if (assetType === 'Video') return 'video';
  if (assetType === 'Audio') return 'audio';
  return 'image';
}

function materialToPickerRecord(asset: MaterialAsset, source: MaterialSource): AssetRecord {
  return {
    id: asset.Id,
    type: materialTypeToAssetType(asset.AssetType),
    url: asset.URL,
    width: null,
    height: null,
    duration: null,
    source,
    model: null,
    created_at: asset.CreateTime ?? null,
    material_id: asset.Id,
    material_status: asset.Status === 'Active' || asset.Status === 'Processing' || asset.Status === 'Failed'
      ? asset.Status
      : undefined,
  };
}

export default function AssetsPickerModal({
  onClose,
  onSelect,
  mediaTypes,
  confirmText = '插入画布',
  showLivenessTab = false,
  showCharacterTab = false,
  rejectUnapprovedForVideo = false,
}: AssetsPickerModalProps) {
  const visibleTabs = useMemo((): { key: PickerTabKey; label: string }[] => {
    let tabs: { key: PickerTabKey; label: string }[];
    if (!mediaTypes || mediaTypes.length === 0) {
      tabs = [...pickerTabs];
    } else {
      const allowed = mediaTypes.length === 1
        ? pickerTabs.filter((tab) => tab.key !== 'all')
        : pickerTabs;
      tabs = allowed.filter(
        (tab) => tab.key === 'all' || mediaTypes.includes(tab.key),
      );
    }
    if (showCharacterTab) {
      tabs = [...tabs, { key: 'character', label: '虚拟人像库' }];
    }
    if (showLivenessTab) {
      tabs = [...tabs, { key: 'liveness', label: '真人人像库' }];
    }
    return tabs;
  }, [mediaTypes, showCharacterTab, showLivenessTab]);
  const singleType = mediaTypes?.length === 1 ? mediaTypes[0] : null;

  const [activeTab, setActiveTab] = useState<PickerTabKey>(singleType ?? 'all');
  const isLivenessTab = activeTab === 'liveness';
  const isCharacterTab = activeTab === 'character';
  const isMaterialTab = isLivenessTab || isCharacterTab;
  const [selectedMap, setSelectedMap] = useState<ReadonlyMap<string, AssetRecord>>(() => new Map());
  const queryClient = useQueryClient();
  const [removedAssets, setRemovedAssets] = useState<ReadonlyMap<string, AssetType>>(() => new Map());
  const removedCountRef = useRef(0);
  const [deleteTarget, setDeleteTarget] = useState<AssetRecord | null>(null);
  const [refCount, setRefCount] = useState<{ id: string; count: number | null } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<AssetRecord | null>(null);
  const [materialPreviewOpen, setMaterialPreviewOpen] = useState(false);
  const previewAsset = usePreviewAsset(previewTarget);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [livenessGroupId, setLivenessGroupId] = useState<string | null>(null);
  const [livenessRefreshTick, setLivenessRefreshTick] = useState(0);
  const [characterRefreshTick, setCharacterRefreshTick] = useState(0);
  const [uploading, setUploading] = useState(false);

  const assetType = isMaterialTab || activeTab === 'all' ? '' : activeTab;
  const {
    data: assetData,
    fetchNextPage,
    hasNextPage,
    isError,
    isFetchingNextPage,
    isPending,
  } = useInfiniteQuery({
    ...assetPageQueryOptions(assetType, PICKER_PAGE_SIZE),
    staleTime: 0,
    enabled: !isMaterialTab,
  });

  const assetPages = assetData?.pages;
  const assets = useMemo(
    () => appendUniqueAssets([], assetPages?.flatMap((page) => page.records) ?? []),
    [assetPages],
  );
  const localVisibleAssets = useMemo(
    () =>
      assets.filter((a): a is (typeof assets)[number] =>
        !removedAssets.has(String(a.id))
        && (!mediaTypes || mediaTypes.length === 0
          || (mediaTypes as string[]).includes(a.type))),
    [assets, mediaTypes, removedAssets],
  );
  const visibleAssets = localVisibleAssets;
  const assetTotal = useMemo(() => {
    const pageTotal = assetPages?.at(-1)?.total ?? 0;
    if (assetType === '') return Math.max(0, pageTotal - removedAssets.size);
    let removedInTab = 0;
    removedAssets.forEach((type) => { if (type === assetType) removedInTab += 1; });
    return Math.max(0, pageTotal - removedInTab);
  }, [assetPages, assetType, removedAssets]);
  const loading = isMaterialTab ? false : isPending || (!assetPages && isError);
  const listError = isMaterialTab ? false : isError;

  const loadNextPage = useCallback(async () => {
    if (isMaterialTab || !hasNextPage || isFetchingNextPage) return;
    await fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isMaterialTab]);

  const gridItems = useMemo(
    () => visibleAssets.map((asset) => ({ kind: 'asset' as const, asset })),
    [visibleAssets],
  );

  const selectedAssets = useMemo(
    () => Array.from(selectedMap.values()),
    [selectedMap],
  );
  const selectedIds = useMemo(
    () => new Set(selectedMap.keys()),
    [selectedMap],
  );

  const handleLivenessDetailViewChange = useCallback((inDetail: boolean, groupId: string | null) => {
    setLivenessGroupId(inDetail ? groupId : null);
  }, []);

  const uploadMaterialFiles = useCallback(async (files: File[], groupId: string | null): Promise<string[]> => {
    const { errors } = await uploadMaterialLibraryFiles(files, groupId);
    return errors;
  }, []);

  const handleLivenessPickFiles = useCallback(async (files: File[]) => {
    if (files.length === 0 || uploading) return;
    if (!livenessGroupId) {
      toast.error('请先进入分组再上传');
      return;
    }
    setUploading(true);
    const errors = await uploadMaterialFiles(files, livenessGroupId);
    if (errors.length) toast.error(errors.join('；'));
    setUploading(false);
    setLivenessRefreshTick((tick) => tick + 1);
  }, [livenessGroupId, uploading, uploadMaterialFiles]);

  const handleCharacterPickFiles = useCallback(async (files: File[]) => {
    if (files.length === 0 || uploading) return;
    setUploading(true);
    const errors = await uploadMaterialFiles(files, null);
    if (errors.length) toast.error(errors.join('；'));
    setUploading(false);
    setCharacterRefreshTick((tick) => tick + 1);
  }, [uploading, uploadMaterialFiles]);

  const handleToggleSelect = useCallback((asset: AssetRecord) => {
    if (rejectUnapprovedForVideo && isUnapprovedVideoMaterialStatus(asset.material_status)) {
      toast.error(VIDEO_REFERENCE_NOT_APPROVED_MESSAGE);
      return;
    }
    const id = String(asset.id);
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, asset);
      return next;
    });
  }, [rejectUnapprovedForVideo]);

  const handleToggleMaterialAsset = useCallback((asset: MaterialAsset, source: MaterialSource) => {
    if (asset.Status === 'Processing') {
      toast('素材处理中，稍后可用');
      return;
    }
    if (rejectUnapprovedForVideo && isUnapprovedVideoMaterialStatus(asset.Status)) {
      toast.error(VIDEO_REFERENCE_NOT_APPROVED_MESSAGE);
      return;
    }
    const record = materialToPickerRecord(asset, source);
    if (mediaTypes && mediaTypes.length > 0 && !mediaTypes.includes(record.type as PickerMediaType)) {
      return;
    }
    handleToggleSelect(record);
  }, [handleToggleSelect, mediaTypes, rejectUnapprovedForVideo]);

  const handleToggleLivenessAsset = useCallback(
    (asset: MaterialAsset) => handleToggleMaterialAsset(asset, 'liveness'),
    [handleToggleMaterialAsset],
  );

  const handleToggleCharacterAsset = useCallback(
    (asset: MaterialAsset) => handleToggleMaterialAsset(asset, 'character'),
    [handleToggleMaterialAsset],
  );

  useEffect(() => {
    if (!deleteTarget) return undefined;
    let cancelled = false;
    const targetId = String(deleteTarget.id);
    fetchAssetReferences(deleteTarget.id)
      .then((data) => {
        if (!cancelled) setRefCount({ id: targetId, count: data.projectCount });
      })
      .catch(() => {
        if (!cancelled) setRefCount({ id: targetId, count: null });
      });
    return () => {
      cancelled = true;
    };
  }, [deleteTarget]);

  const currentRefCount: { loading: boolean; count: number | null } = deleteTarget
    ? refCount?.id === String(deleteTarget.id)
      ? { loading: false, count: refCount.count }
      : { loading: true, count: null }
    : { loading: false, count: null };

  const confirmDeleteAsset = useCallback(async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    const targetId = String(deleteTarget.id);
    try {
      await deleteAsset(deleteTarget.id);
      removedCountRef.current += 1;
      setRemovedAssets((prev) => {
        const next = new Map(prev);
        next.set(targetId, deleteTarget.type);
        return next;
      });
      setSelectedMap((prev) => {
        if (!prev.has(targetId)) return prev;
        const next = new Map(prev);
        next.delete(targetId);
        return next;
      });
      toast.success('已删除');
      setDeleteTarget(null);
    } catch (e) {
      if (!isApiError(e)) toast.error('删除失败，请稍后重试');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, deleting]);

  useEffect(() => () => {
    if (removedCountRef.current > 0) queryClient.invalidateQueries({ queryKey: assetKeys.all });
  }, [queryClient]);

  const handleMaterialAssetRemoved = useCallback((assetId: string) => {
    setSelectedMap((prev) => {
      if (!prev.has(assetId)) return prev;
      const next = new Map(prev);
      next.delete(assetId);
      return next;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !previewTarget && !materialPreviewOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, previewTarget, materialPreviewOpen]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [activeTab]);

  return createPortal(
    <div className={styles.overlay} data-gen-panel-territory onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
          {isLivenessTab && (
            <CharacterLibrary
              groupType="LivenessFace"
              refreshTick={livenessRefreshTick}
              onDetailViewChange={handleLivenessDetailViewChange}
              onPickFiles={handleLivenessPickFiles}
              pickerSelectedIds={selectedIds}
              onPickerToggleAsset={handleToggleLivenessAsset}
              onPickerBlockedAsset={rejectUnapprovedForVideo ? handleToggleLivenessAsset : undefined}
              pickerMediaTypes={mediaTypes}
              onPickerAssetRemoved={handleMaterialAssetRemoved}
              onPickerPreviewChange={setMaterialPreviewOpen}
            />
          )}
          {isCharacterTab && (
            <CharacterLibrary
              groupType="AIGC"
              refreshTick={characterRefreshTick}
              onPickFiles={handleCharacterPickFiles}
              pickerSelectedIds={selectedIds}
              onPickerToggleAsset={handleToggleCharacterAsset}
              onPickerBlockedAsset={rejectUnapprovedForVideo ? handleToggleCharacterAsset : undefined}
              pickerMediaTypes={mediaTypes}
              onPickerAssetRemoved={handleMaterialAssetRemoved}
              onPickerPreviewChange={setMaterialPreviewOpen}
            />
          )}
          {!isMaterialTab && loading && (
            <div className={assetStyles.skeletonGrid}>
              {Array.from({ length: 10 }, (_, index) => (
                <Skeleton key={index} className={assetStyles.cardSkeleton} />
              ))}
            </div>
          )}
          {!isMaterialTab && !loading && listError && gridItems.length === 0 && (
            <div className={assetStyles.empty}>资产加载失败，请稍后重试</div>
          )}
          {!isMaterialTab && !loading && !listError && gridItems.length === 0 && (
            <div className={assetStyles.empty}>暂无素材</div>
          )}
          {!isMaterialTab && !loading && gridItems.length > 0 && (
            <>
              <AssetMasonry
                key={activeTab}
                items={gridItems}
                totalItems={hasNextPage ? assetTotal : gridItems.length}
                onLoadMore={loadNextPage}
                scrollContainerRef={scrollRef}
                selectedIds={selectedIds}
                onToggleSelect={handleToggleSelect}
                onDelete={setDeleteTarget}
                onPreview={setPreviewTarget}
                columnCount={4}
                pageSize={PICKER_PAGE_SIZE}
                libraryMode
              />
              {isFetchingNextPage && (
                <div className={assetStyles.loadState} role="status">加载中…</div>
              )}
              {!hasNextPage && localVisibleAssets.length > 0 && (
                <div className={assetStyles.loadState}>已加载全部素材</div>
              )}
            </>
          )}
        </div>

        {}
        <div className={styles.footer}>
          <span className={styles.selectHint}>
            {selectedAssets.length > 0
              ? `已选 ${selectedAssets.length} 项`
              : isLivenessTab
                ? '进入分组后点击素材进行选择，可多选'
                : '点击素材进行选择，可多选'}
          </span>
          <div className={styles.footerActions}>
            <button className={styles.cancelBtn} onClick={onClose}>取消</button>
            <button
              className={styles.confirmBtn}
              disabled={selectedAssets.length === 0}
              onClick={() => {
                if (!rejectUnapprovedForVideo) {
                  onSelect(selectedAssets);
                  return;
                }
                const allowed = selectedAssets.filter(
                  (asset) => !isUnapprovedVideoMaterialStatus(asset.material_status),
                );
                if (allowed.length < selectedAssets.length) {
                  toast.error(VIDEO_REFERENCE_NOT_APPROVED_MESSAGE);
                }
                if (allowed.length === 0) return;
                onSelect(allowed);
              }}
            >
              {confirmText}{selectedAssets.length > 0 ? `（${selectedAssets.length}）` : ''}
            </button>
          </div>
        </div>
      </div>

      {}
      <AssetDetailModal
        asset={previewAsset}
        onClose={() => setPreviewTarget(null)}
      />

      {}
      <ConfirmModal
        open={!!deleteTarget}
        title="删除资产"
        message={
          deleteTarget
            ? currentRefCount.loading
              ? '正在查询该素材的项目引用情况…'
              : currentRefCount.count !== null && currentRefCount.count > 0
                ? `该${typeLabel[deleteTarget.type]}素材正被 ${currentRefCount.count} 个项目引用，删除后这些项目的画布节点将显示占位图。确定要删除吗？此操作不可撤销。`
                : `确定要删除该${typeLabel[deleteTarget.type]}资产吗？此操作不可撤销。`
            : ''
        }
        confirmText="确认删除"
        onConfirm={confirmDeleteAsset}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>,
    document.body,
  );
}
