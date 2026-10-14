import { useState, useRef, useEffect, useCallback, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import QRCodeStyling from 'qr-code-styling';
import { Plus, FolderOpen, Trash2, ArrowLeft, X, Loader2, Video, Music, RotateCw, Check, ZoomIn } from 'lucide-react';
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
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/utils/remoteImageCors';
import { formatAssetCreatedAt } from '../AssetDetailModal/format';
import styles from './index.module.css';

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
        {}
        <div className={styles.groupInfo}>
          <div className={styles.groupInfoLeft}>
            <span className={styles.groupName} title={group.Description || group.Name}>{group.Description || group.Name}</span>
            <span className={styles.groupCount}>点击查看素材</span>
          </div>
        </div>
        {}
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

const QR_EXPIRE_SECONDS = 15 * 60;

function AuthQrModal({
  h5Link,
  onClose,
  onCreateSession,
  creating,
}: {
  h5Link: string;
  onClose: () => void;
  onCreateSession: () => void;
  creating: boolean;
}) {
  const qrContainerRef = useRef<HTMLDivElement>(null);
  const [remainSeconds, setRemainSeconds] = useState(QR_EXPIRE_SECONDS);
  const expired = remainSeconds <= 0;

  useEffect(() => {
    setRemainSeconds(QR_EXPIRE_SECONDS);
  }, [h5Link]);

  useEffect(() => {
    if (expired) return;
    const timer = setInterval(() => {
      setRemainSeconds((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [expired, h5Link]);

  useEffect(() => {
    const qrContainer = qrContainerRef.current;
    if (!qrContainer) return;
    qrContainer.innerHTML = '';
    const qr = new QRCodeStyling({
      width: 220,
      height: 220,
      type: 'svg',
      data: h5Link,
      dotsOptions: { color: '#1a1a1f', type: 'rounded' },
      cornersSquareOptions: { type: 'extra-rounded' },
      cornersDotOptions: { type: 'dot', color: '#1a1a1f' },
      backgroundOptions: { color: '#ffffff' },
      margin: 0,
      qrOptions: { errorCorrectionLevel: 'L' },
    });
    qr.append(qrContainer);
    return () => {
      qrContainer.replaceChildren();
    };
  }, [h5Link]);

  return createPortal(
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.qrModalCard} onClick={(e) => e.stopPropagation()}>
        <button className={styles.qrCloseBtn} onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>
        <div className={styles.qrTitle}>真人认证</div>
        <div className={styles.qrSubtitle}>请使用手机扫描二维码完成刷脸认证</div>
        <div className={styles.qrBox}>
          <div ref={qrContainerRef} />
          {expired && (
            <div className={styles.qrExpiredMask}>
              <span>认证超时，请重新发起</span>
            </div>
          )}
        </div>
        <div className={styles.qrCountdown}>二维码有效期15分钟</div>
        <button
          className={styles.qrResetBtn}
          onClick={onCreateSession}
          disabled={creating}
        >
          <RotateCw size={14} className={creating ? styles.qrSpin : undefined} />
          {creating ? '生成中...' : '重新生成'}
        </button>
      </div>
    </div>,
    document.body,
  );
}

function MaterialDetailModal({ asset, onClose }: { asset: MaterialAsset | null; onClose: () => void }) {
  if (!asset) return null;

  return createPortal(
    <div className={styles.detailOverlay} onClick={onClose}>
      <div className={styles.detailLayout} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {}
        <div className={styles.detailPreviewPane}>
          {asset.URL ? (
            asset.AssetType === 'Video' ? (
              <video className={styles.detailMedia} src={resolveMediaSrc(asset.URL)} controls autoPlay playsInline />
            ) : asset.AssetType === 'Audio' ? (
              <audio className={styles.detailMedia} src={resolveMediaSrc(asset.URL)} crossOrigin={remoteImageCrossOrigin(asset.URL)} controls />
            ) : (
              <img className={styles.detailMedia} src={resolveMediaSrc(asset.URL)} alt={asset.Name} draggable={false} />
            )
          ) : (
            <div className={styles.detailEmpty}>媒体文件不可用</div>
          )}
        </div>

        {}
        <aside className={styles.detailPane}>
          <div className={styles.detailHeader}>
            <span className={styles.detailTypeBadge}>
              {asset.AssetType === 'Video' ? '视频' : asset.AssetType === 'Audio' ? '音频' : '图片'}
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
              <dd>{formatAssetCreatedAt(asset.CreateTime ?? null)}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>,
    document.body
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

function AssetCardOverlays({
  asset,
  onDeleteAsset,
  onPreviewAsset,
  onClosePreview,
  pickerMode = false,
}: {
  asset: MaterialAsset;
  onDeleteAsset: (asset: MaterialAsset) => void;
  onPreviewAsset: (asset: MaterialAsset) => void;
  onClosePreview: () => void;
  pickerMode?: boolean;
}) {
  return (
    <>
      <div className={styles.assetTypeBadge}>
        {asset.AssetType === 'Video' ? <Video size={14} /> : null}
        {asset.AssetType === 'Audio' ? <Music size={14} /> : null}
        {asset.AssetType === 'Video' ? '视频' : asset.AssetType === 'Audio' ? '音频' : '图片'}
      </div>
      {}
      <div className={styles.assetNameOverlay}>
        <span className={styles.assetName} title={asset.Name}>{asset.Name}</span>
        {asset.Status === 'Processing' && (
          <span className={styles.assetNameStatus}>处理中</span>
        )}
        {asset.Status === 'Failed' && (
          <span className={`${styles.assetNameStatus} ${styles.assetNameStatusFailed}`}>失败</span>
        )}
      </div>
      {}
      <div className={styles.assetHoverActions}>
        <button
          className={styles.assetDeleteBtn}
          title="删除素材"
          onClick={(e) => {
            e.stopPropagation();
            onClosePreview();
            onDeleteAsset(asset);
          }}
        >
          <Trash2 size={14} strokeWidth={2} />
        </button>
        {pickerMode && (
          <button
            className={styles.assetPreviewBtn}
            title="放大预览"
            onClick={(e) => {
              e.stopPropagation();
              onPreviewAsset(asset);
            }}
          >
            <ZoomIn size={14} strokeWidth={2} />
          </button>
        )}
      </div>
    </>
  );
}

function materialMediaKind(assetType: MaterialAsset['AssetType']): 'image' | 'video' | 'audio' {
  if (assetType === 'Video') return 'video';
  if (assetType === 'Audio') return 'audio';
  return 'image';
}

function useMaterialPreviewBridge(
  previewAsset: MaterialAsset | null,
  closePreview: () => void,
  active: boolean,
  onPickerPreviewChange?: (open: boolean) => void,
) {
  useEffect(() => {
    if (active) onPickerPreviewChange?.(previewAsset !== null);
  }, [active, previewAsset, onPickerPreviewChange]);

  useEffect(() => {
    if (!previewAsset) return undefined;
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') closePreview();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewAsset, closePreview]);
}

function isPickerSelectableAsset(
  asset: MaterialAsset,
  pickerMediaTypes?: Array<'image' | 'video' | 'audio'>,
): boolean {
  if (asset.Status !== 'Active' || !asset.URL) return false;
  if (!pickerMediaTypes || pickerMediaTypes.length === 0) return true;
  return pickerMediaTypes.includes(materialMediaKind(asset.AssetType));
}

function AssetPickerCard({
  asset,
  pickerMode,
  selected,
  selectable,
  onPreview,
  onPickerToggle,
  onPickerBlocked,
  onDeleteAsset,
  onClosePreview,
}: {
  asset: MaterialAsset;
  pickerMode: boolean;
  selected: boolean;
  selectable: boolean;
  onPreview: (asset: MaterialAsset) => void;
  onPickerToggle?: (asset: MaterialAsset) => void;
  onPickerBlocked?: (asset: MaterialAsset) => void;
  onDeleteAsset: (asset: MaterialAsset) => void;
  onClosePreview: () => void;
}) {
  const overlays = (
    <>
      <AssetCardOverlays
        asset={asset}
        onDeleteAsset={onDeleteAsset}
        onPreviewAsset={onPreview}
        onClosePreview={onClosePreview}
        pickerMode={pickerMode}
      />
      {pickerMode && selectable && (
        <div className={`${styles.checkToggle} ${selected ? styles.checkToggleOn : ''}`}>
          {selected && <Check size={14} strokeWidth={2.5} />}
        </div>
      )}
    </>
  );
  return (
    <div
      className={`${styles.assetCard} ${pickerMode && !selectable ? styles.assetCardDisabled : ''} ${selected ? styles.assetCardSelected : ''}`}
      onClick={() => {
        if (pickerMode) {
          if (selectable) onPickerToggle?.(asset);
          else onPickerBlocked?.(asset);
          return;
        }
        onPreview(asset);
      }}
    >
      {asset.URL && asset.AssetType === 'Image' ? (
        <MeasuredThumb src={asset.URL} alt={asset.Name}>
          {overlays}
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
          {overlays}
        </div>
      )}
    </div>
  );
}

function UploadMaterialCard({
  onUpload,
  onPickFiles,
}: {
  onUpload?: () => void;
  onPickFiles?: (files: File[]) => void;
}) {
  if (!onUpload && !onPickFiles) return null;
  const thumb = (
    <div className={`${styles.assetThumb} ${styles.uploadThumb}`}>
      <Plus size={28} strokeWidth={1.5} />
      <span className={styles.uploadCardLabel}>上传素材</span>
    </div>
  );
  if (onPickFiles) {
    return (
      <label className={`${styles.assetCard} ${styles.uploadAssetCard}`}>
        <input
          type="file"
          multiple
          accept="image/*,video/*,.jpg,.jpeg,.png,.webp,.mp4,.mov,.webm"
          className={styles.nativeFileInput}
          onChange={(e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            onPickFiles(Array.from(files));
            e.target.value = '';
          }}
        />
        {thumb}
      </label>
    );
  }
  return (
    <div
      className={`${styles.assetCard} ${styles.uploadAssetCard}`}
      onClick={onUpload}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onUpload?.(); }}
    >
      {thumb}
    </div>
  );
}

function GroupDetail({
  group,
  assets,
  onBack,
  onDeleteAsset,
  onUpload,
  onPickFiles,
  pickerSelectedIds,
  onPickerToggleAsset,
  onPickerBlockedAsset,
  pickerMediaTypes,
  onPickerPreviewChange,
}: {
  group: MaterialGroup;
  assets: MaterialAsset[];
  onBack: () => void;
  onDeleteAsset: (asset: MaterialAsset) => void;
  onUpload?: () => void;
  onPickFiles?: (files: File[]) => void;
  pickerSelectedIds?: ReadonlySet<string>;
  onPickerToggleAsset?: (asset: MaterialAsset) => void;
  onPickerBlockedAsset?: (asset: MaterialAsset) => void;
  pickerMediaTypes?: Array<'image' | 'video' | 'audio'>;
  onPickerPreviewChange?: (open: boolean) => void;
}) {
  const [previewAsset, setPreviewAsset] = useState<MaterialAsset | null>(null);
  const closePreview = () => setPreviewAsset(null);
  const pickerMode = Boolean(onPickerToggleAsset);

  useMaterialPreviewBridge(previewAsset, closePreview, pickerMode, onPickerPreviewChange);

  return (
    <div className={styles.detailView}>
      <div className={styles.detailHeader}>
        <button className={styles.backBtn} onClick={onBack}>
          <ArrowLeft size={16} /> 返回
        </button>
        <span className={styles.detailTitle}>{group.Description || group.Name}</span>
      </div>

      <div className={styles.assetGrid}>
        <UploadMaterialCard onUpload={onUpload} onPickFiles={onPickFiles} />
        {assets.map((asset) => (
          <AssetPickerCard
            key={asset.Id}
            asset={asset}
            pickerMode={pickerMode}
            selected={pickerSelectedIds?.has(asset.Id) ?? false}
            selectable={!pickerMode || isPickerSelectableAsset(asset, pickerMediaTypes)}
            onPreview={setPreviewAsset}
            onPickerToggle={onPickerToggleAsset}
            onPickerBlocked={onPickerBlockedAsset}
            onDeleteAsset={onDeleteAsset}
            onClosePreview={closePreview}
          />
        ))}
        {!onUpload && !onPickFiles && assets.length === 0 && (
          <div className={styles.empty}>该分组暂无素材</div>
        )}
      </div>

      {previewAsset && (
        <MaterialDetailModal asset={previewAsset} onClose={closePreview} />
      )}
    </div>
  );
}


const AIGC_PAGE_SIZE = 100;
const AIGC_GROUP_BATCH_SIZE = 50;
const AIGC_MAX_PAGES = 50;

async function fetchAllAigcPages<T>(
  fetchPage: (pageNumber: number) => Promise<{ TotalCount?: number; Items?: T[] }>,
): Promise<T[]> {
  const first = await fetchPage(1);
  const all = [...(first.Items ?? [])];
  const totalPages = Math.min(Math.ceil((first.TotalCount ?? 0) / AIGC_PAGE_SIZE), AIGC_MAX_PAGES);
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await fetchPage(page);
    const items = next.Items ?? [];
    if (items.length === 0) break;
    all.push(...items);
  }
  return all;
}

function AigcFlatView({
  onUpload,
  onPickFiles,
  refreshTick,
  pickerSelectedIds,
  onPickerToggleAsset,
  onPickerBlockedAsset,
  pickerMediaTypes,
  onPickerAssetRemoved,
  onPickerPreviewChange,
}: {
  onUpload?: () => void;
  onPickFiles?: (files: File[]) => void;
  refreshTick?: number;
  pickerSelectedIds?: ReadonlySet<string>;
  onPickerToggleAsset?: (asset: MaterialAsset) => void;
  onPickerBlockedAsset?: (asset: MaterialAsset) => void;
  pickerMediaTypes?: Array<'image' | 'video' | 'audio'>;
  onPickerAssetRemoved?: (assetId: string) => void;
  onPickerPreviewChange?: (open: boolean) => void;
}) {
  const [assets, setAssets] = useState<MaterialAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [previewAsset, setPreviewAsset] = useState<MaterialAsset | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const closePreview = () => setPreviewAsset(null);
  const pickerMode = Boolean(onPickerToggleAsset);

  useMaterialPreviewBridge(previewAsset, closePreview, pickerMode, onPickerPreviewChange);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const groups = await fetchAllAigcPages((pageNumber) =>
        listAssetGroups({
          Filter: { GroupType: 'AIGC' },
          PageNumber: pageNumber,
          PageSize: AIGC_PAGE_SIZE,
        }),
      );
      const groupIds = groups.map((g) => g.Id).filter(Boolean);
      if (groupIds.length === 0) {
        setAssets([]);
        return;
      }
      const collected: MaterialAsset[] = [];
      for (let i = 0; i < groupIds.length; i += AIGC_GROUP_BATCH_SIZE) {
        const batchGroupIds = groupIds.slice(i, i + AIGC_GROUP_BATCH_SIZE);
        const batchAssets = await fetchAllAigcPages((pageNumber) =>
          listAssets({
            Filter: { GroupIds: batchGroupIds, GroupType: 'AIGC' },
            PageNumber: pageNumber,
            PageSize: AIGC_PAGE_SIZE,
          }),
        );
        collected.push(...batchAssets);
      }
      setAssets(collected);
    } catch (err) {
      if (!isApiError(err)) toast.error('加载失败');
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets, refreshTick]);

  const hasProcessing = assets.some((a) => a.Status === 'Processing');
  useEffect(() => {
    if (!hasProcessing) return;
    const timer = setInterval(() => loadAssets(), 5000);
    return () => clearInterval(timer);
  }, [hasProcessing, loadAssets]);

  const handleDeleteAsset = (asset: MaterialAsset) => {
    setDeleteTarget({ id: asset.Id, name: asset.Name });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMaterialAsset(deleteTarget.id);
      setAssets((prev) => prev.filter((a) => a.Id !== deleteTarget.id));
      toast.success('已删除');
      setDeleteTarget(null);
      if (pickerMode) onPickerAssetRemoved?.(deleteTarget.id);
    } catch (err) {
      if (!isApiError(err)) toast.error('删除失败');
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <div className={styles.assetGrid}>
        <UploadMaterialCard onUpload={onUpload} onPickFiles={onPickFiles} />
        {assets.map((asset) => (
          <AssetPickerCard
            key={asset.Id}
            asset={asset}
            pickerMode={pickerMode}
            selected={pickerSelectedIds?.has(asset.Id) ?? false}
            selectable={!pickerMode || isPickerSelectableAsset(asset, pickerMediaTypes)}
            onPreview={setPreviewAsset}
            onPickerToggle={onPickerToggleAsset}
            onPickerBlocked={onPickerBlockedAsset}
            onDeleteAsset={handleDeleteAsset}
            onClosePreview={closePreview}
          />
        ))}
        {!onUpload && !onPickFiles && assets.length === 0 && !loading && !loadError && (
          <div className={styles.empty}>暂无素材，请上传</div>
        )}
        {(onUpload || onPickFiles) && assets.length === 0 && !loading && !loadError && (
          <div className={styles.empty}>点击上方上传素材</div>
        )}
      </div>

      {loading && (
        <div className={styles.loadingSpinner}>
          <Loader2 size={32} className={styles.spin} />
          <span>加载中...</span>
        </div>
      )}
      {!loading && loadError && <div className={styles.empty}>加载失败，请稍后重试</div>}

      {previewAsset && <MaterialDetailModal asset={previewAsset} onClose={closePreview} />}

      <ConfirmModal
        open={!!deleteTarget}
        title="删除素材"
        message={deleteTarget ? `确定要删除素材「${deleteTarget.name}」吗？此操作不可撤销。` : ''}
        confirmText="确认删除"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}


const AUTH_POLL_INTERVAL_MS = 5000;
const AUTH_TIMEOUT_MS = 30 * 60 * 1000;

export default function CharacterLibrary({
  groupType = 'AIGC',
  onDetailViewChange,
  onUpload,
  onPickFiles,
  refreshTick,
  pickerSelectedIds,
  onPickerToggleAsset,
  onPickerBlockedAsset,
  pickerMediaTypes,
  onPickerAssetRemoved,
  onPickerPreviewChange,
}: {
  groupType?: GroupType;
  onDetailViewChange?: (inDetail: boolean, groupId: string | null) => void;
  onUpload?: () => void;
  onPickFiles?: (files: File[]) => void;
  refreshTick?: number;
  pickerSelectedIds?: ReadonlySet<string>;
  onPickerToggleAsset?: (asset: MaterialAsset) => void;
  onPickerBlockedAsset?: (asset: MaterialAsset) => void;
  pickerMediaTypes?: Array<'image' | 'video' | 'audio'>;
  onPickerAssetRemoved?: (assetId: string) => void;
  onPickerPreviewChange?: (open: boolean) => void;
}) {
  const isLiveness = groupType === 'LivenessFace';

  useEffect(() => {
    if (!isLiveness) onDetailViewChange?.(false, null);
  }, [isLiveness, onDetailViewChange]);

  if (!isLiveness) {
    return (
      <AigcFlatView
        onUpload={onUpload}
        onPickFiles={onPickFiles}
        refreshTick={refreshTick}
        pickerSelectedIds={pickerSelectedIds}
        onPickerToggleAsset={onPickerToggleAsset}
        onPickerBlockedAsset={onPickerBlockedAsset}
        pickerMediaTypes={pickerMediaTypes}
        onPickerAssetRemoved={onPickerAssetRemoved}
        onPickerPreviewChange={onPickerPreviewChange}
      />
    );
  }

  return (
    <LivenessLibrary
      groupType={groupType}
      onDetailViewChange={onDetailViewChange}
      onUpload={onUpload}
      onPickFiles={onPickFiles}
      refreshTick={refreshTick}
      pickerSelectedIds={pickerSelectedIds}
      onPickerToggleAsset={onPickerToggleAsset}
      onPickerBlockedAsset={onPickerBlockedAsset}
      pickerMediaTypes={pickerMediaTypes}
      onPickerAssetRemoved={onPickerAssetRemoved}
      onPickerPreviewChange={onPickerPreviewChange}
    />
  );
}

function LivenessLibrary({
  groupType = 'AIGC',
  onDetailViewChange,
  onUpload,
  onPickFiles,
  refreshTick,
  pickerSelectedIds,
  onPickerToggleAsset,
  onPickerBlockedAsset,
  pickerMediaTypes,
  onPickerAssetRemoved,
  onPickerPreviewChange,
}: {
  groupType?: GroupType;
  onDetailViewChange?: (inDetail: boolean, groupId: string | null) => void;
  onUpload?: () => void;
  onPickFiles?: (files: File[]) => void;
  refreshTick?: number;
  pickerSelectedIds?: ReadonlySet<string>;
  onPickerToggleAsset?: (asset: MaterialAsset) => void;
  onPickerBlockedAsset?: (asset: MaterialAsset) => void;
  pickerMediaTypes?: Array<'image' | 'video' | 'audio'>;
  onPickerAssetRemoved?: (assetId: string) => void;
  onPickerPreviewChange?: (open: boolean) => void;
}) {
  const [groups, setGroups] = useState<MaterialGroup[]>([]);
  const [groupAssets, setGroupAssets] = useState<Map<string, MaterialAsset[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [detailGroupId, setDetailGroupId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'group' | 'asset'; id: string; name: string } | null>(null);

  const [authenticating, setAuthenticating] = useState(false);
  const [authSession, setAuthSession] = useState<{ H5Link: string; BytedToken: string; Name: string } | null>(null);
  const [resettingSession, setResettingSession] = useState(false);
  const authPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isLiveness = groupType === 'LivenessFace';

  const stopAuthPolling = useCallback(() => {
    if (authPollRef.current) {
      clearInterval(authPollRef.current);
      authPollRef.current = null;
    }
    setAuthenticating(false);
  }, []);

  useEffect(() => stopAuthPolling, [stopAuthPolling, groupType]);

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
        if (isApiError(err) && err.status === 401) {
          stopAuthPolling();
          setAuthSession(null);
        }
      }
    }, AUTH_POLL_INTERVAL_MS);
  }, [loadGroups, stopAuthPolling]);

  const handleViewGroup = useCallback((groupId: string) => {
    setDetailGroupId(groupId);
    void refreshGroupAssets(groupId);
  }, [refreshGroupAssets]);

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

  useEffect(() => {
    onDetailViewChange?.(detailGroupId !== null, detailGroupId);
  }, [detailGroupId, onDetailViewChange]);

  useEffect(() => {
    if (refreshTick === undefined || refreshTick === 0) return;
    if (detailGroupId) {
      refreshGroupAssets(detailGroupId);
    } else {
      loadGroups();
    }
  }, [refreshTick]); // eslint-disable-line react-hooks/exhaustive-deps


  const handleCreateGroup = async (name: string) => {
    if (isLiveness) {
      if (/[<>]/.test(name)) {
        toast.error('名称不能包含 < 或 > 字符');
        throw new Error('invalid name');
      }
      try {
        const session = await createVisualValidateSession(
          { Name: name, CallbackURL: `${window.location.origin}/auth-success` },
          { silent: true },
        );
        setShowCreateModal(false);
        setAuthSession({ H5Link: session.H5Link, BytedToken: session.BytedToken, Name: name });
        startAuthPolling(session.BytedToken);
      } catch (err) {
        if (!isApiError(err) || err.status !== 401) toast.error('发起真人认证失败，请稍后重试');
        throw err;
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
      if (!isApiError(err) || err.status !== 401) toast.error('新建分组失败，请稍后重试');
      throw err;
    }
  };

  const handleResetAuthSession = async () => {
    if (!authSession || resettingSession) return;
    setResettingSession(true);
    try {
      const session = await createVisualValidateSession(
        { Name: authSession.Name, CallbackURL: `${window.location.origin}/auth-success` },
        { silent: true },
      );
      setAuthSession({ H5Link: session.H5Link, BytedToken: session.BytedToken, Name: authSession.Name });
      startAuthPolling(session.BytedToken);
    } catch (err) {
      if (!isApiError(err) || err.status !== 401) toast.error('重新生成二维码失败，请重试');
    } finally {
      setResettingSession(false);
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
        if (onPickerToggleAsset) onPickerAssetRemoved?.(deleteTarget.id);
      }
      toast.success('已删除');
      setDeleteTarget(null);
    } catch (err) {
      if (deleteTarget.type === 'group') {
        if (!isApiError(err) || err.status !== 401) toast.error('分组删除失败，请稍后重试');
      } else if (!isApiError(err)) {
        toast.error('删除失败');
      }
      setDeleteTarget(null);
    }
  };


  const detailGroup = detailGroupId ? groups.find((g) => g.Id === detailGroupId) : null;
  const detailAssets = detailGroupId ? (groupAssets.get(detailGroupId) ?? []) : [];

  if (detailGroup) {
    return (
      <>
        <GroupDetail
          group={detailGroup}
          assets={detailAssets}
          onBack={() => setDetailGroupId(null)}
          onDeleteAsset={handleDeleteAsset}
          onUpload={onUpload}
          onPickFiles={onPickFiles}
          pickerSelectedIds={pickerSelectedIds}
          onPickerToggleAsset={onPickerToggleAsset}
          onPickerBlockedAsset={onPickerBlockedAsset}
          pickerMediaTypes={pickerMediaTypes}
          onPickerPreviewChange={onPickerPreviewChange}
        />

        {}
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
          {}
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

          {}
          {groups.map((group) => (
            <GroupCard
              key={group.Id}
              group={group}
              onView={() => handleViewGroup(group.Id)}
              onDelete={() => handleDeleteGroup(group)}
            />
          ))}

          {}
          {groups.length === 0 && (
            <div className={styles.empty}>
              {isLiveness
                ? '点击「新建真人」发起真人认证，认证通过后可上传素材'
                : '点击「新建分组」创建分组，分组内可上传虚拟人素材'}
            </div>
          )}
        </div>
      )}

      {}
      {showCreateModal && (
        <GroupFormModal
          title={isLiveness ? '新建真人' : '新建分组'}
          placeholder={isLiveness ? '请输入真人名称' : undefined}
          onConfirm={handleCreateGroup}
          onCancel={() => setShowCreateModal(false)}
        />
      )}

      {}
      {authSession && (
        <AuthQrModal
          h5Link={authSession.H5Link}
          onClose={() => {
            setAuthSession(null);
            stopAuthPolling();
          }}
          onCreateSession={handleResetAuthSession}
          creating={resettingSession}
        />
      )}

      {}
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
