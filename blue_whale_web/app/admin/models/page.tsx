"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Power,
  Trash2,
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
import { Tabs } from "../_components/ui/tabs";
import { Dialog } from "../_components/ui/dialog";
import { Input } from "../_components/ui/input";
import { Select } from "../_components/ui/select";
import {
  createModel,
  deleteModel,
  getModels,
  reorderModels,
  toggleModel,
  updateModel,
  type AdminModelRow,
} from "../_lib/admin-models";

/** capability_type → tab 元数据。text 预留供后续 agent 文生文选型（IK6T46）。 */
const TYPE_TABS = [
  { key: "image", label: "图片" },
  { key: "video", label: "视频" },
  { key: "text", label: "文生文" },
];

const TYPE_LABEL: Record<string, string> = {
  image: "图片",
  video: "视频",
  text: "文生文",
};

/** 默认参数摘要：图片显示尺寸档，视频显示时长档，文生文无媒体参数 → —。 */
function defaultSummary(m: AdminModelRow): string {
  if (m.capability_type === "text") return "—";
  if (m.capability_type === "video") {
    if (m.default_duration != null) return `${m.default_duration}s`;
    const sizes = Array.isArray(m.supported_sizes)
      ? m.supported_sizes.map((s: { id?: string }) => s.id).join(" / ")
      : "";
    return sizes || "—";
  }
  const parts = [m.default_size, m.default_aspect_ratio];
  return parts.filter(Boolean).join(" · ") || "—";
}

/* ---------- 表单（新建/编辑共用；能力 JSON 列以原始文本编辑，保存时解析） ---------- */

type ModelFormData = {
  provider_id: string;
  model_id: string;
  capability_type: string;
  model_label: string;
  icon: string;
  supported_sizes: string;
  supported_aspect_ratios: string;
  supported_durations: string;
  supported_formats: string;
  default_size: string;
  default_format: string;
  default_aspect_ratio: string;
  default_duration: string;
  features: string;
  enabled: boolean;
  sort_order: number;
};

function prettyJSON(v: unknown, fallback: string): string {
  if (v == null) return fallback;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return fallback;
  }
}

function blankForm(type: string): ModelFormData {
  return {
    provider_id: "volcengine",
    model_id: "",
    capability_type: type,
    model_label: "",
    icon: "",
    supported_sizes: "[]",
    supported_aspect_ratios: "[]",
    supported_durations: "",
    supported_formats: "[]",
    default_size: "",
    default_format: "",
    default_aspect_ratio: "",
    default_duration: "",
    features: "{}",
    enabled: true,
    sort_order: 0,
  };
}

function rowToForm(m: AdminModelRow): ModelFormData {
  return {
    provider_id: m.provider_id,
    model_id: m.model_id,
    capability_type: m.capability_type,
    model_label: m.model_label,
    icon: m.icon ?? "",
    supported_sizes: prettyJSON(m.supported_sizes, "[]"),
    supported_aspect_ratios: prettyJSON(m.supported_aspect_ratios, "[]"),
    supported_durations: prettyJSON(m.supported_durations, ""),
    supported_formats: prettyJSON(m.supported_formats, "[]"),
    default_size: m.default_size,
    default_format: m.default_format ?? "",
    default_aspect_ratio: m.default_aspect_ratio,
    default_duration:
      m.default_duration != null ? String(m.default_duration) : "",
    features: prettyJSON(m.features, "{}"),
    enabled: m.enabled,
    sort_order: m.sort_order,
  };
}

/** JSON 文本列 → 对象；空串按 fallback（时长空 = null，其余空 = []/{}）。解析失败返回错误文案。 */
function collectJsonColumns(
  form: ModelFormData,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const fields: [key: keyof ModelFormData, fallback: unknown][] = [
    ["supported_sizes", []],
    ["supported_aspect_ratios", []],
    ["supported_durations", null],
    ["supported_formats", []],
    ["features", {}],
  ];
  const value: Record<string, unknown> = {};
  for (const [key, fallback] of fields) {
    const text = String(form[key]).trim();
    if (!text) {
      value[key] = fallback;
      continue;
    }
    try {
      value[key] = JSON.parse(text);
    } catch {
      return { ok: false, error: `${key} 不是合法 JSON，请修正后重试` };
    }
  }
  return { ok: true, value };
}

const JSON_KEYS = [
  "supported_sizes",
  "supported_aspect_ratios",
  "supported_durations",
  "supported_formats",
  "features",
] as const;
type JsonKey = (typeof JSON_KEYS)[number];

const JSON_LABELS: Record<JsonKey, string> = {
  supported_sizes: "尺寸 supported_sizes",
  supported_aspect_ratios: "比例 supported_aspect_ratios",
  supported_durations: "时长 supported_durations",
  supported_formats: "格式 supported_formats",
  features: "特性 features",
};

const JSON_PLACEHOLDERS: Record<JsonKey, string> = {
  supported_sizes: '[{"id":"1k","label":"1K"}]',
  supported_aspect_ratios: '["1:1","16:9"]',
  supported_durations: "[5,10,30] 或留空",
  supported_formats: '["png","jpeg"]',
  features: '{"stream":true}',
};

export default function AdminModelsPage() {
  const [models, setModels] = useState<AdminModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeType, setActiveType] = useState("image");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ModelFormData>(blankForm("image"));
  const [copySourceId, setCopySourceId] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setModels(await getModels());
    } catch (e) {
      console.error("加载模型目录失败", e);
      setError(e instanceof Error ? e.message : "加载模型目录失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const filtered = models.filter((m) => m.capability_type === activeType);
  // 复制式新建：只列同类型模型（能力 JSON 形状才一致），支持空白新建。
  const copySources = models.filter(
    (m) => m.capability_type === form.capability_type,
  );

  const openCreate = () => {
    setEditingId(null);
    setForm(blankForm(activeType));
    setCopySourceId("");
    setDialogOpen(true);
  };

  const openEdit = (m: AdminModelRow) => {
    setEditingId(m.id);
    setForm(rowToForm(m));
    setCopySourceId("");
    setDialogOpen(true);
  };

  const handleCopySource = (id: string) => {
    setCopySourceId(id);
    const source = copySources.find((m) => m.id === id);
    setForm(source ? rowToForm(source) : blankForm(form.capability_type));
  };

  const handleTypeChange = (type: string) => {
    setForm(blankForm(type));
    setCopySourceId("");
  };

  const handleSave = async () => {
    const parsed = collectJsonColumns(form);
    if (!parsed.ok) {
      alert(parsed.error);
      return;
    }
    const durationText = form.default_duration.trim();
    let duration: number | null = null;
    if (durationText !== "") {
      const n = Number(durationText);
      if (!Number.isInteger(n) || n < 0 || n > 2147483647) {
        alert("默认时长须为非负整数秒（≤2147483647）或留空");
        return;
      }
      duration = n;
    }
    try {
      if (editingId) {
        await updateModel(editingId, {
          model_label: form.model_label,
          ...parsed.value,
          default_size: form.default_size,
          default_format: form.default_format.trim() || null,
          default_aspect_ratio: form.default_aspect_ratio,
          default_duration: duration,
          icon: form.icon.trim() || null,
          enabled: form.enabled,
          sort_order: form.sort_order,
        });
      } else {
        await createModel({
          provider_id: form.provider_id.trim(),
          model_id: form.model_id.trim(),
          capability_type: form.capability_type,
          model_label: form.model_label.trim(),
          ...parsed.value,
          default_size: form.default_size,
          default_format: form.default_format.trim() || null,
          default_aspect_ratio: form.default_aspect_ratio,
          default_duration: duration,
          icon: form.icon.trim() || null,
          enabled: form.enabled,
        });
      }
      setModels(await getModels());
      setDialogOpen(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存失败");
    }
  };

  const isEdit = editingId !== null;

  /* ---------- 生命周期：启停 / 上下移排序 / 软删（服务端落审计） ---------- */

  const handleToggle = async (m: AdminModelRow) => {
    setTogglingId(m.id);
    try {
      const updated = await toggleModel(m.id);
      setModels((prev) => prev.map((row) => (row.id === m.id ? updated : row)));
    } catch (e) {
      alert(e instanceof Error ? e.message : "切换启停失败");
    } finally {
      setTogglingId(null);
    }
  };

  const handleMove = async (m: AdminModelRow, dir: -1 | 1) => {
    const idx = filtered.findIndex((row) => row.id === m.id);
    const neighbor = filtered[idx + dir];
    if (!neighbor) return;
    try {
      setModels(
        await reorderModels([
          { id: m.id, sortOrder: neighbor.sort_order },
          { id: neighbor.id, sortOrder: m.sort_order },
        ]),
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "调整排序失败");
    }
  };

  const handleDelete = async (m: AdminModelRow) => {
    if (
      !window.confirm(
        `确认删除模型「${m.model_label}」（${m.model_id}）？软删后行数据保留、列表不再展示。`,
      )
    ) {
      return;
    }
    try {
      await deleteModel(m.id);
      setModels((prev) => prev.filter((row) => row.id !== m.id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "删除失败");
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--tc-text-primary)]">
            模型列表
          </h1>
          <p className="mt-1 text-sm text-[var(--tc-text-muted)]">
            管理前端 dock
            展示与后端调用所依赖的模型能力目录（generation_model_capability）
          </p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--tc-accent,#3b82f6)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          新建模型
        </button>
      </div>

      <div className="mb-4">
        <Tabs tabs={TYPE_TABS} active={activeType} onChange={setActiveType} />
      </div>

      <div className="rounded-xl border border-[var(--tc-border)] bg-[var(--tc-bg-surface)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>模型 ID</TableHead>
              <TableHead>供应商</TableHead>
              <TableHead>展示名</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>默认参数</TableHead>
              <TableHead>启用</TableHead>
              <TableHead>排序</TableHead>
              <TableHead>更新时间</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {error ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-12 text-center text-[var(--tc-destructive)]"
                >
                  加载失败：{error}
                </TableCell>
              </TableRow>
            ) : loading ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-12 text-center text-[var(--tc-text-muted)]"
                >
                  加载中…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-12 text-center text-[var(--tc-text-muted)]"
                >
                  暂无该类型模型
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((m, idx) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-xs text-[var(--tc-text-primary)]">
                    {m.model_id}
                  </TableCell>
                  <TableCell className="text-[var(--tc-text-secondary)]">
                    {m.provider_id}
                  </TableCell>
                  <TableCell className="font-medium">{m.model_label}</TableCell>
                  <TableCell>
                    <Badge variant="default">
                      {TYPE_LABEL[m.capability_type] ?? m.capability_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[var(--tc-text-secondary)]">
                    {defaultSummary(m)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={m.enabled ? "success" : "secondary"}>
                      {m.enabled ? "启用" : "停用"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[var(--tc-text-secondary)]">
                    {m.sort_order}
                  </TableCell>
                  <TableCell className="text-xs text-[var(--tc-text-tertiary)]">
                    {new Date(m.updated_at).toLocaleString("zh-CN")}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleToggle(m)}
                        disabled={togglingId === m.id}
                        className="rounded p-1.5 text-[var(--tc-text-muted)] hover:text-[var(--tc-text-primary)] hover:bg-[var(--tc-bg-elevated)] disabled:cursor-not-allowed disabled:opacity-40"
                        aria-label={`${m.enabled ? "停用" : "启用"} ${m.model_label}`}
                        title={m.enabled ? "停用" : "启用"}
                      >
                        <Power className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleMove(m, -1)}
                        disabled={idx === 0}
                        className="rounded p-1.5 text-[var(--tc-text-muted)] hover:text-[var(--tc-text-primary)] hover:bg-[var(--tc-bg-elevated)] disabled:cursor-not-allowed disabled:opacity-30"
                        aria-label={`上移 ${m.model_label}`}
                        title="上移"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleMove(m, 1)}
                        disabled={idx === filtered.length - 1}
                        className="rounded p-1.5 text-[var(--tc-text-muted)] hover:text-[var(--tc-text-primary)] hover:bg-[var(--tc-bg-elevated)] disabled:cursor-not-allowed disabled:opacity-30"
                        aria-label={`下移 ${m.model_label}`}
                        title="下移"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => openEdit(m)}
                        className="rounded p-1.5 text-[var(--tc-text-muted)] hover:text-[var(--tc-text-primary)] hover:bg-[var(--tc-bg-elevated)]"
                        aria-label={`编辑 ${m.model_label}`}
                        title="编辑"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(m)}
                        className="rounded p-1.5 text-[var(--tc-text-muted)] hover:text-[var(--tc-destructive)] hover:bg-[var(--tc-bg-elevated)]"
                        aria-label={`删除 ${m.model_label}`}
                        title="删除"
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

      {/* 新建/编辑 Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={isEdit ? "编辑模型" : "新建模型"}
        width={640}
      >
        <div className="space-y-4">
          {isEdit ? (
            <div className="grid grid-cols-3 gap-3 rounded-lg border border-[var(--tc-border-subtle)] bg-[var(--tc-bg-elevated)] px-3 py-2.5 text-sm">
              <div>
                <div className="text-xs text-[var(--tc-text-muted)]">
                  供应商
                </div>
                <div className="font-medium">{form.provider_id}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-[var(--tc-text-muted)]">
                  模型 ID（不可改）
                </div>
                <div className="font-mono text-xs">{form.model_id}</div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                  类型
                </label>
                <Select
                  value={form.capability_type}
                  onChange={(e) => handleTypeChange(e.target.value)}
                  options={TYPE_TABS.map((t) => ({
                    value: t.key,
                    label: t.label,
                  }))}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                  复制自某模型{" "}
                  <span className="text-[var(--tc-text-muted)]">（选填）</span>
                </label>
                <Select
                  value={copySourceId}
                  onChange={(e) => handleCopySource(e.target.value)}
                  options={[
                    { value: "", label: "空白新建" },
                    ...copySources.map((m) => ({
                      value: m.id,
                      label: `${m.model_label}（${m.model_id}）`,
                    })),
                  ]}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                供应商 provider_id
              </label>
              <Input
                value={form.provider_id}
                disabled={isEdit}
                onChange={(e) =>
                  setForm({ ...form, provider_id: e.target.value })
                }
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                模型 ID model_id
              </label>
              <Input
                value={form.model_id}
                disabled={isEdit}
                placeholder="如 doubao-seedream-4-0-250828"
                onChange={(e) => setForm({ ...form, model_id: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                展示名 model_label
              </label>
              <Input
                value={form.model_label}
                placeholder="如 豆包 Seedream 4.0"
                onChange={(e) =>
                  setForm({ ...form, model_label: e.target.value })
                }
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                图标 icon{" "}
                <span className="text-[var(--tc-text-muted)]">（选填）</span>
              </label>
              <Input
                value={form.icon}
                placeholder="URL 或图标名"
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
              />
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-[var(--tc-text-secondary)]">
              能力 JSON 列（原始 JSON 编辑，保存时校验）
            </p>
            <div className="space-y-3">
              {JSON_KEYS.map((key) => (
                <div key={key}>
                  <label className="mb-1 block text-xs text-[var(--tc-text-muted)]">
                    {JSON_LABELS[key]}
                  </label>
                  <textarea
                    className="w-full rounded-lg border border-[var(--tc-border)] bg-[var(--tc-bg-surface)] px-3 py-2 font-mono text-xs text-[var(--tc-text-primary)] placeholder:text-[var(--tc-text-muted)] focus:border-[var(--tc-accent,#3b82f6)] focus:outline-none focus:ring-1 focus:ring-[var(--tc-ring)] transition-colors"
                    rows={key === "supported_sizes" ? 5 : 3}
                    value={String(form[key] ?? "")}
                    placeholder={JSON_PLACEHOLDERS[key]}
                    onChange={(e) =>
                      setForm({ ...form, [key]: e.target.value })
                    }
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                默认尺寸 default_size
              </label>
              <Input
                value={form.default_size}
                placeholder="如 1K"
                onChange={(e) =>
                  setForm({ ...form, default_size: e.target.value })
                }
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                默认比例 default_aspect_ratio
              </label>
              <Input
                value={form.default_aspect_ratio}
                placeholder="如 1:1"
                onChange={(e) =>
                  setForm({ ...form, default_aspect_ratio: e.target.value })
                }
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                默认格式 default_format{" "}
                <span className="text-[var(--tc-text-muted)]">（选填）</span>
              </label>
              <Input
                value={form.default_format}
                placeholder="如 png"
                onChange={(e) =>
                  setForm({ ...form, default_format: e.target.value })
                }
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                默认时长 default_duration 秒{" "}
                <span className="text-[var(--tc-text-muted)]">（选填）</span>
              </label>
              <Input
                type="number"
                min="0"
                value={form.default_duration}
                placeholder="如 5"
                onChange={(e) =>
                  setForm({ ...form, default_duration: e.target.value })
                }
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-[var(--tc-text-secondary)]">
                启用
              </label>
              <button
                type="button"
                onClick={() => setForm({ ...form, enabled: !form.enabled })}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${form.enabled ? "bg-[var(--tc-accent,#3b82f6)]" : "bg-[var(--tc-bg-elevated)]"}`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${form.enabled ? "translate-x-[18px]" : "translate-x-[4px]"}`}
                />
              </button>
            </div>
            {isEdit && (
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-[var(--tc-text-secondary)]">
                  排序
                </label>
                <Input
                  type="number"
                  min="0"
                  className="w-24"
                  value={form.sort_order}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      sort_order: Number(e.target.value) || 0,
                    })
                  }
                />
              </div>
            )}
          </div>

          {!isEdit && (
            <p className="text-xs text-[var(--tc-text-muted)]">
              复制式新建会把所选模型的能力 JSON 与默认参数整份带过来，改
              provider_id / model_id / 展示名即可出新档位；同 (provider_id,
              model_id) 不可重复。
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => setDialogOpen(false)}
              className="rounded-lg border border-[var(--tc-border)] px-4 py-2 text-sm text-[var(--tc-text-secondary)] hover:bg-[var(--tc-bg-elevated)]"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="rounded-lg bg-[var(--tc-accent,#3b82f6)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              保存
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
