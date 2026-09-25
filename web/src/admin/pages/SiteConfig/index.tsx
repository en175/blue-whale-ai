/* ============================================
 * SiteConfig 通用配置：首页背景图 / 视频增删改查、排序、启停与 TOS 上传
 * 数据源 /api/admin/site-config/homepage-heroes
 *
 * 呈现层全部走 ../../ui 的组件，**本页没有自己的样式文件**——
 * 与 SkillManage 同一条纪律：页面只描述结构，样式一处定义在套件里。
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
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/utils/remoteImageCors';
import auroraPoster from '@/assets/home-hero/aurora-poster.jpg';
import { Alert, Badge, Button, Checkbox, Empty, Modal, Page, PageHeader, Table } from '../../ui';

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

/** 长地址单元格：单行截断。只有布局属性，颜色/字号交给表格自己的样式 */
const urlCellStyle = {
  display: 'inline-block',
  maxWidth: 240,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  verticalAlign: 'bottom',
} as const;

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
    <Page>
      <PageHeader
        title="通用配置"
        subtitle={`首页封面图 / 视频（已启用 ${enabledCount}/${HOMEPAGE_HERO_MAX_ENABLED}）`}
        extra={
          <Button
            variant="primary"
            icon={<Plus size={16} strokeWidth={2} />}
            onClick={() => setForm({})}
          >
            新建条目
          </Button>
        }
      />

      {/* 首页默认兜底背景：说明这个接口不返回它，以及它从哪来 */}
      <Alert tone="info" title="首页默认兜底背景">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img
            src={auroraPoster}
            alt="首页默认兜底背景"
            style={{ width: 128, height: 72, flex: '0 0 auto', objectFit: 'cover', borderRadius: 8 }}
          />
          <div>
            <p style={{ margin: 0 }}>
              GET /api/site/homepage-heroes 仅返回已启用的后台条目，不包含此默认图。没有可播放条目时首页使用这张内置静态图；视频没有封面时也以它作为加载封面。
            </p>
            <code>web/src/assets/home-hero/aurora-poster.jpg</code>
          </div>
        </div>
      </Alert>

      {actionError && <Alert tone="danger">{actionError}</Alert>}

      <Table>
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
            <th style={{ textAlign: 'right' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.isPending && (
            <tr>
              <td colSpan={9}>
                <Empty message="加载中…" />
              </td>
            </tr>
          )}
          {list.isError && (
            <tr>
              <td colSpan={9}>
                <Empty
                  message={isApiError(list.error) ? list.error.message : '获取首页背景配置失败'}
                  extra={<Button onClick={() => void list.refetch()}>重试</Button>}
                />
              </td>
            </tr>
          )}
          {!list.isPending && !list.isError && items.length === 0 && (
            <tr>
              <td colSpan={9}>
                <Empty message="暂无首页背景条目" />
              </td>
            </tr>
          )}
          {items.map((row) => {
            const thumb = thumbOf(row);
            return (
              <tr
                key={row.id}
                data-testid={`hero-row-${row.id}`}
                // 拖拽中的行淡出（原来由私有样式 .dragging td 给，这里只剩这一个视觉态）
                style={draggedId === row.id ? { opacity: 0.45 } : undefined}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => moveByDrag(row.id)}
              >
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="拖动排序"
                    aria-label="拖动排序"
                    data-testid={`hero-drag-handle-${row.id}`}
                    icon={<GripVertical size={16} strokeWidth={2} />}
                    style={{ cursor: 'grab' }}
                    draggable={!busy}
                    disabled={busy}
                    onDragStart={() => setDraggedId(row.id)}
                    onDragEnd={() => setDraggedId(null)}
                  />
                </td>
                <td>
                  {thumb ? (
                    <img
                      src={resolveMediaSrc(thumb)}
                      crossOrigin={remoteImageCrossOrigin(thumb)}
                      alt=""
                      style={{ width: 72, height: 40, objectFit: 'cover', borderRadius: 6, display: 'block' }}
                    />
                  ) : (
                    <span>—</span>
                  )}
                </td>
                <td>
                  <Badge tone="accent">{row.media_type === 'image' ? '图片' : '视频'}</Badge>
                </td>
                <td>
                  {row.media_url ? (
                    <span style={urlCellStyle} title={row.media_url}>{row.media_url}</span>
                  ) : (
                    <Badge tone="warning">待填地址</Badge>
                  )}
                </td>
                <td>
                  {row.poster_url ? (
                    <span style={urlCellStyle} title={row.poster_url}>{row.poster_url}</span>
                  ) : (
                    <span>—</span>
                  )}
                </td>
                <td>
                  <Badge tone={row.enabled === 1 ? 'success' : 'neutral'}>
                    {row.enabled === 1 ? '启用' : '停用'}
                  </Badge>
                </td>
                <td>{row.sort_order}</td>
                <td>{fmtTime(row.updated_at)}</td>
                <td>
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      justifyContent: 'flex-end',
                      width: '100%',
                    }}
                  >
                    <Button
                      size="sm"
                      variant="ghost"
                      title={row.enabled === 1 ? '停用' : '启用'}
                      data-testid={`hero-toggle-${row.id}`}
                      disabled={busy}
                      icon={<Power size={15} strokeWidth={2} />}
                      onClick={() => {
                        setActionError('');
                        toggleMut.mutate(
                          { id: row.id, enabled: row.enabled === 1 ? 0 : 1 },
                          { onError: (e) => setActionError(errMsg(e, '启停失败，请稍后重试')) },
                        );
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      title="编辑"
                      icon={<Pencil size={15} strokeWidth={2} />}
                      onClick={() => setForm({ id: row.id })}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      title="删除"
                      data-testid={`hero-delete-${row.id}`}
                      icon={<Trash2 size={15} strokeWidth={2} />}
                      onClick={() => setDeleteId(row.id)}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>

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
    </Page>
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
      width={640}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={saving || uploadBusy} onClick={() => void handleSave()}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <div style={{ margin: '0 0 10px' }}>
        封面图 <span aria-hidden="true">*</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button
          icon={<Upload size={15} strokeWidth={2} />}
          disabled={uploadBusy}
          onClick={() => posterFileRef.current?.click()}
        >
          上传封面图
        </Button>
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
        {coverUrl && <Badge tone="success">已上传</Badge>}
      </div>
      {hasCoverPreview && (
        <div style={{ marginTop: 14 }}>
          <div style={{ marginBottom: 8 }}>封面图预览</div>
          <img
            data-testid="hero-cover-preview"
            src={resolveMediaSrc(coverUrl)}
            crossOrigin={remoteImageCrossOrigin(coverUrl)}
            alt="封面图预览"
            style={{ display: 'block', width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 10 }}
          />
        </div>
      )}

      <div style={{ margin: '22px 0 10px' }}>
        背景视频 <span>（可选）</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button
          icon={<Upload size={15} strokeWidth={2} />}
          disabled={uploadBusy}
          onClick={() => mediaFileRef.current?.click()}
        >
          上传视频
        </Button>
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
        {videoUrl && <Badge tone="success">已上传</Badge>}
      </div>
      {hasVideoPreview && (
        <div style={{ marginTop: 14 }}>
          <div style={{ marginBottom: 8 }}>背景视频预览</div>
          <video
            data-testid="hero-video-preview"
            src={videoUrl}
            poster={hasCoverPreview ? coverUrl : undefined}
            controls
            muted
            playsInline
            preload="metadata"
            style={{ display: 'block', width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 10 }}
          >
            当前浏览器不支持视频预览。
          </video>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 24 }}>
        <span>启用（进首页轮播）</span>
        <Checkbox checked={enabled} onChange={setEnabled} aria-label="启用" />
      </div>
      {atCap && (
        <div style={{ marginTop: 12 }}>
          <Alert tone="info">
            已启用 {HOMEPAGE_HERO_MAX_ENABLED} 条，新建默认停用；再启用会返回 409。
          </Alert>
        </div>
      )}
      {formError && (
        <div style={{ marginTop: 12 }}>
          <Alert tone="danger">{formError}</Alert>
        </div>
      )}
    </Modal>
  );
}
