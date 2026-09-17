/* ============================================
 * AssetsPickerModal 画布「资产库选择」弹窗
 * 工具栏加号 → 资产库选择入口：GET /api/assets 分页拉取 + tab 筛选
 * 画布工具栏 / 视频对话「从资产中选择」额外展示「真人人像库」（分组+素材，与资产页一致）
 * 视频对话「从资产中选择」还展示「虚拟人像库」（AIGC 平铺，与资产页一致；tab 顺序同资产页：虚拟在真人前）
 * 多选 + 确认：卡片点击勾选/取消，确认后批量回调落画布
 * IKGHZ3：卡片悬浮删除与放大预览（主瀑布流走 deleteAsset + 引用计数确认；
 *   人像库由 CharacterLibrary 内置删除/预览，删除后回调联动已选集合）
 * ============================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import {
  assetKeys,
  assetPageQueryOptions,
  deleteAsset,
  fetchAssetReferences,
  type AssetRecord,
  type AssetType,
} from '@/api/assets';
import { isApiError } from '@/api/http';
import {
  createAsset as createMaterialAsset,
  type MaterialAsset,
  type MaterialAssetType,
} from '@/api/material';
import { isFileRejected } from '@/utils/fileSignature';
import { uploadAssetFile } from '@/utils/upload';
import AssetMasonry from '@/pages/Assets/components/AssetMasonry';
import CharacterLibrary from '@/pages/Assets/components/CharacterLibrary';
import AssetDetailModal from '@/pages/Assets/components/AssetDetailModal';
import { appendUniqueAssets, typeLabel } from '@/pages/Assets/assetGrid';
import { usePreviewAsset } from '@/pages/Assets/previewAsset';
import assetStyles from '@/pages/Assets/index.module.css';
import Skeleton from '@/components/Skeleton';
import ConfirmModal from '@/components/ConfirmModal';
import styles from './index.module.css';

/** 媒体类型（与资产库 type 字段对齐） */
export type PickerMediaType = 'image' | 'video' | 'audio';

/** 素材库 tab 来源：真人人像库（LivenessFace 分组）/ 虚拟人像库（AIGC 平铺） */
type MaterialSource = 'liveness' | 'character';

type PickerTabKey = 'all' | PickerMediaType | 'character' | 'liveness';

/** 全量 tab：全部 / 图片 / 视频 / 音频 */
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
   * 按打开入口可接受的媒体类型过滤：
   * - 不传：全类型 + 默认「全部」tab（画布工具栏现状）
   * - 单类型：隐藏 tab 栏（若同时展示真人库则仍显示 tab），直接按该类型拉取
   * - 多类型：仅展示允许的类型 tab（含「全部」），默认「全部」
   */
  mediaTypes?: PickerMediaType[];
  /** 确认按钮文案（默认「插入画布」，首页/dock 参考入口可传「确定」等） */
  confirmText?: string;
  /** 是否展示「真人人像库」tab（仅画布工具栏、视频对话「从资产中选择」） */
  showLivenessTab?: boolean;
  /** 是否展示「虚拟人像库」tab（仅视频对话「从资产中选择」；画布工具栏入口不展示） */
  showCharacterTab?: boolean;
}

function materialTypeToAssetType(assetType: MaterialAssetType): AssetType {
  if (assetType === 'Video') return 'video';
  if (assetType === 'Audio') return 'audio';
  return 'image';
}

/** 素材库条目转资产选择弹窗记录：id 保留 Asset- 前缀，提交走 material_id；source 纯标记（真人/虚拟来源） */
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
  };
}

export default function AssetsPickerModal({
  onClose,
  onSelect,
  mediaTypes,
  confirmText = '插入画布',
  showLivenessTab = false,
  showCharacterTab = false,
}: AssetsPickerModalProps) {
  /** 可展示的 tab：按入口可接受类型过滤；单类型时只剩一个 tab（渲染层隐藏 tab 栏，除非带人像库） */
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
    // 人像库 tab 顺序与资产页一致：虚拟人像库在真人人像库之前
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
  /** 素材库 tab（真人/虚拟人像库）：不走 /api/assets 分页查询 */
  const isMaterialTab = isLivenessTab || isCharacterTab;
  /** 已勾选资产记录（id → record，跨 tab 保留：tab 仅是筛选视图，确认时统一提交） */
  const [selectedMap, setSelectedMap] = useState<ReadonlyMap<string, AssetRecord>>(() => new Map());
  const queryClient = useQueryClient();
  /** IKGHZ3 就地移除：本次会话已删除资产（id → type，渲染时按 id 过滤；
   *  total 扣减按 tab 匹配类型，避免「全部」tab 的删除把图片/视频等类型 tab 的
   *  服务端总数一并扣掉、无限加载器提前停止触底加载） */
  const [removedAssets, setRemovedAssets] = useState<ReadonlyMap<string, AssetType>>(() => new Map());
  /** 删除发生标记（ref）：弹窗卸载时据此失效共享查询缓存，防资产页短暂显示已删幽灵卡 */
  const removedCountRef = useRef(0);
  /** 主瀑布流删除确认目标 + 引用数查询结果（带目标 ID，切换目标时不展示旧值；count null = 查询失败） */
  const [deleteTarget, setDeleteTarget] = useState<AssetRecord | null>(null);
  const [refCount, setRefCount] = useState<{ id: string; count: number | null } | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** 主瀑布流放大预览目标（详情补拉走 usePreviewAsset，与资产页同款详情弹窗） */
  const [previewTarget, setPreviewTarget] = useState<AssetRecord | null>(null);
  /** 人像库预览弹窗开关（CharacterLibrary 上抛；抑制弹窗自身 Esc） */
  const [materialPreviewOpen, setMaterialPreviewOpen] = useState(false);
  const previewAsset = usePreviewAsset(previewTarget);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const characterFileInputRef = useRef<HTMLInputElement>(null);
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
    // 弹窗与资产页共用查询缓存（key 含 size=30）：覆盖全局 staleTime，
    // 保证每次打开弹窗都重新请求当前 tab 的素材列表（默认 tab 为全部）
    staleTime: 0,
    enabled: !isMaterialTab,
  });

  const assetPages = assetData?.pages;
  const assets = useMemo(
    () => appendUniqueAssets([], assetPages?.flatMap((page) => page.records) ?? []),
    [assetPages],
  );
  /** 「全部」tab 会拉取全类型：按入口允许类型过滤（如仅图片入口不出现音频/视频卡片，避免勾选后被静默丢弃）；
   *  已删除资产就地剔除（IKGHZ3：不整列重新拉取，滚动位置与其他卡片布局保持不动） */
  const localVisibleAssets = useMemo(
    () =>
      assets.filter((a): a is (typeof assets)[number] =>
        !removedAssets.has(String(a.id))
        && (!mediaTypes || mediaTypes.length === 0
          || (mediaTypes as string[]).includes(a.type))),
    [assets, mediaTypes, removedAssets],
  );
  const visibleAssets = localVisibleAssets;
  /** 删除会缩短数组：总数同步扣减（「全部」tab 扣全部删除、类型 tab 只扣同类型），避免无限加载器按旧 total 反复触发 loadMore */
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

  const handleLivenessDetailViewChange = useCallback((inDetail: boolean, groupId: string | null) => {
    setLivenessGroupId(inDetail ? groupId : null);
  }, []);

  const handleLivenessUpload = useCallback(() => {
    if (uploading) return;
    if (!livenessGroupId) {
      toast.error('请先进入分组再上传');
      return;
    }
    fileInputRef.current?.click();
  }, [livenessGroupId, uploading]);

  /** 虚拟库上传无分组前提，直接唤起文件选择 */
  const handleCharacterUpload = useCallback(() => {
    if (uploading) return;
    characterFileInputRef.current?.click();
  }, [uploading]);

  /** 素材库上传核心：uploadAssetFile → createMaterialAsset（名称 30 字截断，仅图片/视频）；返回错误文案列表 */
  const uploadMaterialFiles = useCallback(async (files: File[], groupId: string | null): Promise<string[]> => {
    const errors: string[] = [];
    for (const file of files) {
      let assetKind: 'Image' | 'Video' | 'Audio';
      if (file.type.startsWith('image/')) assetKind = 'Image';
      else if (file.type.startsWith('video/')) assetKind = 'Video';
      else {
        errors.push(`${file.name}：仅支持图片和视频`);
        continue;
      }
      try {
        const uploadResult = await uploadAssetFile(file);
        const rawName = file.name;
        const finalName = rawName.length > 30 ? rawName.slice(0, 30) : rawName;
        if (rawName.length > 30) toast('当前上传素材名称过长，已截取', { style: { textAlign: 'center' } });
        await createMaterialAsset({
          // 真人库落入当前详情分组；虚拟库不传分组，后端自动归组（资产页同款口径）
          ...(groupId ? { GroupId: groupId } : {}),
          URL: uploadResult.url,
          Name: finalName,
          AssetType: assetKind,
          SourceAssetId: String(uploadResult.asset_id),
        });
      } catch (err) {
        if (isFileRejected(err)) errors.push(err.message);
        else if (!isApiError(err)) errors.push(`上传失败：${file.name}`);
      }
    }
    return errors;
  }, []);

  /** 真人库上传：须先进分组（上传目标 = 当前详情分组） */
  const handleLivenessFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || uploading) return;
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!livenessGroupId) {
      toast.error('请先进入分组再上传');
      return;
    }

    setUploading(true);
    const errors = await uploadMaterialFiles(Array.from(files), livenessGroupId);
    if (errors.length) toast.error(errors.join('；'));
    setUploading(false);
    setLivenessRefreshTick((tick) => tick + 1);
  };

  /** 虚拟库上传：不传分组，后端自动归组 */
  const handleCharacterFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || uploading) return;
    if (characterFileInputRef.current) characterFileInputRef.current.value = '';

    setUploading(true);
    const errors = await uploadMaterialFiles(Array.from(files), null);
    if (errors.length) toast.error(errors.join('；'));
    setUploading(false);
    setCharacterRefreshTick((tick) => tick + 1);
  };

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

  /** 素材库条目勾选：转弹窗记录（保留来源标记），入口类型不符直接忽略 */
  const handleToggleMaterialAsset = useCallback((asset: MaterialAsset, source: MaterialSource) => {
    const record = materialToPickerRecord(asset, source);
    if (mediaTypes && mediaTypes.length > 0 && !mediaTypes.includes(record.type as PickerMediaType)) {
      return;
    }
    handleToggleSelect(record);
  }, [handleToggleSelect, mediaTypes]);

  const handleToggleLivenessAsset = useCallback(
    (asset: MaterialAsset) => handleToggleMaterialAsset(asset, 'liveness'),
    [handleToggleMaterialAsset],
  );

  const handleToggleCharacterAsset = useCallback(
    (asset: MaterialAsset) => handleToggleMaterialAsset(asset, 'character'),
    [handleToggleMaterialAsset],
  );

  /** 打开删除确认弹窗时拉取该素材被多少项目引用（与资产页同款 IKCZAT 口径）；失败降级为普通文案。 */
  useEffect(() => {
    if (!deleteTarget) return undefined;
    let cancelled = false;
    const targetId = String(deleteTarget.id);
    fetchAssetReferences(deleteTarget.id)
      .then((data) => {
        if (!cancelled) setRefCount({ id: targetId, count: data.projectCount });
      })
      .catch(() => {
        // silent 请求失败不阻断删除流程，兜底为普通文案
        if (!cancelled) setRefCount({ id: targetId, count: null });
      });
    return () => {
      cancelled = true;
    };
  }, [deleteTarget]);

  /**
   * 当前删除目标的引用数查询状态（渲染时派生 loading）：
   * - 'loading'：弹窗已开、结果未回
   * - 'done'：结果已回（count null 表示查询失败）
   */
  const currentRefCount: { loading: boolean; count: number | null } = deleteTarget
    ? refCount?.id === String(deleteTarget.id)
      ? { loading: false, count: refCount.count }
      : { loading: true, count: null }
    : { loading: false, count: null };

  /** 确认删除主瀑布流资产：成功后就地剔除 + 已勾选同步移除（IKGHZ3，不整列刷新）。 */
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
      // API 错误已由请求层统一 toast；这里兜底非 API 错误（如网络中断）
      if (!isApiError(e)) toast.error('删除失败，请稍后重试');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, deleting]);

  /** 本次会话发生过删除：弹窗卸载（关闭）时失效与资产页共享的查询缓存，
   *  防止资产页短暂显示已删幽灵卡；弹窗打开期间不失效，保住「就地移除不刷新」。 */
  useEffect(() => () => {
    if (removedCountRef.current > 0) queryClient.invalidateQueries({ queryKey: assetKeys.all });
  }, [queryClient]);

  /** 人像库素材删除成功（组件内已就地移除）：同步从已选集合剔除并更新计数（IKGHZ3 故事8）。 */
  const handleMaterialAssetRemoved = useCallback((assetId: string) => {
    setSelectedMap((prev) => {
      if (!prev.has(assetId)) return prev;
      const next = new Map(prev);
      next.delete(assetId);
      return next;
    });
  }, []);

  /** Esc 关闭：任一预览弹窗打开期间不关闭选择弹窗（预览自身的 Esc/关闭先落，IKGHZ3 故事11） */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !previewTarget && !materialPreviewOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, previewTarget, materialPreviewOpen]);

  /** 切换 tab 时回到顶部（勾选保留） */
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
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm"
                className={styles.hiddenInput}
                onChange={handleLivenessFileChange}
              />
              <CharacterLibrary
                groupType="LivenessFace"
                refreshTick={livenessRefreshTick}
                onDetailViewChange={handleLivenessDetailViewChange}
                onUpload={handleLivenessUpload}
                pickerSelectedIds={selectedIds}
                onPickerToggleAsset={handleToggleLivenessAsset}
                pickerMediaTypes={mediaTypes}
                onPickerAssetRemoved={handleMaterialAssetRemoved}
                onPickerPreviewChange={setMaterialPreviewOpen}
              />
            </>
          )}
          {isCharacterTab && (
            <>
              <input
                ref={characterFileInputRef}
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm"
                className={styles.hiddenInput}
                onChange={handleCharacterFileChange}
              />
              <CharacterLibrary
                groupType="AIGC"
                refreshTick={characterRefreshTick}
                onUpload={handleCharacterUpload}
                pickerSelectedIds={selectedIds}
                onPickerToggleAsset={handleToggleCharacterAsset}
                pickerMediaTypes={mediaTypes}
                onPickerAssetRemoved={handleMaterialAssetRemoved}
                onPickerPreviewChange={setMaterialPreviewOpen}
              />
            </>
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

        {/* 底部操作栏：取消 + 确认（展示已选数量，未勾选时禁用） */}
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
              onClick={() => onSelect(selectedAssets)}
            >
              {confirmText}{selectedAssets.length > 0 ? `（${selectedAssets.length}）` : ''}
            </button>
          </div>
        </div>
      </div>

      {/* 主瀑布流放大预览（IKGHZ3）：与资产页同款详情弹窗，只读查看，关闭后勾选状态不变 */}
      <AssetDetailModal
        asset={previewAsset}
        onClose={() => setPreviewTarget(null)}
      />

      {/* 主瀑布流删除确认（IKGHZ3）：引用数查询中显示加载提示，返回后展示关联项目数，失败兜底普通文案（同资产页 IKCZAT） */}
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
