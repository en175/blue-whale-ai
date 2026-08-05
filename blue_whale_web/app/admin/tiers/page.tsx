"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  Eye,
  Clock,
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
import type { AdminTier, TierFormData } from "./data";
import {
  getTiers,
  createTier,
  updateTier,
  deleteTier,
  moveTier,
  getPreviewTiers,
} from "./data";
// 积分派生单一来源：与服务端 route 同一常量/公式（Go QuotaPerUnit 耦合说明在 constants.ts）。
import { deriveTierAmount } from "@/lib/topup-tier/constants";

const STATUS_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "active", label: "启用" },
  { value: "inactive", label: "停用" },
];

const EMPTY_FORM: TierFormData = {
  amount: deriveTierAmount(10), // 只读派生，落库以原价为准
  originalPrice: 10,
  discount: 1,
  isRecommended: false,
  status: "active",
  startTime: "",
  endTime: "",
};

function formatTimeRange(t: AdminTier): string | null {
  if (!t.startTime && !t.endTime) return null;
  const fmt = (s: string) =>
    new Date(s).toLocaleString("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  if (t.startTime && t.endTime)
    return `${fmt(t.startTime)} — ${fmt(t.endTime)}`;
  if (t.startTime) return `${fmt(t.startTime)} 起`;
  return `至 ${fmt(t.endTime!)}`;
}

/** Parse datetime-local input (local time, no TZ) → UTC ISO string. */
function toUTCDatetime(localStr: string): string {
  if (!localStr) return "";
  const [datePart, timePart] = localStr.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [h, min] = timePart.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, min)).toISOString();
}

function timeStatus(t: AdminTier): "waiting" | "active" | "expired" | null {
  if (!t.startTime && !t.endTime) return null;
  const now = new Date().toISOString();
  if (t.startTime && now < t.startTime) return "waiting";
  if (t.endTime && now > t.endTime) return "expired";
  return "active";
}

/** 折扣显示：0.85 → "8.5折"，1 → "—" */
function discountLabel(d: number): string {
  if (d >= 1) return "—";
  return `${Math.round(d * 100) / 10}折`;
}

export default function AdminTiersPage() {
  const [tiers, setTiers] = useState<AdminTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TierFormData>(EMPTY_FORM);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTiers, setPreviewTiers] = useState<AdminTier[]>([]);

  const load = useCallback(async () => {
    try {
      setTiers(await getTiers());
    } catch (e) {
      console.error("加载档位失败", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const filtered =
    statusFilter === "all"
      ? tiers
      : tiers.filter((t) => t.status === statusFilter);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };
  const openEdit = (t: AdminTier) => {
    setEditingId(t.id);
    setForm({
      amount: deriveTierAmount(t.originalPrice), // 以原价重算，忽略历史存量 amount
      originalPrice: t.originalPrice,
      discount: t.discount,
      isRecommended: t.isRecommended,
      status: t.status,
      startTime: t.startTime ? t.startTime.slice(0, 16) : "",
      endTime: t.endTime ? t.endTime.slice(0, 16) : "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const data = {
      ...form,
      amount: deriveTierAmount(form.originalPrice), // 积分只读派生，落库以原价为准
      startTime: toUTCDatetime(form.startTime),
      endTime: toUTCDatetime(form.endTime),
    };
    try {
      if (editingId) {
        await updateTier(editingId, data);
      } else {
        await createTier(data);
      }
      setTiers(await getTiers());
      setDialogOpen(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存失败");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTier(id);
      setTiers(await getTiers());
    } catch (e) {
      alert(e instanceof Error ? e.message : "删除失败");
    }
  };

  const handleMove = async (id: string, direction: "up" | "down") => {
    try {
      setTiers(await moveTier(tiers, id, direction));
    } catch (e) {
      alert(e instanceof Error ? e.message : "排序失败");
    }
  };

  const openPreview = async () => {
    try {
      setPreviewTiers(await getPreviewTiers());
    } catch {
      setPreviewTiers([]);
    }
    setPreviewOpen(true);
  };

  const computedPrice =
    Math.round(form.originalPrice * form.discount * 100) / 100;
  const derivedPoints = deriveTierAmount(form.originalPrice);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--tc-text-primary)]">
            充值档位
          </h1>
          <p className="mt-1 text-sm text-[var(--tc-text-muted)]">
            管理档位 CRUD、折扣定价、限时上下架与效果预览
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openPreview}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--tc-border)] px-4 py-2 text-sm font-medium text-[var(--tc-text-secondary)] hover:bg-[var(--tc-bg-elevated)] transition-colors"
          >
            <Eye className="h-4 w-4" />
            用户端预览
          </button>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--tc-accent,#3b82f6)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" />
            新建档位
          </button>
        </div>
      </div>

      <div className="mb-4">
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          options={STATUS_OPTIONS}
        />
      </div>

      <div className="rounded-xl border border-[var(--tc-border)] bg-[var(--tc-bg-surface)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>积分数</TableHead>
              <TableHead>原价 (元)</TableHead>
              <TableHead>折扣</TableHead>
              <TableHead>实付 (元)</TableHead>
              <TableHead>推荐</TableHead>
              <TableHead>限时</TableHead>
              <TableHead>排序</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={10}
                  className="py-12 text-center text-[var(--tc-text-muted)]"
                >
                  加载中…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={10}
                  className="py-12 text-center text-[var(--tc-text-muted)]"
                >
                  暂无档位数据
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((t) => {
                const ts = timeStatus(t);
                return (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs text-[var(--tc-text-tertiary)]">
                      {t.id}
                    </TableCell>
                    <TableCell className="font-medium">
                      {t.amount.toLocaleString()}
                    </TableCell>
                    <TableCell>¥{t.originalPrice}</TableCell>
                    <TableCell>
                      {t.discount < 1 ? (
                        <span className="text-[#22c55e]">
                          {discountLabel(t.discount)}
                        </span>
                      ) : (
                        <span className="text-[var(--tc-text-muted)]">—</span>
                      )}
                    </TableCell>
                    <TableCell className="font-semibold">¥{t.price}</TableCell>
                    <TableCell>
                      {t.isRecommended ? (
                        <Badge variant="success">推荐</Badge>
                      ) : (
                        <span className="text-[var(--tc-text-muted)]">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {formatTimeRange(t) ? (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <Clock className="h-3 w-3" />
                          <span className="text-[var(--tc-text-secondary)]">
                            {formatTimeRange(t)}
                          </span>
                          {ts === "waiting" && (
                            <Badge variant="default">待生效</Badge>
                          )}
                          {ts === "expired" && (
                            <Badge variant="secondary">已过期</Badge>
                          )}
                        </span>
                      ) : (
                        <span className="text-[var(--tc-text-muted)]">
                          永久
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleMove(t.id, "up")}
                          className="rounded p-0.5 text-[var(--tc-text-muted)] hover:text-[var(--tc-text-primary)]"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleMove(t.id, "down")}
                          className="rounded p-0.5 text-[var(--tc-text-muted)] hover:text-[var(--tc-text-primary)]"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          t.status === "active" ? "success" : "secondary"
                        }
                      >
                        {t.status === "active" ? "启用" : "停用"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(t)}
                          className="rounded p-1.5 text-[var(--tc-text-muted)] hover:text-[var(--tc-text-primary)] hover:bg-[var(--tc-bg-elevated)]"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(t.id)}
                          className="rounded p-1.5 text-[var(--tc-text-muted)] hover:text-[#ef4444] hover:bg-[#ef4444]/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editingId ? "编辑档位" : "新建档位"}
        width={480}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                原价 (元)
              </label>
              <Input
                type="number"
                value={form.originalPrice}
                onChange={(e) =>
                  setForm({
                    ...form,
                    originalPrice: Number(e.target.value) || 0,
                  })
                }
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                积分数{" "}
                <span className="text-[var(--tc-text-muted)]">(派生)</span>
              </label>
              <div className="flex h-9 items-center rounded-lg border border-[var(--tc-border)] bg-[var(--tc-bg-elevated)] px-3 text-sm font-semibold text-[var(--tc-text-primary)]">
                {derivedPoints.toLocaleString()}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                折扣比例{" "}
                <span className="text-[var(--tc-text-muted)]">(0–1]</span>
              </label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max="1"
                value={form.discount}
                onChange={(e) =>
                  setForm({ ...form, discount: Number(e.target.value) || 1 })
                }
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                实付价格
              </label>
              <div className="flex h-9 items-center rounded-lg border border-[var(--tc-border)] bg-[var(--tc-bg-elevated)] px-3 text-sm font-semibold text-[var(--tc-accent,#3b82f6)]">
                ¥{computedPrice}
              </div>
            </div>
          </div>
          <p className="text-xs text-[var(--tc-text-muted)]">
            积分 = 原价 × 500000（只读派生，对应 Go 充值配额
            QuotaPerUnit）。实付 = 原价 × 折扣，折扣 = 1 表示无折扣。
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                生效时间{" "}
                <span className="text-[var(--tc-text-muted)]">（选填）</span>
              </label>
              <Input
                type="datetime-local"
                value={form.startTime}
                onChange={(e) =>
                  setForm({ ...form, startTime: e.target.value })
                }
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
                失效时间{" "}
                <span className="text-[var(--tc-text-muted)]">（选填）</span>
              </label>
              <Input
                type="datetime-local"
                value={form.endTime}
                onChange={(e) => setForm({ ...form, endTime: e.target.value })}
              />
            </div>
          </div>
          <p className="text-xs text-[var(--tc-text-muted)]">
            设限时范围后，到生效时间自动上架、到失效时间自动下架。留空 =
            永久有效。
          </p>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-[var(--tc-text-secondary)]">
              推荐档位
            </label>
            <button
              type="button"
              onClick={() =>
                setForm({ ...form, isRecommended: !form.isRecommended })
              }
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${form.isRecommended ? "bg-[var(--tc-accent,#3b82f6)]" : "bg-[var(--tc-bg-elevated)]"}`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${form.isRecommended ? "translate-x-[18px]" : "translate-x-[4px]"}`}
              />
            </button>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-[var(--tc-text-secondary)]">
              状态
            </label>
            <Select
              value={form.status}
              onChange={(e) =>
                setForm({
                  ...form,
                  status: e.target.value as "active" | "inactive",
                })
              }
              options={[
                { value: "active", label: "启用" },
                { value: "inactive", label: "停用" },
              ]}
            />
          </div>
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

      {/* User-facing Recharge Page Preview */}
      <Dialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title="用户端充值页效果预览"
        width={520}
      >
        <div className="space-y-3">
          <p className="text-xs text-[var(--tc-text-muted)]">
            以下展示当前已上架且未失效的档位在用户端充值页的真实排列效果。
          </p>
          {previewTiers.length === 0 ? (
            <div className="py-8 text-center text-[var(--tc-text-muted)]">
              暂无可用档位
            </div>
          ) : (
            <div className="grid gap-3">
              {previewTiers.map((t) => (
                <div
                  key={t.id}
                  className={`relative rounded-xl border p-4 ${t.isRecommended ? "border-[var(--tc-accent,#3b82f6)] bg-[var(--tc-accent,#3b82f6)]/5" : "border-[var(--tc-border)] bg-[var(--tc-bg-elevated)]"}`}
                >
                  {t.isRecommended && (
                    <span className="absolute -top-2.5 left-4 rounded-full bg-[var(--tc-accent,#3b82f6)] px-3 py-0.5 text-[10px] font-semibold text-white">
                      ⭐ 推荐
                    </span>
                  )}
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-lg font-bold text-[var(--tc-text-primary)]">
                        {t.amount.toLocaleString()}{" "}
                        <span className="text-sm font-normal text-[var(--tc-text-secondary)]">
                          积分
                        </span>
                      </div>
                      {t.discount < 1 && (
                        <div className="mt-0.5 text-xs text-[#22c55e]">
                          {discountLabel(t.discount)}优惠
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="flex items-baseline gap-1.5 justify-end">
                        <span className="text-lg font-bold text-[var(--tc-accent,#3b82f6)]">
                          ¥{t.price}
                        </span>
                        {t.discount < 1 && (
                          <span className="text-xs text-[var(--tc-text-muted)] line-through">
                            ¥{t.originalPrice}
                          </span>
                        )}
                      </div>
                      <button className="mt-1 rounded-md bg-[var(--tc-accent,#3b82f6)] px-3 py-1 text-xs font-medium text-white">
                        立即充值
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
