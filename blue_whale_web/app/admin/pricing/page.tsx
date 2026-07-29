"use client";

import { useState, useEffect, useMemo } from "react";
import { Plus, Pencil, Trash2, Calculator, Zap } from "lucide-react";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "../_components/ui/table";
import { Badge } from "../_components/ui/badge";
import { Dialog } from "../_components/ui/dialog";
import { Input } from "../_components/ui/input";
import { Select } from "../_components/ui/select";
import type { PricingRule, PricingFormData, GenerationType, PreviewResult } from "./_mock";
import { getPricingRules, createPricingRule, updatePricingRule, deletePricingRule, togglePricingRule, calculatePreview } from "./_mock";

const GEN_TYPE_OPTIONS = [
  { value: "all", label: "全部类型" },
  { value: "image", label: "图片生成" },
  { value: "video", label: "视频生成" },
];

const GEN_TYPE_FORM_OPTIONS = [
  { value: "image", label: "图片 (image)" },
  { value: "video", label: "视频 (video)" },
];

const MODEL_OPTIONS = [
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
  { value: "claude-sonnet-5", label: "Claude Sonnet 5" },
  { value: "claude-fable-5", label: "Claude Fable 5" },
  { value: "claude-opus-5", label: "Claude Opus 5" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
];

const IMAGE_QUALITY_OPTIONS = [
  { value: "sd", label: "SD" },
  { value: "hd", label: "HD" },
  { value: "4k", label: "4K" },
];

const VIDEO_QUALITY_OPTIONS = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "4k", label: "4K" },
];

const EMPTY_FORM: PricingFormData = {
  generationType: "image", modelId: "gpt-4o", modelName: "GPT-4o",
  paramsSchema: { quality: "hd" }, baseCost: 10, unit: "张", description: "", enabled: true,
};

export default function AdminPricingPage() {
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [genFilter, setGenFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PricingFormData>(EMPTY_FORM);
  const [formQuality, setFormQuality] = useState("hd");
  const [previewOpen, setPreviewOpen] = useState(false);

  // Preview calculator state
  const [previewType, setPreviewType] = useState<GenerationType>("image");
  const [previewModel, setPreviewModel] = useState("gpt-4o");
  const [previewQuality, setPreviewQuality] = useState("hd");
  const [previewCount, setPreviewCount] = useState(4);
  const [previewDuration, setPreviewDuration] = useState(10);
  const [previewResult, setPreviewResult] = useState<PreviewResult | null>(null);
  const [previewAttempted, setPreviewAttempted] = useState(false);

  useEffect(() => { setRules(getPricingRules()); }, []);

  const filtered = useMemo(() => {
    if (genFilter === "all") return rules;
    return rules.filter((r) => r.generationType === genFilter);
  }, [rules, genFilter]);

  const openCreate = () => { setEditingId(null); setForm(EMPTY_FORM); setFormQuality("hd"); setDialogOpen(true); };
  const openEdit = (r: PricingRule) => {
    setEditingId(r.id);
    setForm({
      generationType: r.generationType, modelId: r.modelId, modelName: r.modelName,
      paramsSchema: r.paramsSchema, baseCost: r.baseCost, unit: r.unit, description: r.description, enabled: r.enabled,
    });
    setFormQuality(String(r.paramsSchema.quality || "hd"));
    setDialogOpen(true);
  };

  const handleSave = () => {
    const data: PricingFormData = { ...form, paramsSchema: { quality: formQuality } };
    if (!data.description.trim()) data.description = `${form.generationType === "image" ? "图片" : "视频"} — ${form.modelName} — ${formQuality}`;
    if (editingId) { updatePricingRule(editingId, data); } else { createPricingRule(data); }
    setRules(getPricingRules()); setDialogOpen(false);
  };

  const handleToggle = (id: string) => { togglePricingRule(id); setRules(getPricingRules()); };

  const handlePreview = () => {
    setPreviewAttempted(true);
    const r = calculatePreview({
      generationType: previewType, modelId: previewModel,
      params: previewType === "image" ? { quality: previewQuality, count: previewCount } : { quality: previewQuality, duration_seconds: previewDuration },
    });
    setPreviewResult(r);
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--tc-text-primary)]">定价规则</h1>
          <p className="mt-1 text-sm text-[var(--tc-text-muted)]">按生成类型 + 模型 + 清晰度设定积分单价，支持消耗预览</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setPreviewOpen(true); setPreviewResult(null); setPreviewAttempted(false); }} className="inline-flex items-center gap-2 rounded-lg border border-[var(--tc-border)] px-4 py-2 text-sm font-medium text-[var(--tc-text-secondary)] hover:bg-[var(--tc-bg-elevated)] transition-colors">
            <Calculator className="h-4 w-4" />消耗预览
          </button>
          <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-[var(--tc-accent,#3b82f6)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity">
            <Plus className="h-4 w-4" />新建规则
          </button>
        </div>
      </div>

      <div className="mb-4">
        <Select value={genFilter} onChange={(e) => setGenFilter(e.target.value)} options={GEN_TYPE_OPTIONS} />
      </div>

      <div className="rounded-xl border border-[var(--tc-border)] bg-[var(--tc-bg-surface)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>类型</TableHead>
              <TableHead>模型</TableHead>
              <TableHead>参数匹配</TableHead>
              <TableHead>单价 (积分)</TableHead>
              <TableHead>单位</TableHead>
              <TableHead>说明</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-12 text-center text-[var(--tc-text-muted)]">暂无定价规则</TableCell></TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><Badge variant={r.generationType === "image" ? "default" : "outline"}>{r.generationType === "image" ? "图片" : "视频"}</Badge></TableCell>
                  <TableCell className="font-medium">{r.modelName}</TableCell>
                  <TableCell className="font-mono text-xs text-[var(--tc-text-secondary)]">{JSON.stringify(r.paramsSchema)}</TableCell>
                  <TableCell className="font-mono font-medium">{r.baseCost} 积分</TableCell>
                  <TableCell className="text-[var(--tc-text-tertiary)]">{r.unit}</TableCell>
                  <TableCell className="text-sm text-[var(--tc-text-secondary)] max-w-[180px] truncate">{r.description}</TableCell>
                  <TableCell>
                    <button onClick={() => handleToggle(r.id)}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${r.enabled ? "bg-[var(--tc-accent,#3b82f6)]" : "bg-[var(--tc-bg-elevated)]"}`}>
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${r.enabled ? "translate-x-[18px]" : "translate-x-[4px]"}`} />
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <button onClick={() => openEdit(r)} className="rounded p-1.5 text-[var(--tc-text-muted)] hover:text-[var(--tc-text-primary)] hover:bg-[var(--tc-bg-elevated)]"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => { deletePricingRule(r.id); setRules(getPricingRules()); }} className="rounded p-1.5 text-[var(--tc-text-muted)] hover:text-[#ef4444] hover:bg-[#ef4444]/10"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* CRUD Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen} title={editingId ? "编辑定价规则" : "新建定价规则"} width={480}>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">生成类型</label>
            <Select value={form.generationType} onChange={(e) => {
              const gt = e.target.value as GenerationType;
              setForm({ ...form, generationType: gt });
              setFormQuality(gt === "image" ? "hd" : "1080p");
            }} options={GEN_TYPE_FORM_OPTIONS} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">模型</label>
            <Select value={form.modelId} onChange={(e) => {
              const m = MODEL_OPTIONS.find((o) => o.value === e.target.value);
              setForm({ ...form, modelId: e.target.value, modelName: m?.label || e.target.value });
            }} options={MODEL_OPTIONS} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">清晰度</label>
            <Select value={formQuality} onChange={(e) => setFormQuality(e.target.value)}
              options={form.generationType === "image" ? IMAGE_QUALITY_OPTIONS : VIDEO_QUALITY_OPTIONS} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">单价 (积分)</label>
              <Input type="number" step="0.01" value={form.baseCost} onChange={(e) => setForm({ ...form, baseCost: Number(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">单位</label>
              <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="张 / 秒" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">说明</label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="如：HD 清晰度图片 × 1" />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setDialogOpen(false)} className="rounded-lg border border-[var(--tc-border)] px-4 py-2 text-sm text-[var(--tc-text-secondary)] hover:bg-[var(--tc-bg-elevated)]">取消</button>
            <button onClick={handleSave} className="rounded-lg bg-[var(--tc-accent,#3b82f6)] px-4 py-2 text-sm font-medium text-white hover:opacity-90">保存</button>
          </div>
        </div>
      </Dialog>

      {/* C2: Consumption Preview Calculator */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen} title="积分消耗预览 · 模拟选参计算" width={480}>
        <div className="space-y-5">
          <p className="text-xs text-[var(--tc-text-muted)]">模拟用户在 Dock 面板选参时的积分消耗实时计算，确认定价规则合理。</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">生成类型</label>
              <Select value={previewType} onChange={(e) => { setPreviewType(e.target.value as GenerationType); setPreviewResult(null); setPreviewAttempted(false); }}
                options={GEN_TYPE_FORM_OPTIONS} />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">模型</label>
              <Select value={previewModel} onChange={(e) => { setPreviewModel(e.target.value); setPreviewResult(null); setPreviewAttempted(false); }} options={MODEL_OPTIONS} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">清晰度</label>
              <Select value={previewQuality} onChange={(e) => { setPreviewQuality(e.target.value); setPreviewResult(null); setPreviewAttempted(false); }}
                options={previewType === "image" ? IMAGE_QUALITY_OPTIONS : VIDEO_QUALITY_OPTIONS} />
            </div>
            {previewType === "image" ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">数量 (张)</label>
                <Input type="number" value={previewCount} onChange={(e) => { setPreviewCount(Number(e.target.value) || 1); setPreviewResult(null); setPreviewAttempted(false); }} />
              </div>
            ) : (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">时长 (秒)</label>
                <Input type="number" value={previewDuration} onChange={(e) => { setPreviewDuration(Number(e.target.value) || 1); setPreviewResult(null); setPreviewAttempted(false); }} />
              </div>
            )}
          </div>
          <button onClick={handlePreview} className="w-full rounded-lg bg-[var(--tc-accent,#3b82f6)] py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity">
            <Zap className="inline h-4 w-4 mr-1" />计算消耗
          </button>

          {previewResult ? (
            <div className={`rounded-xl border p-5 ${previewResult.exactMatch ? "border-[#22c55e]/30 bg-[#22c55e]/5" : "border-[#f59e0b]/30 bg-[#f59e0b]/5"}`}>
              <div className="text-center">
                <div className="text-3xl font-bold text-[var(--tc-text-primary)]">{previewResult.total}</div>
                <div className="mt-1 text-sm text-[var(--tc-text-muted)]">积分</div>
              </div>
              <div className="mt-3 space-y-2 text-sm">
                <div className="rounded bg-[var(--tc-bg-elevated)] px-3 py-2">
                  <span className="text-[var(--tc-text-muted)]">费用分解：</span>
                  <span className="font-mono text-[var(--tc-text-primary)]">{previewResult.breakdown}</span>
                </div>
                <div className="rounded bg-[var(--tc-bg-elevated)] px-3 py-2">
                  <span className="text-[var(--tc-text-muted)]">匹配规则：</span>
                  <span className="text-[var(--tc-text-primary)]">{previewResult.ruleMatched}</span>
                  {!previewResult.exactMatch && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs text-[#f59e0b]">
                      ⚠️ 近似匹配 — 无精确对应规则
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : previewAttempted ? (
            <div className="rounded-xl border border-[#f59e0b]/30 bg-[#f59e0b]/5 p-5 text-center text-sm text-[#f59e0b]">
              未找到匹配的定价规则 — 请检查生成类型、模型与清晰度组合是否存在启用规则。
            </div>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
