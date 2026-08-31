/* ============================================
 * CharacterLibrary 虚拟人库（资产库页面）
 * 对接素材库 API（POST /api/material/{Action}）
 * 分组管理 + 素材上传 + 素材展示
 * 上传流程：uploadAssetFile（3 步）→ 拿公网 URL → createAsset
 * ============================================ */
import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { Plus, FolderOpen, Trash2, ArrowLeft, X, Loader2, Video } from 'lucide-react';
import {
  createAssetGroup,
  listAssetGroups,
  deleteAssetGroup,
  listAssets,
  deleteAsset as deleteMaterialAsset,
  type MaterialGroup,
  type MaterialAsset,
  type GroupType,
} from '@/api/material';
import { isApiError } from '@/api/http';
import ConfirmModal from '@/components/ConfirmModal';
import styles from './index.module.css';

/* ============================================
 * 分组卡片
 * ============================================ */
function GroupCard({
  group,
  onView,
  onDelete,
}: {
  group: MaterialGroup;
  onView: () => void;
  onDelete: () => void;
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
        {/* 右下角删除按钮：直接点击触发删除确认 */}
        <button
          className={styles.groupDeleteBtn}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="删除"
        >
          <Trash2 size={14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

/* ============================================
 * 新建分组弹窗 / 修改描述弹窗
 * ============================================ */
function GroupFormModal({
  title,
  initialText,
  placeholder,
  onConfirm,
  onCancel,
}: {
  title: string;
  initialText?: string;
  placeholder?: string;
  onConfirm: (text: string) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialText || '');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(text);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') handleConfirm();
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className={styles.modalTitle}>{title}</div>
        <input
          ref={inputRef}
          className={styles.modalInput}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder || '请输入内容'}
          maxLength={200}
        />
        <div className={styles.modalActions}>
          <button className={styles.modalCancelBtn} onClick={onCancel} disabled={submitting}>取消</button>
          <button className={styles.modalConfirmBtn} onClick={handleConfirm} disabled={submitting}>
            {submitting ? '处理中...' : '确定'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================
 * 素材详情弹窗：样式对齐 AssetDetailModal（左媒体 + 右信息）
 * ============================================ */
function MaterialDetailModal({ asset, onClose }: { asset: MaterialAsset | null; onClose: () => void }) {
  if (!asset) return null;

  return createPortal(
    <div className={styles.detailOverlay} onClick={onClose}>
      <div className={styles.detailLayout} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {/* 左侧：媒体预览 */}
        <div className={styles.detailPreviewPane}>
          {asset.URL ? (
            asset.AssetType === 'Video' ? (
              <video className={styles.detailMedia} src={asset.URL} controls autoPlay playsInline />
            ) : (
              <img className={styles.detailMedia} src={asset.URL} alt={asset.Name} draggable={false} />
            )
          ) : (
            <div className={styles.detailEmpty}>媒体文件不可用</div>
          )}
        </div>

        {/* 右侧：信息面板 */}
        <aside className={styles.detailPane}>
          <div className={styles.detailHeader}>
            <span className={styles.detailTypeBadge}>
              {asset.AssetType === 'Video' ? '视频' : '图片'}
            </span>
            <button className={styles.detailCloseBtn} type="button" onClick={onClose} aria-label="关闭">
              <X size={18} strokeWidth={2} />
            </button>
          </div>
          <dl className={styles.detailList}>
            <div className={styles.detailItem}>
              <dt>名称</dt>
              <dd title={asset.Name}>{asset.Name}</dd>
            </div>
            <div className={styles.detailItem}>
              <dt>创建时间</dt>
              <dd>{asset.CreateTime || '暂无数据'}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>,
    document.body
  );
}

/* ============================================
 * 分组详情视图
 * ============================================ */
function GroupDetail({
  group,
  assets,
  onBack,
  onDeleteAsset,
  onUpload,
}: {
  group: MaterialGroup;
  assets: MaterialAsset[];
  onBack: () => void;
  onDeleteAsset: (asset: MaterialAsset) => void;
  onUpload?: () => void;
}) {
  const [previewAsset, setPreviewAsset] = useState<MaterialAsset | null>(null);
  const closePreview = () => setPreviewAsset(null);

  return (
    <div className={styles.detailView}>
      <div className={styles.detailHeader}>
        <button className={styles.backBtn} onClick={onBack}>
          <ArrowLeft size={16} /> 返回
        </button>
        <span className={styles.detailTitle}>{group.Description || group.Name}</span>
      </div>

      <div className={styles.assetGrid}>
        {/* 第一个位置：上传素材卡片 */}
        {onUpload && (
          <div className={styles.assetCard} onClick={onUpload} role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') onUpload(); }}>
            <div className={`${styles.assetThumb} ${styles.uploadThumb}`}>
              <Plus size={28} strokeWidth={1.5} />
              <span className={styles.uploadCardLabel}>上传素材</span>
            </div>
          </div>
        )}
        {assets.map((asset) => (
          <div key={asset.Id} className={styles.assetCard}
            onClick={() => setPreviewAsset(asset)}>
            <div className={styles.assetThumb}>
              {asset.URL ? (
                asset.AssetType === 'Video' ? (
                  <>
                    <video src={asset.URL} muted playsInline preload="metadata" />
                  </>
                ) : (
                  <img src={asset.URL} alt={asset.Name} loading="lazy" />
                )
              ) : (
                <div className={styles.empty}>资源不可用</div>
              )}
              <div className={styles.assetTypeBadge}>
                {asset.AssetType === 'Video' ? <Video size={14} /> : null}
                {asset.AssetType === 'Video' ? '视频' : '图片'}
              </div>
              {/* 底部名称浮层 */}
              <div className={styles.assetNameOverlay}>
                <span className={styles.assetName} title={asset.Name}>{asset.Name}</span>
              </div>
              {asset.Status === 'Processing' && (
                <div className={styles.statusBadge}>处理中</div>
              )}
              {asset.Status === 'Failed' && (
                <div className={`${styles.statusBadge} ${styles.statusFailed}`}>失败</div>
              )}
              <button
                className={styles.assetDeleteBtn}
                title="删除素材"
                onClick={(e) => {
                  e.stopPropagation();
                  setPreviewAsset(null); // 关闭预览弹窗，避免层级冲突
                  onDeleteAsset(asset);
                }}
              >
                <Trash2 size={14} strokeWidth={2} />
              </button>
            </div>
          </div>
        ))}
        {!onUpload && assets.length === 0 && (
          <div className={styles.empty}>该分组暂无素材</div>
        )}
      </div>

      {previewAsset && (
        <MaterialDetailModal asset={previewAsset} onClose={closePreview} />
      )}
    </div>
  );
}

/* ============================================
 * 主组件：虚拟人库（资产库页面）
 * ============================================ */
export default function CharacterLibrary({ onDetailViewChange, onUpload, refreshTick }: { onDetailViewChange?: (inDetail: boolean, groupId: string | null) => void; onUpload?: () => void; refreshTick?: number }) {
  const [groups, setGroups] = useState<MaterialGroup[]>([]);
  const [groupAssets, setGroupAssets] = useState<Map<string, MaterialAsset[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [detailGroupId, setDetailGroupId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'group' | 'asset'; id: string; name: string } | null>(null);

  const GROUP_TYPE: GroupType = 'AIGC';

  /** 仅加载分组列表；素材在进入分组详情后再加载。 */
  const loadGroups = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const result = await listAssetGroups({
        Filter: { GroupType: GROUP_TYPE },
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
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const refreshGroupAssets = useCallback(async (groupId: string) => {
    try {
      const assets = await listAssets({
        Filter: { GroupIds: [groupId], GroupType: GROUP_TYPE },
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

  /** 通知父组件是否在分组详情视图（控制外层上传按钮置灰 + 上传目标 groupId） */
  useEffect(() => {
    onDetailViewChange?.(detailGroupId !== null, detailGroupId);
  }, [detailGroupId, onDetailViewChange]);

  /** 父组件触发刷新（上传完成后 refreshTick+1）：仅刷新当前详情分组的素材 */
  useEffect(() => {
    if (refreshTick === undefined || refreshTick === 0) return;
    if (detailGroupId) {
      refreshGroupAssets(detailGroupId);
    } else {
      loadGroups();
    }
  }, [refreshTick]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- 分组操作 ---- */

  const handleCreateGroup = async (name: string) => {
    try {
      const result = await createAssetGroup({ Name: name, GroupType: GROUP_TYPE }, { silent: true });
      setGroups((prev) => [
        { Id: result.Id, Name: name, GroupType: GROUP_TYPE },
        ...prev,
      ]);
      setGroupAssets((prev) => new Map(prev).set(result.Id, []));
      setShowCreateModal(false);
      setDetailGroupId(result.Id);
    } catch (err) {
      // silent 请求：页面层统一用定制文案提示（401 已由请求层弹登录续接）
      if (!isApiError(err) || err.status !== 401) toast.error('新建分组失败，请稍后重试');
      throw err; // 让 GroupFormModal 的 submitting 状态正确恢复
    }
  };

  const handleDeleteGroup = (group: MaterialGroup) => {
    setDeleteTarget({ type: 'group', id: group.Id, name: group.Description || group.Name });
  };

  const handleDeleteAsset = (asset: MaterialAsset) => {
    setDeleteTarget({ type: 'asset', id: asset.Id, name: asset.Name });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === 'group') {
        await deleteAssetGroup(deleteTarget.id, { silent: true });
        setGroups((prev) => prev.filter((g) => g.Id !== deleteTarget.id));
        setGroupAssets((prev) => {
          const next = new Map(prev);
          next.delete(deleteTarget.id);
          return next;
        });
        // 如删除的是当前详情分组，返回列表
        if (detailGroupId === deleteTarget.id) setDetailGroupId(null);
      } else {
        await deleteMaterialAsset(deleteTarget.id);
        if (detailGroupId) {
          setGroupAssets((prev) => {
            const next = new Map(prev);
            const list = next.get(detailGroupId) ?? [];
            next.set(detailGroupId, list.filter((a) => a.Id !== deleteTarget.id));
            return next;
          });
        }
      }
      setDeleteTarget(null);
    } catch (err) {
      if (deleteTarget.type === 'group') {
        // silent 请求：分组删除用定制文案（401 已由请求层弹登录续接）
        if (!isApiError(err) || err.status !== 401) toast.error('分组删除失败，请稍后重试');
      } else if (!isApiError(err)) {
        // API 错误已由请求层统一 toast；非 API 错误兜底提示
        toast.error('删除失败');
      }
      setDeleteTarget(null);
    }
  };

  /* ---- 渲染 ---- */

  const detailGroup = detailGroupId ? groups.find((g) => g.Id === detailGroupId) : null;
  const detailAssets = detailGroupId ? (groupAssets.get(detailGroupId) ?? []) : [];

  // 分组详情视图
  if (detailGroup) {
    return (
      <>
        <GroupDetail
          group={detailGroup}
          assets={detailAssets}
          onBack={() => setDetailGroupId(null)}
          onDeleteAsset={handleDeleteAsset}
          onUpload={onUpload}
        />

        {/* 删除确认弹窗：详情视图内点击删除时立即弹出 */}
        <ConfirmModal
          open={!!deleteTarget}
          title={deleteTarget?.type === 'group' ? '删除分组' : '删除素材'}
          message={
            deleteTarget
              ? deleteTarget.type === 'group'
                ? `确定要删除分组「${deleteTarget.name}」吗？分组内的所有素材也会被同步删除，此操作不可撤销。`
                : `确定要删除素材「${deleteTarget.name}」吗？此操作不可撤销。`
              : ''
          }
          confirmText="确认删除"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      </>
    );
  }

  const handleUploadCardKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') setShowCreateModal(true);
  };

  // 分组列表视图
  return (
    <>
      {loading ? (
        <div className={styles.loadingSpinner}>
          <Loader2 size={32} className={styles.spin} />
          <span>加载中...</span>
        </div>
      ) : loadError ? (
        <div className={styles.empty}>分组加载失败，请稍后重试</div>
      ) : (
        <div className={styles.groupGrid}>
          {/* 新建分组卡片 */}
          <div className={styles.uploadCard}
            role="button" tabIndex={0}
            onClick={() => setShowCreateModal(true)}
            onKeyDown={handleUploadCardKeyDown}>
            <Plus className={styles.plusIcon} strokeWidth={1.5} />
            <span className={styles.uploadLabel}>新建分组</span>
          </div>

          {/* 分组卡片列表 */}
          {groups.map((group) => (
            <GroupCard
              key={group.Id}
              group={group}
              onView={() => handleViewGroup(group.Id)}
              onDelete={() => handleDeleteGroup(group)}
            />
          ))}

          {/* 空状态提示 */}
          {groups.length === 0 && (
            <div className={styles.empty}>
              点击「新建分组」创建分组，分组内可上传虚拟人素材
            </div>
          )}
        </div>
      )}

      {/* 新建分组弹窗 */}
      {showCreateModal && (
        <GroupFormModal
          title="新建分组"
          onConfirm={handleCreateGroup}
          onCancel={() => setShowCreateModal(false)}
        />
      )}

      {/* 删除确认弹窗 */}
      <ConfirmModal
        open={!!deleteTarget}
        title={deleteTarget?.type === 'group' ? '删除分组' : '删除素材'}
        message={
          deleteTarget
            ? deleteTarget.type === 'group'
              ? `确定要删除分组「${deleteTarget.name}」吗？分组内的所有素材也会被同步删除，此操作不可撤销。`
              : `确定要删除素材「${deleteTarget.name}」吗？此操作不可撤销。`
            : ''
        }
        confirmText="确认删除"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
