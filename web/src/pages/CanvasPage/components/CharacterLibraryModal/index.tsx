/* ============================================
 * CharacterLibraryModal 角色库弹窗
 * 对接素材库 API（POST /api/material/{Action}）
 * 与 SharedAssetsModal 同尺寸（1000×680）
 * Tab: 虚拟人像库（AIGC 平铺去分组）/ 真人人像库（LivenessFace 分组浏览）
 * 虚拟人像库单层平铺可选中，并支持弹窗内本地上传入库（REQ-D-303）；真人人像库保留分组
 * ============================================ */
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
} from '@/api/material';
import { isApiError } from '@/api/http';
import { toast } from 'sonner';
import { uploadMaterialLibraryFiles } from '../../characterLibraryUpload';
import { VIDEO_REFERENCE_NOT_APPROVED_MESSAGE } from '@/lib/video-reference-compliance';
import { resolveMediaSrc } from '@/utils/remoteImageCors';
import styles from './index.module.css';

/** Tab 定义（真人人像库 tab 仅视频入口启用，真人素材只用于视频生成） */
const TABS = [
  { key: 'character', label: '虚拟人像库', icon: User },
  { key: 'real', label: '真人人像库', icon: ScanFace },
] as const;

interface CharacterLibraryModalProps {
  onClose: () => void;
  /** 多选确认回调（虚拟/真人人像库统一多选，确认后批量返回） */
  onSelectAssets?: (assets: MaterialAsset[]) => void;
  /** 显示真人人像库 tab（真人素材仅用于视频生成，图片/资产卡入口不展示） */
  enableRealPersonTab?: boolean;
  /** 视频参考入口：未通过素材点选即拦截（IKGK37 / REQ-D-204） */
  rejectUnapprovedForVideo?: boolean;
}

/* ============================================
 * 分组卡片（仅真人人像库：展示与点击查看，管理操作归资产页）
 * ============================================ */
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
        {/* 底部信息栏（覆盖在图片上） */}
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

/** 图片缩略图卡片：加载完成后解除 1:1 占位、按真实宽高比撑开（视频/音频保持固定 1:1）。
 *  加载前保持 1:1 占位，避免图片未就绪时高度塌陷引起布局跳动。 */
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
          // 正方形图片占位即终态，无需切换，避免无谓重排
          if (naturalWidth > 0 && naturalHeight > 0 && naturalWidth !== naturalHeight) {
            setMeasured(true);
          }
        }}
      />
      {children}
    </div>
  );
}

/** 素材是否可被选择：仅 Active 且类型为图片/视频 */
function isSelectableAsset(asset: MaterialAsset) {
  return asset.Status === 'Active' && (asset.AssetType === 'Image' || asset.AssetType === 'Video');
}

/** 可多选素材网格（虚拟库平铺 / 真人分组详情共用） */
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

/* ============================================
 * 真人人像库分组详情（多选素材，仅展示与选择）
 * ============================================ */
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
        <div className={styles.empty}>该分组暂无素材，请前往资产页添加</div>
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

/** 虚拟人像库平铺列表：跨组聚合全部素材，无分组层级 */
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

/** 素材卡片上的角标/勾选浮层（与媒体类型无关，图片/视频/音频卡片共用） */
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

  /** 虚拟人像库：先查全部分组再聚合素材，展示层拍平、底层分组数据不删 */
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

  /** 真人人像库：仅加载分组列表；素材进入分组详情后再加载 */
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

  /** 虚拟库平铺：存在 Processing 素材时每 5s 刷新，直到全部 Active/Failed */
  const hasFlatProcessing = !isRealTab && flatAssets.some((a) => a.Status === 'Processing');
  useEffect(() => {
    if (!hasFlatProcessing) return;
    const timer = setInterval(() => void loadFlatAssets({ silent: true }), 5000);
    return () => clearInterval(timer);
  }, [hasFlatProcessing, loadFlatAssets]);

  /**
   * 真人人像库：列表中存在 Processing 状态素材时，每 5s 刷新对应分组，
   * 直到全部 Active/Failed。CreateAsset 后素材是上游异步注册的，
   * 上传完成后必须靠轮询才能让 UI 状态从 Processing → Active/Failed。
   */
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

  /** 素材选中集合（虚拟/真人跨 tab 累加，持有完整素材对象） */
  const [selectedMap, setSelectedMap] = useState<Map<string, MaterialAsset>>(new Map());
  const selectedIds = useMemo(() => new Set(selectedMap.keys()), [selectedMap]);
  const selectedAssets = useMemo(() => Array.from(selectedMap.values()), [selectedMap]);

  /** 切换素材选中态（含 Processing/Failed/音频拦截提示） */
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

  /** 素材多选确认（虚拟/真人人像库统一入口） */
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
        {/* 头部 */}
        <div className={styles.head}>
          <div className={styles.headLeft}>
            <span className={styles.headTitle}>角色库</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        {/* Tab 栏（真人人像库 tab 仅视频入口显示） */}
        <div className={styles.tabs}>
          {TABS.filter((tab) => tab.key !== 'real' || enableRealPersonTab).map((tab) => (
            <button
              key={tab.key}
              className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              <tab.icon size={14} strokeWidth={2} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* 内容区 */}
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
                  {/* 真人素材组卡片流（封面不取内部素材图） */}
                  {groups.map((group) => (
                    <GroupCard
                      key={group.Id}
                      group={group}
                      onView={() => handleViewGroup(group.Id)}
                    />
                  ))}
                </div>
                {groups.length === 0 && (
                  <div className={styles.emptyHint}>
                    <p>暂无真人素材</p>
                    <p>完成真人认证建档后，即可在视频生成时使用真人形象</p>
                    <button
                      className={styles.emptyActionBtn}
                      onClick={() => window.open('/library?type=liveness', '_blank')}
                    >
                      去资产页·真人人像库建档
                    </button>
                  </div>
                )}
              </div>
            )
          )}
        </div>

        {/* 弹窗级底部确认栏（虚拟/真人选择跨 tab 累加，任意视图均可确认） */}
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
