"use client";

/**
 * 模板管理（IK764F）：首页模板卡片增删改 + tag 改名。
 *
 * 形态（grilling 共识）：tag 筛选条 + 卡片列表（编辑/删除/上移/下移）+
 * 新建/编辑弹窗（title/tag/layout/sort_order/video_url/content/图片管理）。
 * 图片在弹窗内本地增删与调序，保存时整体同步（入参顺序 = sort_order）。
 * 前端样式不自适应（本期明确不做）：layout 四选一，对应首页既有渲染分支。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  Image as ImageIcon,
  Film,
  Upload,
} from "lucide-react";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "../_components/ui/table";
import { Badge } from "../_components/ui/badge";
import { Dialog } from "../_components/ui/dialog";
import { Input } from "../_components/ui/input";
import { Select } from "../_components/ui/select";
import {
  TEMPLATE_UPLOAD_ACCEPT,
  validateTemplateUploadFile,
} from "@/lib/uploadRules";
import type { AdminTag, AdminTemplateCard, TemplateFormData } from "./data";
import {
  LAYOUT_OPTIONS,
  createTemplate,
  deleteTemplate,
  getAdminTags,
  getTemplates,
  layoutLabel,
  moveTemplate,
  renameTag,
  updateTemplate,
  uploadTemplateMedia,
} from "./data";

const EMPTY_FORM: TemplateFormData = {
  title: "",
  tag_code: "",
  layout: "wide",
  sort_order: 0,
  video_url: "",
  content: "",
  images: [],
};

export default function AdminTemplatesPage() {
  const [cards, setCards] = useState<AdminTemplateCard[]>([]);
  const [tags, setTags] = useState<AdminTag[]>([]);
  const [filterTag, setFilterTag] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 新建/编辑弹窗
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminTemplateCard | null>(null);
  const [form, setForm] = useState<TemplateFormData>(EMPTY_FORM);
  const [newImageUrl, setNewImageUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 图片上传（IK7JVE）：占位行显示进度，成功回填 URL，失败移除占位 + 提示。
  const [uploadTasks, setUploadTasks] = useState<
    Array<{ id: number; name: string; progress: number }>
  >([]);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextUploadId = useRef(1);
  // 弹窗会话：每次开弹窗 +1，作废上一个会话的飞行中上传——关闭后完成的回调
  // 直接丢弃（孤儿对象按 grilling Q4 接受），防止 URL 串到下一个表单（评审跟进）。
  const dialogSession = useRef(0);

  // 删除确认
  const [deleting, setDeleting] = useState<AdminTemplateCard | null>(null);

  // tag 改名
  const [renamingTag, setRenamingTag] = useState<AdminTag | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // 拉取：reloadKey 驱动（事件处理器里 refresh() 置 loading + 递增，
  // effect 内只在 await 后 setState，避免同步 setState 级联渲染）。
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = useCallback(() => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [cardsData, tagsData] = await Promise.all([
          getTemplates(filterTag === "all" ? undefined : filterTag),
          getAdminTags(),
        ]);
        if (!active) return;
        setCards(cardsData);
        setTags(tagsData);
        setError(null);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [filterTag, reloadKey]);

  const tagLabel = (code: string) =>
    tags.find((t) => t.tag_code === code)?.label ?? code;

  const openCreate = () => {
    setEditing(null);
    setForm({
      ...EMPTY_FORM,
      tag_code: filterTag !== "all" ? filterTag : (tags[0]?.tag_code ?? ""),
      sort_order: cards.length,
    });
    setNewImageUrl("");
    setUploadTasks([]);
    setUploadMessage(null);
    setFormError(null);
    dialogSession.current += 1;
    setDialogOpen(true);
  };

  const openEdit = (card: AdminTemplateCard) => {
    setEditing(card);
    setForm({
      title: card.title,
      tag_code: card.tag_code,
      layout: card.layout,
      sort_order: card.sort_order,
      video_url: card.video_url ?? "",
      content: card.content ?? "",
      images: card.images.map((img) => ({
        id: img.id,
        image_url: img.image_url,
      })),
    });
    setNewImageUrl("");
    setUploadTasks([]);
    setUploadMessage(null);
    setFormError(null);
    dialogSession.current += 1;
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      setFormError("标题必填");
      return;
    }
    if (!form.tag_code) {
      setFormError("请选择标签");
      return;
    }
    // 保存时自动收编输入框里尚未点「添加」的图片 URL，避免静默丢弃（IK764F 联调修复）。
    const pendingUrl = newImageUrl.trim();
    const payload: TemplateFormData = pendingUrl
      ? { ...form, images: [...form.images, { image_url: pendingUrl }] }
      : form;
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await updateTemplate(editing.id, payload);
      } else {
        await createTemplate(payload);
      }
      setNewImageUrl("");
      setDialogOpen(false);
      refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteTemplate(deleting.id);
      setDeleting(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
      setDeleting(null);
    }
  };

  const handleMove = async (
    card: AdminTemplateCard,
    direction: "up" | "down",
  ) => {
    try {
      await moveTemplate(card.id, direction);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "调序失败");
    }
  };

  const handleRename = async () => {
    if (!renamingTag || !renameValue.trim()) return;
    try {
      await renameTag(renamingTag.tag_code, renameValue.trim());
      setRenamingTag(null);
      refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "改名失败");
    }
  };

  // ---- 弹窗内图片本地管理（保存时整体同步） ----

  const addImage = () => {
    const url = newImageUrl.trim();
    if (!url) return;
    setForm((f) => ({ ...f, images: [...f.images, { image_url: url }] }));
    setNewImageUrl("");
  };

  const removeImage = (index: number) => {
    setForm((f) => ({
      ...f,
      images: f.images.filter((_, i) => i !== index),
    }));
  };

  const moveImageLocal = (index: number, direction: "up" | "down") => {
    setForm((f) => {
      const next = [...f.images];
      const swap = direction === "up" ? index - 1 : index + 1;
      if (swap < 0 || swap >= next.length) return f;
      const tmp = next[index]!;
      next[index] = next[swap]!;
      next[swap] = tmp;
      return { ...f, images: next };
    });
  };

  // ---- 图片文件上传（IK7JVE）：单文件直传，占位行进度，成功转 URL 行 ----

  const handleUploadFile = async (file: File) => {
    const validation = validateTemplateUploadFile(file);
    if (!validation.ok) {
      setUploadMessage(validation.reason);
      return;
    }
    const session = dialogSession.current; // 捕获会话：弹窗关闭后完成的回调直接丢弃
    const taskId = nextUploadId.current++;
    setUploadTasks((tasks) => [
      ...tasks,
      { id: taskId, name: file.name, progress: 0 },
    ]);
    setUploadMessage(null);
    try {
      const url = await uploadTemplateMedia(file, validation.kind, (pct) => {
        setUploadTasks((tasks) =>
          tasks.map((task) =>
            task.id === taskId ? { ...task, progress: pct } : task,
          ),
        );
      });
      if (dialogSession.current !== session) return;
      setUploadTasks((tasks) => tasks.filter((task) => task.id !== taskId));
      setForm((f) => ({ ...f, images: [...f.images, { image_url: url }] }));
    } catch (e) {
      if (dialogSession.current !== session) return;
      setUploadTasks((tasks) => tasks.filter((task) => task.id !== taskId));
      setUploadMessage(e instanceof Error ? e.message : "上传失败，请重试");
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleUploadFile(file);
    e.target.value = ""; // 允许重复选择同一文件
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--tc-text-primary)]">
            模板管理
          </h1>
          <p className="mt-1 text-sm text-[var(--tc-text-muted)]">
            首页 dock 下方模板卡片的增删改与标签改名
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 rounded-lg bg-[var(--tc-accent,#3b82f6)] px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          新建模板
        </button>
      </div>

      {/* tag 筛选条 + 改名入口 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilterTag("all")}
          className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
            filterTag === "all"
              ? "bg-[var(--tc-accent,#3b82f6)] text-white"
              : "bg-[var(--tc-bg-surface)] text-[var(--tc-text-secondary)] hover:text-[var(--tc-text-primary)]"
          }`}
        >
          全部
        </button>
        {tags.map((tag) => (
          <span key={tag.tag_code} className="flex items-center gap-0.5">
            <button
              onClick={() => setFilterTag(tag.tag_code)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                filterTag === tag.tag_code
                  ? "bg-[var(--tc-accent,#3b82f6)] text-white"
                  : "bg-[var(--tc-bg-surface)] text-[var(--tc-text-secondary)] hover:text-[var(--tc-text-primary)]"
              }`}
            >
              {tag.label}
            </button>
            <button
              onClick={() => {
                setRenamingTag(tag);
                setRenameValue(tag.label);
                setFormError(null);
              }}
              title={`重命名「${tag.label}」`}
              className="rounded p-1 text-[var(--tc-text-muted)] transition-colors hover:text-[var(--tc-text-primary)]"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[var(--tc-destructive,#ef4444)]/30 bg-[var(--tc-destructive,#ef4444)]/10 px-4 py-2 text-sm text-[var(--tc-destructive,#ef4444)]">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-[var(--tc-border)] bg-[var(--tc-bg-surface)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>标题</TableHead>
              <TableHead>标签</TableHead>
              <TableHead>形态</TableHead>
              <TableHead>排序</TableHead>
              <TableHead>资源</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-[var(--tc-text-muted)]"
                >
                  加载中…
                </TableCell>
              </TableRow>
            ) : cards.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-[var(--tc-text-muted)]"
                >
                  暂无模板卡片
                </TableCell>
              </TableRow>
            ) : (
              cards.map((card) => (
                <TableRow key={card.id}>
                  <TableCell className="max-w-[240px] truncate font-medium text-[var(--tc-text-primary)]">
                    {card.title}
                    {(card.content ?? "").trim() === "" && (
                      <span className="ml-2 text-xs text-[var(--tc-text-muted)]">
                        （提示词待补）
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{tagLabel(card.tag_code)}</Badge>
                  </TableCell>
                  <TableCell className="text-[var(--tc-text-secondary)]">
                    {layoutLabel(card.layout)}
                  </TableCell>
                  <TableCell className="font-mono text-[var(--tc-text-secondary)]">
                    {card.sort_order}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-3 text-[var(--tc-text-secondary)]">
                      {card.video_url ? (
                        <span className="flex items-center gap-1">
                          <Film className="h-3.5 w-3.5" />
                          视频
                        </span>
                      ) : null}
                      {card.images.length > 0 && (
                        <span className="flex items-center gap-1">
                          <ImageIcon className="h-3.5 w-3.5" />
                          {card.images.length} 张
                        </span>
                      )}
                      {!card.video_url && card.images.length === 0 && "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => void handleMove(card, "up")}
                        title="上移"
                        className="rounded p-1.5 text-[var(--tc-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--tc-text-primary)]"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => void handleMove(card, "down")}
                        title="下移"
                        className="rounded p-1.5 text-[var(--tc-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--tc-text-primary)]"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => openEdit(card)}
                        title="编辑"
                        className="rounded p-1.5 text-[var(--tc-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--tc-accent,#3b82f6)]"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleting(card)}
                        title="删除"
                        className="rounded p-1.5 text-[var(--tc-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--tc-destructive,#ef4444)]"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 新建/编辑弹窗 */}
      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editing ? "编辑模板" : "新建模板"}
        width={560}
      >
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm text-[var(--tc-text-secondary)]">
              标题 *
            </label>
            <Input
              value={form.title}
              onChange={(e) =>
                setForm((f) => ({ ...f, title: e.target.value }))
              }
              placeholder="模板卡片标题"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-sm text-[var(--tc-text-secondary)]">
                标签 *
              </label>
              <Select
                value={form.tag_code}
                onChange={(e) =>
                  setForm((f) => ({ ...f, tag_code: e.target.value }))
                }
                options={tags.map((t) => ({
                  value: t.tag_code,
                  label: t.label,
                }))}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-[var(--tc-text-secondary)]">
                渲染形态
              </label>
              <Select
                value={form.layout}
                onChange={(e) =>
                  setForm((f) => ({ ...f, layout: e.target.value }))
                }
                options={LAYOUT_OPTIONS}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-[var(--tc-text-secondary)]">
                排序值
              </label>
              <Input
                type="number"
                min={0}
                value={form.sort_order}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    sort_order: Number(e.target.value) || 0,
                  }))
                }
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-[var(--tc-text-secondary)]">
              视频 URL（可选）
            </label>
            <Input
              value={form.video_url}
              onChange={(e) =>
                setForm((f) => ({ ...f, video_url: e.target.value }))
              }
              placeholder="https://…（hover 卡片时播放）"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-[var(--tc-text-secondary)]">
              提示词 content（点击卡片时带入 dock 输入框；留空则兜底用标题）
            </label>
            <textarea
              value={form.content}
              onChange={(e) =>
                setForm((f) => ({ ...f, content: e.target.value }))
              }
              rows={4}
              placeholder="模板提示词正文…"
              className="w-full rounded-lg border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] px-3 py-2 text-sm text-[var(--tc-text-primary)] focus:border-[var(--tc-accent,#3b82f6)] focus:outline-none focus:ring-1 focus:ring-[var(--tc-ring)] transition-colors"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-[var(--tc-text-secondary)]">
              图片列表（顺序即展示顺序）
            </label>
            <div className="flex flex-col gap-2">
              {form.images.map((img, i) => (
                <div
                  key={img.id ?? `new-${i}`}
                  className="flex items-center gap-2"
                >
                  <span className="min-w-0 flex-1 truncate rounded-lg border border-[var(--tc-border)] bg-[var(--tc-bg-elevated)] px-3 py-1.5 text-xs text-[var(--tc-text-secondary)]">
                    {img.image_url}
                  </span>
                  <button
                    onClick={() => moveImageLocal(i, "up")}
                    disabled={i === 0}
                    title="上移"
                    className="rounded p-1 text-[var(--tc-text-muted)] transition-colors hover:text-[var(--tc-text-primary)] disabled:opacity-30"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => moveImageLocal(i, "down")}
                    disabled={i === form.images.length - 1}
                    title="下移"
                    className="rounded p-1 text-[var(--tc-text-muted)] transition-colors hover:text-[var(--tc-text-primary)] disabled:opacity-30"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => removeImage(i)}
                    title="移除"
                    className="rounded p-1 text-[var(--tc-text-muted)] transition-colors hover:text-[var(--tc-destructive,#ef4444)]"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {uploadTasks.map((task) => (
                <div key={task.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate rounded-lg border border-[var(--tc-border)] bg-[var(--tc-bg-elevated)] px-3 py-1.5 text-xs text-[var(--tc-text-muted)]">
                    {task.name} · 上传中 {Math.round(task.progress)}%
                  </span>
                </div>
              ))}
              {uploadMessage && (
                <div className="rounded-lg border border-[var(--tc-destructive,#ef4444)]/30 bg-[var(--tc-destructive,#ef4444)]/10 px-3 py-1.5 text-xs text-[var(--tc-destructive,#ef4444)]">
                  {uploadMessage}
                </div>
              )}
              <div className="flex items-center gap-2">
                <Input
                  value={newImageUrl}
                  onChange={(e) => setNewImageUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addImage();
                    }
                  }}
                  placeholder="粘贴图片 URL 后点「添加」"
                />
                <button
                  onClick={addImage}
                  className="shrink-0 rounded-lg border border-[var(--tc-border)] px-3 py-2 text-sm text-[var(--tc-text-secondary)] transition-colors hover:bg-white/[0.06]"
                >
                  添加
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadTasks.length > 0}
                  title="选择本地图片上传"
                  className="shrink-0 rounded-lg border border-[var(--tc-border)] px-3 py-2 text-sm text-[var(--tc-text-secondary)] transition-colors hover:bg-white/[0.06] disabled:opacity-50"
                >
                  <Upload className="mr-1 inline h-3.5 w-3.5" />
                  上传图片
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={TEMPLATE_UPLOAD_ACCEPT}
                  className="hidden"
                  onChange={handleFileInputChange}
                />
              </div>
            </div>
          </div>

          {formError && (
            <div className="rounded-lg border border-[var(--tc-destructive,#ef4444)]/30 bg-[var(--tc-destructive,#ef4444)]/10 px-3 py-2 text-sm text-[var(--tc-destructive,#ef4444)]">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setDialogOpen(false)}
              className="rounded-lg border border-[var(--tc-border)] px-4 py-2 text-sm text-[var(--tc-text-secondary)] transition-colors hover:bg-white/[0.06]"
            >
              取消
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving || uploadTasks.length > 0}
              className="rounded-lg bg-[var(--tc-accent,#3b82f6)] px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "保存中…" : uploadTasks.length > 0 ? "上传中…" : "保存"}
            </button>
          </div>
        </div>
      </Dialog>

      {/* 删除确认 */}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title="删除模板"
        width={400}
      >
        <p className="text-sm text-[var(--tc-text-secondary)]">
          确认删除「{deleting?.title}
          」？删除为软删除（数据可恢复），首页将立即不再展示。
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => setDeleting(null)}
            className="rounded-lg border border-[var(--tc-border)] px-4 py-2 text-sm text-[var(--tc-text-secondary)] transition-colors hover:bg-white/[0.06]"
          >
            取消
          </button>
          <button
            onClick={() => void handleDelete()}
            className="rounded-lg bg-[var(--tc-destructive,#ef4444)] px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
          >
            删除
          </button>
        </div>
      </Dialog>

      {/* tag 改名 */}
      <Dialog
        open={renamingTag !== null}
        onOpenChange={(open) => {
          if (!open) setRenamingTag(null);
        }}
        title={`重命名标签（${renamingTag?.tag_code}）`}
        width={400}
      >
        <p className="mb-2 text-xs text-[var(--tc-text-muted)]">
          tag_code 与顺序固定不可改，仅可修改显示名称。
        </p>
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          placeholder="新的标签名称"
        />
        {formError && renamingTag && (
          <div className="mt-2 rounded-lg border border-[var(--tc-destructive,#ef4444)]/30 bg-[var(--tc-destructive,#ef4444)]/10 px-3 py-2 text-sm text-[var(--tc-destructive,#ef4444)]">
            {formError}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={() => setRenamingTag(null)}
            className="rounded-lg border border-[var(--tc-border)] px-4 py-2 text-sm text-[var(--tc-text-secondary)] transition-colors hover:bg-white/[0.06]"
          >
            取消
          </button>
          <button
            onClick={() => void handleRename()}
            className="rounded-lg bg-[var(--tc-accent,#3b82f6)] px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
          >
            保存
          </button>
        </div>
      </Dialog>
    </div>
  );
}
