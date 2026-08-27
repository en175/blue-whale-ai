/* ============================================
 * CharacterLibrary 虚拟人库（资产库页面）
 * 对接素材库 API（POST /api/material/{Action}）
 * 分组管理 + 素材上传 + 素材展示
 * 上传流程：uploadAssetFile（3 步）→ 拿公网 URL → createAsset
 * ============================================ */
import { useState, useRef, useEffect, useCallback, type KeyboardEvent, type WheelEvent } from 'react';
import { Plus, Minus, RotateCw, FolderOpen, MoreVertical, Trash2, Edit3, ArrowLeft, X, Loader2 } from 'lucide-react';
import {
  createAssetGroup,
  listAssetGroups,
  deleteAssetGroup,
  listAssets,
  updateAssetGroup,
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
  assets,
  onView,
  onRename,
  onDelete,
}: {
  group: MaterialGroup;
  assets: MaterialAsset[];
  onView: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const bottomMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (bottomMenuRef.current && bottomMenuRef.current.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const coverAsset = assets.find((a) => a.GroupId === group.Id);
  const coverUrl = coverAsset?.URL;

  return (
    <div className={styles.groupCard} onClick={onView}>
      <div className={styles.groupCover}>
        {coverUrl ? (
          <img src={coverUrl} alt={group.Name} />
        ) : (
          <FolderOpen className={styles.folderIcon} strokeWidth={1} />
        )}
        {/* 底部信息栏（覆盖在图片上） */}
        <div className={styles.groupInfo}>
          <div className={styles.groupInfoLeft}>
            <span className={styles.groupName} title={group.Description || group.Name}>{group.Description || group.Name}</span>
            <span className={styles.groupCount}>{assets.length} 个素材</span>
          </div>
        </div>
        {/* 右下角三点按钮 */}
        <div className={styles.groupBottomActions} ref={bottomMenuRef}>
          <button
            className={styles.groupBottomMenuBtn}
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            title="更多操作"
          >
            <MoreVertical size={14} />
          </button>
          {menuOpen && (
            <div className={styles.dropdownMenu} onClick={(e) => e.stopPropagation()} style={{ bottom: '32px', top: 'auto' }}>
              <button className={styles.dropdownItem} onClick={() => { setMenuOpen(false); onRename(); }}>
                <Edit3 size={14} /> 重命名
              </button>
              <button className={`${styles.dropdownItem} ${styles.dropdownItemDanger}`} onClick={() => { setMenuOpen(false); onDelete(); }}>
                <Trash2 size={14} /> 删除
              </button>
            </div>
          )}
        </div>
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
  const [previewZoom, setPreviewZoom] = useState(0.6); // 默认较小比例
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
  const PREVIEW_MIN_ZOOM = 0.1;
  const PREVIEW_MAX_ZOOM = 3.0;

  const handleZoomIn = () => { setPreviewZoom((z) => Math.min(z + 0.1, PREVIEW_MAX_ZOOM)); };
  const handleZoomOut = () => { setPreviewZoom((z) => Math.max(z - 0.1, PREVIEW_MIN_ZOOM)); };
  const handleZoomReset = () => { setPreviewZoom(0.6); setPreviewOffset({ x: 0, y: 0 }); };

  const handleWheel = (e: WheelEvent) => {
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setPreviewZoom((z) => Math.min(Math.max(z + delta, PREVIEW_MIN_ZOOM), PREVIEW_MAX_ZOOM));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (previewZoom <= 0.6) return;
    setDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      offsetX: previewOffset.x,
      offsetY: previewOffset.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    setPreviewOffset({
      x: dragStartRef.current.offsetX + (e.clientX - dragStartRef.current.x),
      y: dragStartRef.current.offsetY + (e.clientY - dragStartRef.current.y),
    });
  };

  const handleMouseUp = () => setDragging(false);

  const closePreview = () => {
    setPreviewAsset(null);
    setPreviewZoom(0.6);
    setPreviewOffset({ x: 0, y: 0 });
  };

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
                <img src={asset.URL} alt={asset.Name} loading="lazy" />
              ) : (
                <div className={styles.empty}>资源不可用</div>
              )}
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
        <div className={styles.modalOverlay} onClick={closePreview}>
          <div
            className={`${styles.previewContainer} ${dragging ? styles.previewDragging : ''}`}
            onClick={(e) => e.stopPropagation()}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {/* 关闭按钮 */}
            <button className={styles.previewCloseBtn} onClick={closePreview} title="关闭">
              <X size={20} />
            </button>
            {/* 图片预览 */}
            <img
              src={previewAsset.URL}
              alt={previewAsset.Name}
              className={styles.previewImage}
              style={{
                transform: `translate(${previewOffset.x}px, ${previewOffset.y}px) scale(${previewZoom})`,
                cursor: previewZoom > 0.6 ? 'grab' : 'default',
              }}
              draggable={false}
            />
            {/* 缩放控制栏 */}
            <div className={styles.previewZoomControls}>
              <button onClick={handleZoomOut} title="缩小">
                <Minus size={16} />
              </button>
              <span className={styles.previewZoomLevel}>{Math.round(previewZoom * 100)}%</span>
              <button onClick={handleZoomIn} title="放大">
                <Plus size={16} />
              </button>
              <button onClick={handleZoomReset} title="重置">
                <RotateCw size={16} />
              </button>
            </div>
          </div>
        </div>
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
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [renameTarget, setRenameTarget] = useState<MaterialGroup | null>(null);
  const [detailGroupId, setDetailGroupId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'group' | 'asset'; id: string; name: string } | null>(null);

  const GROUP_TYPE: GroupType = 'AIGC';

  /** 加载分组 + 素材 */
  const loadGroups = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const result = await listAssetGroups({
        Filter: { GroupType: GROUP_TYPE },
        PageNumber: 1,
        PageSize: 100,
      });
      setGroups(result.Items);
      // 预加载每个分组的素材
      const assetsMap = new Map<string, MaterialAsset[]>();
      await Promise.all(
        result.Items.map(async (g) => {
          try {
            const assets = await listAssets({
              Filter: { GroupIds: [g.Id], GroupType: GROUP_TYPE },
              PageNumber: 1,
              PageSize: 100,
            });
            assetsMap.set(g.Id, assets.Items);
          } catch {
            assetsMap.set(g.Id, []);
          }
        }),
      );
      setGroupAssets(assetsMap);
    } catch (err) {
      setLoadError(isApiError(err) ? err.message : '加载失败');
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
    setActionError('');
    try {
      const result = await createAssetGroup({ Name: name, GroupType: GROUP_TYPE });
      setGroups((prev) => [
        { Id: result.Id, Name: name, GroupType: GROUP_TYPE },
        ...prev,
      ]);
      setGroupAssets((prev) => new Map(prev).set(result.Id, []));
      setShowCreateModal(false);
      setDetailGroupId(result.Id);
    } catch (err) {
      setActionError(isApiError(err) ? err.message : '创建分组失败');
      throw err; // 让 GroupFormModal 的 submitting 状态正确恢复
    }
  };

  const handleRenameGroup = async (description: string) => {
    if (!renameTarget) return;
    setActionError('');
    try {
      await updateAssetGroup({ Id: renameTarget.Id, Description: description });
      await loadGroups();
      setRenameTarget(null);
    } catch (err) {
      setActionError(isApiError(err) ? err.message : '修改描述失败');
      throw err;
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
    setActionError('');
    try {
      if (deleteTarget.type === 'group') {
        await deleteAssetGroup(deleteTarget.id);
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
      setActionError(isApiError(err) ? err.message : '删除失败');
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
        {renameTarget && (
          <GroupFormModal
            title="修改分组描述"
            initialText={renameTarget.Description || ''}
            placeholder="请输入分组描述"
            onConfirm={handleRenameGroup}
            onCancel={() => setRenameTarget(null)}
          />
        )}
        {actionError && <div className={styles.errorMsg} style={{ margin: '0 24px' }}>{actionError}</div>}
      </>
    );
  }

  const handleUploadCardKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') setShowCreateModal(true);
  };

  // 分组列表视图
  return (
    <>
      {actionError && <div className={styles.errorMsg}>{actionError}</div>}
      {loading ? (
        <div className={styles.loadingSpinner}>
          <Loader2 size={32} className={styles.spin} />
          <span>加载中...</span>
        </div>
      ) : loadError ? (
        <div className={styles.empty} style={{ color: 'var(--color-error)' }}>{loadError}</div>
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
              assets={groupAssets.get(group.Id) ?? []}
              onView={() => setDetailGroupId(group.Id)}
              onRename={() => setRenameTarget(group)}
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

      {renameTarget && (
        <GroupFormModal
          title="修改分组描述"
          initialText={renameTarget.Description || ''}
          placeholder="请输入分组描述"
          onConfirm={handleRenameGroup}
          onCancel={() => setRenameTarget(null)}
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
