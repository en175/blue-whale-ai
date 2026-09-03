/* ============================================
 * Assets 资产页面：GET /api/assets 分页拉取 + 类型筛选 + 真实媒体预览
 * ============================================ */

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { assetKeys, assetPageQueryOptions, deleteAsset, removeCachedAssetPages, UPLOAD_SIZE_LIMIT, fetchUploadPresign, putToPresignedUrl, completeUpload, type AssetRecord, type AssetType } from '@/api/assets';
import { createAsset as createMaterialAsset } from '@/api/material';
import { uploadAssetFile } from '@/utils/upload';
import { toast } from 'sonner';
import { isApiError } from '@/api/http';
import { fileToAssetType } from '@/utils/upload';
import ConfirmModal from '@/components/ConfirmModal';
import Skeleton from '@/components/Skeleton';
import AssetDetailModal from './components/AssetDetailModal';
import CharacterLibrary from './components/CharacterLibrary';
import AssetMasonry, { type AssetGridItem } from './components/AssetMasonry';
import { appendUniqueAssets, typeLabel } from './assetGrid';
import { getAssetFilter, setAssetFilter, type FilterKey } from './filterQuery';
import styles from './index.module.css';

/** 筛选按钮定义 */
const filterTabs: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'character', label: '虚拟人像库' },
];

/** Library 瀑布流每次只请求 30 条，避免首屏过量加载。 */
const LIBRARY_PAGE_SIZE = 30;


export default function Assets() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const activeFilter = getAssetFilter(searchParams);

  /** 筛选状态由 URL 承载，方便分享链接并响应浏览器前进/后退。 */
  const setActiveFilter = useCallback((next: FilterKey) => {
    setSearchParams(setAssetFilter(searchParams, next));
  }, [searchParams, setSearchParams]);
  const [deleteTarget, setDeleteTarget] = useState<AssetRecord | null>(null);
  const [previewTarget, setPreviewTarget] = useState<AssetRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** 虚拟人分组详情视图中当前分组 ID（null = 不在详情视图） */
  const [characterDetailGroupId, setCharacterDetailGroupId] = useState<string | null>(null);
  /** 虚拟人分组详情刷新触发器（上传后 +1 触发 CharacterLibrary 重新拉取） */
  const [characterRefreshTick, setCharacterRefreshTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [layoutVersion, setLayoutVersion] = useState(0);

  const isCharacterView = activeFilter === 'character';
  const assetType = activeFilter === 'all' ? '' : activeFilter;
  const {
    data: assetData,
    fetchNextPage,
    hasNextPage,
    isError: isAssetQueryError,
    isFetchingNextPage,
    isPending: isAssetQueryPending,
  } = useInfiniteQuery({
    ...assetPageQueryOptions(assetType, LIBRARY_PAGE_SIZE),
    enabled: !isCharacterView,
  });
  const assetPages = assetData?.pages;
  const assets = useMemo(
    () => appendUniqueAssets([], assetPages?.flatMap((page) => page.records) ?? []),
    [assetPages],
  );
  const assetTotal = assetPages?.at(-1)?.total ?? 0;
  const loading = !isCharacterView && (isAssetQueryPending || (!assetPages && isAssetQueryError));
  const loadingMore = isFetchingNextPage;
  const hasMore = hasNextPage;

  // Masonic 的位置缓存只适用于当前挂载周期。离开资产库时移除分页缓存，
  // 再次进入先显示骨架屏并取得新数据，避免将旧卡片直接交给新定位器。
  useEffect(() => () => {
    removeCachedAssetPages(queryClient);
  }, [queryClient]);

  const loadNextPage = useCallback(async () => {
    if (isCharacterView || !hasNextPage || isFetchingNextPage) return;
    await fetchNextPage();
  }, [fetchNextPage, hasNextPage, isCharacterView, isFetchingNextPage]);

  /** 上传素材：presign 获取预签名 URL → PUT 直传对象存储 → complete 登记 */
  const handleUpload = useCallback(() => {
    if (uploading) return;
    fileInputRef.current?.click();
  }, [uploading]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || uploading) return;
    const list = Array.from(files);
    // 先清空 input 以支持重复上传同一文件
    if (fileInputRef.current) fileInputRef.current.value = '';

    // 虚拟人分组详情视图：走素材库 API（支持图片+视频）
    if (isCharacterView && characterDetailGroupId) {
      setUploading(true);
      const errors: string[] = [];

      for (const file of list) {
        // 支持图片和视频
        let assetType: 'Image' | 'Video' | 'Audio';
        if (file.type.startsWith('image/')) assetType = 'Image';
        else if (file.type.startsWith('video/')) assetType = 'Video';
        else {
          errors.push(`${file.name}：仅支持图片和视频`);
          continue;
        }
        try {
          // Step 1: 上传到 Asset 管道拿公网 URL
          const uploadResult = await uploadAssetFile(file);
          // Step 2: 调用素材库 CreateAsset（名称限 30 字，超限截断）
          const rawName = file.name;
          const finalName = rawName.length > 30 ? rawName.slice(0, 30) : rawName;
          if (rawName.length > 30) toast('当前上传素材名称过长，已截取', { style: { textAlign: 'center' } });
          await createMaterialAsset({
            GroupId: characterDetailGroupId,
            URL: uploadResult.url,
            Name: finalName,
            AssetType: assetType,
          });
        } catch (err) {
          // API 错误已由请求层统一 toast，这里只收集本地校验类错误
          if (!isApiError(err)) errors.push(`上传失败：${file.name}`);
        }
      }

      if (errors.length) toast.error(errors.join('；'));
      setUploading(false);
      // 触发 CharacterLibrary 刷新
      setCharacterRefreshTick((t) => t + 1);
      return;
    }

    // 普通资产视图（图片/视频/音频）
    setUploading(true);
    const errors: string[] = [];
    let assetListChanged = false;

    for (const file of list) {
      // 虚拟人视图下，上传类型固定为 character
      const forceCharacter = activeFilter === 'character';
      const type: AssetType = forceCharacter ? 'character' : (fileToAssetType(file) as AssetType);

      if (!type) {
        errors.push(`不支持的文件类型：${file.name}`);
        continue;
      }
      // tab 筛选下的类型约束：选中特定 tab 时只允许对应类型（同时校验 MIME 和扩展名）
      if (!forceCharacter && activeFilter !== 'all' && activeFilter !== type) {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        errors.push(`${file.name}：当前「${filterTabs.find((t) => t.key === activeFilter)?.label}」tab 不支持 .${ext || '?'} 格式`);
        continue;
      }
      const limitMb = Math.round(UPLOAD_SIZE_LIMIT[type] / 1024 / 1024);
      if (file.size > UPLOAD_SIZE_LIMIT[type]) {
        errors.push(`${file.name} 超过 ${limitMb}MB 上限`);
        continue;
      }
      // 虚拟人视图只接受图片
      if (forceCharacter && !file.type.startsWith('image/')) {
        errors.push(`${file.name}：虚拟人仅支持上传图片`);
        continue;
      }
      try {
        // 三步上传：presign → PUT → complete
        const presign = await fetchUploadPresign({ type, mime: file.type, size: file.size });
        await putToPresignedUrl(presign, file);
        await completeUpload({
          type,
          mime: file.type,
          size: file.size,
          storage_key: presign.storage_key,
          ...(forceCharacter ? {} : {}),
        });
        // 上传会改变“全部”和对应类型缓存；本轮批量上传结束后统一失效并刷新。
        assetListChanged = true;
      } catch (err) {
        // API 错误已由请求层统一 toast，这里只收集本地校验类错误
        if (!isApiError(err)) errors.push(`上传失败：${file.name}`);
      }
    }

    if (assetListChanged) {
      await queryClient.invalidateQueries({ queryKey: assetKeys.all });
      // 新资产插在首位，会改变所有 index；重建 positioner 避免旧布局缓存错位。
      setLayoutVersion((version) => version + 1);
    }
    if (errors.length) toast.error(errors.join('；'));
    setUploading(false);
  };

  const assetItems = useMemo<AssetGridItem[]>(
    () => assets.map((asset) => ({ kind: 'asset' as const, asset })),
    [assets],
  );
  const gridItems = useMemo<AssetGridItem[]>(
    () => activeFilter === 'all' ? assetItems : [{ kind: 'upload' }, ...assetItems],
    [activeFilter, assetItems],
  );
  const totalGridItems = assetTotal + (activeFilter === 'all' ? 0 : 1);

  /** 确认删除：删除成功后失效素材列表缓存并刷新当前筛选。 */
  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await deleteAsset(deleteTarget.id);
      await queryClient.invalidateQueries({ queryKey: assetKeys.all });
      // 删除会缩短数组，必须重建 Masonic 缓存，避免保留已删除 index 的定位信息。
      setLayoutVersion((version) => version + 1);
      setDeleteTarget(null);
    } catch (e) {
      // API 错误已由请求层统一 toast，这里兜底非 API 错误（如网络中断）
      if (!isApiError(e)) toast.error('删除失败，请稍后重试');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div ref={pageRef} className={styles.page}>
      <div className={styles.container}>
        {/* 顶部标题栏：虚拟人像库详情视图下隐藏 */}
        {!(isCharacterView && characterDetailGroupId) && (
        <div className={styles.header}>
          <h1 className={styles.pageTitle}>资产库</h1>
          <div className={styles.headerActions}>
            {/* 筛选按钮 */}
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

        {/* 隐藏的文件上传 input：始终渲染，详情视图也能触发 */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={(() => {
            if (isCharacterView && characterDetailGroupId) return '.jpg,.jpeg,.png,.webp,.mp4,.mov,.webm';
            if (activeFilter === 'image') return '.jpg,.jpeg,.png,.gif,.webp,.svg,.bmp';
            if (activeFilter === 'video') return '.mp4,.webm,.mov,.avi,.mkv';
            if (activeFilter === 'audio') return '.mp3,.wav,.ogg,.m4a,.aac,.flac';
            return '.jpg,.jpeg,.png,.gif,.webp,.svg,.bmp,.mp4,.webm,.mov,.avi,.mkv,.mp3,.wav,.ogg,.m4a,.aac,.flac';
          })()}
          className={styles.hiddenInput}
          onChange={handleFileChange}
        />

        {/* 虚拟人视图：独立的分组 + 素材管理 */}
        {isCharacterView ? (
          <CharacterLibrary
            refreshTick={characterRefreshTick}
            onDetailViewChange={(inDetail, groupId) => setCharacterDetailGroupId(inDetail ? groupId : null)}
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
            {!loading && gridItems.length > 0 && (
              <AssetMasonry
                key={`${activeFilter}:${layoutVersion}`}
                items={gridItems}
                totalItems={hasMore ? totalGridItems : gridItems.length}
                onLoadMore={loadNextPage}
                scrollContainerRef={pageRef}
                onUpload={handleUpload}
                onPreview={setPreviewTarget}
                onDelete={setDeleteTarget}
                gutter={2}
                libraryMode
              />
            )}
            {!loading && gridItems.length === 0 && (
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

      <AssetDetailModal asset={previewTarget} onClose={() => setPreviewTarget(null)} />

      {/* 删除确认弹窗 */}
      <ConfirmModal
        open={!!deleteTarget}
        title="删除资产"
        message={
          deleteTarget
            ? `确定要删除该${typeLabel[deleteTarget.type]}资产吗？此操作不可撤销。`
            : ''
        }
        confirmText="确认删除"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
