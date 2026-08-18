/* ============================================
 * TemplateManage 模板管理：首页 dock 模板卡片增删改与标签改名
 * 数据源 GET/POST/PUT/DELETE /api/admin/templates
 * ============================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X, Pencil, Trash2, ChevronUp, ChevronDown, Film, Image as ImageIcon, Upload } from 'lucide-react';
import {
  fetchTemplateCards,
  createTemplateCard,
  updateTemplateCard,
  deleteTemplateCard,
  moveTemplateCard,
  fetchAdminTemplateTags,
  renameAdminTemplateTag,
  presignTemplateMedia,
  completeTemplateMedia,
  type TemplateCard,
  type TemplateCardPayload,
  type AdminTemplateTag,
} from '@/api/admin';
import { isApiError } from '@/api/http';
import ConfirmModal from '../../components/ConfirmModal';
import styles from './index.module.css';

/** 渲染形态：layout code ↔ 展示名 */
const LAYOUTS: { code: string; label: string }[] = [
  { code: 'wide', label: '横版视频卡' },
  { code: 'portrait', label: '竖版卡' },
  { code: 'social', label: '社媒小卡（9:16）' },
  { code: 'image', label: '图片卡' },
];

const layoutLabel = (code: string) => LAYOUTS.find((l) => l.code === code)?.label ?? code;

export default function TemplateManage() {
  const [tags, setTags] = useState<AdminTemplateTag[]>([]);
  const [templates, setTemplates] = useState<TemplateCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState<string>('all');
  const [renameCode, setRenameCode] = useState<string | null>(null);
  const [form, setForm] = useState<{ id?: string } | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState('');

  const tagName = (code: string) => tags.find((t) => t.tag_code === code)?.label ?? code;

  /** 刷新列表：页面加载 / 切换 tag 筛选 / 操作后 */
  const load = useCallback((tab: string) => {
    setLoading(true);
    setLoadError('');
    fetchTemplateCards(tab === 'all' ? undefined : tab)
      .then((list) => setTemplates([...list].sort((a, b) => a.sort_order - b.sort_order)))
      .catch((e) => setLoadError(isApiError(e) ? e.message : '获取模板列表失败'))
      .finally(() => setLoading(false));
  }, []);

  // 标签 tabs（后台标签接口）
  useEffect(() => {
    fetchAdminTemplateTags().then(setTags).catch(() => undefined);
  }, []);

  // 页面加载 / 切换 tab 刷新卡片列表
  useEffect(() => load(activeTab), [activeTab, load]);

  /** 排序：POST /:id/move（同 tag 内上移/下移，边缘后端返回 409），成功后刷新 */
  const move = async (id: string, dir: -1 | 1) => {
    setActionError('');
    try {
      await moveTemplateCard(id, dir === -1 ? 'up' : 'down');
      load(activeTab);
    } catch (e) {
      setActionError(isApiError(e) ? e.message : '排序失败，请稍后重试');
    }
  };

  /** 标签改名：PUT /api/admin/template-tags，成功后本地同步展示名 */
  const handleRename = async (code: string, label: string) => {
    await renameAdminTemplateTag(code, label);
    setTags((prev) => prev.map((t) => (t.tag_code === code ? { ...t, label } : t)));
    setRenameCode(null);
  };

  /** 新建/编辑提交：POST/PUT /api/admin/templates，成功后刷新列表 */
  const handleSubmit = async (data: TemplateCardPayload, id?: string) => {
    setActionError('');
    if (id !== undefined) {
      await updateTemplateCard(id, data);
    } else {
      await createTemplateCard(data);
    }
    setForm(null);
    load(activeTab);
  };

  /** 确认删除：DELETE /api/admin/templates/:id（软删除） */
  const confirmDelete = async () => {
    if (deleteId === null || deleting) return;
    setDeleting(true);
    setActionError('');
    try {
      await deleteTemplateCard(deleteId);
      setDeleteId(null);
      load(activeTab);
    } catch (e) {
      setActionError(isApiError(e) ? e.message : '删除失败，请稍后重试');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={styles.page}>
      {/* 页头 */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>模板管理</h1>
          <p className={styles.subtitle}>首页 dock 下方模板卡片的增删改与标签改名</p>
        </div>
        <button className={styles.primaryBtn} onClick={() => setForm({})}>
          <Plus size={16} strokeWidth={2} />
          <span>新建模板</span>
        </button>
      </div>

      {/* 操作错误 */}
      {actionError && <div className={styles.actionError}>{actionError}</div>}

      {/* 标签 tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'all' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('all')}
        >
          全部
        </button>
        {tags.map((t) => (
          <span className={styles.tabGroup} key={t.tag_code}>
            <button
              className={`${styles.tab} ${activeTab === t.tag_code ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(t.tag_code)}
            >
              {t.label}
            </button>
            <button
              className={styles.tabEdit}
              title="重命名标签"
              onClick={() => setRenameCode(t.tag_code)}
            >
              <Pencil size={13} strokeWidth={2} />
            </button>
          </span>
        ))}
      </div>

      {/* 模板表格 */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>标题</th>
              <th>标签</th>
              <th>形态</th>
              <th>排序</th>
              <th>资源</th>
              <th className={styles.thRight}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className={styles.tableState}>加载中…</td>
              </tr>
            )}
            {!loading && loadError && (
              <tr>
                <td colSpan={6} className={styles.tableState}>{loadError}</td>
              </tr>
            )}
            {!loading && !loadError && templates.length === 0 && (
              <tr>
                <td colSpan={6} className={styles.tableState}>暂无模板</td>
              </tr>
            )}
            {templates.map((t) => (
              <tr key={t.id}>
                <td>
                  <span className={styles.cellTitle}>{t.title}</span>
                  {!t.content && <span className={styles.cellSub}>（提示词待补）</span>}
                </td>
                <td>
                  <span className={styles.badge}>{tagName(t.tag_code)}</span>
                </td>
                <td>{layoutLabel(t.layout)}</td>
                <td className={styles.cellSort}>{t.sort_order}</td>
                <td>
                  <div className={styles.resGroup}>
                    {t.video_url && (
                      <span className={styles.resItem}>
                        <Film size={15} strokeWidth={2} />
                        <span>视频</span>
                      </span>
                    )}
                    {t.images.length > 0 && (
                      <span className={styles.resItem}>
                        <ImageIcon size={15} strokeWidth={2} />
                        <span>{t.images.length} 张</span>
                      </span>
                    )}
                    {!t.video_url && t.images.length === 0 && <span className={styles.dash}>—</span>}
                  </div>
                </td>
                <td>
                  <div className={styles.actionGroup}>
                    <button className={styles.iconBtn} title="上移" onClick={() => move(t.id, -1)}>
                      <ChevronUp size={15} strokeWidth={2} />
                    </button>
                    <button className={styles.iconBtn} title="下移" onClick={() => move(t.id, 1)}>
                      <ChevronDown size={15} strokeWidth={2} />
                    </button>
                    <button className={styles.iconBtn} title="编辑" onClick={() => setForm({ id: t.id })}>
                      <Pencil size={15} strokeWidth={2} />
                    </button>
                    <button
                      className={`${styles.iconBtn} ${styles.iconDanger}`}
                      title="删除"
                      onClick={() => setDeleteId(t.id)}
                    >
                      <Trash2 size={15} strokeWidth={2} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 标签改名弹窗 */}
      {renameCode !== null && (
        <RenameTagModal
          tag={tags.find((t) => t.tag_code === renameCode)!}
          onClose={() => setRenameCode(null)}
          onSave={(label) => handleRename(renameCode, label)}
        />
      )}

      {/* 新建/编辑模板弹窗 */}
      {form !== null && (
        <TemplateFormModal
          initial={form.id !== undefined ? templates.find((t) => t.id === form.id) : undefined}
          tags={tags}
          defaultTag={activeTab !== 'all' ? activeTab : undefined}
          onClose={() => setForm(null)}
          onSubmit={handleSubmit}
        />
      )}

      {/* 删除二次确认 */}
      {deleteId !== null && (
        <ConfirmModal
          title="删除模板"
          content={`确定要删除「${templates.find((t) => t.id === deleteId)?.title ?? ''}」吗？删除后首页立即不可见（数据可恢复）。`}
          confirmText={deleting ? '删除中…' : '确认删除'}
          onConfirm={confirmDelete}
          onClose={() => setDeleteId(null)}
        />
      )}
    </div>
  );
}

/* ============ 重命名标签弹窗 ============ */
function RenameTagModal({
  tag,
  onClose,
  onSave,
}: {
  tag: AdminTemplateTag;
  onClose: () => void;
  onSave: (label: string) => Promise<void>;
}) {
  const [label, setLabel] = useState(tag.label);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    if (saving || !label.trim()) return;
    setSaving(true);
    setError('');
    try {
      await onSave(label.trim());
    } catch (e) {
      setError(isApiError(e) ? e.message : '改名失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.smallModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle}>重命名标签（{tag.tag_code}）</h2>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
        <div className={styles.modalBody}>
          <p className={styles.hint}>tag_code 与顺序固定不可改，仅可修改显示名称。</p>
          <input
            className={styles.input}
            maxLength={128}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          {error && <div className={styles.formError}>{error}</div>}
        </div>
        <div className={styles.modalFoot}>
          <button className={styles.cancelBtn} onClick={onClose}>
            取消
          </button>
          <button className={styles.saveBtn} disabled={!label.trim() || saving} onClick={save}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ============ 新建/编辑模板弹窗 ============ */
interface TemplateFormModalProps {
  initial?: TemplateCard;
  tags: AdminTemplateTag[];
  defaultTag?: string;
  onClose: () => void;
  onSubmit: (data: TemplateCardPayload, id?: string) => Promise<void>;
}

function TemplateFormModal({ initial, tags, defaultTag, onClose, onSubmit }: TemplateFormModalProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [tag, setTag] = useState(initial?.tag_code ?? defaultTag ?? tags[0]?.tag_code ?? '');
  const [layout, setLayout] = useState(initial?.layout ?? 'wide');
  const [sort, setSort] = useState(initial !== undefined ? String(initial.sort_order) : '0');
  const [videoUrl, setVideoUrl] = useState(initial?.video_url ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  // 已有图片携带 id（编辑时保留），新增图片无 id
  const [images, setImages] = useState<{ id?: string; url: string }[]>(
    initial?.images.map((img) => ({ id: img.id, url: img.image_url })) ?? []
  );
  const [urlInput, setUrlInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);
  const imgFileRef = useRef<HTMLInputElement>(null);
  const videoFileRef = useRef<HTMLInputElement>(null);

  /** 三步上传：presign → PUT 直传 → complete，成功后将公网 URL 回填表单 */
  const uploadMedia = async (file: File, type: 'image' | 'video') => {
    const isImg = type === 'image';
    const okMime = isImg
      ? ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)
      : file.type === 'video/mp4';
    if (!okMime) {
      setFormError(isImg ? '图片仅支持 jpeg / png / webp / gif 格式' : '视频仅支持 mp4 格式');
      return;
    }
    if (file.size > (isImg ? 20 : 200) * 1024 * 1024) {
      setFormError(isImg ? '图片大小不能超过 20MB' : '视频大小不能超过 200MB');
      return;
    }
    setUploadBusy(true);
    setFormError('');
    try {
      const p = await presignTemplateMedia({ type, mime: file.type, size: file.size });
      const res = await fetch(p.upload_url, { method: 'PUT', headers: p.headers, body: file });
      if (!res.ok) throw new Error(`直传失败（HTTP ${res.status}）`);
      const done = await completeTemplateMedia({
        type,
        mime: file.type,
        size: file.size,
        storage_key: p.storage_key,
      });
      if (isImg) setImages((prev) => [...prev, { url: done.url }]);
      else setVideoUrl(done.url);
    } catch (e) {
      setFormError(e instanceof Error && e.message ? e.message : '上传失败，请稍后重试');
    } finally {
      setUploadBusy(false);
    }
  };

  const addUrl = () => {
    const url = urlInput.trim();
    if (!url) return;
    setImages((prev) => [...prev, { url }]);
    setUrlInput('');
  };

  const moveImage = (index: number, dir: -1 | 1) => {
    setImages((prev) => {
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const handleSave = async () => {
    if (saving) return;
    if (!title.trim() || !tag) return;
    const sortNum = parseInt(sort, 10);
    if (Number.isNaN(sortNum) || sortNum < 0) {
      setFormError('排序值须为非负整数');
      return;
    }
    if (videoUrl.trim() && !/^https?:\/\//.test(videoUrl.trim())) {
      setFormError('视频 URL 须以 http(s):// 开头');
      return;
    }
    if (images.some((img) => !/^https?:\/\//.test(img.url))) {
      setFormError('图片 URL 须以 http(s):// 开头');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await onSubmit(
        {
          title: title.trim(),
          tag_code: tag,
          layout,
          sort_order: sortNum,
          ...(videoUrl.trim() ? { video_url: videoUrl.trim() } : {}),
          ...(content.trim() ? { content: content.trim() } : {}),
          images: images.map((img) => ({
            ...(img.id ? { id: img.id } : {}),
            image_url: img.url,
          })),
        },
        initial?.id
      );
    } catch (e) {
      setFormError(isApiError(e) ? e.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHead}>
          <h2 className={styles.modalTitle}>{initial ? '编辑模板' : '新建模板'}</h2>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className={styles.modalBody}>
          <div className={styles.label}>
            标题 <span className={styles.required}>*</span>
          </div>
          <input
            className={styles.input}
            placeholder="模板卡片标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          <div className={styles.formRow}>
            <div>
              <div className={styles.label}>
                标签 <span className={styles.required}>*</span>
              </div>
              <select className={styles.select} value={tag} onChange={(e) => setTag(e.target.value)}>
                {tags.map((t) => (
                  <option key={t.tag_code} value={t.tag_code}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className={styles.label}>渲染形态</div>
              <select className={styles.select} value={layout} onChange={(e) => setLayout(e.target.value)}>
                {LAYOUTS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className={styles.label}>排序值</div>
              <input type="number" className={styles.input} value={sort} onChange={(e) => setSort(e.target.value)} />
            </div>
          </div>

          <div className={styles.label}>视频 URL（可选）</div>
          <div className={styles.imgAddRow}>
            <input
              className={styles.input}
              placeholder="https://...（hover 卡片时播放）"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
            />
            <button
              className={styles.ghostBtn}
              disabled={uploadBusy}
              onClick={() => videoFileRef.current?.click()}
            >
              <Upload size={15} strokeWidth={2} />
              <span>{uploadBusy ? '上传中…' : '上传视频'}</span>
            </button>
            <input
              ref={videoFileRef}
              type="file"
              accept="video/mp4"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadMedia(f, 'video');
                e.target.value = '';
              }}
            />
          </div>

          <div className={styles.label}>提示词 content（点击卡片时带入 dock 输入框；留空则兜底用标题）</div>
          <textarea
            className={styles.textarea}
            placeholder="模板提示词正文..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />

          <div className={styles.label}>图片列表（顺序即展示顺序，最多 20 张）</div>
          {images.length > 0 && (
            <div className={styles.imgList}>
              {images.map((img, i) => (
                <div className={styles.imgRow} key={`${img.url}-${i}`}>
                  <span className={styles.imgUrl} title={img.url}>
                    {img.url}
                  </span>
                  <button className={styles.iconBtn} title="上移" onClick={() => moveImage(i, -1)}>
                    <ChevronUp size={15} strokeWidth={2} />
                  </button>
                  <button className={styles.iconBtn} title="下移" onClick={() => moveImage(i, 1)}>
                    <ChevronDown size={15} strokeWidth={2} />
                  </button>
                  <button
                    className={`${styles.iconBtn} ${styles.iconDanger}`}
                    title="移除"
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={15} strokeWidth={2} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className={styles.imgAddRow}>
            <input
              className={styles.input}
              placeholder="粘贴图片 URL（http(s):// 开头）后点「添加」"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
            />
            <button className={styles.ghostBtn} onClick={addUrl}>
              添加
            </button>
            <button
              className={styles.ghostBtn}
              disabled={uploadBusy}
              onClick={() => imgFileRef.current?.click()}
            >
              <Upload size={15} strokeWidth={2} />
              <span>{uploadBusy ? '上传中…' : '上传图片'}</span>
            </button>
            <input
              ref={imgFileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadMedia(f, 'image');
                e.target.value = '';
              }}
            />
          </div>

          {formError && <div className={styles.formError}>{formError}</div>}
        </div>

        <div className={styles.modalFoot}>
          <button className={styles.cancelBtn} onClick={onClose}>
            取消
          </button>
          <button className={styles.saveBtn} disabled={!title.trim() || saving} onClick={handleSave}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
