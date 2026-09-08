/* ============================================
 * CharacterLibraryModal 角色库弹窗
 * 对接素材库 API（POST /api/material/{Action}）
 * 与 SharedAssetsModal 同尺寸（1000×680）
 * Tab: 虚拟人像库（AIGC）/ 真人人像库（LivenessFace），统一多选（真人人像库仅视频入口显示）
 * 弹窗仅做分组/素材展示与选中使用，分组/素材管理归资产页
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
} from 'lucide-react';
import {
  listAssetGroups,
  listAssets,
  type MaterialGroup,
  type MaterialAsset,
  type GroupType,
} from '@/api/material';
import { isApiError } from '@/api/http';
import { toast } from 'sonner';
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
}

/* ============================================
 * 分组卡片（仅展示与点击查看，管理操作归资产页）
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

/* ============================================
 * 分组详情视图（多选素材，仅展示与选择）
 * 分组/素材管理（新建、重命名、删除、上传）归资产页，弹窗内不提供
 * 选中状态由父组件持有（虚拟/真人跨 tab 累加），本组件仅展示与切换
 * ============================================ */
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
        src={src}
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
  /** 素材是否可被选择：仅 Active 且类型为图片/视频 */
  const isSelectable = (asset: MaterialAsset) =>
    asset.Status === 'Active' && (asset.AssetType === 'Image' || asset.AssetType === 'Video');

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
        <div className={styles.assetGrid}>
          {assets.map((asset) => {
            const selectable = isSelectable(asset);
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
                        <video src={asset.URL} muted playsInline preload="metadata" />
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
      )}
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

export default function CharacterLibraryModal({ onClose, onSelectAssets, enableRealPersonTab }: CharacterLibraryModalProps) {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['key']>('character');
  const [groups, setGroups] = useState<MaterialGroup[]>([]);
  const [groupAssets, setGroupAssets] = useState<Map<string, MaterialAsset[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [detailGroupId, setDetailGroupId] = useState<string | null>(null);

  const isRealTab = activeTab === 'real';
  const groupType: GroupType = isRealTab ? 'LivenessFace' : 'AIGC';

  /** 仅加载分组列表；素材统一进入分组详情后再加载（与资产页一致的懒加载） */
  const loadGroups = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const result = await listAssetGroups({
        Filter: { GroupType: groupType },
        PageNumber: 1,
        PageSize: 100,
      });
      setGroups(result.Items);
      setGroupAssets(new Map());
    } catch (err) {
      // API 错误已由请求层统一 toast
      if (!isApiError(err)) toast.error('加载失败');
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [groupType]);

  // 切换 tab / 首次加载：重置详情视图并按当前 tab 的 GroupType 重新拉取
  useEffect(() => {
    loadGroups();
    setDetailGroupId(null);
  }, [loadGroups]);

  const refreshGroupAssets = useCallback(async (groupId: string) => {
    try {
      const assets = await listAssets({
        Filter: { GroupIds: [groupId], GroupType: groupType },
        PageNumber: 1,
        PageSize: 100,
      });
      setGroupAssets((prev) => new Map(prev).set(groupId, assets.Items));
    } catch (err) {
      console.warn('刷新分组素材失败:', err);
    }
  }, [groupType]);

  const handleViewGroup = useCallback((groupId: string) => {
    setDetailGroupId(groupId);
    void refreshGroupAssets(groupId);
  }, [refreshGroupAssets]);

  /**
   * 自动轮询：列表中存在 Processing 状态素材时，每 5s 刷新对应分组，
   * 直到全部 Active/Failed。CreateAsset 后素材是上游异步注册的，
   * 上传完成后必须靠轮询才能让 UI 状态从 Processing → Active/Failed。
   */
  const processingGroupIds = Array.from(groupAssets.entries())
    .filter(([, assets]) => assets.some((a) => a.Status === 'Processing'))
    .map(([groupId]) => groupId);

  useEffect(() => {
    if (processingGroupIds.length === 0) return;
    const timer = setInterval(() => {
      processingGroupIds.forEach((groupId) => refreshGroupAssets(groupId));
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processingGroupIds.join(','), refreshGroupAssets]);

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
      toast('素材处理失败，无法使用');
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

  /** 素材多选确认（虚拟/真人人像库统一入口） */
  const handleConfirmAssets = () => {
    if (selectedAssets.length === 0) return;
    onSelectAssets?.(selectedAssets);
    onClose();
  };

  const detailGroup = detailGroupId ? groups.find((g) => g.Id === detailGroupId) : null;
  const detailAssets = detailGroupId ? (groupAssets.get(detailGroupId) ?? []) : [];

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
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
          {!loading && loadError && <div className={styles.empty}>分组加载失败，请稍后重试</div>}
          {!loading && !loadError && activeTab === 'character' && (
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
                  {/* 分组列表（仅展示与选择，分组管理归资产页） */}
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
                    <p>暂无分组</p>
                    <p>请前往资产页·人像库创建分组并上传素材</p>
                    <button
                      className={styles.emptyActionBtn}
                      onClick={() => window.open('/library?type=aigc', '_blank')}
                    >
                      去资产页·虚拟人像库
                    </button>
                  </div>
                )}
              </div>
            )
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
                  {/* 真人素材组卡片流（与虚拟人像库同款文件夹卡片，封面不取内部素材图） */}
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
