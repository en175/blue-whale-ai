/* ============================================
 * TemplateManage 模板管理：首页 dock 模板卡片增删改与标签改名
 * 数据源 GET/POST/PUT/DELETE /api/admin/templates
 *
 * 呈现层全部走 @/admin/ui 的组件，**本页没有自己的样式文件**（原 index.module.css 已删）——
 * 这是「统一组件风格」的判据：页面只描述结构，样式一处定义在套件里。
 * ============================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown, Film, Image as ImageIcon, Upload, Eye, EyeOff } from 'lucide-react';
import {
  fetchTemplateCards,
  createTemplateCard,
  updateTemplateCard,
  deleteTemplateCard,
  moveTemplateCard,
  fetchAdminTemplateTags,
  renameAdminTemplateTag,
  setTemplateTagVisibility,
  presignTemplateMedia,
  completeTemplateMedia,
  type TemplateCard,
  type TemplateCardPayload,
  type AdminTemplateTag,
} from '@/api/admin';
import { isApiError } from '@/api/http';
import ConfirmModal from '../../components/ConfirmModal';
import {
  Alert,
  Badge,
  Button,
  Card,
  Chip,
  Empty,
  Input,
  Modal,
  Page,
  PageHeader,
  Select,
  Table,
  Textarea,
  Toolbar,
  Hint,
} from '../../ui';

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

  /** 标签隐藏开关（IKA64P）：PUT /api/admin/template-tags/visibility，成功后本地同步 */
  const toggleVisibility = async (code: string, next: number) => {
    setActionError('');
    try {
      await setTemplateTagVisibility(code, next);
      setTags((prev) => prev.map((t) => (t.tag_code === code ? { ...t, visible: next } : t)));
    } catch (e) {
      setActionError(isApiError(e) ? e.message : '切换失败，请稍后重试');
    }
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
    <Page>
      {/* 页头 */}
      <PageHeader
        title="模板管理"
        subtitle="首页 dock 下方模板卡片的增删改与标签改名"
        extra={
          <Button variant="primary" icon={<Plus size={16} strokeWidth={2} />} onClick={() => setForm({})}>
            新建模板
          </Button>
        }
      />

      {/* 操作错误：用户刚做的动作失败，用 danger 调子，不要塞进 Card */}
      {actionError && <Alert tone="danger">{actionError}</Alert>}

      <Card padded={false}>
        {/* 标签 tabs：点标签即筛选，标签右侧是改名与隐藏开关 */}
        <div style={{ padding: 'var(--admin-space-3)' }}>
          <Toolbar>
            <Chip active={activeTab === 'all'} onClick={() => setActiveTab('all')}>
              全部
            </Chip>
            {tags.map((t) => (
              <span
                key={t.tag_code}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}
              >
                <Chip active={activeTab === t.tag_code} onClick={() => setActiveTab(t.tag_code)}>
                  {t.label}
                  {t.visible === 0 && <Badge tone="neutral">已隐藏</Badge>}
                </Chip>
                <Button
                  size="sm"
                  variant="ghost"
                  title="重命名标签"
                  aria-label={`重命名标签 ${t.tag_code}`}
                  icon={<Pencil size={13} strokeWidth={2} />}
                  onClick={() => setRenameCode(t.tag_code)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  title={t.visible === 1 ? '隐藏该标签（首页不可见）' : '显示该标签（首页可见）'}
                  aria-label={`切换标签可见性 ${t.tag_code}`}
                  icon={
                    t.visible === 1 ? (
                      <Eye size={13} strokeWidth={2} />
                    ) : (
                      <EyeOff size={13} strokeWidth={2} />
                    )
                  }
                  onClick={() => toggleVisibility(t.tag_code, t.visible === 1 ? 0 : 1)}
                />
              </span>
            ))}
          </Toolbar>
        </div>

        {/* 模板表格 */}
        <Table>
          <thead>
            <tr>
              <th>标题</th>
              <th>标签</th>
              <th>形态</th>
              <th>排序</th>
              <th>资源</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6}>
                  <Empty message="加载中…" />
                </td>
              </tr>
            )}
            {!loading && loadError && (
              <tr>
                <td colSpan={6}>
                  <Empty
                    message={loadError}
                    extra={
                      <Button onClick={() => load(activeTab)}>重试</Button>
                    }
                  />
                </td>
              </tr>
            )}
            {!loading && !loadError && templates.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <Empty
                    message="暂无模板"
                    extra={
                      <Button variant="primary" onClick={() => setForm({})}>
                        新建模板
                      </Button>
                    }
                  />
                </td>
              </tr>
            )}
            {templates.map((t) => (
              <tr key={t.id}>
                <td>
                  {t.title}
                  {!t.content && <Badge tone="warning">提示词待补</Badge>}
                </td>
                <td>
                  <Badge tone="neutral">{tagName(t.tag_code)}</Badge>
                </td>
                <td>{layoutLabel(t.layout)}</td>
                <td>{t.sort_order}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {t.video_url && (
                      <Badge tone="neutral">
                        <Film size={15} strokeWidth={2} />
                        视频
                      </Badge>
                    )}
                    {t.images.length > 0 && (
                      <Badge tone="neutral">
                        <ImageIcon size={15} strokeWidth={2} />
                        {t.images.length} 张
                      </Badge>
                    )}
                    {!t.video_url && t.images.length === 0 && '—'}
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="上移"
                      aria-label="上移"
                      icon={<ChevronUp size={15} strokeWidth={2} />}
                      onClick={() => move(t.id, -1)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      title="下移"
                      aria-label="下移"
                      icon={<ChevronDown size={15} strokeWidth={2} />}
                      onClick={() => move(t.id, 1)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      title="编辑"
                      aria-label="编辑"
                      icon={<Pencil size={15} strokeWidth={2} />}
                      onClick={() => setForm({ id: t.id })}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      title="删除"
                      aria-label="删除"
                      icon={<Trash2 size={15} strokeWidth={2} />}
                      onClick={() => setDeleteId(t.id)}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

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
    </Page>
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

  return (
    <Modal
      open
      title={
        <>
          重命名标签（{tag.tag_code}）{' '}
          <Hint>tag_code 与顺序固定不可改，仅可修改显示名称。</Hint>
        </>
      }
      width={560}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!label.trim() || saving} onClick={save}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      <Input
        maxLength={128}
        value={label}
        aria-label="标签显示名称"
        onChange={(e) => setLabel(e.target.value)}
        style={{ width: '100%', marginTop: 12 }}
      />
      {error && (
        <div style={{ marginTop: 12 }}>
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </Modal>
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

  return (
    <Modal
      open
      title={initial ? '编辑模板' : '新建模板'}
      width={760}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" disabled={!title.trim() || saving} onClick={handleSave}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </>
      }
    >
      {/* 字段标签是「一行说明 + 控件」，套件暂无对应基元，这里只用一次性间距排布 */}
      <div style={{ marginBottom: 6 }}>
        标题 <Badge tone="danger">*</Badge>
      </div>
      <Input
        placeholder="模板卡片标题"
        value={title}
        aria-label="标题"
        onChange={(e) => setTitle(e.target.value)}
        style={{ width: '100%' }}
      />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1.4fr 1fr',
          gap: 20,
          marginTop: 22,
        }}
      >
        <div>
          <div style={{ marginBottom: 6 }}>
            标签 <Badge tone="danger">*</Badge>
          </div>
          <Select
            options={tags.map((t) => ({ value: t.tag_code, label: t.label }))}
            value={tag}
            onChange={setTag}
            aria-label="标签"
          />
        </div>
        <div>
          <div style={{ marginBottom: 6 }}>渲染形态</div>
          <Select
            options={LAYOUTS.map((l) => ({ value: l.code, label: l.label }))}
            value={layout}
            onChange={setLayout}
            aria-label="渲染形态"
          />
        </div>
        <div>
          <div style={{ marginBottom: 6 }}>排序值</div>
          <Input
            type="number"
            value={sort}
            aria-label="排序值"
            onChange={(e) => setSort(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={{ marginBottom: 6 }}>视频 URL（可选）</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Input
            placeholder="https://...（hover 卡片时播放）"
            value={videoUrl}
            aria-label="视频 URL"
            onChange={(e) => setVideoUrl(e.target.value)}
            style={{ flex: 1, minWidth: 0 }}
          />
          <Button
            disabled={uploadBusy}
            icon={<Upload size={15} strokeWidth={2} />}
            onClick={() => videoFileRef.current?.click()}
          >
            {uploadBusy ? '上传中…' : '上传视频'}
          </Button>
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
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={{ marginBottom: 6 }}>
          提示词 content（点击卡片时带入 dock 输入框；留空则兜底用标题）
        </div>
        <Textarea
          placeholder="模板提示词正文..."
          value={content}
          aria-label="提示词 content"
          onChange={(e) => setContent(e.target.value)}
        />
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={{ marginBottom: 6 }}>图片列表（顺序即展示顺序，最多 20 张）</div>
        {images.length > 0 && (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}
          >
            {images.map((img, i) => (
              <div key={`${img.url}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Input
                  readOnly
                  value={img.url}
                  title={img.url}
                  aria-label="图片 URL"
                  style={{ flex: 1, minWidth: 0 }}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  title="上移"
                  aria-label="图片上移"
                  icon={<ChevronUp size={15} strokeWidth={2} />}
                  onClick={() => moveImage(i, -1)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  title="下移"
                  aria-label="图片下移"
                  icon={<ChevronDown size={15} strokeWidth={2} />}
                  onClick={() => moveImage(i, 1)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  title="移除"
                  aria-label="移除图片"
                  icon={<Trash2 size={15} strokeWidth={2} />}
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                />
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Input
            placeholder="粘贴图片 URL（http(s):// 开头）后点「添加」"
            value={urlInput}
            aria-label="图片 URL 输入"
            onChange={(e) => setUrlInput(e.target.value)}
            style={{ flex: 1, minWidth: 0 }}
          />
          <Button onClick={addUrl}>添加</Button>
          <Button
            disabled={uploadBusy}
            icon={<Upload size={15} strokeWidth={2} />}
            onClick={() => imgFileRef.current?.click()}
          >
            {uploadBusy ? '上传中…' : '上传图片'}
          </Button>
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
      </div>

      {/* 表单保存/校验失败：danger 调子，别再塞进 Card */}
      {formError && (
        <div style={{ marginTop: 12 }}>
          <Alert tone="danger">{formError}</Alert>
        </div>
      )}
    </Modal>
  );
}
