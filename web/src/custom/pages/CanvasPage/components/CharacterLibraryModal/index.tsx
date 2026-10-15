import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  User,
  FolderOpen,
  ArrowLeft,
  Check,
  Loader2,
  ScanFace,
  Music,
  Plus,
} from 'lucide-react';
import {
  listAssetGroups,
  listAssets,
  type MaterialGroup,
  type MaterialAsset,
} from '@/custom/api/material';
import { isApiError } from '@/shared/api/http';
import { toast } from '@/custom/components/Toast';
import Empty from '@/custom/components/Empty';
import Tabs from '@/custom/components/Tabs';
import { uploadMaterialLibraryFiles } from '../../characterLibraryUpload';
import { VIDEO_REFERENCE_NOT_APPROVED_MESSAGE } from '@/custom/utils/video-reference-compliance';
import { resolveMediaSrc } from '@/shared/utils/remoteImageCors';
import styles from './index.module.css';

const TABS = [
  { key: 'character', label: '虚拟人像库', icon: User },
  { key: 'real', label: '真人人像库', icon: ScanFace },
] as const;

interface CharacterLibraryModalProps {
  onClose: () => void;
  onSelectAssets?: (assets: MaterialAsset[]) => void;
  enableRealPersonTab?: boolean;
  rejectUnapprovedForVideo?: boolean;
}

function GroupCard({
  group,
  onView,
}: {
  group: MaterialGroup;
  onView: () => void;
}) {
  return (
    <div className={styles.groupCard} onClick={onView}>
      <div className={styles.groupCover}>
        <FolderOpen className={styles.folderIcon} strokeWidth={1} />
        {}
        <div className={styles.groupInfo}>
          <div className={styles.groupInfoLeft}>
            <span className={styles.groupName} title={group.Description || group.Name}>{group.Description || group.Name}</span>
            <span className={styles.groupCount}>点击查看素材</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MeasuredThumb({
  src,
  alt,
  children,
}: {
  src: string;
  alt?: string;
  children?: ReactNode;
}) {
  const [measured, setMeasured] = useState(false);
  return (
    <div className={`${styles.assetThumb} ${measured ? styles.assetThumbMeasured : ''}`}>
      <img
        src={resolveMediaSrc(src)}
        alt={alt}
        loading="lazy"
        onLoad={(e) => {
          const { naturalWidth, naturalHeight } = e.currentTarget;
          if (naturalWidth > 0 && naturalHeight > 0 && naturalWidth !== naturalHeight) {
            setMeasured(true);
          }
        }}
      />
      {children}
    </div>
  );
}

function isSelectableAsset(asset: MaterialAsset) {
  return asset.Status === 'Active' && (asset.AssetType === 'Image' || asset.AssetType === 'Video');
}

function SelectableAssetGrid({
  assets,
  selectedIds,
  onToggleAsset,
  leading,
}: {
  assets: MaterialAsset[];
  selectedIds: Set<string>;
  onToggleAsset: (asset: MaterialAsset) => void;
  leading?: ReactNode;
}) {
  return (
    <div className={styles.assetGrid}>
      {leading}
      {assets.map((asset) => {
        const selectable = isSelectableAsset(asset);
        const selectedFlag = selectedIds.has(asset.Id);
        return (
          <div
            key={asset.Id}
            className={`${styles.assetCard} ${!selectable ? styles.assetCardDisabled : ''} ${selectedFlag ? styles.assetCardSelected : ''}`}
            onClick={() => onToggleAsset(asset)}
          >
            {asset.URL && asset.AssetType === 'Image' ? (
              <MeasuredThumb src={asset.URL} alt={asset.Name}>
                <AssetCardOverlays asset={asset} selectable={selectable} selectedFlag={selectedFlag} />
              </MeasuredThumb>
            ) : (
              <div className={styles.assetThumb}>
                {asset.URL ? (
                  asset.AssetType === 'Video' ? (
                    <video src={resolveMediaSrc(asset.URL)} muted playsInline preload="metadata" />
                  ) : asset.AssetType === 'Audio' ? (
                    <div className={styles.audioPlaceholder}>
                      <Music size={28} strokeWidth={1.5} />
                    </div>
                  ) : null
                ) : (
                  <div className={styles.empty}>资源不可用</div>
                )}
                <AssetCardOverlays asset={asset} selectable={selectable} selectedFlag={selectedFlag} />
              </div>
            )}
            <div className={styles.assetName} title={asset.Name}>
              {asset.Name}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GroupDetail({
  group,
  assets,
  selectedIds,
  onToggleAsset,
  onBack,
}: {
  group: MaterialGroup;
  assets: MaterialAsset[];
  selectedIds: Set<string>;
  onToggleAsset: (asset: MaterialAsset) => void;
  onBack: () => void;
}) {
  return (
    <div className={styles.detailView}>
      <div className={styles.detailHeader}>
        <button className={styles.backBtn} onClick={onBack}>
          <ArrowLeft size={16} /> 返回
        </button>
        <span className={styles.detailTitle}>{group.Description || group.Name}</span>
      </div>

      {assets.length === 0 ? (
        <Empty className={styles.empty} title="该分组暂无素材，请前往资产页添加" />
      ) : (
        <SelectableAssetGrid
          assets={assets}
          selectedIds={selectedIds}
          onToggleAsset={onToggleAsset}
        />
      )}
    </div>
  );
}

function AigcFlatSelectView({
  assets,
  selectedIds,
  onToggleAsset,
  onPickFiles,
  uploading,
}: {
  assets: MaterialAsset[];
  selectedIds: Set<string>;
  onToggleAsset: (asset: MaterialAsset) => void;
  onPickFiles: (files: File[]) => void;
  uploading: boolean;
}) {
  return (
    <div className={styles.detailView}>
      <SelectableAssetGrid
        assets={assets}
        selectedIds={selectedIds}
        onToggleAsset={onToggleAsset}
        leading={(
          <label
            className={`${styles.assetCard} ${styles.uploadAssetCard}`}
            aria-label="上传素材"
            aria-disabled={uploading}
          >
            <input
              type="file"
              accept="image/*,video/*"
              multiple
              disabled={uploading}
              className={styles.nativeFileInput}
              onChange={(e) => {
                if (uploading) return;
                const files = e.target.files;
                if (!files || files.length === 0) return;
                onPickFiles(Array.from(files));
                e.target.value = '';
              }}
            />
            <div className={`${styles.assetThumb} ${styles.uploadThumb}`}>
              {uploading ? <Loader2 size={28} className={styles.spin} /> : <Plus size={28} strokeWidth={1.5} />}
              <span className={styles.uploadCardLabel}>{uploading ? '上传中…' : '上传素材'}</span>
            </div>
          </label>
        )}
      />
    </div>
  );
}

function AssetCardOverlays({
  asset,
  selectable,
  selectedFlag,
}: {
  asset: MaterialAsset;
  selectable: boolean;
  selectedFlag: boolean;
}) {
  return (
    <>
      <div className={`${styles.assetTypeBadge} ${selectable ? styles.assetTypeBadgeShifted : ''}`}>
        {asset.AssetType === 'Video' ? '视频' : asset.AssetType === 'Audio' ? '音频' : '图片'}
      </div>
      {asset.Status === 'Processing' && <div className={styles.statusBadge}>处理中</div>}
      {asset.Status === 'Failed' && (
        <div className={`${styles.statusBadge} ${styles.statusFailed}`}>失败</div>
      )}
      {selectable && (
        <div className={`${styles.checkToggle} ${selectedFlag ? styles.checkToggleOn : ''}`}>
          {selectedFlag && <Check size={14} strokeWidth={2.5} />}
        </div>
      )}
    </>
  );
}

export default function CharacterLibraryModal({ onClose, onSelectAssets, enableRealPersonTab, rejectUnapprovedForVideo }: CharacterLibraryModalProps) {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['key']>('character');
  const [groups, setGroups] = useState<MaterialGroup[]>([]);
  const [groupAssets, setGroupAssets] = useState<Map<string, MaterialAsset[]>>(new Map());
  const [flatAssets, setFlatAssets] = useState<MaterialAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [detailGroupId, setDetailGroupId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const isRealTab = activeTab === 'real';

  const loadFlatAssets = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
      setLoadError(false);
    }
    try {
      const groupsResult = await listAssetGroups({
        Filter: { GroupType: 'AIGC' },
        PageNumber: 1,
        PageSize: 100,
      });
      const groupIds = (groupsResult.Items ?? []).map((g) => g.Id).filter(Boolean);
      if (groupIds.length === 0) {
        setFlatAssets([]);
        return;
      }
      const result = await listAssets({
        Filter: { GroupIds: groupIds, GroupType: 'AIGC' },
        PageNumber: 1,
        PageSize: 100,
      });
      setFlatAssets(result.Items);
    } catch (err) {
      if (opts?.silent) return;
      if (!isApiError(err)) toast.error('加载失败');
      setLoadError(true);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const result = await listAssetGroups({
        Filter: { GroupType: 'LivenessFace' },
        PageNumber: 1,
        PageSize: 100,
      });
      setGroups(result.Items);
      setGroupAssets(new Map());
    } catch (err) {
      if (!isApiError(err)) toast.error('加载失败');
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setDetailGroupId(null);
    if (isRealTab) {
      void loadGroups();
      return;
    }
    void loadFlatAssets();
  }, [isRealTab, loadGroups, loadFlatAssets]);

  const refreshGroupAssets = useCallback(async (groupId: string) => {
    try {
      const assets = await listAssets({
        Filter: { GroupIds: [groupId], GroupType: 'LivenessFace' },
        PageNumber: 1,
        PageSize: 100,
      });
      setGroupAssets((prev) => new Map(prev).set(groupId, assets.Items));
    } catch (err) {
      console.warn('刷新分组素材失败:', err);
    }
  }, []);

  const handleViewGroup = useCallback((groupId: string) => {
    setDetailGroupId(groupId);
    void refreshGroupAssets(groupId);
  }, [refreshGroupAssets]);

  const hasFlatProcessing = !isRealTab && flatAssets.some((a) => a.Status === 'Processing');
  useEffect(() => {
    if (!hasFlatProcessing) return;
    const timer = setInterval(() => void loadFlatAssets({ silent: true }), 5000);
    return () => clearInterval(timer);
  }, [hasFlatProcessing, loadFlatAssets]);

  const processingGroupIds = Array.from(groupAssets.entries())
    .filter(([, assets]) => assets.some((a) => a.Status === 'Processing'))
    .map(([groupId]) => groupId);

  useEffect(() => {
    if (!isRealTab || processingGroupIds.length === 0) return;
    const timer = setInterval(() => {
      processingGroupIds.forEach((groupId) => refreshGroupAssets(groupId));
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRealTab, processingGroupIds.join(','), refreshGroupAssets]);

  const [selectedMap, setSelectedMap] = useState<Map<string, MaterialAsset>>(new Map());
  const selectedIds = useMemo(() => new Set(selectedMap.keys()), [selectedMap]);
  const selectedAssets = useMemo(() => Array.from(selectedMap.values()), [selectedMap]);

  const handleToggleAsset = (asset: MaterialAsset) => {
    if (asset.Status === 'Processing') {
      toast('素材处理中，稍后可用');
      return;
    }
    if (asset.Status === 'Failed') {
      toast(rejectUnapprovedForVideo ? VIDEO_REFERENCE_NOT_APPROVED_MESSAGE : '素材处理失败，无法使用');
      return;
    }
    if (asset.AssetType === 'Audio') {
      toast('音频素材暂不支持选择');
      return;
    }
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (next.has(asset.Id)) next.delete(asset.Id);
      else next.set(asset.Id, asset);
      return next;
    });
  };

  const handleCharacterPickFiles = async (files: File[]) => {
    if (files.length === 0 || uploading) return;
    setUploading(true);
    const { errors, createdIds } = await uploadMaterialLibraryFiles(files, null);
    if (errors.length) toast.error(errors.join('；'));
    await loadFlatAssets({ silent: true });
    if (createdIds.length > 0) {
      const latest = await listAssets({
        Filter: { GroupType: 'AIGC' },
        PageNumber: 1,
        PageSize: 100,
      }).catch(() => null);
      const created = latest?.Items.filter((item) => createdIds.includes(item.Id)) ?? [];
      if (created.length > 0) {
        setSelectedMap((prev) => {
          const next = new Map(prev);
          for (const asset of created) next.set(asset.Id, asset);
          return next;
        });
      }
    }
    setUploading(false);
  };

  const handleConfirmAssets = () => {
    if (selectedAssets.length === 0) return;
    onSelectAssets?.(selectedAssets);
    onClose();
  };

  const detailGroup = detailGroupId ? groups.find((g) => g.Id === detailGroupId) : null;
  const detailAssets = detailGroupId ? (groupAssets.get(detailGroupId) ?? []) : [];

  return createPortal(
    <div className={styles.overlay} data-gen-panel-territory onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        {}
        <div className={styles.head}>
          <div className={styles.headLeft}>
            <span className={styles.headTitle}>角色库</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {}
        <Tabs
          className={styles.tabs}
          triggerClassName={styles.tab}
          activeTriggerClassName={styles.tabActive}
          value={activeTab}
          onChange={setActiveTab}
          items={TABS.filter((tab) => tab.key !== 'real' || enableRealPersonTab).map((tab) => ({
            key: tab.key,
            label: (
              <>
                <tab.icon size={14} strokeWidth={2} />
                {tab.label}
              </>
            ),
          }))}
        />

        {}
        <div className={styles.content}>
          {loading ? (
            <div className={styles.loadingSpinner}>
              <Loader2 size={32} className={styles.spin} />
              <span>加载中...</span>
            </div>
          ) : null}
          {!loading && loadError && <div className={styles.empty}>加载失败，请稍后重试</div>}
          {!loading && !loadError && activeTab === 'character' && (
            <AigcFlatSelectView
              assets={flatAssets}
              selectedIds={selectedIds}
              onToggleAsset={handleToggleAsset}
              onPickFiles={handleCharacterPickFiles}
              uploading={uploading}
            />
          )}
          {!loading && !loadError && activeTab === 'real' && (
            detailGroup ? (
              <GroupDetail
                group={detailGroup}
                assets={detailAssets}
                selectedIds={selectedIds}
                onToggleAsset={handleToggleAsset}
                onBack={() => setDetailGroupId(null)}
              />
            ) : (
              <div className={styles.groupListView}>
                <div className={styles.groupGrid}>
                  {}
                  {groups.map((group) => (
                    <GroupCard
                      key={group.Id}
                      group={group}
                      onView={() => handleViewGroup(group.Id)}
                    />
                  ))}
                </div>
                {groups.length === 0 && (
                  <Empty
                    className={styles.emptyHint}
                    title="暂无真人素材"
                    description="完成真人认证建档后，即可在视频生成时使用真人形象"
                    action={(
                      <button
                        className={styles.emptyActionBtn}
                        onClick={() => window.open('/library?type=liveness', '_blank')}
                      >
                        去资产页·真人人像库建档
                      </button>
                    )}
                  />
                )}
              </div>
            )
          )}
        </div>

        {}
        <div className={styles.confirmBar}>
          <span className={styles.confirmCount}>已选 {selectedAssets.length} 项</span>
          <div className={styles.confirmActions}>
            <button
              className={styles.modalCancelBtn}
              disabled={selectedAssets.length === 0}
              onClick={() => setSelectedMap(new Map())}
            >
              清空
            </button>
            <button
              className={styles.confirmPrimaryBtn}
              disabled={selectedAssets.length === 0}
              onClick={handleConfirmAssets}
            >
              确认
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
