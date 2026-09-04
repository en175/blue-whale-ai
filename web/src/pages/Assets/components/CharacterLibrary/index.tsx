/* ============================================
 * CharacterLibrary 人像库（资产库页面）
 * 对接素材库 API（POST /api/material/{Action}）
 * 分组管理 + 素材上传 + 素材展示
 * 上传流程：uploadAssetFile（3 步）→ 拿公网 URL → createAsset
 * groupType='AIGC' 虚拟人像库；'LivenessFace' 真人人像库（新建走 H5 真人认证）
 * ============================================ */
import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';
import { Plus, FolderOpen, Trash2, ArrowLeft, X, Loader2, Video } from 'lucide-react';
import {
  createAssetGroup,
  listAssetGroups,
  deleteAssetGroup,
  listAssets,
  deleteAsset as deleteMaterialAsset,
  createVisualValidateSession,
  getVisualValidateResult,
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

/**
 * 真人认证二维码弹窗：H5Link 渲染为二维码，手机扫码打开 H5 刷脸页。
 * 认证结果由外层轮询（startAuthPolling），此处关闭弹窗不打断轮询（卡片保持「认证中…」）。
 */
function AuthQrModal({ h5Link, onClose }: { h5Link: string; onClose: () => void }) {
  return createPortal(
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalTitle}>真人认证</div>
        <div className={styles.qrBox}>
          <QRCodeSVG value={h5Link} size={192} />
        </div>
        <div className={styles.qrHint}>请使用手机扫描二维码完成刷脸认证</div>
        <div className={styles.qrHintSub}>认证通过后将自动创建分组</div>
        <div className={styles.modalActions}>
          <button className={styles.modalCancelBtn} onClick={onClose}>关闭</button>
          <button
            className={styles.modalConfirmBtn}
            onClick={() => window.open(h5Link, '_blank')}
          >
            在当前设备打开
          </button>
        </div>
      </div>
    </div>,
    document.body,
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
          <div className={`${styles.assetCard} ${styles.uploadAssetCard}`} onClick={onUpload} role="button" tabIndex={0}
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
 * 主组件：人像库（资产库页面）
 * groupType='AIGC' 虚拟人像库；'LivenessFace' 真人人像库
 * ============================================ */

/** 真人认证轮询间隔与超时（BytedToken 有效期 30 分钟） */
const AUTH_POLL_INTERVAL_MS = 5000;
const AUTH_TIMEOUT_MS = 30 * 60 * 1000;

export default function CharacterLibrary({
  groupType = 'AIGC',
  onDetailViewChange,
  onUpload,
  refreshTick,
}: {
  groupType?: GroupType;
  onDetailViewChange?: (inDetail: boolean, groupId: string | null) => void;
  onUpload?: () => void;
  refreshTick?: number;
}) {
  const [groups, setGroups] = useState<MaterialGroup[]>([]);
  const [groupAssets, setGroupAssets] = useState<Map<string, MaterialAsset[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [detailGroupId, setDetailGroupId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'group' | 'asset'; id: string; name: string } | null>(null);

  /** 真人认证中（轮询 H5 认证结果，期间禁止再次发起） */
  const [authenticating, setAuthenticating] = useState(false);
  /** 认证二维码弹窗数据（H5Link 渲染二维码供手机扫码；BytedToken 轮询用） */
  const [authSession, setAuthSession] = useState<{ H5Link: string; BytedToken: string } | null>(null);
  const authPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isLiveness = groupType === 'LivenessFace';

  const stopAuthPolling = useCallback(() => {
    if (authPollRef.current) {
      clearInterval(authPollRef.current);
      authPollRef.current = null;
    }
    setAuthenticating(false);
  }, []);

  /** 组件卸载或切换库类型时停止轮询 */
  useEffect(() => stopAuthPolling, [stopAuthPolling, groupType]);

  /** 仅加载分组列表；素材在进入分组详情后再加载。 */
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

  useEffect(() => {
    loadGroups();
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

  /**
   * 真人认证轮询：H5 刷脸完成后 GroupId 非空即认证成功。
   * 轮询静默失败不打扰（网络抖动重试）；401 由请求层弹登录续接后停止轮询。
   */
  const startAuthPolling = useCallback((bytedToken: string) => {
    stopAuthPolling();
    setAuthenticating(true);
    const startedAt = Date.now();
    authPollRef.current = setInterval(async () => {
      if (Date.now() - startedAt > AUTH_TIMEOUT_MS) {
        stopAuthPolling();
        setAuthSession(null);
        toast.error('认证超时，请重新发起');
        return;
      }
      try {
        const { GroupId } = await getVisualValidateResult(bytedToken, { silent: true });
        if (GroupId) {
          stopAuthPolling();
          setAuthSession(null);
          toast.success('认证成功，已创建真人分组');
          loadGroups();
        }
      } catch (err) {
        // 会话失效（登录续接已弹出）：停止轮询，等待用户重新登录后再发起
        if (isApiError(err) && err.status === 401) {
          stopAuthPolling();
          setAuthSession(null);
        }
        // 其余单次失败静默跳过，下轮重试
      }
    }, AUTH_POLL_INTERVAL_MS);
  }, [loadGroups, stopAuthPolling]);

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
    // 真人像库：新建走 H5 真人认证，认证通过后上游自动建组
    if (isLiveness) {
      // 上游约束：名称含 < > 返回 400 InvalidParameter，前端先拦截
      if (/[<>]/.test(name)) {
        toast.error('名称不能包含 < 或 > 字符');
        throw new Error('invalid name');
      }
      try {
        // callback_url 指向前端落地页：上游刷脸完成后跳转（手机端提示「请于 PC 端查看」）
        const session = await createVisualValidateSession(
          { Name: name, callback_url: `${window.location.origin}/auth-success` },
          { silent: true },
        );
        setShowCreateModal(false);
        // 展示二维码弹窗：手机扫码打开 H5 刷脸页；桌面端可点「在当前设备打开」
        setAuthSession({ H5Link: session.H5Link, BytedToken: session.BytedToken });
        startAuthPolling(session.BytedToken);
      } catch (err) {
        // silent 请求：页面层定制文案（401 已由请求层弹登录续接）
        if (!isApiError(err) || err.status !== 401) toast.error('发起真人认证失败，请稍后重试');
        throw err; // 让 GroupFormModal 的 submitting 状态正确恢复
      }
      return;
    }

    try {
      const result = await createAssetGroup({ Name: name, GroupType: groupType }, { silent: true });
      setGroups((prev) => [
        { Id: result.Id, Name: name, GroupType: groupType },
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
    if (e.key === 'Enter' && !authenticating) setShowCreateModal(true);
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
          {/* 新建分组/新建真人卡片：真人认证中禁用（单真人单次认证串行） */}
          <div
            className={styles.uploadCard}
            role="button" tabIndex={authenticating ? -1 : 0}
            aria-disabled={authenticating}
            onClick={() => { if (!authenticating) setShowCreateModal(true); }}
            onKeyDown={handleUploadCardKeyDown}
          >
            {authenticating ? (
              <>
                <Loader2 className={`${styles.plusIcon} ${styles.spin}`} strokeWidth={1.5} />
                <span className={styles.uploadLabel}>认证中…</span>
              </>
            ) : (
              <>
                <Plus className={styles.plusIcon} strokeWidth={1.5} />
                <span className={styles.uploadLabel}>{isLiveness ? '新建真人' : '新建分组'}</span>
              </>
            )}
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
              {isLiveness
                ? '点击「新建真人」发起真人认证，认证通过后可上传素材'
                : '点击「新建分组」创建分组，分组内可上传虚拟人素材'}
            </div>
          )}
        </div>
      )}

      {/* 新建分组/新建真人弹窗 */}
      {showCreateModal && (
        <GroupFormModal
          title={isLiveness ? '新建真人' : '新建分组'}
          placeholder={isLiveness ? '请输入真人名称' : undefined}
          onConfirm={handleCreateGroup}
          onCancel={() => setShowCreateModal(false)}
        />
      )}

      {/* 真人认证二维码弹窗（轮询在外层，关闭弹窗不打断） */}
      {authSession && (
        <AuthQrModal
          h5Link={authSession.H5Link}
          onClose={() => setAuthSession(null)}
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
