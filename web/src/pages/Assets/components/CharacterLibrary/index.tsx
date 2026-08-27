/* ============================================
 * CharacterLibrary 虚拟人库（资产库页面）
 * 对接素材库 API（POST /api/material/{Action}）
 * 分组管理 + 素材上传 + 素材展示
 * 上传流程：uploadAssetFile（3 步）→ 拿公网 URL → createAsset
 * ============================================ */
import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { Plus, FolderOpen, MoreVertical, Trash2, Edit3, ArrowLeft } from 'lucide-react';
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
            <span className={styles.groupName} title={group.Name}>{group.Name}</span>
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
  onRename,
  onDeleteAsset,
}: {
  group: MaterialGroup;
  assets: MaterialAsset[];
  onBack: () => void;
  onRename: () => void;
  onDeleteAsset: (assetId: string) => void;
}) {
  const [previewAsset, setPreviewAsset] = useState<MaterialAsset | null>(null);

  return (
    <div className={styles.detailView}>
      <div className={styles.detailHeader}>
        <button className={styles.backBtn} onClick={onBack}>
          <ArrowLeft size={16} /> 返回
        </button>
        <span className={styles.detailTitle}>{group.Name}</span>
        <div className={styles.detailActions}>
          <button className={styles.modalCancelBtn} onClick={onRename}>
            <Edit3 size={14} /> 重命名
          </button>
        </div>
      </div>

      {assets.length === 0 ? (
        <div className={styles.empty}>该分组暂无素材，请点击右上角「上传素材」添加</div>
      ) : (
        <div className={styles.assetGrid}>
          {assets.map((asset) => (
            <div key={asset.Id} className={styles.assetCard}
              onClick={() => setPreviewAsset(asset)}>
              <div className={styles.assetThumb}>
                {asset.URL ? (
                  <img src={asset.URL} alt={asset.Name} loading="lazy" />
                ) : (
                  <div className={styles.empty}>资源不可用</div>
                )}
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
                    onDeleteAsset(asset.Id);
                  }}
                >
                  <Trash2 size={14} strokeWidth={2} />
                </button>
              </div>
              <div className={styles.assetName} title={asset.Name}>
                {asset.Name}
              </div>
            </div>
          ))}
        </div>
      )}

      {previewAsset && (
        <div className={styles.modalOverlay} onClick={() => setPreviewAsset(null)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}
            style={{ padding: 0, maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto' }}>
            <img src={previewAsset.URL} alt={previewAsset.Name} style={{ maxWidth: '100%', display: 'block' }} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================
 * 主组件：虚拟人库（资产库页面）
 * ============================================ */
export default function CharacterLibrary({ onDetailViewChange }: { onDetailViewChange?: (inDetail: boolean, groupId: string | null) => void }) {
  const [groups, setGroups] = useState<MaterialGroup[]>([]);
  const [groupAssets, setGroupAssets] = useState<Map<string, MaterialAsset[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [renameTarget, setRenameTarget] = useState<MaterialGroup | null>(null);
  const [detailGroupId, setDetailGroupId] = useState<string | null>(null);

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
      setGroups((prev) =>
        prev.map((g) => (g.Id === renameTarget.Id ? { ...g, Description: description } : g))
      );
      setRenameTarget(null);
    } catch (err) {
      setActionError(isApiError(err) ? err.message : '修改描述失败');
      throw err;
    }
  };

  const handleDeleteGroup = async (id: string) => {
    if (!confirm('确定删除分组？分组内的素材也会被同步删除。')) return;
    setActionError('');
    try {
      await deleteAssetGroup(id);
      setGroups((prev) => prev.filter((g) => g.Id !== id));
      setGroupAssets((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    } catch (err) {
      setActionError(isApiError(err) ? err.message : '删除分组失败');
    }
  };

  const handleDeleteAsset = async (assetId: string) => {
    if (!confirm('确定删除此素材吗？')) return;
    try {
      await deleteMaterialAsset(assetId);
      // 从本地状态移除
      if (detailGroupId) {
        setGroupAssets((prev) => {
          const next = new Map(prev);
          const list = next.get(detailGroupId) ?? [];
          next.set(detailGroupId, list.filter((a) => a.Id !== assetId));
          return next;
        });
      }
    } catch (err) {
      setActionError(isApiError(err) ? err.message : '删除素材失败');
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
          onRename={() => setRenameTarget(detailGroup)}
          onDeleteAsset={handleDeleteAsset}
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
        <div className={styles.empty}>加载中…</div>
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
              onDelete={() => handleDeleteGroup(group.Id)}
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
    </>
  );
}
