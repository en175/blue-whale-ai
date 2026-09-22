/* ============================================
 * SiteConfig 通用配置：首页背景图 / 视频增删改查、排序、启停与 TOS 上传
 * 数据源 /api/admin/site-config/homepage-heroes
 * ============================================ */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Pencil,
  Trash2,
  Power,
  Upload,
  GripVertical,
} from 'lucide-react';
import {
  adminHomepageHeroesOptions,
  createHomepageHero,
  deleteHomepageHero,
  homepageHeroKeys,
  HOMEPAGE_HERO_MAX_ENABLED,
  sortHomepageHero,
  updateHomepageHero,
  uploadHomepageHeroFile,
  type HomepageHeroAdmin,
  type HomepageHeroPayload,
} from '@/api/homepageHeroes';
import { isApiError } from '@/api/http';
import ConfirmModal from '../../components/ConfirmModal';
import Modal from '@/components/Modal';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/utils/remoteImageCors';
import auroraPoster from '@/assets/home-hero/aurora-poster.jpg';
import styles from './index.module.css';

const fmtTime = (iso: string) => new Date(iso).toLocaleString('zh-CN', { hour12: false });

const errMsg = (e: unknown, fallback: string) => (isApiError(e) ? e.message : fallback);

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function thumbOf(row: HomepageHeroAdmin): string | null {
  if (row.poster_url) return row.poster_url;
  if (row.media_type === 'image' && row.media_url) return row.media_url;
  return null;
}

export default function SiteConfig() {
  const queryClient = useQueryClient();
  const list = useQuery(adminHomepageHeroesOptions());
  const [form, setForm] = useState<{ id?: string } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const items = list.data ?? [];
  const enabledCount = items.filter((row) => row.enabled === 1).length;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: homepageHeroKeys.all });
  };

  const sortMut = useMutation({
    mutationFn: async ({ id, direction, steps }: { id: string; direction: 'up' | 'down'; steps: number }) => {
      for (let step = 0; step < steps; step += 1) {
        await sortHomepageHero(id, direction);
      }
    },
    onSettled: invalidate,
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: number }) =>
      updateHomepageHero(id, { enabled }),
    onSuccess: invalidate,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteHomepageHero(id),
    onSuccess: () => {
      setDeleteId(null);
      invalidate();
    },
  });

  const saveMut = useMutation({
    mutationFn: async ({ id, payload }: { id?: string; payload: HomepageHeroPayload }) => {
      if (id) return updateHomepageHero(id, payload, { silent: true });
      return createHomepageHero(payload, { silent: true });
    },
    onSuccess: () => {
      setForm(null);
      invalidate();
    },
  });

  const busy = sortMut.isPending || toggleMut.isPending || deleteMut.isPending;

  const moveByDrag = (targetId: string) => {
    const sourceId = draggedId;
    setDraggedId(null);
    if (!sourceId || sourceId === targetId || busy) return;

    const fromIndex = items.findIndex((item) => item.id === sourceId);
    const toIndex = items.findIndex((item) => item.id === targetId);
    if (fromIndex < 0 || toIndex < 0) return;

    setActionError('');
    sortMut.mutate(
      {
        id: sourceId,
        direction: fromIndex < toIndex ? 'down' : 'up',
        steps: Math.abs(toIndex - fromIndex),
      },
      { onError: (error) => setActionError(errMsg(error, '排序失败，请稍后重试')) },
    );
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>通用配置</h1>
          <p className={styles.subtitle}>
            首页封面图 / 视频（已启用 {enabledCount}/{HOMEPAGE_HERO_MAX_ENABLED}）
          </p>
        </div>
        <button className={styles.primaryBtn} onClick={() => setForm({})}>
          <Plus size={16} strokeWidth={2} />
          <span>新建条目</span>
        </button>
      </div>

      <section className={styles.fallbackInfo} aria-label="首页默认背景说明">
        <img className={styles.fallbackThumb} src={auroraPoster} alt="首页默认兜底背景" />
        <div>
          <h2 className={styles.fallbackTitle}>首页默认兜底背景</h2>
          <p className={styles.fallbackText}>
            GET /api/site/homepage-heroes 仅返回已启用的后台条目，不包含此默认图。没有可播放条目时首页使用这张内置静态图；视频没有封面时也以它作为加载封面。
          </p>
          <code className={styles.fallbackPath}>web/src/assets/home-hero/aurora-poster.jpg</code>
        </div>
      </section>

      {actionError && <div className={styles.actionError}>{actionError}</div>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>拖拽排序</th>
              <th>预览</th>
              <th>类型</th>
              <th>媒体</th>
              <th>封面</th>
              <th>启用</th>
              <th>当前顺序</th>
              <th>更新时间</th>
              <th className={styles.thRight}>操作</th>
            </tr>
          </thead>
          <tbody>
            {list.isPending && (
              <tr>
                <td colSpan={9} className={styles.tableState}>加载中…</td>
              </tr>
            )}
            {list.isError && (
              <tr>
                <td colSpan={9} className={styles.tableState}>
                  {isApiError(list.error) ? list.error.message : '获取首页背景配置失败'}
                </td>
              </tr>
            )}
            {!list.isPending && !list.isError && items.length === 0 && (
              <tr>
                <td colSpan={9} className={styles.tableState}>暂无首页背景条目</td>
              </tr>
            )}
            {items.map((row) => {
              const thumb = thumbOf(row);
              return (
                <tr
                  key={row.id}
                  data-testid={`hero-row-${row.id}`}
                  className={draggedId === row.id ? styles.dragging : undefined}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => moveByDrag(row.id)}
                >
                  <td className={styles.dragCell}>
                    <button
                      type="button"
                      className={`${styles.iconBtn} ${styles.dragHandle}`}
                      title="拖动排序"
                      aria-label="拖动排序"
                      data-testid={`hero-drag-handle-${row.id}`}
                      draggable={!busy}
                      disabled={busy}
                      onDragStart={() => setDraggedId(row.id)}
                      onDragEnd={() => setDraggedId(null)}
                    >
                      <GripVertical size={16} strokeWidth={2} />
                    </button>
                  </td>
                  <td>
                    {thumb ? (
                      <img className={styles.thumb} src={resolveMediaSrc(thumb)} crossOrigin={remoteImageCrossOrigin(thumb)} alt="" />
                    ) : (
                      <span className={styles.dash}>—</span>
                    )}
                  </td>
                  <td className={styles.cellType}>{row.media_type === 'image' ? '图片' : '视频'}</td>
                  <td>
                    {row.media_url ? (
                      <span className={styles.cellUrl} title={row.media_url}>{row.media_url}</span>
                    ) : (
                      <span className={styles.pendingMark}>待填地址</span>
                    )}
                  </td>
                  <td>
                    {row.poster_url ? (
                      <span className={styles.cellUrl} title={row.poster_url}>{row.poster_url}</span>
                    ) : (
                      <span className={styles.dash}>—</span>
                    )}
                  </td>
                  <td>
                    <span className={row.enabled === 1 ? styles.badgeOn : styles.badgeOff}>
                      {row.enabled === 1 ? '启用' : '停用'}
                    </span>
                  </td>
                  <td className={styles.cellSort}>{row.sort_order}</td>
                  <td className={styles.cellTime}>{fmtTime(row.updated_at)}</td>
                  <td>
                    <div className={styles.actionGroup}>
                      <button
                        className={styles.iconBtn}
                        title={row.enabled === 1 ? '停用' : '启用'}
                        data-testid={`hero-toggle-${row.id}`}
                        disabled={busy}
                        onClick={() => {
                          setActionError('');
                          toggleMut.mutate(
                            { id: row.id, enabled: row.enabled === 1 ? 0 : 1 },
                            { onError: (e) => setActionError(errMsg(e, '启停失败，请稍后重试')) },
                          );
                        }}
                      >
                        <Power size={15} strokeWidth={2} />
                      </button>
                      <button className={styles.iconBtn} title="编辑" onClick={() => setForm({ id: row.id })}>
                        <Pencil size={15} strokeWidth={2} />
                      </button>
                      <button
                        className={`${styles.iconBtn} ${styles.iconDanger}`}
                        title="删除"
                        data-testid={`hero-delete-${row.id}`}
                        onClick={() => setDeleteId(row.id)}
                      >
                        <Trash2 size={15} strokeWidth={2} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {form !== null && (
        <HeroFormModal
          initial={form.id !== undefined ? items.find((row) => row.id === form.id) : undefined}
          enabledCount={enabledCount}
          saving={saveMut.isPending}
          onClose={() => {
            saveMut.reset();
            setForm(null);
          }}
          onSubmit={(payload, id) => saveMut.mutateAsync({ id, payload })}
        />
      )}

      {deleteId !== null && (
        <ConfirmModal
          title="删除首页背景"
          content={`确定删除该${items.find((row) => row.id === deleteId)?.media_type === 'image' ? '图片' : '视频'}条目吗？删除后无法恢复，需重新上传。`}
          confirmText={deleteMut.isPending ? '删除中…' : '确认删除'}
          onConfirm={() => {
            if (deleteMut.isPending) return;
            setActionError('');
            deleteMut.mutate(deleteId, {
              onError: (e) => setActionError(errMsg(e, '删除失败，请稍后重试')),
            });
          }}
          onClose={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}

interface HeroFormModalProps {
  initial?: HomepageHeroAdmin;
  enabledCount: number;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: HomepageHeroPayload, id?: string) => Promise<unknown>;
}

function HeroFormModal({ initial, enabledCount, saving, onClose, onSubmit }: HeroFormModalProps) {
  const atCap = enabledCount >= HOMEPAGE_HERO_MAX_ENABLED && initial?.enabled !== 1;
  const [coverUrl, setCoverUrl] = useState(
    initial?.media_type === 'video' ? initial.poster_url ?? '' : initial?.media_url ?? '',
  );
  const [videoUrl, setVideoUrl] = useState(
    initial?.media_type === 'video' ? initial.media_url : '',
  );
  const [enabled, setEnabled] = useState((initial?.enabled ?? (atCap ? 0 : 1)) === 1);
  const [formError, setFormError] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);
  const mediaFileRef = useRef<HTMLInputElement>(null);
  const posterFileRef = useRef<HTMLInputElement>(null);

  const hasCoverPreview = isHttpUrl(coverUrl);
  const hasVideoPreview = isHttpUrl(videoUrl);

  const upload = async (file: File, target: 'cover' | 'video') => {
    const type = target === 'cover' ? 'image' : 'video';
    setUploadBusy(true);
    setFormError('');
    try {
      const url = await uploadHomepageHeroFile(file, type);
      if (target === 'cover') setCoverUrl(url);
      else setVideoUrl(url);
    } catch (e) {
      setFormError(e instanceof Error && e.message ? e.message : '上传失败，请稍后重试');
    } finally {
      setUploadBusy(false);
    }
  };

  const handleSave = async () => {
    if (saving || uploadBusy) return;
    const cover = coverUrl.trim();
    const video = videoUrl.trim();
    if (!cover) {
      setFormError('请先上传封面图');
      return;
    }
    setFormError('');
    try {
      await onSubmit(
        {
          media_type: video ? 'video' : 'image',
          media_url: video || cover,
          poster_url: video ? cover : null,
          enabled: enabled ? 1 : 0,
        },
        initial?.id,
      );
    } catch (e) {
      setFormError(errMsg(e, '保存失败，请稍后重试'));
    }
  };

  return (
    <Modal
      open
      title={initial ? '编辑首页背景' : '新建首页背景'}
      ariaLabel={initial ? '编辑首页背景' : '新建首页背景'}
      width={640}
      okText={saving ? '保存中…' : '保存'}
      confirmLoading={saving}
      okButtonProps={{ disabled: uploadBusy }}
      onOk={() => void handleSave()}
      onCancel={onClose}
      classNames={{
        container: styles.modal,
        body: styles.modalBody,
        footer: styles.modalFoot,
      }}
    >
          <div className={styles.label}>
            封面图 <span className={styles.required}>*</span>
          </div>
          <div className={styles.imgAddRow}>
            <button
              type="button"
              className={styles.ghostBtn}
              disabled={uploadBusy}
              onClick={() => posterFileRef.current?.click()}
            >
              <Upload size={15} strokeWidth={2} />
              上传封面图
            </button>
            <input
              data-testid="hero-cover-upload"
              ref={posterFileRef}
              type="file"
              hidden
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void upload(file, 'cover');
              }}
            />
            {coverUrl && <span className={styles.uploadedMark}>已上传</span>}
          </div>
          {hasCoverPreview && (
            <div className={styles.previewPanel}>
              <span className={styles.previewTitle}>封面图预览</span>
              <img
                data-testid="hero-cover-preview"
                className={styles.preview}
                src={resolveMediaSrc(coverUrl)}
                crossOrigin={remoteImageCrossOrigin(coverUrl)}
                alt="封面图预览"
              />
            </div>
          )}

          <div className={styles.label}>
            背景视频 <span className={styles.labelSub}>（可选）</span>
          </div>
          <div className={styles.imgAddRow}>
            <button
              type="button"
              className={styles.ghostBtn}
              disabled={uploadBusy}
              onClick={() => mediaFileRef.current?.click()}
            >
              <Upload size={15} strokeWidth={2} />
              上传视频
            </button>
            <input
              data-testid="hero-video-upload"
              ref={mediaFileRef}
              type="file"
              hidden
              accept="video/mp4"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void upload(file, 'video');
              }}
            />
            {videoUrl && <span className={styles.uploadedMark}>已上传</span>}
          </div>
          {hasVideoPreview && (
            <div className={styles.previewPanel}>
              <span className={styles.previewTitle}>背景视频预览</span>
              <video
                data-testid="hero-video-preview"
                className={styles.preview}
                src={videoUrl}
                poster={hasCoverPreview ? coverUrl : undefined}
                controls
                muted
                playsInline
                preload="metadata"
              >
                当前浏览器不支持视频预览。
              </video>
            </div>
          )}

          <div className={styles.switchRow}>
            <span className={styles.switchLabel}>启用（进首页轮播）</span>
            <button
              type="button"
              className={`${styles.switch} ${enabled ? styles.switchOn : ''}`}
              aria-label="启用"
              onClick={() => setEnabled((v) => !v)}
            >
              <span className={styles.knob} />
            </button>
          </div>
          {atCap && (
            <p className={styles.hint}>已启用 {HOMEPAGE_HERO_MAX_ENABLED} 条，新建默认停用；再启用会返回 409。</p>
          )}
          {formError && <div className={styles.formError}>{formError}</div>}
    </Modal>
  );
}
