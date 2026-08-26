/* ============================================
 * CharacterLibraryModal 角色库弹窗
 * 对接素材库 API（POST /api/material/{Action}）
 * 与 SharedAssetsModal 同尺寸（1000×680）
 * Tab: 虚拟人像库（后续可扩展）
 * 支持分组管理 + 素材选择
 * 上传流程：uploadAssetFile（3 步）→ 拿公网 URL → createAsset → 轮询就绪
 * ============================================ */
import { useState, useEffect, useCallback, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  User,
  Plus,
  FolderOpen,
  MoreVertical,
  Trash2,
  Edit3,
  ArrowLeft,
  Check,
  Upload,
} from 'lucide-react';
import {
  createAssetGroup,
  listAssetGroups,
  deleteAssetGroup,
  listAssets,
  createAsset,
  updateAssetGroup,
  type MaterialGroup,
  type MaterialAsset,
  type GroupType,
} from '@/api/material';
import { uploadAssetFile } from '@/utils/upload';
import { isApiError } from '@/api/http';
import styles from './index.module.css';

/** Tab 定义 */
const TABS = [
  { key: 'character', label: '虚拟人像库', icon: User },
];

interface CharacterLibraryModalProps {
  onClose: () => void;
  /** 选择素材后回调（返回 MaterialAsset） */
  onSelect?: (asset: MaterialAsset) => void;
}

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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
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
        <button
          className={styles.groupViewBtn}
          onClick={(e) => { e.stopPropagation(); onView(); }}
        >
          查看
        </button>
        <div className={styles.groupMenuBtn} ref={menuRef}>
          <MoreVertical
            size={16}
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
          />
          {menuOpen && (
            <div className={styles.dropdownMenu} onClick={(e) => e.stopPropagation()}>
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
      <div className={styles.groupInfo}>
        <span className={styles.groupName} title={group.Name}>{group.Name}</span>
        <span className={styles.groupCount}>{assets.length} 个素材</span>
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

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
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
 * 分组详情视图（支持选择/上传素材）
 * ============================================ */
function GroupDetail({
  group,
  assets,
  onBack,
  onSelectAsset,
  onRename,
  onRefresh,
}: {
  group: MaterialGroup;
  assets: MaterialAsset[];
  onBack: () => void;
  onSelectAsset: (asset: MaterialAsset) => void;
  onRename: () => void;
  onRefresh: () => void;
}) {
  const [previewAsset, setPreviewAsset] = useState<MaterialAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(async (files: FileList) => {
    if (uploading) return;
    setUploading(true);
    setUploadError('');

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        setUploadError(`${file.name}：仅支持图片`);
        continue;
      }
      try {
        // Step 1: 上传到 Asset 管道拿公网 URL
        const uploadResult = await uploadAssetFile(file);
        // Step 2: 调用素材库 CreateAsset
        await createAsset({
          GroupId: group.Id,
          URL: uploadResult.url,
          Name: file.name,
          AssetType: 'Image',
        });
        // Step 3: 刷新列表
        onRefresh();
      } catch (err) {
        setUploadError(isApiError(err) ? `${file.name}：${err.message}` : `上传失败：${file.name}`);
      }
    }
    setUploading(false);
  }, [uploading, group.Id, onRefresh]);

  return (
    <div className={styles.detailView}>
      <div className={styles.detailHeader}>
        <button className={styles.backBtn} onClick={onBack}>
          <ArrowLeft size={16} /> 返回
        </button>
        <span className={styles.detailTitle}>{group.Name}</span>
        <div className={styles.detailActions}>
          <button className={styles.uploadBtn} onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <Upload size={14} /> {uploading ? '上传中...' : '上传素材'}
          </button>
          <button className={styles.modalCancelBtn} onClick={onRename}>
            <Edit3 size={14} /> 重命名
          </button>
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleUpload(e.target.files);
            e.target.value = '';
          }
        }}
      />

      {uploadError && <div className={styles.errorMsg}>{uploadError}</div>}

      {assets.length === 0 ? (
        <div className={styles.empty}>该分组暂无素材，点击「上传素材」添加</div>
      ) : (
        <div className={styles.assetGrid}>
          {assets.map((asset) => (
            <div key={asset.Id} className={styles.assetCard}
              onClick={() => onSelectAsset(asset)}>
              <div className={styles.assetThumb}>
                {asset.URL ? (
                  <img src={asset.URL} alt={asset.Name} loading="lazy" />
                ) : (
                  <div className={styles.empty}>资源不可用</div>
                )}
                {asset.Status === 'Active' && (
                  <button
                    className={styles.assetSelectBtn}
                    title="选择此素材"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectAsset(asset);
                    }}
                  >
                    <Check size={14} strokeWidth={2.5} />
                  </button>
                )}
                {asset.Status === 'Processing' && (
                  <div className={styles.statusBadge}>处理中</div>
                )}
                {asset.Status === 'Failed' && (
                  <div className={`${styles.statusBadge} ${styles.statusFailed}`}>
                    失败
                  </div>
                )}
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
 * 主组件
 * ============================================ */
export default function CharacterLibraryModal({ onClose, onSelect }: CharacterLibraryModalProps) {
  const [activeTab, setActiveTab] = useState(TABS[0].key);
  const [groups, setGroups] = useState<MaterialGroup[]>([]);
  const [groupAssets, setGroupAssets] = useState<Map<string, MaterialAsset[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [detailGroupId, setDetailGroupId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<MaterialGroup | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [actionError, setActionError] = useState('');

  const GROUP_TYPE: GroupType = 'AIGC';

  /** 加载分组列表 */
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

  /** 新建分组 */
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
    }
  };

  /** 修改分组描述 */
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

  /** 删除分组 */
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

  /** 选择素材 */
  const handleSelectAsset = (asset: MaterialAsset) => {
    if (asset.Status !== 'Active') {
      setActionError('素材尚未就绪，请稍后再试');
      return;
    }
    onSelect?.(asset);
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

        {/* Tab 栏 */}
        <div className={styles.tabs}>
          {TABS.map((tab) => (
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

        {/* 操作错误提示 */}
        {actionError && <div className={styles.errorMsg}>{actionError}</div>}

        {/* 内容区 */}
        <div className={styles.content}>
          {loading && <div className={styles.empty}>加载中...</div>}
          {!loading && loadError && <div className={styles.empty}>加载失败：{loadError}</div>}
          {!loading && !loadError && activeTab === 'character' && (
            detailGroup ? (
              <GroupDetail
                group={detailGroup}
                assets={detailAssets}
                onBack={() => setDetailGroupId(null)}
                onSelectAsset={handleSelectAsset}
                onRename={() => setRenameTarget(detailGroup)}
                onRefresh={() => refreshGroupAssets(detailGroup.Id)}
              />
            ) : (
              <div className={styles.groupListView}>
                <div className={styles.groupGrid}>
                  {/* 新建分组卡片 */}
                  <div className={styles.uploadCard} onClick={() => setShowCreateModal(true)}>
                    <Plus className={styles.plusIcon} strokeWidth={1.5} />
                    <span>新建分组</span>
                  </div>
                  {/* 分组列表 */}
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
                </div>
                {groups.length === 0 && (
                  <div className={styles.emptyHint}>
                    <p>暂无分组</p>
                    <p>点击「新建分组」创建你的第一个角色分组</p>
                  </div>
                )}
              </div>
            )
          )}
        </div>

        {/* 新建分组弹窗 */}
        {showCreateModal && (
          <GroupFormModal
            title="新建分组"
            onConfirm={handleCreateGroup}
            onCancel={() => setShowCreateModal(false)}
          />
        )}

        {/* 修改描述弹窗 */}
        {renameTarget ? (
          <GroupFormModal
            title="修改分组描述"
            initialText={renameTarget.Description || ''}
            placeholder="请输入分组描述"
            onConfirm={handleRenameGroup}
            onCancel={() => setRenameTarget(null)}
          />
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
