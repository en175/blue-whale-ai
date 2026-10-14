
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { assetKeys, assetPageQueryOptions, deleteAsset, removeCachedAssetPages, fetchAssetReferences, type AssetRecord } from '@/api/assets';
import { createAsset as createMaterialAsset } from '@/api/material';
import { uploadAssetFile } from '@/utils/upload';
import { isFileRejected } from '@/utils/fileSignature';
import { toast } from 'sonner';
import { isApiError } from '@/api/http';
import ConfirmModal from '@/components/ConfirmModal';
import Skeleton from '@/components/Skeleton';
import JobSourceModal, { type JobSourceTarget } from '@/components/JobSourceModal';
import AssetDetailModal from './components/AssetDetailModal';
import CharacterLibrary from './components/CharacterLibrary';
import AssetMasonry, { type AssetGridItem } from './components/AssetMasonry';
import { appendUniqueAssets, typeLabel } from './assetGrid';
import { getAssetFilter, setAssetFilter, type FilterKey } from './filterQuery';
import { usePreviewAsset } from './previewAsset';
import styles from './index.module.css';

const filterTabs: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'character', label: '虚拟人像库' },
  { key: 'liveness', label: '真人人像库' },
];

const LIBRARY_PAGE_SIZE = 30;


export default function Assets() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const activeFilter = getAssetFilter(searchParams);

  const setActiveFilter = useCallback((next: FilterKey) => {
    setSearchParams(setAssetFilter(searchParams, next));
  }, [searchParams, setSearchParams]);
  const [deleteTarget, setDeleteTarget] = useState<AssetRecord | null>(null);
  const [refCount, setRefCount] = useState<{ id: string; count: number | null } | null>(null);
  const [previewTarget, setPreviewTarget] = useState<AssetRecord | null>(null);
  const previewAsset = usePreviewAsset(previewTarget);
  const [sourceTarget, setSourceTarget] = useState<JobSourceTarget | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [materialDetailGroupId, setMaterialDetailGroupId] = useState<string | null>(null);
  const [materialRefreshTick, setMaterialRefreshTick] = useState(0);
  const handleMaterialDetailViewChange = useCallback((inDetail: boolean, groupId: string | null) => {
    setMaterialDetailGroupId(inDetail ? groupId : null);
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [isHeaderScrolled, setIsHeaderScrolled] = useState(false);

  const isMaterialView = activeFilter === 'character' || activeFilter === 'liveness';
  const assetType = activeFilter === 'all' || activeFilter === 'liveness' ? '' : activeFilter;
  const {
    data: assetData,
    fetchNextPage,
    hasNextPage,
    isError: isAssetQueryError,
    isFetchingNextPage,
    isPending: isAssetQueryPending,
  } = useInfiniteQuery({
    ...assetPageQueryOptions(assetType, LIBRARY_PAGE_SIZE),
    enabled: !isMaterialView,
  });
  const assetPages = assetData?.pages;
  const assets = useMemo(
    () => appendUniqueAssets([], assetPages?.flatMap((page) => page.records) ?? []),
    [assetPages],
  );
  const assetTotal = assetPages?.at(-1)?.total ?? 0;
  const loading = !isMaterialView && (isAssetQueryPending || (!assetPages && isAssetQueryError));
  const loadingMore = isFetchingNextPage;
  const hasMore = hasNextPage;

  useEffect(() => () => {
    removeCachedAssetPages(queryClient);
  }, [queryClient]);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return undefined;

    const syncHeaderGlass = () => setIsHeaderScrolled(page.scrollTop > 0);
    syncHeaderGlass();
    page.addEventListener('scroll', syncHeaderGlass, { passive: true });
    return () => page.removeEventListener('scroll', syncHeaderGlass);
  }, []);

  const loadNextPage = useCallback(async () => {
    if (isMaterialView || !hasNextPage || isFetchingNextPage) return;
    await fetchNextPage();
  }, [fetchNextPage, hasNextPage, isMaterialView, isFetchingNextPage]);

  const handleUpload = useCallback(() => {
    if (uploading) return;
    fileInputRef.current?.click();
  }, [uploading]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || uploading) return;
    const list = Array.from(files);
    if (fileInputRef.current) fileInputRef.current.value = '';

    setUploading(true);
    const errors: string[] = [];

    for (const file of list) {
      let assetType: 'Image' | 'Video' | 'Audio';
      if (file.type.startsWith('image/')) assetType = 'Image';
      else if (file.type.startsWith('video/')) assetType = 'Video';
      else {
        errors.push(`${file.name}：仅支持图片和视频`);
        continue;
      }
      try {
        const uploadResult = await uploadAssetFile(file);
        const rawName = file.name;
        const finalName = rawName.length > 30 ? rawName.slice(0, 30) : rawName;
        if (rawName.length > 30) toast('当前上传素材名称过长，已截取', { style: { textAlign: 'center' } });
        if (activeFilter === 'liveness' && !materialDetailGroupId) {
          errors.push(`${file.name}：请先进入分组再上传`);
          continue;
        }
        await createMaterialAsset({
          ...(activeFilter === 'liveness' && materialDetailGroupId
            ? { GroupId: materialDetailGroupId }
            : {}),
          URL: uploadResult.url,
          Name: finalName,
          AssetType: assetType,
          SourceAssetId: String(uploadResult.asset_id),
        });
      } catch (err) {
        if (isFileRejected(err)) errors.push(err.message);
        else if (!isApiError(err)) errors.push(`上传失败：${file.name}`);
      }
    }

    if (errors.length) toast.error(errors.join('；'));
    setUploading(false);
    setMaterialRefreshTick((t) => t + 1);
  };

  const assetItems = useMemo<AssetGridItem[]>(
    () => assets.map((asset) => ({ kind: 'asset' as const, asset })),
    [assets],
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

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteAsset(deleteTarget.id);
      await queryClient.invalidateQueries({ queryKey: assetKeys.all });
      setLayoutVersion((version) => version + 1);
      toast.success('已删除');
      setDeleteTarget(null);
    } catch (e) {
      if (!isApiError(e)) toast.error('删除失败，请稍后重试');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div ref={pageRef} className={styles.page}>
      <div className={styles.container}>
        {}
        {!(isMaterialView && materialDetailGroupId) && (
        <div className={`${styles.header} ${isHeaderScrolled ? styles.headerScrolled : ''}`}>
          <h1 className={styles.pageTitle}>资产库</h1>
          <div className={styles.headerActions}>
            {}
            {filterTabs.map((tab) => (
              <button
                key={tab.key}
                className={`${styles.filterBtn} ${activeFilter === tab.key ? styles.filterBtnActive : ''}`}
                onClick={() => setActiveFilter(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        )}

        <div className={styles.content}>
          {}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm"
            className={styles.hiddenInput}
            onChange={handleFileChange}
          />

          {}
          {isMaterialView ? (
            <CharacterLibrary
              groupType={activeFilter === 'liveness' ? 'LivenessFace' : 'AIGC'}
              refreshTick={materialRefreshTick}
              onDetailViewChange={handleMaterialDetailViewChange}
              onUpload={handleUpload}
            />
          ) : (
            <>
              {loading &&
                <div className={styles.skeletonGrid}>
                  {Array.from({ length: 10 }, (_, index) => (
                    <Skeleton key={index} className={styles.cardSkeleton} />
                  ))}
                </div>}
              {!loading && assetItems.length > 0 && (
                <AssetMasonry
                  key={`${activeFilter}:${layoutVersion}`}
                  items={assetItems}
                  totalItems={hasMore ? assetTotal : assetItems.length}
                  onLoadMore={loadNextPage}
                  scrollContainerRef={pageRef}
                  onPreview={setPreviewTarget}
                  onDelete={setDeleteTarget}
                  gutter={4}
                  libraryMode
                />
              )}
              {!loading && assetItems.length === 0 && (
                <div className={styles.empty}>暂无素材</div>
              )}
              {!loading && loadingMore && (
                <div className={styles.loadState} role="status">加载中…</div>
              )}
              {!loading && !hasMore && assets.length > 0 && (
                <div className={styles.loadState}>已加载全部素材</div>
              )}
            </>
          )}
        </div>
      </div>

      <AssetDetailModal
        asset={previewAsset}
        onClose={() => setPreviewTarget(null)}
        onOpenSource={setSourceTarget}
      />

      {}
      <JobSourceModal target={sourceTarget} onClose={() => setSourceTarget(null)} />

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
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
